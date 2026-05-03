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

## Structural shape: FTL with MS-as-drone

Combat reuses the FTL: Faster Than Light combat shape, with one critical
difference: **the smallest controllable combat unit is a mobile suit, and
the player character is a person on the ship who walks between control
points.**

```
        Mother ship interior (koota scene)
        ┌────────────────────────────┐
        │  Bridge ← player walks → Hangar  →  MS in space
        │     ↓                ↓                 ↓
        │  ship control    climb into MS   cockpit minigame
        │                                       (Engage/Evade/
        │  Other rooms: medbay, engineering,     Suppress/Breach)
        │  weapons, quarters, mess ─────────┘
        └────────────────────────────┘
                  ↕ (FTL-shape encounter)
        ┌──────────────────────┐
        │ Enemy ship           │  ← system bars + room damage view,
        │ (rooms + systems)    │    not walkable
        └──────────────────────┘
```

The mother ship is **a koota scene like Von Braun**. The player walks
its rooms in real-time. Combat is real-time-with-pause: in pause, the
player allocates reactor power across systems, queues weapon shots,
issues movement orders. While unpaused, weapons charge, MS units fly,
crew run, oxygen leaks, fires spread.

### FTL → UC system mapping

| FTL system | UC analog | Notes |
|---|---|---|
| Shields | Energy shield (Minovsky-saturation barrier in late game) | |
| Engines | Thruster + main drive | Evasion bonus + jump readiness |
| Oxygen | Life support | |
| Weapons | Ship-mounted beam / missile mounts | |
| Drones | **Hangar** | MS launch bay; capacity = how many MS can be deployed at once; system level = launch + recovery cycle speed |
| Medbay | Medical bay | |
| Pilot | Bridge / helm | |
| Sensors | Minovsky scope | Counters cloaking |
| Doors | Bulkhead control | Lockdown vs. boarders |
| Teleporter | Boarding pod / shuttle | Zaku-with-rifle is canon |
| Cloaking | Minovsky particle saturation | |
| Artillery | Mega particle cannon | |
| Hacking | Electronic warfare suite | |
| Clonebay | *Cut.* UC doesn't have cloning. | A character lost in combat is lost. |
| Mind control | Newtype interference | Reserved for Phase 7+ |

Crew specialization reuses the existing skill set:

| Skill | Station bonus |
|---|---|
| Piloting | MS combat performance (when piloting one); helm evasion (when on bridge) |
| Marksmanship | Weapon system charge speed and accuracy |
| Mechanics | Any-system manning bonus; engineering repair speed |
| Engineering | Reactor efficiency; large-system repair |
| Tactics | Bridge-wide passive bonus to all stations (officer effect) |
| Medicine | Medbay throughput and crit-injury survival |
| Computers | Hacking and Sensors effectiveness |
| Leadership | Crew morale; reduces panic on hull breach |

This means the same character work the player did over years of life sim
in Von Braun — befriending Lazlo's regulars, hiring co-workers, training
their bartender into a pilot — pays out as their crew on a wartime ship.
That's the unification.

## Player perspective taxonomy

Three relationships to combat. Now framed as roles, not separate game
modes — the *spatial* relationship between the player and combat
determines mode.

| Mode | Spatial location | What they see | What they do |
|---|---|---|---|
| **Witness** | In Von Braun, never on a combat ship | Newsfeed, dome events, neighbors disappearing, prices shifting | Live their life under wartime pressure |
| **Combatant** | In an MS cockpit launched from a ship hangar | Cockpit minigame against hostile pilots / drones / ships | Pilot the MS — same input model as the MW sim |
| **Commander** | On a ship's bridge (theirs or as bridge officer) | FTL-shape ship view: rooms, systems, reactor power, weapons, enemy ship | Active-pause: allocate power, queue shots, order MS launch / recovery, direct boarders |

A single character moves between Combatant and Commander **by walking**
to the bridge or the hangar. Walking from quarters to the bridge during
combat takes real seconds; this matters. Witness players never reach a
ship at all.

## Acquiring access to a ship

The player does not start with a ship. Three paths into one:

1. **Phase 6 merc cell** — pre-war. The player accumulates capital,
   buys a small ship, hires a small crew (recruited from city
   relationships). Pre-war engagements are corporate-security
   skirmishes, salvage operations, pirate hunts. Low stakes, optional.
   This is the on-ramp for the FTL-shape system.
2. **Phase 7 wartime assignment** — `mw_pilot` and `zeon_volunteer`
   ambitions resolve into being **assigned to someone else's ship as
   crew**. The player is an MS pilot and bridge-officer apprentice on
   an NPC-captained ship. They can rise to command across the wartime
   campaign.
3. **Phase 7 wartime — civilian transport** — for `earth_migration`
   players who clear immigration before war fully closes the lanes.
   Their ship is non-combat; FTL-shape encounters are evade-based
   (escape pirates, navigate hazards), no weapons. A different flavor
   of FTL, same engine.

`lazlos_owner`, `dropout`, `ae_chief_engineer` (unless they accept war
contracts that put them on a corporate ship): never get a ship, stay in
Witness mode. That is **a complete playthrough** and the design must
support it as such.

## The mother ship as scene

The mother ship reuses the koota scene infrastructure already powering
Von Braun and Zum City. Specifically:

- **One koota world per ship.** Existing per-scene world architecture.
- **Rooms are ECS entities.** Same Building / Cell components used in city procgen.
- **Crew = NPCs.** Same trait set, same BT framework, same drives. They eat in the mess, sleep in quarters, drink in the (smaller) ship bar, and have on-duty schedules that put them at their stations during combat.
- **The player walks the ship the same way they walk Von Braun.** Same input, same pathfinding (HPA*).
- **Travel between mother-ship and Von Braun** uses the existing flight system. The ship docks at a Von Braun port; player walks aboard.

The ship is **persistent** — it doesn't reset between encounters. Damage,
crew injuries, supplies, ambient state all carry. This is the long-arc
your character lives on once they leave Von Braun.

## Bridge mode (FTL-shape ship control)

The player is on the bridge. They see:

- **Their own ship** (the koota scene) rendered with system-status overlay: each room shows its system's power allocation, charge, integrity, and crew assignment.
- **The enemy ship** rendered to one side (right of screen, FTL-style) as a room-and-system grid only — not a walkable scene. System bars, hull integrity, current crew positions per room.
- **Reactor power bar** at top: total available power, allocated breakdown, free reserve.
- **Weapon queue** with charge timers and target selectors.
- **MS deployment status** if the hangar is staffed — pilots in cockpits, MS in space, MS returning for repair/resupply.

Active pause is bound to space (consistent with FTL). In pause:

- Drag power between systems
- Queue weapon shots at enemy rooms
- Order MS launch (assigns a crew pilot) or recovery
- Order crew repositioning between rooms
- Order boarding via teleporter / shuttle

When the player un-pauses, sim time continues. Game-clock during combat
runs at a slowed ratio (1 real-second ≈ 1 game-second; not the standard
city-mode 25:24) so events are readable.

**The bridge as a station the player mans:** a player character on the
bridge with high Tactics gives a global ship bonus. If the player walks
to engineering to fight a fire personally, the bridge bonus drops until
an NPC takes over. Spatial choice has cost.

## Cockpit mode (MS as drone)

The player walks to the hangar, climbs into an MS, the cockpit minigame
takes over. Same input model as the MW sim:

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

The bridge battle continues while the player is in cockpit. The player
hears bridge chatter (zh-CN voice / log lines). They can return any time
by walking back into the hangar — which costs an MS recovery cycle (the
hangar system level governs how fast).

**Switching is the design's central tension.** The player constantly
chooses between piloting (high direct impact, no command) and bridge
(coordinating, but no MS in the field). This is the interesting decision
the system generates.

## Crew death and FTL texture

FTL combat is shaped by losing crew. UC inherits this. Named NPCs **can
die** in combat — drowned in a vented room, killed by boarders,
incinerated with their MS. Their relationship state dies with them; the
player feels it.

Without a clonebay, there's no FTL-style instant respawn. The retreat
options:

- **Medbay** treats injuries up to a threshold; beyond it, the crew
  member dies.
- **Escape pods** for non-MS crew during a hull-loss event. Some make
  it back, some don't (rolled).
- **MS ejection** for MS pilots at integrity 0; survival depends on
  whether the ship can recover the pod before a hostile does.

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
- **Encounter generation** for combat-mode players (which star systems
  see action; which fronts your ship is deployed to)

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

There is no rolling back. Saves before are pre-war runs; saves after are
wartime runs.

## Permadeath and combat

Combat must work under both settings:

**Permadeath off (default):**
- Player MS at integrity 0 → ejection + rescue (most of the time); injury arc; faction-rep penalty
- Player ship at hull 0 → captured / escape pod survives → POW arc or rescue
- Crew can still die — permadeath toggle is for the *player character*, not crew. Crew loss is the FTL texture.

**Permadeath on:**
- Player MS at integrity 0 → ejection roll. Failure = run end.
- Player ship at hull 0 → escape-pod roll. Failure = run end.
- Crew loss is the same (already permanent without the toggle).

Withdraw is always available pre-commit (matching the MW sim's design).

## Open questions for explicit decision

These are the calls the FTL-shape commitment leaves unsettled. User
should weigh in before Phase 6 implementation begins.

1. **Sectors and starmap structure.** FTL has 8 sectors of ~20 nodes,
   escaping a fleet. UC's wartime equivalent: do we have a similar
   sector progression (theater fronts the player is deployed across),
   or open-deployment within a single front? **My recommendation:
   sectored, but tied to strategic war state. Each sector is a campaign
   chapter with thematic encounters.**

2. **Single ship per run.** I assumed yes — one ship at a time. Lost
   ships replaced via story event. **Confirm.**

3. **Run length / persistence.** FTL is a 4-8 hour single run. UC
   playthroughs span game-years. The FTL-shape layer is recurring, not
   replacing the whole game. **My recommendation: a "deployment" is an
   FTL-shape run of ~1-3 in-game weeks; between deployments, the ship
   docks (Von Braun, Side 3, etc.) and the player resumes city life.
   Multiple deployments per character career.**

4. **Damage persistence.** Within a deployment, damage persists between
   encounters and is repaired at safe nodes / docks (FTL-style stores).
   Between deployments, the ship sits in dock and gets fully serviced.
   **Confirm.**

5. **Conscription refusal.** Stat-checked roll, with `mw_pilot` biasing
   the roll heavily toward acceptance. **Confirm.**

6. **Pre-war piracy / merc work content density.** Phase 6 needs enough
   encounter variety that a pre-war player who buys a small ship has
   meaningful play before 0079.01.03. How many encounter types? How
   long can a Phase 6 merc career last in real-time? **Defer to Phase
   6 design pass.**

7. **Newtype as combat system.** Mind-control system reserved for
   Phase 7+. Newtype-flagged characters get cockpit jitter reduction
   and brief-window precognition (preview of next primitive's
   parameters). **Defer; flagged here so it doesn't surprise the
   character system later.**

## Phasing

| Phase | Combat scope |
|---|---|
| **5.4c** | Cockpit minigame primitives ship in **simulator-only** form. AE MS-handling sim, Federation reservist drills. No real combat, no hostile NPCs, no ship. The player is still in Von Braun. |
| **6.0** | FTL-shape engine: mother ship as scene, bridge mode, reactor power, weapons, hangar with NPC pilots, basic encounter generator. Pre-war merc work — corporate-security skirmishes, salvage, piracy. Player buys a small ship as a Phase 6 capstone. |
| **6.1** | Player walks bridge ↔ hangar; player pilots an MS personally; cockpit primitives now have hostile counterparts (Engage/Evade/Suppress/Breach against NPC pilots with their own piloting/reflex stats). |
| **6.2** | Boarding (teleporter), cloaking, sensors, hacking. Crew injury and death. Persistent damage between encounters within a deployment. |
| **7.0** | Phase 7 trigger fires. Strategic war model goes live. Newsfeed wartime mode. Conscription. Wartime ambitions. Civilian-war content (TV, prices, refugees, departing friends). |
| **7.1** | Wartime deployment: `mw_pilot` / `zeon_volunteer` players assigned to NPC-captained ships. Sector-based campaign structure. Real MS combat under real stakes. |
| **7.2** | Mind-control / Newtype systems. Late-war fronts. Player can rise to command of their assigned ship. |
| **8+** | LLM-driven battle chatter, surrender attempts, post-engagement debrief. |

## What combat is NOT

- **Not the heart of the game.** The heart is daily life under sim.
  Combat is one of several payoffs that life can lead toward.
- **Not Gundam Battle Operation.** No twin-stick MS action. The cockpit
  minigame primitive model is the ceiling. The FTL-shape bridge model
  is the breadth.
- **Not skippable for combatants.** A `mw_pilot` who reaches Phase 7
  expects to fight. Auto-resolve from the simulator does **not** apply
  to real combat.
- **Not punishing for non-combatants.** A `lazlos_owner` who never
  trained piloting must be able to play through Phase 7 without combat
  ever forcing itself on them, except through conscription — and
  conscription must be refusable on stat checks.
- **Not a full FTL clone.** UC drops the clonebay (no in-fiction
  justification), reframes drones as MS (the player can BE the drone),
  treats the player ship as a persistent walkable scene rather than a
  schematic, and threads city life around the deployment cycle. The
  shape is FTL; the texture is UC.

## Related

- [mobile-worker.md](mobile-worker.md) — cockpit minigame engine, primitive set, hostile reskins
- [social/ambitions.md](social/ambitions.md) — `warPayoff` routes pilot ambitions onto ships; non-pilot ambitions stay in Von Braun
- [social/faction-management.md](social/faction-management.md) — Phase 6 merc cell on a ship; this is where the FTL shape ships
- [social/newsfeed.md](social/newsfeed.md) — strategic war's primary delivery channel; civilian-war texture
- [characters/index.md](characters/index.md) — permadeath toggle interaction; crew death is independent of toggle
- [characters/skills.md](characters/skills.md) — crew specialization at ship stations
- [npc-ai.md](npc-ai.md) — crew BT extends with combat-station drives
- [worldgen.md](worldgen.md) — mother ship interior reuses scene-procgen building / cell pipelines
- [phasing.md](phasing.md) — combat phasing relative to overall plan
