# Desired architecture (target)

This directory holds diagrams the codebase is being refactored **toward**. A diagram here describes the seam being maintained today after the architecture-cleanup waves landed; further diagrams require the same design conversation that 001 went through.

## Status

`001_component_layers.puml` is authored as of Wave 4. The rest of the suggested set (`002`-`006`) is **not yet authored** — the next agent picking this up should not assume they exist. Wave 7 (render snapshot type pinning) landed.

## Cleanup waves landed

- **Wave 1 — sim/save event bus.** `src/sim/events.ts` is a typed pub/sub. `src/save/index.ts` emits `load:start` / `load:end`; `src/sim/loop.ts` emits `day:rollover` / `hyperspeed:start`. `src/boot/autosaveBinding.ts` subscribes for autosave. The bidirectional save <-> sim/loop import cycle is gone.
- **Wave 1.5 — save handler registry.** `src/save/registry.ts` plus 16 cluster files under `src/boot/saveHandlers/` invert per-subsystem reach. `save/index.ts` iterates handlers blindly; adding a 17th persisted subsystem is one new file in `src/boot/saveHandlers/`, not an edit to `save/index.ts`.
- **Wave 2 — sim -> ui edge severed.** No `systems/*` file imports from `ui/`. `activeZone` switched from a camera-viewport coupling to a player-radius rule, removing the last reverse edge.
- **Wave 3 — debug handle registry.** `src/debug/uclifeHandle.ts` plus 8 cluster files under `src/boot/debugHandles/` invert the `globalThis.__uclife__` god-object. `main.tsx` dynamic-imports the manifest behind `import.meta.env.DEV`; Rollup tree-shakes it from prod. The 300-line literal in `main.tsx` became 8 cluster files of 10-50 lines each.
- **Wave 5 — per-world singletons + per-trait save registry.** `src/ecs/resources.ts` exposes a `WorldSingleton` marker trait and `worldSingleton(world)` accessor; activeZone, npc, vitals, stress, and relations hoist their per-entity Maps onto a per-world resource trait so cross-scene koota id collisions can no longer corrupt them. Combat / spaceSim / supplyDrain / promotion / population stay at module scope with one-line invariant comments naming why (per-active-scene-only or player-global). `src/save/traitRegistry.ts` plus 8 cluster files under `src/boot/traitSerializers/` invert per-trait reach in `save/index.ts`: snapshotEntity is now a generic loop over registered (read, write, reset) triples. Adding a new persisted trait is one file in `src/boot/traitSerializers/`, no edit to `save/index.ts`. On-disk EntitySnap shape is unchanged; SAVE_VERSION stays at 7.
- **Wave 7 — render snapshot type pinning.** `src/render/groundSnapshot.ts` and `src/render/spaceSnapshot.ts` hold the `GroundSnapshot`/`SpaceSnapshot` (and component `*Snap`) types as the public ECS -> render contract. `PixiGroundRenderer.ts` and `PixiSpaceRenderer.ts` `import type` from those contract files; `Game.tsx` and `SpaceView.tsx` import the types directly from the contract files (not from the renderer module). The renderer impl is now swappable (Pixi -> WebGPU / canvas / debug overlay) without touching `Game.tsx` or ECS.

Post-Wave-3 layer arrows:

```
config -> data -> procgen -> ecs -> ai/sim -> systems -> save/render -> ui
boot -> render, boot -> ui, boot -> save, boot -> sim
boot -> systems  (DEV-only, gated, dropped from prod bundle)
```

## Engine vs. game-asset seam

The seam is binary, by user directive:

- **`src/data/` and `src/config/`** are game assets — UC-Life-specific content.
- **Everything else** (`src/ai`, `src/boot`, `src/debug`, `src/ecs`, `src/engine`, `src/procgen`, `src/render`, `src/save`, `src/sim`, `src/systems`, `src/ui`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`) is engine — reusable across other games.

PR review question: **does this change add a string literal in engine/ that only makes sense for UC Life?** If yes, push it down to `data/`.

Known gap: `src/ui/` today contains hardcoded zh-CN player-facing strings. The seam shown in 001 describes the target split, not 100% of HEAD's content placement. Future content-extraction work will move player-facing copy into `data/` behind a string-id indirection; `ui/` stays engine.

## Future waves

The desired diagrams pin the *current* shape after Waves 1-3 + 5 + 7. The following items are real but not yet pinned; any diagram drawn for them must re-open the design conversation first.

1. **Multi-world Proxy explicit-`World` argument contract.** The `world` Proxy in `src/ecs/world.ts` is convenience for active-scene callers. Save / migrate / cross-scene tick code should take an explicit `World` argument and never read the Proxy. Wave 5 made this informally true for activeZone / npc / vitals / stress / relations resets; the desired diagram for `003` should make it a rule across all save / migrate paths.

## Suggested diagram set (when each item is settled)

A 1:1 mirror of `arch/current/` is a good target so diff-reading the two folders shows the refactor delta:

| File | Will define | Status |
| --- | --- | --- |
| `001_component_layers.puml` | Engine vs. game-asset split; layer dependency rule. | **Authored (Wave 4).** |
| `002_tick_pipeline.puml` | Event-driven autosave hooks (Wave 1 already shipped); per-tick chain unchanged. | Not yet authored. |
| `003_multi_world_scene_swap.puml` | `world` Proxy for active-scene callers only; explicit-`World` API for save / migrate / cross-scene tick. | Not yet authored. |
| `004_save_load_roundtrip.puml` | Per-trait registration replacing the centralised loop in save/index.ts. | Not yet authored. |
| `005_render_flow.puml` | Pinned `GroundSnapshot` (and `SpaceSnapshot`) as the public ECS -> render contract. | Not yet authored. |
| `006_portrait_pipeline.puml` | Same seam as today (bridge / cacheLoader / adapter); core stays opaque and GPL-clean. | Not yet authored. |

## Enforcement

None. These diagrams are agent-steering docs, not CI gates. There is no `eslint-plugin-boundaries` setup, no GitHub Actions check, no merge gate. The seams hold because reviewers (human and agent) read the diagrams, not because tooling rejects PRs that violate them.

## Rendering

PlantUML sources are the source of truth (`.puml`). Render with the VS Code PlantUML extension, the official online server, or the local `plantuml` skill.

## Rule

Diagrams here describe the seam being maintained today; further diagrams require the same design conversation 001 had. Don't author a diagram in `desired/` without first agreeing on the shape with the user — aspirational diagrams written without that anchor become fiction nobody trusts.
