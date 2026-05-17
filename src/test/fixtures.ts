// STUB — temporary placeholder until Phase 5 (scenario loader) lands.
// The Phase 5 PR replaces this file with the real `applyFixture` impl
// that reads `tests/fixtures/<name>.json5`, validates the schema, and
// translates it into koota ECS operations. This stub keeps Phase 4's
// boot path compilable while the two branches merge in parallel.
//
// Once Phase 5 merges, delete this file's contents and replace with the
// real implementation — no other call sites depend on the stubbed
// behavior (Phase 4 boot just calls through; Phase 6 tests will rely on
// real fixtures).

export function applyFixture(name: string): void {
  if (import.meta.env.DEV) {
    console.warn(
      `[test-stub] applyFixture(${JSON.stringify(name)}) — Phase 5 not yet shipped; no fixture applied`,
    )
  }
}
