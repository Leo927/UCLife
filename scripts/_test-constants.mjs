// Shared smoke-test constants. Hoist here when the same literal appears in
// two or more check-*.mjs scripts so the test layer stays in lockstep with
// the deterministic-boot contract.
//
// Anything game-specific (fares, drain rates, hangar caps) stays inline at
// the assertion site — those numbers describe the invariant under test, not
// a test-infrastructure detail.

export const BOOT_READY_TIMEOUT_MS = 30_000
export const DOM_COMMIT_TIMEOUT_MS = 5_000
export const MS_PER_GAME_MINUTE = 60_000
export const MINUTES_PER_GAME_DAY = 24 * 60
export const VIEWPORT = { width: 1280, height: 800 }

// Test-mode (`?test=1` without `&assets=1`) installs empty portrait caches,
// so any code path that walks the FC pregmod portrait pipeline logs
// `Missing art resource: <id>` for every layer it can't find. These are
// expected in skip-assets mode and never appear under `&assets=1`. Tests
// that open NPCDialog with a portrait need to ignore them; everything
// else they care about — render errors, page exceptions — still trips
// the error capture.
export function isExpectedTestModePortraitMissing(text) {
  return text.startsWith('console.error: Missing art resource:')
}
