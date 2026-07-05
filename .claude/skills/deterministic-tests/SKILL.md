---
name: deterministic-tests
description: Understand, author, and debug UC Life Sim's deterministic test suite — the `?test=1&fixture=…` boot path, hand-crafted JSON5 fixtures in `tests/fixtures/`, `step({ until, maxGameMinutes })` sim-time advancement, the `getGameState()` fluent view, and Playwright Test discovery under `tests/smoke/*.spec.ts`. Use this skill whenever the user mentions writing, debugging, migrating, or fixing tests in `tests/smoke/`, anything in `src/test/`, fixtures, smoke tests, flaky CI, `waitForTimeout`, `setSpeed`, `__uclife_test__`, or asks "how do I test X" / "this smoke is flaky" / "the fixture isn't loading" in this repo. Trigger even when the user doesn't say "deterministic" explicitly — any test work in this codebase belongs here.
---

# Deterministic tests

UC Life Sim's test substrate is built to be **deterministic by construction, not statistically reliable**. A correctly-built test passes 1/1 under any CI load. Flake means the test is broken, not unlucky — fix the signal, never wrap in retry.

## When this skill applies

- Writing a new smoke / integration test (`tests/smoke/*.spec.ts`).
- Authoring or extending a fixture in `tests/fixtures/*.json5`.
- Debugging a failing or flaky existing test.
- Extending `getGameState()`, the runtime API, the fixture loader, or any module under `src/test/`.
- Touching `playwright.config.ts`, the shared `tests/smoke/_fixtures.ts`, or `scripts/ci-local.mjs`.

If the request is "write a test for X" or "the X smoke is failing", load this skill before touching code.

## Mental model

The smoke / e2e suite runs on **Playwright Test** (`@playwright/test`). Each `tests/smoke/<name>.spec.ts` is auto-discovered — there is **no manifest, no CI list, no registration**. Add a new spec file, it runs. The substrate underneath each test is deterministic:

- **Seeded RNG.** Every `Math.random()` in sim code routes through one test-controllable source (`src/sim/rng.ts`).
- **`simNow()`** replaces wall-clock reads, so timestamps reproduce.
- **Asset-ready barrier** drains in-flight art pipelines; **test mode skips them entirely** by default. State + DOM keys stay intact.
- **Hand-crafted JSON5 fixtures** declare starting world state. Never captured savestates.
- **Sim clock is frozen.** The *only* way time advances is `sim.stepFor(gameMinutes)` or `sim.stepUntil(predicate, maxGameMinutes)`. RAF accumulation is paused.
- **`getGameState()`** is the fluent, read-only façade for both wait-conditions and validate-assertions.

Tests look like real player input + explicit sim-time progression + standard `expect()` calls.

## The lifecycle — Prep / Run / Validate

This is the canonical shape. Every new smoke test should look like this skeleton:

```ts
import { test, expect } from './_fixtures'

test('hire amuro becomes captain', async ({ sim }) => {
  // ── PREP — URL boot via the shared fixture. fixture name → tests/fixtures/<name>.json5
  await sim.boot({
    fixture: 'amuro-at-recruit-office',
    requireHandles: ['__uclife_test__.step', '__uclife__.getGameState'],
  })

  const t0Money = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__uclife__.getGameState().getPlayerCharacter().getResource('Money')
  })

  // ── RUN — real player input + explicit sim-time progression ────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const amuroScreen = await sim.page.evaluate(() => (window as any).__uclife__.getEntityScreenCoords('amuro'))
  await sim.page.mouse.click(amuroScreen.x, amuroScreen.y)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.stepUntil(() => (window as any).__uclife__.getGameState().getDialogue()?.getWithNpcId() === 'amuro', 30)

  await sim.page.waitForSelector('[data-testid="dialogue-option-hire-captain"]', { timeout: 5_000 })
  await sim.page.click('[data-testid="dialogue-option-hire-captain"]')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.stepUntil(() => (window as any).__uclife__.getGameState().getCharacter('amuro').getHiredRole() != null, 5)

  // ── VALIDATE — standard assertions over a fluent state view ────────
  const state = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gs = (window as any).__uclife__.getGameState()
    return {
      role:    gs.getCharacter('amuro').getHiredRole(),
      captain: gs.getShip('white-base').getCaptain()?.getId() ?? null,
      money:   gs.getPlayerCharacter().getResource('Money'),
    }
  })

  expect(state.role).toBe('captain')
  expect(state.captain).toBe('amuro')
  expect(state.money).toBe(t0Money - 50_000)
  // Page-error gate runs automatically in fixture teardown — no manual check needed.
})
```

The discipline isn't optional:

- **Input is instant; consequences require simulated time.** Every UI action is followed by `sim.stepUntil(...)` that advances sim time until the consequence resolves.
- **`stepFor` / `stepUntil` are the only wait primitives for sim state.** `waitForFunction` over sim state loops forever under a frozen clock.
- **Validate is partial.** Assert only what proves the test's intent. `getGameState()` enforces no shape.
- **Real player input only.** `page.click`, `page.mouse.click`, `page.keyboard.press`. No `element.click()` from inside `page.evaluate` — that bypasses React's synthetic event system.

## How discovery works

Playwright Test's discovery is filesystem-based by convention:

| Glob | Behavior |
|------|----------|
| `tests/smoke/*.spec.ts` | **Discovered and run.** Default `testMatch` in `playwright.config.ts`. |
| `tests/smoke/_fixtures.ts` | Underscore-prefix → **not** a test file. Shared helpers live here. |
| `tests/fixtures/*.json5` | Hand-crafted scenarios. Not test specs. |
| `tests/smoke/<anything>.ts` (no `.spec`) | Not discovered. Use the underscore prefix for clarity. |

To add a test: drop `tests/smoke/<name>.spec.ts`. To skip one: rename it to `*.spec.ts.skip` or delete it.

To select a subset locally:
```bash
npx playwright test portrait       # filename substring match
npx playwright test --grep "boot"  # test-name regex
```

## The shared `sim` fixture

All specs import from `./_fixtures`:

```ts
import { test, expect } from './_fixtures'
```

The fixture exposes a `sim` handle that replaces the ~30 lines of boilerplate every old `check-*.mjs` repeated (browser/context/page setup, error capture, `?test=1` URL build, boot barrier, teardown).

| Member | Purpose |
|--------|---------|
| `sim.page` | The Playwright `Page`. Use for `.click()`, `.evaluate()`, `.waitForSelector()`, mouse/keyboard. |
| `sim.boot({ fixture?, params?, requireHandles?, timeoutMs? })` | Navigates to `?test=1[&fixture=…]`, waits for the boot barrier. |
| `sim.waitForBoot(requireHandles?, timeoutMs?)` | Re-arm the boot barrier after `page.reload()`. |
| `sim.stepFor(gameMinutes)` | Pure-data step. Advances sim time by exact minutes. |
| `sim.stepUntil(untilFn, maxGameMinutes)` | Predicate step. `untilFn` runs in the browser — closure-restricted (only `window.__uclife__`). |
| `sim.allowConsoleError(predicate)` | Whitelist a console.error pattern *before* `sim.boot()`. Defaults: all unexpected console.errors fail the test on teardown. |

The teardown error-gate is automatic. If the test path triggers expected errors (e.g. portrait-missing in `?test=1` skipAssets mode), call:

```ts
import { test, isExpectedTestModePortraitMissing } from './_fixtures'

test('portrait modal', async ({ sim }) => {
  sim.allowConsoleError(isExpectedTestModePortraitMissing)
  await sim.boot({ fixture: '…' })
  // …
})
```

## `requireHandles` — what to pass

`sim.boot({ requireHandles: […] })` waits until every dotted path resolves to a `function` on `window`. Examples:

```ts
requireHandles: [
  '__uclife_test__.step',          // sole wait primitive
  '__uclife__.getGameState',       // fluent state view
  '__uclife__.fillJobVacancies',   // a debug verb your test calls
  '__uclife__.saveGame',
  '__uclife__.loadGame',
  'uclifeUI.getState',             // ui store
]
```

The default is `['__uclife_test__.step', '__uclife__.getGameState']`. Add only the handles you actually call — over-specifying isn't harmful but it's noise.

If the path resolves to a non-function (e.g. `__uclife__.useScene.getState` itself is a function on the zustand store), the check still passes because `typeof === 'function'`. Anything deeper (`__uclife__.useScene.getState().activeId`) belongs in `sim.stepUntil` or `sim.page.evaluate`, not in `requireHandles`.

## The 8 hard rules (non-negotiable)

These are the construction rules from `CLAUDE.md`. Every new test must obey all eight. Detailed rationale + failure modes in `references/construction-rules.md` — read it when a test fails review or breaks for a non-obvious reason.

1. **Drive through `__uclife__`, not the DOM.** Read state via the deterministic handle. Don't assert on rendered text or canvas pixels unless the test is *about* the renderer.
2. **No fixed `sleep` / `waitForTimeout`.** Wait on conditions (`stepUntil`, `waitForSelector` for DOM mount). If you reach for `setTimeout(2000)`, expose a deterministic signal instead.
3. **Drive sim time, not real time.** `stepFor` / `stepUntil` only. Never click a speed button and wait the wall clock out.
4. **Seeded determinism only.** Same seed + fixture → same world. Pin scenario-specific NPCs via `special-npcs.json5` / fixtures — don't fish for procedural NPCs.
5. **No dynamic `await import('/src/...')` from `page.evaluate`.** Vite hands the page a different module instance than the running app — trait-identity queries silently match nothing. Expose helpers on `__uclife__` instead.
6. **No retry wrappers, no `test.retry(n)`, no swallowing try/catch.** `playwright.config.ts` pins `retries: 0` — keep it there. If a check needs retries to stay green, the underlying signal is wrong; fix it.
7. **Fail loud, fail fast.** Every `expect` message names the broken invariant. Page errors are auto-asserted by the fixture; on failure, Playwright's HTML report + trace.zip surface the state.
8. **Acceptance journey smokes: `__uclife__` observes, never drives.** A spec named
   `journey-*.spec.ts` performs every player action through real input (walk, press E via
   keyboard, click DOM buttons / canvas coordinates). Debug verbs (`grantFleet`,
   `forceUndockFlagship`, `startCombatCheat`, …) are forbidden in journey specs — reads
   (`getGameState`, `getEntityScreenCoords`, `stepFor`/`stepUntil`, fixture boot) are the
   only `__uclife__` surface they may touch. System smokes may still drive debug verbs.

If a scenario can't meet rules 1–8, **don't add the test** — file the gap as a TODO.

## Anti-patterns — explicitly forbidden

Will fail review unconditionally. The detailed why is in `references/construction-rules.md`.

- `page.waitForTimeout(N)` — for any reason.
- `page.waitForFunction(() => …sim state…)` — frozen clock loops forever. *Boot-existence* (the fixture's own `sim.waitForBoot`) and *DOM-mount* polling are fine; *sim-state* polling is not.
- `useClock.getState().setSpeed(N)` — no-op in test mode. Remove the line.
- `test.retry(n)` / `test.describe.configure({ retries: … })` / try/catch swallowing.
- Editing `playwright.config.ts` to add `retries`, raise timeouts beyond the existing defaults, or weaken the `forbidOnly` gate.
- Captured savestates pasted as fixtures.
- `element.click()` / `element.dispatchEvent(...)` from `page.evaluate`.
- Dynamic `await import('/src/...')` from inside `page.evaluate`.
- Debug verbs inside a `journey-*.spec.ts` — journey specs prove the player path; a debug write invalidates the proof.
- Editing `.github/workflows/ci.yml` to add a per-test step. The workflow has no per-test knowledge by design — drop a spec file and it runs.

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

Pass these via `sim.boot({ params: { seed: 'foo', assets: 1 } })`.

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
2. Reference it via `sim.boot({ fixture: '<name>' })`, where `<name>` is the filename stem. **No registration step** — `src/test/fixtures.ts` auto-discovers every `tests/fixtures/*.json5` via `import.meta.glob`. Drop the file, use the stem. The loader is allowlist-based — unknown keys throw with the field path.
3. Add a `*.test.ts` round-trip in `src/test/fixtures.test.ts` so the loader catches schema typos before smoke red.

**Principles, hold the line:**

- **Hand-crafted only.** Never captured savestates.
- **Vocabulary mirrors `getGameState()`.** Fixture says `skills: { piloting: 92 }`; test reads `getCharacter('amuro').getStat('piloting')`. One model.
- **Same fixture loadable by multiple tests.** Share when setups overlap.
- **Loader fails loud.** Unknown ids and unknown fields throw with paths.

## Running the suite

```bash
npm run test:e2e                         # all specs, parallel workers, against an already-running dev server
npm run ci:local                         # spawns its own ephemeral Vite + runs Playwright Test + survive.ts
npm run ci:local -- --grep portrait      # filter by test name
npm run ci:local -- --workers=1          # single-worker (useful for debugging)
npm run ci:local -- --skip-survive       # drop the long-running headless step
npx playwright test --ui                 # interactive UI mode (against running dev server)
npx playwright show-report               # open HTML report from last run
npx playwright show-trace scripts/out/playwright/<test-dir>/trace.zip   # inspect failure trace
```

`ci:local` is what CI runs (`.github/workflows/ci.yml`) — a single step, no per-test mention anywhere in the workflow. To add a smoke, drop a spec file. To remove one, delete it. The CI yml never changes.

## Migrating legacy tests

The pre-Playwright-Test shape lived under `scripts/check-*.mjs` and was driven by hand-rolled `chromium.launch()` boilerplate. If you find a leftover, the conversion is mechanical:

1. **Top-of-file**: replace the Playwright-launch + error-capture boilerplate with:
   ```ts
   import { test, expect } from './_fixtures'

   test('<one-sentence scenario>', async ({ sim }) => {
     await sim.boot({ fixture: '<name>', requireHandles: ['__uclife_test__.step', '__uclife__.getGameState' /* + your handles */] })
     // …
   })
   ```
2. **`page` → `sim.page`**.
3. **Boot `waitForFunction`** → fold its `typeof window.X === 'function'` checks into `requireHandles: ['X.path', …]`.
4. **`assert.equal/ok/notEqual`** → `expect().toBe()/.toBeTruthy()/.not.toBe()`.
5. **Final `assert.equal(errors.length, 0, …)`** → delete. The fixture's teardown gates it.
6. **`step({ gameMinutes })`** → `sim.stepFor(N)`.
7. **`step({ until })`** → `sim.stepUntil(() => …, maxMinutes)`.
8. **Mid-test `page.reload()`** → keep, follow with `await sim.waitForBoot([…])`.
9. **`await browser.close()` + `console.log('OK — …')`** → delete.
10. **Place under `tests/smoke/<short-name>.spec.ts`**.

Older deterministic-substrate gaps (cheatMoney calls, captured savestates, `setSpeed`, `waitForTimeout`) are listed per-category in `Design/test-migration-playbook.md` — that doc covers the pre-Phase-6 work and is still useful for understanding *why* the substrate is shaped the way it is.

## Common failure modes

- **`stepUntil` predicate never resolves.** Predicate is checked every tick; if it never flips, either the consequence isn't actually firing, or a system the consequence depends on isn't being driven by `advanceSimByGameMs` in `src/test/clock.ts`. Check the trace.zip — it includes a final `getGameState()` snapshot.
- **`getGameState().getX()` returns null / throws "not yet wired".** The façade grows on demand — add the method in `src/test/gameStateView.ts`, mirror the fixture vocabulary, and write a unit test in `gameStateView.test.ts`.
- **Fixture player money/skills silently shadowed by boot defaults.** Make sure `bootTestMode` is passing `skipDefaultPlayer: Boolean(params.fixture)` to `bootstrapApp` and that the fixture sets `player.money` (default boot spawn is `30`).
- **Test times out at `sim.boot`.** Vite pre-bundle hasn't finished. Locally: `rm -rf node_modules/.vite` and restart. In CI: `scripts/ci-local.mjs`'s `warmup()` should be enough — if it isn't, that's a regression worth investigating.
- **`getEntityScreenCoords` returns null.** Entity isn't in the active scene (or is off-camera). For Pixi hit-tests, swap to the active scene first via the appropriate debug verb, then read coords.
- **Page errors trip teardown.** Look at `page-errors.txt` attachment in the HTML report. If they're expected for this test, `sim.allowConsoleError(predicate)` before `sim.boot()`.

## File map

| File | Role |
|------|------|
| `playwright.config.ts` | Test discovery (`tests/smoke/*.spec.ts`), retries=0, reporters, baseURL handling. |
| `tests/smoke/_fixtures.ts` | The `test` + `sim` fixture. Shared bootstrap, error gate, sim verbs. |
| `tests/smoke/*.spec.ts` | One scenario per file. Auto-discovered. |
| `tests/fixtures/*.json5` | Hand-crafted starting world state, referenced via `sim.boot({ fixture: '…' })`. |
| `scripts/ci-local.mjs` | Local + CI runner: ephemeral Vite + `playwright test` + `survive.ts`. |
| `.github/workflows/ci.yml` | Single `npm run ci:local` step. No per-test mention. |
| `src/main.tsx` | Boot fork — `?test=1` hands off to `src/test/bootTestMode.ts`. |
| `src/test/bootTestMode.ts` | Test-mode boot — RNG seed, frozen clock, fixture, debug namespaces. |
| `src/test/runtime.ts` | `step({ until \| gameMinutes })`. |
| `src/test/clock.ts` | `advanceSimByGameMs` — mirrors `sim/loop.ts` frame() systems. Audit when adding/removing a per-tick system. |
| `src/test/state.ts` | `isTestMode()` + `isSkipAssets()` flags for asset short-circuits. |
| `src/test/fixtures.ts` | JSON5 loader, validation, ECS application. |
| `src/test/gameStateView.ts` | `getGameState()` fluent façade. |
| `src/test/canvasHitTest.ts` | `getEntityScreenCoords`. |
| `src/test/test-config.json5` | Tick size, default seed, default ISO, max-step bound. |
| `scripts/survive.ts` | Headless tsx ECS sim — not a Playwright test. Run after the spec suite by `ci:local`. |
| `Design/test-migration-playbook.md` | Pre-Phase-6 legacy-test migration recipes, kept for substrate context. |

## Reference files

- `references/api-surface.md` — full method signatures for `step`, `getGameState`, `getEntityScreenCoords`, fixture schema field-by-field, URL params, `test-config.json5` keys.
- `references/construction-rules.md` — the 7 rules + anti-patterns with worked examples of each failure mode, so a flake or review pushback resolves to a specific rule and remedy.
