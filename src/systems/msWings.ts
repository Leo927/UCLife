// W3 (ms-identity) Task 5 — AI MS wings.
//
// A "wing" is an AI-piloted mobile suit the player launches by bridge order
// (msLaunchAuth). Each wing member is a tactical CombatShipState clone
// (side='player', isMs, pilotedByPlayer=false) built by the SHARED spawner
// sim/cockpit.ts:spawnMsClone from a persistent roster Ms entity. The clone
// is keyed `wing-<rosterKey>` so every per-member resource resolves against
// the member's OWN roster row (drain / ammo / boost / damage-sync), never
// the single getActiveMsRosterKey slot (that slot is the player's launched
// MS only).
//
// This module owns three things:
//   1. Launch authorization — which stored MS are eligible, and spawning
//      their clones (issueMsLaunchAuth in fleetOrders.ts debits CP first).
//   2. The wing-AI directive inputs combat.ts §1 reads per tick: the
//      role-tag target-class preference + the returning-to-dock movement
//      override. Movement/physics stay in combat.ts's one unified loop.
//   3. The threshold-driven resupply state machine (tickWings): a deployed
//      wing whose propellant fraction drops below wingResupplyThresholdPct
//      flies to the flagship, docks through the hangar-door queue, resupplies
//      via the existing sortieResupply path, and relaunches when full.
//
// Perf (CLAUDE.md): tickWings is O(W), W = launched wings (≤ hangar
// capacity, realistic upper bound ~ a handful). Per-wing work is O(1)
// threshold + distance checks plus, at most once per return, an O(D) door
// pick (D = flagship doors). No per-tick pathfinding — the return leg is a
// straight bearing to the flagship. combat.ts §1's per-wing target pick is
// O(H) (H = hostiles), the same scan every unit already runs.

import type { Entity } from 'koota'
import {
  CombatShipState, EntityKey, Ms, MsStatSheet, ResupplyState,
  Ship, IsFlagshipMark,
} from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { getStat } from '../stats/sheet'
import { getMsClass } from '../data/ms'
import { sortieConfig, msConfig } from '../config'
import type { WingTargetPreference } from '../config/ms'
import { spawnMsClone, syncMsCloneToRoster, getActiveMsRosterKey } from '../sim/cockpit'
import {
  requestDock, findHostShipKeyForMs, getDoorSnapshot,
} from '../sim/hangarDoors'
import { pushCombatLog } from '../sim/combatLog'

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

const SHIP_SCENE_ID = 'playerShipInterior'

// Clone-key convention: a wing member's CombatShipState EntityKey is
// `<prefix><rosterKey>`. Centralized so combat.ts's per-member key
// resolution (ammo gate, destruction) reads from one source.
export const WING_CLONE_KEY_PREFIX = 'wing-'

export function wingCloneKey(rosterKey: string): string {
  return `${WING_CLONE_KEY_PREFIX}${rosterKey}`
}

// Roster key backing a wing clone, or '' when the key isn't a wing clone
// (e.g. the player's PLAYER_MS_KEY row, a flagship, an enemy).
export function rosterKeyFromWingCloneKey(cloneKey: string): string {
  return cloneKey.startsWith(WING_CLONE_KEY_PREFIX)
    ? cloneKey.slice(WING_CLONE_KEY_PREFIX.length)
    : ''
}

// Convenience for combat.ts §4b's ammo gate: given a CombatShipState entity,
// return its roster key if it's a wing clone, else ''.
export function msWingRosterKeyForClone(ent: Entity): string {
  const ek = ent.get(EntityKey)
  return ek ? rosterKeyFromWingCloneKey(ek.key) : ''
}

type WingPhase = 'deployed' | 'returning' | 'resupplying'

interface WingMember {
  phase: WingPhase
  targetPreference: WingTargetPreference
}

// rosterKey → wing state. Module-level, transient (combat-only) like the
// CombatShipState rows themselves; reset at startCombat / endCombat.
const wings = new Map<string, WingMember>()

// ── ECS lookups ─────────────────────────────────────────────────────────

function findMsByKey(rosterKey: string): Entity | null {
  const w = getWorld(SHIP_SCENE_ID)
  for (const e of w.query(Ms, EntityKey)) {
    if (e.get(EntityKey)!.key === rosterKey) return e
  }
  return null
}

function findCombatRowByKey(key: string): Entity | null {
  const w = getWorld(SHIP_SCENE_ID)
  for (const e of w.query(CombatShipState, EntityKey)) {
    if (e.get(EntityKey)!.key === key) return e
  }
  return null
}

function flagshipCombatRow(): Entity | null {
  const w = getWorld(SHIP_SCENE_ID)
  for (const e of w.query(CombatShipState)) {
    if (e.get(CombatShipState)!.isFlagship) return e
  }
  return null
}

export function flagshipShipKey(): string {
  const w = getWorld(SHIP_SCENE_ID)
  const fs = w.queryFirst(Ship, IsFlagshipMark, EntityKey)
  return fs ? fs.get(EntityKey)!.key : ''
}

// First hangar door that is genuinely free to start a NEW dock cycle right
// now (idle, unlocked, unoccupied, no queue). Returns null when every door is
// busy. Docking only through an idle door sidesteps hangarDoors' shared
// launch/dock queue (a dock enqueued behind a launch re-arms as a launch and
// never routes to resupply) — the wing simply holds and retries next tick.
function firstFreeDoorId(shipKey: string): string | null {
  for (const d of getDoorSnapshot(shipKey)) {
    if (d.state === 'idle' && d.lockSec === 0 && d.occupiedByMsKey === '' && d.queueLen === 0) {
      return d.doorId
    }
  }
  return null
}

function propellantCap(msEnt: Entity): number {
  const sheet = msEnt.get(MsStatSheet)?.sheet
  if (sheet) return getStat(sheet, 'propellantStorage')
  return getMsClass(msEnt.get(Ms)!.templateId).propellantStorage
}

function roleRow(roleTag: string): { targetPreference: WingTargetPreference; maintainRangeMul: number } {
  const row = msConfig.roleTagAi[roleTag] ?? msConfig.roleTagAi.skirmisher
  return { targetPreference: row.targetPreference, maintainRangeMul: row.maintainRangeMul }
}

// ── Launch authorization ────────────────────────────────────────────────

// Roster MS eligible to launch as a wing right now: stored aboard the
// flagship, pilot-assigned, not already deployed, not mid-resupply, and not
// the player's own launched MS.
function launchableMsEntities(): Entity[] {
  const flagKey = flagshipShipKey()
  if (!flagKey) return []
  const activeKey = getActiveMsRosterKey()
  const out: Entity[] = []
  const w = getWorld(SHIP_SCENE_ID)
  for (const e of w.query(Ms, EntityKey)) {
    const m = e.get(Ms)!
    const key = e.get(EntityKey)!.key
    if (m.storedOnShipKey !== flagKey) continue
    if (!m.pilotId) continue
    if (key === activeKey) continue
    if (wings.has(key)) continue
    if (e.has(ResupplyState)) continue
    out.push(e)
  }
  return out
}

export function countLaunchableWings(): number {
  if (!flagshipCombatRow()) return 0
  return launchableMsEntities().length
}

// Spawn a wing clone for a roster MS and register it. Returns the clone
// entity or null if the shared spawner refused (no flagship combat row).
function spawnWing(rosterKey: string): Entity | null {
  const msEnt = findMsByKey(rosterKey)
  if (!msEnt) return null
  const role = roleRow(msEnt.get(Ms)!.roleTag)
  const ent = spawnMsClone({
    rosterKey,
    cloneKey: wingCloneKey(rosterKey),
    pilotedByPlayer: false,
    maintainRangeMul: role.maintainRangeMul,
  })
  if (!ent) return null
  wings.set(rosterKey, { phase: 'deployed', targetPreference: role.targetPreference })
  return ent
}

// Launch every eligible wing. Called by issueMsLaunchAuth AFTER CP is
// debited. Returns the number of wings launched.
export function launchWings(): number {
  const eligible = launchableMsEntities()
  let launched = 0
  for (const msEnt of eligible) {
    const rosterKey = msEnt.get(EntityKey)!.key
    if (spawnWing(rosterKey)) {
      launched += 1
      pushCombatLog(`僚机出击 · ${msEnt.get(Ms)!.name}`, 'info')
    }
  }
  return launched
}

// ── Wing-AI directive inputs (read by combat.ts §1) ──────────────────────

export function wingTargetPreference(cloneKey: string): WingTargetPreference | null {
  const rosterKey = rosterKeyFromWingCloneKey(cloneKey)
  const wing = wings.get(rosterKey)
  return wing ? wing.targetPreference : null
}

export function isWingReturning(cloneKey: string): boolean {
  const rosterKey = rosterKeyFromWingCloneKey(cloneKey)
  return wings.get(rosterKey)?.phase === 'returning'
}

// ── Destruction ───────────────────────────────────────────────────────────

// A wing clone's hull crossed the eject floor. Write the (zeroed) hull back
// to the roster so the loss persists, unregister, and despawn the clone.
// TODO(Task 7 — ejection with stakes): spawn a pilot pod + run the wing
// pilot's fate roll. For now the pilot NPC survives (EmployedAsPilot stays)
// and the roster MS is left at hull 0 → damageState 'in-repair'.
export function onWingDestroyed(cloneEnt: Entity): void {
  const ek = cloneEnt.get(EntityKey)
  const rosterKey = ek ? rosterKeyFromWingCloneKey(ek.key) : ''
  if (rosterKey) {
    syncMsCloneToRoster(cloneEnt, rosterKey)
    wings.delete(rosterKey)
  }
  cloneEnt.destroy()
}

// ── Resupply state machine (per tick) ─────────────────────────────────────

export function tickWings(dtSec: number): void {
  void dtSec
  if (wings.size === 0) return
  const flagship = flagshipCombatRow()
  if (!flagship) return
  const fpos = flagship.get(CombatShipState)!.pos

  for (const [rosterKey, wing] of wings) {
    const msEnt = findMsByKey(rosterKey)
    if (!msEnt) { wings.delete(rosterKey); continue }
    const m = msEnt.get(Ms)!
    const cap = propellantCap(msEnt)
    const frac = cap > 0 ? m.currentPropellant / cap : 1

    if (wing.phase === 'deployed') {
      if (frac < sortieConfig.wingResupplyThresholdPct) {
        wing.phase = 'returning'
        pushCombatLog(`${m.name} · 推进剂偏低 · 返舰补给`, 'info')
      }
      continue
    }

    if (wing.phase === 'returning') {
      const clone = findCombatRowByKey(wingCloneKey(rosterKey))
      if (!clone) {
        // Clone vanished (e.g. destroyed elsewhere) — drop the wing.
        wings.delete(rosterKey)
        continue
      }
      const cpos = clone.get(CombatShipState)!.pos
      if (dist(cpos, fpos) <= sortieConfig.dockApproachRadiusPx) {
        // Dock through a FREE door, keyed by the ROSTER key so the door-cycle
        // completion (combat.ts §5b) routes THIS MS into resupply. If every
        // door is busy the wing holds at the flagship and retries next tick.
        // Write combat damage back, then despawn the clone; propellant + ammo
        // restore when the door cycle + resupply timer complete.
        const hostKey = findHostShipKeyForMs(rosterKey) || flagshipShipKey() || 'ship'
        const doorId = firstFreeDoorId(hostKey)
        if (!doorId) continue   // no free door yet — keep station, retry
        requestDock(hostKey, rosterKey, doorId)
        syncMsCloneToRoster(clone, rosterKey)
        clone.destroy()
        wing.phase = 'resupplying'
        pushCombatLog(`${m.name} · 入舱补给`, 'info')
      }
      continue
    }

    // 'resupplying' — relaunch once propellant is restored to (near) cap.
    // Between dock and door-cycle completion the roster carries no
    // ResupplyState yet and propellant is still low, so keying the relaunch
    // on "propellant back at cap" (only true after tickResupply completes)
    // avoids that race without inspecting ResupplyState timing.
    if (!msEnt.has(ResupplyState) && frac >= 0.999) {
      const ent = spawnWing(rosterKey)   // re-registers phase='deployed'
      if (ent) pushCombatLog(`${m.name} · 补给完毕 · 再次出击`, 'info')
    }
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

// Write every still-deployed wing's combat damage back to its roster before
// the clones are stripped. Called by endCombat's teardown (mirrors the
// player MS's syncActiveMsToRosterIfLaunched).
export function syncAllWingsToRoster(): void {
  for (const rosterKey of wings.keys()) {
    const clone = findCombatRowByKey(wingCloneKey(rosterKey))
    if (clone) syncMsCloneToRoster(clone, rosterKey)
  }
}

// Clear the registry. Called at startCombat (fresh engagement) and endCombat
// (after syncAllWingsToRoster). The clones themselves are destroyed by the
// combat.ts strip loops (transient side='player' rows with no Ship trait).
export function resetWings(): void {
  wings.clear()
}
