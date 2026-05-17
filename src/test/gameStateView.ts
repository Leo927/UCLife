// STUB — temporary placeholder until Phase 5 (gameState façade) lands.
// The Phase 5 PR replaces this with the real fluent navigable view
// (`getPlayerCharacter()`, `getCharacter(id)`, `getShip(id)`, …) wired
// onto `__uclife__.getGameState`. This stub keeps Phase 4 boot
// compilable + step()'s failure path importable while the two branches
// merge in parallel.
//
// See Design/test-determinism.md §"API surface" for the full v1 shape.

export interface GameStateView {
  // Real shape lives in the Phase 5 PR. Intentionally left as an opaque
  // record here so callers can type the return without committing to a
  // shape this stub hasn't earned.
  readonly [k: string]: unknown
}

export function getGameState(): GameStateView {
  throw new Error('[test-stub] getGameState() — Phase 5 not yet shipped')
}
