// The world is fully reproducible from `WORLD_SEED + setupWorld()`, so saves
// only capture *dynamic* state (vitals, money, action, entity refs) plus the
// clock and population counters. Reload = `resetWorld()` (rebuilds map +
// spec NPCs from seed) → patch dynamic traits onto entities matched by
// stable EntityKey → spawn missing immigrants → destroy entities the save
// no longer expects.
//
// Entity references survive the round-trip via key indirection: every saved
// entity carries an EntityKey trait, and refs are serialized as keys, not
// raw entity ids.

import { get, set, del } from 'idb-keyval'
import superjson from 'superjson'
import type { Entity } from 'koota'
import {
  Position, MoveTarget, Vitals, Health, Action, Money, Skills, Inventory,
  Job, Home, JobPerformance, Attributes, Bed, BarSeat, RoughSpot, Workstation,
  Character, EntityKey, PendingEviction, RoughUse, IsPlayer, ChatTarget, ChatLine,
  Reputation, JobTenure, FactionRole, Active, Ambitions, Flags,
  type AmbitionSlot, type AmbitionHistoryEntry,
} from '../ecs/traits'
import type { TraitInstance } from 'koota'
import { world, getActiveSceneId, type SceneId } from '../ecs/world'
import { initialSceneId, sceneIds } from '../data/scenes'
import { useScene, migratePlayerToScene } from '../sim/scene'
import { useClock, gameDayNumber } from '../sim/clock'
import { stopLoop, startLoop } from '../sim/loop'
import { resetWorld, spawnNPC } from '../ecs/spawn'
import { getPopulationState, setPopulationState } from '../systems/population'
import { snapshotRelations, restoreRelations, type RelationSnap } from '../systems/relations'
import { WORLD_SEED } from '../procgen'

export type SlotId = 'auto' | 1 | 2 | 3
export const MANUAL_SLOTS: ReadonlyArray<1 | 2 | 3> = [1, 2, 3]
export const ALL_SLOTS: ReadonlyArray<SlotId> = ['auto', 1, 2, 3]

function bundleKey(slot: SlotId): string { return `uclife:save:${slot}` }
function metaKey(slot: SlotId): string { return `uclife:save:${slot}:meta` }

// Single-slot key from before multi-slot saves. listSaves() runs a one-shot
// migration that rewrites this into the autosave slot.
const LEGACY_KEY = 'uclife:autosave'

const SAVE_VERSION = 1

// Per-entity snapshot. `key` matches an EntityKey already in the world (or,
// for immigrants, identifies the NPC to re-spawn). All trait fields are
// optional — only emitted for traits the entity actually carries at save
// time. Loader mirrors that: presence → set/add, absence → remove if added
// at runtime.
interface EntitySnap {
  key: string
  character?: TraitInstance<typeof Character>
  position?: TraitInstance<typeof Position>
  moveTarget?: TraitInstance<typeof MoveTarget>
  vitals?: TraitInstance<typeof Vitals>
  health?: TraitInstance<typeof Health>
  action?: TraitInstance<typeof Action>
  money?: TraitInstance<typeof Money>
  skills?: TraitInstance<typeof Skills>
  inventory?: TraitInstance<typeof Inventory>
  jobPerformance?: TraitInstance<typeof JobPerformance>
  attributes?: TraitInstance<typeof Attributes>
  // Bed/BarSeat/RoughSpot/Workstation static data is rebuilt by setupWorld;
  // only mutable occupant + (for beds) rent state need persisting.
  bed?: { occupant: string | null; rentPaidUntilMs: number; owned: boolean }
  barSeat?: { occupant: string | null }
  roughSpot?: { occupant: string | null }
  workstation?: { occupant: string | null }
  job?: { workstationKey: string | null; unemployedSinceMs: number }
  home?: { bedKey: string | null }
  pendingEviction?: { bedKey: string | null; expireMs: number }
  roughUse?: TraitInstance<typeof RoughUse>
  chatTarget?: { partnerKey: string | null }
  chatLine?: TraitInstance<typeof ChatLine>
  reputation?: TraitInstance<typeof Reputation>
  jobTenure?: TraitInstance<typeof JobTenure>
  factionRole?: TraitInstance<typeof FactionRole>
  ambitions?: { active: AmbitionSlot[]; history: AmbitionHistoryEntry[]; lastSwapMs: number }
  flags?: { flags: Record<string, boolean> }
}

// Stored in its own idb-keyval key per slot so the SystemMenu can render
// the slot list without parsing the full bundles. Also embedded in the
// bundle so a save survives a meta-key wipe.
export interface SaveMeta {
  slot: SlotId
  version: number
  savedAtRealMs: number
  gameDate: Date
  dayInGame: number
  playerMoney: number
  playerHp: number
  alive: number
}

interface SaveBundle {
  version: number
  seed: string
  // Optional for back-compat with bundles written before the active-scene
  // fix. Older bundles loaded by migrating to initialSceneId.
  activeSceneId?: SceneId
  gameDate: Date
  meta: SaveMeta
  population: ReturnType<typeof getPopulationState>
  entities: EntitySnap[]
  relations: RelationSnap[]
}

// Returns null for entities without an EntityKey trait (walls, doors,
// decoratives) — those are rebuilt deterministically by setupWorld.
function keyOf(entity: Entity | null): string | null {
  if (!entity) return null
  const k = entity.get(EntityKey)
  return k ? k.key : null
}

function snapshotEntity(entity: Entity): EntitySnap {
  const key = entity.get(EntityKey)!.key
  const snap: EntitySnap = { key }

  if (entity.has(Character)) snap.character = { ...entity.get(Character)! }
  if (entity.has(Position)) snap.position = { ...entity.get(Position)! }
  if (entity.has(MoveTarget)) snap.moveTarget = { ...entity.get(MoveTarget)! }
  if (entity.has(Vitals)) snap.vitals = { ...entity.get(Vitals)! }
  if (entity.has(Health)) snap.health = { ...entity.get(Health)! }
  if (entity.has(Action)) snap.action = { ...entity.get(Action)! }
  if (entity.has(Money)) snap.money = { ...entity.get(Money)! }
  if (entity.has(Skills)) snap.skills = { ...entity.get(Skills)! }
  if (entity.has(Inventory)) snap.inventory = { ...entity.get(Inventory)! }
  if (entity.has(JobPerformance)) snap.jobPerformance = { ...entity.get(JobPerformance)! }
  if (entity.has(Attributes)) {
    // Deep-clone the nested StatState objects so mutating the live trait
    // later doesn't poison the snapshot.
    const a = entity.get(Attributes)!
    snap.attributes = {
      strength: { ...a.strength },
      endurance: { ...a.endurance },
      charisma: { ...a.charisma },
      intelligence: { ...a.intelligence },
      reflex: { ...a.reflex },
      resolve: { ...a.resolve },
      lastDriftDay: a.lastDriftDay,
    }
  }

  if (entity.has(Bed)) {
    const b = entity.get(Bed)!
    snap.bed = {
      occupant: keyOf(b.occupant),
      rentPaidUntilMs: b.rentPaidUntilMs,
      owned: b.owned,
    }
  }
  if (entity.has(BarSeat)) {
    snap.barSeat = { occupant: keyOf(entity.get(BarSeat)!.occupant) }
  }
  if (entity.has(RoughSpot)) {
    snap.roughSpot = { occupant: keyOf(entity.get(RoughSpot)!.occupant) }
  }
  if (entity.has(Workstation)) {
    snap.workstation = { occupant: keyOf(entity.get(Workstation)!.occupant) }
  }

  if (entity.has(Job)) {
    const j = entity.get(Job)!
    snap.job = {
      workstationKey: keyOf(j.workstation),
      unemployedSinceMs: j.unemployedSinceMs,
    }
  }
  if (entity.has(Home)) {
    snap.home = { bedKey: keyOf(entity.get(Home)!.bed) }
  }
  if (entity.has(PendingEviction)) {
    const p = entity.get(PendingEviction)!
    snap.pendingEviction = {
      bedKey: keyOf(p.bedEntity),
      expireMs: p.expireMs,
    }
  }
  if (entity.has(RoughUse)) {
    snap.roughUse = { ...entity.get(RoughUse)! }
  }
  if (entity.has(ChatTarget)) {
    snap.chatTarget = { partnerKey: keyOf(entity.get(ChatTarget)!.partner) }
  }
  if (entity.has(ChatLine)) {
    snap.chatLine = { ...entity.get(ChatLine)! }
  }
  if (entity.has(Reputation)) {
    // Clone the inner rep map so live-trait mutations don't leak into the
    // snapshot.
    const r = entity.get(Reputation)!
    snap.reputation = { rep: { ...r.rep } }
  }
  if (entity.has(JobTenure)) {
    snap.jobTenure = { ...entity.get(JobTenure)! }
  }
  if (entity.has(FactionRole)) {
    snap.factionRole = { ...entity.get(FactionRole)! }
  }
  if (entity.has(Ambitions)) {
    const a = entity.get(Ambitions)!
    snap.ambitions = {
      active: a.active.map((s) => ({ ...s })),
      history: a.history.map((h) => ({ ...h })),
      lastSwapMs: a.lastSwapMs,
    }
  }
  if (entity.has(Flags)) {
    snap.flags = { flags: { ...entity.get(Flags)!.flags } }
  }

  return snap
}

function buildMeta(slot: SlotId, gameDate: Date): SaveMeta {
  let playerMoney = 0
  let playerHp = 100
  const player = world.queryFirst(IsPlayer)
  if (player) {
    const money = player.get(Money)
    if (money) playerMoney = money.amount
    const health = player.get(Health)
    if (health) playerHp = Math.round(health.hp)
  }
  let alive = 0
  for (const e of world.query(Character, Health)) {
    if (!e.get(Health)!.dead) alive++
  }
  return {
    slot,
    version: SAVE_VERSION,
    savedAtRealMs: Date.now(),
    gameDate,
    dayInGame: gameDayNumber(gameDate),
    playerMoney,
    playerHp,
    alive,
  }
}

export async function saveGame(slot: SlotId = 'auto'): Promise<void> {
  const entities: EntitySnap[] = []
  for (const e of world.query(EntityKey)) {
    entities.push(snapshotEntity(e))
  }

  const gameDate = useClock.getState().gameDate
  const meta = buildMeta(slot, gameDate)
  const bundle: SaveBundle = {
    version: SAVE_VERSION,
    seed: WORLD_SEED,
    activeSceneId: getActiveSceneId(),
    gameDate,
    meta,
    population: getPopulationState(),
    entities,
    relations: snapshotRelations(world),
  }
  const payload = superjson.stringify(bundle)
  await set(bundleKey(slot), payload)
  await set(metaKey(slot), superjson.stringify(meta))
}

export async function hasSave(slot: SlotId = 'auto'): Promise<boolean> {
  return (await get(bundleKey(slot))) != null
}

export async function listSaves(): Promise<SaveMeta[]> {
  await migrateLegacySlot()
  const out: SaveMeta[] = []
  for (const slot of ALL_SLOTS) {
    const raw = await get<string>(metaKey(slot))
    if (!raw) continue
    try {
      const meta = superjson.parse<SaveMeta>(raw)
      out.push(meta)
    } catch (e) {
      console.warn(`[save/list] failed to parse meta for slot ${slot}:`, e)
    }
  }
  return out
}

// One-shot migration of the single-slot `uclife:autosave` key into the
// per-slot scheme. No-op once the source key is gone. Cheap enough to run
// on every listSaves() call.
async function migrateLegacySlot(): Promise<void> {
  const legacy = await get<string>(LEGACY_KEY)
  if (!legacy) return
  const existing = await get<string>(bundleKey('auto'))
  if (!existing) {
    await set(bundleKey('auto'), legacy)
    // Older bundles don't carry meta — fabricate it from visible fields.
    try {
      const bundle = superjson.parse<SaveBundle>(legacy)
      const meta: SaveMeta = bundle.meta ?? {
        slot: 'auto',
        version: bundle.version,
        savedAtRealMs: Date.now(),
        gameDate: bundle.gameDate,
        dayInGame: gameDayNumber(bundle.gameDate),
        playerMoney: 0,
        playerHp: 100,
        alive: bundle.entities.filter((s) => s.character && (!s.health || !s.health.dead)).length,
      }
      await set(metaKey('auto'), superjson.stringify(meta))
    } catch (e) {
      console.warn('[save/migrate] could not parse legacy bundle:', e)
    }
  }
  await del(LEGACY_KEY)
}

export async function loadGame(slot: SlotId = 'auto'): Promise<{ ok: true } | { ok: false; reason: string }> {
  const payload = await get<string>(bundleKey(slot))
  if (!payload) return { ok: false, reason: 'no save' }

  let bundle: SaveBundle
  try {
    bundle = superjson.parse<SaveBundle>(payload)
  } catch (e) {
    return { ok: false, reason: `parse: ${(e as Error).message}` }
  }
  if (bundle.version !== SAVE_VERSION) {
    return { ok: false, reason: `version mismatch: save=${bundle.version} app=${SAVE_VERSION}` }
  }
  if (bundle.seed !== WORLD_SEED) {
    // Refuse rather than silently mis-overlay: different seeds generate
    // different sector slots, so EntityKeys won't line up.
    return { ok: false, reason: `seed mismatch: save=${bundle.seed} app=${WORLD_SEED}` }
  }

  // Stop systems so traits aren't mutated mid-patch.
  stopLoop()

  resetWorld()

  // Restore active scene + bump the React-tree remount key BEFORE the byKey
  // lookup. Three reasons:
  // (a) world proxy resolves to `getActiveSceneId()`; resetWorld left it at
  //     initialSceneId, so a save taken in any other scene would overlay onto
  //     the wrong world without this.
  // (b) world.reset() clears koota's queriesHashMap. The existing useQuery
  //     instances become orphaned: the new entities spawned by setupWorld
  //     don't appear in their state, leaving the rendered scene empty (only
  //     the player rendered). Bumping swapNonce forces App to remount via
  //     the keyed ScopedRoot, giving fresh useQuery instances that re-scan
  //     entityIndex via cacheQuery.
  // (c) setupWorld only spawns the player in initialSceneId. A save taken in
  //     any other scene snapshots the player there, so we have to migrate the
  //     fresh player into the target scene before byKey lookup — otherwise the
  //     overlay drops the 'player' snap and the user lands in an empty scene
  //     (no player → can't move → looks like "pathfinding broken").
  const targetSceneId: SceneId = (bundle.activeSceneId && sceneIds.includes(bundle.activeSceneId))
    ? bundle.activeSceneId
    : initialSceneId
  if (targetSceneId !== initialSceneId) {
    // Position is overlaid from the snapshot below; the arrival arg is just
    // a placeholder. migratePlayerToScene calls useScene.setActive internally.
    migratePlayerToScene(targetSceneId, { x: 0, y: 0 })
  } else {
    useScene.getState().setActive(targetSceneId)
  }

  const byKey = new Map<string, Entity>()
  for (const e of world.query(EntityKey)) {
    byKey.set(e.get(EntityKey)!.key, e)
  }

  // Spawn saved immigrants that resetWorld didn't materialize. Placeholder
  // values get overlayed from the snapshot below.
  const savedKeys = new Set<string>()
  for (const snap of bundle.entities) {
    savedKeys.add(snap.key)
    if (byKey.has(snap.key)) continue
    if (!snap.key.startsWith('npc-imm-')) {
      // Unknown key not produced by setupWorld — likely a future-version
      // entity. Skip rather than crash.
      console.warn(`[save/load] saved entity has unknown key: ${snap.key}`)
      continue
    }
    const e = spawnNPC({
      name: snap.character?.name ?? snap.key,
      color: snap.character?.color ?? '#888',
      title: snap.character?.title ?? '市民',
      x: snap.position?.x ?? 0,
      y: snap.position?.y ?? 0,
      key: snap.key,
    })
    byKey.set(snap.key, e)
  }

  // Destroy entities resetWorld restored but the save no longer expects
  // (e.g. spec NPCs that had died before the save was taken).
  for (const [key, entity] of byKey) {
    if (!savedKeys.has(key)) entity.destroy()
  }
  // Rebuild the index after destruction so refs resolve only to live entities.
  byKey.clear()
  for (const e of world.query(EntityKey)) {
    byKey.set(e.get(EntityKey)!.key, e)
  }

  const resolveRef = (k: string | null): Entity | null => {
    if (!k) return null
    const e = byKey.get(k)
    if (!e) {
      console.warn(`[save/load] dangling ref to ${k} — clearing to null`)
      return null
    }
    return e
  }

  for (const snap of bundle.entities) {
    const entity = byKey.get(snap.key)
    if (!entity) continue

    if (snap.character) entity.set(Character, snap.character)
    if (snap.position) entity.set(Position, snap.position)
    if (snap.moveTarget) entity.set(MoveTarget, snap.moveTarget)
    if (snap.vitals) entity.set(Vitals, snap.vitals)
    if (snap.health) entity.set(Health, snap.health)
    if (snap.action) entity.set(Action, snap.action)
    if (snap.money) entity.set(Money, snap.money)
    if (snap.skills) entity.set(Skills, snap.skills)
    if (snap.inventory) entity.set(Inventory, snap.inventory)
    if (snap.jobPerformance) entity.set(JobPerformance, snap.jobPerformance)
    if (snap.attributes) entity.set(Attributes, snap.attributes)

    if (snap.bed) {
      const cur = entity.get(Bed)!
      entity.set(Bed, {
        ...cur,
        occupant: resolveRef(snap.bed.occupant),
        rentPaidUntilMs: snap.bed.rentPaidUntilMs,
        owned: snap.bed.owned,
      })
    }
    if (snap.barSeat) {
      entity.set(BarSeat, { occupant: resolveRef(snap.barSeat.occupant) })
    }
    if (snap.roughSpot) {
      entity.set(RoughSpot, { occupant: resolveRef(snap.roughSpot.occupant) })
    }
    if (snap.workstation) {
      const cur = entity.get(Workstation)!
      entity.set(Workstation, { ...cur, occupant: resolveRef(snap.workstation.occupant) })
    }

    if (snap.job) {
      entity.set(Job, {
        workstation: resolveRef(snap.job.workstationKey),
        unemployedSinceMs: snap.job.unemployedSinceMs,
      })
    }
    if (snap.home) {
      const bed = resolveRef(snap.home.bedKey)
      if (entity.has(Home)) entity.set(Home, { bed })
      else entity.add(Home({ bed }))
    } else if (entity.has(Home)) {
      entity.remove(Home)
    }
    if (snap.pendingEviction) {
      const bedEntity = resolveRef(snap.pendingEviction.bedKey)
      if (entity.has(PendingEviction)) {
        entity.set(PendingEviction, { bedEntity, expireMs: snap.pendingEviction.expireMs })
      } else {
        entity.add(PendingEviction({ bedEntity, expireMs: snap.pendingEviction.expireMs }))
      }
    } else if (entity.has(PendingEviction)) {
      entity.remove(PendingEviction)
    }
    if (snap.roughUse) {
      if (entity.has(RoughUse)) entity.set(RoughUse, snap.roughUse)
      else entity.add(RoughUse(snap.roughUse))
    } else if (entity.has(RoughUse)) {
      entity.remove(RoughUse)
    }
    if (snap.chatTarget) {
      const partner = resolveRef(snap.chatTarget.partnerKey)
      if (entity.has(ChatTarget)) entity.set(ChatTarget, { partner })
      else entity.add(ChatTarget({ partner }))
    } else if (entity.has(ChatTarget)) {
      entity.remove(ChatTarget)
    }
    if (snap.chatLine) {
      if (entity.has(ChatLine)) entity.set(ChatLine, snap.chatLine)
      else entity.add(ChatLine(snap.chatLine))
    } else if (entity.has(ChatLine)) {
      entity.remove(ChatLine)
    }
    if (snap.reputation) {
      if (entity.has(Reputation)) entity.set(Reputation, { rep: { ...snap.reputation.rep } })
      else entity.add(Reputation({ rep: { ...snap.reputation.rep } }))
    } else if (entity.has(Reputation)) {
      entity.remove(Reputation)
    }
    if (snap.jobTenure) {
      if (entity.has(JobTenure)) entity.set(JobTenure, snap.jobTenure)
      else entity.add(JobTenure(snap.jobTenure))
    } else if (entity.has(JobTenure)) {
      entity.remove(JobTenure)
    }
    if (snap.factionRole) {
      if (entity.has(FactionRole)) entity.set(FactionRole, snap.factionRole)
      else entity.add(FactionRole(snap.factionRole))
    } else if (entity.has(FactionRole)) {
      entity.remove(FactionRole)
    }
    if (snap.ambitions) {
      const payload = {
        active: snap.ambitions.active.map((s) => ({ ...s })),
        history: snap.ambitions.history.map((h) => ({ ...h })),
        lastSwapMs: snap.ambitions.lastSwapMs,
      }
      if (entity.has(Ambitions)) entity.set(Ambitions, payload)
      else entity.add(Ambitions(payload))
    } else if (entity.has(Ambitions)) {
      entity.remove(Ambitions)
    }
    if (snap.flags) {
      const payload = { flags: { ...snap.flags.flags } }
      if (entity.has(Flags)) entity.set(Flags, payload)
      else entity.add(Flags(payload))
    } else if (entity.has(Flags)) {
      entity.remove(Flags)
    }
  }

  // After entity overlay so newly-spawned immigrants are already in byKey.
  // Edges to unkeyed or destroyed characters are silently dropped.
  if (bundle.relations) restoreRelations(world, byKey, bundle.relations)

  // setupWorld spawns NPCs without Active — that's normally added on the
  // first activeZoneSystem tick. But loadGame auto-pauses, so no tick fires
  // and useQuery(Active, ...) in Game.tsx finds nothing → NPCs invisible
  // until the player unpauses. Mark every character Active here; the next
  // tick will demote any that are out of view.
  for (const entity of world.query(Character)) {
    if (!entity.has(Active)) entity.add(Active)
  }

  // Auto-pause on load so the player can survey the restored state.
  useClock.setState({ gameDate: bundle.gameDate, speed: 0, mode: 'normal', forceHyperspeed: false })
  setPopulationState(bundle.population)

  let playerCount = 0
  for (const _ of world.query(IsPlayer)) playerCount += 1
  if (playerCount !== 1) {
    console.warn(`[save/load] expected 1 player after load, found ${playerCount}`)
  }

  startLoop()
  return { ok: true }
}

export async function deleteSave(slot: SlotId = 'auto'): Promise<void> {
  await del(bundleKey(slot))
  await del(metaKey(slot))
}
