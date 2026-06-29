// Lightweight per-frame timing helper. All overhead is behind the `enabled`
// guard — a disabled call costs exactly one boolean check + fn call overhead.
// Keeps a rolling sample set for p99 computation; clear with resetFrameStats().
//
// Usage from devtools:
//   __uclife__.frameProf(true)
//   // play for a few seconds
//   __uclife__.getFrameStats()  // → {mean, max, p99, calls} per phase

export interface FrameStats {
  mean: number
  max: number
  p99: number
  calls: number
}

interface PhaseData {
  sum: number
  max: number
  samples: number[]
  count: number
}

const phases = new Map<string, PhaseData>()
let profEnabled = false

export function setFrameProfEnabled(on: boolean): void {
  profEnabled = on
  if (!on) phases.clear()
}

export function isFrameProfEnabled(): boolean {
  return profEnabled
}

export function time<T>(name: string, fn: () => T): T {
  if (!profEnabled) return fn()
  const t0 = performance.now()
  const result = fn()
  const elapsed = performance.now() - t0
  let d = phases.get(name)
  if (!d) {
    d = { sum: 0, max: 0, samples: [], count: 0 }
    phases.set(name, d)
  }
  d.sum += elapsed
  d.count++
  if (elapsed > d.max) d.max = elapsed
  d.samples.push(elapsed)
  return result
}

export function getFrameStats(): Record<string, FrameStats> {
  const out: Record<string, FrameStats> = {}
  for (const [name, d] of phases) {
    if (d.count === 0) continue
    const sorted = [...d.samples].sort((a, b) => a - b)
    const p99idx = Math.min(Math.floor(sorted.length * 0.99), sorted.length - 1)
    out[name] = {
      mean: d.sum / d.count,
      max: d.max,
      p99: sorted[p99idx] ?? 0,
      calls: d.count,
    }
  }
  return out
}

export function resetFrameStats(): void {
  phases.clear()
}
