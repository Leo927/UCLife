# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

UC Life Sim — a browser RPG life simulator set in Gundam UC 0077 lunar city Von Braun. Player-facing language is **zh-CN**; this file, code, comments, commit messages, and inspector UI are in English. See `Design` for the full design doc.

License: **GPL-3.0-or-later** (transitively, via the verbatim FC pregmod portrait code in `src/render/portrait/`). Do not strip the content guardrail in `src/render/portrait/adapter/characterToSlave.ts`. The project has an expected subsystem count of 15

## Commands

```bash
npm run dev                  # Vite dev server, http://localhost:5173 (host:true for LAN)
npm run build                # tsc -b && vite build (auto-runs build:portrait-cache via prebuild)
npm run preview              # serve dist/
npm run build:portrait-cache # rebuild SVG → JSON sprite maps under src/render/portrait/assets/cache/

# Unit tests — vitest, pure logic only, no dev server. Co-located *.test.ts
# files next to source. Runs as the `unit` CI job.
npm run test:unit

# Smoke / regression suite — standalone. Spawns its own Vite dev server on an
# ephemeral port (no need to `npm run dev` first); each invocation gets a
# fresh port so concurrent runs (subagents, worktrees) don't collide.
# Sources its step list from the `test` job in .github/workflows/ci.yml so
# local and CI stay in lockstep. Outputs land in scripts/out/.
npm run ci:local                # serial (default)
npm run ci:local -- --workers 4 # parallel against the same dev server
```

**TDD is mandatory.** Write the failing test before the production code, watch it fail, then make it pass. Follow *Clean Code* (Robert C. Martin) for naming, function size, single responsibility, and dependency direction.

Two test layers, two CI jobs:
- **Unit tests** (`npm run test:unit`, CI job `unit`) cover pure logic — `*.test.ts` co-located with source; no dev server, no Playwright. Don't put smoke tests here.
- **Smoke tests** (`npm run ci:local`, CI job `test`) drive the running app via the `__uclife__` debug handle. The single source of truth for this suite is the `test` job in `.github/workflows/ci.yml` (which `scripts/ci-local.mjs` parses); do **not** introduce parallel one-off check scripts that live outside it, and do **not** add unit-test runners to the smoke `test` job. New `check-*.mjs` scripts must read their target URL as `process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'` so the runner can inject the ephemeral port.

Type-checking is `tsc -b` (run as part of `npm run build`).

## LPC sprites in dev

`vite.config.ts` mounts the sibling `../Universal-LPC-Spritesheet-Character-Generator/spritesheets/` checkout at `/lpc/`. Without that sibling repo, character sprites 404 in dev. For prod builds, set `VITE_LPC_BASE_URL` to wherever the sprites are hosted; `src/render/sprite/compose.ts` reads it.

## Architecture

### Koota ECS, multi-world per scene

`src/ecs/world.ts` builds **one koota `World` per scene** declared in `src/data/scenes.json5` and exposes a `Proxy` named `world` that forwards every call to whichever scene is currently active. Each scene has its own coordinate space starting at (0,0) up to its declared `tilesX`/`tilesY` — there is no shared geometry.

Cross-scene player movement is **destroy-and-respawn**, not entity-transfer (entity ids are world-stamped). `src/sim/scene.ts:migratePlayerToScene` snapshots portable traits, frees back-references (Bed.occupant, Workstation.occupant) in the source scene, destroys the player, and respawns in the destination. Job/Home/PendingEviction are intentionally dropped — they reference origin-scene entities.

The React side has a subtle pitfall: koota's `useQuery` seeds entity arrays via `useState` *once*, so swapping `WorldProvider`'s `world` prop alone leaves stale entity references. `src/main.tsx` keys `<App key={activeId}>` to force a full unmount on scene swap.

Adding a scene = a JSON5 row in `scenes.json5`. `bootstrapMicroScene` in `src/ecs/spawn.ts` reads `scene.procgen?.enabled` to gate the road+building generator; scenes without procgen (or with `enabled: false`) load empty except for whatever the scene declares via `fixedBuildings`, `survivalSources`, transit terminals, and flight hubs. No bootstrap-dispatch code lives in `world.ts`.

### Game loop and tick pipeline

`src/sim/loop.ts` runs a single `requestAnimationFrame` loop. Per-frame minutes = `dt * effectiveSpeed`. Real-time systems (movement, NPC BT, interaction) run every frame; per-tick systems run inside `while (tickAccum >= 1)`. **Order matters** and is:

```
movement → npc → interaction
  per-tick: clock.advance → vitals → action → rent → work → stress
            → releaseStaleBarSeats → releaseStaleRoughSpots
            → attributes → population → relations → activeZone
```

`stressSystem` runs **after** `vitalsSystem` so saturation triggers see fresh values. Day-rollover detection runs after `clock.advance` and triggers a throttled autosave.

**Hyperspeed ("committed" mode)** auto-engages during a long player action (eat/sleep/work/etc.) when no vital is in danger; the player can `forceHyperspeed` through danger via a toast button. `src/debug/store.ts` exposes `alwaysHyperspeed` and `superSpeed` overrides.

Do **not** throttle `tree.step()` in `npcSystem` — skipping BT frames breaks drive-interrupt reactivity. The NPC system already handles throttling correctly via 60 buckets, a dynamic per-game-speed cycle, and an immediate wake when an NPC's action transitions to `idle`. See `src/systems/npc.ts` header for the design.

### Pathfinding (HPA\*)

`src/systems/pathfinding.ts` runs grid A\* on a half-tile (16px) sub-grid sized to the **max** scene envelope across every scene — buffer is allocated once, indexed by `y*COLS+x`, and cells past a smaller scene's logical envelope are simply never touched. The static wall grid is cached per scene; per-call obstacle overlays apply door locks (cell-keyed via `Door.bedEntity`, faction-keyed via `Door.factionGate`).

`src/systems/hpa.ts` is single-level HPA\* on top of the same grid. Set `HPA_PROF=1` to enable profiling output. Call `markPathfindingDirty()` when walls change; call `markHpaDirty()` if you change connectivity without changing walls.

### Active zone

`src/systems/activeZone.ts` partitions NPCs into Active (full BT + body collision + per-tick drives) vs. Inactive (coarse tick). Internally throttled via `worldConfig.activeZone.membershipTickMin`, so calling every game-tick is free at 1× and amortizes at hyperspeed.

### Procgen + save/load

`src/procgen/index.ts` exports `WORLD_SEED`, `SeededRng`, and the pure city-generation pipeline. **Same seed → same world.**

The city generator runs in three stages, gated on `scene.procgen.enabled`:

1. `generateRoadGrid(rect, roadsCfg, rng)` (`roads.ts`) — places vertical avenues + horizontal streets at randomized gaps, recursively splits qualifying super-blocks with one alley each. Returns `{ segments, subBlocks }`. Each sub-block carries which sides touch which road kind.
2. `assignBuildings(rect, subBlocks, districts, rng)` (`blocks.ts`) — buckets sub-blocks per district (by center-containment), sorts each bucket largest-first, then for each block picks a fitting building type. Per-district pool is `types: [{ id, min?, max? }]`; types with unmet `min` are placed first (largest-min-footprint ties broken randomly), then types with `placed < max` fill the rest. This is how airports (`min: 1, max: 1` in commercial) reliably claim a big enough block before shop/bar/etc. consume them.
3. `generateCells(building, cellCount, corridorSide, rng)` (`cells.ts`) — single orientation-aware cell-layout generator. The two original "horizontal_cells"/"vertical_cells" algorithms collapsed into one `cells` algorithm; corridor side is decided per-slot by the road-facing wall, not baked into the building type.

Roads are drawn as `Road({ x, y, w, h, kind })` entities under buildings (`src/render/Game.tsx`'s ground sub-layer). The pathfinder treats them as plain non-wall walkable space — no special-case logic.

**Special building algorithms** (`buildingTypes.ts`):
- `airport` — open interior, single ticket counter spawned 1.5 tiles inside the wall opposite the primary door. Binds to the matching `flights.json5` hub by `sceneId` (1:1 per scene). Counter + arrival pixel coords land in `src/sim/airportPlacements.ts`'s runtime registry; FlightModal/scene migration read from there. To support flights, the host scene's commercial district pool **must** include `{ id: 'airport', min: 1, max: 1 }`.
- `park` — no exterior walls and no doors. Random taps/scavenge/benches scatter inside the rect (counts drawn uniformly from `taps`/`scavenge`/`benches` ranges in the type spec). Replaces the old `survivalSources` field on scenes — fixtures now live inside parks instead of being hand-placed.

`src/save/index.ts` exploits the seeded determinism: saves persist only *dynamic* state (vitals/money/action/etc., the clock, population counters). Reload = `resetWorld()` + patch dynamic traits onto entities matched by stable `EntityKey`. Entity references survive the round-trip via key indirection. 4 slots: `'auto'` + 1..3 (manual). Autosaves fire on day rollover and on hyperspeed start, throttled by `timeConfig.autosaveCooldownRealSec`.

Never spawn NPCs inside luxury/apartment cells — locked cell doors will trap them. Place hand-picked tiles (player spawn, fixed buildings, survival sources) **outside** `procgen.rect` — the road carver doesn't currently know about holes, so anything inside the rect risks colliding with a generated road or building.

### Config

`src/config/*.json5` are parsed once at module import via `?raw` + `json5.parse()`. **No hot reload** — refresh after editing. To add a tunable: add the value with a comment to the relevant `.json5`, add the field to the loader's interface, then import from `../config`.

### Render

`src/render/Game.tsx` is a thin React shell that mounts `PixiCanvas` (`src/render/pixi/`) and drives `PixiGroundRenderer` (`src/render/ground/`) via per-frame ECS snapshots — no `useQuery`/`useTrait` subscriptions for world-space visuals. Sprite composition is in `src/render/sprite/` — `appearanceToLpc.ts` adapts UC's `Appearance` trait to LPC layer keys; `compose.ts` resolves them to URLs under `/lpc/` (or `VITE_LPC_BASE_URL`). NPCs/interactables attach per-DisplayObject `pointerdown` handlers (Pixi `eventMode='static'`) so empty-space clicks fall through to the host-level walk handler — no O(N) hit-testing scan. The animation ticker runs separately from the sim clock; see `animTick.ts`.

### Portrait pipeline (FC pregmod port)

`src/render/portrait/{infrastructure,dispatcher,vector,revamp}/*.js` are **byte-identical** verbatim copies from FC pregmod (GPL-3.0). Anything new lives in `bridge.ts` (Twine→ESM shim that sets up `globalThis.App` / `globalThis.V` / `globalThis._`), `infrastructure/cacheLoader.ts` (replaces FC's Twine-passage cache with the JSON sprite map produced by `scripts/buildPortraitCache.ts`), `adapter/` (UC traits → FC `SlaveLike`), and `react/` wrappers. See `src/render/portrait/README.md` for the upstream sync workflow.

### NPC behavior (mistreevous BT)

`src/ai/trees.ts` defines the tree string; `src/ai/agent.ts` builds a per-NPC agent that `npcSystem` instantiates lazily. The agent calls `refreshContext()` once per BT step to snapshot `Vitals`/`Inventory`/`Money`/`Position`/`Action` so the BT's many condition predicates don't re-fetch.

### Smoke-test debug handle

In dev, `globalThis.__uclife__` is exposed with `{ world, useClock, useScene, movePlayerTo(tx, ty), countByKind() }`. Playwright smoke tests should drive scenarios through this handle. **Do not** dynamically `await import('/src/ecs/traits.ts')` from a test — it returns a different module instance and the imported traits won't match what the running app uses. Expose helper functions on `__uclife__` instead (see `src/main.tsx`).

### Smoke-test reliability — non-negotiable

A flaky smoke test is worse than no smoke test: it teaches the team to ignore CI red, and the next real regression slips through. **Reliability is the primary acceptance criterion for any new check-*.mjs / playwright scenario, ranked above coverage breadth.**

Required before a new smoke test can be marked done:

1. **Drive through `__uclife__`, not the DOM.** Read state from the deterministic debug handle. Don't assert on rendered text, sprite positions, or Pixi canvas pixels unless the test is explicitly *about* the renderer — DOM/canvas timing is the #1 source of flakes here.
2. **No fixed `sleep`/`waitForTimeout`.** Wait on a *condition* (`page.waitForFunction(() => __uclife__.something)`), not on wall-clock ms. If you find yourself reaching for `setTimeout(2000)`, expose a deterministic signal on `__uclife__` instead.
3. **Drive sim time, not real time.** Advance the clock via the debug handle (or `superSpeed`/`alwaysHyperspeed` overrides). A test that sits through real seconds of game time is a flake waiting to happen on a slow CI runner.
4. **Seeded determinism only.** Same `WORLD_SEED` → same world. Tests must not depend on procgen RNG drift or tick-order races. If a scenario depends on a specific spawn, pin it via `special-npcs.json5` / `scenes.json5` rather than fishing for a procedural NPC.
5. **Soak before merging.** Run the new check 20× back-to-back via `npm run ci:local -- --workers 4` (or a tight loop) before declaring it stable. **20/20 green is the bar.** A test that passes 19/20 will fail every weekday in CI — delete it or fix the root cause; do not merge it with a retry wrapper.
6. **No retry wrappers, no `test.retry(n)`, no try/catch swallowing.** If a check needs retries to stay green, the underlying signal is wrong — fix the signal.
7. **Fail loud, fail fast.** Every assertion must produce a message that points at the broken invariant, not "expected true to be true". On failure, dump relevant `__uclife__` state to the log so the post-mortem doesn't require a repro.

If you can't meet these bars for a scenario, **don't add the test** — file the gap as a TODO in the scenario doc and move on. Coverage gaps are visible; flaky CI is corrosive.

## Perf budgets — non-negotiable

Any new (or materially changed) system that touches all entities of a class — NPCs, projectiles, interactables, ships, tiles — per click, per tick, or per frame **requires the following before it can be marked done:**

1. **Stated target N** — the realistic upper bound this system must handle (e.g. "500 NPCs in a single scene", "1000 projectiles in a tactical encounter", "2000 tiles in the largest map").
2. **Stated perf budget** — a concrete ms/tick or ms/frame target at that N (e.g. "<2ms/tick at N=500", "<0.5ms/click at N=1000").
3. **Complexity analysis** — written in the PR/commit description: what's the per-call cost in terms of N, and what's the structural reason it stays under budget? "Linear scan, fine because N is small" is not acceptable for systems whose N grows with content.
4. **Profile output** — for any system flagged hot (per-tick across all entities, per-frame in render, per-click across collections), include a profiling log line gated behind a `*_PROF=1` env var (see `HPA_PROF=1` in `src/systems/hpa.ts` for the pattern).

The agent default is "ship the simplest data structure that compiles" — linear scans, nested loops over entity arrays, recomputing what could be cached. **This default has shipped multiple correctness regressions in this codebase** (BT-throttle attempt broke drive interrupts; HPA* short-path fallback masked 100% pathfinding failure; click handler still does O(N) NPC scan). Stop shipping naive baselines and patching the wall later. Confront the scaling at design time.

When in doubt: prefer a battle-tested narrow library (`rbush` for spatial broad-phase, scene-graph hit-testing in the renderer, etc.) over a hand-rolled linear scan. Pull in the library *first*, not after the wall.

## Parallel agent isolation — mandatory

Every `Agent` call that may modify the working tree (any tool that writes — Edit, Write, NotebookEdit, or Bash with mutating commands like `npm install`, `git commit`, build/codegen scripts) **MUST** be spawned with `isolation: "worktree"`. This is non-negotiable: parallel agents writing into the same checkout corrupts each other's work and produces lost edits that are very hard to diagnose after the fact.

Read-only agents (Explore, claude-code-guide, Plan, research/audit prompts that don't write) MAY run without isolation.

When an isolated agent finishes:

1. The harness returns `{ worktreePath, branch }` (auto-cleaned only if zero changes were made).
2. Inspect with `git -C <worktreePath> log main..HEAD` and `git -C <worktreePath> diff main...HEAD` before doing anything else.
3. To merge back: `git -C <worktreePath> push -u origin <branch>` then `gh pr create` from that worktree. **Do not merge into `main` without explicit user approval** — surface the PR URL and wait.
4. After merge: `git worktree remove <worktreePath>` and `git branch -d <branch>`. Do not leave stale worktrees in `.claude/worktrees/`.

When parallelizing N independent tasks, send the N `Agent` calls in a single message (concurrent tool uses) — each gets its own worktree off the current commit, and conflicts surface at PR-merge time, which is the point.

Caveats to respect:
- Worktrees do **not** isolate shared external state (running dev server ports, browser localStorage, files outside the repo). Don't run `npm run dev` in two worktrees against the same port; `ci:local` already picks ephemeral ports and is safe.
- Worktrees share `.git` but each gets its own `node_modules`. Agents that need a fresh `npm install` will pay that cost — factor it into whether parallelization is actually a win for short tasks.
- If agent B depends on agent A's output, **sequence them** — don't parallelize and hope. A finishes → merges to `main` → B spawns off the new `main`.

## Conventions

- Comments are reserved for intention that cannot be inferred from the code directly. 
- Player-facing strings: zh-CN. Everything else (this file, code, comments, debug labels, console logs): English.
- **Refactors must fully delete obsoleted code** — old files, store flags, dead imports. No "deprecated" comments left behind.
- Special characters and world content are data-driven in `src/data/*.json5` (e.g. `special-npcs.json5`, `scenes.json5`, `world-map.json5`, `flights.json5`). Background/filler NPCs are procedural — generated via `src/data/nameGen.ts` and `src/data/appearanceGen.ts`. Don't add named NPCs to procgen.
- When growing the map/world, prefer expanding the envelope over rearranging existing slots.
- Don't introduce backwards-compat shims for code you're replacing — change it and delete the old version.
- Keep design doc in sync. 
- Always use git for version control on each iteration.
- Strong separation of logic, data and config. At the end of project we should have a reusable engine that can be used on other projects.
- Prefer delegate to subagents to maintain context integrity.
- TDD is non-negotiable. Failing test first, then code. Pure logic goes under unit tests (`npm run test:unit`); end-to-end behavior goes under the smoke regression suite (`npm run ci:local`) — extend the existing layer, don't fork it.
- Follow *Clean Code* discipline: small intention-revealing names, small focused functions, single responsibility, prefer composition and injection over globals.
- Don't rush to implementation. Always refine the design with the user first. 
- Always prefer MCP server over raw API call
- Always commit on every iteration
- Use the plantuml skill to generate plantuml for diagram. 