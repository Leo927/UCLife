# Combat

*How war and violence enter the player's life. Cuts across MW sim,
faction management, ambitions, newsfeed, NPC AI, and the Phase 7 war
event. Upstream of all of those — write before implementing any of
them.*

## Why this file exists ahead of implementation

Every combat-touching system already designed (MW cockpit minigame,
ambitions' `warPayoff`, faction management Phase 6, the UC 0079.01.03
trigger) makes implicit promises about how combat resolves. This file
fixes the structural shape of combat so the downstream files don't drift.

It is **not** a final spec — detailed mechanics (damage formulas, exact
system tuning, weapon catalogs, ship class lists) live in
implementation-phase files. What's locked here: shape of combat, player
perspective, what's reused vs. new, what defers to which phase.

## The core call: war is mostly a backdrop, sometimes a fight

UC Life Sim is a life sim. The default expected experience is that **most
playthroughs see zero direct combat**. Players who pursued `mw_pilot` or
`zeon_volunteer` cross into combat as a payoff for that ambition's
investment; players who ran the bar, migrated to Earth, or dropped out
experience war as **disruption to daily life**. Civilian-war content is
the primary delivery vehicle, not the exception.

Combat has to be **good enough** for the players who pursued it, and
**invisible enough** for the players who didn't.

## Structural shape: Starsector with MS-as-fighter

Combat reuses the Starsector shape — top-down 2D real-time-with-pause
tactical engagements where the player flies their flagship and commands
escort ships in their fleet — with one critical difference: **the player
can leave the tactical view at any moment by walking from the bridge to
the hangar and climbing into a mobile suit.** The MS launches as one of
the fleet's fighter wings, but with the player personally in the cockpit
running the MS minigame.

```
        Campaign layer (Starsector-shape)
        ┌──────────────────────────────────────┐
        │  Earth Sphere continuous 2D map      │
        │  Fleet token burns between POIs      │
        │  (Sides, Luna, Earth orbit, asteroids)│
        │       ↓ encounter triggers           │
        ├──────────────────────────────────────┤
        │  Tactical layer (Starsector-shape)   │
        │  2D top-down, real-time + pause      │
        │  Player flies flagship; AI-or-orders │
        │  fleetmates; MS launch as fighters   │
        │       ↕ walk to hangar / bridge      │
        ├──────────────────────────────────────┤
        │  Embodied layer (walkable ship scene)│
        │  Bridge ← player walks → Hangar      │
        │  Quarters, mess, medbay, engineering │
        │  Used for: mode switch, downtime,    │
        │  social, repair, story beats         │
        ├──────────────────────────────────────┤
        │  Cockpit layer (MS minigame)         │
        │  Engage / Evade / Suppress / Breach  │
        │  primitives, hostile-pilot reskins   │
        └──────────────────────────────────────┘
```

The flagship is **a koota scene like Von Braun**. The player walks its
rooms in real-time when not in tactical or cockpit view. **The walkable
scene is not the combat UI.** During combat, the player is in tactical
view (Starsector top-down) OR in the cockpit (MS minigame). The walking
view exists for:

- Pre/post-deployment downtime — sleep, eat, train crew, talk to NPCs aboard
- The **mode-switch transition** — to climb into an MS the player physically walks bridge → hangar; to return to fleet command they walk hangar → bridge
- Story beats and social interactions with named crew

The mode-switch walk has a real cost: leaving the bridge mid-combat
puts the flagship on AI for the duration of the walk. Walking back
means the same. **This is the design's central tension** — direct MS
impact vs. fleet command, mediated by the cost of physically transiting
the ship. Higher Ship Command + Tactics skills make the AI flagship
behave more competently while you're away, partly mitigating the cost.

### Starsector → UC system mapping

Ship subsystems are abstracted, not room-walked-in-realtime. Starsector's
hull / armor / flux / shields / weapon mounts / fighter bays model maps
directly. UC flavor names where canon supplies them:

| Starsector | UC analog | Notes |
|---|---|---|
| Hull | Hull integrity | |
| Armor | Composite armor | |
| Shields | Energy shield (Minovsky-saturation barrier in late game) | |
| Flux (vent / hard) | Reactor heat / capacitor | |
| Engines | Thruster + main drive | Burn rate, evasion |
| Weapon mounts (small/medium/large) | Beam / missile / mega-particle mounts | Same hardpoint logic |
| Fighter bays | **Hangar** | Each bay holds an MS wing; player can take direct control of one MS |
| Officer slots | Bridge officers | Crew with Ship Command / Tactics / Leadership skills |
| Cargo / fuel / supplies | Same | Drives campaign-layer logistics |

Crew specialization reuses the existing skill set:

| Skill | Combat effect |
|---|---|
| Piloting | MS combat performance (when piloting one); flagship maneuvering when no MS pilot is engaged |
| Marksmanship | Weapon system charge speed and accuracy |
| Mechanics | Damage-control speed; in-combat repair |
| Engineering | Reactor / flux capacity efficiency |
| Tactics | Fleet-wide passive bonus to fleetmate AI; better escort orders |
| Ship Command | Gates fleet size; flagship maneuvering effectiveness |
| Leadership | Crew morale; reduces panic; gates colony management |
| Medicine | Post-combat injury recovery |
| Computers | Sensors, electronic warfare effectiveness |

This means the same character work the player did over years of life sim
in Von Braun — befriending Lazlo's regulars, hiring co-workers, training
their bartender into a pilot — pays out as their crew on a wartime ship.
That's the unification.

## Player perspective taxonomy

Four relationships to combat. The *spatial* relationship between the
player and combat determines mode.

| Mode | Spatial location | What they see | What they do |
|---|---|---|---|
| **Witness** | In Von Braun, never on a combat ship | Newsfeed, dome events, neighbors disappearing, prices shifting | Live their life under wartime pressure |
| **Embodied** | Walking their ship (or a city) | Walkable koota scene; named crew at stations | Sleep, eat, train, talk, transition between Tactical and Cockpit |
| **Tactical** | At the bridge during combat | Starsector-shape top-down 2D: flagship + escorts + enemy ships, hardpoints, flux, shields, fighter wings | Fly the flagship; issue orders to escorts; launch MS wings; active-pause to plan |
| **Cockpit** | Inside an MS launched from the hangar | MS minigame view | Run Engage/Evade/Suppress/Breach primitives against hostile pilots/drones/ships |

A single character moves between Tactical and Cockpit **by walking** to
the bridge or the hangar. That walk is where Embodied lives during
combat. Witness players never reach a ship at all.

## Acquiring access to a ship

The player does not start with a ship. Three paths into one:

1. **Phase 6 merc cell** — pre-war. The player accumulates capital,
   buys a small ship, hires a small crew (recruited from city
   relationships). Pre-war engagements are corporate-security
   skirmishes, salvage operations, pirate hunts. Low stakes, optional.
   This is the on-ramp for the Starsector-shape system.
2. **Phase 7 wartime assignment** — `mw_pilot` and `zeon_volunteer`
   ambitions resolve into being **assigned to someone else's ship as
   crew**. The player is an MS pilot and bridge-officer apprentice on
   an NPC-captained ship. They can rise to command across the wartime
   campaign.
3. **Phase 7 wartime — civilian transport** — for `earth_migration`
   players who clear immigration before war fully closes the lanes.
   Their ship is non-combat; tactical encounters are evade-based
   (escape pirates, navigate hazards), no weapons. Same engine,
   different fit-out.

`lazlos_owner`, `dropout`, `ae_chief_engineer` (unless they accept war
contracts that put them on a corporate ship): never get a ship, stay in
Witness mode. That is **a complete playthrough** and the design must
support it as such — see [social/ambitions.md](social/ambitions.md) for
how the unified perk-point system keeps small-scale ambitions rewarding.

## Fleet scale: skill-gated, not hard-capped

There is **no hard fleet cap**. Fleet capacity is gated by player and
officer skills — primarily **Ship Command**, secondarily **Tactics** and
**Leadership**. A player who never trains command tops out at flagship
+ 1–2 escorts; a player who trains hard fields a real squadron.

This is where late-game skill development gets concrete payoff. Ship
Command and Tactics had no clear endgame target before; now they
literally determine how many ships you can field. Leadership gates how
many colonies you can govern.

Specific capacity formula is a Phase 6.2 implementation concern.
Structurally: capacity grows roughly linearly with skill level, with
modest bonuses from officer skills. There is no soft cap that the
player can't push past with investment.

## Ship-as-scene (the flagship is your home)

The player flagship reuses the koota scene infrastructure already
powering Von Braun and Zum City. Specifically:

- **One koota world per ship.** Existing per-scene world architecture.
- **Rooms are ECS entities.** Same Building / Cell components used in city procgen.
- **Crew = NPCs.** Same trait set, same BT framework, same drives. They eat in the mess, sleep in quarters, drink in the (smaller) ship bar, and have on-duty schedules that put them at their stations during combat.
- **The player walks the ship the same way they walk Von Braun.** Same input, same pathfinding (HPA*).
- **Travel between mother-ship and dockable cities** uses the existing flight system. The ship docks at a city port; player walks aboard.

Escort ships in the fleet are **not** walkable scenes — they're tactical
assets with their own NPC crew rosters. The flagship is the only
walkable ship at any given time. If the player promotes another ship to
flagship (story-rare), that ship becomes the new walkable scene and the
old flagship demotes to tactical asset.

The flagship is **persistent** — it doesn't reset between encounters.
Damage, crew injuries, supplies, ambient state all carry. Repairs
happen at safe POIs (dockable colonies, friendly stations, your own
colony if you have one).

## Tactical mode (Starsector-shape combat UI)

The player is on the bridge — but the bridge view *is* the tactical
top-down Starsector-style view. They see:

- **Their flagship** at the center, hardpoints firing, shields up, flux building
- **Escorts** as fleetmate ships, AI-controlled, accepting orders (engage X, screen, retreat, regroup)
- **Enemy ships** with their own hardpoints, shields, flux
- **MS wings** as small fighter sprites launched from hangars (yours and theirs)
- **Active-pause overlay** for issuing orders without time pressure

Active pause is bound to space (consistent with Starsector). In pause:

- Order escort movements and engagement targets
- Queue weapon-group fires
- Order MS wing launch / recall (assigns a crew pilot or the player themselves)
- Order MS targeting priority
- Order fleet-wide retreat

When the player un-pauses, sim time continues. Game-clock during
tactical combat runs at a slowed ratio (1 real-second ≈ 1 game-second;
not the standard city-mode 25:24) so events are readable.

**Skill effect on tactical:** higher Ship Command makes the flagship's
on-rails behavior smoother (better evasion, faster target switch).
Higher Tactics gives a fleet-wide AI quality bonus (escorts make better
positioning decisions). Higher Leadership reduces morale-driven crew
panic when the flagship takes hull damage.

## Cockpit mode (MS as fighter wing the player can pilot)

The player walks (Embodied) to the hangar, climbs into an MS. The
cockpit minigame takes over. Same input model as the MW sim:

| Hostile primitive | Built from MW primitive |
|---|---|
| **Engage** | Weld — track an evading target |
| **Evade** | Stack — keep yourself outside an enemy's lock cone |
| **Suppress** | Salvage — rapid target acquisition under decoy density |
| **Breach** | Lift — waypoint navigation under suppression |

A skirmish is a sequence of these primitives. The MS has integrity
(HP-like, 0 = ejection, returns the player to a launch bay or to space
in an escape pod). MS damage persists between sorties until repaired by
the hangar crew.

The tactical battle continues while the player is in cockpit. The
player hears bridge chatter (zh-CN voice / log lines). The flagship is
on AI while the player is away from the bridge — Ship Command + Tactics
make this AI better. The player can return any time by ejecting or
docking back into the hangar, then walking to the bridge.

**Switching is the design's central tension.** The player constantly
chooses between piloting (high direct impact, no command) and bridge
(coordinating, but no MS in the field). The walking-transit cost makes
this a real decision, not a free toggle.

## Crew death and Starsector texture

Starsector lets named officers die when their ship is destroyed. UC
inherits this and goes further: named crew on the flagship can die not
just when the ship is destroyed but when their **role** takes a hit
(MS pilot ejected and not recovered, gunner killed by hardpoint
breach, MS pilot incinerated in their cockpit). Their relationship
state dies with them; the player feels it.

There's no in-fiction respawn. The retreat options:

- **Medbay** treats injuries up to a threshold; beyond it, the crew
  member dies
- **Escape pods** for non-MS crew during a hull-loss event. Some make
  it back, some don't (rolled)
- **MS ejection** for MS pilots at integrity 0; survival depends on
  whether the fleet can recover the pod before a hostile does

This is the Phase 4 physiology system shipping in earnest.

## Strategic war (always-on once Phase 7 fires)

Faction strength is a small numeric model — Federation, Zeon, AE,
theater fronts. Date-keyed events resolve against those numbers; outcomes
propagate to:

- **Newsfeed** entries
- **Economy** shocks (rationing, employment surges/dries)
- **NPC drives** (fear, patriotism, despair)
- **Conscription pressure** on player and NPCs
- **Population churn** (named NPCs drafted/killed/missing; refugees arrive)
- **Building access** (consulates close, military zones lock)
- **Encounter generation** for combat-mode players (which regions
  see action; which fronts you're pressured into)
- **Player-faction pressure** — if the player owns colonies, hostile
  factions stage expeditions against them (the Starsector pattern)

Strategic war runs whether or not the player owns a ship. It's the
universal layer.

## Civilian war (most-played version)

For the player who never trained piloting and never bought a ship, war
is delivered through:

- **Lazlo's TV** — newsfeed wartime mode; headlines change tone
- **Job market shifts** — AE pivots to military contracts; civilian-track positions thin; military-track positions surge
- **Friends disappear** — named NPCs drafted, fled, or killed (offscreen, surfaced via newsfeed / log)
- **Refugees arrive** — new procedural NPCs in flop-tier housing
- **Building access changes** — consulates restricted, zones locked
- **Conscription** — draft notice with stat-checked refusal roll
- **Ambitions adapt** — `earth_migration` harder, `lazlos_owner`
  becomes about staying open under rationing, etc.

This is where the writing budget for war content lives. Hair complexity:
flavor without systemic entanglement.

## The Phase 7 transition (UC 0079.01.03)

Single hard global flag flip. On transition:

1. Newsfeed enters wartime mode
2. Strategic war model starts churning
3. Conscription rolls activate
4. Active ambitions resolve `warPayoff`
5. Wartime ambitions unlock (deferred — Phase 7+ design)
6. Economy parameters shift
7. NPCs with combatant backstories leave; refugees spawn
8. Some buildings transition state
9. Player-faction colonies become target-eligible for hostile
   expeditions

There is no rolling back. Saves before are pre-war runs; saves after are
wartime runs.

## Permadeath and combat

Combat must work under both settings:

**Permadeath off (default):**
- Player MS at integrity 0 → ejection + rescue (most of the time); injury arc; faction-rep penalty
- Player flagship at hull 0 → captured / escape pod survives → POW arc or rescue
- Crew can still die — permadeath toggle is for the *player character*, not crew. Crew loss is the texture.
- Player-fleet escort losses are permanent (ships and crew); replacement requires recruitment + procurement

**Permadeath on:**
- Player MS at integrity 0 → ejection roll. Failure = run end.
- Player flagship at hull 0 → escape-pod roll. Failure = run end.
- Crew loss is the same (already permanent without the toggle).

Withdraw is always available pre-commit (matching the MW sim's design).

## Settled commitments

The Starsector-shape calls are now locked. Specifically:

1. **Macro-geography: continuous 2D campaign.** Earth Sphere is one
   continuous 2D map with named POIs (Sides 1–7, Luna, Luna II, Earth
   orbit, asteroid clusters); Jupiter expedition is a separate map
   reached by long burn. Full geography in [starmap.md](starmap.md).
2. **Multi-ship fleet, skill-gated.** No hard cap. Ship Command +
   Tactics + Leadership scale fleet capacity. Lost ships are permanent
   losses, replaced by recruitment / procurement, not story event.
3. **Deployment cadence.** A deployment is a Starsector-shape run of
   ~1–3 in-game weeks of campaign-map travel + tactical encounters;
   between deployments, the flagship docks (Von Braun, Granada, Side 3
   etc.) and the player resumes city life. Multiple deployments per
   career.
4. **Damage persistence.** Within a deployment, damage and crew
   injuries persist between encounters and are repaired at safe POIs
   (Starsector pattern). Between deployments, the ship docks and is
   fully serviced.
5. **Conscription refusal.** Stat-checked roll, with `mw_pilot` active
   biasing the roll heavily toward acceptance. Federation rep, money
   for bribes, Charisma, and a clinic medical letter all modify the
   roll. Failure forces the perspective shift into Tactical/Cockpit
   mode regardless of the player's wishes.
6. **Walkable flagship.** The player's flagship is a koota scene the
   player walks. Escort ships in the fleet are tactical assets only.
   Promoting an escort to flagship swaps which ship is walkable.

## Open questions remaining

1. **Pre-war merc content density.** Phase 6 needs enough encounter
   variety that a player who buys a small ship has meaningful pre-war
   play before 0079.01.03. How many encounter types? How long can a
   Phase 6 merc career last in real-time before exhausting authored
   content? **Defer to Phase 6 design pass.**

2. **Newtype as combat system.** Mind-control system reserved for
   Phase 7+. Newtype-flagged characters likely get cockpit jitter
   reduction and brief-window precognition (preview of upcoming
   primitive parameters). **Defer; flagged here so it doesn't
   surprise the character system later.**

3. **Fleet capacity formula.** Specific numbers for Ship Command /
   Tactics / Leadership → fleet size are Phase 6.2 implementation.
   Structural commitment: linear-with-skill, no soft cap, no hard cap.

## Phasing

| Phase | Combat scope |
|---|---|
| **5.4c** | Cockpit minigame primitives ship in **simulator-only** form. AE MS-handling sim, Federation reservist drills. No real combat, no hostile NPCs, no ship. The player is still in Von Braun. |
| **6.0** | Starsector-shape tactical foundation. Single-ship pre-war merc work. Walkable flagship as scene. Tactical view (top-down 2D, real-time + pause). Hardpoint weapons, flux, shields, hull. Encounter generator. Player buys their first ship as a Phase 6.0 capstone. |
| **6.1** | Bridge ↔ hangar walkable transit. Player pilots an MS personally; cockpit primitives now have hostile counterparts (Engage/Evade/Suppress/Breach against NPC pilots with their own piloting/reflex stats). MS wings AI-piloted while player is at bridge. Walking-transit cost on flagship AI. |
| **6.1.5** | Singleton-to-plural ship structural prep (no player-visible content). See [fleet.md](fleet.md). |
| **6.2** | Multi-ship fleet. Ship Command / Tactics / Leadership gate capacity (linear formula in [fleet.md](fleet.md)). Escort ships as tactical assets with their own NPC crew (full Character entities). Fleet roster screen, hire-officer dialogue branch, doctrine slider, mothballing. Persistent fleet damage between encounters. Promote-to-flagship deferred to 6.2.5. |
| **6.3** | Colony establishment. Player can claim an asteroid POI or build a new colony from scratch. Walkable colony scenes (smaller than cities, reusing scene/building/cell procgen with industrial pool). See [social/faction-management.md](social/faction-management.md). |
| **6.4** | Faction-tier features: large-scale recruitment, governance choices, faction reputation as actor (player-faction has its own faction rep with NPC factions). Phase 7 hostile-expedition mechanic foundations. |
| **7.0** | Phase 7 trigger fires. Strategic war model goes live. Newsfeed wartime mode. Conscription. Wartime ambitions. Civilian-war content (TV, prices, refugees, departing friends). |
| **7.1** | Wartime deployment: `mw_pilot` / `zeon_volunteer` players assigned to NPC-captained ships. Sector-based campaign structure. Real MS combat under real stakes. Player-faction colonies become target-eligible for hostile expeditions. |
| **7.2** | Mind-control / Newtype systems. Late-war fronts. Player can rise to command of their assigned ship. |
| **8+** | LLM-driven battle chatter, surrender attempts, post-engagement debrief. |

## What combat is NOT

- **Not the heart of the game.** The heart is daily life under sim.
  Combat is one of several payoffs that life can lead toward.
- **Not Gundam Battle Operation.** No twin-stick MS action. The cockpit
  minigame primitive model is the ceiling. Tactical scale is fleet, not
  individual MS dogfight.
- **Not skippable for combatants.** A `mw_pilot` who reaches Phase 7
  expects to fight. Auto-resolve from the simulator does **not** apply
  to real combat.
- **Not punishing for non-combatants.** A `lazlos_owner` who never
  trained piloting must be able to play through Phase 7 without combat
  ever forcing itself on them, except through conscription — and
  conscription must be refusable on stat checks.
- **Not a clone of any single game.** The shape is Starsector — fleet,
  campaign map, top-down tactical, flagship-piloted. The deviation is
  MS-as-fighter-the-player-can-be: you can leave the bridge and climb
  into a fighter wing yourself, mediated by the walk through the
  walkable flagship. The texture is UC: named crew, no FTL, no clones,
  Minovsky physics governing what the systems can be.

## Related

- [starmap.md](starmap.md) — Earth Sphere continuous campaign map + Jupiter expedition; the geography this Starsector-shape combat is drawn against
- [fleet.md](fleet.md) — multi-ship fleet roster, captains, capacity formula, doctrine — the layer this combat doc's "no hard cap" commitment resolves into
- [encounters.md](encounters.md) — form of node events; combat is reached through them, not directly
- [mobile-worker.md](mobile-worker.md) — cockpit minigame engine, primitive set, hostile reskins
- [social/ambitions.md](social/ambitions.md) — `warPayoff` routes pilot ambitions onto ships; non-pilot ambitions stay in Von Braun
- [social/faction-management.md](social/faction-management.md) — Phase 6 fleet + colony layer; this is where the Starsector shape ships
- [social/newsfeed.md](social/newsfeed.md) — strategic war's primary delivery channel; civilian-war texture
- [characters/index.md](characters/index.md) — permadeath toggle interaction; crew death is independent of toggle
- [characters/skills.md](characters/skills.md) — Ship Command / Tactics / Leadership gate fleet and colony capacity
- [npc-ai.md](npc-ai.md) — crew BT extends with combat-station drives
- [worldgen.md](worldgen.md) — flagship interior + colony interior reuse scene-procgen building / cell pipelines
- [phasing.md](phasing.md) — combat phasing relative to overall plan
