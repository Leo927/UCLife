// Sim lifecycle bootstrap. Invoked once from src/main.tsx before
// React mounts; the render layer must not own this. setupWorld and
// startLoop each carry their own internal idempotency guard, but
// bootstrapApp also short-circuits so callers reading this file see
// "called once" as the contract, not "trust the callees".

import { setupWorld } from '../ecs/spawn'
import { startLoop } from '../sim/loop'

let booted = false

export function bootstrapApp(): void {
  if (booted) return
  booted = true
  setupWorld()
  startLoop()
}
