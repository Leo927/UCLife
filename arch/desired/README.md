# Desired architecture (target)

This directory will hold the diagrams the codebase is being refactored **toward**. None of the diagrams here are required to match HEAD — they define the seams the refactor is working to establish.

## Status

**Not yet drawn.** This is intentional. The desired-architecture diagrams should not be authored without first agreeing on:

1. **The engine / game split.** Which directories will live in a future engine package (`engine/{ecs,sim,render,procgen,save}`) vs. UC-specific game code (`game/`)? CLAUDE.md states the goal — "we should have a reusable engine that can be used on other projects" — but the actual line has never been drawn.
2. **Resolution of known violations** flagged in `arch/current/`:
   - The `globalThis.__uclife__` debug surface in `main.tsx` (couples boot to ~10 subsystems for Playwright fixtures).
   - `save/index.ts` directly calling `stopLoop` / `startLoop` and reaching into per-system reset hooks (save → loop → all systems coupling). A "world reset lifecycle" event bus is the natural seam.
   - Module-level singletons in systems (combat, population, relations, npcBuckets, vitalsAccum, stressAccum, supplyDrain, spaceSimFlags, engagement). These are not per-world today — works only because the world count is small and fixed.
   - `sim/loop.ts` directly importing `save/index.ts` for autosave (loop knows about persistence).
   - `Design/architecture.md` describing a stack (`react-konva`, `easystarjs`, `LinguiJS`) the codebase no longer ships.
3. **Render seam** — formalise `render/Game.tsx`'s per-frame-snapshot pattern (vs. koota `useQuery` for HUD) as the contract, not as a workaround. Pin the snapshot type as the public ECS→render interface.
4. **Multi-world contract** — make the `world` Proxy purely a convenience for "active scene" callers and require all save/load + cross-scene systems to take an explicit `World` argument. Today this is informally true; the diagrams should make it a rule.

## Suggested diagram set (when the above is settled)

A 1:1 mirror of `arch/current/` is a good starting target so diff-reading the two folders shows the refactor delta:

| File | Will define |
| --- | --- |
| `001_component_layers.puml` | Engine vs. game split; a hard `engine/* MUST NOT depend on game/*` arrow rule. |
| `002_tick_pipeline.puml` | Event-driven autosave hooks (loop emits `day:rollover`, `hyperspeed:start` — save subscribes); per-tick chain unchanged. |
| `003_multi_world_scene_swap.puml` | `world` Proxy for active-scene callers only; explicit-World API for save / migrate / cross-scene tick. |
| `004_save_load_roundtrip.puml` | World-reset lifecycle bus; per-system snapshot/restore registration replacing the centralised case-list. |
| `005_render_flow.puml` | Pinned `GroundSnapshot` (and `SpaceSnapshot`) as the public ECS→render contract. |
| `006_portrait_pipeline.puml` | Same seam as today (bridge / cacheLoader / adapter); core stays opaque and GPL-clean. |

## Rule

Do not author a diagram here until the corresponding `current/` diagram has been read and the user has agreed on the desired delta. Aspirational diagrams written without that anchor become fiction nobody trusts.
