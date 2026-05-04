# Current architecture (de facto)

Diagrams here describe what the code **actually does today** at HEAD. They are intentionally not idealized — known violations, leaks, and drift are annotated `(VIOLATION)` so they're greppable.

## Index

| File | Diagram | What it shows |
| --- | --- | --- |
| `001_component_layers.puml` | Component | Top-level module layering across `config / data / procgen / ecs / sim / ai / systems / save / render / ui` and the dependencies that cross layers. |
| `002_tick_pipeline.puml` | Sequence | Per-frame execution from RAF → combat tick → space tick → city sim (movement / npc / interaction) → per-tick chain (clock → … → activeZone) → autosave throttle. |
| `003_multi_world_scene_swap.puml` | Component | Multi-world ECS: per-scene `koota.World` map, the `world` Proxy, `useScene` zustand store, `migratePlayerToScene` destroy/respawn flow, and the `WorldProvider` remount. |
| `004_save_load_roundtrip.puml` | Sequence | `saveGame` snapshot path and `loadGame` `stopLoop → resetWorld → setActive → overlay → startLoop` round-trip, including the cross-scene `ship` and `space` blocks. |
| `005_render_flow.puml` | Component | `render/Game.tsx` per-frame snapshot loop into `PixiGroundRenderer` vs. the koota `useQuery`/`useTrait` HUD path. |
| `006_portrait_pipeline.puml` | Component | FC pregmod port: `bridge.ts` shim, `infrastructure/cacheLoader.ts`, `adapter/`, `react/Portrait.tsx`, with the GPL byte-identical core kept opaque. |

## Drift status

`Design/architecture.md` was refreshed to match HEAD: pixi.js + hand-rolled A\*/HPA\*, no i18n framework, full per-frame + per-tick chain order, render snapshot path, save handler registry, and the `sim/events.ts` pub/sub seam between sim/loop and save. Diagrams here remain canonical for the wire-level detail; the doc is the prose summary.
