// Asymmetric Knows graph (A→B and B→A stored independently, updated in
// lockstep). Sparse — edges only exist between pairs that have been near
// each other.

import type { World } from 'koota'
import { Active, Character, Position, Health, Knows, EntityKey, Action, ChatTarget } from '../ecs/traits'
import { aiConfig, actionsConfig } from '../config'
import { useDebug } from '../debug/store'
import { formatUC } from '../sim/clock'
import { statValue } from './attributes'
import { statMult } from '../data/stats'

const R = aiConfig.relations
const PROX_SQ = R.proximityRadiusPx * R.proximityRadiusPx
const GREET_COOLDOWN_MS = R.greetCooldownMin * 60 * 1000
const LOG_COOLDOWN_MS = R.logCooldownMin * 60 * 1000

// Per-pair log throttle — separate from per-edge lastSeenMs because the
// log can be spammier than the gameplay event.
const lastLogMsByPair = new Map<string, number>()

// Tracks last day index decay ran so load/time-skip doesn't double or skip.
let lastDecayDay = -1

function relationLogTier(opinion: number): string {
  if (opinion >= 40) return '友好地'
  if (opinion <= -40) return '冷冷地'
  if (opinion >= 10) return '热情地'
  if (opinion <= -10) return '勉强地'
  return '简短地'
}

// Direction-insensitive — both A→B and B→A share one log slot.
function pairKey(a: ReturnType<World['queryFirst']>, b: ReturnType<World['queryFirst']>): string {
  const ka = (a as unknown as number) | 0
  const kb = (b as unknown as number) | 0
  return ka < kb ? `${ka}:${kb}` : `${kb}:${ka}`
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

interface BodySlot {
  e: ReturnType<World['queryFirst']>
  x: number
  y: number
  // Visit each pair once: B updates A only if bodyIdx[B] > bodyIdx[A].
  bodyIdx: number
  // Cached entity.has(Active) so inner pair loop skips off-camera pairs
  // without a koota mask check per neighbor visit.
  active: boolean
}

// Drift is multiplied by elapsedMin so cadence is gameplay-equivalent;
// greets/chat-bonus/decay use absolute lastSeenMs.
const RELATIONS_TICK_MIN = 5
let relAccumMin = 0

// Refresh window for fully-saturated pairs. LONELY_WINDOW (1440 min) and
// GREET_COOLDOWN (360 min) are both much larger, so the lag in stored
// lastSeenMs doesn't observably affect those gates.
const SATURATED_REFRESH_MS = 60 * 60 * 1000

export function relationsSystem(world: World, gameDate: Date, gameMinutes: number): void {
  relAccumMin += gameMinutes
  if (relAccumMin < RELATIONS_TICK_MIN) return
  const elapsedMin = relAccumMin
  relAccumMin = 0

  const nowMs = gameDate.getTime()

  const bodies: BodySlot[] = []
  for (const e of world.query(Character, Position, Health)) {
    if (e.get(Health)!.dead) continue
    const p = e.get(Position)!
    bodies.push({ e, x: p.x, y: p.y, bodyIdx: bodies.length, active: e.has(Active) })
  }

  // CELL = 96px ≥ proximityRadiusPx=80, so every in-range pair shares a
  // cell or an adjacent cell.
  const CELL = 96
  const buckets = new Map<number, BodySlot[]>()
  for (const b of bodies) {
    const cx = Math.floor(b.x / CELL)
    const cy = Math.floor(b.y / CELL)
    const key = ((cy + 0x8000) << 16) | ((cx + 0x8000) & 0xffff)
    let bucket = buckets.get(key)
    if (!bucket) { bucket = []; buckets.set(key, bucket) }
    bucket.push(b)
  }
  for (let i = 0; i < bodies.length; i++) {
    const A = bodies[i]
    const acx = Math.floor(A.x / CELL)
    const acy = Math.floor(A.y / CELL)
    for (let dyc = -1; dyc <= 1; dyc++) {
      for (let dxc = -1; dxc <= 1; dxc++) {
        const key = ((acy + dyc + 0x8000) << 16) | ((acx + dxc + 0x8000) & 0xffff)
        const bucket = buckets.get(key)
        if (!bucket) continue
        for (let k = 0; k < bucket.length; k++) {
          const B = bucket[k]
          if (B.bodyIdx <= i) continue
          if (!A.active && !B.active) continue
          const dx = A.x - B.x
          const dy = A.y - B.y
          const distSq = dx * dx + dy * dy
          if (distSq > PROX_SQ) continue

      // Lazy-create both directions on first encounter so the edge data
      // can be read uniformly below.
      const a = A.e!
      const b = B.e!
      if (!a.has(Knows(b))) a.add(Knows(b))
      if (!b.has(Knows(a))) b.add(Knows(a))
      const ab = a.get(Knows(b))!
      const ba = b.get(Knows(a))!

      // Skip get/set overhead when both sides are familiarity-max and
      // lastSeenMs is fresh — drift would clamp, no greet is due.
      if (
        ab.familiarity >= R.familiarityMax
        && ba.familiarity >= R.familiarityMax
        && nowMs - ab.lastSeenMs < SATURATED_REFRESH_MS
      ) continue

      // Target's charisma scales the source's opinion accrual. Familiarity
      // is charisma-blind.
      const charismaOnA = statMult(statValue(a, 'charisma'))
      const charismaOnB = statMult(statValue(b, 'charisma'))

      // lastSeenMs === 0 means "never seen" so the first iteration always fires.
      const isGreet = ab.lastSeenMs === 0 || (nowMs - ab.lastSeenMs) >= GREET_COOLDOWN_MS
      if (isGreet) {
        const isFirst = ab.meetCount === 0
        const dOp = isFirst ? R.firstGreetOpinion : R.greetOpinion
        const dFa = isFirst ? R.firstGreetFamiliarity : R.greetFamiliarity
        ab.opinion = clamp(ab.opinion + dOp * charismaOnB, R.opinionMin, R.opinionMax)
        ba.opinion = clamp(ba.opinion + dOp * charismaOnA, R.opinionMin, R.opinionMax)
        ab.familiarity = clamp(ab.familiarity + dFa, 0, R.familiarityMax)
        ba.familiarity = clamp(ba.familiarity + dFa, 0, R.familiarityMax)
        ab.meetCount += 1
        ba.meetCount += 1

        if (useDebug.getState().logNpcs) {
          const key = pairKey(a, b)
          const lastLog = lastLogMsByPair.get(key) ?? 0
          if (nowMs - lastLog >= LOG_COOLDOWN_MS) {
            const aName = a.get(Character)!.name
            const bName = b.get(Character)!.name
            // eslint-disable-next-line no-console
            console.log(
              `[social] ${formatUC(gameDate)} ${aName} ${relationLogTier(ab.opinion)}向 ${bName} 打招呼` +
              (isFirst ? '（初次见面）' : ''),
            )
            lastLogMsByPair.set(key, nowMs)
          }
        }
      }

      // elapsedMin (accumulated since last RELATIONS_TICK_MIN flush) keeps
      // long-run accrual identical regardless of cadence.
      const dOp = R.colocationOpinionPerMin * elapsedMin
      const dFa = R.colocationFamiliarityPerMin * elapsedMin
      ab.opinion = clamp(ab.opinion + dOp * charismaOnB, R.opinionMin, R.opinionMax)
      ba.opinion = clamp(ba.opinion + dOp * charismaOnA, R.opinionMin, R.opinionMax)
      ab.familiarity = clamp(ab.familiarity + dFa, 0, R.familiarityMax)
      ba.familiarity = clamp(ba.familiarity + dFa, 0, R.familiarityMax)

      // Guard chat-trait reads behind a has() probe — most co-located
      // pairs aren't chatting, and koota's has() is faster than get().
      if (a.has(ChatTarget) && b.has(ChatTarget)) {
        const aAct = a.get(Action)
        const bAct = b.get(Action)
        const aTarget = a.get(ChatTarget)
        const bTarget = b.get(ChatTarget)
        const mutualChat = aAct?.kind === 'chatting' && bAct?.kind === 'chatting'
          && aTarget?.partner === b && bTarget?.partner === a
        if (mutualChat) {
          const dChat = actionsConfig.chatting.opinionPerMin * elapsedMin
          ab.opinion = clamp(ab.opinion + dChat * charismaOnB, R.opinionMin, R.opinionMax)
          ba.opinion = clamp(ba.opinion + dChat * charismaOnA, R.opinionMin, R.opinionMax)
        }
      }
      ab.lastSeenMs = nowMs
      ba.lastSeenMs = nowMs

      a.set(Knows(b), ab)
      b.set(Knows(a), ba)
        }
      }
    }
  }

  const dayIdx = Math.floor(nowMs / (24 * 60 * 60 * 1000))
  if (lastDecayDay === -1) {
    lastDecayDay = dayIdx
  } else if (dayIdx > lastDecayDay) {
    lastDecayDay = dayIdx
    decayAllRelations(world)
  }
}

function decayAllRelations(world: World): void {
  for (const a of world.query(Character)) {
    for (const b of a.targetsFor(Knows)) {
      const e = a.get(Knows(b))!
      const opinion = e.opinion * R.dailyOpinionDecay
      const familiarity = e.familiarity * R.dailyFamiliarityDecay
      a.set(Knows(b), { ...e, opinion, familiarity })
    }
  }
}

// Log throttle map is keyed by raw entity ids — MUST clear on world rebuild
// or stale timestamps will silently suppress logs in the new world.
export function resetRelationsClock(): void {
  lastDecayDay = -1
  relAccumMin = 0
  lastLogMsByPair.clear()
  resetIsolationCache()
}

export type RelationTier = 'stranger' | 'acquaintance' | 'friend' | 'rival' | 'enemy'

// Tier derived on read; avoids hysteresis if BT branches on transitions.
export function tierOf(opinion: number, familiarity: number): RelationTier {
  if (familiarity < 5) return 'stranger'
  if (opinion >= 40) return 'friend'
  if (opinion <= -40) return 'enemy'
  if (opinion <= -10) return 'rival'
  return 'acquaintance'
}

export const TIER_LABEL_ZH: Record<RelationTier, string> = {
  stranger: '陌生人',
  acquaintance: '熟人',
  friend: '朋友',
  rival: '看不顺眼',
  enemy: '仇人',
}

// lonelyBoredomMult when no friend-tier+ relation seen in lonelyWindowMin;
// 1.0 otherwise.
const LONELY_WINDOW_MS = R.lonelyWindowMin * 60 * 1000
// Per-entity TTL cache: vitalsSystem calls this every tick for every alive
// NPC, and an uncached scan is O(N²). 30-game-min TTL is acceptable —
// friend-tier transitions happen on game-day timescales.
const ISO_TTL_MS = 30 * 60 * 1000
const isoCacheMs = new Map<ReturnType<World['queryFirst']>, number>()
const isoCacheVal = new Map<ReturnType<World['queryFirst']>, number>()

export function resetIsolationCache(): void {
  isoCacheMs.clear()
  isoCacheVal.clear()
}

export function isolationMultiplier(
  entity: ReturnType<World['queryFirst']>,
  nowMs: number,
): number {
  if (!entity) return 1
  const lastMs = isoCacheMs.get(entity)
  if (lastMs !== undefined && nowMs - lastMs < ISO_TTL_MS) {
    return isoCacheVal.get(entity)!
  }
  let mult = R.lonelyBoredomMult
  for (const target of entity.targetsFor(Knows)) {
    const e = entity.get(Knows(target))
    if (!e) continue
    if (nowMs - e.lastSeenMs > LONELY_WINDOW_MS) continue
    if (tierOf(e.opinion, e.familiarity) === 'friend') { mult = 1; break }
  }
  isoCacheMs.set(entity, nowMs)
  isoCacheVal.set(entity, mult)
  return mult
}

export function topRelationsFor(
  entity: ReturnType<World['queryFirst']>,
  k: number,
): Array<{ target: ReturnType<World['queryFirst']>; data: { opinion: number; familiarity: number; lastSeenMs: number; meetCount: number }; tier: RelationTier }> {
  if (!entity) return []
  const targets = entity.targetsFor(Knows)
  const out = targets.map((t) => {
    const data = entity.get(Knows(t))!
    return { target: t, data, tier: tierOf(data.opinion, data.familiarity) }
  })
  out.sort((a, b) => Math.abs(b.data.opinion) - Math.abs(a.data.opinion))
  return out.slice(0, k)
}

// EntityKey is required — edges between unkeyed entities can't survive a load.
export interface RelationSnap {
  srcKey: string
  tgtKey: string
  opinion: number
  familiarity: number
  lastSeenMs: number
  meetCount: number
}

export function snapshotRelations(world: World): RelationSnap[] {
  const out: RelationSnap[] = []
  for (const a of world.query(Character, EntityKey)) {
    const aKey = a.get(EntityKey)!.key
    for (const b of a.targetsFor(Knows)) {
      if (!b.has(EntityKey)) continue
      const bKey = b.get(EntityKey)!.key
      const d = a.get(Knows(b))!
      out.push({
        srcKey: aKey,
        tgtKey: bKey,
        opinion: d.opinion,
        familiarity: d.familiarity,
        lastSeenMs: d.lastSeenMs,
        meetCount: d.meetCount,
      })
    }
  }
  return out
}

export function restoreRelations(
  world: World,
  byKey: Map<string, ReturnType<World['queryFirst']>>,
  snaps: RelationSnap[],
): void {
  for (const s of snaps) {
    const a = byKey.get(s.srcKey)
    const b = byKey.get(s.tgtKey)
    if (!a || !b) continue
    if (!a.has(Knows(b))) a.add(Knows(b))
    a.set(Knows(b), {
      opinion: s.opinion,
      familiarity: s.familiarity,
      lastSeenMs: s.lastSeenMs,
      meetCount: s.meetCount,
    })
  }
  void world
}
