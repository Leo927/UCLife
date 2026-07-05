// `__uclife_test__` runtime — the sole wait primitive in test code.
// Sim clock is frozen in test mode (set by bootTestMode), so the only
// way time advances is via `step()`. See the deterministic-tests skill
// at .claude/skills/deterministic-tests/.
//
// Cadence is sign-off #4: predicate evaluated after EVERY game tick
// (~16 game-ms). If perf bites under a hot test, expose
// `evaluateEvery: N` later; do not pre-optimize.

import { advanceSimByGameMs } from './clock'
import { testConfig } from './test-config'
import { getGameState } from './gameStateView'

const TICK_GAME_MS = testConfig.tickGameMs
const MS_PER_GAME_MINUTE = testConfig.msPerGameMinute
const MAX_STEP_TICKS = testConfig.maxStepTicks

export interface StepUntilOpts {
  until: () => boolean
  maxGameMinutes: number
  // Coarse mode: advance in testConfig.coarseSliceGameMs slices (predicate
  // checked once per slice) instead of the 16ms tick. For ground / UI waits
  // in a heavily-populated scene, where each game-minute is ~3750 full-city
  // ticks; unsafe while combat / space flight needs sub-minute fidelity.
  coarse?: boolean
}

export interface StepMinutesOpts {
  gameMinutes: number
  // Coarse mode: advance in testConfig.coarseSliceGameMs slices instead of the
  // 16ms interactive tick. For long IDLE advances only (multi-day delivery
  // lead): a game-day is ~5.4M ticks at 16ms — infeasible under the step-tick
  // bound / wall clock — but ~1.4k coarse slices. Still fires every per-minute
  // + day-rollover boundary (advanceSimByGameMs runs the minute-gated block
  // once per slice), so deliveries + rollovers land faithfully. Unsafe while
  // anything needs sub-minute fidelity (combat, space flight, a smooth walk).
  coarse?: boolean
}

export type StepOpts = StepUntilOpts | StepMinutesOpts

function isUntilForm(opts: StepOpts): opts is StepUntilOpts {
  return typeof (opts as StepUntilOpts).until === 'function'
}

function snapshotForFailure(): string {
  try {
    const view = getGameState()
    return JSON.stringify(view, null, 2)
  } catch (e) {
    // Phase 5's getGameState() ships later. Until then, the stub throws —
    // surface a clear "snapshot unavailable" message rather than mask the
    // real assertion failure.
    return `<getGameState unavailable: ${(e as Error).message}>`
  }
}

/**
 * Advance sim time tick-by-tick. Two forms:
 *
 *   step({ until, maxGameMinutes }) — advance one tick at a time,
 *     evaluating `until()` after each. Resolves when it returns true.
 *     Throws with the predicate text + game-state snapshot if
 *     `maxGameMinutes` of sim time elapse without satisfaction.
 *
 *   step({ gameMinutes }) — unconditional advancement by N minutes.
 *
 * The Promise return shape is preserved for API parity even though the
 * advancement is synchronous; tests await it so future async hooks
 * (e.g. yield-microtask between ticks to let React commits flush) can
 * be added without breaking call sites.
 */
export async function step(opts: StepOpts): Promise<void> {
  if (isUntilForm(opts)) {
    return stepUntil(opts)
  }
  return stepMinutes(opts)
}

async function stepUntil(opts: StepUntilOpts): Promise<void> {
  if (opts.until()) return
  const budgetMs = opts.maxGameMinutes * MS_PER_GAME_MINUTE
  const sliceMs = opts.coarse ? testConfig.coarseSliceGameMs : TICK_GAME_MS
  let elapsedMs = 0
  let ticks = 0
  while (elapsedMs < budgetMs && ticks < MAX_STEP_TICKS) {
    const slice = budgetMs - elapsedMs < sliceMs ? budgetMs - elapsedMs : sliceMs
    advanceSimByGameMs(slice)
    elapsedMs += slice
    ticks++
    if (opts.until()) return
  }
  const predicateText = opts.until.toString().slice(0, 200)
  throw new Error(
    `step({ until }) — predicate never satisfied within ${opts.maxGameMinutes} game-minute(s) ` +
    `(${ticks} ticks, ${elapsedMs}ms sim). predicate=${predicateText}. ` +
    `snapshot=${snapshotForFailure()}`,
  )
}

async function stepMinutes(opts: StepMinutesOpts): Promise<void> {
  const totalMs = opts.gameMinutes * MS_PER_GAME_MINUTE
  const sliceMs = opts.coarse ? testConfig.coarseSliceGameMs : TICK_GAME_MS
  let advancedMs = 0
  let ticks = 0
  while (advancedMs < totalMs && ticks < MAX_STEP_TICKS) {
    const remaining = totalMs - advancedMs
    const slice = remaining < sliceMs ? remaining : sliceMs
    advanceSimByGameMs(slice)
    advancedMs += slice
    ticks++
  }
  if (advancedMs < totalMs) {
    throw new Error(
      `step({ gameMinutes: ${opts.gameMinutes} }) — hit MAX_STEP_TICKS=${MAX_STEP_TICKS} after ` +
      `${advancedMs}ms (target ${totalMs}ms). Pick a smaller window or raise the bound.`,
    )
  }
}
