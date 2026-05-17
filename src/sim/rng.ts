// Process-global seeded RNG for runtime sim code (combat rolls, recruitment
// chances, immigrant variance, etc.). Distinct from procgen's per-pass
// SeededRng: this one is a *singleton* the whole sim shares so tests can
// pin determinism with a single setSimRngSeed() call.
//
// Implementation wraps procgen's SeededRng so both layers use the same
// rot-js-backed algorithm — one PRNG, two entry points.

import { SeededRng } from '../procgen/rng'

export interface SimRng {
  next(): number
  int(min: number, max: number): number
  pick<T>(arr: readonly T[]): T
}

class WrappedSimRng implements SimRng {
  constructor(private inner: SeededRng) {}

  next(): number {
    return this.inner.uniform()
  }

  int(min: number, max: number): number {
    return this.inner.intRange(min, max)
  }

  pick<T>(arr: readonly T[]): T {
    return this.inner.pick(arr)
  }

  swapInner(next: SeededRng): void {
    this.inner = next
  }

  getInner(): SeededRng {
    return this.inner
  }
}

function makeRng(seed: string | number): SeededRng {
  return typeof seed === 'string'
    ? SeededRng.fromString(seed)
    : SeededRng.fromNumber(seed)
}

let instance: WrappedSimRng = new WrappedSimRng(makeRng(Date.now()))

export function getSimRng(): SimRng {
  return instance
}

export function setSimRngSeed(seed: string | number): void {
  instance.swapInner(makeRng(seed))
}

export function getSimRngState(): unknown {
  return instance.getInner().snapshot()
}

export function setSimRngState(state: unknown): void {
  instance.getInner().restore(state as ReturnType<SeededRng['snapshot']>)
}
