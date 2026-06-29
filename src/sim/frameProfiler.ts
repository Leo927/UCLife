// Frame-time profiler. Both RAF loops — the sim loop (src/sim/loop.ts) and
// the render/snapshot loop (src/render/Game.tsx) — push per-stage wall times
// here so a "noticeable FPS drop" can be attributed to the loop that owns it.
//
// The metric is ms/frame decomposed by stage, not FPS: FPS is a smoothed
// lagging readout that hides the tail-latency hitch. count/total/max are
// cumulative since the last reset (cf. hpaStats in src/systems/hpa.ts); the
// tail percentile is windowed so it reflects the *recent* worst frames.
//
// Negligible overhead when disabled — every recorder early-returns on
// `frameStats.enabled === false`. Enable via FRAME_PROF=1 (Node harness) or
// the `frameProf()` debug handle in the browser.

import { frameProfConfig } from '../config/frameProf'

const WINDOW = frameProfConfig.windowSize
const PERCENTILE = frameProfConfig.percentile
const BUDGET_MS = frameProfConfig.budgetMs

// Reserved stage name for the realized inter-frame interval (1000 / mean ≈
// realized FPS). markFrame() owns it.
const FRAME_STAGE = 'frame'

interface Stage {
  count: number
  totalMs: number
  maxMs: number
  ring: Float64Array
  pos: number
  filled: number
}

function makeStage(): Stage {
  return { count: 0, totalMs: 0, maxMs: 0, ring: new Float64Array(WINDOW), pos: 0, filled: 0 }
}

const stages = new Map<string, Stage>()
let lastFrameTs = 0

export const frameStats = {
  enabled: ((): boolean => {
    try {
      return typeof process !== 'undefined' && process.env?.FRAME_PROF === '1'
    } catch { return false }
  })(),
}

export function recordStage(name: string, ms: number): void {
  let s = stages.get(name)
  if (!s) { s = makeStage(); stages.set(name, s) }
  s.count++
  s.totalMs += ms
  if (ms > s.maxMs) s.maxMs = ms
  s.ring[s.pos] = ms
  s.pos = (s.pos + 1) % WINDOW
  if (s.filled < WINDOW) s.filled++
}

// Record the wall-clock gap between successive frames. The first call after a
// reset only seeds the anchor — there is no prior timestamp to diff against.
export function markFrame(nowMs: number): void {
  if (lastFrameTs > 0) recordStage(FRAME_STAGE, nowMs - lastFrameTs)
  lastFrameTs = nowMs
}

// Time a synchronous call under a named stage. No-op wrapper (just calls fn)
// when disabled, so it's safe to leave in hot paths.
export function time<T>(name: string, fn: () => T): T {
  if (!frameStats.enabled) return fn()
  const t0 = performance.now()
  const r = fn()
  recordStage(name, performance.now() - t0)
  return r
}

function tailOf(s: Stage): number {
  if (s.filled === 0) return 0
  const sorted = Array.from(s.ring.subarray(0, s.filled)).sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(PERCENTILE * sorted.length) - 1))
  return sorted[idx]
}

export interface StageReport {
  count: number
  meanMs: number
  maxMs: number
  tailMs: number
  overBudget: boolean
}

export interface FrameReport {
  percentile: number
  budgetMs: number
  stages: Record<string, StageReport>
}

export function getFrameStats(): FrameReport {
  const out: Record<string, StageReport> = {}
  for (const [name, s] of stages) {
    const tailMs = tailOf(s)
    out[name] = {
      count: s.count,
      meanMs: s.count > 0 ? s.totalMs / s.count : 0,
      maxMs: s.maxMs,
      tailMs,
      overBudget: tailMs > BUDGET_MS,
    }
  }
  return { percentile: PERCENTILE, budgetMs: BUDGET_MS, stages: out }
}

export function resetFrameStats(): void {
  stages.clear()
  lastFrameTs = 0
}
