// Phase 6.0 Starsector-shape tactical combat. Top-down 2D real-time-with-
// pause: ship position/velocity/heading, hardpoint weapons firing in arcs
// + range, projectile entities, flux/shields/armor/hull damage routing.
//
// Tick model (per frame, when clock.mode === 'combat' AND store.paused === false):
//   1. Player ship physics — Newtonian: WASD applies thrust at `accel` along
//      the ship's local frame, no input applies passive `decel` against
//      current velocity, |vel| capped at `topSpeed`. Heading uses bang-bang
//      torque at `angularAccel` toward the shift+mouse aim cursor (with
//      brake-distance check to avoid overshoot), capped at `maxAngVel`. With
//      no aim signal the helm bleeds angVel to 0 via the same torque budget.
//   2. Player weapon charge + auto-fire when target in arc + range
//   3. Per-enemy AI — picks a desired thrust direction (close / strafe / back
//      relative to maintainRange), applies thrust with the same physics as
//      the player; heading torques toward the player's bearing.
//   4. Per-enemy weapon charge + auto-fire
//   5. Projectile motion + collision -> damage application against any enemy
//   6. Flux dissipation (player + each enemy)
//   7. Resolution check (player hull <= 0 -> defeat; no enemies left -> victory)
//
// State lives in:
//   - Ship trait on the player flagship (in playerShipInterior world)
//   - One CombatShipState trait per ship in the engagement (player + enemies; same world)
//     The player's CombatShipState is attached to the flagship entity
//     at startCombat and stripped at endCombat. `isPlayer:true` flags it.
//   - Module-local projectile pool (in-memory only, transient)
//   - useCombatStore (UI state: open/paused/selectedMount/flash)

import type { World } from 'koota'
import type { Entity } from 'koota'
import { create } from 'zustand'
import {
  Ship, WeaponMount, CombatShipState, EntityKey, IsPlayer, Money,
  EnemyAI, Flags, IsFlagshipMark, IsInActiveFleet,
} from '../ecs/traits'
import { formationOffsetForSlot } from './fleetFormation'
import { getEnemyShip } from '../data/enemyShips'
import { getShipClass } from '../data/ship-classes'
import { getWeapon, type WeaponDef } from '../data/weapons'
import { useClock } from '../sim/clock'
import { setInCombat, damageHull, drainCR, getFlagshipEntity } from '../sim/ship'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { emitSim, onSim } from '../sim/events'
import { migratePlayerToScene } from '../sim/scene'
import { getAirportPlacement } from '../sim/airportPlacements'
import { pushCombatLog, useCombatLog } from '../sim/combatLog'
import { combatConfig, cockpitConfig, fleetConfig } from '../config'
import {
  onMsDestroyed, resetCockpitForEndCombat, onCombatStarted,
} from '../sim/cockpit'
import { useBrig, clearBrigPendingTally, getBrigOccupancy } from '../sim/brig'
import { getSpecialNpcById } from '../character/specialNpcs'

function logEvent(textZh: string): void {
  emitSim('log', { textZh, atMs: useClock.getState().gameDate.getTime() })
}

const SHIP_SCENE_ID = 'playerShipInterior'

// Tactical arena is a fixed 1000x600 unit box; player spawns left-of-center,
// enemies fan out on the right. Ship positions are in arena units.
export const ARENA_W = 1000
export const ARENA_H = 600
// Arena edge padding (unit). Ships are clamped to [pad, ARENA-pad]; the value
// matches the maximum hull radius at this scale so the sprite never visually
// clips through the arena wall.
const ARENA_EDGE_PAD = 20
const PLAYER_SPAWN = { x: 250, y: 300 }
const ENEMY_FORMATION_CENTER = { x: 750, y: 300 }
const ENEMY_FORMATION_SPACING = 90

interface ProjectileSnap {
  id: number
  ownerSide: 'player' | 'enemy'
  weaponId: string
  x: number
  y: number
  vx: number
  vy: number
  rangeRemaining: number
}

// Transient visual record for an instant-hit beam shot — the renderer
// draws a fading line for the duration of `lifetimeMs`. Without this,
// beams resolve instantly and the only feedback is the flash banner.
export interface BeamFlash {
  id: number
  ownerSide: 'player' | 'enemy'
  from: { x: number; y: number }
  to: { x: number; y: number }
  ageMs: number
  lifetimeMs: number
}
const BEAM_FLASH_LIFETIME_MS = 220
const beamFlashes: BeamFlash[] = []
let nextBeamId = 1

export function getBeamFlashes(): BeamFlash[] {
  return beamFlashes.slice()
}

// per-active-scene only: combat runs exclusively in the playerShipInterior
// world; only one tactical encounter exists at any time. Module-level
// projectile pool + id seed are safe — there's no second concurrent combat
// to keep separate state for. (combatSystem itself takes a `world` argument
// but doesn't use it — it always reads/writes the SHIP_SCENE_ID world.)
let nextProjectileId = 1
const projectiles: ProjectileSnap[] = []

// Campaign-world EntityKey of the enemy that triggered the engagement —
// stored so endCombat('victory') can destroy it (otherwise the same
// pirate re-prompts engagement after the cooldown expires).
let activeCampaignEnemyKey: string | null = null

// Narrowed tactical auto-pause set — Phase 6.0 (per Design/combat.md +
// Design/post-combat.md): first-contact (handled in startCombat) + the
// flagship hull threshold crossings here. Tracks the lowest threshold
// already triggered so we don't re-pause as hull oscillates inside a
// band. Reset on startCombat.
let flagshipThresholdsHit: number[] = []
function pauseTactical(reasonZh: string, severity: 'warn' | 'crit' = 'crit'): void {
  const store = useCombatStore.getState()
  if (!store.paused) store.togglePause()
  pushCombatLog(reasonZh, severity)
}

// Default player spatial state when no CombatShipState exists yet (combat
// not open) — UI snapshot helpers fall back to these so they never throw.
const PLAYER_FALLBACK_POS = { x: 0, y: 0 }

export function getCombatPlayerPos(): { x: number; y: number } {
  const e = getPlayerCombatShip()
  if (!e) return { ...PLAYER_FALLBACK_POS }
  const cs = e.get(CombatShipState)!
  return { x: cs.pos.x, y: cs.pos.y }
}

export function getCombatPlayerHeading(): number {
  const e = getPlayerCombatShip()
  if (!e) return 0
  return e.get(CombatShipState)!.heading
}

interface CombatState {
  open: boolean
  paused: boolean
  selectedMountIdx: number | null
  // Recent flash banner (e.g. weapon hit)
  lastFlashZh: string
  lastFlashAtMs: number
  // Starsector-shape direct control. WASD drives `inputAxis` in the
  // ship's local frame: forward = W/S along heading, strafe = A/D
  // perpendicular. Each component is clamped to [-1, 1]; the combat
  // tick normalizes diagonals before applying topSpeed.
  inputAxis: { forward: number; strafe: number }
  // When `aimAtMouse` is true (shift held) and `aimMouse` is set,
  // the heading rotates toward the cursor. Otherwise the helm holds
  // its current orientation — the helm never auto-aims at the enemy.
  aimAtMouse: boolean
  aimMouse: { x: number; y: number } | null
  setOpen: (open: boolean) => void
  togglePause: () => void
  setSelectedMount: (idx: number | null) => void
  setInputAxis: (axis: { forward: number; strafe: number }) => void
  setAimAtMouse: (on: boolean) => void
  setAimMouse: (m: { x: number; y: number } | null) => void
  flash: (textZh: string) => void
  reset: () => void
  // Snapshot of projectiles — UI reads this each render. Not persisted
  // anywhere; combat is transient by design.
  getProjectiles: () => ProjectileSnap[]
}

export const useCombatStore = create<CombatState>((set) => ({
  open: false,
  paused: true,
  selectedMountIdx: null,
  lastFlashZh: '',
  lastFlashAtMs: 0,
  inputAxis: { forward: 0, strafe: 0 },
  aimAtMouse: false,
  aimMouse: null,
  setOpen: (open) => set({ open }),
  togglePause: () => set((s) => {
    const next = !s.paused
    useClock.getState().setSpeed(next ? 0 : 1)
    return { paused: next }
  }),
  setSelectedMount: (selectedMountIdx) => set({ selectedMountIdx }),
  setInputAxis: (inputAxis) => set({ inputAxis }),
  setAimAtMouse: (aimAtMouse) => set({ aimAtMouse }),
  setAimMouse: (aimMouse) => set({ aimMouse }),
  flash: (lastFlashZh) => set({ lastFlashZh, lastFlashAtMs: performance.now() }),
  reset: () => set({
    open: false,
    paused: true,
    selectedMountIdx: null,
    lastFlashZh: '',
    lastFlashAtMs: 0,
    inputAxis: { forward: 0, strafe: 0 },
    aimAtMouse: false,
    aimMouse: null,
  }),
  getProjectiles: () => projectiles.slice(),
}))

// Phase 6.1 — sim/cockpit emits this when launching, docking, taking
// the helm, or leaving the bridge. Combat owns useCombatStore.open so
// the cockpit module (which is sim-layer) can't reach in directly.
onSim('combat:set-overlay-open', ({ open }) => {
  const store = useCombatStore.getState()
  if (store.open !== open) store.setOpen(open)
})

function shipWorld(): World {
  return getWorld(SHIP_SCENE_ID)
}

function getPlayerShip(): Entity | undefined {
  return shipWorld().queryFirst(Ship, IsFlagshipMark)
}

// The flagship's CombatShipState row (legacy `isPlayer` discriminator).
// There is exactly one in a well-formed engagement; returns undefined
// when combat isn't open.
function getPlayerCombatShip(): Entity | undefined {
  for (const e of shipWorld().query(CombatShipState)) {
    const cs = e.get(CombatShipState)!
    if (cs.isFlagship || cs.isPlayer) return e
  }
  return undefined
}

// All player-side CombatShipState rows (Phase 6.1+: flagship + any
// active MS).
function getPlayerSideEntities(): Entity[] {
  const out: Entity[] = []
  for (const e of shipWorld().query(CombatShipState)) {
    const cs = e.get(CombatShipState)!
    if (cs.side === 'player' || cs.isFlagship || cs.isPlayer) out.push(e)
  }
  return out
}

// All hostile CombatShipState rows.
function getEnemyEntities(): Entity[] {
  const out: Entity[] = []
  for (const e of shipWorld().query(CombatShipState)) {
    const cs = e.get(CombatShipState)!
    if (cs.side === 'enemy' && !cs.isFlagship && !cs.isPlayer) out.push(e)
  }
  return out
}

function findPlayer(): Entity | undefined {
  for (const id of SCENE_IDS) {
    const e = getWorld(id).queryFirst(IsPlayer)
    if (e) return e
  }
  return undefined
}

// Compute the formation slot for the i-th enemy in a fleet of `total`
// ships. Slot 0 sits at the formation center (lead ship); the rest fan
// out vertically on alternating sides for visual readability.
function enemySpawnSlot(idx: number, total: number): { x: number; y: number } {
  if (total <= 1 || idx === 0) {
    return { x: ENEMY_FORMATION_CENTER.x, y: ENEMY_FORMATION_CENTER.y }
  }
  const offsetIdx = Math.ceil(idx / 2)
  const sign = idx % 2 === 1 ? -1 : 1
  return {
    x: ENEMY_FORMATION_CENTER.x + (offsetIdx % 2 === 0 ? -40 : 40),
    y: ENEMY_FORMATION_CENTER.y + sign * offsetIdx * ENEMY_FORMATION_SPACING,
  }
}

function spawnEnemyShip(
  w: World,
  blueprintId: string,
  slotIdx: number,
  totalSlots: number,
  captainId: string,
): void {
  const blueprint = getEnemyShip(blueprintId)
  const spawn = enemySpawnSlot(slotIdx, totalSlots)
  w.spawn(
    CombatShipState({
      shipClassId: blueprint.id,
      nameZh: blueprint.nameZh,
      captainId,
      side: 'enemy',
      isFlagship: false,
      isMs: false,
      pilotedByPlayer: false,
      isPlayer: false,
      pos: { x: spawn.x, y: spawn.y },
      vel: { x: 0, y: 0 },
      heading: Math.PI,    // facing -x toward player
      angVel: 0,
      hullCurrent: blueprint.hullMax, hullMax: blueprint.hullMax,
      armorCurrent: blueprint.armorMax, armorMax: blueprint.armorMax,
      fluxMax: blueprint.fluxMax, fluxCurrent: 0, fluxDissipation: blueprint.fluxDissipation,
      hasShield: blueprint.hasShield,
      shieldEfficiency: blueprint.shieldEfficiency,
      shieldUp: blueprint.hasShield,
      topSpeed: blueprint.topSpeed,
      accel: blueprint.accel,
      decel: blueprint.decel,
      angularAccel: blueprint.angularAccel,
      maxAngVel: blueprint.maxAngVel,
      weapons: blueprint.defaultWeapons.map((id, i) => ({
        weaponId: id,
        size: blueprint.mounts[i].size,
        firingArcRad: (blueprint.mounts[i].firingArcDeg * Math.PI) / 180,
        facingRad: (blueprint.mounts[i].facingDeg * Math.PI) / 180,
        chargeSec: 0,
        ready: false,
      })),
      ai: {
        aggression: blueprint.ai.aggression,
        retreatThreshold: blueprint.ai.retreatThresholdPct,
        maintainRange: blueprint.ai.maintainRange,
      },
    }),
    EntityKey({ key: `enemy-ship-${slotIdx}` }),
  )
}

// Phase 6.2.E2 — spawn a non-flagship CombatShipState for every
// IsInActiveFleet ship at this tactical engagement. The flagship's
// own CombatShipState is created by startCombat directly (sits on the
// persistent flagship entity); these escorts are transient like enemy
// rows — destroyed at endCombat. They use:
//   - shipClass topSpeed / accel / decel / angularAccel / maxAngVel
//   - shipClass hullMax / armorMax as combat-time gauge (independent of
//     the long-arc Ship trait — escort tactical damage clears at
//     endCombat, matching the same Phase 6.1 pre-6.2.B pattern enemy
//     rows used. Persistent damage on non-flagship hulls lands when
//     the combat-loop wires their post-fight state back into Ship —
//     out of scope for E2.)
//   - shipClass defaultWeapons → inline weapons array (same shape as
//     enemy rows; the existing per-ship weapon firing loop already
//     supports player-side non-flagship + non-MS shooters via the
//     `else if (psState.isFlagship === false && psState.isMs === false)`
//     branch added in this slice — see below.)
//   - position at flagship's PLAYER_SPAWN + formation slot offset.
function spawnActiveFleetEscorts(w: World): void {
  for (const e of w.query(Ship, IsInActiveFleet, EntityKey)) {
    if (e.has(IsFlagshipMark)) continue
    if (e.has(CombatShipState)) continue
    const s = e.get(Ship)!
    // Skip ships currently in cross-POI transit — they're not at the
    // engagement site.
    if (s.transitDestinationId) continue
    const cls = getShipClass(s.templateId)
    const offset = formationOffsetForSlot(s.formationSlot)
    const pos = offset
      ? { x: PLAYER_SPAWN.x + offset.dx, y: PLAYER_SPAWN.y + offset.dy }
      : { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y }
    const aggLvl = fleetConfig.aggressionLevels.find((a) => a.id === s.aggression)
    const aiAggression = aggLvl?.aiAggression ?? cls.ai.aggression
    // Attach CombatShipState to the existing Ship entity (matches the
    // flagship pattern) so the long-arc fleet entity stays alive at
    // endCombat — we then just remove the trait, not destroy the entity.
    e.add(CombatShipState({
      shipClassId: cls.id,
      nameZh: cls.nameZh,
      captainId: '',
      side: 'player',
      isFlagship: false,
      isMs: false,
      pilotedByPlayer: false,
      isPlayer: false,
      pos,
      vel: { x: 0, y: 0 },
      heading: 0,
      angVel: 0,
      hullCurrent: cls.hullMax, hullMax: cls.hullMax,
      armorCurrent: cls.armorMax, armorMax: cls.armorMax,
      fluxMax: cls.fluxMax, fluxCurrent: 0, fluxDissipation: cls.fluxDissipation,
      hasShield: cls.hasShield,
      shieldEfficiency: cls.shieldEfficiency,
      shieldUp: cls.hasShield,
      topSpeed: cls.topSpeed,
      accel: cls.accel,
      decel: cls.decel,
      angularAccel: cls.angularAccel,
      maxAngVel: cls.maxAngVel,
      weapons: cls.defaultWeapons.map((id, i) => ({
        weaponId: id,
        size: cls.mounts[i].size,
        firingArcRad: (cls.mounts[i].firingArcDeg * Math.PI) / 180,
        facingRad: (cls.mounts[i].facingDeg * Math.PI) / 180,
        chargeSec: 0,
        ready: false,
      })),
      ai: {
        aggression: aiAggression,
        retreatThreshold: cls.ai.retreatThresholdPct,
        maintainRange: cls.ai.maintainRange,
      },
    }))
  }
}

export function startCombat(
  leadShipId: string,
  escortShipIds: string[] = [],
  campaignEnemyKey?: string | null,
  notableCaptains: Record<string, string> = {},
): void {
  const w = shipWorld()

  // Strip prior combat state. Enemies and stale player MS are transient
  // → destroy. The flagship + Phase 6.2.E2 active-fleet escort
  // CombatShipState rows ride on persistent Ship entities → just
  // remove the trait so the entity (and its long-arc Ship state)
  // survives.
  for (const e of w.query(CombatShipState)) {
    const cs = e.get(CombatShipState)!
    if (cs.isFlagship || cs.isPlayer) e.remove(CombatShipState)
    else if (cs.side === 'player' && e.has(Ship)) e.remove(CombatShipState)
    else e.destroy()
  }
  projectiles.length = 0
  activeCampaignEnemyKey = campaignEnemyKey ?? null

  const ship = getPlayerShip()
  if (ship) {
    const s = ship.get(Ship)!
    // Phase 6.2.B — persistent fleet damage. Flux still clears between
    // encounters (capacitor reset), but armor + hull persist until the
    // hangar repair pipeline restores them. The pre-6.2.B armor-regens-
    // between-fights pattern made damage evaporate on dock and made the
    // Hangar.repair-priority verb unnecessary to demo.
    ship.set(Ship, {
      ...s,
      fluxCurrent: 0,
    })
    // Attach a CombatShipState to the player ship — same trait shape as
    // enemies. Spatial fields seed at the player spawn; combat stat
    // fields (hull/armor/flux/weapons) stay zero/empty here because
    // damage routes through the Ship trait + WeaponMount entities,
    // not this trait. ai is sourced from the player ship class.
    const cls = getShipClass(s.templateId)
    ship.add(CombatShipState({
      shipClassId: cls.id,
      nameZh: cls.nameZh,
      captainId: '',
      side: 'player',
      isFlagship: true,
      isMs: false,
      // Player starts at the helm by default — onCombatStarted() below
      // also flips useCockpit.piloting to 'flagship'.
      pilotedByPlayer: true,
      isPlayer: true,
      pos: { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y },
      vel: { x: 0, y: 0 },
      heading: 0,    // facing +x toward enemy spawn
      angVel: 0,
      hullCurrent: 0, hullMax: 0,
      armorCurrent: 0, armorMax: 0,
      fluxMax: 0, fluxCurrent: 0, fluxDissipation: 0,
      hasShield: false,
      shieldEfficiency: 1,
      shieldUp: false,
      topSpeed: cls.topSpeed,
      accel: cls.accel,
      decel: cls.decel,
      angularAccel: cls.angularAccel,
      maxAngVel: cls.maxAngVel,
      weapons: [],
      ai: {
        aggression: cls.ai.aggression,
        retreatThreshold: cls.ai.retreatThresholdPct,
        maintainRange: cls.ai.maintainRange,
      },
    }))
  }

  const fleet = [leadShipId, ...escortShipIds]
  fleet.forEach((id, slotIdx) => {
    const captainId = notableCaptains[String(slotIdx)] ?? ''
    spawnEnemyShip(w, id, slotIdx, fleet.length, captainId)
  })

  // Phase 6.2.E2 — spawn a non-flagship CombatShipState row for each
  // active-fleet escort. They participate in tactical: have armor +
  // hull + weapons (can be targeted and can fire); station-keep at
  // flagshipPos + formation slot offset; AI uses the same shipClass
  // maintainRange directive enemies use. The cs.ai.aggression is
  // mapped from the war-room aggression slider so cautious/steady/
  // aggressive doctrine actually reads through.
  spawnActiveFleetEscorts(w)

  setInCombat(true)
  useClock.getState().setMode('combat')
  useClock.getState().setSpeed(0)
  useCombatStore.getState().reset()
  useCombatStore.getState().setOpen(true)
  // Fresh engagement → fresh combat log + threshold tracking. The first
  // entry is the auto-paused first-contact briefing.
  useCombatLog.getState().clear()
  flagshipThresholdsHit = []
  // Phase 6.2 — drop the per-fight captured queue so this engagement's
  // tally only lists POWs taken this fight (not cumulative across a
  // multi-engagement session).
  clearBrigPendingTally()
  const leadName = getEnemyShip(leadShipId).nameZh
  const fleetNote = fleet.length > 1 ? ` · 队伍 ${fleet.length} 艘` : ''
  logEvent(`战斗开始 · 对手: ${leadName}${fleetNote}`)
  pushCombatLog(`首次接触 · ${leadName}${fleetNote}`, 'crit')
  // Phase 6.2 — surface the named lead in the log on first contact so
  // the player knows who they're up against from the start (the rumor
  // becomes a face in the post-combat tally if they capture).
  const leadCaptainId = notableCaptains['0']
  if (leadCaptainId) {
    const npc = getSpecialNpcById(leadCaptainId)
    if (npc) {
      pushCombatLog(`敌方旗舰 · ${npc.name}${npc.title ? ` (${npc.title})` : ''}`, 'crit')
    }
  }
  onCombatStarted()
}

export type CombatOutcome = 'victory' | 'defeat' | 'flee'

// Flee penalties — Starsector "you can't run for free" feel.
// Hull lands the bigger hit; armor depletes (regenerates between
// encounters); CR drains heavily so back-to-back flees stack.
const FLEE_HULL_LOSS_PCT = 0.35
const FLEE_CR_DRAIN = 50

// Defeat: stripped to the survivor floor. Money goes to a small
// rescue-stipend amount; the player has to ground-game back into a
// new ship.
const DEFEAT_SURVIVOR_MONEY = 200

// Ground scenes the rescue transport might drop a defeated player at,
// alongside the POI that scene's port maps to (used to keep ship state
// internally consistent should the player re-acquire a ship later).
const DEFEAT_DROP_OPTIONS: { sceneId: 'vonBraunCity' | 'zumCity'; airportHubId: string; poiId: string }[] = [
  { sceneId: 'vonBraunCity', airportHubId: 'vonBraunCityAirport', poiId: 'vonBraun' },
  { sceneId: 'zumCity',   airportHubId: 'zumCityAirport',   poiId: 'side3' },
]

// Phase 6.2 — handle named-hostile bookkeeping at the moment an enemy
// ship's hull crosses zero. If the destroyed ship has a pinned captain
// (captainId on its CombatShipState row) and the player's brig has a
// free slot, route the named NPC to the brig and push a "captured"
// log line. Otherwise — full brig or anonymous ship — just announce
// the death with name + "killed in action" framing.
//
// Anonymous ships (no captainId) push no extra log line here; the
// generic "击毁敌舰" line lives at the caller alongside the destroy()
// call.
function onEnemyDestroyed(ent: Entity): void {
  const cs = ent.get(CombatShipState)
  if (!cs) return
  const npcId = cs.captainId
  if (!npcId) return
  const npc = getSpecialNpcById(npcId)
  if (!npc) return

  const cap = getBrigOccupancy().capacity
  const occ = getBrigOccupancy().occupied
  const fits = cap > 0 && occ < cap

  if (fits) {
    const ok = useBrig.getState().add({
      id: npcId,
      nameZh: npc.name,
      titleZh: npc.title,
      contextZh: npc.contextZh ?? npc.title ?? '',
      factionId: npc.factionRole?.faction ?? 'pirate',
      capturedAtMs: performance.now(),
    })
    if (ok) {
      pushCombatLog(`俘获 · ${npc.name}${npc.title ? ` (${npc.title})` : ''}`, 'narr')
      return
    }
  }
  // Brig full or duplicate id — named hostile dies. Surfaces as a crit
  // log line so the player sees who they killed.
  pushCombatLog(`击毙 · ${npc.name}${npc.title ? ` (${npc.title})` : ''}`, 'crit')
}

function destroyCampaignEnemyByKey(key: string): void {
  const space = getWorld('spaceCampaign')
  for (const e of space.query(EnemyAI, EntityKey)) {
    if (e.get(EntityKey)!.key === key) {
      e.destroy()
      return
    }
  }
}

// Public so the engagement modal's flee choice (which closes the modal
// without entering combat) shares one penalty path with in-combat retreat.
export function applyFleePenalty(): void {
  const ship = getPlayerShip()
  if (!ship) return
  const s = ship.get(Ship)!
  const hullLoss = Math.floor(s.hullCurrent * FLEE_HULL_LOSS_PCT)
  ship.set(Ship, {
    ...s,
    hullCurrent: Math.max(1, s.hullCurrent - hullLoss),
    armorCurrent: 0,
  })
  drainCR(FLEE_CR_DRAIN)
  logEvent(`脱离接触 · 船体受创 -${hullLoss} · 战备 -${FLEE_CR_DRAIN}`)
}

function applyDefeatConsequence(): void {
  // Pick a random ground colony (rescue transport drop-off).
  const drop = DEFEAT_DROP_OPTIONS[Math.floor(Math.random() * DEFEAT_DROP_OPTIONS.length)]

  // Reset the flagship to factory-fresh state so a re-acquired ship
  // starts clean. The owned-flag flip below means the player can't board
  // it until they re-buy from the dealer.
  const ship = getFlagshipEntity()
  if (ship) {
    const s = ship.get(Ship)!
    const cls = getShipClass(s.templateId)
    ship.set(Ship, {
      ...s,
      hullCurrent: cls.hullMax,
      armorCurrent: cls.armorMax,
      fluxCurrent: 0,
      crCurrent: cls.crMax,
      fuelCurrent: cls.fuelMax,
      suppliesCurrent: cls.suppliesMax,
      dockedAtPoiId: drop.poiId,
      inCombat: false,
    })
  }

  // Strip ship ownership + everything in the player's pockets bar a
  // survivor stipend. Other progression (skills, perks, relationships,
  // ambitions) survives — the run continues.
  const player = findPlayer()
  if (player) {
    player.set(Money, { amount: DEFEAT_SURVIVOR_MONEY })
    const f = player.get(Flags)
    if (f) {
      player.set(Flags, { flags: { ...f.flags, shipOwned: false } })
    }
  }

  // Drop the player at the rescue colony's airport arrival tile if the
  // procgen registry knows it, otherwise the scene's declared spawn tile.
  const placement = getAirportPlacement(drop.airportHubId)
  const arrival = placement
    ? { x: placement.arrivalPx.x, y: placement.arrivalPx.y }
    : { x: 20 * 20, y: 50 * 20 }   // vonBraunCity spawn fallback in tile px (TILE=20)
  migratePlayerToScene(drop.sceneId, arrival)

  emitSim('toast', { textZh: '飞船被毁 · 救援运输船把你丢在了另一颗殖民地' })
  logEvent(`战斗失败 · 飞船与船员尽失 · 流落 ${drop.sceneId === 'vonBraunCity' ? '冯·布劳恩' : '祖姆市'}`)
}

export function endCombat(outcome: CombatOutcome): void {
  const w = shipWorld()
  // Three-way split per CombatShipState owner:
  //   - flagship row sits on the persistent flagship Ship entity →
  //     just remove the trait.
  //   - Phase 6.2.E2 active-fleet escort rows sit on persistent Ship
  //     entities (Ship+IsInActiveFleet, not flagship) → also just
  //     remove the trait so the entity survives.
  //   - everything else (enemies, transient player MS) → destroy.
  for (const e of w.query(CombatShipState)) {
    const cs = e.get(CombatShipState)!
    if (cs.isFlagship || cs.isPlayer) e.remove(CombatShipState)
    else if (cs.side === 'player' && e.has(Ship)) e.remove(CombatShipState)
    else e.destroy()
  }
  projectiles.length = 0
  beamFlashes.length = 0

  // Reset player weapon charge so a follow-up encounter starts cold.
  for (const e of w.query(WeaponMount)) {
    const m = e.get(WeaponMount)!
    e.set(WeaponMount, { ...m, chargeSec: 0, ready: false })
  }

  setInCombat(false)
  useClock.getState().setMode('normal')
  useClock.getState().setSpeed(1)
  useCombatStore.getState().reset()
  resetCockpitForEndCombat()

  const campaignKey = activeCampaignEnemyKey
  activeCampaignEnemyKey = null

  if (outcome === 'victory') {
    if (campaignKey) destroyCampaignEnemyByKey(campaignKey)
    // Phase 6.0 tally minimum — credits + supplies + fuel deltas.
    const creditsRange = combatConfig.tallyCreditsMax - combatConfig.tallyCreditsMin
    const reward = combatConfig.tallyCreditsMin + Math.floor(Math.random() * (creditsRange + 1))
    const supplyGain = combatConfig.tallySuppliesGain
    const fuelGain = combatConfig.tallyFuelGain
    const player = findPlayer()
    let creditsAfter = 0
    if (player) {
      const m = player.get(Money) ?? { amount: 0 }
      creditsAfter = m.amount + reward
      player.set(Money, { amount: creditsAfter })
    }
    // Replenish the flagship's supplies + fuel — capped at max.
    const playerShip = getFlagshipEntity()
    let suppliesAfter = 0, suppliesMax = 0, fuelAfter = 0, fuelMax = 0
    if (playerShip) {
      const s = playerShip.get(Ship)!
      suppliesMax = s.suppliesMax
      fuelMax = s.fuelMax
      suppliesAfter = Math.min(s.suppliesMax, s.suppliesCurrent + supplyGain)
      fuelAfter = Math.min(s.fuelMax, s.fuelCurrent + fuelGain)
      playerShip.set(Ship, {
        ...s,
        suppliesCurrent: suppliesAfter,
        fuelCurrent: fuelAfter,
      })
    }
    logEvent(`战斗胜利 · 缴获 ¥${reward}`)
    pushCombatLog(`战斗胜利 · 缴获 ¥${reward}`, 'narr')
    // Phase 6.2 — named POWs captured this fight + current brig
    // occupancy. The brig store's pendingTally was wiped at
    // startCombat; it now holds whoever ended up here as a result of
    // notable-hostile capture in onEnemyDestroyed().
    const capturedPows = useBrig.getState().pendingTally.map((p) => ({
      id: p.id,
      nameZh: p.nameZh,
      titleZh: p.titleZh,
      contextZh: p.contextZh,
    }))
    const { occupied: brigOccupied, capacity: brigCapacity } = getBrigOccupancy()
    emitSim('ui:open-combat-tally', {
      creditsDelta: reward,
      creditsAfter,
      suppliesDelta: supplyGain,
      suppliesAfter,
      suppliesMax,
      fuelDelta: fuelGain,
      fuelAfter,
      fuelMax,
      capturedPows,
      brigOccupied,
      brigCapacity,
    })
  } else if (outcome === 'defeat') {
    applyDefeatConsequence()
  } else {
    applyFleePenalty()
  }
}

// Damage routing on a specific enemy. Shields-up: incoming damage builds
// flux (proportional to shieldEfficiency). Once flux maxes, shields drop
// and the next hit eats armor + hull. Returns {destroyed} so callers can
// clean up the entity when the hit finishes the ship.
function applyDamageToEnemy(
  enemyEnt: Entity,
  weapon: WeaponDef,
): { absorbed: boolean; destroyed: boolean } {
  const e = enemyEnt.get(CombatShipState)!
  let { fluxCurrent, fluxMax, shieldEfficiency, shieldUp } = e
  let armorCurrent = e.armorCurrent
  let hullCurrent = e.hullCurrent

  const damage = weapon.damage
  if (e.hasShield && shieldUp && fluxCurrent < fluxMax) {
    const fluxAdd = damage * weapon.shieldDamage * shieldEfficiency
    fluxCurrent = Math.min(fluxMax, fluxCurrent + fluxAdd)
    if (fluxCurrent >= fluxMax) {
      shieldUp = false   // overload — shields drop until flux vents below 0.5*max
    }
    enemyEnt.set(CombatShipState, { ...e, fluxCurrent, shieldUp })
    return { absorbed: true, destroyed: false }
  }

  // Shields down — armor first, then hull.
  let remaining = damage * weapon.armorDamage
  if (e.armorMax > 0 && armorCurrent > 0) {
    const armorAbsorb = Math.min(armorCurrent, remaining * (armorCurrent / e.armorMax))
    armorCurrent = Math.max(0, armorCurrent - armorAbsorb)
    remaining = Math.max(0, remaining - armorAbsorb)
  }
  hullCurrent = Math.max(0, hullCurrent - remaining)
  enemyEnt.set(CombatShipState, {
    ...e, fluxCurrent, shieldUp, armorCurrent, hullCurrent,
  })
  return { absorbed: false, destroyed: hullCurrent <= 0 }
}

// per-active-scene only: there is exactly one player ship; module-local
// flux/shield model mirrors the enemy structure on the same per-encounter
// scope as projectiles[].
const playerShield = {
  fluxCurrent: 0, shieldUp: true, fluxMax: 0, shieldEfficiency: 1,
  hasShield: false,
}

function refreshPlayerFluxFromShip(ship: Entity): void {
  const s = ship.get(Ship)!
  playerShield.fluxMax = s.fluxMax
  playerShield.shieldEfficiency = s.shieldEfficiency
  playerShield.hasShield = s.hasShield
  // Sync fluxCurrent into the trait so the UI can read it.
  ship.set(Ship, { ...s, fluxCurrent: playerShield.fluxCurrent })
}

function applyDamageToPlayer(weapon: WeaponDef): { absorbed: boolean; destroyed: boolean } {
  const ship = getPlayerShip()
  if (!ship) return { absorbed: false, destroyed: false }
  const s = ship.get(Ship)!
  const damage = weapon.damage

  if (playerShield.hasShield && playerShield.shieldUp && playerShield.fluxCurrent < playerShield.fluxMax) {
    const fluxAdd = damage * weapon.shieldDamage * playerShield.shieldEfficiency
    playerShield.fluxCurrent = Math.min(playerShield.fluxMax, playerShield.fluxCurrent + fluxAdd)
    if (playerShield.fluxCurrent >= playerShield.fluxMax) {
      playerShield.shieldUp = false
    }
    ship.set(Ship, { ...s, fluxCurrent: playerShield.fluxCurrent })
    return { absorbed: true, destroyed: false }
  }

  // Shields down — pipe through sim/ship.ts (handles armor + hull).
  const r = damageHull(damage * weapon.armorDamage)
  return { absorbed: false, destroyed: r.destroyed }
}

// Phase 6.1 — damage to a player MS lands on its own CombatShipState
// hull (no flux/shield model on MS in 6.1; pure armor + hull).
function applyDamageToMs(msEnt: Entity, weapon: WeaponDef): { absorbed: boolean; destroyed: boolean } {
  const m = msEnt.get(CombatShipState)!
  let armorCurrent = m.armorCurrent
  let hullCurrent = m.hullCurrent
  let remaining = weapon.damage * weapon.armorDamage
  if (m.armorMax > 0 && armorCurrent > 0) {
    const armorAbsorb = Math.min(armorCurrent, remaining * (armorCurrent / m.armorMax))
    armorCurrent = Math.max(0, armorCurrent - armorAbsorb)
    remaining = Math.max(0, remaining - armorAbsorb)
  }
  hullCurrent = Math.max(0, hullCurrent - remaining)
  msEnt.set(CombatShipState, { ...m, armorCurrent, hullCurrent })
  return { absorbed: false, destroyed: hullCurrent <= cockpitConfig.msHullEjectFloor }
}

// Phase 6.2.E2 — damage to a non-flagship active-fleet escort. Same
// armor → hull pipeline as enemy ships; flux / shields are skipped
// because escort CombatShipState rows in 6.2.E2 don't carry a per-ship
// flux model (the long-arc ship's fluxMax stays on Ship, not on the
// transient combat row).
function applyDamageToEscort(escortEnt: Entity, weapon: WeaponDef): { absorbed: boolean; destroyed: boolean } {
  const c = escortEnt.get(CombatShipState)!
  let armorCurrent = c.armorCurrent
  let hullCurrent = c.hullCurrent
  let remaining = weapon.damage * weapon.armorDamage
  if (c.armorMax > 0 && armorCurrent > 0) {
    const armorAbsorb = Math.min(armorCurrent, remaining * (armorCurrent / c.armorMax))
    armorCurrent = Math.max(0, armorCurrent - armorAbsorb)
    remaining = Math.max(0, remaining - armorAbsorb)
  }
  hullCurrent = Math.max(0, hullCurrent - remaining)
  escortEnt.set(CombatShipState, { ...c, armorCurrent, hullCurrent })
  return { absorbed: false, destroyed: hullCurrent <= 0 }
}

// Route an incoming hostile hit at one specific player-side target. The
// flagship still routes through the Ship trait via applyDamageToPlayer
// (so fluxes / armor / hull on the persistent trait are correct). MS hits
// route to applyDamageToMs.
function applyDamageToPlayerSide(targetEnt: Entity, weapon: WeaponDef): { absorbed: boolean; destroyed: boolean } {
  const cs = targetEnt.get(CombatShipState)
  if (!cs) return { absorbed: false, destroyed: false }
  if (cs.isMs) return applyDamageToMs(targetEnt, weapon)
  // Phase 6.2.E2 — non-flagship + non-MS player-side rows are active-
  // fleet escorts. Damage lives on the transient CombatShipState row;
  // see applyDamageToEscort for the why (no flux model in 6.2.E2).
  if (!cs.isFlagship && !cs.isPlayer) return applyDamageToEscort(targetEnt, weapon)
  return applyDamageToPlayer(weapon)
}

// Geometry helpers
function angleBetween(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.atan2(to.y - from.y, to.x - from.x)
}

function angleDelta(a: number, b: number): number {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

function inArc(targetAngle: number, mountFacing: number, arcWidth: number): boolean {
  const d = Math.abs(angleDelta(mountFacing, targetAngle))
  return d <= arcWidth / 2
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

// Bang-bang torque controller — drive `angVel` toward a desired heading
// with at most `angularAccel` rad/sec², capped at `maxAngVel`. The
// "brake distance" check (angVel² / 2*angularAccel — angle covered before
// counter-torque can stop the spin) prevents oscillation: when we'd
// otherwise overshoot we apply counter-torque instead. With `desired === null`
// the helm has no aim signal — bleed angVel back to 0 using the same torque.
// Returns the next (heading, angVel) pair.
function steerHeading(
  heading: number,
  angVel: number,
  desired: number | null,
  angularAccel: number,
  maxAngVel: number,
  dt: number,
): { heading: number; angVel: number } {
  let nextAngVel = angVel
  if (desired === null) {
    // Brake angVel toward 0.
    const brake = Math.min(Math.abs(nextAngVel), angularAccel * dt)
    nextAngVel -= Math.sign(nextAngVel) * brake
  } else {
    const err = angleDelta(heading, desired)
    const brakeAngle = (nextAngVel * nextAngVel) / (2 * angularAccel)
    const movingTowardErr = Math.sign(err) === Math.sign(nextAngVel) && nextAngVel !== 0
    if (movingTowardErr && Math.abs(err) <= brakeAngle) {
      // Counter-torque to avoid overshoot.
      nextAngVel -= Math.sign(nextAngVel) * angularAccel * dt
    } else {
      nextAngVel += Math.sign(err) * angularAccel * dt
    }
  }
  if (nextAngVel > maxAngVel) nextAngVel = maxAngVel
  else if (nextAngVel < -maxAngVel) nextAngVel = -maxAngVel
  return { heading: heading + nextAngVel * dt, angVel: nextAngVel }
}

// Newtonian step on a 2D velocity. `thrust` is a unit (or zero) direction
// vector — when non-zero, accelerate vel by `accel * dt` along it; when
// zero, brake vel against its own direction by `decel * dt`. After accel,
// |vel| is clamped to `topSpeed`.
function stepVelocity(
  vel: { x: number; y: number },
  thrust: { x: number; y: number },
  accel: number,
  decel: number,
  topSpeed: number,
  dt: number,
): void {
  const thrustMag = Math.hypot(thrust.x, thrust.y)
  if (thrustMag > 0) {
    const inv = 1 / thrustMag
    vel.x += thrust.x * inv * accel * dt
    vel.y += thrust.y * inv * accel * dt
  } else {
    const speed = Math.hypot(vel.x, vel.y)
    if (speed > 0) {
      const brake = Math.min(speed, decel * dt)
      const k = brake / speed
      vel.x -= vel.x * k
      vel.y -= vel.y * k
    }
  }
  const speed = Math.hypot(vel.x, vel.y)
  if (speed > topSpeed) {
    const k = topSpeed / speed
    vel.x *= k
    vel.y *= k
  }
}

// Spawn a projectile or instant-hit for `weapon` from `from` toward `to`.
// Beams (projectileSpeed === 0) resolve as instant hits at distance check.
// `targetEnt` is the entity being shot at (an enemy ship if ownerSide is
// 'player'; a player-side unit — flagship or MS — if ownerSide is 'enemy').
// Required for beams to disambiguate when multiple targets exist; for
// projectiles it's only used as a hint, projectile collision is geometric.
function fireWeapon(
  ownerSide: 'player' | 'enemy',
  weapon: WeaponDef,
  from: { x: number; y: number },
  to: { x: number; y: number },
  targetEnt: Entity | null,
): void {
  if (weapon.projectileSpeed === 0) {
    // Instant beam — apply damage immediately.
    beamFlashes.push({
      id: nextBeamId++,
      ownerSide,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      ageMs: 0,
      lifetimeMs: BEAM_FLASH_LIFETIME_MS,
    })
    if (ownerSide === 'player') {
      if (!targetEnt) return
      const enemyName = targetEnt.get(CombatShipState)?.nameZh ?? '敌舰'
      const r = applyDamageToEnemy(targetEnt, weapon)
      useCombatStore.getState().flash(
        r.absorbed ? `${weapon.nameZh} → 命中护盾` : `${weapon.nameZh} → 命中船体`,
      )
      if (r.destroyed) {
        pushCombatLog(`击毁敌舰 · ${enemyName}`, 'info')
        onEnemyDestroyed(targetEnt)
        targetEnt.destroy()
        if (getEnemyEntities().length === 0) endCombat('victory')
      }
    } else {
      // Enemy beam — `targetEnt` was picked by the firing routine as the
      // closest player-side unit. Falls back to the flagship if missing.
      const tgt = targetEnt ?? getPlayerCombatShip() ?? null
      const tgtCs = tgt?.get(CombatShipState)
      const r = tgt ? applyDamageToPlayerSide(tgt, weapon) : applyDamageToPlayer(weapon)
      const tgtNameZh = tgtCs?.isMs ? tgtCs.nameZh : '旗舰'
      useCombatStore.getState().flash(
        r.absorbed ? `敌方${weapon.nameZh} → 命中${tgtNameZh}护盾` : `敌方${weapon.nameZh} → 命中${tgtNameZh}船体`,
      )
      if (r.destroyed) {
        if (tgtCs?.isMs) {
          pushCombatLog(`MS 损毁 · ${tgtCs.nameZh}`, 'crit')
          onMsDestroyed()
        } else if (tgtCs && !tgtCs.isFlagship && !tgtCs.isPlayer) {
          // Phase 6.2.E2 — escort destruction. Log + strip the
          // combat row from the persistent Ship entity (don't destroy
          // — the long-arc Ship state survives). Combat continues;
          // the flagship's defeat path is reserved for the flagship's
          // own hull dropping. (Persistent damage write-back from
          // escort tactical damage to Ship.hullCurrent is out of
          // scope for E2 — combat ends with full hull restored,
          // matching pre-6.2.B enemy ship behavior.)
          pushCombatLog(`护卫损毁 · ${tgtCs.nameZh}`, 'crit')
          if (tgt) tgt.remove(CombatShipState)
        } else {
          endCombat('defeat')
        }
      }
    }
    return
  }

  // Projectile-based weapon — spawn a moving body, resolve damage on impact.
  const ang = angleBetween(from, to)
  projectiles.push({
    id: nextProjectileId++,
    ownerSide,
    weaponId: weapon.id,
    x: from.x,
    y: from.y,
    vx: Math.cos(ang) * weapon.projectileSpeed,
    vy: Math.sin(ang) * weapon.projectileSpeed,
    rangeRemaining: weapon.range,
  })
}

function tickProjectiles(dtSec: number): void {
  const ship = getPlayerShip()
  if (!ship) return
  const playerEnt = getPlayerCombatShip()
  if (!playerEnt) return
  // Mutate-in-place + filter pattern.
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]
    p.x += p.vx * dtSec
    p.y += p.vy * dtSec
    const stepDist = Math.hypot(p.vx, p.vy) * dtSec
    p.rangeRemaining -= stepDist
    if (p.rangeRemaining <= 0) { projectiles.splice(i, 1); continue }
    if (p.x < 0 || p.x > ARENA_W || p.y < 0 || p.y > ARENA_H) {
      projectiles.splice(i, 1); continue
    }

    if (p.ownerSide === 'player') {
      // Player projectile — collide with the closest enemy within hit
      // radius. Each enemy's pos is queried fresh per projectile so a
      // ship that just moved last frame still resolves correctly.
      const enemies = getEnemyEntities()
      let hit: Entity | null = null
      for (const e of enemies) {
        const s = e.get(CombatShipState)
        if (!s) continue
        if (dist(p, s.pos) < 12) { hit = e; break }
      }
      if (hit) {
        const weapon = getWeapon(p.weaponId)
        const enemyName = hit.get(CombatShipState)?.nameZh ?? '敌舰'
        const r = applyDamageToEnemy(hit, weapon)
        useCombatStore.getState().flash(
          r.absorbed ? `${weapon.nameZh} → 命中护盾` : `${weapon.nameZh} → 命中船体`,
        )
        projectiles.splice(i, 1)
        if (r.destroyed) {
          pushCombatLog(`击毁敌舰 · ${enemyName}`, 'info')
          onEnemyDestroyed(hit)
          hit.destroy()
          if (getEnemyEntities().length === 0) {
            projectiles.length = 0
            endCombat('victory')
            return
          }
        }
      }
    } else {
      // Enemy projectile — collide with the closest player-side unit
      // within hit radius (Phase 6.1: flagship OR launched MS).
      const playerSide = getPlayerSideEntities()
      let hit: Entity | null = null
      for (const e of playerSide) {
        const s = e.get(CombatShipState)
        if (!s) continue
        if (dist(p, s.pos) < 12) { hit = e; break }
      }
      if (hit) {
        const weapon = getWeapon(p.weaponId)
        const hitCs = hit.get(CombatShipState)!
        const r = applyDamageToPlayerSide(hit, weapon)
        const tgtNameZh = hitCs.isMs ? hitCs.nameZh : '旗舰'
        useCombatStore.getState().flash(
          r.absorbed ? `敌方${weapon.nameZh} → 命中${tgtNameZh}护盾` : `敌方${weapon.nameZh} → 命中${tgtNameZh}船体`,
        )
        projectiles.splice(i, 1)
        if (r.destroyed) {
          if (hitCs.isMs) {
            pushCombatLog(`MS 损毁 · ${hitCs.nameZh}`, 'crit')
            onMsDestroyed()
          } else if (!hitCs.isFlagship && !hitCs.isPlayer) {
            // Phase 6.2.E2 — escort destruction. Same shape as the
            // beam-side branch above (strip the trait, don't destroy
            // the entity).
            pushCombatLog(`护卫损毁 · ${hitCs.nameZh}`, 'crit')
            hit.remove(CombatShipState)
          } else {
            projectiles.length = 0
            endCombat('defeat')
            return
          }
        }
      }
    }
  }
}

export function combatSystem(_world: World, dtMs: number): void {
  const enemies = getEnemyEntities()
  if (enemies.length === 0) return
  const playerEnt = getPlayerCombatShip()
  if (!playerEnt) return
  const store = useCombatStore.getState()
  if (store.paused) return

  const dtSec = dtMs / 1000
  const w = shipWorld()
  const ship = getPlayerShip()
  if (!ship) return

  refreshPlayerFluxFromShip(ship)
  const shipState = ship.get(Ship)!

  // -- 1. Per-ship AI directive + physics (unified) -------------------------
  // Each ship — flagship, MS, and enemies — picks its nearest hostile
  // and runs the same maintainRange-style directive: close in if too far,
  // back away if too close, otherwise strafe. WASD thrust + shift+mouse
  // aim override the AI on whichever ship has `pilotedByPlayer=true`
  // (Phase 6.1: at most one ship at a time — flagship by default; the
  // launched MS while the player is in the cockpit). Releasing input
  // hands the helm back to AI immediately.
  const playerSide = getPlayerSideEntities()
  const allShips: Entity[] = [...playerSide, ...enemies]
  for (const self of allShips) {
    const cs = self.get(CombatShipState)!
    const isPlayerSide = cs.side === 'player' || cs.isFlagship || cs.isPlayer
    const hostiles = isPlayerSide ? enemies : playerSide
    let nearest: Entity | null = null
    let nearestRange = Infinity
    for (const h of hostiles) {
      const hs = h.get(CombatShipState)!
      const r = dist(cs.pos, hs.pos)
      if (r < nearestRange) { nearestRange = r; nearest = h }
    }

    let thrustWorld = { x: 0, y: 0 }
    let aimAngle: number | null = null
    if (nearest) {
      const targetPos = nearest.get(CombatShipState)!.pos
      const toAng = angleBetween(cs.pos, targetPos)
      const range = nearestRange
      const mr = cs.ai.maintainRange
      let moveAng: number
      if (range < mr * 0.85) moveAng = toAng + Math.PI       // back away
      else if (range > mr * 1.15) moveAng = toAng             // close in
      else moveAng = toAng + Math.PI / 2                      // strafe
      thrustWorld = { x: Math.cos(moveAng), y: Math.sin(moveAng) }
      aimAngle = toAng
    }

    if (cs.pilotedByPlayer) {
      // WASD overrides AI thrust whenever any axis is held.
      const axis = store.inputAxis
      const inputLen = Math.hypot(axis.forward, axis.strafe)
      if (inputLen > 0) {
        const fwd = axis.forward / Math.max(1, inputLen)
        const stf = axis.strafe / Math.max(1, inputLen)
        const cosH = Math.cos(cs.heading)
        const sinH = Math.sin(cs.heading)
        // Forward unit = (cosH, sinH); starboard unit = (-sinH, cosH).
        thrustWorld = {
          x: fwd * cosH + stf * -sinH,
          y: fwd * sinH + stf *  cosH,
        }
      }
      // Shift+mouse aim overrides AI aim. Without aim input the AI's
      // "face nearest hostile" directive remains in effect — the helm
      // no longer freezes when the player lets go.
      if (store.aimAtMouse && store.aimMouse) {
        aimAngle = angleBetween(cs.pos, store.aimMouse)
      }
    }

    const vel = { x: cs.vel.x, y: cs.vel.y }
    stepVelocity(vel, thrustWorld, cs.accel, cs.decel, cs.topSpeed, dtSec)
    const pos = { x: cs.pos.x + vel.x * dtSec, y: cs.pos.y + vel.y * dtSec }
    if (pos.x < ARENA_EDGE_PAD) {
      pos.x = ARENA_EDGE_PAD
      if (vel.x < 0) vel.x = 0
    } else if (pos.x > ARENA_W - ARENA_EDGE_PAD) {
      pos.x = ARENA_W - ARENA_EDGE_PAD
      if (vel.x > 0) vel.x = 0
    }
    if (pos.y < ARENA_EDGE_PAD) {
      pos.y = ARENA_EDGE_PAD
      if (vel.y < 0) vel.y = 0
    } else if (pos.y > ARENA_H - ARENA_EDGE_PAD) {
      pos.y = ARENA_H - ARENA_EDGE_PAD
      if (vel.y > 0) vel.y = 0
    }
    const helm = steerHeading(
      cs.heading, cs.angVel, aimAngle,
      cs.angularAccel, cs.maxAngVel, dtSec,
    )
    self.set(CombatShipState, {
      ...cs,
      pos, vel,
      heading: helm.heading,
      angVel: helm.angVel,
    })
  }

  // -- 2. Player flux + shield recovery (Ship-trait fields) -------------
  ship.set(Ship, {
    ...shipState,
    fluxCurrent: Math.max(0, playerShield.fluxCurrent - shipState.fluxDissipation * dtSec),
  })
  playerShield.fluxCurrent = Math.max(0, playerShield.fluxCurrent - shipState.fluxDissipation * dtSec)
  if (
    playerShield.hasShield
    && !playerShield.shieldUp
    && playerShield.fluxCurrent < playerShield.fluxMax * 0.5
  ) {
    playerShield.shieldUp = true
  }

  // Read fresh player pose for weapon-fire arc checks below.
  const playerCsNow = playerEnt.get(CombatShipState)!
  const playerPos = playerCsNow.pos
  const playerHeading = playerCsNow.heading

  // -- 3. Player weapon charge + auto-fire ----------------------------------
  // Each WeaponMount entity picks the closest in-arc, in-range enemy.
  for (const e of w.query(WeaponMount)) {
    const m = e.get(WeaponMount)!
    if (!m.weaponId) continue
    const def = getWeapon(m.weaponId)
    let charge = Math.min(def.chargeSec, m.chargeSec + dtSec)
    let ready = charge >= def.chargeSec
    if (ready) {
      const mountFacing = playerHeading + m.facingRad
      let target: { ent: Entity; pos: { x: number; y: number } } | null = null
      let bestRange = Infinity
      for (const en of enemies) {
        const enemyState = en.get(CombatShipState)
        if (!enemyState) continue
        const range = dist(playerPos, enemyState.pos)
        if (range > def.range) continue
        const ang = angleBetween(playerPos, enemyState.pos)
        if (!inArc(ang, mountFacing, m.firingArcRad)) continue
        if (range < bestRange) {
          bestRange = range
          target = { ent: en, pos: enemyState.pos }
        }
      }
      if (target) {
        fireWeapon('player', def, playerPos, target.pos, target.ent)
        charge = 0
        ready = false
      }
    }
    if (ready !== m.ready || charge !== m.chargeSec) {
      e.set(WeaponMount, { ...m, chargeSec: charge, ready })
    }
  }

  // -- 4. Per-enemy weapon charge + auto-fire (inline weapons array) -------
  // Each enemy targets the closest player-side unit in range — which can
  // be the flagship OR an MS. fireWeapon('enemy', ...) routes damage
  // through applyDamageToTarget against the chosen entity so MS hits
  // land on the MS's own CombatShipState hull, not the flagship's Ship trait.
  for (const enemyEnt of enemies) {
    const e2 = enemyEnt.get(CombatShipState)
    if (!e2) continue
    const enemyPos = e2.pos
    const enemyHeading = e2.heading

    // Pick the closest player-side unit (refresh per-enemy so two
    // enemies in different corners can target different player units).
    let target: { ent: Entity; pos: { x: number; y: number } } | null = null
    let bestRange = Infinity
    for (const ps of playerSide) {
      const psState = ps.get(CombatShipState)!
      const r = dist(enemyPos, psState.pos)
      if (r < bestRange) { bestRange = r; target = { ent: ps, pos: psState.pos } }
    }
    const range = bestRange

    const updatedWeapons = e2.weapons.map((wpn) => {
      const def = getWeapon(wpn.weaponId)
      let charge = Math.min(def.chargeSec, wpn.chargeSec + dtSec * (0.5 + e2.ai.aggression))
      let ready = charge >= def.chargeSec
      if (ready && target && range <= def.range) {
        const mountFacing = enemyHeading + wpn.facingRad
        const angToTarget = angleBetween(enemyPos, target.pos)
        if (inArc(angToTarget, mountFacing, wpn.firingArcRad)) {
          fireWeapon('enemy', def, enemyPos, target.pos, target.ent)
          charge = 0
          ready = false
        }
      }
      return { ...wpn, chargeSec: charge, ready }
    })

    const enemyFlux = Math.max(0, e2.fluxCurrent - e2.fluxDissipation * dtSec)
    let enemyShieldUp = e2.shieldUp
    if (e2.hasShield && !enemyShieldUp && enemyFlux < e2.fluxMax * 0.5) enemyShieldUp = true

    enemyEnt.set(CombatShipState, {
      ...e2,
      weapons: updatedWeapons,
      fluxCurrent: enemyFlux,
      shieldUp: enemyShieldUp,
    })
  }

  // -- 4b. Player MS / active-fleet escort weapon charge + auto-fire ----
  // Phase 6.1 added the MS branch; Phase 6.2.E2 extends to non-flagship
  // active-fleet ships (CombatShipState rows with side='player' +
  // isFlagship=false + isMs=false). Both share the inline weapons array
  // — same closest-in-arc rule as enemies, targeting the nearest
  // hostile. The flagship branch (isFlagship=true) keeps using
  // WeaponMount entities via section 3 above.
  for (const psEnt of playerSide) {
    const psState = psEnt.get(CombatShipState)
    if (!psState) continue
    if (psState.isFlagship || psState.isPlayer) continue
    const msPos = psState.pos
    const msHeading = psState.heading

    let target: { ent: Entity; pos: { x: number; y: number } } | null = null
    let bestRange = Infinity
    for (const en of enemies) {
      const es = en.get(CombatShipState)!
      const r = dist(msPos, es.pos)
      if (r < bestRange) { bestRange = r; target = { ent: en, pos: es.pos } }
    }

    const updatedWeapons = psState.weapons.map((wpn) => {
      const def = getWeapon(wpn.weaponId)
      let charge = Math.min(def.chargeSec, wpn.chargeSec + dtSec)
      let ready = charge >= def.chargeSec
      if (ready && target && bestRange <= def.range) {
        const mountFacing = msHeading + wpn.facingRad
        const angToTarget = angleBetween(msPos, target.pos)
        if (inArc(angToTarget, mountFacing, wpn.firingArcRad)) {
          fireWeapon('player', def, msPos, target.pos, target.ent)
          charge = 0
          ready = false
        }
      }
      return { ...wpn, chargeSec: charge, ready }
    })

    psEnt.set(CombatShipState, { ...psState, weapons: updatedWeapons })
  }

  // -- 5. Projectiles + beam-flash decay -----------------------------------
  tickProjectiles(dtSec)
  for (let i = beamFlashes.length - 1; i >= 0; i--) {
    beamFlashes[i].ageMs += dtMs
    if (beamFlashes[i].ageMs >= beamFlashes[i].lifetimeMs) {
      beamFlashes.splice(i, 1)
    }
  }

  // -- 6. Flagship hull threshold auto-pause (narrowed set, Phase 6.0) ----
  // Crossing 25% or 10% pauses tactical and posts a crit log entry.
  // Each threshold fires at most once per engagement — tracked in
  // flagshipThresholdsHit (reset by startCombat).
  const shipNow = ship.get(Ship)!
  if (shipNow.hullMax > 0) {
    const hullPct = shipNow.hullCurrent / shipNow.hullMax
    for (const pct of combatConfig.flagshipPauseHullPcts) {
      if (hullPct <= pct && !flagshipThresholdsHit.includes(pct)) {
        flagshipThresholdsHit.push(pct)
        pauseTactical(`旗舰船体跌破 ${Math.round(pct * 100)}%`, 'crit')
      }
    }
  }

  // -- 7. Resolution ------------------------------------------------------
  if (shipNow.hullCurrent <= 0) { endCombat('defeat'); return }
  if (getEnemyEntities().length === 0) { endCombat('victory'); return }
}
