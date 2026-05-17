// Shared test-mode flags. Set once by bootTestMode(), read by
// asset-loading entry points (portrait cache, sprite compose, recolor,
// LPC loader) to short-circuit pixel work while keeping state + DOM
// keys (img.alt, data-portrait-id, sprite ids) intact.
//
// Module-level state is the right shape: the test-boot decision is a
// process-level boot invariant, not a per-call argument.

let testMode = false
let skipAssets = false

export function markTestMode(opts: { skipAssets: boolean }): void {
  testMode = true
  skipAssets = opts.skipAssets
}

export function isTestMode(): boolean {
  return testMode
}

export function isSkipAssets(): boolean {
  return skipAssets
}

export function __resetTestModeForTests(): void {
  testMode = false
  skipAssets = false
}
