# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

UC Life Sim — a browser RPG life simulator set in Gundam UC 0077 lunar city Von Braun. Player-facing language is **zh-CN**; this file, code, comments, commit messages, and inspector UI are in English. See `Design` for the full design doc.

License: **GPL-3.0-or-later** (transitively, via the verbatim FC pregmod portrait code in `src/render/portrait/`). Do not strip the content guardrail in `src/render/portrait/adapter/characterToSlave.ts`.

## Commands

```bash
npm run dev                  # Vite dev server, http://localhost:5173 (host:true for LAN)
npm run build                # tsc -b && vite build (auto-runs build:portrait-cache via prebuild)
npm run preview              # serve dist/
npm run build:portrait-cache # rebuild SVG → JSON sprite maps under src/render/portrait/assets/cache/

# Playwright smoke tests — REQUIRE a dev server already running on :5173.
# Outputs land in scripts/out/.
npm run check:portrait
npm run check:portrait-modals
npm run check:portrait-enlarge
npm run check:sprite
node scripts/check.mjs                # baseline HUD/canvas probe
node scripts/check-saveload.mjs       # save/load roundtrip
node scripts/check-scene-swap.mjs     # flight + scene swap
node scripts/check-flights.mjs
node scripts/check-systemmenu.mjs
node scripts/check-sprite-ingame.mjs
node scripts/check-chatbubble.mjs
node scripts/check-map.mjs
node scripts/ai-soak.mjs              # AI behavior soak; uses window.__uclife__

# Headless NPC soak — runs the sim without a browser.
npx tsx scripts/survive.ts [days]     # default ~survives N game-days, logs deaths
npx tsx scripts/perf-survive.ts       # perf profiling variant
```

There is no test framework — verification is the smoke-test scripts plus the headless `survive.ts` harness. Type-checking is `tsc -b` (run as part of `npm run build`).

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

`src/render/Game.tsx` is the `react-konva` Stage. Sprite composition is in `src/render/sprite/` — `appearanceToLpc.ts` adapts UC's `Appearance` trait to LPC layer keys; `compose.ts` resolves them to URLs under `/lpc/` (or `VITE_LPC_BASE_URL`). The animation ticker runs separately from the sim clock; see `animTick.ts`.

### Portrait pipeline (FC pregmod port)

`src/render/portrait/{infrastructure,dispatcher,vector,revamp}/*.js` are **byte-identical** verbatim copies from FC pregmod (GPL-3.0). Anything new lives in `bridge.ts` (Twine→ESM shim that sets up `globalThis.App` / `globalThis.V` / `globalThis._`), `infrastructure/cacheLoader.ts` (replaces FC's Twine-passage cache with the JSON sprite map produced by `scripts/buildPortraitCache.ts`), `adapter/` (UC traits → FC `SlaveLike`), and `react/` wrappers. See `src/render/portrait/README.md` for the upstream sync workflow.

### NPC behavior (mistreevous BT)

`src/ai/trees.ts` defines the tree string; `src/ai/agent.ts` builds a per-NPC agent that `npcSystem` instantiates lazily. The agent calls `refreshContext()` once per BT step to snapshot `Vitals`/`Inventory`/`Money`/`Position`/`Action` so the BT's many condition predicates don't re-fetch.

### Smoke-test debug handle

In dev, `globalThis.__uclife__` is exposed with `{ world, useClock, useScene, movePlayerTo(tx, ty), countByKind() }`. Playwright smoke tests should drive scenarios through this handle. **Do not** dynamically `await import('/src/ecs/traits.ts')` from a test — it returns a different module instance and the imported traits won't match what the running app uses. Expose helper functions on `__uclife__` instead (see `src/main.tsx`).

## Perf budgets — non-negotiable

Any new (or materially changed) system that touches all entities of a class — NPCs, projectiles, interactables, ships, tiles — per click, per tick, or per frame **requires the following before it can be marked done:**

1. **Stated target N** — the realistic upper bound this system must handle (e.g. "500 NPCs in a single scene", "1000 projectiles in a tactical encounter", "2000 tiles in the largest map").
2. **Stated perf budget** — a concrete ms/tick or ms/frame target at that N (e.g. "<2ms/tick at N=500", "<0.5ms/click at N=1000").
3. **Complexity analysis** — written in the PR/commit description: what's the per-call cost in terms of N, and what's the structural reason it stays under budget? "Linear scan, fine because N is small" is not acceptable for systems whose N grows with content.
4. **Profile output** — for any system flagged hot (per-tick across all entities, per-frame in render, per-click across collections), include a profiling log line gated behind a `*_PROF=1` env var (see `HPA_PROF=1` in `src/systems/hpa.ts` for the pattern).

The agent default is "ship the simplest data structure that compiles" — linear scans, nested loops over entity arrays, recomputing what could be cached. **This default has shipped multiple correctness regressions in this codebase** (BT-throttle attempt broke drive interrupts; HPA* short-path fallback masked 100% pathfinding failure; click handler still does O(N) NPC scan). Stop shipping naive baselines and patching the wall later. Confront the scaling at design time.

When in doubt: prefer a battle-tested narrow library (`rbush` for spatial broad-phase, scene-graph hit-testing in the renderer, etc.) over a hand-rolled linear scan. Pull in the library *first*, not after the wall.

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
- Strong emphasis on automated testing harness. Maintain a single suite of regression test. 
- Don't rush to implementation. Always refine the design with the user first. 
- Always prefer MCP server over raw API call
- Always commit on every iteration