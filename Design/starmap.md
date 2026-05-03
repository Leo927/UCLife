# Macro-geography & starmap

*The set of locations the player can travel to in Phase 6+ deployments.
Two systems: Earth Sphere (primary wartime theater) and Jupiter
expedition (optional/late, frontier-flavored). Lifts canonical UC
astrography; structured for FTL-shape encounter flow.*

## Why this file exists

Phase 6 introduces ship deployments. A deployment is a sequence of
starmap nodes the player navigates between, with combat / event
encounters at each node. This file specifies the geography that starmap
is drawn against.

UC Life Sim **does not** simulate orbital mechanics. The starmap is a
**graph** of named locations with abstract travel costs (fuel, time)
between them — the resolution Gundam novels and shows actually use, and
the resolution FTL itself uses. "Side 5 is at L1" is flavor; jumping
there is a graph edge, not a Hohmann transfer.

## Two systems

The spatial extent reachable in combat-mode play:

1. **Earth Sphere** — Earth, Sides 1–7, Luna (Von Braun is here),
   Luna II, Earth orbit, asteroid clusters. Densely populated,
   politically charged, the primary wartime theater. Almost all
   canonical UC events happen here.
2. **Jupiter expedition** — long-arc deployment to escort or join the
   helium-3 convoys. Frontier-flavor: isolation, anomalies, sparse
   encounters, no strategic-war pressure. Always available but high
   real-time cost. A different texture, not parallel content.

Phase 6 pre-war activity is mostly Earth Sphere. Phase 7 wartime activity
is Earth Sphere (the canonical battles). Jupiter is the **"go somewhere
quiet"** option — players who join a Jupiter run during war duck out of
strategic-war content and return weeks later to a changed world. That
asymmetry is intentional.

## Earth Sphere node graph

Major nodes are **fixed and named** — the iconic places. UC fans expect
to see Side 3, Loum, Luna II, Solomon. These are hand-authored.

| Node | Faction (pre-war / post-war) | Phase 6 role | Phase 7 role |
|---|---|---|---|
| Luna · Von Braun | Civilian / Civilian | Player home port; ship docks here | Same; war pressure on dome |
| Luna · Granada | AE-aligned / AE-aligned | AE shipyards: refit, refuel, hire | AE military supplier; restricted access |
| Luna II | EFSF / EFSF | Federation supply hub | Major Federation forward base |
| Earth · low orbit | EFSF / EFSF | Federation control space | Contested battlespace |
| Earth · surface (Lisbon, Jaburo, Sydney) | EFSF / EFSF | Civilian commerce; immigration nodes | Sydney is colony-drop site (0079.01.04); Jaburo is Federation HQ |
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

**Procedural nodes** between major nodes — mining outposts, derelict
ships, distress signals, salvage fields, asteroid fields. These are
FTL's "encounter beacons." Drawn from a node-type table per sector,
not hand-authored. Placement and distribution is seeded against the
existing `WORLD_SEED` so the same run yields the same starmap.

## Sector structure

A "sector" is a region of the starmap with a thematic encounter pool
and a difficulty band. Sectors are connected by jump points to one or
more neighbors. A deployment moves the player through 3–6 sectors over
~1–3 in-game weeks.

Earth Sphere sectors:

- **Lunar Sphere** — Luna + nearby asteroid clusters. Tutorial-tier difficulty.
- **Side 3 approach** — Zeon-aligned space. Smugglers and Zeon patrols (pre-war: usually neutral; post-war: hostile). Politically charged at every phase.
- **Side 1/2 cluster** — Federation civilian space; calm pre-war, active wartime.
- **Side 4/5 cluster** — Federation civilian space pre-war; **graveyard** post-war (Operation British, Loum). Lore-thick once Phase 7 fires.
- **Earth orbit** — heavy Federation military presence, civilian transit. Wartime: contested.
- **Earth surface (Atmosphere drop)** — special: requires re-entry-capable ship (rare, story-gated). Mostly Phase 7+ content.
- **Shoal Zone** — perpetually contested, pirate-heavy, debris hazards.
- **Outer asteroid belt** — Axis approach; rare encounters.

Sector progression isn't always forward. Wartime deployments can order
the player to redeploy across the theater. Pre-war merc work is more
free-form — the player picks contracts and decides where to jump.

## Jupiter expedition

A linear chain of sectors between Earth Sphere and Jupiter:

- **Outer System Transit (1)** — sparse, asteroid hazards, isolation begins
- **Outer System Transit (2)** — Jupiter Energy Fleet convoys; pirate raids; rare encounters
- **Jupiter approach** — radiation hazards, anomalies, lore-thick events
- **Jupiter** — terminus; helium-3 mining flotillas, deep-space politics

A Jupiter expedition is a **long real-time commitment** (weeks of
deployment). It is **not** part of the Phase 7 war theater — players who
join the Jupiter run during war disappear from strategic-war content for
the duration. When they return, the world has shifted: people they knew
may be dead; fronts have moved; news they never saw is in their journal
backlog.

Implementation: same node-encounter system, different node-type table.
Authoring cost is one new sector pool plus a small set of Jupiter-specific
event templates.

## How nodes feed combat

Each node carries:

- **Type** — civilian colony, military base, mining outpost, distress signal, derelict, asteroid field, hostile patrol, anomaly, etc.
- **Encounter pool** — which combat / event templates can spawn
- **Faction control** — which sides the player is welcome / hostile / neutral toward (drives combat triggering and store access)
- **Services** when not in combat — refuel, repair, hire crew, store, news refresh

This gives the FTL-shape encounter generator the data it needs without
specifying individual encounters here. Encounter **form** is specified
in [encounters.md](encounters.md): text-event-first, blue options keyed
to skills / crew / systems / faction rep, combat as one possible
outcome among several. Content (the templates themselves) is
implementation-time work in `data/encounters.json5` (Phase 6).

## Travel between nodes

Reuses the existing transit / flight system in `data/flights.json5`.
Phase 6 extends it from "two-scene flight pair" to "graph traversal."
Each jump:

- Costs **fuel** (a new ship resource — adds one numeric to ship state)
- Costs in-game **time** (varies by jump distance; in-deployment time advances during travel)
- Has a chance of **intercept** event (especially in contested space)

Within a sector, jumps are short. Between sectors, jumps are long and
require a fully-charged FTL drive. Ships that run out of fuel mid-jump
fall short to a random nearby node — usually a hostile or hazardous one.

### Passenger flights vs captain jumps: same data, different UI

Civilian players in Phases 0–5 (and combat-mode players who don't
currently have their ship at the departure port) book passenger flights
between dockable cities. These traversals walk **the same starmap
graph** as captain jumps — the route is one or more edges in the graph
— but the **UI shell is different**:

| Role | UI | Player agency during travel |
|---|---|---|
| **Passenger** | Existing thin booking modal: pick destination, hyperspeed through duration, arrive | None — the player chose to travel and trusts the route |
| **Captain** | Full starmap interface: pick jump target node-by-node, allocate fuel, respond to intercepts | Per-jump decisions over routing, fuel, encounters |

The default civilian playthrough must **never** be forced through the
starmap UI for routine commuting. That layer's interest comes from the
decisions a captain makes inside it; a passenger has no decisions, so
the starmap collapses to ceremony. Forcing it on Witness-mode players
would mis-signal that combat-mode is the "real" game.

**Where the two views can converge:** a hostile-intercept event during
a passenger flight is the one legitimate moment to drop the passenger
into a starmap-encounter view. At that point the player's relationship
to the journey has changed from "routine commute" to "event," and the
UI shift carries that shift in narrative weight. This is a story-rare
trigger, not a per-flight roll.

**Engineering benefit:** one starmap graph + one travel cost model
serves both layers. Phase 6 doesn't need to invent a parallel travel
system; it inherits the data layer the passenger flights already
populate.

## What this is NOT

- **Not a 3D space simulation.** The starmap is a 2D graph at FTL fidelity.
- **Not orbital mechanics.** Jumps are graph edges.
- **Not procedurally infinite.** Major nodes are fixed and named — that's how UC astrography earns its weight. Procedural variation lives in *minor* nodes and in encounter generation, not in major-node geography.
- **Not visited as a scene by default.** Most nodes are abstract (FTL-style — you see the encounter, not the place). Some major nodes (Von Braun, Side 3 Zum City) ARE walkable scenes the player can dock at and disembark into. The dockable nodes are the ones already specced in `scenes.json5`.

## Phasing

| Phase | Scope |
|---|---|
| **6.0** | Earth Sphere graph (major + procedural nodes) ships with sector pools. Node services + travel cost system. Flight system extended to graph traversal. |
| **6.1** | Encounter generator wires node types to encounter pools. |
| **6.2** | Jupiter expedition ships with its sector chain and node-type table. |
| **7.0** | Phase 7 trigger flips faction control on contested / wartime nodes. Side 4 destroyed. Loum becomes a battlespace. New encounter pools activate per sector. |
| **7.1** | Wartime sector progression structure (deployment orders) for assigned-to-ship players. |
| **7.2** | Atmosphere-drop sector enabled if a story-gated re-entry ship is acquired. |

## Related

- [combat.md](combat.md) — consumes this graph for FTL-shape encounter flow
- [encounters.md](encounters.md) — form of node events (text-event-first, blue options, combat as one outcome)
- [setting.md](setting.md) — UC astrography reference
- [worldgen.md](worldgen.md) — dockable-node interiors reuse city procgen
- [phasing.md](phasing.md) — Phase 6 consumes this; Phase 7 changes faction control of nodes
