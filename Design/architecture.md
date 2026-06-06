# Architecture

This is what's actually shipped at HEAD. Match against `package.json`,
`src/sim/loop.ts`, `src/render/Game.tsx`, `src/save/index.ts`, and the
`.puml` files under `arch/current/` if anything here looks suspect — code
is canon.

## Tech stack

```
Vite + React 18 + TypeScript
├─ koota ^0.4.2 ............ ECS (one World per scene; see ecs/world.ts)
├─ pixi.js ^8 + pixi-filters  worldspace renderer (render/Game.tsx mounts a
│                             PixiCanvas; per-frame snapshot from world.query()
│                             into PixiGroundRenderer)
├─ react-dom .............. DOM HUD only — koota/react useQuery/useTrait is
│                             reserved for HUD; visual marks bypass it
├─ zustand ^5 ............. UI / clock / scene / engagement stores (no immer)
├─ rot-js ................. seeded RNG utilities (procgen)
├─ mistreevous ^4 ......... NPC behavior trees (ai/trees.ts + ai/agent.ts)
├─ idb-keyval + superjson . save slots (4: 'auto' + 1..3)
├─ json5 .................. config + scenes/jobs/flights/etc. parsed once at
│                             import via ?raw + JSON5.parse
├─ Vitest ................. unit tests (npm run test:unit)
└─ Playwright ............. smoke tests via __uclife__ debug handle
                             (npm run ci:local; spawns its own dev server)
```

No i18n framework. Player-facing strings are zh-CN inline; everything else
(this file, code, comments, debug labels) is English.

PC-only target: keyboard + mouse, no touch / controller path. WASD walking
lives in `src/render/Game.tsx`; the M hotkey is rebroadcast via `Hud.tsx`
on the ground and `SpaceView.tsx` in the space scene.

LPC sprites are served at `/lpc/` in dev via a Vite middleware that mounts
the sibling `Universal-LPC-Spritesheet-Character-Generator` checkout. In
prod, `VITE_LPC_BASE_URL` points elsewhere.

## Layered structure

Strict downward dependency, enforced by `arch/current/001_component_layers.puml`:

```
config        .json5 → loaders, read once at boot
data          static content (scenes, jobs, ships, special-npcs, …)
procgen       pure, seeded — roads → blocks → cells
ecs           koota traits + Map<SceneId, World>
sim, ai       clock / scene / loop / ship / transition; mistreevous trees + agent
systems       70 files (vitals, work, npc, combat, colony*, governance,
              diplomacy, recruitment, fleet*, …)
save, render  idb-keyval + superjson; pixi + sprite + portrait
ui            React DOM + zustand stores
boot          main.tsx :: ScopedRoot — composition root only
```

Module-level singletons live in several systems (combat, population, npc
buckets, activeZone, spaceSim, supplyDrain, …). Not per-world; works only
because the world count is small and fixed.

## Multi-world ECS, one koota World per scene

`src/ecs/world.ts` builds **one koota `World` per scene id** declared in
`src/data/scenes.json5` (default `vonBraun`, plus `playerShipInterior` and
`spaceCampaign`). It exposes a `Proxy` named `world` that forwards every
call to whichever world is currently active. Each scene is its own
coordinate space; there's no shared geometry.

The Proxy binds methods to the real World before returning them — koota's
private class fields (`#id`, `#isInitialized`) don't resolve through a
naked Proxy.

Cross-scene player movement is **destroy-and-respawn**, not entity-transfer
(entity ids are world-stamped). `src/sim/scene.ts :: migratePlayerToScene`
snapshots portable traits, frees back-references in the source scene
(`Bed.occupant`, `Workstation.occupant`), destroys the player, and
respawns in the destination. Job / Home / PendingEviction are intentionally
dropped — they reference origin-scene entities.

React-side trap: koota's `useQuery` seeds entity arrays via `useState`
*once*, so swapping `WorldProvider`'s `world` prop alone leaves stale
arrays and `world.reset()` clears koota's `queriesHashMap`. `src/main.tsx
:: ScopedRoot` keys `<App key={`${activeId}-${swapNonce}`}/>` to force a
full unmount on every `setActive` (including same-scene swaps from
load-game).

See `arch/current/003_multi_world_scene_swap.puml` for the wiring.

## Tick pipeline

`src/sim/loop.ts` runs a single `requestAnimationFrame` loop. Per-frame
minutes = `dt * effectiveSpeed`. Order matters and is enforced inline in
`frame()`:

```
every frame, regardless of speed
  1. combatSystem (only when clock.mode === 'combat')
  2. spaceSimSystem (always — spaceCampaign world keeps integrating
                     even while the player walks ship interiors)

every frame, when effectiveSpeed > 0
  3. movementSystem
  4. npcSystem
  5. interactionSystem
  6. talkSystem

per-tick chain (while tickAccum >= 1, capped at MAX_TICKS_PER_FRAME = 200)
  1.  clock.advance
  2.  (day-rollover chain — see below, only when the day number changes)
  3.  supplyDrain
  4.  vitals
  5.  action
  6.  rent
  7.  work
  8.  stress              (after vitals — saturation reads fresh values)
  9.  releaseStaleBarSeats
  10. releaseStaleRoughSpots
  11. attributes
  12. population          (per replenishment region, active micro-scene only)
  13. syncShipMarkers     (mirror docked ships as hangar interactables)
  14. relations
  15. ambitions
  16. activeZone
  17. newsfeed             (bar-TV co-location consume; sim/newsfeed.ts)
```

Day-rollover (`gameDayNumber` change after `clock.advance`) runs an inline
settlement chain — `dailyEconomicsSystem` (every scene world) →
`housingPressureSystem` → `recruitmentSystem` (active scene) — then emits
`'day:rollover'` and, once the chain settles, `'day:rollover:settled'` to
`sim/events.ts`. The faction-management layer (colony, governance,
diplomacy, fleet, research, …) hangs entirely off these two events via
the `src/boot/*Tick.ts` subscribers — see *Faction management* below.

**Hyperspeed ("committed" mode)** auto-engages during a long player
action when no vital is in danger; the leading edge emits
`'hyperspeed:start'`. The player can force hyperspeed through danger via
a toast button.

Do **not** throttle `tree.step()` in `npcSystem` — skipping BT frames
breaks drive-interrupt reactivity. The system already throttles via 60
buckets with a dynamic per-game-speed cycle and an immediate wake when
an NPC's action transitions to `idle`.

See `arch/current/002_tick_pipeline.puml` for the sequence.

## Pathfinding

Hand-rolled, no external pathfinder.

- `src/systems/pathfinding.ts` — grid A\* on a half-tile (16px) sub-grid
  sized to the **max** scene envelope across every scene. Buffer is
  allocated once and indexed by `y*COLS+x`; cells past a smaller scene's
  envelope are simply never touched. Static wall grid is cached per scene;
  per-call obstacle overlays apply door locks (cell-keyed via
  `Door.bedEntity`, faction-keyed via `Door.factionGate`).
- `src/systems/hpa.ts` — single-level HPA\* on top of the same grid. Set
  `HPA_PROF=1` to emit profile output. Call `markPathfindingDirty()` when
  walls change; call `markHpaDirty()` if connectivity changes without
  walls changing.

## Render

Two paths into ECS state, by design:

1. **Worldspace (Pixi).** `src/render/Game.tsx` is a thin React shell.
   It mounts a `PixiCanvas`, runs a per-frame `useEffect` that builds a
   `GroundSnapshot` from `world.query()` calls, and hands it to
   `PixiGroundRenderer` which diffs against the previous frame. **No
   `useQuery`/`useTrait` for visual marks** — the snapshot path was
   chosen during the Konva→Pixi migration for perf. NPC and interactable
   Pixi nodes carry their own `pointerdown` handlers
   (`eventMode='static'`); background clicks bubble up to a host
   `pointerdown` that walks the player to the world-space click position.
   This kills the legacy O(N) NPC scan on click.

2. **DOM HUD (React).** Hud, modals, status panel, etc. read via
   koota/react `useQuery` / `useTrait`. This is the legitimate
   reactive bridge — keeps React rendering pure-read of ECS.

See `arch/current/005_render_flow.puml`.

### Sprite + portrait sub-modules

- `src/render/sprite/` — LPC composer. `appearanceToLpc.ts` adapts UC's
  `Appearance` trait to LPC layer keys; `compose.ts` resolves them under
  `/lpc/` (or `VITE_LPC_BASE_URL`). The animation ticker (`animTick.ts`)
  runs separately from the sim clock at 12Hz.
- `src/render/portrait/` — FC pregmod port. The `infrastructure/`,
  `dispatcher/`, `vector/`, and `revamp/` `.js` files are
  **byte-identical** verbatim copies (GPL-3.0). Anything new lives in
  `bridge.ts` (Twine→ESM shim setting up `globalThis.App` / `V` / `_`),
  `infrastructure/cacheLoader.ts` (replaces FC's Twine-passage cache
  with the JSON map produced by `scripts/buildPortraitCache.ts`),
  `adapter/` (UC traits → FC `SlaveLike`), and `react/Portrait.tsx`.
  See `src/render/portrait/README.md` for the upstream sync workflow
  and `arch/current/006_portrait_pipeline.puml` for the seam diagram.

## Save / load

`src/save/index.ts` exploits the seeded determinism. Saves capture only
**dynamic** state: per-entity trait snapshots (vitals, money, action,
inventory, relations refs, …) plus a handler-keyed `subsystems` blob
(clock, population, ship, space, scene, …). Reload =
`emitSim('load:start')` → `resetWorld()` (rebuilds the map + spec NPCs
from `WORLD_SEED`) → `restoreAll('pre')` → patch dynamic traits onto
entities matched by stable `EntityKey` → spawn missing immigrants →
destroy entities the save no longer expects → `restoreAll('post')` →
`emitSim('load:end')`.

Entity references survive the round-trip via key indirection: every
saved entity carries an `EntityKey`, and refs serialize as keys not raw
ids.

### Pub/sub seam between sim/loop and save

The historical `save ↔ sim/loop` import cycle (loop autosaved + load
called `stopLoop`/`startLoop`) was severed via `src/sim/events.ts`:

- `sim/loop.ts` emits `'day:rollover'` and `'hyperspeed:start'`.
- `save/index.ts :: loadGame` emits `'load:start'` and `'load:end'`.
- `src/boot/autosaveBinding.ts` subscribes to the loop events and
  calls `saveGame('auto')` with throttle + in-flight guard.
- `sim/loop.ts` subscribes to the load events to call `stopLoop` /
  `startLoop`.

`save/` no longer imports from `sim/loop`; `sim/loop` no longer imports
from `save/`. Adding a new sim signal == one new event name in
`sim/events.ts`.

### Per-subsystem reach inverted via handler registry

`src/save/registry.ts` defines `SaveHandler<T>` with `snapshot()` /
`restore(blob)` / `reset()` and a two-phase load order (`'pre'` for
state the entity overlay depends on — currently just active scene id;
`'post'` for everything else). Each persisted subsystem owns a file
under `src/boot/saveHandlers/` (clock, population, ship, space, scene,
combat, engagement, npc, relations, vitals, stress, supplyDrain,
spaceSim, promotion, activeZone, plus the faction-management subsystems
— colony, governance, diplomacy, recruitment, brig, dailyEconomics,
hangars, ms, fleetPool, fleetCrewCounter — plus `newsfeed` (consumed-
headline journal + war-day-toast flag) and `warState` (the Phase 7.0.B
IsWartime gate + strategic-war faction-strength model) — 27 handlers at
HEAD), side-
effect-imported from `main.tsx`. Adding a new persisted subsystem is one
new file in `src/boot/saveHandlers/`, with **no edit** to
`src/save/index.ts`.

See `arch/current/004_save_load_roundtrip.puml`.

## Procgen

`src/procgen/index.ts` exports `WORLD_SEED`, `SeededRng`, and the pure
city-generation pipeline. **Same seed → same world**, which is what
makes the save format viable.

The city generator runs in three stages, once per zone listed under `scene.procgenZones`, each gated on its own `enabled` flag:

1. `generateRoadGrid` (`procgen/roads.ts`) — vertical avenues + horizontal
   streets at randomized gaps, recursive split of qualifying super-blocks
   with one alley each. Returns `{ segments, subBlocks }`.
2. `assignBuildings` (`procgen/blocks.ts`) — buckets sub-blocks per
   district by center-containment, sorts each largest-first, picks fitting
   building types from the per-district pool. Types with unmet `min`
   place first; `min: 1, max: 1` types (e.g. airports) reliably claim a
   big enough block before shop/bar/etc. consume them.
3. `generateCells` (`procgen/cells.ts`) — orientation-aware cell layout;
   corridor side decided per-slot by the road-facing wall.

Roads are drawn as `Road({ x, y, w, h, kind })` entities under buildings.
The pathfinder treats them as plain non-wall walkable space.

`src/save/index.ts` reloads via `resetWorld()` → patch — saves carry
**only** dynamic state, never procgen output.

## Faction management (Phases 6.3–6.4)

Once the player founds a faction, a colony/governance/diplomacy/fleet
layer comes online. It is deliberately **decoupled from the frame loop**:
every system in it is a daily reckoning, so it subscribes to the
`'day:rollover'` / `'day:rollover:settled'` events rather than being
called inline from `sim/loop.ts`. Each subscriber is one file under
`src/boot/*Tick.ts` (colonyConstructionTick, colonyEconomicsTick,
colonyThreatsTick, diplomacyTick, commandPointsTick, factionSalaryTick,
factionTierTick, fleetSupplyTick, fleetTransitTick, researchTick,
ms/shipDeliveryTick, hangarRepairTick, brigConditionTick,
warTransitionTick, …) wrapping a pure system in `src/systems/`. Adding a
daily faction mechanic == one new `*Tick.ts` subscriber + its system; the
loop is never touched.

The Phase 7.0.B **war transition** rides the same rail: `warTransitionTick`
subscribes to `'day:rollover:settled'` and runs `warTransitionSystem`
(flip the one-way `IsWartime` gate on UC 0079.01.03 — seed the
strategic-war model from `config/warTransition.json5`, fire the 7.0.A
war-day force-toast, emit `'war:transition'` for the downstream slices)
followed by `strategicWarSystem` (resolve that day's `data/war-events.json5`
entries against the faction-strength model, idempotently, emitting
`'war:event-resolved'`). The war state is a sim-layer module store
(`sim/warState.ts`, mirroring `sim/newsfeed.ts`) — global, not a per-scene
ECS trait — persisted via the `warState` save handler. The newsfeed reads
it for its wartime tone-shift (war-tagged headlines dominate the feed).

- **Colony** — `colonyConstruction` (build queue), `colonyEconomics`
  (revenue/upkeep/resupply from hangar stock), `colonyThreats` (garrison
  strength vs. raids), `colonyAdmin` (admin-capacity load), and
  `colonyDetention` (brig-overflow routing). State persists via the
  `colony` save handler.
- **Governance** — `governance.ts :: callCouncil` opens a policy session
  at a council POI; policies are diegetic council scenes, not menu
  toggles. Faction-leader perks unlock from an AP pool and apply
  faction-wide stat modifiers through the standard `StatSheet` channel.
- **Diplomacy** — formal relations with canon UC factions, brokered
  through council scenes; persisted via the `diplomacy` handler.
- **Fleet** — `fleetPool` (shared fuel/supply pool), `fleetSupplyDrain`
  / `fleetSupplyDelivery`, `fleetTransit`, `fleetCrew`. Mobile suits are
  the customization/retrofit focus (`ms*` systems + `hangars`); ships are
  sideline content with no retrofit/loadout system.

The whole layer reads and writes character/faction stats through
`src/stats/sheet.ts` — there is no second modifier engine — and saves
through per-subsystem handlers (see above). See
`Design/social/faction-management.md` for the design model.

## Config

`src/config/*.json5` are parsed once at module import via `?raw` +
`JSON5.parse()`. **No hot reload** — refresh after editing. To add a
tunable: add the value with a comment to the relevant `.json5`, add the
field to the loader's interface, then import from `../config`.

## Smoke-test debug surface

In dev (`import.meta.env.DEV`), `globalThis.__uclife__` exposes a
deterministic handle for Playwright fixtures: `world`, `useClock`,
`useScene`, `movePlayerTo`, `countByKind`, `listAirports`,
`listTransitTerminals`, `findLockedCellPath`, ambition/event-log/flag
probes, ship/space cheats (`boardShip`, `enterSpace`, `setCourse`,
`fastWinCombat`, `useCombatStore`, `useEngagement`, …), and `saveGame`
/ `loadGame`. See `src/main.tsx`.

CLAUDE.md "Smoke-test reliability" applies: drive through `__uclife__`,
not the DOM; wait on conditions, not wall-clock ms; drive sim time, not
real time; seeded determinism only.

## Related

- [time.md](time.md) — tick loop and speeds
- [npc-ai.md](npc-ai.md) — utility AI + BT
- [combat.md](combat.md) — combat / space bridge
- [social/faction-management.md](social/faction-management.md) — colony / governance / diplomacy / fleet
- [social/research.md](social/research.md) — research progression
- `arch/current/*.puml` — current de-facto component / sequence diagrams
