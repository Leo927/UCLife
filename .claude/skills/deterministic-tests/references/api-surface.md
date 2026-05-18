# API surface — full reference

Detailed signatures + behavior for everything a test interacts with. SKILL.md links here when a method or schema field needs more than a one-liner.

## URL params

Parsed in `src/test/bootTestMode.ts#parseTestBootParams`. Defaults to `?test=1` alone — minimum viable test mode boot.

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `test` | `1` | required | Without this, prod boot path. The branch is `import.meta.env.DEV`-gated. |
| `fixture` | string | none | Names a fixture in `src/test/fixtures.ts`'s `FIXTURES` map. Throws if unknown. |
| `seed` | string | `testConfig.defaultSeed` (`test-boot-default`) | Overrides fixture's `seed` field if both present. |
| `nowMs` | number | `Date.parse(testConfig.defaultStartIso)` | Frozen sim-clock epoch in ms. Overrides fixture's `startDate`. |
| `assets` | `1` | `0` | When unset, portrait/sprite/recolor/LPC pipelines short-circuit to placeholders. Set to opt into real asset loading + `awaitAssetsReady()` drain. |

`assets=1` keeps the DOM tree intact either way — every `data-testid` selector still works. Only opt in if you're asserting on pixel data.

## `__uclife_test__.step`

Two forms. Predicate (`until`) and unconditional (`gameMinutes`). Both return `Promise<void>` for API parity even though advancement is synchronous in test mode — tests `await` them so future async hooks (e.g. yielding a microtask between ticks to let React commits flush) can be added without breaking call sites.

```ts
step({ until: () => boolean, maxGameMinutes: number }): Promise<void>
```

- Advances sim time by `testConfig.tickGameMs` (16 game-ms) per iteration.
- Evaluates `until()` after **every** tick — predicate runs at maximum precision. Keep it pure (no `await`, no `page.evaluate` inside — predicate must run synchronously inside the page context).
- Returns immediately if `until()` is already true at entry.
- Throws if `maxGameMinutes` of sim time elapse without satisfaction. Error message includes the predicate's source (sliced to 200 chars) **and** a full `getGameState()` snapshot — read it before assuming the test is wrong, the consequence might not be firing at all.

```ts
step({ gameMinutes: number }): Promise<void>
```

- Unconditional advancement. Use when no consequence to await ("wait 3 days for delivery").
- Bounded by `testConfig.maxStepTicks` (5_000_000) as a safety upper bound — `step({ gameMinutes: 100_000 })` will throw rather than freeze the page.

**Predicate cadence is locked at every-tick.** If perf bites under a hot test, the design escape hatch is to expose `evaluateEvery: N` on `step` — don't pre-optimize.

## `__uclife__.getGameState()`

Returns a fresh `GameStateView` on every call — never cache. The model is read-only and methods grow per-test demand. Current surface (see `src/test/gameStateView.ts`):

```ts
interface GameStateView {
  getPlayerCharacter(): CharacterView      // throws if no IsPlayer entity in any scene
  getCharacter(id: string): CharacterView | null
  getShip(idOrName: string): ShipView | null
  getFaction(id: string): FactionView | null
  getDialogue(): DialogueView | null       // null when no active dialog
  getScene(): SceneView                    // currently-active scene
}

interface CharacterView {
  getId(): string                          // EntityKey.key
  getResource(key: string): number         // 'Money' | 'HP' | 'hunger' | 'thirst' | 'fatigue' | 'hygiene' | 'boredom'
  getStat(statId: string): number          // skills + attributes via StatSheet
  getPosition(): { scene: string; x: number; y: number }   // x/y in world pixels
  getHiredRole(): string | null            // EmployedAsCrew.role
  getAssignedShipId(): string | null       // EmployedAsCrew.shipKey
}

interface ShipView {
  getId(): string
  getHullPct(): number                     // hullCurrent / hullMax, or 0 if hullMax=0
  getDockedAt(): string | null             // POI key, null if not docked
  getCaptain(): CharacterView | null
  getCrew(): CharacterView[]
}

interface FactionView {
  getId(): string
  getResource(key: string): number         // only 'Money' wired today
  ownsBuilding(buildingKey: string): boolean
}

interface DialogueView {
  getWithNpcId(): string | null            // EntityKey of NPC the player is talking to
  getActiveOptionKeys(): string[]          // NOT YET WIRED — throws. Tests use DOM 'button.dialog-option' for now.
}

interface SceneView {
  getId(): string
  getDimensions(): { tilesX: number; tilesY: number }
}
```

Resources and stats are **string-keyed**, matching `src/stats/sheet.ts`. No schema commitment, maximum flexibility — if you query an unknown resource key, you get `0`, not an error.

When you need a view method that doesn't exist yet, add it. Mirror the fixture vocabulary, write a unit test in `src/test/gameStateView.test.ts`, and don't reach into bespoke debug snapshots (`playerSnapshot` et al.) — those are legacy and the migration is towards `getGameState()` being the only read path.

## `__uclife__.getEntityScreenCoords`

```ts
getEntityScreenCoords(entityId: string): { x: number; y: number } | null
```

World-space → screen-space bridge for Pixi canvas hit-tests. Returns `null` if the entity isn't visible (off-screen, not in active scene, or doesn't exist). Use with `page.mouse.click(coords.x, coords.y)`.

DOM-rendered UI uses `data-testid` selectors as today — only reach for `getEntityScreenCoords` when you need to click an in-world entity that exists only as a Pixi sprite.

## Asset pipeline drain

```ts
__uclife__.awaitAssetsReady(opts?: { timeoutMs?: number }): Promise<void>
__uclife__.pendingAssetJobs(): number
__uclife__.snapshotPendingAssetLabels(): string[]
```

- Only relevant when booted with `?assets=1`. In default (`skipAssets` on), `pendingAssetJobs()` is always `0` and `awaitAssetsReady()` resolves immediately.
- If `awaitAssetsReady()` hangs, an asset pipeline forgot to call `endAssetJob()`. Fix the pipeline, never wrap in retry. `snapshotPendingAssetLabels()` will tell you which pipeline is stuck.

## Fixture schema

Allowlist-based — unknown top-level keys, unknown player keys, unknown faction/ship/npc fields all throw with `applyFixture(name): <path> is not a recognized field (allowed: …)`. Validator is in `src/test/fixtures.ts`.

### Top level

```json5
{
  seed: string?,                // overrides URL seed if URL absent
  startDate: ISO 8601 string?,  // overrides URL nowMs if URL absent
  scene: string?,               // active scene at boot; must be in src/data/scenes.json5
  player: { ... }?,
  factions: [ { ... } ]?,
  ships: [ { ... } ]?,
  npcs: [ { ... } ]?,
}
```

### `player`

```json5
player: {
  money:    number?,            // starting Money
  location: { scene, x, y }?,   // x/y are TILE coords; loader * tilePx
  skills:   { <skillId>: number }?,  // skillId from src/config/skills.json5
  background: string?,          // background id; loader calls applyBackground
}
```

Location: `scene` must exist in `src/data/scenes.json5` (`isSceneId`). If `player.location` is omitted, the top-level `scene` is used at `(0, 0)`. If both are absent, the loader throws.

### `factions`

```json5
factions: [
  { id: string, money?: number },
]
```

`id` must exist in `src/config/factions.json5`. Mutates the live `Faction` entity's `fund` field. Throws if no live Faction entity matches.

### `ships`

```json5
ships: [
  { id: string, template: string, name?: string, dockedAt?: string },
]
```

- `template` is a ship-class id from `src/data/ship-classes.json5`. Throws on miss.
- `dockedAt` is a POI key (e.g. `'vonBraun'`). Loader does NOT validate this — typos will silently leave the ship docked to a nonexistent POI. Audit by hand or in a `*.test.ts`.
- First entry gets `IsFlagshipMark`.
- All ships spawn into the `playerShipInterior` world; the `Ship` trait is fully initialized from the class.
- Duplicate `id` within `ships[]` throws.

### `npcs`

```json5
npcs: [
  { id: string, name: string,
    at: { scene, x, y },
    skills?: { <skillId>: number },
    workstation?: string }
]
```

- `at.scene` validated against `src/data/scenes.json5`.
- `skills` validated against `src/config/skills.json5`.
- `workstation` matches the first free `Workstation` with `specId === workstation` in the NPC's scene. Throws if none free. Same NPC fills the slot via `Job` + `Workstation.occupant`.
- Color is hard-coded `'#cccccc'` for fixture NPCs — no appearance gen yet. Add a `color` field if a test needs it.
- Duplicate `id` within `npcs[]` throws.

### Registration

After authoring the JSON5, register it in `src/test/fixtures.ts`:

```ts
import myFixtureRaw from '../../tests/fixtures/my-fixture.json5?raw'

const FIXTURES: Record<string, string> = {
  // ...
  'my-fixture': myFixtureRaw,
}
```

The `?raw` import lets Vite bundle the JSON5 into the test build at compile time — no runtime fetch. Inline registration for unit tests: `__registerInlineFixtureForTest(name, raw)`.

## `test-config.json5` keys

Lives at `src/test/test-config.json5`. Values are read via `src/test/test-config.ts`. Don't hardcode these in tests — read from config (or, since they're stable, the values are reasonable to reference in failure messages by name).

| Key | Value | Why |
|-----|-------|-----|
| `tickGameMs` | `16` | Matches prod RAF nominal frame budget; same tick granularity tests see in real play. |
| `defaultStartIso` | `'2026-04-27T09:00:00Z'` | Anchor for boots that don't specify a date. |
| `defaultSeed` | `'test-boot-default'` | Anchor seed for boots that don't specify one. |
| `maxStepTicks` | `5_000_000` | Safety bound on per-step tick count. |
| `msPerGameMinute` | `60_000` | One game minute = 60 000 game ms. |
| `msPerGameSecond` | `1_000` | Used by `spaceSimSystem` dt-in-seconds conversion. |

## Boot order (for debugging boot-time bugs)

`src/test/bootTestMode.ts` does, in order:

1. `markTestMode({ skipAssets: !assets })` — sets the flag asset-loading entry points read.
2. `setSimRngSeed(seed)` — pins runtime RNG before `setupWorld()` runs.
3. `freezeSimNow(startMs)` — anchors `simNow()`.
4. `pinTestModeSpeed()` — `useClock.speed = 1`.
5. `bindAutosave / bindUi / bindPhysiology / bindFleetLaunch` — same event-binding shape as prod `main.tsx`.
6. `bootstrapApp({ skipDefaultPlayer: Boolean(fixture) })` then `stopLoop()` — bring worlds up, stop the RAF loop immediately (test mode owns sim-time progression).
7. `applyFixture(fixture)` if set.
8. Assemble + install `__uclife__` and `__uclife_test__` namespaces.
9. Mount React tree with the same `WorldProvider` + `key=${activeId}-${swapNonce}` shape prod uses.

If a fixture's player state is silently shadowed by boot defaults, step 6 didn't get `skipDefaultPlayer: true` — that's the regression.
