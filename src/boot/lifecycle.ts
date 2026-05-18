// Sim lifecycle bootstrap. Invoked once from src/main.tsx before
// React mounts; the render layer must not own this. setupWorld and
// startLoop each carry their own internal idempotency guard, but
// bootstrapApp also short-circuits so callers reading this file see
// "called once" as the contract, not "trust the callees".

import { setupWorld, type SetupWorldOpts } from '../ecs/spawn'
import { startLoop } from '../sim/loop'

let booted = false

export interface BootstrapOpts {
  // Test-mode boot path opt-out: when a fixture is going to populate
  // the player itself, the default initial-scene spawn must be
  // skipped so getPlayerCharacter() sees only the fixture entity.
  skipDefaultPlayer?: boolean
}

export function bootstrapApp(opts: BootstrapOpts = {}): void {
  if (booted) return
  booted = true
  const setupOpts: SetupWorldOpts = {
    skipDefaultPlayer: opts.skipDefaultPlayer ?? false,
  }
  setupWorld(setupOpts)
  startLoop()
}

export function __resetBootstrapForTests(): void {
  booted = false
}
