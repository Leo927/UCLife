# Test Migration Playbook — Phase 6

Recipes for converting `scripts/check-*.mjs` smoke tests onto the
deterministic API shipped in Phases 1–5. The why lives in
`Design/test-determinism.md`. This file is just the how.

The pilot test for the Category B recipe is **`scripts/check-systemmenu.mjs`** —
read it side-by-side with the recipes below. Pilot passed 10/10 back-to-back
runs.

## Triage table

37 `scripts/check-*.mjs` smoke tests, categorized for batch migration.

Category key:

- **A** — Debug-API-only test. No real player input today. Migration is
  cheap: swap `setSpeed(0)` (dead in test mode) and `waitForTimeout` for
  `step({…})`, swap bespoke debug-handle state reads for
  `getGameState()`. Estimated effort: ~30 min/test.
- **B** — UI flow test. Real Playwright input + sim consequences.
  Migration is moderate: fixture-based prep, real clicks for the
  journey, `step({ until })` for sim consequences, `getGameState()`
  for asserts. Estimated effort: ~1–2 hr/test.
- **C** — Renderer-pixel test. Already retrofitted through
  `awaitAssetsReady()` in Phase 3. Sanity-check only: opt into
  `&assets=1` if pixels are asserted, otherwise switch to
  `skipAssets`-default + state-key assertions. Estimated effort:
  ~30 min/test.
- **D** — Already deterministic / no migration needed.

| Script | Cat | Patterns | Notes / effort |
|---|---|---|---|
| check-test-boot.mjs | D | — | Reference; canonical structural shape for new tests. |
| check-systemmenu.mjs | **PILOT (B)** | migrated | Worked example. URL boot + fixture + click + step() + getGameState(). |
| check-ambitions.mjs | A | 9 patt, 1 click | `setSpeed(0)`, `advanceGameDays`, `runAmbitionsTick` → `step({ gameMinutes })`. Pause-button click is decorative; drop it. |
| check-captains-office.mjs | A | 1 patt | `waitFor` helper wraps `waitForFunction` over game state — swap predicates to `step({ until })`. No real UI input. |
| check-cockpit.mjs | A | 1 patt | Same `waitFor` helper. Pure debug-handle drive (boardShip, takeHelmCheat, launchPlayerMs). |
| check-daily-economics.mjs | A | 2 patt | `setSpeed(0)` + bespoke `forceDailyEconomics(N)` — keep the verb, drop the speed pin (frozen anyway). |
| check-faction-office.mjs | A | migrated | Phase 6 fix-baseline PR — `?test=1` boot, listing-drops-after-buy is the new invariant. |
| check-fleet-launch.mjs | A | 5 patt | `setSpeed(0)` + `waitForFunction` for `clock.mode !== 'combat'` → `step({ until: () => …mode !== combat })`. |
| check-fleet-supply.mjs | B | 7 patt, 4 clicks | Dialog branch clicks + bulk-order buttons. Same shape as the pilot, larger scope. |
| check-flights.mjs | A | 5 patt | All `waitForFunction` are DOM-mount waits — those stay as `waitForSelector` (allowed). Game-state polling absent. |
| check-grant-fleet.mjs | A | 3 patt | Pure debug verbs; `setSpeed(0)` dead. |
| check-hangar.mjs | B | 2 patt, 1 click | One dialog-branch click. Same shape as the pilot. |
| check-hire-crew.mjs | A | 2 patt | `setSpeed(0)` + bespoke advance verbs. |
| check-hotkeys.mjs | B | 5 patt, 2 keypress | Real `page.keyboard.press()` to test hotkey bindings. Probe-key trick is preserved for listener-attach detection. |
| check-light-hull-buy.mjs | A | 2 patt | Debug verbs end-to-end. |
| check-mothball-transfer.mjs | A | 3 patt | Debug verbs end-to-end. |
| check-orbital-lift.mjs | B | 2 patt, 1 click | One dialog-branch click. |
| check-pegasus-buy.mjs | A | 2 patt | Pure debug verbs. |
| check-physiology-ae-clinic.mjs | A | 2 patt | Already nearly clean; `physiologyTickDay` → `step({ gameMinutes: 24*60 })` or keep the verb. |
| check-physiology-cold.mjs | A | 1 patt | Already advertises "no real-time waits". One `setSpeed(0)` dead. |
| check-physiology-contagion.mjs | A | 1 patt | Same. |
| check-physiology-injury.mjs | A | 1 patt | Same. |
| check-physiology-multi.mjs | A | 1 patt | Same. |
| check-physiology-sneeze.mjs | A | 3 patt | Same; one extra `waitFor` for emote spawning — wrap in `step({ until })`. |
| check-portrait.mjs | C | 4 patt, 1 click | `awaitAssetsReady()` already wired. Click switches presets — keep, just boot via `?test=1&assets=1`. |
| check-portrait-enlarge.mjs | C | 7 patt, 2 inputs | `awaitAssetsReady()` already wired. Real mouse click + Escape. Boot with `&assets=1`; the click flow stays. |
| check-portrait-modals.mjs | C | 5 patt | Already drains assets via `awaitAssetsReady()`. Mostly DOM-readiness `waitForFunction` — those stay. |
| check-realtor.mjs | A | 1 patt | Pure debug verbs; no nondeterministic patterns to migrate. Near-D. |
| check-recruit-office.mjs | A | migrated | Phase 6 fix-baseline PR — `?test=1` boot, listing-drops-after-buy is the new invariant. |
| check-research.mjs | A | 2 patt | `setSpeed(0)` + `forceResearchTick(day)` — keep verb, drop speed pin. |
| check-saveload.mjs | A | 3 patt | `setSpeed(0)` + `advanceGameDays`. Save/load resets the world — fixture won't survive a load; assert on save-restored state. |
| check-scene-swap.mjs | B | 4 patt, 1 click | Real click on flight-modal `购票`. Animation uses `requestAnimationFrame` directly — survives test-mode RAF (frozen sim ≠ frozen browser RAF). |
| check-ship-repair.mjs | A | 2 patt | Pure debug verbs. |
| check-space-combat.mjs | A | 1 patt | Combat-mode polling → `step({ until: () => …mode === 'normal' })`. |
| check-sprite.mjs | C | 1 patt | Already drains via `awaitAssetsReady()`. Renderer test — keep skipAssets opt-in. |
| check-sprite-ingame.mjs | C | 2 patt | Same. |
| check-war-room.mjs | A | 2 patt | Pure debug verbs. |

Totals: **A: 25  ·  B: 6 (incl. pilot)  ·  C: 5  ·  D: 1**

Both previously-deferred tests (`check-faction-office`,
`check-recruit-office`) have been repaired and migrated in a follow-up
PR — the stale assertion was that a player-owned facility would
re-appear on the realtor with `ownerKind=character`, but commit
`afc7470` (May 8) intentionally hid player-owned facilities via
`excludeOwner`. Updated tests assert the listing drops entirely.

## Per-category recipes

### Category A — Debug-API-only test

The hot pattern today:

```js
// Before
await page.evaluate(() => globalThis.__uclife__.useClock.getState().setSpeed(0))
// … run a bunch of debug verbs …
await page.evaluate(() => globalThis.__uclife__.advanceGameDays(2))
const result = await page.evaluate(() => globalThis.__uclife__.somethingSnapshot())
if (result.x !== 5) failures.push(`x=${result.x}`)
```

Migrated:

```js
// After — boot via test=1, clock already frozen, no setSpeed() needed.
const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
await page.goto(new URL('?test=1', baseUrl).toString(), { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function',
  null, { timeout: 30_000 },
)

// … debug verbs unchanged …

// Replace advanceGameDays with step(); 2 game-days = 2880 game-minutes.
await page.evaluate(async () => {
  await window.__uclife_test__.step({ gameMinutes: 2 * 24 * 60 })
})

// Replace bespoke snapshots with getGameState() where the field exists.
const money = await page.evaluate(
  () => window.__uclife__.getGameState().getPlayerCharacter().getResource('Money'),
)
assert.equal(money, 5, `player money should be 5, got ${money}`)
```

Common gotchas:

- `setSpeed(N)` is dead in test mode — the loop is stopped. Remove the
  line, don't migrate it.
- `advanceGameMinutes` / `advanceGameDays` / `forceDailyEconomics(day)`
  are domain-specific verbs that still work. If the test cares about a
  *single* day-rollover event, `forceDailyEconomics(day)` is more
  targeted than `step({ gameMinutes: 1440 })` — keep the bespoke verb.
- `waitForFunction(() => __uclife__.x() === …)` for sim state is
  forbidden under a frozen clock. Translate to `step({ until })`.
- Predicate inside `step({ until })` is called synchronously after
  every tick — keep it pure (no `await`, no `page.evaluate`).

### Category B — UI flow test (the pilot's shape)

```js
// Before
await page.goto(url)
await page.waitForFunction(() => globalThis.__uclife__?.cheatMoney)
await page.evaluate(() => globalThis.__uclife__.cheatMoney(5000))  // hand-roll state
await page.evaluate(() => globalThis.uclifeUI.getState().openFlight('vonBraunCityAirport'))
await page.click('.transit-terminal-go')
await page.waitForFunction(() => globalThis.__uclife__.useScene.getState().activeId === 'zumCity')
const player = await page.evaluate(() => globalThis.__uclife__.playerSnapshot())
if (player.pos.x !== 1280) failures.push('wrong arrival x')
```

Migrated:

```js
// After
const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
await page.goto(new URL('?test=1&fixture=traveller-at-vb-airport', baseUrl).toString(),
  { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.getGameState === 'function',
  null, { timeout: 30_000 },
)

await page.evaluate(() => window.uclifeUI.getState().openFlight('vonBraunCityAirport'))
await page.waitForSelector('.transit-terminal-go', { timeout: 5_000 })  // DOM readiness — allowed
await page.click('.transit-terminal-go')

// Drive the consequence with step({ until }) — sole wait primitive for sim.
await page.evaluate(async () => {
  await window.__uclife_test__.step({
    until: () => window.__uclife__.getGameState().getScene().getId() === 'zumCity',
    maxGameMinutes: 24 * 60,
  })
})

const pos = await page.evaluate(
  () => window.__uclife__.getGameState().getPlayerCharacter().getPosition(),
)
assert.equal(pos.scene, 'zumCity', `scene should be zumCity, got ${pos.scene}`)
assert.equal(pos.x, 1280, `arrival x should be 1280, got ${pos.x}`)
```

Common gotchas:

- `waitForSelector` for **DOM readiness** is allowed (we're waiting for
  React commit). `waitForFunction` for **sim state** is forbidden
  (clock is frozen — it loops forever).
- Don't seed state with `cheatMoney(N)` / `cheatPiloting(N)` — put it
  in a fixture under `tests/fixtures/`. Hand-rolled state mutations are
  the same anti-pattern fixtures replace.
- Real Playwright input only: `page.click(selector)`,
  `page.keyboard.press(key)`, `page.mouse.click(x, y)`. **Never**
  `evaluate(() => element.click())` — that bypasses React's synthetic
  event system.
- For Pixi canvas hit-tests, use
  `__uclife__.getEntityScreenCoords(entityId)` then
  `page.mouse.click(coords.x, coords.y)`. Don't click "near the
  player" — use the projection bridge.

### Category C — Renderer-pixel test

```js
// Before
await page.goto(url)
await page.waitForTimeout(2000)  // hope the renderer caught up
// … pixel reads …
```

Migrated, two flavors:

```js
// Flavor 1: still asserting pixels — opt into the asset pipeline.
await page.goto(new URL('?test=1&assets=1', baseUrl).toString())
await page.waitForFunction(
  () => typeof window.__uclife__?.awaitAssetsReady === 'function',
  null, { timeout: 30_000 },
)
await page.evaluate(() => window.__uclife__.awaitAssetsReady())
// … pixel reads …

// Flavor 2: structure-only — assert state, not pixels.
await page.goto(new URL('?test=1', baseUrl).toString())  // skipAssets default
await page.waitForFunction(
  () => typeof window.__uclife__?.getGameState === 'function',
  null, { timeout: 30_000 },
)
const view = await page.evaluate(() => window.__uclife__.getGameState().getPlayerCharacter())
// assert view.* fields, never pixels
```

Common gotchas:

- `awaitAssetsReady()` is a deterministic drain — it resolves when
  `pendingAssetJobs() === 0`. If a Promise never resolves, your asset
  pipeline forgot to call `endAssetJob()` — fix the pipeline, don't
  add a retry.
- Boot with `&assets=1` ONLY if you assert on pixel data. The default
  (skipAssets ON) still mounts the DOM tree — every `data-testid`
  selector still works.

### Category D — Already deterministic

Sanity-pass once: read it, confirm no `waitForTimeout` / `setSpeed` /
`test.retry`. Leave alone.

## Anti-patterns — explicitly forbidden

These will fail review unconditionally:

1. **`page.waitForTimeout(N)`** — for any reason. There is no
   acceptable use case in a deterministic suite.
2. **`page.waitForFunction(() => …sim state…)`** — under a frozen
   clock this loops forever. *Boot-existence* checks like
   `typeof window.__uclife__?.step === 'function'` ARE fine — they're
   checking module load, not sim state. So is *DOM-mount* polling like
   `document.querySelector('.status-panel')` once the React tree is up
   — that's a React-commit race, not a sim race.
3. **`useClock.getState().setSpeed(N)`** — the clock is frozen in test
   mode; `setSpeed` is a no-op. Remove the line.
4. **`test.retry(n)` / `try { … } catch { /* swallow */ }`** — if the
   signal needs retries to stay green, the underlying signal is wrong.
   Fix the signal.
5. **Captured savestates** — fixtures live in `tests/fixtures/*.json5`
   as hand-authored JSON5. Never paste a serialized world blob.
6. **`fireEvent`-style shortcuts** — `element.click()` /
   `element.dispatchEvent(...)` from inside `page.evaluate()` bypasses
   React's synthetic event system. Use `page.click()` /
   `page.keyboard.press()` / `page.mouse.click()` from the Playwright
   side instead.
7. **Dynamic `await import('/src/...')` from page.evaluate** — Vite
   hands the page a different module instance than the running app, so
   trait-identity queries silently match nothing. Expose helpers on
   `__uclife__` instead.

## Fixture authoring checklist

`tests/fixtures/<name>.json5`:

1. Define the top-level keys you need; the loader rejects unknown
   keys with a path-naming error message
   (`tests/fixtures.ts`'s `rejectUnknownKeys`).
2. Allowed top-level keys: `seed`, `startDate` (ISO 8601), `scene`,
   `player`, `factions[]`, `ships[]`, `npcs[]`. Each member has a
   strict shape — see `src/test/fixtures.ts` for the validator.
3. Coordinates are **tile-space**, not pixel-space. The loader
   multiplies by `worldConfig.tilePx`.
4. Scene id must come from `src/data/scenes.json5`. Faction id from
   `src/config/factions.json5`. Skill id from
   `src/config/skills.json5`. Ship template from
   `src/data/ship-classes.json5`. Workstation specId from the
   `Workstation.specId` enum (current list in
   `src/ecs/traits.ts`). Each ID failure names the path.
5. Register the fixture in `src/test/fixtures.ts`'s static `FIXTURES`
   map. The loader uses `?raw` Vite imports so the JSON5 ships into
   the test bundle.
6. Add a `*.test.ts` case asserting load round-trip — failure-mode
   assertions catch typos earlier than smoke-test red.
7. Validate locally with `npm run test:unit` (the fixtures.test.ts
   suite runs the loader against your fixture).

## Migration order — recommended batches

Each batch shares fixtures + thematic state shape, so the
fixture-authoring cost amortizes across the batch. Open one PR per
batch.

1. **Batch 1 — physiology** (5 tests):
   `check-physiology-cold` · `check-physiology-injury` ·
   `check-physiology-multi` · `check-physiology-sneeze` ·
   `check-physiology-ae-clinic` · `check-physiology-contagion`.
   Shared fixture: `player-healthy-at-vb`. All Category A.
   Effort: ~3–4 hr total.

2. **Batch 2 — fleet logistics** (6 tests):
   `check-fleet-launch` · `check-fleet-supply` (B, dialog clicks) ·
   `check-mothball-transfer` · `check-ship-repair` ·
   `check-light-hull-buy` · `check-pegasus-buy` ·
   `check-grant-fleet`. Shared fixture:
   `player-with-flagship-at-vb`. Mostly Category A;
   `check-fleet-supply` is B.
   Effort: ~6–8 hr total.

3. **Batch 3 — combat / cockpit** (4 tests):
   `check-cockpit` · `check-space-combat` · `check-captains-office` ·
   `check-war-room`. Shared fixture:
   `player-in-combat-at-vb`. All Category A.
   Effort: ~4 hr total.

4. **Batch 4 — civic dialogs** (3 tests):
   `check-hangar` (B) · `check-orbital-lift` (B) · `check-realtor`.
   Shared fixture: `player-with-cash-at-vb`. Two Category B.
   Effort: ~4 hr total.

5. **Batch 5 — UI loops + ambitions** (4 tests):
   `check-hotkeys` (B) · `check-systemmenu` (pilot, B) ·
   `check-ambitions` · `check-scene-swap` (B).
   Shared fixture: `minimal-player-only`. Three Category B.
   Pilot already merged; this batch absorbs the rest.
   Effort: ~5 hr total.

6. **Batch 6 — render** (5 tests):
   `check-portrait` (C) · `check-portrait-modals` (C) ·
   `check-portrait-enlarge` (C) · `check-sprite` (C) ·
   `check-sprite-ingame` (C). Opt into `&assets=1` only where
   pixels are asserted. Effort: ~3 hr total.

7. **Batch 7 — save/load + meta** (3 tests):
   `check-saveload` · `check-research` · `check-daily-economics`.
   Save/load resets the world so fixture-state-after-load is
   subtle — handle in its own PR. Effort: ~3 hr total.

Both previously-deferred baseline-broken tests
(`check-faction-office`, `check-recruit-office`) repaired + migrated
in a follow-up PR — see triage-table footnote.

## The pilot — `scripts/check-systemmenu.mjs`

The canonical worked example for Category B. Read it after this
playbook. Verified 10/10 back-to-back local runs (no `setTimeout`, no
`test.retry`, no try/catch around assertions).

Exercises every primitive from Phases 1–5:

- URL boot `?test=1&fixture=minimal-player-only` (Phase 4)
- JSON5 fixture `minimal-player-only` (Phase 5)
- `step({ gameMinutes })` and `step({ until })` (Phase 4)
- Real Playwright input: `page.click('button.hud-system')` + `page.keyboard.press('Escape')`
- `getGameState()` fluent reads for scene id, player money, scene dims
  (Phase 5)
- DOM readiness via `waitForSelector` (allowed — distinct from sim
  state)
- `node:assert` strict primitives; no custom DSL

## Known gaps

Defects observed while writing the pilot — do NOT fix in this PR; file
for follow-up.

1. **Fixture player shadows boot player.**
   `bootTestMode` calls `bootstrapApp()` before `applyFixture(name)`,
   so `setupWorld` has already spawned the default player with
   `EntityKey({ key: 'player' })` and `Money({ amount: 30 })`. The
   fixture's `applyPlayer()` then spawns a SECOND player with the same
   key, in the same scene. `getGameState().getPlayerCharacter()` calls
   `world.queryFirst(IsPlayer)` which returns the first-spawned one,
   so fixture-set money/skills/background are silently shadowed. Test
   `fixtures.test.ts` doesn't catch this because it calls
   `resetAllWorlds()` in `beforeEach`. Repro: load
   `minimal-player-only` (money=1234), read
   `getPlayerCharacter().getResource('Money')` — observed 30.
   Fix candidates: (a) `applyFixture` calls `resetWorld()` first,
   (b) `applyPlayer` mutates the existing IsPlayer entity instead of
   spawning a new one, (c) `bootTestMode` skips `setupWorld`'s player
   spawn when a fixture is requested.

2. **`__uclife__.getGameState().getDialogue().getActiveOptionKeys()`
   throws.**
   Implementation is a `throw new Error('not yet wired')`. Tests that
   inspect dialogue branch options today read DOM
   (`button.dialog-option`) — that's fine for now but the playbook
   pretends `getActiveOptionKeys()` is callable. Either implement it
   or remove from the public interface in `gameStateView.ts`.

3. **No `getGameState().getHangar(buildingKey)` etc.**
   Several Category B tests (e.g. `check-fleet-supply`,
   `check-hangar`) want to read hangar slots/manager/throughput via a
   typed view. Today they go through bespoke debug handles like
   `hangarSupplySnapshot(buildingKey)`. The migration path is: keep
   the debug handles for now (they're not flaky), promote them into
   `getGameState()` later. This is a "missing-method" gap, not a
   bug — note it in PR descriptions when you encounter it.

4. **Vite dev-cache staleness across phase merges.**
   While iterating on the pilot, the dev server served a pre-Phase-4
   `main.tsx` (no `?test=1` branch) until `node_modules/.vite` was
   cleared and the server restarted. Symptom: `__uclife_test__` is
   undefined, `__uclife__` has the prod handle set. If the smoke
   runner spawns its own dev server (CI), it's fine; local devs hitting
   `npm run dev` after merging Phases 4/5 need to `rm -rf
   node_modules/.vite` once. Not a code bug — worth a one-liner in
   `CLAUDE.md`.

## Out of scope

- New `__uclife__` methods (covered by gaps #2 + #3 above).
- Migrating any test beyond the pilot.
- Refactoring test-boot or fixture-loader internals.
