// The world is fully reproducible from `WORLD_SEED + setupWorld()`, so saves
// only capture *dynamic* state (vitals, money, action, entity refs) plus
// per-subsystem singleton state (clock, population, ship, space, ...).
// Reload = `resetWorld()` (rebuilds map + spec NPCs from seed) → patch
// dynamic traits onto entities matched by stable EntityKey → spawn missing
// immigrants → destroy entities the save no longer expects → restore
// per-subsystem state via the handler registry.
//
// Entity references survive the round-trip via key indirection: every
// saved entity carries an EntityKey trait, and refs are serialized as
// keys, not raw entity ids.
//
// Per-subsystem state lives in `bundle.subsystems` and is opaque to this
// module — see src/save/registry.ts and src/boot/saveHandlers/. Adding a
// new persisted subsystem == one file in src/boot/saveHandlers/, no edit
// here.
//
// Per-trait persistence is handler-driven via `traitRegistry.ts` plus the
// cluster files under src/boot/traitSerializers/. Adding a new persisted
// trait == one new file there, no edit to snapshotEntity / loadGame.

import { get, set, del } from 'idb-keyval'
import superjson from 'superjson'
import type { Entity, World } from 'koota'
import {
  Character, EntityKey, Health, IsPlayer, Money, Active,
} from '../ecs/traits'
import { getWorld, getActiveSceneId } from '../ecs/world'
import { useClock, gameDayNumber } from '../sim/clock'
import { emitSim } from '../sim/events'
import { resetWorld } from '../ecs/spawn'
import { spawnNPC } from '../character/spawn'
import { logEvent } from '../ui/EventLog'
import { WORLD_SEED } from '../procgen'
import { snapshotAll, restoreAll } from './registry'
import {
  getTraitSerializers, type RestoreCtx, type SerializeCtx,
} from './traitRegistry'

export type SlotId = 'auto' | 1 | 2 | 3
export const MANUAL_SLOTS: ReadonlyArray<1 | 2 | 3> = [1, 2, 3]
export const ALL_SLOTS: ReadonlyArray<SlotId> = ['auto', 1, 2, 3]

function bundleKey(slot: SlotId): string { return `uclife:save:${slot}` }
function metaKey(slot: SlotId): string { return `uclife:save:${slot}:meta` }

// Single-slot key from before multi-slot saves. listSaves() runs a one-shot
// migration that rewrites this into the autosave slot.
const LEGACY_KEY = 'uclife:autosave'

// Version history:
//   v1: pre-Starsector (FTL-era ship rooms/systems block).
//   v2: pre-Starsector pivot.
//   v3: Starsector pivot — flat ship stat block.
//   v4: spaceCampaign world snapshot (ship continuous-physics + enemy AI).
//   v5: subsystem handler registry — subsystem state moved out of
//       hard-coded top-level bundle fields into a handler-keyed
//       `subsystems` bag. Top-level fields (gameDate, activeSceneId,
//       population, ship, space) become legacy and are migrated by
//       migrateLegacyBundle at load.
//   v6: subsystems.relations replaces top-level bundle.relations — the
//       Knows graph now registers itself as a SaveHandler instead of
//       being hard-coded in saveGame/loadGame.
//   v7: Attributes trait carries a serialized StatSheet (modifier-based
//       stats) plus a per-attribute drift map. Pre-v7 saves are migrated
//       on load by reading the legacy {value, talent, recentUse,
//       recentStress} StatState shape into a fresh sheet. Per-trait
//       serializer registry replaces the hard-coded snapshotEntity loop;
//       on-disk EntitySnap shape is unchanged so v7 round-trips through
//       the registry produce byte-identical output to pre-Wave-5 v7
//       writers.
//   v8: Skill XP folded into the Attributes sheet as 9 stat bases
//       (mechanics..engineering); the standalone Skills trait is gone.
//       Perk economic effects (wageMul/shopMul/rentMul) and per-skill
//       XP multipliers (<skill>XpMul) are sheet stats now too — perk
//       resolution lives wholly in the StatSheet via perkSync.
//       Pre-v8 saves are migrated by lifting the legacy `skills` snap
//       onto the sheet (see traitSerializers/attributes.ts).
//   v9: Effects trait (background / perk / condition Effects). The
//       StatSheet's modifier arrays are derived from Effects.list on
//       load. Pre-v9 saves carry no Effects field — legacy bg/perk
//       modifiers stay in-place inside the saved sheet and produce
//       identical numbers because the fold math is unchanged. Phase 4
//       conditions emit into this trait too.
const SAVE_VERSION = 9

// Per-entity snapshot: stable `key` matched against the EntityKey trait
// in the rebuilt world (or, for immigrants, identifies the NPC to re-
// spawn) plus per-trait fields written by the registered serializers.
// Field names are owned by each TraitSerializer's `id` (see
// src/boot/traitSerializers/), not declared up here — the snap is just
// a bag of optional fields.
interface EntitySnap {
  key: string
  // Indexed by a TraitSerializer.id — value type is owned by that
  // serializer. Keep `unknown` here so save/index.ts stays trait-blind.
  [field: string]: unknown
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
  meta: SaveMeta
  entities: EntitySnap[]
  // v5+: handler-keyed subsystem state. Optional only for legacy bundles
  // (migrateLegacyBundle synthesizes it from top-level fields below).
  subsystems?: Record<string, unknown>
  // Pre-v5 legacy top-level fields. Migrated by migrateLegacyBundle at
  // load time. Newly-written bundles never set these.
  gameDate?: Date
  activeSceneId?: string
  population?: unknown
  ship?: unknown
  space?: unknown
  // Pre-v6 legacy top-level field. Migrated into subsystems.relations.
  relations?: unknown
}

// Returns null for entities without an EntityKey trait (walls, doors,
// decoratives) — those are rebuilt deterministically by setupWorld.
function keyOf(entity: Entity | null): string | null {
  if (!entity) return null
  const k = entity.get(EntityKey)
  return k ? k.key : null
}

const serializeCtx: SerializeCtx = { keyOf }

function snapshotEntity(entity: Entity): EntitySnap {
  const key = entity.get(EntityKey)!.key
  const snap: EntitySnap = { key }
  for (const s of getTraitSerializers()) {
    if (!entity.has(s.trait)) continue
    const v = s.read(entity, serializeCtx)
    if (v === undefined) continue
    snap[s.id] = v
  }
  return snap
}

function buildMeta(world: World, slot: SlotId, gameDate: Date): SaveMeta {
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

// Translates a pre-v5 bundle's top-level fields into the v5 subsystems
// bag. Returns the bag plus any user-facing notices to surface via the
// event log (legacy ship/space migrations that drop state).
//
// New v5 bundles fall through unchanged — `bundle.subsystems` is already
// the truth.
function migrateLegacyBundle(bundle: SaveBundle): {
  subsystems: Record<string, unknown>
  notices: string[]
} {
  const notices: string[] = []
  // v5 bundles already have a subsystems bag; v6 migration only needs
  // to lift the still-top-level `relations` into it. Pre-v5 bundles
  // synthesize the bag from scratch below.
  if (bundle.version >= 5 && bundle.subsystems) {
    const subsystems = { ...bundle.subsystems }
    if (bundle.relations !== undefined && subsystems.relations === undefined) {
      subsystems.relations = bundle.relations
    }
    return { subsystems, notices }
  }

  const subsystems: Record<string, unknown> = {}

  if (bundle.gameDate) {
    subsystems.clock = { gameDate: bundle.gameDate }
  }
  if (bundle.activeSceneId) {
    subsystems.scene = { activeId: bundle.activeSceneId }
  }
  if (bundle.population !== undefined) {
    subsystems.population = bundle.population
  }
  // Ship: only v3+ saves carry the new Starsector block. v1/v2 saves drop
  // ship state to defaults.
  if (bundle.ship !== undefined && bundle.version >= 3) {
    subsystems.ship = bundle.ship
  } else if (bundle.version === 1) {
    notices.push('存档先于 Phase 6 — 飞船状态已重置为默认')
  } else if (bundle.version === 2) {
    notices.push('存档为 Phase 6 旧版 — 飞船重置为新结构默认')
  }
  // Space: only v4+ saves. v3 and earlier drop to defaults.
  if (bundle.space !== undefined && bundle.version >= 4) {
    subsystems.space = bundle.space
  } else if (bundle.version === 3) {
    notices.push('存档先于太空世界持久化 — 飞船与敌舰位置已重置')
  }
  if (bundle.relations !== undefined) {
    subsystems.relations = bundle.relations
  }

  return { subsystems, notices }
}

export async function saveGame(slot: SlotId = 'auto'): Promise<void> {
  const world = getWorld(getActiveSceneId())

  // Combat state is transient by design (Slice G). Manual saves refuse with
  // a toast-friendly error; autosave logs and skips so the throttle clock
  // resets cleanly without spamming UI when combat happens to overlap a
  // day-rollover or hyperspeed-start.
  if (useClock.getState().mode === 'combat') {
    if (slot === 'auto') {
      logEvent('战斗中跳过自动存档')
      return
    }
    throw new Error('战斗中无法存档')
  }

  const entities: EntitySnap[] = []
  for (const e of world.query(EntityKey)) {
    entities.push(snapshotEntity(e))
  }

  const gameDate = useClock.getState().gameDate
  const meta = buildMeta(world, slot, gameDate)
  const bundle: SaveBundle = {
    version: SAVE_VERSION,
    seed: WORLD_SEED,
    meta,
    entities,
    subsystems: snapshotAll(),
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
      // Pre-v5 legacy bundles have gameDate at top level; v5+ have it
      // in subsystems.clock. Either is fine for fabricating fallback
      // metadata.
      const fallbackGameDate = bundle.gameDate
        ?? (bundle.subsystems?.clock as { gameDate?: Date } | undefined)?.gameDate
        ?? new Date()
      const meta: SaveMeta = bundle.meta ?? {
        slot: 'auto',
        version: bundle.version,
        savedAtRealMs: Date.now(),
        gameDate: fallbackGameDate,
        dayInGame: gameDayNumber(fallbackGameDate),
        playerMoney: 0,
        playerHp: 100,
        alive: bundle.entities.filter((s) => {
          const ch = s.character as { name?: unknown } | undefined
          const h = s.health as { dead?: boolean } | undefined
          return !!ch && (!h || !h.dead)
        }).length,
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
  // Accept any version 1..SAVE_VERSION; migrateLegacyBundle handles the
  // shape differences.
  if (bundle.version < 1 || bundle.version > SAVE_VERSION) {
    return { ok: false, reason: `version mismatch: save=${bundle.version} app=${SAVE_VERSION}` }
  }
  if (bundle.seed !== WORLD_SEED) {
    // Refuse rather than silently mis-overlay: different seeds generate
    // different sector slots, so EntityKeys won't line up.
    return { ok: false, reason: `seed mismatch: save=${bundle.seed} app=${WORLD_SEED}` }
  }

  const { subsystems, notices } = migrateLegacyBundle(bundle)

  // Stop systems so traits aren't mutated mid-patch. The loop subscribes
  // to 'load:start' to call stopLoop; this inversion keeps save/ free of
  // any import on sim/loop (see arch/current/001_component_layers).
  emitSim('load:start', { reason: 'save:load' })

  resetWorld()

  // 'pre' phase: handlers that must run before the entity overlay.
  // Currently just the active-scene handler — `world` proxy resolves to
  // the active scene, so byKey lookup needs the right world set first.
  // Three reasons the React tree must remount before we touch entities:
  // (a) world proxy resolves to `getActiveSceneId()`; resetWorld left it at
  //     initialSceneId, so a save taken in any other scene would overlay onto
  //     the wrong world without this.
  // (b) world.reset() clears koota's queriesHashMap. The existing useQuery
  //     instances become orphaned: the new entities spawned by setupWorld
  //     don't appear in their state, leaving the rendered scene empty.
  //     Bumping swapNonce forces App to remount via the keyed ScopedRoot.
  // (c) setupWorld only spawns the player in initialSceneId. A save taken in
  //     any other scene snapshots the player there, so we have to migrate the
  //     fresh player into the target scene before byKey lookup.
  restoreAll(subsystems, 'pre')

  // Resolved after the 'pre' phase: the active-scene handler may swap the
  // active scene id during restore (a save taken in any scene other than
  // initialSceneId), so we have to read the world *after* that swap.
  const world = getWorld(getActiveSceneId())

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
    const ch = snap.character as { name?: string; color?: string; title?: string } | undefined
    const pos = snap.position as { x?: number; y?: number } | undefined
    const e = spawnNPC(world, {
      name: ch?.name ?? snap.key,
      color: ch?.color ?? '#888',
      title: ch?.title ?? '市民',
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
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

  const restoreCtx: RestoreCtx = { resolveRef, version: bundle.version }
  const serializers = getTraitSerializers()

  for (const snap of bundle.entities) {
    const entity = byKey.get(snap.key)
    if (!entity) continue

    for (const s of serializers) {
      const v = snap[s.id]
      if (v !== undefined) {
        s.write(entity, v as never, restoreCtx)
      } else if (s.reset) {
        s.reset(entity)
      }
    }
  }

  // setupWorld spawns NPCs without Active — that's normally added on the
  // first activeZoneSystem tick. But loadGame auto-pauses, so no tick fires
  // and useQuery(Active, ...) in Game.tsx finds nothing → NPCs invisible
  // until the player unpauses. Mark every character Active here; the next
  // tick will demote any that are out of view.
  for (const entity of world.query(Character)) {
    if (!entity.has(Active)) entity.add(Active)
  }

  // 'post' phase: clock, population, ship, space, combat reset, engagement
  // reset, and any other registered subsystem. Order among these is
  // irrelevant — handlers are independent of each other.
  restoreAll(subsystems, 'post')

  for (const notice of notices) logEvent(notice)

  let playerCount = 0
  for (const _ of world.query(IsPlayer)) playerCount += 1
  if (playerCount !== 1) {
    console.warn(`[save/load] expected 1 player after load, found ${playerCount}`)
  }

  emitSim('load:end', { reason: 'save:load' })
  return { ok: true }
}

export async function deleteSave(slot: SlotId = 'auto'): Promise<void> {
  await del(bundleKey(slot))
  await del(metaKey(slot))
}
