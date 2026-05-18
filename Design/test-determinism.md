# Test Determinism Architecture

**Status:** Substrate shipped (Phases 1–5, PRs #35–#39). Phase 6 in flight — pilot (#40) + batches B/C/A1/A2/A3 (#41–#46) + repair pass (#47) merged; remaining `scripts/check-*.mjs` conversions are the open tail.

## Problem

Integration tests in `scripts/check-*.mjs` were flaky: zero reproducibility under CI load, nine files using `waitForTimeout(60–3500 ms)` to paper over async drift. Root causes:

1. **Uncontrolled RNG leaks.** 8+ `Math.random()` sites in `systems/combat.ts`, `systems/recruitment.ts`, `systems/population.ts` produced different entity state every run even with `WORLD_SEED` fixed.
2. **Wall-clock timestamps baked into sim state.** `performance.now()` / `Date.now()` in `combat.ts`, `fleetTransit.ts`, `spaceSim.ts`, brig — non-reproducible across runs.
3. **Async asset pipelines** with no readiness barrier. Portrait / sprite / LPC / recolor all completing on their own schedule.
4. **No way to declare starting world state.** Every test booted a fresh world and spent dozens of debug-handle calls just to arrange — each call another opportunity to drift.
5. **No simulated-clock discipline in tests.** Tests advanced via `setSpeed(N) + waitForTimeout`, accumulating wall-clock variance.

## Architecture

End-to-end tests stay on Playwright. The substrate underneath becomes deterministic by construction:

- **Seeded RNG** routes every `Math.random()` in sim code through a single test-controllable source.
- **`simNow()`** replaces wall-clock reads in sim state so timestamps are stable.
- **Asset-ready barrier** drains in-flight pipelines on demand; **test mode skips the pipelines entirely** by default.
- **Hand-crafted JSON5 scenarios** declare starting world state. Loader translates schema → ECS ops. No captured savestates.
- **Sim clock is frozen** in test mode. The only way time advances is `step({ until, maxGameMinutes })` — the sole wait primitive in test code.
- **`getGameState()`** is a fluent, read-only façade for both wait-conditions and validate-assertions.

Tests look like real player input + explicit sim-time progression + standard assertions.

## The test lifecycle: Prep / Run / Validate

```js
import { launchTest, assertEquals } from './testkit.mjs'

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL
const { page, close } = await launchTest({
  url: `${baseUrl}?test=1&fixture=amuro-at-recruit-office`,
})

try {
  // ── PREP — URL did all the work: fixture applied, RNG seeded, clock frozen, no assets.
  const t0Money = await page.evaluate(() =>
    __uclife__.getGameState().getPlayerCharacter().getResource('Money'))

  // ── RUN — real player input ─────────────────────────────────────
  // Click on Amuro in the Pixi canvas. Sets move-target. Sim time does NOT advance.
  const amuroScreen = await page.evaluate(() =>
    __uclife__.getEntityScreenCoords('amuro'))
  await page.mouse.click(amuroScreen.x, amuroScreen.y)

  // Advance sim time until player walks over and dialogue opens.
  await page.evaluate(() => __uclife_test__.step({
    until: () => __uclife__.getGameState().getDialogue()?.withNpcId === 'amuro',
    maxGameMinutes: 30,
  }))

  // Pick "Hire as Captain" — DOM click, instant.
  await page.click('[data-testid="dialogue-option-hire-captain"]')

  // Advance sim time until the hire transaction settles.
  await page.evaluate(() => __uclife_test__.step({
    until: () => __uclife__.getGameState().getCharacter('amuro').getHiredRole() != null,
    maxGameMinutes: 5,
  }))

  // ── VALIDATE — standard assertions + fluent state view ──────────
  const state = await page.evaluate(() => {
    const gs = __uclife__.getGameState()
    return {
      role:          gs.getCharacter('amuro').getHiredRole(),
      captainOfShip: gs.getShip('white-base').getCaptain()?.getId() ?? null,
      moneyNow:      gs.getPlayerCharacter().getResource('Money'),
    }
  })

  assertEquals('captain',         state.role)
  assertEquals('amuro',           state.captainOfShip)
  assertEquals(t0Money - 50_000,  state.moneyNow)

  console.log('✓ check-hire-amuro')
} finally {
  await close()
}
```

**Disciplines, non-negotiable:**

- **Input is instant; consequences require simulated time.** Every player input is followed by a `step({ until })` that advances sim time until the consequence resolves.
- **Never** `waitForFunction` or `waitForTimeout` — with a frozen sim clock, `waitForFunction` loops forever. `step({ until })` is the only wait primitive.
- **Validate is partial.** Each test asserts only the minimum that proves its intent. `getGameState()` does not enforce any expectation shape.
- **No `fireEvent` shortcuts.** Tests drive the real UI path.

## API surface

### Boot via URL params — test mode is set at boot, not at runtime

```
http://localhost:5173/?test=1&fixture=amuro-at-recruit-office
```

| Param | Meaning |
|-------|---------|
| `test=1` | Branch into test boot path (DEV-only). Without this, normal prod boot. |
| `fixture=<name>` | Loads `tests/fixtures/<name>.json5` as initial world state. |
| `seed=<string>` | RNG seed. Overrides fixture's `seed` field if both present. |
| `nowMs=<number>` | Frozen sim-clock epoch-ms. Overrides fixture's `startDate` if both. |
| `assets=1` | Opt in to real asset loading. Default off — pipelines never start. |

`src/main.tsx` branches at the top under `import.meta.env.DEV`:
- If `?test=1`, hand off to `src/test/bootTestMode.ts`.
- Otherwise, normal prod boot.

The test-boot module:
1. Skips `preloadArt`, skips normal worldgen, skips intro flow.
2. Sets up deterministic primitives (seeded RNG, frozen `simNow()`).
3. Parses + applies the fixture into the koota world.
4. Mounts the React tree so UI clicks work.
5. Exposes the runtime test API.

In prod builds, the entire test-boot module is dead-code-eliminated. Zero test code ships to players.

### `__uclife_test__` — runtime API (DEV-only, exists only when booted into test mode)

```ts
// The sole wait primitive in test code. Advances sim time tick-by-tick (every
// game tick, ~16 game-ms) until `until()` returns true, OR throws naming
// `until` after `maxGameMinutes` of simulated time has elapsed.
step(opts: {
  until: () => boolean
  maxGameMinutes: number
}): Promise<void>

// Unconditional form: advance N game minutes. "Wait 3 days for ship to arrive."
step(opts: { gameMinutes: number }): Promise<void>
```

That's it. No `enterTestMode`, no `loadScenario`, no clock or RNG knobs — those are boot-time invariants, not runtime APIs.

### `__uclife__.getGameState()` — fluent read-only view (DEV-only)

The façade. Wraps existing scattered debug-handle helpers (`playerSnapshot`, `fleetRosterSnapshot`, `facilitySnapshot`, …) in a navigable model. Methods added on demand as tests need them.

```ts
interface GameStateView {
  getPlayerCharacter(): CharacterView
  getCharacter(id: string): CharacterView | null
  getShip(idOrName: string): ShipView | null
  getFaction(id: string): FactionView | null
  getDialogue(): DialogueView | null
  getScene(): SceneView                 // currently-active scene
  // ... grows organically per test demand
}

interface CharacterView {
  getId(): string
  getResource(key: string): number      // 'Money', 'HP', 'Fuel', ...
  getStat(statId: string): number       // skills, attributes via StatSheet
  getPosition(): { scene: string, x: number, y: number }
  getHiredRole(): string | null
  getAssignedShipId(): string | null
  // ...
}

interface ShipView {
  getId(): string
  getHullPct(): number
  getDockedAt(): string | null          // POI / hangar id
  getCaptain(): CharacterView | null
  getCrew(): CharacterView[]
  // ...
}

interface FactionView {
  getId(): string
  getResource(key: string): number      // 'Money', 'Reputation', ...
  ownsBuilding(buildingKey: string): boolean
  // ...
}
```

**Resources / stats are string-keyed**, matching `src/stats/sheet.ts`. Maximum flexibility, no schema commitment.

### `__uclife__.getEntityScreenCoords(entityId)`

```ts
// Bridges world-space → screen-space for Pixi canvas hit-tests.
// Returns null if entity isn't visible / in active scene.
getEntityScreenCoords(entityId: string): { x: number, y: number } | null
```

Tests use it with `page.mouse.click(coords.x, coords.y)` for in-game entities. DOM-rendered UI uses `data-testid` selectors as today.

### `__uclife__.awaitAssetsReady()` — already shipped (Phase 3)

```ts
awaitAssetsReady(opts?: { timeoutMs?: number }): Promise<void>
pendingAssetJobs(): number
snapshotPendingAssetLabels(): string[]
```

Only relevant when `enterTestMode({ skipAssets: false })`. In default test mode, resolves immediately (no pipelines started).

## Fixture schema

Hand-crafted JSON5 in `tests/fixtures/<name>.json5`. Loader translates schema → ECS operations (spawn templates, apply stats, place at coords). Schema grows organically per-test demand — start minimal.

```json5
// tests/fixtures/amuro-at-recruit-office.json5
{
  seed: 'hire-amuro-001',          // can be overridden by enterTestMode
  startDate: '2026-05-17T08:00:00Z',
  scene: 'vonbraun',

  player: {
    money: 5_000_000,
    location: { scene: 'vonbraun', x: 320, y: 180 },
    skills: { piloting: 50 },
    background: 'soldier',
  },

  factions: [
    { id: 'player', money: 0 },
  ],

  ships: [
    { id: 'white-base', template: 'pegasus', name: 'White Base',
      dockedAt: 'AE-hangar-1' },
  ],

  npcs: [
    { id: 'amuro', name: 'Amuro Ray',
      at: { scene: 'vonbraun', building: 'recruit-office' },
      skills: { piloting: 92, command: 65 },
      eligibleFor: ['captain', 'pilot'] },
  ],
}
```

**Principles:**

- **Hand-crafted only.** Never captured savestates. Captured blobs aren't diffable, rot when ECS shape changes, don't document what the test depends on.
- **Vocabulary mirrors `getGameState()`.** Fixture says `skills: { piloting: 92 }`; test reads `getCharacter('amuro').getStat('piloting')`. One model.
- **Same fixture is loadable into multiple tests.** Tests with similar setups share a fixture; tests with one-off needs get their own.
- **Loader fails loud on unknown fields / unresolvable references.** If `template: 'pegasus'` doesn't match a registered ship template, throw with the field path.

## Implementation phases & status

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 1 | Central seeded RNG | ✅ shipped, PR #35 | 7 systems/ sites routed through `getSimRng()`. 9 more sites in ecs/character/ai blocked by layer rules — promote to procgen if Phase 6 needs them. |
| 2 | `simNow()` shim | ✅ shipped, PR #36 | 5 sites refactored. Caught TacticalView consumer bug. |
| 3 | Asset-ready barrier | ✅ shipped, PR #37 | 10 portrait/sprite tests retrofitted, 50+ zero-flake runs. |
| 3.5 | Skip-assets test mode | ✅ shipped | `skipAssets:true` short-circuit wired at portrait/sprite/recolor/LPC entry points. Default-on in test mode. |
| 4 | `step({ until })` + frozen-clock + `getEntityScreenCoords` | ✅ shipped, PR #39 | Sim-clock frozen by default in test mode. RAF accumulation paused. `step` is the sole wait primitive. Canvas hit-test bridge in `src/test/canvasHitTest.ts`. |
| 5 | Scenario loader + `getGameState()` façade | ✅ shipped, PR #38 | `loadScenario(name)` in `src/test/fixtures.ts`. `getGameState()` façade in `src/test/gameStateView.ts`. |
| 6 | Migrate flaky tests to deterministic API | 🚧 in flight | Pilot #40 + batches B (#42), C (#43), A1 (#46), A2 (#45), A3 (#44), repair pass (#47) merged — ~26 tests converted. Remaining `scripts/check-*.mjs` (those still calling `setSpeed`/`waitForTimeout`) are the open tail. |

## Open follow-ups (tracked, deferred)

- **RNG layer-home decision.** If Phase 6 reveals tests that need determinism in `src/ecs/spawn.ts`, `src/ai/agent.ts`, `src/character/*` (which can't import `src/sim/`), promote `getRuntimeRng()` down to the procgen layer.
- **`preloadArt` wrap.** Phase 3's worktree was based on older HEAD; `src/render/assets/registry.ts:preloadArt` isn't wrapped. Re-base or add in Phase 3.5.
- **Pre-existing CI failures.** `check-faction-office`, `check-recruit-office` fail on baseline — facility-ownership regressions unrelated to this work. File separately.

## Sign-off decisions (locked)

1. **`getGameState()` v1 scope: fixed verified set upfront.** Character, Ship, Faction, Dialogue, Scene all implemented in Phase 5. Coherent API ships intact; risks some dead methods early.
2. **`__uclife_test__` source home: `src/test/`, DEV-only build path.** Separate top-level module, excluded from prod bundle. Won't ship test helpers to players.
3. **Fixture loader strictness: fail loud, name the field.** Throws with field path on any unknown key or unresolvable reference. Fixtures must be exact.
4. **`step({ until })` predicate cadence: every sim-tick.** Predicate runs after every game tick (~16 game-ms). Max precision. If perf bites, expose `evaluateEvery: N` later.
