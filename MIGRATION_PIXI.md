# Migration plan — Konva → Pixi

Replace `react-konva` + `konva` with `pixi.js` v8 across the three Konva-consuming files (`src/render/Game.tsx`, `src/render/sprite/CharacterSprite.tsx`, `src/ui/SpaceView.tsx`). `src/ui/TacticalView.tsx` is already DOM-only and is out of scope. The portrait pipeline (`src/render/portrait/*`) is SVG-based and unaffected.

## Why

Four compounding wins, only one of which is pure perf:

1. **Batched WebGL draws.** Konva is Canvas 2D — every node is a draw call. With layered LPC sprites (skin / hair / clothing / etc.) every NPC is N draw calls, and the city scene already pushes hundreds of nodes. Pixi batches into single GL calls per texture atlas.
2. **Sprite composition caching via `RenderTexture`.** Bake N LPC layers into one texture per appearance, draw as one quad. Eliminates per-frame layer composition entirely. (The Phase 0 prep ports this win even before Pixi lands — see below.)
3. **Scene-graph hit-testing kills the O(N) click scan.** `src/render/Game.tsx:163-207` linearly scans all NPCs and interactables on every pointer event with custom priority rules. Pixi's per-DisplayObject pointer events with bubbling solve this for free; same in Konva *in principle*, but we never refactored to per-node listeners and it's easier to do during the swap than as a separate pass.
4. **Post-processing.** Konva's filters are CPU `getImageData` ops — orders of magnitude too slow for per-frame use. Pixi has a mature filter ecosystem (`pixi-filters`: AdvancedBloom, ColorMatrix, Glow, Shockwave, RGBSplit, …) that runs as GPU shader passes. Required for space combat to read as space combat (engine bloom, combat grading, low-HP vignette, impact chromatic aberration).

Particles fall out as a bonus: `@pixi/particle-emitter` is well-maintained, GPU-batched, and slots in once Pixi is mounted.

## Non-goals

- **Phaser.** Rejected earlier in this thread — its scene system fights Koota's per-world model, its physics (Arcade/Matter) doesn't fit grid-based pathfinding or space combat, and the framework lock-in costs more than the renderer-as-library wins.
- **Replacing the sim, ECS, save/load, pathfinding, BT, procgen, audio, or asset loading.** This is a *renderer* migration. Everything else stays.
- **Replacing the portrait pipeline.** It's SVG via the FC pregmod port; Pixi has no role there.
- **Touching `TacticalView.tsx`.** It's DOM at 30Hz. If it ever needs richer visuals it can be migrated as a follow-up; not in this plan.

## Strategy

Vertical-slice, **space-first**. Pixi lands in `SpaceView` (smaller surface, where post-fx and particles matter most), then ground city migrates after the pipeline is proven. Konva and Pixi coexist for the duration of phases 1–5; phase 6 removes Konva. Each phase is independently shippable and revertible via `git revert`.

React integration: **raw imperative Pixi inside `useEffect`**, not `@pixi/react`. The renderer is driven by ECS queries on a fixed update loop; React's reconciler buys nothing for that and adds overhead. UI overlays (HUD, modals, status bars) stay DOM/React above the Pixi canvas — same architecture as today.

## Phases

Every phase below conforms to the "Perf budgets — non-negotiable" rule in `CLAUDE.md`: stated target N, ms budget, complexity analysis at PR time, and `*_PROF=1` profile output for any system on the hot path.

---

### Phase 0 — LPC sprite composition cache (pre-migration, renderer-agnostic)

**Goal.** Bake composed LPC layers per appearance hash into an offscreen `HTMLCanvasElement`. Konva consumes the cached canvas as an `Image` source today; Pixi will consume it via `Texture.from(canvas)` in Phase 5.

**Scope.** New `src/render/sprite/spriteCache.ts`. Hash key = stable serialization of appearance fields that affect layer composition (sex, skin, hair, top, bottom, shoes, hat). LRU eviction at e.g. 200 entries. `CharacterSprite.tsx` calls into the cache instead of rendering layers per frame.

**Perf budget.** N = 200 NPCs in a single scene. Cache hit: <0.05ms (one canvas-blit). Cache miss: <5ms (one-time layer composition). Steady-state hit rate: >95% after 30 game-seconds. Whole-frame sprite render: <1ms at N=200 (vs current N×layers Konva nodes).

**Verification.** Existing `npm run check:sprite` and `check:sprite-ingame` pass unchanged. Add `SPRITE_PROF=1` log line: `[sprite] N=… hits=… misses=… avgMissMs=… avgHitMs=…`.

**Rollback.** Single commit. Revert restores per-frame layer rendering.

**Why first.** It's pure win regardless of renderer choice and the second-largest perf headroom on the table. Doing it before Pixi means the migration carries less perf risk per phase.

---

### Phase 1 — Pixi foundation

**Goal.** `pixi.js@^8` installed; an empty `<PixiCanvas/>` mount/unmount component proven to coexist with the existing React tree without breaking the HUD overlay.

**Scope.** `npm install pixi.js`. New `src/render/pixi/PixiCanvas.tsx` that creates `new Application()` in `useEffect`, attaches the canvas to a div, destroys on unmount. Initially mounted nowhere (proof-of-life only) or behind a debug flag.

**Perf budget.** Empty Pixi canvas at 1280×720: <1ms/frame, <30MB GPU memory. Bundle size delta: ≤+250KB gzipped (Pixi v8 core only — no plugins yet).

**Verification.** Build + typecheck green. Mount in a debug page; confirm clean tear-down on unmount. Existing smoke tests unaffected.

**Rollback.** Single commit. Revert removes the dep.

---

### Phase 2 — SpaceView migration

**Goal.** `src/ui/SpaceView.tsx` renders via Pixi, not Konva. ECS-driven imperative update loop. React HUD overlays (helm controls, fuel/supply readouts) stay DOM.

**Scope.** New `src/render/space/PixiSpaceRenderer.ts` — class with `mount(canvas)`, `update(dt, snapshot)`, `destroy()`. `SpaceView.tsx` rewritten as a thin React component that mounts the renderer and forwards ECS query results once per frame. Star field, celestial bodies, POIs, ships, courses, basic projectile sprites.

**Perf budget.** N = 50 ships + 200 projectiles + 500 stars + 30 celestial bodies. Render <3ms/frame. ECS-to-display sync <1ms/frame. 60fps sustained on integrated GPU.

**Verification.** New `scripts/check-space-pixi.mjs` smoke test: load `spaceCampaign` scene, confirm canvas renders, ships move per ECS state, click-to-set-course works. `SPACE_PROF=1` log line per frame.

**Rollback.** Phase 2 commit reverts cleanly — `SpaceView.tsx` returns to Konva.

---

### Phase 3 — Particles in space combat

**Goal.** Adopt `@pixi/particle-emitter` for engine thrust, weapon fire, hit impacts, explosions. Pooled, capped, profiled.

**Scope.** `npm install @pixi/particle-emitter`. New `src/render/space/particles.ts` — emitter pool, type registry (thrust / muzzle / impact / explosion), `spawn(type, position, …)` API called from combat events. Cap concurrent particles globally (e.g. 1000); emitters return to pool when exhausted.

**Perf budget.** N = 1000 concurrent particles. Render <2ms/frame. Allocation rate: zero per frame in steady state (pool everything).

**Verification.** Stress test: scripted combat scenario spawning sustained 1000 particles for 10 seconds. `PARTICLE_PROF=1` log: pool hits, allocation count, peak concurrent.

**Rollback.** Phase 3 commit reverts cleanly — particles disappear, ships still render.

---

### Phase 4 — Post-processing in space

**Goal.** Bloom on engines/beams/explosions, color grading for combat mood, vignette for low-HP, chromatic aberration on hit.

**Scope.** `npm install pixi-filters`. Apply filters at the scene Container level (whole-scene bloom + grading) and per-Sprite (engine glow). Filter intensity driven by gameplay state (combat phase → grading shift; low HP → vignette intensity).

**Perf budget.** Combined filter cost <2ms/frame at 1280×720. Filters disable cleanly at lower render scales (settings option for low-end devices).

**Verification.** Visual smoke (manual capture comparison). `FILTER_PROF=1` log per filter.

**Rollback.** Phase 4 commit reverts cleanly.

---

### Phase 5 — Ground city migration

**Goal.** `src/render/Game.tsx` and `src/render/sprite/CharacterSprite.tsx` render via Pixi. Per-DisplayObject pointer events replace the Stage-level click scan. `pixi-viewport` provides camera (pan/zoom/clamp/follow).

**Scope.** Largest phase. New `src/render/ground/PixiGroundRenderer.ts`. ECS-driven update loop. Buildings, roads, walls, doors, NPCs, interactables, player. LPC sprites consumed via `Texture.from(spriteCache.get(appearance))` from Phase 0. Per-node `eventMode='static'` + `pointerdown` handlers replace `Game.tsx:141-214`. `pixi-viewport` replaces the manual `camX/camY` translate.

**Perf budget.** N = 200 NPCs + 80 buildings + 2000 wall tiles + 500 road tiles. Render <4ms/frame. Click resolution <0.5ms (scene-graph hit-test, not O(N) scan). 60fps sustained at 1× and 16× game speed.

**Verification.** Full smoke battery: `check.mjs`, `check-saveload.mjs`, `check-scene-swap.mjs`, `check-flights.mjs`, `check-systemmenu.mjs`, `check-chatbubble.mjs`, `check-map.mjs`. Each must pass unchanged. New `RENDER_PROF=1` log: nodes, draw calls, frame time, click resolve time. NPC soak via `npx tsx scripts/survive.ts` must complete a 30-day run without regression.

**Rollback.** Single commit revert restores Konva ground rendering. Phase 0 sprite cache stays — it's renderer-agnostic.

---

### Phase 6 — Konva removal

**Goal.** Delete `react-konva` and `konva` from `package.json`. Remove all Konva imports. Bundle size win.

**Scope.** `npm uninstall react-konva konva`. Grep for any remaining `from 'konva'` / `from 'react-konva'` / `KonvaEventObject` references; delete. TypeScript build verifies completeness.

**Perf budget.** Bundle size: net ≥−100KB gzipped (Konva removed; Pixi already counted in Phase 1). Build time: ≤current.

**Verification.** Full smoke battery + `tsc -b`. Bundle size before/after via `npm run build` + `dist/` inspection.

**Rollback.** Same commit revert restores both deps. Practically irreversible once downstream phases land — but since this is the *removal* phase, that's by design.

---

## Risks and mitigations

- **Two renderers in the tree for phases 1–5.** Both deps loaded in dev/prod for the duration. Mitigation: bundle splitting via Vite chunks if size becomes a concern; in practice the migration window should be days-to-weeks per phase, not months.
- **The agent (me) shipping naive baselines during the migration.** This is exactly the failure mode the new `CLAUDE.md` rule guards against. Each phase PR description must include the perf budget table and complexity analysis or the phase isn't done. No exceptions.
- **Smoke test coverage gaps.** Phases 2 and 5 add new smoke scripts (`check-space-pixi.mjs`) and existing ones must stay green. If any existing script depends on Konva-specific DOM (e.g. `.konvajs-content` selectors) it'll need a renderer-agnostic rewrite.
- **`@pixi/react` is *not* used.** This is a deliberate choice — the renderer is ECS-driven, not React-state-driven. If a future contributor adds `@pixi/react` for UI ergonomics, it must be confined to non-hot-path UI overlays.
- **Pixi v8 vs v7.** v8 is the current major (significantly different from v7 — new `Application.init()` API, etc.). All examples in this plan target v8. Don't regress to v7 docs.

## Order-of-operations summary

| Phase | Depends on | Touches | Reversible |
|-------|------------|---------|------------|
| 0 — Sprite cache | — | `CharacterSprite.tsx`, new `spriteCache.ts` | ✅ |
| 1 — Pixi foundation | — | `package.json`, new `PixiCanvas.tsx` | ✅ |
| 2 — SpaceView | 1 | `SpaceView.tsx`, new `PixiSpaceRenderer.ts` | ✅ |
| 3 — Particles | 2 | new `particles.ts`, combat events | ✅ |
| 4 — Post-fx | 2 | `PixiSpaceRenderer.ts` | ✅ |
| 5 — Ground city | 0, 1 | `Game.tsx`, `CharacterSprite.tsx`, new `PixiGroundRenderer.ts` | ✅ |
| 6 — Konva removal | 5 | `package.json`, residual imports | One-way |

Phases 0 and 1 are independent and can ship in parallel. Phase 5 is the largest single piece of work; phases 2–4 are warm-up that prove the pipeline before it carries the city.
