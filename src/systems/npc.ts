// NPC system: bucketed reasoning scheduler. The behavior tree was originally
// stepped once per render frame (60 fps × N NPCs) which dominated CPU at
// population 30+. Now we use a 3-component design that decouples decision
// rate from frame rate without breaking drive-interrupt reactivity:
//
//   1. Dynamic interval (logarithmic-ish in game speed). Each NPC re-thinks
//      every `intervalGameMin(speed)` game-minutes — slower at higher speeds
//      so per-real-second CPU stays bounded. 1× → 1, 2× → 3, 4× → 6,
//      hyperspeed (≥100×) → 10. Hand-fitted from the user's design call.
//
//   2. Bucket dispatch. Each NPC is assigned to one of 60 buckets at first
//      sight (bucket = entity.id() % 60). A real-time accumulator advances
//      a cursor across the buckets at rate = 60 / cycle, where the cycle
//      length in real-ms is interval-game-min / game-speed. When the cursor
//      crosses a bucket boundary, *only* that bucket's NPCs step their BT
//      — explicit list iteration, no per-NPC scan. The 60 buckets spread
//      reasoning load evenly so we never spike on a "everyone thinks now"
//      tick.
//
//   3. Newly-idle wake. When an NPC's action transitions to 'idle' (e.g.
//      mistreevous returned SUCCEEDED on the running branch), step its BT
//      once *now* instead of waiting for its bucket to fire. Keeps NPCs
//      from sitting at a finished task for up to one cycle.
//
// Trees are still cached per entity, lazily constructed on first BT step.

import type { Entity, World } from 'koota'
import { Not } from 'koota'
import { BehaviourTree } from 'mistreevous'
import { Active, Character, Position, Action, Health, Vitals, Inventory, Money, IsPlayer } from '../ecs/traits'
import { makeNPCAgent, type NPCAgent } from '../ai/agent'
import { NPC_TREE } from '../ai/trees'
import { useDebug } from '../debug/store'
import { useClock, formatUC } from '../sim/clock'
import { worldConfig } from '../config'

const INACTIVE_COARSE_TICK_MS = worldConfig.activeZone.inactiveCoarseTickMin * 60 * 1000

// Per-entity cache of (tree, agent). The agent reference lets stepBT call
// agent.refreshContext() before tree.step() — Vitals alone is read by 5
// condition functions per step, so dedup-on-step is worth ~5×.
type CachedTree = { tree: BehaviourTree; agent: NPCAgent }
const trees = new Map<Entity, CachedTree>()

const BUCKET_COUNT = 60

const npcsByBucket: Entity[][] = Array.from({ length: BUCKET_COUNT }, () => [])
const bucketAssignment = new Map<Entity, number>()

let bucketCursor = 0
let bucketAccumMs = 0

const lastActionKind = new Map<Entity, string>()

// Gate Inactive NPCs to `inactiveCoarseTickMin` game-min between steps,
// regardless of bucket-fire rate. Active NPCs ignore this gate.
const lastBTStepGameMs = new Map<Entity, number>()

// Self-completing on vitals — stepping the BT every cycle is wasted work.
// vitalsSystem flips wakePending whenever a vital crosses a threshold; the
// per-frame newly-idle pass catches the action-end transition.
const COMMITTED_KINDS: ReadonlySet<string> = new Set([
  'eating', 'drinking', 'sleeping', 'working', 'reveling', 'chatting', 'washing',
])

const wakePending = new Set<Entity>()

export function requestNpcWake(entity: Entity): void {
  wakePending.add(entity)
}

// Hand-fitted curve. Anchors: 1×→1, 2×→3, 4×→6, ≥100×→10 game-min.
function intervalGameMin(speed: number): number {
  if (speed <= 1) return 1
  if (speed >= 100) return 10
  if (speed <= 2) return 1 + 2 * (speed - 1)
  if (speed <= 4) return 3 + 1.5 * (speed - 2)
  return 6 + 4 * Math.log(speed / 4) / Math.log(25)
}

function ensureBucketed(entity: Entity): void {
  if (bucketAssignment.has(entity)) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const idAny = (entity as any).id?.() ?? (entity as unknown as number)
  const id = (idAny | 0) & 0x7fffffff
  const bucket = id % BUCKET_COUNT
  bucketAssignment.set(entity, bucket)
  npcsByBucket[bucket].push(entity)
}

// Single try/catch site so the scheduler doesn't unwind on one broken tree.
function stepBT(world: World, npc: Entity): void {
  if (!npc.has(Character)) return
  const h = npc.get(Health)
  if (h?.dead) return
  const cached = getOrCreateTree(world, npc)
  try {
    cached.agent.refreshContext()
    cached.tree.step()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[npcSystem] tree.step() threw for entity', npc, err)
  }
}

export function resetNpcBuckets(): void {
  for (const arr of npcsByBucket) arr.length = 0
  bucketAssignment.clear()
  lastActionKind.clear()
  wakePending.clear()
  lastBTStepGameMs.clear()
  bucketCursor = 0
  bucketAccumMs = 0
}

// Per-call zustand read + Function.prototype.apply was material at full
// population × 60 fps, so the no-trace path is now a direct call.
function wrapWithTrace(_world: World, entity: Entity, agent: NPCAgent): NPCAgent {
  const proxy: Record<string, unknown> = {}
  for (const key of Object.keys(agent) as (keyof NPCAgent)[]) {
    const fn = agent[key]
    if (typeof fn !== 'function') {
      proxy[key as string] = fn
      continue
    }
    proxy[key as string] = (...args: unknown[]) => {
      const traceName = useDebug.getState().traceName
      const ch = entity.get(Character)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (fn as any).apply(agent, args)
      if (traceName && ch?.name === traceName) {
        const v = entity.get(Vitals)
        const inv = entity.get(Inventory)
        const m = entity.get(Money)
        const p = entity.get(Position)
        const a = entity.get(Action)
        // eslint-disable-next-line no-console
        console.log(
          `[trace ${formatUC(useClock.getState().gameDate)}] ${ch.name} ${String(key)} -> ${result} ` +
          `act=${a?.kind} hp=? hung=${v?.hunger.toFixed(0)} thir=${v?.thirst.toFixed(0)} ` +
          `meal=${inv?.meal} water=${inv?.water} $${m?.amount} @(${p?.x.toFixed(0)},${p?.y.toFixed(0)})`,
        )
      }
      return result
    }
  }
  return proxy as NPCAgent
}

function getOrCreateTree(world: World, entity: Entity): CachedTree {
  let cached = trees.get(entity)
  if (!cached) {
    const rawAgent = makeNPCAgent(world, entity)
    // Trace wrapper is decided at tree-creation time; toggling later requires
    // resetNpcTrees() to re-wrap existing entries.
    const traceActive = useDebug.getState().traceName !== null && useDebug.getState().traceName !== ''
    const agent = traceActive ? wrapWithTrace(world, entity, rawAgent) : rawAgent
    const tree = new BehaviourTree(NPC_TREE, agent)
    cached = { tree, agent }
    trees.set(entity, cached)
  }
  return cached
}

export function resetNpcTrees(): void {
  trees.clear()
}

export function npcSystem(world: World, dtMs: number, gameSpeed: number): void {
  if (gameSpeed <= 0) return

  const playerAutoAI = useDebug.getState().playerAutoAI
  // Query must NOT require MoveTarget — both the I→I teleport shortcut in
  // agent.setMoveTarget and the demote-to-teleport in activeZoneSystem clear
  // MoveTarget after a Position jump, and a filtered query would leave those
  // NPCs un-bucketed and stranded as static bodies.
  const query = playerAutoAI
    ? world.query(Character, Position, Action)
    : world.query(Character, Position, Action, Not(IsPlayer))
  const gameMs = useClock.getState().gameDate.getTime()

  // Newly-idle wake. mistreevous selectors are sticky on RUNNING — without
  // this trigger, an NPC that just finished a task would sit at idle until
  // its bucket fires, possibly several game-minutes later.
  const newlyIdle: Entity[] = []
  for (const npc of query) {
    const h = npc.get(Health)
    if (h?.dead) continue
    ensureBucketed(npc)
    const a = npc.get(Action)!
    const prev = lastActionKind.get(npc)
    if (a.kind === 'idle' && prev !== undefined && prev !== 'idle') {
      newlyIdle.push(npc)
    }
    lastActionKind.set(npc, a.kind)
  }
  for (const npc of newlyIdle) {
    wakePending.delete(npc)
    stepBT(world, npc)
    lastBTStepGameMs.set(npc, gameMs)
  }

  // gameSpeed is in game-min per real-sec, so cycleRealSec =
  // interval(gameMin) / gameSpeed. Cap fired buckets per frame so a tab that
  // accumulated huge dt can't lock the main thread on its wake-up frame.
  const interval = intervalGameMin(gameSpeed)
  const cycleRealMs = (interval / gameSpeed) * 1000
  const bucketRealMs = cycleRealMs / BUCKET_COUNT
  bucketAccumMs += dtMs
  let firedBuckets = 0
  while (bucketAccumMs >= bucketRealMs && firedBuckets < BUCKET_COUNT) {
    bucketAccumMs -= bucketRealMs
    bucketCursor = (bucketCursor + 1) % BUCKET_COUNT
    firedBuckets++
    const bucket = npcsByBucket[bucketCursor]
    // Back-to-front so destroyed entries can be spliced cheaply. Liveness
    // probe = !npc.has(Character).
    for (let i = bucket.length - 1; i >= 0; i--) {
      const npc = bucket[i]
      if (!npc.has(Character)) {
        bucket.splice(i, 1)
        bucketAssignment.delete(npc)
        // Drop the cached tree — koota may reuse ids, and leaked trees would
        // hold destroyed entities' stale data.
        trees.delete(npc)
        lastActionKind.delete(npc)
        wakePending.delete(npc)
        lastBTStepGameMs.delete(npc)
        continue
      }
      if (!playerAutoAI && npc.has(IsPlayer)) continue
      const k = lastActionKind.get(npc)
      const wakeSet = wakePending.has(npc)
      if (k !== undefined && COMMITTED_KINDS.has(k) && !wakeSet) continue
      // Inactive coarse-tick gate; wakePending overrides so a threshold
      // crossing still steps right away.
      if (!wakeSet && !npc.has(Active)) {
        const last = lastBTStepGameMs.get(npc) ?? -Infinity
        if (gameMs - last < INACTIVE_COARSE_TICK_MS) continue
      }
      wakePending.delete(npc)
      stepBT(world, npc)
      lastBTStepGameMs.set(npc, gameMs)
    }
  }
  // Clamp leftover from a hit firedBuckets cap so we don't carry a
  // multi-second backlog into one future frame and re-spike.
  if (bucketAccumMs > bucketRealMs * BUCKET_COUNT) {
    bucketAccumMs = bucketRealMs * BUCKET_COUNT
  }
}
