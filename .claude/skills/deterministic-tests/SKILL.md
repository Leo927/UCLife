---
name: deterministic-tests
description: Understand, author, and debug UC Life Sim's deterministic test suite — the `?test=1&fixture=…` boot path, hand-crafted JSON5 fixtures in `tests/fixtures/`, `step({ until, maxGameMinutes })` sim-time advancement, and the `getGameState()` fluent view. Use this skill whenever the user mentions writing, debugging, migrating, or fixing tests in `scripts/check-*.mjs`, anything in `src/test/`, fixtures, smoke tests, flaky CI, `waitForTimeout`, `setSpeed`, `__uclife_test__`, or asks "how do I test X" / "this smoke is flaky" / "the fixture isn't loading" in this repo. Trigger even when the user doesn't say "deterministic" explicitly — any test work in this codebase belongs here.
---

# Deterministic tests

UC Life Sim's test substrate is built to be **deterministic by construction, not statistically reliable**. A correctly-built test passes 1/1 under any CI load. Flake means the test is broken, not unlucky — fix the signal, never wrap in retry.

## When this skill applies

- Writing a new smoke / integration test (`scripts/check-*.mjs`).
- Authoring or extending a fixture in `tests/fixtures/*.json5`.
- Debugging a failing or flaky existing test.
- Extending `getGameState()`, the runtime API, the fixture loader, or any module under `src/test/`.
- Migrating a legacy test off `setSpeed` / `waitForTimeout` / `cheatMoney`.

If the request is "write a test for X" or "the X smoke is failing", load this skill before touching code.

## Mental model

End-to-end tests stay on Playwright. The substrate underneath is deterministic:

- **Seeded RNG.** Every `Math.random()` in sim code routes through one test-controllable source (`src/sim/rng.ts`).
- **`simNow()`** replaces wall-clock reads, so timestamps reproduce.
- **Asset-ready barrier** drains in-flight art pipelines; **test mode skips them entirely** by default. State + DOM keys stay intact.
- **Hand-crafted JSON5 fixtures** declare starting world state. Never captured savestates.
- **Sim clock is frozen.** The *only* way time advances is `step({ until, maxGameMinutes })`. RAF accumulation is paused.
- **`getGameState()`** is the fluent, read-only façade for both wait-conditions and validate-assertions.

Tests look like real player input + explicit sim-time progression + standard `node:assert` calls.

## The lifecycle — Prep / Run / Validate

This is the canonical shape. Every new smoke test should look like this skeleton:

```js
import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1&fixture=amuro-at-recruit-office', baseUrl).toString()

const browser = await chromium.launch()
const page = await browser.newContext({ viewport: { width: 1280, height: 800 } }).then(c => c.newPage())

const errors = []
page.on('pageerror', e => errors.push(`${e.name}: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })

// Boot-existence one-shot — the only allowed waitForFunction.
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.getGameState === 'function',
  null, { timeout: 30_000 },
)

// ── PREP — URL did the work: fixture applied, RNG seeded, clock frozen, assets off.
const t0Money = await page.evaluate(() =>
  window.__uclife__.getGameState().getPlayerCharacter().getResource('Money'))

// ── RUN — real player input + explicit sim-time progression ────────
const amuroScreen = await page.evaluate(() => window.__uclife__.getEntityScreenCoords('amuro'))
await page.mouse.click(amuroScreen.x, amuroScreen.y)
await page.evaluate(() => window.__uclife_test__.step({
  until: () => window.__uclife__.getGameState().getDialogue()?.getWithNpcId() === 'amuro',
  maxGameMinutes: 30,
}))

await page.waitForSelector('[data-testid="dialogue-option-hire-captain"]', { timeout: 5_000 })
await page.click('[data-testid="dialogue-option-hire-captain"]')

await page.evaluate(() => window.__uclife_test__.step({
  until: () => window.__uclife__.getGameState().getCharacter('amuro').getHiredRole() != null,
  maxGameMinutes: 5,
}))

// ── VALIDATE — standard assertions over a fluent state view ────────
const state = await page.evaluate(() => {
  const gs = window.__uclife__.getGameState()
  return {
    role:    gs.getCharacter('amuro').getHiredRole(),
    captain: gs.getShip('white-base').getCaptain()?.getId() ?? null,
    money:   gs.getPlayerCharacter().getResource('Money'),
  }
})

assert.equal(state.role, 'captain')
assert.equal(state.captain, 'amuro')
assert.equal(state.money, t0Money - 50_000)
assert.equal(errors.length, 0, `page errors: ${errors.join('; ')}`)

await browser.close()
console.log('OK — check-hire-amuro')
```

The discipline isn't optional:

- **Input is instant; consequences require simulated time.** Every UI action is followed by `step({ until })` that advances sim time until the consequence resolves.
- **`step({ until })` is the only wait primitive for sim state.** `waitForFunction` over sim state loops forever under a frozen clock.
- **Validate is partial.** Assert only what proves the test's intent. `getGameState()` enforces no shape.
- **Real player input only.** `page.click`, `page.mouse.click`, `page.keyboard.press`. No `element.click()` from inside `page.evaluate` — that bypasses React's synthetic event system.

## The 7 hard rules (non-negotiable)

These are the construction rules from `CLAUDE.md`. Every new test must obey all seven. Detailed rationale + failure modes in `references/construction-rules.md` — read it when a test fails review or breaks for a non-obvious reason.

1. **Drive through `__uclife__`, not the DOM.** Read state via the deterministic handle. Don't assert on rendered text or canvas pixels unless the test is *about* the renderer.
2. **No fixed `sleep` / `waitForTimeout`.** Wait on conditions (`step({ until })`, `waitForSelector` for DOM mount). If you reach for `setTimeout(2000)`, expose a deterministic signal instead.
3. **Drive sim time, not real time.** `step({ ... })` only. Never click a speed button and wait the wall clock out.
4. **Seeded determinism only.** Same seed + fixture → same world. Pin scenario-specific NPCs via `special-npcs.json5` / fixtures — don't fish for procedural NPCs.
5. **No dynamic `await import('/src/...')` from `page.evaluate`.** Vite hands the page a different module instance than the running app — trait-identity queries silently match nothing. Expose helpers on `__uclife__` instead.
6. **No retry wrappers, no `test.retry(n)`, no swallowing try/catch.** If a check needs retries to stay green, the underlying signal is wrong — fix it.
7. **Fail loud, fail fast.** Every assertion produces a message naming the broken invariant. Dump relevant `__uclife__` state on failure.

If a scenario can't meet rules 1–7, **don't add the test** — file the gap as a TODO.

## Anti-patterns — explicitly forbidden

Will fail review unconditionally. The detailed why is in `references/construction-rules.md`.

- `page.waitForTimeout(N)` — for any reason.
- `page.waitForFunction(() => …sim state…)` — frozen clock loops forever. *Boot-existence* (`typeof __uclife_test__?.step === 'function'`) and *DOM-mount* polling are fine; *sim-state* polling is not.
- `useClock.getState().setSpeed(N)` — no-op in test mode. Remove the line.
- `test.retry(n)` / `try { … } catch { /* swallow */ }`.
- Captured savestates pasted as fixtures.
- `element.click()` / `element.dispatchEvent(...)` from `page.evaluate`.
- Dynamic `await import('/src/...')` from inside `page.evaluate`.

## URL params (boot-time invariants)

```
http://localhost:5173/?test=1&fixture=amuro-at-recruit-office&seed=foo&nowMs=1735689600000&assets=1
```

| Param | Meaning |
|-------|---------|
| `test=1` | Branch into test boot path (DEV-only). Without it, normal prod boot. |
| `fixture=<name>` | Load `tests/fixtures/<name>.json5` as initial world state. |
| `seed=<string>` | RNG seed. Overrides fixture's `seed` if both present. |
| `nowMs=<number>` | Frozen sim-clock epoch-ms. Overrides fixture's `startDate`. |
| `assets=1` | Opt in to real asset loading. Default off — pipelines never start. |

Test mode is **a boot-time decision**, not a runtime flip. There is no `enterTestMode()`. The branch is gated on `import.meta.env.DEV` in `src/main.tsx`; the entire `src/test/` tree is tree-shaken from prod builds. Zero test code ships to players.

## Runtime API surface (in test mode)

The two namespaces you reach for from a test. Full method-by-method reference in `references/api-surface.md`.

```ts
// The sole wait primitive. Advances sim time tick-by-tick.
__uclife_test__.step({ until: () => boolean, maxGameMinutes: number }): Promise<void>
__uclife_test__.step({ gameMinutes: number }): Promise<void>

// Fluent, read-only view. Methods grow on demand per test need.
__uclife__.getGameState(): GameStateView
  // .getPlayerCharacter() / .getCharacter(id) / .getShip(idOrName)
  // .getFaction(id) / .getDialogue() / .getScene()

// World-space → screen-space bridge for Pixi canvas hit-tests.
__uclife__.getEntityScreenCoords(entityId: string): { x, y } | null

// Asset drain (only matters when ?assets=1).
__uclife__.awaitAssetsReady(opts?: { timeoutMs?: number }): Promise<void>
__uclife__.pendingAssetJobs(): number
```

The runtime API is intentionally minimal. There is no `enterTestMode`, no `loadScenario` at runtime, no clock/RNG knobs — those are URL-param boot invariants.

## Fixture authoring

Fixtures are hand-crafted JSON5 in `tests/fixtures/<name>.json5`. Schema details + failure modes are in `references/api-surface.md`. The quick version:

```json5
{
  seed: 'hire-amuro-001',
  startDate: '2026-05-17T08:00:00Z',
  scene: 'vonBraunCity',

  player: {
    money: 5_000_000,
    location: { scene: 'vonBraunCity', x: 32, y: 18 },
    skills: { piloting: 50 },
    background: 'soldier',
  },
  factions: [{ id: 'anaheim', money: 1_000_000 }],
  ships:    [{ id: 'white-base', template: 'pegasusClass', dockedAt: 'vonBraun' }],
  npcs:     [{ id: 'amuro', name: 'Amuro Ray', at: { scene: 'vonBraunCity', x: 35, y: 20 } }],
}
```

Workflow:

1. Write the `.json5` in `tests/fixtures/`. Coordinates are **tile-space** (loader multiplies by `worldConfig.tilePx`).
2. Register it in `src/test/fixtures.ts`'s `FIXTURES` map (`?raw` Vite import). The loader is allowlist-based — unknown keys throw with the field path.
3. Add a `*.test.ts` round-trip in `src/test/fixtures.test.ts` so the loader catches schema typos before smoke red.
4. Reference it via `?fixture=<name>`.

**Principles, hold the line:**

- **Hand-crafted only.** Never captured savestates.
- **Vocabulary mirrors `getGameState()`.** Fixture says `skills: { piloting: 92 }`; test reads `getCharacter('amuro').getStat('piloting')`. One model.
- **Same fixture loadable by multiple tests.** Share when setups overlap.
- **Loader fails loud.** Unknown ids and unknown fields throw with paths.

## Migrating legacy tests

Older `scripts/check-*.mjs` files still use `setSpeed` / `waitForTimeout` / `cheatMoney` — the pre-determinism shape. Don't add new tests in that style; migrate them when touching them. The full triage table, per-category recipes (A: debug-API-only, B: UI flow, C: renderer-pixel, D: already deterministic), and known gaps are in `Design/test-migration-playbook.md`.

The 10-second migration recipe:

- **Replace `setSpeed(N)`** — delete the line. Clock is frozen.
- **Replace `waitForFunction(() => sim-state)`** with `step({ until: () => sim-state, maxGameMinutes: N })`.
- **Replace `advanceGameDays(N)`** with `step({ gameMinutes: N * 24 * 60 })` — unless a bespoke domain verb (`forceDailyEconomics`, `runAmbitionsTick`) targets the day-rollover more precisely; keep those.
- **Replace `cheatMoney(N)` / hand-rolled spawn** with a `tests/fixtures/<name>.json5` entry.
- **Boot via `?test=1[&fixture=<name>]`** instead of stock URL.
- **Read state via `getGameState()`** instead of bespoke debug snapshots; if a method is missing, add it to `src/test/gameStateView.ts`.

## Common failure modes

- **`step({ until })` times out.** Predicate is checked every tick; if it never flips, either the consequence isn't actually firing, or a system the consequence depends on isn't being driven by `advanceSimByGameMs` in `src/test/clock.ts`. Check the failure snapshot (the throw includes `getGameState()` JSON).
- **`getGameState().getX()` returns null / throws "not yet wired".** The façade grows on demand — add the method in `src/test/gameStateView.ts`, mirror the fixture vocabulary, and write a unit test in `gameStateView.test.ts`.
- **Fixture player money/skills silently shadowed by boot defaults.** Make sure `bootTestMode` is passing `skipDefaultPlayer: Boolean(params.fixture)` to `bootstrapApp` and that the fixture sets `player.money` (default boot spawn is `30`).
- **Dev cache staleness.** After merging changes to `bootTestMode` / `main.tsx`, local dev may serve a stale module — `rm -rf node_modules/.vite` and restart. CI is fine.
- **`getEntityScreenCoords` returns null.** Entity isn't in the active scene (or is off-camera). For Pixi hit-tests, swap to the active scene first via the appropriate debug verb, then read coords.

## File map

| File | Role |
|------|------|
| `src/main.tsx` | Boot fork — `?test=1` hands off to `src/test/bootTestMode.ts`. |
| `src/test/bootTestMode.ts` | Test-mode boot — RNG seed, frozen clock, fixture, debug namespaces. |
| `src/test/runtime.ts` | `step({ until \| gameMinutes })`. |
| `src/test/clock.ts` | `advanceSimByGameMs` — mirrors `sim/loop.ts` frame() systems. Audit when adding/removing a per-tick system. |
| `src/test/state.ts` | `isTestMode()` + `isSkipAssets()` flags for asset short-circuits. |
| `src/test/fixtures.ts` | JSON5 loader, validation, ECS application. |
| `src/test/gameStateView.ts` | `getGameState()` fluent façade. |
| `src/test/canvasHitTest.ts` | `getEntityScreenCoords`. |
| `src/test/test-config.json5` | Tick size, default seed, default ISO, max-step bound. |
| `tests/fixtures/*.json5` | Hand-crafted scenarios. |
| `scripts/check-*.mjs` | Playwright smokes — runner sourced from `.github/workflows/ci.yml` (`test` job). |
| `Design/test-migration-playbook.md` | Legacy-test migration recipes per category. |

## Reference files

- `references/api-surface.md` — full method signatures for `step`, `getGameState`, `getEntityScreenCoords`, fixture schema field-by-field, URL params, `test-config.json5` keys.
- `references/construction-rules.md` — the 7 rules + anti-patterns with worked examples of each failure mode, so a flake or review pushback resolves to a specific rule and remedy.
