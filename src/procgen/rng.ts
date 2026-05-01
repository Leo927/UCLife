// Wraps rot-js's global-singleton RNG so each instance carries its own
// state (saved + reinstalled around every draw). Lets independent generator
// passes share rot-js without trampling each other's streams.

import { RNG } from 'rot-js'

export class SeededRng {
  private state: ReturnType<typeof RNG.getState>

  private constructor(initialState: ReturnType<typeof RNG.getState>) {
    this.state = initialState
  }

  static fromNumber(seed: number): SeededRng {
    const prev = RNG.getState()
    RNG.setSeed(seed)
    const state = RNG.getState()
    RNG.setState(prev)
    return new SeededRng(state)
  }

  // FNV-1a-flavored 32-bit mixer — not cryptographic, just stable.
  static fromString(seed: string): SeededRng {
    let h = 0x811c9dc5
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i)
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
    }
    return SeededRng.fromNumber(h)
  }

  // Child RNG starting from this RNG's current state — for delegating
  // sub-work without interleaving draws.
  fork(): SeededRng {
    // Advance our state once so the fork doesn't replay our next draw.
    this.run(() => RNG.getUniform())
    return new SeededRng(this.state)
  }

  private run<T>(f: () => T): T {
    const prev = RNG.getState()
    RNG.setState(this.state)
    const out = f()
    this.state = RNG.getState()
    RNG.setState(prev)
    return out
  }

  uniform(): number {
    return this.run(() => RNG.getUniform())
  }

  // Inclusive on both ends.
  intRange(lo: number, hi: number): number {
    return this.run(() => Math.floor(RNG.getUniform() * (hi - lo + 1)) + lo)
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('SeededRng.pick: empty array')
    return arr[this.intRange(0, arr.length - 1)]
  }
}
