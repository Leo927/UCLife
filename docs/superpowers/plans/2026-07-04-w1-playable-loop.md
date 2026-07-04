# W1 — Playable Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ship/combat loop playable end-to-end by a real player with no debug commands: earn → buy hull → board → undock → intercept a pirate → fight → dock home, plus MS custody/repair fixes.

**Architecture:** Workstream 1 of `docs/superpowers/specs/2026-07-04-ship-ms-combat-ux-design.md`. Fixes land in the existing layers: `src/sim/navigation.ts` + `src/systems/spaceSim.ts` (courses), `src/systems/enemyAI.ts` (pursuit), `src/systems/interaction.ts` (guards), `src/systems/hangarRepair.ts` (MS branch), `src/ecs/spawn.ts` (boot grant removal), dialogue branches (broker/manager verbs). Every task ends green on the standard gates; the final task adds the no-debug-drive capstone journey smoke.

**Tech Stack:** TypeScript, koota ECS, zustand, React dialogue panels, Playwright Test smokes on the deterministic substrate (`tests/smoke/_fixtures.ts`, `?test=1&fixture=…`), json5 config/data.

## Global Constraints

- Player-facing strings zh-CN; code/comments/commit messages English (CLAUDE.md).
- **No magic numbers in `.ts`** — every tunable goes to `src/config/*.json5` or `src/data/*.json5`.
- TDD: failing test first, then implementation. Smokes obey the 7 construction rules in `.claude/skills/deterministic-tests/SKILL.md`; `retries: 0` stays.
- **Acceptance smokes: debug handles observe, never drive** (new rule, Task 1). System smokes may still drive debug verbs.
- Sim-state waits use `sim.stepFor` / `sim.stepUntil` only. No `waitForTimeout`, no `setSpeed`.
- Verification commands: `npm run test:unit`, `npm run ci:local` (use `-- --grep <pat>` while iterating), `npx tsc -b`, `npm run lint:arch`.
- Commit after every task (never leave the tree dirty). One logical change per commit.
- Design-doc sync: a task that changes shipped behavior described in `Design/*.md` updates that doc in the same commit.

---

### Task 1: Acceptance-spine groundwork

**Files:**
- Modify: `.claude/skills/deterministic-tests/SKILL.md` (add rule to "The 7 hard rules" section → becomes 8)
- Modify: `CLAUDE.md` (Smoke-test reliability section, after rule 7)
- Delete: `tests/smoke/_walklag_diag.spec.ts` (orphaned diagnostic spec; has a dead `Win` declaration)

**Interfaces:**
- Consumes: nothing.
- Produces: the "observe, never drive" rule text that Tasks 5–10 cite in their spec files.

- [ ] **Step 1: Add rule 8 to CLAUDE.md** after construction rule 7, same list:

```markdown
8. **Acceptance journey smokes: `__uclife__` observes, never drives.** A spec named
   `journey-*.spec.ts` performs every player action through real input (walk, press E via
   keyboard, click DOM buttons / canvas coordinates). Debug verbs (`grantFleet`,
   `forceUndockFlagship`, `startCombatCheat`, …) are forbidden in journey specs — reads
   (`getGameState`, `getEntityScreenCoords`, `stepFor`/`stepUntil`, fixture boot) are the
   only `__uclife__` surface they may touch. System smokes may still drive debug verbs.
```

- [ ] **Step 2: Mirror the same rule in `.claude/skills/deterministic-tests/SKILL.md`** — append it to "The 7 hard rules (non-negotiable)" (retitle to "The 8 hard rules") and add one row to the anti-patterns list: `Debug verbs inside a journey-*.spec.ts — journey specs prove the player path; a debug write invalidates the proof.`

- [ ] **Step 3: Delete the orphan spec**

```bash
git rm tests/smoke/_walklag_diag.spec.ts
```

Note: the underscore prefix means it was never discovered by Playwright — deleting it changes no suite behavior.

- [ ] **Step 4: Verify gates**

Run: `npx tsc -b && npm run test:unit`
Expected: PASS (no code touched).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs(tests): journey smokes observe-never-drive rule; drop orphan diag spec"
```

---

### Task 2: Fix `hud-in-space-view` smoke (red at HEAD)

**Files:**
- Test: `tests/smoke/hud-in-space-view.spec.ts` (read; change only if the assertion is wrong)
- Modify: whichever component double-mounts `.space-view` (diagnosis; start at `src/ui/SpaceView.tsx` and its mount sites — grep `space-view`)

**Interfaces:**
- Consumes: nothing. Produces: a green pre-existing smoke; later tasks assume the suite is green at their start.

- [ ] **Step 1: Reproduce**

Run: `npm run ci:local -- --grep "hud"`
Expected: FAIL — `waitForSelector('.space-view')` times out with Playwright reporting "locator resolved to visible". That message pattern means the locator matched **more than one** element or the element detached mid-wait.

- [ ] **Step 2: Diagnose (systematic-debugging: find the root cause before touching the spec)**

In the failing trace (`npx playwright show-trace <trace.zip>`), count `.space-view` nodes at timeout. Hypothesis from the audit: two mounts (e.g. one from the helm view, one from a tactical/overlay path). Grep `className="space-view"` / `'space-view'` under `src/ui/` and `src/render/` and find both render paths; determine which mount is stale (not unmounted on scene change).

- [ ] **Step 3: Fix the root cause** — unmount the stale instance (conditional render keyed on `useScene((s) => s.activeId)`), NOT a spec workaround. If diagnosis instead shows a single node that detaches/re-attaches, key the component so it mounts once. Do not add `.first()` to the spec — that hides the double mount.

- [ ] **Step 4: Verify**

Run: `npm run ci:local -- --grep "hud"`
Expected: PASS 1/1. Then run the full suite once: `npm run ci:local` → all green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix(ui): single .space-view mount; hud-in-space-view smoke green"
```

---

### Task 3: Fix the Pixi batcher `null.clear` pageerror on combat entry

**Files:**
- Modify: the render teardown path that races (diagnosis; the error is thrown from Pixi v8's batcher during scene/overlay transitions — start at the tactical-view mount/unmount in `src/ui/TacticalView.tsx` and the Pixi app/container teardown in `src/render/`)
- Modify: `tests/smoke/_fixtures.ts:40-46` — after the fix, DELETE the `isKnownPixiBatcherClear` allowlist predicate and its registration so a regression fails the suite loudly.

**Interfaces:**
- Consumes: nothing. Produces: combat entry with zero pageerrors; the allowlist entry gone.

- [ ] **Step 1: Write the failing signal.** The fixture teardown already gates pageerrors; the allowlist is what hides this one. Remove `isKnownPixiBatcherClear` from `tests/smoke/_fixtures.ts` (predicate + wherever it's applied) and run the combat smokes:

Run: `npm run ci:local -- --grep "combat|cockpit"`
Expected: at least one spec FAILS with `Cannot read properties of null (reading 'clear')` in `page-errors.txt`. If none fails, the race is real-frame-timing-only — reproduce instead with a scratch prod-boot Playwright run entering combat (see `perf_harness_technique` memory), and keep the smoke-level assertion for after the fix.

- [ ] **Step 2: Diagnose.** The known shape (per the comment at `_fixtures.ts:40`) is a transient during scene transitions: a Pixi container/renderer is destroyed while a queued render tick still references its batcher. Find the combat-entry transition (overlay mount in `TacticalView.tsx` / render-layer swap) and identify what destroys a Pixi object without cancelling its pending tick.

- [ ] **Step 3: Fix** — cancel/flush the render ticker before destroying the container (e.g. `app.ticker.remove(...)` / guard the tick on a `destroyed` flag), at the teardown site identified in Step 2. No try/catch swallowing.

- [ ] **Step 4: Verify**

Run: `npm run ci:local`
Expected: all green with the allowlist gone.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix(render): cancel pending render tick before Pixi teardown; drop batcher-error allowlist"
```

---

### Task 4: Starter hull on sale (earned-acquisition part 1 — additive)

**Files:**
- Modify: `src/data/ship-classes.json5` — ensure the boot-flagship class (`lightFreighter`; confirm via the ship scene config's `shipClassId`) has a `priceFiat`
- Modify: `src/config/fleet.json5` — `salesRepCatalog` entry shape grows from `{ shipClassId }` to `{ shipClassIds: [...] }`
- Modify: `src/ui/dialogue/branches/aeShipSales.tsx` — render one product section per catalog hull
- Test: `src/ui/dialogue/branches/aeShipSales.test.ts` (new, unit — pricing invariant), `tests/smoke/pegasus-buy.spec.ts` (must stay green)

**Interfaces:**
- Consumes: `getShipClass(id).priceFiat`, `fleetConfig.salesRepCatalog[specId]`.
- Produces: `salesRepCatalog[specId] = { shipClassIds: string[] }` — Task 5's fresh-boot purchase path and Task 10's journey spec buy the first entry of the VB airport rep's list.

- [ ] **Step 1: Write the failing pricing unit test** (`src/data/ship-classes.test.ts` or co-located):

```ts
import { describe, it, expect } from 'vitest'
import { getShipClass } from './ship-classes'
import { jobsConfig } from '../config'   // adjust to the actual jobs-wage config export

describe('starter hull pricing', () => {
  it('lightFreighter is priced within a few in-game weeks of median wage income', () => {
    const cls = getShipClass('lightFreighter')
    const medianDailyWage = medianWageFromJobsConfig() // helper over jobs.json5 wage fields
    expect(cls.priceFiat, 'starter hull must exist with a price').toBeGreaterThan(0)
    expect(cls.priceFiat, 'starter hull must be reachable in ≤30 median wage-days')
      .toBeLessThanOrEqual(30 * medianDailyWage)
  })
})
```

Write `medianWageFromJobsConfig()` in the test file by reading the wage field off every job spec in `src/data/jobs.json5` (grep the wage key name first) and taking the median. Run: `npm run test:unit -- ship-classes` → FAIL (no `priceFiat`).

- [ ] **Step 2: Author the price.** Add `priceFiat` to the `lightFreighter` row in `src/data/ship-classes.json5`, set to ~21 × the median daily wage rounded to a clean number (comment the derivation in the json5 row). Run the unit test → PASS.

- [ ] **Step 3: Extend the catalog shape.** In `src/config/fleet.json5` change every `salesRepCatalog` entry to `{ shipClassIds: ['<existing id>'] }` and add `'lightFreighter'` as the FIRST entry of the VB airport rep's list (keep its existing hull second). Update the read site `aeShipSales.tsx:51` and loop the panel body per hull id (extract the current single-hull JSX into a `<HullSection shipClassId={id} />` component; buy handler unchanged per hull). Fully delete the old `{ shipClassId }` single-hull read — no compat shim.

- [ ] **Step 4: Verify existing buy smoke still passes**

Run: `npm run ci:local -- --grep "pegasus"` → PASS. Then `npx tsc -b` → clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(fleet): starter lightFreighter on sale at VB rep; multi-hull sales catalog"
```

---

### Task 5: Remove the boot flagship grant (earned-acquisition part 2)

The riskiest task: the game and many smokes assume a flagship exists from boot.

**Files:**
- Modify: `src/ecs/spawn.ts:1163-1219` (`bootstrapShipScene`) — stop spawning the flagship + starter MS at boot
- Modify: `src/systems/shipDelivery.ts` — first-ever received ship becomes the granted moment (starter MS + fuel top-up move here)
- Modify: `src/config/ms.json5` — `starterMsTemplateId: 'gm_pre'` → `'mobileWorker'` (a prototype GM is not plausible cargo on a used civilian freighter in UC 0077; the retrofit/gm_pre specs pin their frame via fixture instead)
- Modify: every null-unsafe caller of `getShipState()` / `queryFirst(Ship, IsFlagshipMark)` (audit step below)
- Create: `tests/fixtures/starter-fleet.json5` (the old boot state, now explicit: flagship docked VB + starter MS + parts inventory)
- Test: `tests/smoke/no-ship-start.spec.ts` (new)

**Interfaces:**
- Consumes: Task 4's purchasable `lightFreighter`.
- Produces: `tests/fixtures/starter-fleet.json5` — every existing ship-dependent smoke boots it; `grantStarterMsToFlagship()` renamed to `grantStarterMsToShip(shipKey: string)` called from `receiveShipDelivery` on the player's first hull.

- [ ] **Step 1: Write the failing no-ship-start smoke** (`tests/smoke/no-ship-start.spec.ts`):

```ts
import { test, expect } from './_fixtures'

test('fresh boot owns no ship; ship systems stay inert without crashing', async ({ sim }) => {
  await sim.boot({}) // no fixture — plain test-mode boot
  const state = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gs = (window as any).__uclife__.getGameState()
    return { ownsShip: gs.getPlayerFleet().getShipCount() > 0 }
  })
  expect(state.ownsShip, 'fresh boot must not own a boot-granted flagship').toBe(false)
  await sim.stepFor(60 * 24) // one full day: daily systems must tolerate the no-ship state
  // teardown page-error gate proves nothing crashed
})
```

If `getGameState().getPlayerFleet()` doesn't exist, add it to `src/test/gameStateView.ts` (count `Ship` entities owned by the player) with a unit test in `gameStateView.test.ts`. Run: FAIL (boot grants a ship).

- [ ] **Step 2: Create `tests/fixtures/starter-fleet.json5`** replicating today's boot state via the fixture loader's `ships:` support (see `tests/fixtures/board-from-drydock.json5` for the working vocabulary):

```json5
{
  seed: 'starter-fleet-001',
  scene: 'vonBraunCity',
  player: { money: 5_000, location: { scene: 'vonBraunCity', x: 20, y: 50 } },
  ships: [{ id: 'ship', template: 'lightFreighter', dockedAt: 'vonBraun', flagship: true }],
  // ms / parts keys: mirror whatever ms-starter.json5 already uses; extend the
  // loader only if a key is missing, with a fixtures.test.ts round-trip.
}
```

- [ ] **Step 3: Remove the boot grant.** In `bootstrapShipScene` delete the flagship `world.spawn(...)` block, `attachShipStatSheet`, `grantStarterMsToFlagship()` + `refreshMsLayout()` calls, and the `recomputeFleetFuelMax({ topUp: true })` seed (keep `seedShipSceneLayout`? NO — layout seeds when a ship is first boarded via `boardShipByKey`; verify `src/sim/scene.ts:130-179` seeds on board, then delete the boot-time seeding too). Rename `grantStarterMsToFlagship` → `grantStarterMsToShip(shipKey)` and call it from `receiveShipDelivery` when the received hull is the player's first (count owned `Ship` entities == 1 after materialize); also call `recomputeFleetFuelMax({ topUp: true })` there (the dealer delivers it fueled), and emit the onboarding breadcrumb (spec W1.1): `emitSim('toast', { textZh: '你的第一艘船已入库 · 前往机库闸口登船' })` plus a matching `emitSim('log', …)` line.

- [ ] **Step 4: Null-safety audit.** Grep every caller: `getShipState(`, `IsFlagshipMark`, `queryFirst(Ship`. For each call site that assumes a ship exists at boot (fleet HUD sliver, supply drain, war-room open, captain's office, helm/boarding interactions), confirm it already guards (most return early on `!ship`) or add the guard with a zh-CN toast where player-facing (`'你尚未拥有任何飞船'` — the string already exists at `interaction.ts:244`). Run `scripts/survive.ts` via `npm run ci:local -- --skip-survive` inverse — i.e. run the FULL `npm run ci:local` including survive to catch headless crashes.

- [ ] **Step 5: Migrate ship-dependent smokes.** Run `npm run ci:local`. Every spec that fails because no boot flagship exists switches its `sim.boot({...})` to `sim.boot({ fixture: 'starter-fleet' })` (or its existing fixture gains the `ships:` block). Expected set (from the audits): `cockpit`, `ms-sortie-loop`, `ms-starter-retrofit`, `war-room`, `fleet-launch`, `grant-fleet`, `pegasus-buy`, `board-from-drydock`, `dock-picker`, `hangar`, `pilot-roster`, `space-combat`, `cp-dp`, `hud-in-space-view`. Do NOT weaken any assertion; only the boot state moves into the fixture.

- [ ] **Step 6: Verify + docs**

Run: `npm run ci:local` → all green, including `no-ship-start`. `npx tsc -b` clean.
Update `Design/fleet.md` (flagship section: "granted at boot" note → earned acquisition) in the same commit.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(fleet)!: remove boot flagship grant — first hull is bought at the AE broker"
```

---

### Task 6: Intercept courses + reliable docking

**Files:**
- Modify: `src/ecs/traits/ship.ts:246-257` (`Course` gains `destEnemyKey`)
- Modify: `src/sim/navigation.ts` (`NavTarget` gains `{ kind: 'enemy'; enemyKey: string }`)
- Modify: `src/systems/spaceSim.ts:142-181` (retarget branch + arrival)
- Modify: `src/ui/SpaceView.tsx:317-380` (enemy click → intercept; course-preview line reads the live retarget)
- Test: `tests/smoke/intercept-and-dock.spec.ts` (new)

**Interfaces:**
- Consumes: `navigateTo` / `dockAt` from Task 5's surviving nav layer.
- Produces: `navigateTo({ kind: 'enemy', enemyKey })` — Task 10's journey uses it via real clicks; `Course.destEnemyKey: string | null`.

- [ ] **Step 1: Write the failing smoke** (system-level; drives nav via a debug handle, allowed outside journey specs). Fixture: reuse/extend `tests/fixtures/player-flagship-near-derelict.json5` pattern — flagship docked at `vonBraun`, one authored pirate patrol within reach:

```ts
import { test, expect } from './_fixtures'

test('intercept course chases a moving pirate to contact; dockAt reliably parks at an orbiting POI', async ({ sim }) => {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: ['__uclife__.debugNavigate'] })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.debugNavigate({ kind: 'enemy', enemyKey: '<authored pirate key>' }))
  await sim.stepUntil(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__uclife__.getGameState().getEngagement().isOpen()
  }, 60 * 12)
  // decline via store reset (system smoke), then dock home while vonBraun orbits on:
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.debugNavigate({ kind: 'dock', poiId: 'vonBraun' }))
  await sim.stepUntil(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__uclife__.getGameState().getPlayerFleet().getDockedPoiId() === 'vonBraun'
  }, 60 * 24)
})
```

Add the thin `__uclife__.debugNavigate` handle in `src/boot/debugHandles/` (routes to `navigateTo`/`dockAt`) and the `getEngagement()`/`getDockedPoiId()` view methods if missing. Run: FAIL (no enemy kind; and — if the playtest's dock bug reproduces — the dock leg times out).

- [ ] **Step 2: Implement intercept.** `Course` trait: add `destEnemyKey: null as string | null` (default null; document next to `destPoiId`). `navigateTo`: on `kind: 'enemy'`, resolve the enemy's current `Position` by `EntityKey` in the `spaceCampaign` world, set Course `{ tx, ty, destEnemyKey: enemyKey, destPoiId: null, active: true, autoDock: false }`. In `spaceSim.ts` retarget block (after the `destPoiId` branch):

```ts
if (course.destEnemyKey) {
  let live: { x: number; y: number } | null = null
  for (const en of world.query(EnemyAI, Position, EntityKey)) {
    if (en.get(EntityKey)!.key === course.destEnemyKey) { live = en.get(Position)!; break }
  }
  if (live) { tx = live.x; ty = live.y }
  else e.set(Course, { ...course, active: false, destEnemyKey: null }) // target destroyed/gone
}
```

- [ ] **Step 3: Diagnose the dock leg with the failing test** (skip if it passed — then the playtest bug lives in the UI path; check `SpaceView.tsx:341` right-click: it issues `navigateTo({kind:'poi'})` — verify the context-menu 停泊 path at `:374` is the one the playtest used, and that the course-preview line in `SpaceView` renders from the same live retarget the autopilot uses, not from a separately-derived POI position). Fix at the root: preview and autopilot must read one source of truth (the `Course` fields + the same live-position lookup). Also handle the `poiPosById` miss in `spaceSim.ts:146-152` — fall back to `derivedPoiPos(course.destPoiId)` instead of silently keeping the stale snapshot.

- [ ] **Step 4: Wire the UI intercept verb.** In `SpaceView.tsx`, clicking an enemy ship sprite (within `dockSnapRadius`-style pick tolerance — add `enemyPickRadius` to `src/config/space.json5`) opens the same context menu with an `拦截` action → `navigateTo({ kind: 'enemy', enemyKey })`.

- [ ] **Step 5: Verify**

Run: `npm run ci:local -- --grep "intercept"` → PASS. Full `npm run ci:local` green. `npx tsc -b` clean.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(space): intercept courses track live enemies; dock courses never chase stale POI snapshots"
```

---

### Task 7: Contact/pursuit/fuel tuning (config only + one budget test)

**Files:**
- Modify: `src/config/space.json5` — `aggroContactRadius: 24` → `96`; new `enemyPickRadius`; move `enemyAI` magic numbers here as `enemyAi: { patrolWaypointRadiusPx: 40, chaseHysteresis: 1.5, speedFactor: 0.85 }`
- Modify: `src/systems/enemyAI.ts:24-26` — delete the module constants, read `spaceConfig.enemyAi.*`
- Modify: `src/data/space-entities.json5` — raise authored per-entity `aggroRadius` so patrols genuinely pursue (target: a patrol within ~1/8 map width of the player's course notices them)
- Modify: `src/data/ship-classes.json5` — `lightFreighter.fuelMax: 16` → `60`
- Test: `tests/smoke/fuel-budget.spec.ts` (new)

**Interfaces:**
- Consumes: Task 6's `debugNavigate` handle + intercept course.
- Produces: tuned constants the journey spec (Task 10) depends on to reach a fight and return on one tank.

- [ ] **Step 1: Write the failing budget smoke** — encodes the spec's perf/economy budget ("a standard sortie uses ≤ 50 % of a starter tank"):

```ts
import { test, expect } from './_fixtures'

test('starter sortie round trip uses at most half the tank', async ({ sim }) => {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: ['__uclife__.debugNavigate'] })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const read = () => sim.page.evaluate(() => (window as any).__uclife__.getGameState().getPlayerFleet().getFuel()) // { current, max }
  const before = await read()
  // Leg 1: intercept the nearest authored pirate (same call shape as Task 6's spec, Step 1)
  // Leg 2: dock back at vonBraun (same call shape as Task 6's spec, Step 1)
  const after = await read()
  const used = before.current - after.current
  expect(used, 'sortie round trip must fit in ≤50% of a starter tank').toBeLessThanOrEqual(0.5 * before.max)
})
```

Fill the two nav legs exactly as in Task 6's spec (intercept → dock). Run: FAIL (takeoff alone eats 78 %).

- [ ] **Step 2: Apply the tuning** listed under **Files** (all data/config edits, zero `.ts` logic beyond the `enemyAI.ts` config read swap). Keep `takeoffFuelCost` values in `src/data/pois.json5` unchanged (12 from vonBraun is fine against a 60 tank).

- [ ] **Step 3: Verify** — budget smoke PASS; `npm run ci:local` full green (combat smokes are sensitive to enemy speed/aggro — if one regresses, fix the fixture's authored positions, not the constants).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "tune(space): contact radius, pursuit config-ified, starter tank — sortie fits half a tank"
```

---

### Task 8: MS custody — terminal guard, unload/load verbs, de-inert depot sprites

**Files:**
- Modify: `src/systems/interaction.ts:321-347` (`climbIntoMs` + `msTerminal` guards)
- Create: `src/systems/msCustody.ts` — `unloadMsToDepot(msKey, poiId)` / `loadMsAboard(msKey, shipKey)`
- Modify: `src/ui/dialogue/branches/hangarManager.tsx` — two new manager verbs listing eligible MS
- Test: `src/systems/msCustody.test.ts` (unit), `tests/smoke/ms-custody.spec.ts` (smoke)

**Interfaces:**
- Consumes: `Ms` trait custody fields (`storedOnShipKey` / `dockedAtPoiId`, exactly one non-empty at rest), `refreshMsLayout()` / `refreshDepotMsLayout(sceneId)` from `src/ecs/spawn.ts`, `poiIdForHangar`.
- Produces: `unloadMsToDepot(msKey: string, poiId: string): { ok: boolean; reasonZh?: string }` and `loadMsAboard(msKey: string, shipKey: string): { ok: boolean; reasonZh?: string }` — Task 9's repair reaches depot MS through the states these write.

- [ ] **Step 1: Failing unit tests** (`src/systems/msCustody.test.ts`): unload flips `storedOnShipKey: 'ship'` → `''` + `dockedAtPoiId: poiId` (only when the host ship is docked at that POI; refuse otherwise with `reasonZh`); load does the inverse gated on the ship's free `hangarCapacity` slots. Use the koota world test pattern from an existing `src/systems/*.test.ts`. Run → FAIL.

- [ ] **Step 2: Implement `msCustody.ts`** (pure ECS state flips + the two layout refresh calls + a zh-CN sim log each way, e.g. `MS 已卸运至地面机库` / `MS 已装载上舰`). All gates read config/template values — no inline numbers.

- [ ] **Step 3: Fix the guards.** `interaction.ts:335-339`: `msTerminal` allowed when `getActiveSceneId() === 'playerShipInterior'` OR the active scene hosts the hangar whose POI matches the MS's `dockedAtPoiId` (resolve via the `MsRef` → `Ms` lookup; simplest correct check: the target MS's `dockedAtPoiId !== ''` and the terminal entity lives in the active scene — it was spawned there by `refreshDepotMsLayout`). Same relaxation for `climbIntoMs` at depot: outside combat, route to `emitSim('ui:open-ms-retrofit', { msKey })` instead of the `尚未进入战斗` rejection toast (in-combat behavior unchanged).

- [ ] **Step 4: Manager verbs.** In `hangarManager.tsx`, next to the existing MS-transfer panel, add `卸运MS至本机库` (lists MS aboard player ships docked at this hangar's POI → `unloadMsToDepot`) and `装载MS上舰` (lists depot MS at this POI + docked player ships with free bays → `loadMsAboard`). Follow the file's existing list-row + confirm-button pattern.

- [ ] **Step 5: Failing→passing smoke** (`tests/smoke/ms-custody.spec.ts`, real input for the verb clicks): boot `starter-fleet`, walk to the hangar manager (reuse the walk/click pattern from `hangar.spec.ts`), unload the starter MS, assert `getMs` custody flip + that a depot `msTerminal` press-E now opens the retrofit panel (`waitForSelector` on the panel's data-testid), install a frame mod (the depot-only verb the catch-22 blocked — asserts the whole chain). Run → PASS.

- [ ] **Step 6: Verify + docs.** `npm run ci:local` green; `npx tsc -b` clean. Update `Design/fleet.md`'s custody note if it contradicts (storage depot-only ↔ starter MS arrives aboard: document "MS may ride aboard; depot is where deep work happens").

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(ms): ship<->depot custody verbs; depot terminals usable — frame-mod catch-22 closed"
```

---

### Task 9: MS repair lifecycle at the depot

**Files:**
- Modify: `src/ecs/traits/ms.ts` — add `damageState: 'ready' as 'ready' | 'in-repair'` (repair progress is the hull/armor deficit itself; no separate 0..1 field — YAGNI until a UI needs it)
- Modify: `src/systems/hangarRepair.ts` — repair pool spreads over damaged ships AND depot MS at the POI
- Modify: the MS save handler in `src/boot/saveHandlers/` (grep `Ms(` there) — round-trip `damageState`
- Test: `src/systems/hangarRepair.test.ts` (extend/create), `tests/smoke/ms-repair.spec.ts`

**Interfaces:**
- Consumes: Task 8's custody states (`dockedAtPoiId` set = at depot).
- Produces: depot MS return to full hull/armor over game days; `Ms.damageState` flips `'in-repair'` while deficit > 0 at a depot, `'ready'` at zero. The supply-drain derivation in `src/systems/fleetSupplyDrain.ts` (`hullCurrent < hullMax || armorCurrent < armorMax`) swaps to `damageState === 'in-repair'` per the note in `Design/fleet.md` — update BOTH in this task.

- [ ] **Step 1: Failing unit test.** In `hangarRepair.test.ts`: seed a hangar with staffed workstations + one damaged depot MS at the POI → run `hangarRepairSystem(day)` → assert MS armor repairs first, then hull, and `damageState` transitions; assert a damaged MS still `storedOnShipKey`-aboard is NOT repaired (depot-only per spec). Run → FAIL.

- [ ] **Step 2: Implement.** Add `findDamagedMsAtPoi(poiId)` beside `findDamagedShipsAtPoi` (query `Ms` where `dockedAtPoiId === poiId` and hull/armor deficit > 0), fold both lists into the existing focus/spread accumulator (the `applyRepair` armor-then-hull helper generalizes: extract a shared `applyRepairTo(current/max fields)` used by both trait shapes). Write `damageState` on every repair application and on damage writes in `applyDamageToMs` (`src/systems/combat.ts:1014`) — damaged at a depot → `'in-repair'`, else stays `'ready'`-with-deficit until it lands at a depot.

- [ ] **Step 3: Save round-trip.** Extend the MS save handler serializer + a load assertion in its existing test (grep the handler's test file; follow the per-trait registry pattern in `src/save/registry.ts`).

- [ ] **Step 4: Smoke** (`tests/smoke/ms-repair.spec.ts`): boot `starter-fleet` variant with a pre-damaged depot MS (fixture field — extend the fixture loader's ms block with `hullCurrent` if missing + `fixtures.test.ts` round-trip), `sim.stepFor(60 * 24 * N)` days, assert full restore via `getMs`. Run → PASS.

- [ ] **Step 5: Verify + docs.** Full gates green. Update `Design/fleet.md`'s "In-repair, in code" note (the interim derivation is now the real `damageState`).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ms): depot repair lifecycle — damaged MS restore via hangar throughput"
```

---

### Task 10: Capstone journey smoke (no-debug-drive)

**Files:**
- Create: `tests/smoke/journey-first-sortie.spec.ts`
- Create: `tests/fixtures/earned-start.json5` — player at VB airport with purse = starter hull price + a margin authored in the fixture; NO ships block
- Possibly modify: `src/test/canvasHitTest.ts` / `src/test/gameStateView.ts` — read-only helpers only (e.g. `getPoiScreenCoords(poiId)`, `getEnemyScreenCoords(key)`) — allowed by rule 8

**Interfaces:**
- Consumes: everything above. Produces: the W1 definition-of-done; W2/W3 extend this file.

- [ ] **Step 1: Write the journey spec.** Shape (every action real input; every read via `getGameState` / screen-coord helpers; `sim.stepUntil` between action and consequence):

```ts
import { test, expect } from './_fixtures'

test('journey: buy → board → undock → intercept → fight → tally → dock home → disembark', async ({ sim }) => {
  await sim.boot({ fixture: 'earned-start' })
  // 1. Walk to the AE ship rep (click-to-walk via getEntityScreenCoords on the rep npc), open dialogue, click buy on the lightFreighter section, pick the VB hangar radio, confirm.
  // 2. stepFor(lead-time days from fleetConfig.delivery.lightHull); walk to hangar manager; click receive-delivery.
  // 3. Walk to the gate-booth board pad; press E → assert scene 'playerShipInterior'.
  // 4. Walk to helm; press E → space view; click vonBraun-adjacent pirate → 拦截 (context menu button).
  // 5. stepUntil engagement modal open; click 交战; fight on auto-fire (stepUntil victory or player hull < authored floor — the fixture's pirate is a single pirateLight vs the freighter's mounts).
  // 6. Recoverables → tally panels: click through; assert money increased.
  // 7. Click vonBraun POI → 停泊; stepUntil docked; walk to 下船 kiosk; press E → assert city scene.
})
```

Expand each numbered line into real selectors/coords as you go; every `expect` names its invariant (e.g. `'buying must enqueue a delivery'`, `'boarding must land in the ship interior'`). If any step CANNOT be done with real input, that is a W1 bug — fix the affordance (new task-level commit), don't fall back to a debug verb.

- [ ] **Step 2: Run it until green deterministically**

Run: `npm run ci:local -- --grep "journey" --workers=1` then the full `npm run ci:local` twice back-to-back.
Expected: PASS both runs, 1/1 each.

- [ ] **Step 3: Update the spec's status + commit**

Mark W1 shipped in `docs/superpowers/specs/2026-07-04-ship-ms-combat-ux-design.md` (one-line status note per W1.x).

```bash
git add -A && git commit -m "test(journey): no-debug first-sortie loop — W1 acceptance spine green"
```

---

## Task order & dependencies

1 → 2 → 3 are independent hygiene (do in order anyway). 4 → 5 (starter hull must be buyable before the grant is removed). 6 → 7 (tuning presumes intercept exists). 8 → 9 (repair reaches depot MS through custody). 10 last, consumes everything. Suggested single-branch execution, one PR per task or one PR for the workstream — per repo convention, open the PR and wait for CI green before calling any task done.
