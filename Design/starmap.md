# Macro-geography & campaign map

*The 2D continuous-space sector the player flies their ship through in
Phase 6+. Earth Sphere is a real koota scene (`spaceCampaign`) with
orbital mechanics: bodies and POIs revolve around their parents in real
game-time, and the player's ship is a free-flying entity in the same
coordinate space.*

## Why this file exists

Phase 6 introduces ship deployments. A deployment is **the player flying
their ship across continuous space** (Starsector shape) toward bodies,
stations, and hostile contacts. There is no abstract burn modal, no
random-encounter roll, no graph of beacons. The campaign map IS a scene.

This file specifies the geography that scene is built against, the
orbital model that places content in it, the engine boundary that keeps
the simulation reusable, and the flow between the helm tile (inside the
ship) and the space scene (outside the ship).

## Two regions

1. **Earth Sphere** — Earth, Sides 1–7, Luna (Von Braun), Luna II,
   Earth orbit, asteroid clusters (Axis, Pezun). One continuous 2D
   campaign scene at ~30000×24000 px world envelope.
2. **Jupiter expedition** — long-burn transit + a smaller separate
   scene at the destination. Same engine, different content tables.
   Phase 6.4 work; mentioned here for shape, not specced in detail.

## The campaign IS a scene

`spaceCampaign` is a row in `src/data/scenes.json5` with
`sceneType: 'space'`. Like every scene, it owns a koota world, a
coordinate space, and its own tick. Unlike micro/ship scenes, it has no
walls, no procgen, no fixedBuildings — content comes from celestial
bodies, POIs, and hand-placed entities (enemies, debris, anomalies).

Sector envelope: **30000 × 24000 px** in world units. Tuned so the
Earth↔Moon hop is the *shortest* civilian route and the side colonies
sit *much further out*, giving the player a real reason to ration fuel.
Earth sits roughly mid-sector at (15000, 12000); Sides spread across
the rest at orbital radii of 8000–14000 from Earth. Axis and Pezun sit
at 16000–18000 — the outer belt. The envelope is large enough that 1× zoom
shows only a fraction of the sector and M-fit is the canonical "where
am I" gesture.

## Orbital model

Every celestial body declares `(parentId, orbitRadius, orbitPeriodDays,
orbitPhase)` and a per-frame derivation function returns its current
world position. Earth is the root with explicit `pos` and no parent.
The Moon orbits Earth; sides orbit Earth at varying radii and phases;
Axis and Pezun orbit Earth at outer-belt radii. POIs orbit their host
**body** (not Earth directly) — Von Braun and Granada orbit the Moon at
small radii (180–190 px, lunar surface visualization); Lisbon and
Jaburo orbit Earth at surface radius (650 px); Earth-orbit sits at
800 px low orbit; the Side N POI orbits the Side N body at ~60 px.

Periods are in **game-days**. `orbitTimeScale` (default 1) is a config
multiplier for tuning the visible drift speed — at 1, the Moon
completes one orbit every 27.3 in-game days, which is canon-true and
slow enough that within a single play session the Moon visibly moves
without warping. The phase column lets us start each side at a distinct
canon-flavor angle (Side 4 near L4, Side 5 near L5, Side 3 at L2 far
side, etc.) so the opening map matches UC astrography even though the
positions drift over time.

Because positions are derived per-frame, the engine never stores
"current pos" for orbital content — it's always
`derivePos(body, t)` → `{x, y}`. Save/load only stores the game clock;
positions reconstruct.

## Ship as ECS entity

The player's ship is a koota entity in the `spaceCampaign` world with
`Position`, `Velocity`, `Thrust`, and a back-reference to the
`playerShipInterior` scene. Movement uses semi-implicit Euler:
`v += thrust * dt`, clamped to `baseShipMaxSpeed * shipSpeedScale`,
then `pos += v * dt`. There's no orbital mechanics on the ship itself —
the player flies straight lines through the field of orbiting content.
This is the Starsector simplification.

Enemy ships work the same way. They are persistent hand-placed entities
declared in `src/data/space-entities.json5` with a spawn position, AI
mode (`patrol`/`idle`), and an aggro radius. **There are no RNG
encounters.** Every threat the player meets is a real persistent entity
that lives on the map even when the player is elsewhere; if the player
flees an enemy and comes back, that enemy is still there (with current
hull and current position).

## Helm vs off-helm

The player can **leave the helm** during flight. The bridge tile and
the space scene tick simultaneously:

| Player state | Bridge scene tick | Space scene tick | Ship control |
|---|---|---|---|
| Sitting at the helm | Yes | Yes | Player input → Thrust |
| Walking the ship | Yes | Yes | Autopilot continues last order |
| Docked at a POI | Yes | Frozen | Velocity = 0 |

Autopilot is a per-ship trait. While at the helm, player input
overrides it. While off-helm, autopilot drives Thrust toward whatever
target was last set — usually a POI snap point. If autopilot can't
resolve the target (POI gone, target deselected), the ship coasts.

This is the Starsector "set course and walk away" pattern, but inside
the ship instead of on the campaign map. The simultaneous-tick design
also means the player can take off from a city, walk to the bridge, and
arrive to find the ship already in space and moving — the autopilot
handles the take-off burn.

## Take-off cost

Leaving a POI's surface costs fuel. Cost varies wildly by gravity well:

- Earth surface: 80 fuel (deep well, Lisbon/Jaburo)
- Moon surface: 12 fuel (Von Braun, Granada)
- Lunar high orbit: 8 fuel (Luna II)
- Side colonies: 2 fuel (no real well)
- Asteroid posts (Axis, Pezun): 2 fuel

This is why returning to Earth is a *commitment*, not a routine commute.
Side-to-side hops are cheap; a Lunar-Earth round trip is the major
fuel-sink event of an early-game run. The take-off fuel is consumed at
detach time, not paid back if the player aborts immediately.

## Continuous fuel/supply economy

Fuel and supplies drain in real game-time, not per-burn. Storage and
drain are **per-ship**, not rolled up onto the flagship — see
[fleet.md](fleet.md) for the full template/instance shape and the
Starsector-style cost model.

- **Fuel** is charged on actual delta-v, not commanded thrust —
  `fuelPerThrustSec * |Δv| / thrustAccel` per integration step, where
  `Δv` is the post-clamp velocity change. Cruising at maxSpeed in a
  straight line is free (the integrator clamps the overshoot, so Δv is
  zero); only real velocity changes — spin-up, braking, turning —
  burn fuel. Coasting is also free. Fuel storage is per-ship class
  (`fuelStorage` on the ship template); freighters and tankers carry
  the deep reserves.
- **Supplies** drain continuously even at rest. Aggregate fleet drain:
  - `sum(ship.template.supplyPerDay for each non-mothballed ship)` —
    fixed per-class life support / wear cost (Starsector model)
  - `sum(ms.template.supplyPerDay for each MS in any non-mothballed
    hangar)` — per-MS hangar cost
  - `sum(ms.template.supplyPerRepairDay for each MS currently
    in-repair)` — additional per-MS cost while repairing
  - `crewUpkeepPerDay` — existing crew cost
  - `combatRepairDrainPerSec` — paid per real-second of active combat
    repair (the auto-fix-hull tick on the ship sheet)

Supply storage is per-ship (`supplyStorage` on the ship template);
during a deployment one ship can run dry while another has slack until
the fleet next pools at a friendly station. The campaign HUD shows the
fleet aggregate; per-ship breakdown lives on the fleet roster.

Supplies hitting zero (anywhere in the fleet) triggers crew-morale
collapse on that ship (mutiny risk). Fuel hitting zero on a ship
strands *that ship* — it drifts to the nearest gravity well; the rest
of the fleet doesn't automatically stop for it. These behaviors are
wired in slice 7 (continuous economy).

## Engagement, not RNG

Hand-placed enemies have an aggroContactRadius (default 24 px). The
player can **see** them on the map at all times — they're rendered
icons. When the player enters their aggro radius, the engagement modal
fires: `engage / flee / negotiate`. **The player chooses to fight.**
Sneaking past an enemy by giving them wide berth is a real strategy.
Enemies persist hull state between encounters — flee a bandit at 30%
hull and they're still at 30% hull when you come back.

## M fit-zoom

At 30000×24000 px the player can never see the whole sector at game
zoom. M toggles a fit-zoom that frames the entire sector with
`fitSystemPaddingPx` margin on each edge. POIs, enemies, and the
player's ship are all visible at fit-zoom; M again returns to the
prior camera. This is the canonical "what's around me" gesture and the
only way to plan a long burn. M doubles as the ground-map hotkey
outside the space scene, keeping a single "open the map" muscle memory
across both views.

## Engine / data / config separation

This is the slice that makes the campaign reusable:

- `src/engine/space/` — pure ECS-agnostic functions. Orbit derivation,
  semi-implicit Euler integration, autopilot steering. No koota
  imports, no React imports, no global state. Takes plain data in,
  returns plain data out. Should be testable as a standalone module on
  another project.
- `src/data/celestialBodies.json5` + `.ts` — body table.
- `src/data/pois.json5` + `.ts` — POI table.
- `src/data/space-entities.json5` + `.ts` — hand-placed enemy spawns.
- `src/config/space.json5` + `.ts` — speed, drain rates, aggro radius,
  every tunable.
- `src/sim/space*.ts` — koota glue: spawning, traits, save/load
  mapping.
- `src/systems/space.ts` — per-tick wiring: drives the engine functions
  against the koota world.
- `src/ui/SpaceView.tsx` — render layer.

POI positions and enemy aggro tests **must** flow through the engine,
not through ad-hoc math in the UI or the systems layer. If a calc shows
up in two places, it lives in `src/engine/space/`.

## Region structure (encounter-pool zones)

Regions remain useful as a label for which thematic content cluster a
position belongs to (for music, for hostile-faction patrol density, for
news flavor). The `region` field is preserved on every POI. There is
**no** region centroid Voronoi for runtime use anymore — we no longer
roll random encounters per region. The region tag is metadata for slice
6+ (hostile patrol patterns, music cues), not pathfinding.

Earth Sphere regions (preserved labels):

- **lunarSphere** — Luna + Moon-orbital POIs.
- **side12cluster** — Federation civilian space.
- **side3approach** — Zeon-aligned space; tense at every phase.
- **side45graveyard** — Federation civilian pre-war; Operation British
  + Loum graveyard post-war.
- **earthOrbit** — Earth + Earth-surface POIs.
- **shoalZone** — Side 5/6 area, pirate territory, debris hazards.
- **outerBelt** — Axis + Pezun.

## What this is NOT

- **Not a node graph.** Continuous space, free movement.
- **Not a panel/modal.** SpaceView is a real scene with its own world.
- **Not free of orbital mechanics.** Bodies orbit; POIs orbit bodies.
- **Not RNG-driven.** Every enemy is hand-placed and persistent.
- **Not a Hohmann simulator.** Ships fly straight at variable thrust;
  bodies orbit but the player's ship doesn't follow Kepler.
- **Not visited only abstractly.** Some POIs are dockable into a
  walkable scene (Von Braun → `vonBraunCity`, Side 3 → `zumCity`). Those
  bindings live in `pois.json5` as `sceneId`.

## Phasing

| Phase | Scope |
|---|---|
| **6.0.1** | Design doc + data scaffold (this slice). New `space.json5` config, `celestialBodies.{json5,ts}`, `pois.{json5,ts}`, `space-entities.{json5,ts}`. New `spaceCampaign` row in `scenes.json5`. No engine, UI, or wiring. |
| **6.0.2** | Rip out the legacy modal, BurnPlan, region centroid, and RNG encounters. Delete `starmap.{json5,ts}` and `encounters.{json5,ts}`. |
| **6.0.3** | Engine layer: pure orbit derivation + semi-implicit Euler integration + autopilot steering in `src/engine/space/`. |
| **6.0.4** | SpaceView render + ECS traits (Position, Velocity, Thrust, Orbit, ShipRef, EnemyRef) + camera + click-to-target. |
| **6.0.5** | Helm tile inside the ship interior. Multi-world simultaneous tick (bridge + space). Off-helm autopilot. |
| **6.0.6** | Hand-placed enemy AI; engage/flee/negotiate modal on contact. Persistent hull state across encounters. |
| **6.0.7** | Continuous fuel/supply economy. Take-off cost wired. Mutiny / drift-to-well failure modes. |
| **6.0.8** | Save/load round-trip; smoke-test rewrite. |
| **6.1** | Sensor / visibility play. Cloaked POIs (Pezun salvage, hidden caches) require active scanning. |
| **6.1.5** | Singleton-to-plural ship structural prep — ship-template/instance split, `IsFlagshipMark` marker, save migration. No new content. See [fleet.md](fleet.md). |
| **6.2** | Multi-ship fleet movement. **Orbital drydock POIs land as a POI category** (Granada drydock + one Earth-orbit dock complex at MVP) — walkable POIs with `sceneId` bindings, hosting capital-ship hangar facilities ([fleet.md](fleet.md), [social/facilities-and-ownership.md](social/facilities-and-ownership.md#hangar-facility-phase-62)). Buy-ship at brokers queues delivery to a hangar with capacity (player-owned or state-rental) — **no ship refit at any tier**. Capital ships sit in drydocks; surface hangars hold MS / shuttles. Non-flagship ships do not station-keep in formation while idle — they sit in their hangar slots. (In-flight: while a fleet is sortied, non-flagship ships station-keep at fixed formation offsets behind the flagship.) Per-ship + crew supply economics replace the rolled-up flagship aggregate. See [fleet.md](fleet.md) for roster UI, doctrine slider, debug "grant fleet". |
| **6.2.5** | MS + pilot + retrofit layer in fleet (per-MS supply costs flow through this campaign HUD; MS-broker POIs surface the buy-MS / buy-weapon / buy-mod catalogs). MS retrofit lives at hangar facilities (player-owned or rented), accessed by walking up to the MS in the bay — never from a menu. On-ship hangar decks are sortie loadout surfaces, not storage. |
| **6.2.7** | CP / DP wired into tactical (campaign HUD shows CP regen against the day clock). |
| **6.3** | Player-claimed colony POIs persist on the map. |
| **6.4** | Jupiter expedition: long-burn transit + Jupiter local map. Same engine, different content tables. |
| **7.0** | Phase 7 trigger flips faction control on contested POIs; Side 4 becomes debris (POI replaced with derelict body). Hostile patrols escalate by region. |
| **7.1** | Wartime deployment orders structure for assigned-to-ship players. |
| **7.2** | Atmosphere drop region — story-gated re-entry capability. |

## Related

- [combat.md](combat.md) — consumes this scene for tactical encounters
- [fleet.md](fleet.md) — multi-ship fleet management (Phase 6.1.5+) on top of this campaign map
- [sortie.md](sortie.md) — in-tactical MS sortie loop (lives inside the tactical engagements this map hosts)
- [post-combat.md](post-combat.md) — recovered-hull-in-flight pattern relies on this file's supply-zero behavior; named-hostile authoring sits on `space-entities.json5` rows
- [encounters.md](encounters.md) — text-event form (still relevant for
  POI services and dialogues, just not for transit RNG)
- [setting.md](setting.md) — UC astrography reference
- [worldgen.md](worldgen.md) — dockable-POI interiors reuse city procgen
- [social/faction-management.md](social/faction-management.md) —
  player-faction colonies become persistent POIs
- [phasing.md](phasing.md) — Phase 6 consumes this; Phase 7 changes
  faction control of POIs
- `src/data/celestialBodies.json5` — body orbital table
- `src/data/pois.json5` — POI table (orbits its host body)
- `src/data/space-entities.json5` — hand-placed enemy spawns; carries optional named-hostile captain/pilot ids per [post-combat.md](post-combat.md#notable-hostiles-authoring)
- `src/config/space.json5` — engine tunables
- `src/data/scenes.json5` — `spaceCampaign` scene row
