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
flying it directly.

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
        │  Cockpit layer (direct MS control)    │
        │  WASD flight + shift-aim + vernier    │
        │  boost; per-sortie resources + HUD;   │
        │  hostile MS wings with pilot AI       │
        └──────────────────────────────────────┘
```

The flagship is **a koota scene like Von Braun**. The player walks its
rooms in real-time when not in tactical or cockpit view. **The walkable
scene is not the combat UI.** During combat, the player is in tactical
view (Starsector top-down) OR in the cockpit (direct MS control). The
walking view exists for:

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
| Weapon mounts (small/medium/large) | Beam / missile / mega-particle mounts | **Authored on the ship class, not player-swappable.** UC Life does not ship a ship-tier refit system — see [fleet.md](fleet.md). |
| Fighter bays | **Hangar** | Each bay holds an MS; player can take direct control of one MS. **MS is the customization platform** — this is where loadout, weapon swap, and frame mods live. |
| Officer slots | Bridge officers | Crew with Ship Command / Tactics / Leadership skills |
| Cargo / fuel / supplies | Same | Drives campaign-layer logistics |

**The asymmetry is deliberate.** Starsector treats ship refit as the central depth surface; UC Life pushes that depth one layer down to the MS. Ships are operational platforms (move, hold, survive); MS are the personalization surface (retrofit, frame mods, pilot pairing). A player who tunes their fleet is tuning their *MS roster*, not their hardpoints.

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
| **Cockpit** | Inside an MS launched from the hangar | Direct-control MS view: cockpit HUD over the tactical arena | Fly WASD + shift-aim + KeyF vernier boost; manage per-sortie propellant/ammo/life-support against hostile MS and ships |

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

## Fleet scale: economics-gated, no skill formula on fleet size

There is **no hard fleet-size cap and no skill formula gating ship
count.** Fleet *size* is gated by economics and command bandwidth, per
[fleet.md](fleet.md). Per-engagement *combat scale* (CP and DP) **is**
skill-gated — see below — but that affects how many ships you can
coordinate in a fight, not how many you may own:

- **Per-ship + per-MS supply consumption** (Starsector model). Every
  ship class has a fixed `supplyPerDay`; every MS in a hangar adds its
  own per-MS cost; every MS in repair adds further per-MS-day cost.
  Growing the fleet without growing the income stream bleeds you out.
- **Command points.** Minovsky-particle scatter makes long-range comms
  unreliable, so coordinating fleet-wide actions costs CP. CP cap is
  gated by player Ship Command + Tactics and the flagship's comm
  officer.
- **Deployment points.** Tactical engagements have a per-engagement DP
  budget — fleet size and combat scale decouple. A 20-ship fleet might
  field 8 in any one fight.

Late-game Ship Command / Tactics / Leadership gain concrete payoff
through CP/DP throughput and doctrine effectiveness rather than through
a linear "you may now field N ships" formula. Leadership still gates
colony management.

## Ship-as-scene (whichever ship you're on is walkable)

The walkable ship reuses the koota scene infrastructure already
powering Von Braun and Zum City. Specifically:

- **One walkable scene at a time** — whichever ship the player is
  currently aboard. That ship carries the `IsFlagshipMark` tag.
  Mechanically, the flagship is *just* "the ship the player is on";
  there is no other specialness. See [fleet.md](fleet.md).
- **Rooms are ECS entities.** Same Building / Cell components used in city procgen.
- **Crew = NPCs.** Same trait set, same BT framework, same drives. They eat in the mess, sleep in quarters, drink in the (smaller) ship bar, and have on-duty schedules that put them at their stations during combat.
- **The player walks the ship the same way they walk Von Braun.** Same input, same pathfinding (HPA*).
- **Travel between ship and dockable cities** uses the existing flight system. The ship docks at a city port; player walks aboard.

Other ships in the fleet are not currently being walked, but their
interior is hydratable from the same class template the moment the
player boards them. Per-ship interior content is **authored per class,
not per instance** — five ship classes = five interior templates,
regardless of fleet size. Switching which ship is the flagship is
routine transit (gated to docking-with-fleet moments, not a story
event).

Every ship is **persistent** — damage, crew injuries, supplies, ambient
state all carry between encounters. Repairs happen at safe POIs
(dockable colonies, friendly stations, your own colony if you have one).

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

### Combat event log

Routine status changes do **not** auto-pause tactical. They post to a
**combat event log** in the top-left of the tactical view, Starsector-shape
— a fading scrolling list of recent events with portraits, severity tiers,
and a Tab-toggled full-history scroll. MS launches, dock-backs, resupply
completions, weapon depletions, threshold crossings, kill confirms,
captain order acks, bridge chatter — all here. Full surface design lives
in [post-combat.md](post-combat.md#combat-event-log).

[encounters.md](encounters.md)'s pause-on-event rule still applies at the
campaign layer (entering a POI, hostile fleet enters sensor range, fuel
critical, mutiny risk). Once tactical begins, the auto-pause set
**narrows** to: **first contact**, **flagship hull crosses 25% / 10%**,
**boarders detected on the flagship**, **player-piloted MS at hull 0**.
Everything else routes through the log so extended engagements aren't
modal-spam.

**Skill effect on tactical:** higher Ship Command makes the flagship's
on-rails behavior smoother (better evasion, faster target switch).
Higher Tactics gives a fleet-wide AI quality bonus (escorts make better
positioning decisions). Higher Leadership reduces morale-driven crew
panic when the flagship takes hull damage.

## Cockpit mode (MS as fighter wing the player can pilot)

> **Superseded 2026-07 (W3): direct control is canon.** The cockpit
> minigame primitives below (Engage/Evade/Suppress/Breach) were the
> pre-W3 design and were **never built**. What shipped instead — and
> what this section now specifies — is direct flight control. The
> historical primitive table is kept below for the record; treat it as
> abandoned, not aspirational.
>
> <details><summary>Superseded design: hostile-primitive minigame</summary>
>
> The player walks (Embodied) to the hangar, climbs into an MS. The
> cockpit minigame takes over. Same input model as the MW sim:
>
> | Hostile primitive | Built from MW primitive |
> |---|---|
> | **Engage** | Weld — track an evading target |
> | **Evade** | Stack — keep yourself outside an enemy's lock cone |
> | **Suppress** | Salvage — rapid target acquisition under decoy density |
> | **Breach** | Lift — waypoint navigation under suppression |
>
> A skirmish would have been a sequence of these primitives, reskinned
> from the MW sim's engine ([mobile-worker.md](mobile-worker.md)).
>
> </details>

The player walks (Embodied) to the hangar, climbs into an MS, and flies
it directly — no minigame layer between the player and the stick.

- **Flight model.** WASD moves the MS; holding shift locks aim
  independent of heading (strafe-and-shoot) so the player can face a
  target while thrusting elsewhere. KeyF fires a **vernier boost** — a
  short high-speed dash, per-frame-authored (speed multiplier,
  duration, cooldown), that drinks propellant. MS frames get
  meaningfully higher thrust-to-mass, tighter turning, and a smaller
  hit profile than ships — an MS reads as a fighter, not a slow hull.
- **Hit resolution is per-row, not a single global radius.** Projectiles
  resolve a real geometric hit test against each target's own
  `hitRadiusPx` (MS frames author a smaller radius than the ship
  default), so a small fast MS can out-dodge incoming fire that would
  have hit a ship dead-on. Beams stay hitscan — a locked-on, in-arc beam
  always lands; there's no geometry for a beam to miss with, and giving
  beams a miss chance is explicitly out of scope (that's accuracy RNG,
  which lives on the *pilot*, not the weapon — see hostile pilot AI
  below).
- **Per-sortie resources are real in play**, not cosmetic gauges:
  propellant (drained by thrust and boost), per-weapon ammo (a
  depleted mount goes silent until resupply), and life support (hits
  zero → forced ejection). The full lifecycle — launch from a
  per-ship-class hangar door, in-tactical resource economy, dock-back,
  mid-combat resupply protocol (~15s tactical-time base, modified by
  hangar boss + crew + boost) — lives in [sortie.md](sortie.md). The
  dry-MS choice ("dock now or fight on without that weapon") is the
  moment the resource layer earns its keep, exactly as designed —
  only the moment-to-moment control model changed, not that stake.
- **Cockpit HUD** overlays the tactical arena while piloting: propellant
  and life-support gauges, per-hardpoint ammo gauges (energy weapons
  show `∞` and never flag low), a boost-cooldown readout, a one-line
  flagship status sliver (hull % + AI stance) for situational awareness
  without leaving the seat, and a resupply-progress row for any MS
  currently cycling through a hangar bay. In practice that row only ever
  shows an AI wing's cycle today — docking exits the player's own
  cockpit immediately, before resupply starts, so the player can't watch
  their own MS's timer live (tracked as
  [#167](https://github.com/Leo927/UCLife/issues/167); predates W3).
- **Hostile MS carry pilot AI**, not scripted hit-scan: a pilot stat
  block (`reactionSec`, `aimJitterRad`, `boostUse`) drives how fast a
  hostile MS reacts, how much its aim wanders, and how readily it burns
  its own boost — the source of miss chance and skill variance that a
  hitscan beam or a fixed-radius hit test can't provide on its own.
- **AI-piloted wings.** MS with an assigned crew pilot launch as wings
  through the bridge's MS launch-authorization order (Workstream 2's
  order palette, CP-gated) via the same hangar-door queue the player
  uses. A wing's role tag (skirmisher / fire-support / anti-MS /
  anti-ship) selects its AI targeting behavior; wings drain their own
  sortie resources and auto-dock to resupply when a threshold is
  crossed, independent of the player's own MS.
- **Ejection has stakes.** Player MS hull reaching 0 (or life support
  reaching 0) triggers auto-pause and an eject confirmation, per the
  designed auto-pause set. A confirmed eject spawns a drifting,
  non-targetable pod; a hostile that reaches it before recovery rolls a
  capture attempt. With permadeath off, a failed/forced ejection routes
  through a physiology injury arc; with permadeath on, it's a seeded
  survival roll. NPC wing pilots get the same pod-fate roll, with death
  routing through `Health.dead` like any other crew loss.

The tactical battle continues while the player is in cockpit. The
player hears bridge chatter (zh-CN voice / log lines via the combat
event log). The flagship is on AI while the player is away from the
bridge — Ship Command + Tactics make this AI better. The player can
return any time by ejecting or docking back into the hangar, then
walking to the bridge.

The flagship's per-mount manual fire modes (auto / hold / volley) are
bridge controls: they only take effect while the player is at the
helm. The instant the player leaves for the cockpit (or walks off the
bridge), the flagship reverts to AI, which fires every charged mount on
auto regardless of what the player last selected — the selections
themselves aren't lost, they simply resume the moment the player
retakes the helm.

**Switching is the design's central tension.** The player constantly
chooses between piloting (high direct impact, no command) and bridge
(coordinating, but no MS in the field). The walking-transit cost makes
this a real decision, not a free toggle.

After the engagement resolves, the post-combat sequence (recoverables
dialogue, tally with named POW reveal, brig routing) lives in
[post-combat.md](post-combat.md). Captured hulls join the fleet
**in-flight** — the hangar question defers until the flagship next
docks.

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
- **Facility access** (consulates close, military zones lock)
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
- **Job market shifts** — military job postings appear (ordinary
  `jobs.json5` specs spawned as runtime workstations); higher military
  ranks gate on a faction service record. Civilian-track thinning waits
  on the demand-driven economy (see the note below).
- **Friends disappear** — named NPCs drafted, fled, or killed (offscreen, surfaced via newsfeed / log)
- **Refugees arrive** — new procedural NPCs in flop-tier housing
- **Facility access changes** — Zeon + Federation consulates guarded by
  hostile NPCs; access gated by faction reputation (not locked doors)
- **Conscription** — draft notice with stat-checked refusal roll
- **Ambitions adapt** — `earth_migration` harder, `lazlos_owner`
  becomes about staying open under rationing (deferred with the economy)

This is where the writing budget for war content lives. Hair complexity:
flavor without systemic entanglement.

> **Economy deferred.** Rationing / price + wage shifts are *not* part of
> the 7.0.E civilian-war slice. They fold into a future **demand-driven
> economy** (goods cost driven by production jobs + demand; wages driven
> by demand on produced items). Do not add a stopgap `war:` price/wage
> modifier — the civilian-war slice only *adds* military job postings, it
> does not shift prices or thin civilian jobs.

## The Phase 7 transition (UC 0079.01.03)

Single hard global flag flip. On transition:

1. Newsfeed enters wartime mode
2. Strategic war model starts churning
3. Conscription rolls activate
4. Active ambitions resolve `warPayoff`
5. Wartime ambitions unlock (deferred — Phase 7+ design)
6. Economy parameters shift (deferred to the demand-driven economy —
   see *Civilian war*; 7.0.E adds military job postings only)
7. NPCs with combatant backstories leave; refugees spawn
8. Some facilities transition state
9. Player-faction colonies become target-eligible for hostile
   expeditions

There is no rolling back. Saves before are pre-war runs; saves after are
wartime runs.

### Shipped (7.0.B)

Steps 1–2 plus the structural pivot. Concretely:

- **One-way `IsWartime` gate + strategic-war model** in `src/sim/warState.ts`
  — a sim-layer module store (global, not a per-scene ECS trait), seeded
  from `src/config/warTransition.json5` (trigger date, initial Federation /
  Zeon / Anaheim strengths, theater fronts). Flips exactly once on or after
  UC 0079.01.03 and never rolls back.
- **Transition orchestrator** `src/systems/warTransition.ts` — on the flip,
  runs the ordered steps: seed the model, fire the 7.0.A war-day
  force-toast, emit `'war:transition'` for the downstream slices
  (7.0.C/D/E subscribe). Wired to `'day:rollover:settled'` via
  `src/boot/warTransitionTick.ts`.
- **Strategic-war resolution** `src/systems/strategicWar.ts` — resolves the
  date-keyed `src/data/war-events.json5` entries against the strength model
  each wartime day (idempotent), emitting `'war:event-resolved'`.
- **Newsfeed wartime mode** — `rankTopHeadline` promotes war-tagged
  headlines once wartime (`social/newsfeed.md`).
- **Persistence** — gate + model + resolved-event ids round-trip on the
  `warState` save handler; a post-flip save loads wartime, a pre-flip save
  loads pre-war.

Not yet wired by 7.0.B: steps 3–9 (conscription → 7.0.C, `warPayoff` →
7.0.D, economy/refugee/facility content → 7.0.E, hostile expeditions →
7.1). They subscribe to `'war:transition'` / `'war:event-resolved'`; that
slice ships the dispatch + the model, not the subscribers.

**Step 4 shipped in 7.0.D (#107):** `src/systems/warPayoff.ts` subscribes
to `'war:transition'` and resolves each active ambition's `warPayoff`
route (most-progressed claims the title spotlight); wartime ambitions
unlock (step 5, gated on `isWartime()`); pre-war perks survive the flip.
See `social/ambitions.md § Shipped (7.0.D)`.

**Step 3 shipped in 7.0.C (#106):** `src/systems/conscription.ts` runs a
periodic draft roll on `day:rollover:settled` once wartime (cadence +
cooldown in `config/conscription.json5`). A draft notice issues the
player a stat-checked refusal roll (pure `refusalChance`: Federation rep
+ Charisma + a clinic medical letter + a cash bribe; an active
`mw_pilot` / `zeon_volunteer` ambition floors the odds toward
acceptance). The `DraftNoticePanel` resolves it (accept / refuse /
bribe); failure or acceptance fires the `'conscription:drafted'`
perspective-shift routing point (the Phase 7.1 deployment hook — entry
only). Combatant-eligible named NPCs (`combatantEligible` in
`special-npcs.json5`) churn out of the city on the same roll. State
(notice / cooldown / resolution / held letter) persists on the
`conscription` save handler. The clinic dialogue issues the medical
letter in wartime.

**Step 6 (refugees) shipped in 7.0.E.1 (#115):** `src/systems/population.ts`
runs a wartime refugee intake on `day:rollover:settled` (gated on
`isWartime()` + a daily cadence in `config/refugees.json5`). A replenishment
region opts in via `refugeeIntake` (only the Von Braun city region does);
refugees spawn at that region's safe `arrivalTile` — never a locked cell —
carry the distinct `npc-ref-` EntityKey prefix and a low starting purse, so
the normal bed-seeking behavior settles them into flop-tier beds. Arrivals
surface via `emitSim('log')`. Refugees are bounded by their **own**
`regionRefugeeCap`, *not* the replenishment `target`: a city boots well above
that target (it is an emergency floor, not the live headcount — Von Braun
seeds ~52 against a target of 30), so binding refugees to the target would let
none in. The cap bounds how many live refugees a region holds at once; the
intake fills toward it and halts, and deaths / departures free room for fresh
arrivals — so 7.0.E.2 churn compounds the turnover. The intake bookkeeping
(counter + last-spawn-day) persists on the existing `population` save handler;
the refugee entities re-derive from the seed like all procedural NPCs.

**Step 7 (friends gone) shipped in 7.0.E.2 (#116):** `src/systems/civilianChurn.ts`
runs a wartime churn on `day:rollover:settled` (gated on `isWartime()` + a
cadence in `config/civilianChurn.json5`) that removes the **non-combatant**
named NPCs the player knows — each either *fled* the colony or *killed
offscreen* (a seeded fate split, distinct log copy). It is **disjoint from
conscription by construction**: 7.0.C drafts the `combatantEligible` named
roster, this churns the rest, so the two filters partition the roster and a
given NPC leaves exactly once. Arrivals of the news surface via
`emitSim('log')` plus war-tagged `news.json5` headlines on the bar-TV. The
churned-name set + cadence roll-day persist on the `civilianChurn` save handler
(idempotency + round-trip); the destroyed NPCs stay gone after load via the
existing save-diff (`src/save/index.ts` destroys any reset-spawned entity the
snapshot doesn't expect), so no re-removal hook is needed.

**Step 8 (guarded consulates) shipped in 7.0.E.4 (#118):** facility access is
**emergent diplomatic slots**, not per-faction buildings.
`scenes.json5` authors `diplomaticSlots[]` per micro scene (≥3 for
`vonBraunCity`, on the walkable plain outside `procgen.rect`); each is
`{ id, rect, anchorTile, exitTile }` validated in `data/scenes.ts`, spawned as a
`DiplomaticSlot` anchor entity in `ecs/spawn.ts` (`bootstrapMicroScene`) with a
stable `slot-<scene>-<id>` key. `src/systems/diplomaticSlots.ts` runs on
`day:rollover:settled` (gated on `isWartime()`, `boot/diplomaticSlotsTick.ts`):
a faction's **strength = living-member count × `memberCountScalar`** (counted
over every scene world, excluding slot personnel); when it clears
`consulateThreshold` and a slot is free the faction **occupies** it —
`staffPerSlot` staff + `guardsPerSlot` guard NPCs spawn at the **city arrival
point** (the scene's first replenishment `arrivalTile` — the road-connected
immigrant/flight spill tile; airport fly-in as fallback) and walk to the
anchor; below threshold it
**vacates** (personnel despawn, slot frees). Both staff and guards carry the
`Guard` trait so the BT pins them on-post (`holdPost`); only guards get a
non-zero `detectRadiusPx`. The **guard branch is the highest-priority NPC_TREE
child**, gated FIRST on `isGuardOnDuty` (= `has(Guard)`) so ordinary NPCs fall
through unchanged. Detection (`src/ai/agent.ts`, hostility in `src/ai/hostility.ts`):
player inside the slot rect **and** within `detectRadiusPx` **and** aligned
(via `FactionRole`) with a faction in the guard faction's `enmity` row →
**eject** = set the player's `MoveTarget` to the slot `exitTile` (force-walk,
no combat) + a one-shot warn toast (debounced by an `ejecting` latch). Neutral
(no `FactionRole`) players pass freely. All knobs live in
`config/diplomacySlots.json5`; a `GUARD`-equivalent profiler is unnecessary
(O(guards) per tick, see perf note). Occupancy (slot→faction + staff/guard
keys) persists on the `diplomaticSlots` save handler, which **re-spawns the
slot personnel at their anchors on load** (the save-diff would otherwise drop
the `dipl-*` NPCs); the player-alignment `FactionRole` round-trips on its
existing serializer. Smoke: `tests/smoke/civilian-war-consulate.spec.ts`.

### Planned (7.0.E — steps 6–8, split into #115–#118)

Reshaped in a 2026-06 design pass with the owner. The umbrella #108 is
split into four independently-shippable sub-slices:

- **7.0.E.1 refugees (#115)** — ✅ shipped; see the *Step 6 (refugees)
  shipped in 7.0.E.1* note above.
- **7.0.E.2 friends fled / killed (#116)** — ✅ shipped; see the *Step 7
  (friends gone) shipped in 7.0.E.2* note above.
- **7.0.E.3 military jobs (#117)** — no job classification: military jobs
  are ordinary `jobs.json5` specs. A "posting" appearing / disappearing =
  runtime **spawn / despawn of `Workstation` entities**; wartime *adds*
  military postings only (civilian thinning waits on the economy). Higher
  military ranks gate on a **service record** measured as completed shifts
  converted to months — faction-cumulative, reusing the `work.ts` shift
  hook, distinct from per-rank `JobTenure`. Needs a save handler for
  runtime-spawned workstations (they are not re-derived from the seed).
- **7.0.E.4 consulates + guards (#118)** — ✅ shipped; see the *Step 8
  (guarded consulates) shipped in 7.0.E.4* note above. Original design intent
  below. Facility access is built on
  **emergent diplomatic slots**, not hand-authored per-faction buildings.
  Each walkable city authors **≥3 generic diplomatic slots** at worldgen
  (outside `procgen.rect`), empty by default. **Faction strength** drives
  occupancy, but there is no good metric yet — for now it is **abstracted
  as the faction's living-member count** (× a config scalar), derived at
  runtime. No boot seeding needed: member counts exist from the start and
  move on their own with conscription churn / refugees / recruitment, so
  occupancy stays emergent. A faction whose strength clears
  `consulateThreshold` **claims a free slot**; if it drops below it
  **vacates** (staff depart via the airport, mirroring arrival), so the
  war turning reshuffles presence for free. **Any faction, incl. the
  player-faction**, is eligible. **Slot identity derives from the
  occupant** — Zeon → consulate, Federation → garrison / HQ, player → own
  posting — so the consulate-vs-garrison naming asymmetry resolves itself.
  On occupancy, **staff (incl. guards) spawn at the airport arrival tile**
  (reuse `airportPlacements` + the flight-migration spawn) and walk to the
  slot, pretending to have arrived by flight (needs the scene to have an
  airport — `vonBraunCity` does, `zumCity` stub may not). Restriction is
  enforced by **hostile guard NPCs** that detect the player by **zone +
  range** and eject them (warn + force-walk to exit, no combat) — *not*
  locked doors. Access is **hostility-based**: guards admit anyone
  *except* players aligned with an enemy faction (read player alignment
  via `FactionRole` / `RecruitedTo`; faction enmity from config — e.g.
  Zeon ⟷ Federation, sharper in wartime). Neutral / unaligned players —
  most playthroughs — pass freely. No reputation system. This is the
  **first ground-hostility subsystem** (no ground combat / detection
  exists today — tactical combat is space-only), a precursor to ground
  combat.

**Economy shocks are cut** from 7.0.E (see the *Economy deferred* note
under *Civilian war*) — deferred to the demand-driven economy.

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
Mid-combat withdraw is a bridge verb (flagship command authority only). MS
pilots dock back to the flagship personally via 返航 (回收).

## Settled commitments

The Starsector-shape calls are now locked. Specifically:

1. **Macro-geography: continuous 2D campaign.** Earth Sphere is one
   continuous 2D map with named POIs (Sides 1–7, Luna, Luna II, Earth
   orbit, asteroid clusters); Jupiter expedition is a separate map
   reached by long burn. Full geography in [starmap.md](starmap.md).
2. **Multi-ship fleet, economics-gated.** No hard fleet-size cap and no
   skill formula on ship count; CP and DP throughput remain
   skill-gated and cap per-engagement combat scale instead.
   Per-ship + per-MS supply consumption (Starsector
   model), command points (Minovsky-comm bandwidth), and deployment
   points are the suppressors. Lost ships are permanent losses,
   replaced by recruitment / procurement, not story event. Mules and
   freighters are first-class fleet roles. See [fleet.md](fleet.md).
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
6. **Walkable current ship.** Whichever ship the player is currently
   aboard is a walkable koota scene; that ship gets the `IsFlagshipMark`
   tag and that is its only specialness. Switching to another ship in
   the fleet is routine transit at docking-with-fleet moments, not a
   story event. Walkable interior is authored per ship *class*, not per
   instance.

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

3. **CP / DP concrete numbers.** Specific command-point cap, regen,
   per-action costs, and deployment-point budgets are Phase 6.2.7
   implementation. Structural commitment: economics + CP + DP gate
   fleet size and tactical scale, not a player-skill linear formula.
   See [fleet.md](fleet.md) for the framework.

## Phasing

| Phase | Combat scope |
|---|---|
| **5.4c** | Cockpit minigame primitives ship in **simulator-only** form. AE MS-handling sim, Federation reservist drills. No real combat, no hostile NPCs, no ship. The player is still in Von Braun. |
| **6.0** | Starsector-shape tactical foundation. Single-ship pre-war merc work. Walkable flagship as scene + walkable **captain's office** room (single-ship; pre-launch readiness summary). Tactical view (top-down 2D, real-time + pause). Hardpoint weapons, flux, shields, hull. **Combat event log** (top-left, fading scroll, severity tiers); **tactical auto-pause set narrowed** to first-contact + flagship 25% / 10% + boarders + player-eject. **Tally dialogue minimum** (credits + supplies + fuel). Encounter generator. Player buys their first ship as a Phase 6.0 capstone. See [post-combat.md](post-combat.md). |
| **6.1** | Bridge ↔ hangar walkable transit. Player pilots an MS personally via direct WASD/aim control (superseded the planned Engage/Evade/Suppress/Breach primitive reskin — see §Cockpit mode). MS wings AI-piloted while player is at bridge. Walking-transit cost on flagship AI. **MS launch + cockpit transition + dock-back** (single placeholder hangar door per ship); **no per-MS resources yet** — MS combat is hull-only. Combat event log gets full content. See [sortie.md](sortie.md). |
| **6.1.5** | Singleton-to-plural ship structural prep (no player-visible content). See [fleet.md](fleet.md). |
| **6.2** | Multi-ship fleet MVP. Two more ship classes (escort + small freighter). Per-ship + crew supply economics (Starsector model). Fleet roster + crew assignment screens. Hire-as-captain / hire-as-crew dialogue branches (stub; full hire flow in faction-management). Buy-ship dialog at brokers. Mothballing. Doctrine slider per ship. Persistent fleet damage between encounters. Debug "grant fleet" populates a 2-ship fleet + ~30 hired NPCs. **Comm panel relocates to captain's office; officer-led crew auto-man verb. `brigCapacity` + brig as ship-class room (no prisoner verbs yet). Tally dialogue full (loot routing + named POW reveal); notable-hostile authoring on `space-entities.json5` rows.** See [fleet.md](fleet.md), [post-combat.md](post-combat.md). |
| **6.2.5** | MS + pilot layer. `ms-classes.json5`, MS runtime entity, hangar UI, pilot roster + assignment, per-MS + per-MS-repair supply economics. **Per-MS sortie resources** (`currentPropellant`, per-weapon ammo, life support); **mid-combat resupply protocol** (15s base, full crew/boost formula); **per-ship-class `hangarDoors[]` + door queueing**; stranded-MS recovery tug. **Prisoner verbs** + brig upkeep; **MS-parts loot** via salvage table. See [sortie.md](sortie.md), [post-combat.md](post-combat.md). |
| **6.2.7** | Command points + deployment points wired into tactical. Doctrine sliders fully active; out-of-CP standing-orders behavior. |
| **6.3** | Colony establishment. Player can claim an asteroid POI or build a new colony from scratch. Walkable colony scenes (smaller than cities, reusing scene/facility/cell procgen with industrial pool, plus colony-only classes — warship slipway, large MS factory). **Recoverables dialogue full** (capture / salvage / scuttle); **salvaged-hull-in-flight pattern**; **`WasCaptured` faction-relation hooks**; **colony detention** as brig-overflow target. See [social/faction-management.md](social/faction-management.md), [post-combat.md](post-combat.md). |
| **6.4** | Faction-tier features: large-scale recruitment, governance choices, faction reputation as actor (player-faction has its own faction rep with NPC factions). Phase 7 hostile-expedition mechanic foundations. |
| **7.0** | Phase 7 trigger fires. Strategic war model goes live. Newsfeed wartime mode. Conscription. Wartime ambitions. Civilian-war content (TV, military job postings, refugees, departing friends, guarded consulates; rationing deferred). |
| **7.1** | Wartime deployment: `mw_pilot` / `zeon_volunteer` players assigned to NPC-captained ships. Sector-based campaign structure. Real MS combat under real stakes. Player-faction colonies become target-eligible for hostile expeditions. |
| **7.2** | Mind-control / Newtype systems. Late-war fronts. Player can rise to command of their assigned ship. |
| **8+** | LLM-driven battle chatter, surrender attempts, post-engagement debrief. |

## What combat is NOT

- **Not the heart of the game.** The heart is daily life under sim.
  Combat is one of several payoffs that life can lead toward.
- **Not Gundam Battle Operation.** Direct WASD/aim MS control is canon
  (superseded the earlier primitive-minigame ceiling — see §Cockpit
  mode), but tactical scale stays fleet-first: the player is one pilot
  among a fleet's escorts and MS wings, not the center of an
  arena-shooter. Leaving the bridge for the cockpit costs the flagship
  its captain, by design.
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
- [fleet.md](fleet.md) — multi-ship fleet roster, captains, MS + pilot layer, supply / CP / DP economics, doctrine — the layer this combat doc's "no hard cap" commitment resolves into
- [sortie.md](sortie.md) — in-tactical MS lifecycle: per-sortie resources, mid-combat resupply, hangar-door queueing, pilot recovery
- [post-combat.md](post-combat.md) — combat event log + narrowed tactical auto-pause set; recoverables / tally / prisoner dialogues; named-hostile authoring
- [encounters.md](encounters.md) — form of node events; combat is reached through them, not directly
- [mobile-worker.md](mobile-worker.md) — civilian MW minigame engine (Phase 5.4 pre-war training content only; no longer the combat input model — see §Cockpit mode)
- [social/ambitions.md](social/ambitions.md) — `warPayoff` routes pilot ambitions onto ships; non-pilot ambitions stay in Von Braun
- [social/faction-management.md](social/faction-management.md) — Phase 6 fleet + colony layer; this is where the Starsector shape ships
- [social/newsfeed.md](social/newsfeed.md) — strategic war's primary delivery channel; civilian-war texture
- [characters/index.md](characters/index.md) — permadeath toggle interaction; crew death is independent of toggle
- [characters/skills.md](characters/skills.md) — Ship Command / Tactics / Leadership feed CP cap and doctrine effectiveness; Leadership still gates colony administrative load; `piloting` (existing unified skill) gates MS pilot quality
- [npc-ai.md](npc-ai.md) — crew BT extends with combat-station drives
- [worldgen.md](worldgen.md) — flagship interior + colony interior reuse scene-procgen facility / cell pipelines
- [phasing.md](phasing.md) — combat phasing relative to overall plan
