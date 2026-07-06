import json5 from 'json5'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { useScene } from '../sim/scene'
import { spawnNPC, spawnPlayer } from '../character/spawn'
import { applyBackground } from '../character/backgrounds'
import { setSkillXp, type SkillId } from '../character/skills'
import { Faction, EntityKey, Workstation, Job } from '../ecs/traits'
import { bootstrapFactions } from '../ecs/ownership'
import { setSimRngSeed } from '../sim/rng'
import { setSimNow } from '../sim/time'
import { worldConfig, factionsConfig, skillsConfig, fleetConfig, type SkillId as ConfigSkillId, type FactionId } from '../config'
import {
  isCauseId, isTemperamentId, type CauseTags, type TemperamentId,
} from '../config/psychology'
import { isSceneId } from '../data/scenes'
import { isShipClassId, getShipClass } from '../data/ship-classes'
import { isMsClassId } from '../data/ms'
import { isMsWeaponId } from '../data/ms-weapons'
import { isMsFrameModId } from '../data/ms-frame-mods'
import { Ship, IsFlagshipMark, IsInActiveFleet, Owner, PlayerPartsInventory } from '../ecs/traits'
import { MS_ROLE_TAGS, type MsRoleTag } from '../ecs/traits'
import { defaultShipName } from '../data/shipNaming'
import { attachShipStatSheet } from '../ecs/shipEffects'
import { recomputeFleetFuelMax } from '../ecs/fleetPool'
import { seedShipSceneLayout, refreshMsLayout, spawnMsEntity } from '../ecs/spawn'

interface FixtureLocation {
  scene: string
  x: number
  y: number
}

interface FixturePlayer {
  money?: number
  location?: FixtureLocation
  skills?: Record<string, number>
  background?: string
}

interface FixtureFaction {
  id: string
  money?: number
}

interface FixtureShip {
  id: string
  template: string
  name?: string
  dockedAt?: string
  // W1 Task 5 — the fleet flagship. Exactly one ship may set this. When set,
  // the loader seeds the ship-interior layout for its class, tops off the
  // fleet fuel pool, and marks the entity IsFlagshipMark — reproducing the
  // boot state that bootstrapShipScene used to grant. When no ship sets it,
  // ships[0] is marked IsFlagshipMark (interior NOT seeded) for backward compat.
  flagship?: boolean
}

// W1 Task 5 — an MS aboard the flagship or docked at a POI. The starter MS
// is no longer auto-granted at boot, so fixtures that need one (retrofit,
// sortie, roster) pin its frame + key here. Mirrors the Ms trait + the
// getMs / getMsRoster debug-handle vocabulary.
interface FixtureMs {
  key: string
  template: string
  storedOnShip?: string
  bayIndex?: number
  dockedAt?: string
  pilotId?: string
  // Task 9 (W1 playable-loop) — pre-damaged depot MS for the ms-repair
  // smoke. Omitted = full hull (the pre-existing default behavior).
  hullCurrent?: number
  // W3 (ms-identity) Task 5 — wing-AI role tag. Omitted = 'skirmisher'.
  roleTag?: MsRoleTag
}

// W1 Task 5 — the player parts inventory singleton (MS weapons + frame mods).
// Granted with the first hull at runtime; declared explicitly in fixtures.
interface FixtureParts {
  weapons?: Record<string, number>
  frameMods?: Record<string, number>
}

interface FixtureNpc {
  id: string
  name: string
  at: FixtureLocation
  skills?: Record<string, number>
  workstation?: string
  // Phase 7.0.E.4 — faction alignment (sets FactionRole). Defaults to civilian.
  faction?: string
  // Phase 5.3 — pinned psychology (vocabulary mirrors
  // getGameState().getCharacter(id).getPsyche()). Omitted fields fall
  // back to name-seeded procgen.
  temperament?: TemperamentId
  sympathies?: CauseTags
}

interface Fixture {
  seed?: string
  startDate?: string
  scene?: string
  player?: FixturePlayer
  factions?: FixtureFaction[]
  ships?: FixtureShip[]
  ms?: FixtureMs[]
  parts?: FixtureParts
  npcs?: FixtureNpc[]
}

const FIXTURE_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'seed', 'startDate', 'scene', 'player', 'factions', 'ships', 'ms', 'parts', 'npcs',
])
const PLAYER_KEYS: ReadonlySet<string> = new Set([
  'money', 'location', 'skills', 'background',
])
const LOCATION_KEYS: ReadonlySet<string> = new Set(['scene', 'x', 'y'])
const FACTION_KEYS: ReadonlySet<string> = new Set(['id', 'money'])
const SHIP_KEYS: ReadonlySet<string> = new Set(['id', 'template', 'name', 'dockedAt', 'flagship'])
const MS_KEYS: ReadonlySet<string> = new Set([
  'key', 'template', 'storedOnShip', 'bayIndex', 'dockedAt', 'pilotId', 'hullCurrent', 'roleTag',
])
const PARTS_KEYS: ReadonlySet<string> = new Set(['weapons', 'frameMods'])
const NPC_KEYS: ReadonlySet<string> = new Set([
  'id', 'name', 'at', 'skills', 'workstation', 'faction', 'temperament', 'sympathies',
])

const TILE = worldConfig.tilePx
const VALID_FACTION_IDS: ReadonlySet<string> = new Set(Object.keys(factionsConfig.catalog))
const VALID_SKILL_IDS: ReadonlySet<string> = new Set(skillsConfig.order as readonly string[])

// Fixtures auto-register: every tests/fixtures/*.json5 is discovered at build
// time by Vite's import.meta.glob (works under Vitest too). Drop a .json5 in
// that directory and reference it by its filename stem — no edit here needed.
const fixtureModules = import.meta.glob('../../tests/fixtures/*.json5', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const FIXTURES: Record<string, string> = {}
for (const [path, raw] of Object.entries(fixtureModules)) {
  const name = path.split('/').pop()!.replace(/\.json5$/, '')
  FIXTURES[name] = raw
}

export function __registerInlineFixtureForTest(name: string, raw: string): void {
  FIXTURES[name] = raw
}

export function listFixtureNames(): string[] {
  return Object.keys(FIXTURES)
}

function fail(name: string, path: string, msg: string): never {
  throw new Error(`applyFixture(${name}): ${path} ${msg}`)
}

function rejectUnknownKeys(
  name: string, path: string, obj: Record<string, unknown>, allowed: ReadonlySet<string>,
): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      fail(name, `${path}.${k}`, `is not a recognized field (allowed: ${[...allowed].join(', ')})`)
    }
  }
}

function asObject(
  name: string, path: string, v: unknown,
): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    fail(name, path, `must be an object, got ${Array.isArray(v) ? 'array' : typeof v}`)
  }
  return v as Record<string, unknown>
}

function asArray(name: string, path: string, v: unknown): unknown[] {
  if (!Array.isArray(v)) fail(name, path, `must be an array, got ${typeof v}`)
  return v
}

function asString(name: string, path: string, v: unknown): string {
  if (typeof v !== 'string') fail(name, path, `must be a string, got ${typeof v}`)
  return v
}

function asNumber(name: string, path: string, v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    fail(name, path, `must be a finite number, got ${typeof v}`)
  }
  return v
}

function asBoolean(name: string, path: string, v: unknown): boolean {
  if (typeof v !== 'boolean') fail(name, path, `must be a boolean, got ${typeof v}`)
  return v
}

function validatePartCounts(
  name: string, path: string, raw: unknown,
  isValidId: (id: string) => boolean, kindLabel: string,
): Record<string, number> {
  const o = asObject(name, path, raw)
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(o)) {
    if (!isValidId(k)) fail(name, `${path}.${k}`, `is not a known ${kindLabel} id`)
    out[k] = asNumber(name, `${path}.${k}`, v)
  }
  return out
}

function validateLocation(name: string, path: string, raw: unknown): FixtureLocation {
  const o = asObject(name, path, raw)
  rejectUnknownKeys(name, path, o, LOCATION_KEYS)
  const scene = asString(name, `${path}.scene`, o.scene)
  if (!isSceneId(scene)) {
    fail(name, `${path}.scene`, `references unknown scene id "${scene}"`)
  }
  return { scene, x: asNumber(name, `${path}.x`, o.x), y: asNumber(name, `${path}.y`, o.y) }
}

function validateSkills(
  name: string, path: string, raw: unknown,
): Record<string, number> {
  const o = asObject(name, path, raw)
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(o)) {
    if (!VALID_SKILL_IDS.has(k)) {
      fail(name, `${path}.${k}`, `is not a known skill id (see config/skills.json5)`)
    }
    out[k] = asNumber(name, `${path}.${k}`, v)
  }
  return out
}

function validate(name: string, raw: unknown): Fixture {
  const root = asObject(name, 'root', raw)
  rejectUnknownKeys(name, 'root', root, FIXTURE_TOP_LEVEL_KEYS)

  const out: Fixture = {}

  if (root.seed !== undefined) out.seed = asString(name, 'seed', root.seed)
  if (root.startDate !== undefined) {
    const s = asString(name, 'startDate', root.startDate)
    if (Number.isNaN(Date.parse(s))) {
      fail(name, 'startDate', `is not a parseable ISO date string ("${s}")`)
    }
    out.startDate = s
  }
  if (root.scene !== undefined) {
    const s = asString(name, 'scene', root.scene)
    if (!isSceneId(s)) fail(name, 'scene', `references unknown scene id "${s}"`)
    out.scene = s
  }

  if (root.player !== undefined) {
    const p = asObject(name, 'player', root.player)
    rejectUnknownKeys(name, 'player', p, PLAYER_KEYS)
    const player: FixturePlayer = {}
    if (p.money !== undefined) player.money = asNumber(name, 'player.money', p.money)
    if (p.location !== undefined) player.location = validateLocation(name, 'player.location', p.location)
    if (p.skills !== undefined) player.skills = validateSkills(name, 'player.skills', p.skills)
    if (p.background !== undefined) player.background = asString(name, 'player.background', p.background)
    out.player = player
  }

  if (root.factions !== undefined) {
    const arr = asArray(name, 'factions', root.factions)
    out.factions = arr.map((row, i) => {
      const r = asObject(name, `factions[${i}]`, row)
      rejectUnknownKeys(name, `factions[${i}]`, r, FACTION_KEYS)
      const id = asString(name, `factions[${i}].id`, r.id)
      if (!VALID_FACTION_IDS.has(id)) {
        fail(name, `factions[${i}].id`, `references unknown faction id "${id}" (valid: ${[...VALID_FACTION_IDS].join(', ')})`)
      }
      const f: FixtureFaction = { id }
      if (r.money !== undefined) f.money = asNumber(name, `factions[${i}].money`, r.money)
      return f
    })
  }

  if (root.ships !== undefined) {
    const arr = asArray(name, 'ships', root.ships)
    out.ships = arr.map((row, i) => {
      const r = asObject(name, `ships[${i}]`, row)
      rejectUnknownKeys(name, `ships[${i}]`, r, SHIP_KEYS)
      const id = asString(name, `ships[${i}].id`, r.id)
      const template = asString(name, `ships[${i}].template`, r.template)
      if (!isShipClassId(template)) {
        fail(name, `ships[${i}].template`, `"${template}" not found in ship-classes`)
      }
      const s: FixtureShip = { id, template }
      if (r.name !== undefined) s.name = asString(name, `ships[${i}].name`, r.name)
      if (r.dockedAt !== undefined) s.dockedAt = asString(name, `ships[${i}].dockedAt`, r.dockedAt)
      if (r.flagship !== undefined) s.flagship = asBoolean(name, `ships[${i}].flagship`, r.flagship)
      return s
    })
    const flagshipCount = out.ships.filter((s) => s.flagship === true).length
    if (flagshipCount > 1) fail(name, 'ships', `declares ${flagshipCount} flagships; at most one ship may set flagship: true`)
  }

  if (root.ms !== undefined) {
    const arr = asArray(name, 'ms', root.ms)
    out.ms = arr.map((row, i) => {
      const r = asObject(name, `ms[${i}]`, row)
      rejectUnknownKeys(name, `ms[${i}]`, r, MS_KEYS)
      const key = asString(name, `ms[${i}].key`, r.key)
      const template = asString(name, `ms[${i}].template`, r.template)
      if (!isMsClassId(template)) {
        fail(name, `ms[${i}].template`, `"${template}" not found in ms-classes`)
      }
      const m: FixtureMs = { key, template }
      if (r.storedOnShip !== undefined) m.storedOnShip = asString(name, `ms[${i}].storedOnShip`, r.storedOnShip)
      if (r.bayIndex !== undefined) m.bayIndex = asNumber(name, `ms[${i}].bayIndex`, r.bayIndex)
      if (r.dockedAt !== undefined) m.dockedAt = asString(name, `ms[${i}].dockedAt`, r.dockedAt)
      if (r.pilotId !== undefined) m.pilotId = asString(name, `ms[${i}].pilotId`, r.pilotId)
      if (r.hullCurrent !== undefined) m.hullCurrent = asNumber(name, `ms[${i}].hullCurrent`, r.hullCurrent)
      if (r.roleTag !== undefined) {
        const rt = asString(name, `ms[${i}].roleTag`, r.roleTag)
        if (!(MS_ROLE_TAGS as readonly string[]).includes(rt)) {
          fail(name, `ms[${i}].roleTag`, `"${rt}" not one of ${MS_ROLE_TAGS.join(', ')}`)
        }
        m.roleTag = rt as MsRoleTag
      }
      return m
    })
  }

  if (root.parts !== undefined) {
    const p = asObject(name, 'parts', root.parts)
    rejectUnknownKeys(name, 'parts', p, PARTS_KEYS)
    const parts: FixtureParts = {}
    if (p.weapons !== undefined) parts.weapons = validatePartCounts(name, 'parts.weapons', p.weapons, isMsWeaponId, 'ms-weapon')
    if (p.frameMods !== undefined) parts.frameMods = validatePartCounts(name, 'parts.frameMods', p.frameMods, isMsFrameModId, 'ms-frame-mod')
    out.parts = parts
  }

  if (root.npcs !== undefined) {
    const arr = asArray(name, 'npcs', root.npcs)
    out.npcs = arr.map((row, i) => {
      const r = asObject(name, `npcs[${i}]`, row)
      rejectUnknownKeys(name, `npcs[${i}]`, r, NPC_KEYS)
      const id = asString(name, `npcs[${i}].id`, r.id)
      const nm = asString(name, `npcs[${i}].name`, r.name)
      const at = validateLocation(name, `npcs[${i}].at`, r.at)
      const n: FixtureNpc = { id, name: nm, at }
      if (r.skills !== undefined) n.skills = validateSkills(name, `npcs[${i}].skills`, r.skills)
      if (r.workstation !== undefined) n.workstation = asString(name, `npcs[${i}].workstation`, r.workstation)
      if (r.faction !== undefined) {
        const fid = asString(name, `npcs[${i}].faction`, r.faction)
        if (!VALID_FACTION_IDS.has(fid)) {
          fail(name, `npcs[${i}].faction`, `references unknown faction id "${fid}" (valid: ${[...VALID_FACTION_IDS].join(', ')})`)
        }
        n.faction = fid
      }
      if (r.temperament !== undefined) {
        const t = asString(name, `npcs[${i}].temperament`, r.temperament)
        if (!isTemperamentId(t)) {
          fail(name, `npcs[${i}].temperament`, `is not a known temperament id (see config/psychology.ts)`)
        }
        n.temperament = t
      }
      if (r.sympathies !== undefined) {
        const o = asObject(name, `npcs[${i}].sympathies`, r.sympathies)
        const sym: CauseTags = {}
        for (const [k, v] of Object.entries(o)) {
          if (!isCauseId(k)) {
            fail(name, `npcs[${i}].sympathies.${k}`, `is not a known cause id (see config/psychology.ts)`)
          }
          const w = asNumber(name, `npcs[${i}].sympathies.${k}`, v)
          if (Math.abs(w) > 1) {
            fail(name, `npcs[${i}].sympathies.${k}`, `must be in [-1, 1], got ${w}`)
          }
          sym[k] = w
        }
        n.sympathies = sym
      }
      return n
    })
  }

  return out
}

function parseFixture(name: string): Fixture {
  const raw = FIXTURES[name]
  if (raw === undefined) {
    throw new Error(`applyFixture(${name}): fixture not registered (known: ${Object.keys(FIXTURES).join(', ')})`)
  }
  let parsed: unknown
  try {
    parsed = json5.parse(raw)
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    throw new Error(`applyFixture(${name}): JSON5 parse failed — ${m}`)
  }
  return validate(name, parsed)
}

function applySeed(fx: Fixture): void {
  if (fx.seed !== undefined) setSimRngSeed(fx.seed)
}

function applyStartDate(fx: Fixture): void {
  if (fx.startDate !== undefined) setSimNow(Date.parse(fx.startDate))
}

function applyPlayer(name: string, fx: Fixture): void {
  const p = fx.player
  if (!p) return
  const loc = p.location ?? (fx.scene ? { scene: fx.scene, x: 0, y: 0 } : null)
  if (!loc) fail(name, 'player', 'has no location (set player.location or top-level scene)')
  const world = getWorld(loc.scene)
  bootstrapFactions(world)
  const ent = spawnPlayer(world, {
    x: loc.x * TILE,
    y: loc.y * TILE,
    startingMoney: p.money,
  })
  if (p.skills) {
    for (const [k, v] of Object.entries(p.skills)) setSkillXp(ent, k as SkillId, v)
  }
  if (p.background !== undefined) {
    if (!applyBackground(ent, p.background)) {
      fail(name, 'player.background', `references unknown background "${p.background}"`)
    }
  }
}

function applyFactions(name: string, fx: Fixture): void {
  if (!fx.factions) return
  for (const sceneId of SCENE_IDS) bootstrapFactions(getWorld(sceneId))
  for (let i = 0; i < fx.factions.length; i += 1) {
    const row = fx.factions[i]
    let applied = false
    for (const sceneId of SCENE_IDS) {
      const w = getWorld(sceneId)
      for (const e of w.query(Faction)) {
        const f = e.get(Faction)!
        if (f.id !== row.id) continue
        if (row.money !== undefined) e.set(Faction, { ...f, fund: row.money })
        applied = true
      }
    }
    if (!applied) fail(name, `factions[${i}].id`, `did not resolve to a live Faction entity (id="${row.id}")`)
  }
}

function applyShips(name: string, fx: Fixture): void {
  if (!fx.ships) return
  const shipWorld = getWorld('playerShipInterior')

  // W1 Task 5 — boot no longer spawns a flagship, so the ship-interior world
  // is empty here and every fixture ship is spawned fresh. Exactly one ship
  // is the flagship: the one with explicit `flagship: true`, else ships[0].
  // The flagship gets IsFlagshipMark + IsInActiveFleet + the flagship
  // formation slot (reproducing the old boot markers). When declared
  // `flagship: true`, its class interior is seeded too, so board / enter-ship
  // fixtures find a walkable layout without booting into the ship first.
  const explicitFlagshipIdx = fx.ships.findIndex((s) => s.flagship === true)
  const flagshipIdx = explicitFlagshipIdx >= 0 ? explicitFlagshipIdx : 0

  const seenIds = new Set<string>()
  let flagshipCls: ReturnType<typeof getShipClass> | undefined
  for (let i = 0; i < fx.ships.length; i += 1) {
    const s = fx.ships[i]
    if (seenIds.has(s.id)) fail(name, `ships[${i}].id`, `duplicates ships[].id "${s.id}"`)
    seenIds.add(s.id)
    const cls = getShipClass(s.template)
    const isFlagship = i === flagshipIdx
    const ship = shipWorld.spawn(
      Ship({
        templateId: cls.id,
        name: s.name ?? defaultShipName(cls),
        hullCurrent: cls.hullMax, hullMax: cls.hullMax,
        armorCurrent: cls.armorMax, armorMax: cls.armorMax,
        fluxMax: cls.fluxMax, fluxCurrent: 0,
        fluxDissipation: cls.fluxDissipation,
        hasShield: cls.hasShield,
        shieldEfficiency: cls.shieldEfficiency,
        topSpeed: cls.topSpeed,
        accel: cls.accel,
        decel: cls.decel,
        angularAccel: cls.angularAccel,
        maxAngVel: cls.maxAngVel,
        crCurrent: cls.crMax, crMax: cls.crMax,
        dockedAtPoiId: s.dockedAt ?? '',
        fleetPos: { x: 0, y: 0 },
        inCombat: false,
        aggression: fleetConfig.aggressionDefault,
        formationSlot: isFlagship ? fleetConfig.activeFleetGrid.flagshipSlot : -1,
      }),
      EntityKey({ key: s.id }),
      Owner({ kind: 'character', entity: null }),
    )
    attachShipStatSheet(ship)
    if (isFlagship) {
      ship.add(IsFlagshipMark)
      ship.add(IsInActiveFleet)
      if (s.flagship === true) flagshipCls = cls
    }
  }

  // Seed the flagship's interior (rooms + kiosks) the way the old boot did,
  // so fixtures that board / enter the ship find a walkable layout.
  if (flagshipCls) seedShipSceneLayout(flagshipCls, shipWorld)

  // Roster mutated — re-derive fleet fuel capacity and top off so the
  // fixture starts in a flyable state.
  recomputeFleetFuelMax({ topUp: true })
}

function applyMs(name: string, fx: Fixture): void {
  if (!fx.ms) return
  const seenKeys = new Set<string>()
  for (let i = 0; i < fx.ms.length; i += 1) {
    const m = fx.ms[i]
    if (seenKeys.has(m.key)) fail(name, `ms[${i}].key`, `duplicates ms[].key "${m.key}"`)
    seenKeys.add(m.key)
    spawnMsEntity({
      key: m.key,
      templateId: m.template,
      storedOnShipKey: m.storedOnShip,
      bayIndex: m.bayIndex,
      dockedAtPoiId: m.dockedAt,
      pilotId: m.pilotId,
      hullCurrent: m.hullCurrent,
      roleTag: m.roleTag,
    })
  }
  // Re-place MS sprites for whatever is stowed aboard the flagship.
  refreshMsLayout()
}

function applyParts(name: string, fx: Fixture): void {
  if (!fx.parts) return
  const shipWorld = getWorld('playerShipInterior')
  const partsKey = 'player-parts-inv'
  for (const ent of shipWorld.query(PlayerPartsInventory, EntityKey)) {
    if (ent.get(EntityKey)!.key === partsKey) {
      fail(name, 'parts', 'a PlayerPartsInventory already exists (fixture declared parts twice?)')
    }
  }
  shipWorld.spawn(
    PlayerPartsInventory({
      weapons: { ...(fx.parts.weapons ?? {}) },
      frameMods: { ...(fx.parts.frameMods ?? {}) },
    }),
    EntityKey({ key: partsKey }),
  )
}

function applyNpcs(name: string, fx: Fixture): void {
  if (!fx.npcs) return
  const seenIds = new Set<string>()
  for (let i = 0; i < fx.npcs.length; i += 1) {
    const n = fx.npcs[i]
    if (seenIds.has(n.id)) fail(name, `npcs[${i}].id`, `duplicates npcs[].id "${n.id}"`)
    seenIds.add(n.id)
    const w = getWorld(n.at.scene)
    bootstrapFactions(w)
    const ent = spawnNPC(w, {
      name: n.name,
      color: '#cccccc',
      x: n.at.x * TILE,
      y: n.at.y * TILE,
      key: n.id,
      skills: n.skills as Partial<Record<ConfigSkillId, number>> | undefined,
      factionRole: n.faction !== undefined
        ? { faction: n.faction as FactionId, role: 'staff' }
        : undefined,
      temperament: n.temperament,
      sympathies: n.sympathies,
    })
    if (n.workstation !== undefined) {
      let matched = false
      for (const wsEnt of w.query(Workstation)) {
        const ws = wsEnt.get(Workstation)!
        if (ws.specId !== n.workstation || ws.occupant !== null) continue
        wsEnt.set(Workstation, { ...ws, occupant: ent })
        ent.set(Job, { workstation: wsEnt, unemployedSinceMs: 0 })
        matched = true
        break
      }
      if (!matched) fail(name, `npcs[${i}].workstation`, `no free workstation matched specId "${n.workstation}" in scene "${n.at.scene}"`)
    }
  }
}

export function applyFixture(name: string): void {
  const fx = parseFixture(name)
  applySeed(fx)
  applyStartDate(fx)
  applyPlayer(name, fx)
  applyFactions(name, fx)
  applyShips(name, fx)
  applyMs(name, fx)
  applyParts(name, fx)
  applyNpcs(name, fx)
  // Route through useScene so the zustand store stays in sync with
  // ecs/world.ts's activeId — ScopedRoot subscribes to useScene to pick
  // the koota world for the React tree, and smoke tests read
  // useScene.getState().activeId. Calling setActiveSceneId() directly
  // leaves the store at its initial value and React mounts the wrong
  // world.
  if (fx.scene !== undefined) useScene.getState().setActive(fx.scene)
}
