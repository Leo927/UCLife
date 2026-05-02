# Architecture

## Tech stack

```
Vite + React + TypeScript
├─ Koota .................. ECS (sim state, traits, relations, queries)
├─ react-konva ............ canvas rendering
├─ zustand + immer ........ UI state (non-sim)
├─ easystarjs ............. async A* pathfinding
├─ rot.js ................. seeded RNG, procgen utilities
├─ mistreevous ............ behavior trees (NPC plan execution)
├─ LinguiJS ............... i18n (zh-CN source)
├─ idb-keyval ............. save slots
├─ superjson .............. save serialization
├─ @anthropic-ai/sdk ...... LLM (Phase 8 only)
└─ (custom) ............... tick loop, utility AI, room generator
```

Combined runtime budget ≈ 80 KB gzipped + brand font.

## System architecture

```
┌── Time/Scheduler ────┐   tick-based, decoupled from frames
│                      │   pause/1×/2×/4×/commitment-skip
│                      │
├── World (Koota) ─────┤   Tiles, Items, Characters as entities
│                      │   Components = Koota traits
│                      │   Relationships = Koota relations
│                      │
├── Simulation systems ┤   Each tick, in order:
│                      │     1. Vitals (drain & recovery)
│                      │     2. Physiology (sickness/injury)
│                      │     3. Skills (XP, decay)
│                      │     4. AI (utility scoring → BT execution)
│                      │     5. Pathfinding (easystar, async)
│                      │     6. Social (memory, relations)
│                      │     7. Events (date-keyed, log emission)
│                      │
├── Render (Konva) ────┤   useQuery to subscribe to renderable entities
│                      │   pure read of sim state + interpolation
│                      │
└── UI (React) ────────┘   Inspector, character card, newsfeed,
                           journal, faction map, dialogue
```

**Critical principle**: rendering is a pure read of the sim. The sim must be runnable headless — this is what unlocks tests, accelerated time, and (later) putting the sim in a Web Worker via Comlink.

## Project structure

```
src/
  sim/          tick loop, speed control, commitment-skip
  ecs/          Koota traits, relations, world setup
  systems/      one file per system (vitals, ai, social, ...)
  ai/           utility AI, drives, behavior tree definitions
  procgen/      room templates, sector generator, NPC generator
  render/       Konva components, sprite atlas, camera
  ui/           React UI panels (zustand-backed)
  data/         landmark templates, item defs, skill defs, news events
  i18n/         Lingui catalogs, message extraction config
  save/         serialization, migrations, idb-keyval wrapper
  llm/          (Phase 8) Claude client, persona/memory packing
```

## Related

- [time.md](time.md) — tick loop and speeds
- [npc-ai.md](npc-ai.md) — utility AI + BT
- [localization.md](localization.md) — LinguiJS in the stack
