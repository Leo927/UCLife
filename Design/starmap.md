# Macro-geography & campaign map

*The set of locations the player can travel to in Phase 6+ deployments.
Two regions: Earth Sphere (primary wartime theater) and Jupiter
expedition (optional/late, frontier-flavored). Lifts canonical UC
astrography; structured as a Starsector-shape continuous-space campaign
map.*

## Why this file exists

Phase 6 introduces ship deployments. A deployment is movement of the
player's fleet across a 2D continuous campaign map, with combat / event
encounters triggered at points of interest (POIs) and during transit.
This file specifies the geography that map is drawn against.

UC Life Sim **does not** simulate orbital mechanics. The campaign map
is a **2D top-down continuous space** of named POIs at fixed positions
— the resolution Gundam novels and shows actually use, and the
resolution Starsector itself uses. "Side 5 is at L1" gives the named
POI its position; reaching it is a burn through 2D space at fleet speed,
not a Hohmann transfer.

This is a deliberate departure from a beacon / node graph: UC has **no
FTL within Earth Sphere**, so travel is continuous. The Starsector
shape — fleet token burns through space, encounters trigger by spatial
proximity to other fleets / POIs / events — matches the canon.

## Two regions

The spatial extent reachable in combat-mode play:

1. **Earth Sphere** — Earth, Sides 1–7, Luna (Von Braun is here),
   Luna II, Earth orbit, asteroid clusters. Densely populated,
   politically charged, the primary wartime theater. Almost all
   canonical UC events happen here. **One continuous 2D campaign map.**
2. **Jupiter expedition** — long-arc deployment to escort or join the
   helium-3 convoys. Frontier-flavor: isolation, anomalies, sparse
   encounters, no strategic-war pressure. Always available but high
   real-time cost. A different texture, not parallel content.
   **Reached by long-burn transit; rendered as a separate, smaller 2D
   map at the destination end.**

Phase 6 pre-war activity is mostly Earth Sphere. Phase 7 wartime activity
is Earth Sphere (the canonical battles). Jupiter is the **"go somewhere
quiet"** option — players who join a Jupiter run during war duck out of
strategic-war content and return weeks later to a changed world. That
asymmetry is intentional.

## Earth Sphere: continuous 2D map

The map is rendered top-down at a scale where Earth, Luna, Luna II, the
seven Sides, and the major asteroid clusters all fit on screen at the
default zoom level. The player zooms in to see fleet detail and zooms
out for navigation overview (Starsector pattern).

Major POIs are **fixed and named** — the iconic places. UC fans expect
to see Side 3, Loum, Luna II, Solomon. These are hand-authored at
canonical positions.

| POI | Faction (pre-war / post-war) | Phase 6 role | Phase 7 role |
|---|---|---|---|
| Luna · Von Braun | Civilian / Civilian | Player home port; ships dock here | Same; war pressure on dome |
| Luna · Granada | AE-aligned / AE-aligned | AE shipyards: refit, refuel, hire | AE military supplier; restricted access |
| Luna II | EFSF / EFSF | Federation supply hub | Major Federation forward base |
| Earth · low orbit | EFSF / EFSF | Federation control space | Contested battlespace |
| Earth · surface (Lisbon, Jaburo, Sydney) | EFSF / EFSF | Civilian commerce; immigration POIs | Sydney is colony-drop site (0079.01.04); Jaburo is Federation HQ |
| Side 1 (Zahn) | EFSF / EFSF | Civilian colony cluster | Frontline cluster |
| Side 2 (Hatte) | EFSF / EFSF | Civilian colony cluster | Mid-war contested |
| Side 3 (Munzo / Republic of Zeon) | Zeon / Zeon | Diplomatic post; smuggling | Capital of Zeon war effort |
| Side 4 (Moore) | EFSF / Zeon-overrun | Civilian colony cluster | **Destroyed** in Operation British |
| Side 5 (Loum) | EFSF / Contested | Civilian colony cluster | **Battle of Loum** site (0079.01.15) |
| Side 6 (Riah) | Neutral / Neutral | Trade hub; negotiable to either side | Switches; key strategic node |
| Side 7 (Noa) | EFSF (under construction) / EFSF | Half-built colony | Pegasus-class launch site (post-Phase 7+) |
| Asteroid · Axis | Zeon (under construction) / Zeon | Distant frontier | Zeon strategic depot |
| Asteroid · Pezun | EFSF / EFSF | Mining outpost | Federation forward base |
| Shoal Zone (around Sides 5/6) | Contested / Contested | Pirate territory | Major battle theater |

**Procedural minor POIs** scatter the map between major POIs — mining
outposts, derelict ships, distress signals, salvage fields, asteroid
fields, hidden caches. These are Starsector's "things you find while
burning between places." Drawn from a POI-type table per region, not
hand-authored. Placement is seeded against the existing `WORLD_SEED` so
the same run yields the same map.

Player-built / player-claimed colonies (Phase 6.3+) become persistent
POIs on the map at the position the player established them. See
[social/faction-management.md](social/faction-management.md).

## Region structure (encounter-pool zones)

A "region" is an area of the campaign map with a thematic encounter
pool and a difficulty band. Regions overlap softly — the map is
continuous, not partitioned. The player's current encounter pool is
determined by which region's territory their fleet is currently in,
and which faction controls it.

Earth Sphere regions:

- **Lunar Sphere** — Luna + nearby asteroid clusters. Tutorial-tier difficulty.
- **Side 3 approach** — Zeon-aligned space. Smugglers and Zeon patrols (pre-war: usually neutral; post-war: hostile). Politically charged at every phase.
- **Side 1/2 cluster** — Federation civilian space; calm pre-war, active wartime.
- **Side 4/5 cluster** — Federation civilian space pre-war; **graveyard** post-war (Operation British, Loum). Lore-thick once Phase 7 fires.
- **Earth orbit** — heavy Federation military presence, civilian transit. Wartime: contested.
- **Earth surface (Atmosphere drop)** — special: requires re-entry-capable ship (rare, story-gated). Mostly Phase 7+ content.
- **Shoal Zone** — perpetually contested, pirate-heavy, debris hazards.
- **Outer asteroid belt** — Axis approach; rare encounters.

Region progression isn't always forward. Wartime deployments can order
the player to redeploy across the theater. Pre-war merc work is
free-form — the player picks contracts and decides where to burn.

## Jupiter expedition

A linear long-burn between Earth Sphere and Jupiter, then a small
continuous map at the destination end:

- **Outer System Transit** — sparse traversal: asteroid hazards,
  isolation, occasional Jupiter Energy Fleet convoys, pirate raids,
  rare anomalies. Days to weeks of in-game travel time.
- **Jupiter local space** — small 2D map: helium-3 mining flotillas,
  deep-space politics, lore-thick events, radiation hazards near the
  gas giant.

A Jupiter expedition is a **long real-time commitment** (weeks of
deployment). It is **not** part of the Phase 7 war theater — players who
join the Jupiter run during war disappear from strategic-war content for
the duration. When they return, the world has shifted: people they knew
may be dead; fronts have moved; news they never saw is in their journal
backlog.

Implementation: same campaign-map / encounter system, different POI
tables and encounter pools.

## How POIs feed encounters

Each POI carries:

- **Type** — civilian colony, military base, mining outpost, distress signal, derelict, asteroid field, hostile patrol, anomaly, etc.
- **Encounter pool** — which combat / event templates can spawn when the fleet enters proximity
- **Faction control** — which sides the player is welcome / hostile / neutral toward (drives combat triggering and store access)
- **Services** when not in combat — refuel, repair, hire crew, store, news refresh
- **Visibility** — sensor range; some POIs (cloaked stations, hidden caches) require active scanning to detect

This gives the encounter generator the data it needs without
specifying individual encounters here. Encounter **form** is specified
in [encounters.md](encounters.md): text-event-first, blue options keyed
to skills / crew / systems / faction rep, combat as one possible
outcome among several. Content (the templates themselves) is
implementation-time work in `data/encounters.json5` (Phase 6).

## Travel and transit

Reuses the existing transit / flight system in `data/flights.json5`,
extended for 2D continuous-space movement. A burn:

- Costs **fuel** (a new ship resource — fleet-wide, scales with fleet size)
- Costs **supplies** (a Starsector-style logistics resource — crew rations + maintenance)
- Costs in-game **time** (proportional to distance and burn-rate; in-deployment time advances during travel)
- Has **encounter risk** dependent on regional faction control and
  fleet visibility

Fleet visibility scales with fleet size: a single ship is harder to
detect than a five-ship squadron. Higher Computers / sensor-officer
skill increases your sensor range; specific ship modifications can
reduce your own visibility (Minovsky particle saturation in late game).

Fleets that run out of fuel mid-burn drift to the nearest gravity
well — usually a hostile or hazardous POI. Running out of supplies
triggers crew morale collapse (escalating mutiny risk).

### Passenger flights vs captain burns: same data, different UI

Civilian players in Phases 0–5 (and combat-mode players who don't
currently have their fleet at the departure port) book passenger flights
between dockable cities. These traversals consume **the same campaign
map** as captain burns — the route is one or more legs across the map
— but the **UI shell is different**:

| Role | UI | Player agency during travel |
|---|---|---|
| **Passenger** | Existing thin booking modal: pick destination, hyperspeed through duration, arrive | None — the player chose to travel and trusts the route |
| **Captain** | Full campaign-map interface: pick destination, plot burn, allocate fuel/supplies, respond to encounters in real-time-with-pause | Continuous decisions over routing, fuel, supplies, encounters |

The default civilian playthrough must **never** be forced through the
campaign-map UI for routine commuting. That layer's interest comes from
the decisions a captain makes inside it; a passenger has no decisions,
so the campaign map collapses to ceremony. Forcing it on Witness-mode
players would mis-signal that combat-mode is the "real" game.

**Where the two views can converge:** a hostile-intercept event during
a passenger flight is the one legitimate moment to drop the passenger
into a tactical-encounter view (their commercial vessel boarded /
attacked). At that point the player's relationship to the journey has
changed from "routine commute" to "event," and the UI shift carries
that shift in narrative weight. This is a story-rare trigger, not a
per-flight roll.

**Engineering benefit:** one campaign map + one travel cost model
serves both layers. Phase 6 doesn't need to invent a parallel travel
system; it inherits the data layer the passenger flights already
populate.

## What this is NOT

- **Not a 3D space simulation.** The campaign map is a 2D continuous space at Starsector fidelity.
- **Not orbital mechanics.** Burns are straight-line at variable speed; gravity wells exist as drift attractors when out of fuel, not as simulated forces.
- **Not procedurally infinite.** Major POIs are fixed and named — that's how UC astrography earns its weight. Procedural variation lives in *minor* POIs and in encounter generation, not in major-POI geography.
- **Not a node graph.** The earlier FTL-style beacon-graph design is dropped. UC has no FTL inside Earth Sphere; continuous space is the canon-correct fit.
- **Not visited as a scene by default.** Most POIs are abstract (you see the encounter, not the place). Some major POIs (Von Braun, Side 3 Zum City, player-built colonies) ARE walkable scenes the player can dock at and disembark into. The dockable POIs are the ones already specced in `scenes.json5` plus any colonies the player establishes.

## Phasing

| Phase | Scope |
|---|---|
| **6.0** | Earth Sphere continuous-space map ships with major POIs + procedural minor POIs. Fleet token traversal in 2D. Fuel + supplies + encounter-risk costs. Single-ship campaign movement. Flight system extended from "two-scene flight pair" to "campaign-map plotting." |
| **6.1** | Encounter generator wires POI types and regions to encounter pools. Sensor / visibility play. |
| **6.2** | Multi-ship fleet movement on the campaign map. Fleet visibility scales with size. Hostile fleet tokens visible on the map; player can engage / evade. |
| **6.3** | Player-claimed and player-built colony POIs persist on the map. See [social/faction-management.md](social/faction-management.md). |
| **6.4** | Jupiter expedition ships with its long-burn transit + Jupiter local map + POI table. |
| **7.0** | Phase 7 trigger flips faction control on contested / wartime POIs. Side 4 destroyed (POI removed / replaced with debris field). Loum becomes a battlespace. New encounter pools activate per region. Hostile factions stage expeditions against player-faction colonies. |
| **7.1** | Wartime deployment structure (faction orders) for assigned-to-ship players. |
| **7.2** | Atmosphere-drop region enabled if a story-gated re-entry ship is acquired. |

## Related

- [combat.md](combat.md) — consumes this map for Starsector-shape encounter flow
- [encounters.md](encounters.md) — form of POI events (text-event-first, blue options, combat as one outcome)
- [setting.md](setting.md) — UC astrography reference
- [worldgen.md](worldgen.md) — dockable-POI interiors reuse city procgen; player colonies reuse industrial-pool procgen
- [social/faction-management.md](social/faction-management.md) — player-faction colonies become persistent POIs on this map
- [phasing.md](phasing.md) — Phase 6 consumes this; Phase 7 changes faction control of POIs
