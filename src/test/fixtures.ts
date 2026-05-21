import json5 from 'json5'
import minimalPlayerOnlyRaw from '../../tests/fixtures/minimal-player-only.json5?raw'
import amuroAtRecruitOfficeRaw from '../../tests/fixtures/amuro-at-recruit-office.json5?raw'
import playerWithCashAtVbRaw from '../../tests/fixtures/player-with-cash-at-vb.json5?raw'
import gateAtDrydockRaw from '../../tests/fixtures/gate-at-drydock.json5?raw'
import { getWorld, setActiveSceneId, SCENE_IDS } from '../ecs/world'
import { spawnNPC, spawnPlayer } from '../character/spawn'
import { applyBackground } from '../character/backgrounds'
import { setSkillXp, type SkillId } from '../character/skills'
import { Faction, EntityKey, Workstation, Job } from '../ecs/traits'
import { bootstrapFactions } from '../ecs/ownership'
import { setSimRngSeed } from '../sim/rng'
import { setSimNow } from '../sim/time'
import { worldConfig, factionsConfig, skillsConfig, type SkillId as ConfigSkillId } from '../config'
import { isSceneId } from '../data/scenes'
import { isShipClassId, getShipClass } from '../data/ship-classes'
import { Ship, IsFlagshipMark, Owner } from '../ecs/traits'
import { defaultShipName } from '../data/shipNaming'
import { attachShipStatSheet } from '../ecs/shipEffects'

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
}

interface FixtureNpc {
  id: string
  name: string
  at: FixtureLocation
  skills?: Record<string, number>
  workstation?: string
}

interface Fixture {
  seed?: string
  startDate?: string
  scene?: string
  player?: FixturePlayer
  factions?: FixtureFaction[]
  ships?: FixtureShip[]
  npcs?: FixtureNpc[]
}

const FIXTURE_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'seed', 'startDate', 'scene', 'player', 'factions', 'ships', 'npcs',
])
const PLAYER_KEYS: ReadonlySet<string> = new Set([
  'money', 'location', 'skills', 'background',
])
const LOCATION_KEYS: ReadonlySet<string> = new Set(['scene', 'x', 'y'])
const FACTION_KEYS: ReadonlySet<string> = new Set(['id', 'money'])
const SHIP_KEYS: ReadonlySet<string> = new Set(['id', 'template', 'name', 'dockedAt'])
const NPC_KEYS: ReadonlySet<string> = new Set([
  'id', 'name', 'at', 'skills', 'workstation',
])

const TILE = worldConfig.tilePx
const VALID_FACTION_IDS: ReadonlySet<string> = new Set(Object.keys(factionsConfig.catalog))
const VALID_SKILL_IDS: ReadonlySet<string> = new Set(skillsConfig.order as readonly string[])

const FIXTURES: Record<string, string> = {
  'minimal-player-only': minimalPlayerOnlyRaw,
  'amuro-at-recruit-office': amuroAtRecruitOfficeRaw,
  'player-with-cash-at-vb': playerWithCashAtVbRaw,
  'gate-at-drydock': gateAtDrydockRaw,
}

export function __registerInlineFixtureForTest(name: string, raw: string): void {
  FIXTURES[name] = raw
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
      return s
    })
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

  // Build a lookup of bootstrap-spawned ships so the fixture can adopt
  // them by EntityKey rather than spawning duplicates. bootstrapShipScene
  // always lands at least one entity (the default flagship with key='ship')
  // and resetDeliveredShipCounter() is a no-op in test mode, so a fixture
  // that declares `ships[].id === 'ship'` MUST reach in and rewrite that
  // entity in place — otherwise IsFlagshipMark + EntityKey collide.
  const existingByKey = new Map<string, ReturnType<typeof shipWorld.queryFirst>>()
  for (const e of shipWorld.query(Ship, EntityKey)) {
    existingByKey.set(e.get(EntityKey)!.key, e)
  }

  const seenIds = new Set<string>()
  for (let i = 0; i < fx.ships.length; i += 1) {
    const s = fx.ships[i]
    if (seenIds.has(s.id)) fail(name, `ships[${i}].id`, `duplicates ships[].id "${s.id}"`)
    seenIds.add(s.id)
    const cls = getShipClass(s.template)
    let ship = existingByKey.get(s.id)
    if (ship) {
      // Adopt the bootstrap-spawned entity. Rewrite the Ship trait to
      // match the fixture; the StatSheet / Owner already exist (the
      // bootstrap stamps them) so we just overwrite the docked POI +
      // name + template-derived stats.
      const cur = ship.get(Ship)!
      ship.set(Ship, {
        ...cur,
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
        fuelCurrent: cls.fuelMax, fuelMax: cls.fuelMax,
        suppliesCurrent: cls.suppliesMax, suppliesMax: cls.suppliesMax,
        dockedAtPoiId: s.dockedAt ?? '',
        fleetPos: { x: 0, y: 0 },
        inCombat: false,
      })
      if (!ship.has(Owner)) ship.add(Owner)
      ship.set(Owner, { kind: 'character', entity: null })
    } else {
      ship = shipWorld.spawn(
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
          fuelCurrent: cls.fuelMax, fuelMax: cls.fuelMax,
          suppliesCurrent: cls.suppliesMax, suppliesMax: cls.suppliesMax,
          dockedAtPoiId: s.dockedAt ?? '',
          fleetPos: { x: 0, y: 0 },
          inCombat: false,
        }),
        EntityKey({ key: s.id }),
        Owner({ kind: 'character', entity: null }),
      )
      attachShipStatSheet(ship)
    }
    if (i === 0 && !ship.has(IsFlagshipMark)) ship.add(IsFlagshipMark)
  }
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
  applyNpcs(name, fx)
  if (fx.scene !== undefined) setActiveSceneId(fx.scene)
}
