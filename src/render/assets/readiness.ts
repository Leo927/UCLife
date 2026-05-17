// Asset-readiness barrier. The smoke suite needs a deterministic signal
// that every in-flight async asset job (portrait cache load, sprite
// compose, texture-bundle load) has drained before it asserts on the DOM.
// Without this, tests reach for `waitForTimeout(N)` and roll the dice on
// CI load. See CLAUDE.md "Smoke-test reliability — non-negotiable".
//
// API contract:
//   - `beginAssetJob(label?)` returns an end-callback. Call it once per
//     job completion (success OR failure). Calling it twice is a no-op,
//     so `try / finally` is safe even if the same handle is invoked
//     elsewhere defensively.
//   - `awaitAssetsReady({ timeoutMs })` resolves when `pendingAssetJobs()`
//     reaches 0. If already 0, it yields one microtask first (so callers
//     can be sure they yielded before checking downstream state). On
//     timeout, rejects with an error naming every still-pending label —
//     "<unlabeled>" stands in for jobs that didn't pass one.
//
// Why module-level state? The barrier is global — one process, one
// pending counter. Tests reset between cases via
// `__resetAssetReadinessForTests()`.

interface PendingJob {
  id: number
  label: string
}

const UNLABELED = '<unlabeled>'
const DEFAULT_TIMEOUT_MS = 30_000

let nextId = 1
const pending = new Map<number, PendingJob>()
const waiters: Array<() => void> = []

export interface AwaitAssetsReadyOptions {
  /** Reject after this many ms if jobs haven't drained. Default 30s. */
  timeoutMs?: number
}

export function beginAssetJob(label?: string): () => void {
  const id = nextId++
  pending.set(id, { id, label: label ?? UNLABELED })
  let ended = false
  return function endAssetJob(): void {
    if (ended) return
    ended = true
    pending.delete(id)
    if (pending.size === 0) drainWaiters()
  }
}

export function pendingAssetJobs(): number {
  return pending.size
}

export function snapshotPendingAssetLabels(): string[] {
  const out: string[] = []
  for (const job of pending.values()) out.push(job.label)
  return out
}

export function awaitAssetsReady(opts: AwaitAssetsReadyOptions = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise<void>((resolve, reject) => {
    if (pending.size === 0) {
      queueMicrotask(resolve)
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      const idx = waiters.indexOf(onReady)
      if (idx >= 0) waiters.splice(idx, 1)
      const labels = snapshotPendingAssetLabels()
      reject(new Error(
        `awaitAssetsReady: timed out after ${timeoutMs}ms with ${labels.length} pending job(s): ${labels.join(', ')}`,
      ))
    }, timeoutMs)
    function onReady(): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    waiters.push(onReady)
  })
}

function drainWaiters(): void {
  while (waiters.length > 0) {
    const next = waiters.shift()
    if (next) next()
  }
}

/** Test-only: clear all state. Production code never calls this. */
export function __resetAssetReadinessForTests(): void {
  pending.clear()
  waiters.length = 0
  nextId = 1
}
