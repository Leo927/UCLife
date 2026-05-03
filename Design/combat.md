# Combat

*How war and violence enter the player's life. Cuts across MW sim, faction
management, ambitions, newsfeed, NPC AI, and the Phase 7 war event. This
file is upstream of all of those — write before implementing any of them.*

## Why this file exists ahead of implementation

Every combat-touching system already designed (MW minigame primitives,
ambitions' `warPayoff`, faction management Phase 6, the UC 0079.01.03
trigger) makes implicit promises about how combat resolves. If combat
turns out to be turn-based, those promises break. This file fixes the
shape of combat first so the downstream files don't drift.

This is **not** the final spec. It's the structural commitment: player
perspectives, resolution layers, what's reused vs. new, what's deferred.
Detailed mechanics (damage formulas, exact primitive timings, weapon
catalogs) live in implementation-phase files.

## The core call: war is mostly a backdrop, sometimes a fight

UC Life Sim is a life sim, not a Gundam combat game. The default expected
experience is that **most playthroughs see zero direct combat**. Players
who pursued `mw_pilot` or `zeon_volunteer` cross into combat as a payoff
for that ambition's investment. Players who ran the bar, migrated to
Earth, or dropped out experience war as **disruption to daily life** — and
that civilian-war content is the primary delivery vehicle, not the
exception.

This shapes the entire design. Combat doesn't have to be the most polished
system in the game; civilian-war content does. Combat has to be **good
enough** for the players who pursued it, and **invisible enough** for the
players who didn't.

## Player perspective taxonomy

Three relationships the player can have with war. A single run can move
between them.

| Mode | Who is here | What they see | What they do |
|---|---|---|---|
| **Witness** | Civilians (default for `lazlos_owner`, `earth_migration`, `dropout`, `ae_chief_engineer`) | Newsfeed, dome events, neighbors disappearing, prices shifting | Live their life under wartime pressure |
| **Combatant** | `mw_pilot`, `zeon_volunteer`, conscripts, mercenaries | Cockpit minigame against hostile pilots | Pilot — same input model as MW sim, hostile variants |
| **Commander** | Phase 6+ faction cell leader | Squad of 2–6 NPC pilots on a macro scene | Issue orders; can also pilot personally |

A `mw_pilot` who survives the early war and gets promoted may transition
into Commander mode. A `zeon_volunteer` may become a frontline pilot
indefinitely. A `lazlos_owner` may never leave Witness — that's a complete
playthrough.

## Three resolutions of combat

| Resolution | Time scale | Player input | Where rendered |
|---|---|---|---|
| **Strategic** | Days–weeks | None — narrated outcomes, observable consequences | Newsfeed, world map, NPC populations |
| **Tactical** | Minutes–hours | Squad-level orders | Macro scene (top-down, RimWorld-shape) |
| **Cockpit** | Real-time seconds | Direct cockpit controls | Same minigame engine as MW sim, hostile variants |

Most war content lives at strategic resolution because most of war lives
there for most people. Tactical and cockpit are the dramatic moments — and
moments by design, not the default state.

---

## Strategic war (always-on once Phase 7 fires)

Faction strength is a small numeric model — Federation, Zeon, AE corporate
power, plus theater fronts (Side 1, Side 3, Earth, lunar). Date-keyed
events resolve against those numbers with seeded RNG; outcomes propagate
to:

- **Newsfeed** entries
- **Economy** shocks (rationing, employment surges/dries, currency drift)
- **NPC drives** (fear → seek shelter, patriotism → enlist, despair → drink)
- **Conscription pressure** on the player and on NPCs
- **Population** churn (named NPCs drafted/killed/missing; refugees arrive)
- **Building access** (consulates close, military zones lock)

The player observes strategic war as **backdrop pressure on daily life**.
War as economy, war as crowd, war as missing friend. This is where the
game lands its emotional weight for the median player.

**Key design rule:** strategic war must be visible without combat input.
A pure-Witness player should still feel the war as a season turning, not
a system they ignored.

## Tactical combat (Phase 6+, macro scenes)

Player runs a faction cell. Squad of 2–6 NPCs (and optionally the player
character) deployed on a macro scene. Player input is **at the directive
level**:

- Move to position / hold position / withdraw
- Engagement priority (target this enemy / preserve own integrity / area-deny)
- Posture (aggressive / cautious / cover-only)

NPCs reuse the city BT framework with combat-specific drives. The player
**does not joystick** units in tactical mode — they author intent and
watch outcomes. This is consistent with how the city sim works: the
player tells NPCs what to value, NPCs decide how.

**The player as one of the squad:** if the player character is deployed,
their engagements zoom into Cockpit mode while the squad continues
tactically around them. Returning from a cockpit engagement drops them
back into squad view at whatever position they ended in. This is the
single bridge between Commander and Combatant.

**Apophenic payoff:** the same NPCs the player drank with at Lazlo's,
hired into the cell, watched train — those are the named units on the
field. When one of them dies in a tactical engagement, that's the entire
point of running the city sim underneath.

## Cockpit combat (Phase 7+ in earnest, simulator from Phase 5.4c)

Reuses the MW minigame engine. The hostile primitive variants:

| Hostile variant | Built from | What changes |
|---|---|---|
| **Engage** | Weld | Track an actively-evading enemy reticle (paired against an NPC's Evade) |
| **Evade** | Stack | Keep yourself outside an enemy's lock cone while they actively track |
| **Suppress** | Salvage | Rapid target acquisition with decoy density and hostile fire timing |
| **Breach** | Lift | Waypoint navigation under suppression — incoming hits push your inertia |

A skirmish is a sequence of paired primitive contests between you and one
or more NPC pilots. Each pilot has their own piloting/reflex stats; the
matchup is your stats against theirs through the same input model.

**Damage model:** cockpit integrity (HP-like, 0–100). Failed primitives
apply hits scaled by the opponent's piloting margin over yours. Integrity
0 = ejection.

**Withdraw is always available** before a primitive commits. Engage and
Evade have a 2-second windup where the player can back out at no rep cost.
Once committed, you fight or eject. This is the graceful-failure path.

**Outcomes of integrity 0:**
- Permadeath off: capture (POW arc) or hospitalized (recovery + injury). Faction-rep loss.
- Permadeath on: dead. Run ends. (See [characters/index.md](characters/index.md) — permadeath is opt-in.)

**Engagement length:** 3–8 minutes real-time. The macro scene runs the
battlefield; the cockpit minigame runs the engagement; both are paused
during a primitive's modal. Game clock pauses through the whole sequence.

---

## Civilian war (the most-played version)

The most important section of this document, because it covers the
default playthrough.

For the player who never trained piloting, war is delivered through:

- **Lazlo's TV** — newsfeed enters wartime mode; headlines turn from "Side 3 senator visits" to "Loum offensive enters second week." Dialogue lines change.
- **Job market shifts** — AE pivots heavily to military contracts; civilian-track positions thin; military-adjacent positions surge in pay (mechanic, electronics, fabrication, medicine).
- **Friends disappear** — named NPCs in the player's relationship roster get drafted, flee, or are killed. They get a final newsfeed entry; sometimes a letter; sometimes silence. (Apophenia.)
- **Refugees arrive** — new procedural NPCs appear in flop-tier buildings; their backstories reference Side 3 / Earth / asteroid colonies the war has touched.
- **Building access changes** — Federation consulate restricts hours; Zeon consulate closes (their staff are now enemy combatants on lunar territory); some industrial zones become military-controlled.
- **Conscription** — the player gets a draft notice. Stat checks (Federation rep, Charisma, money for bribes, an MD letter from the clinic) modify a roll. Roll fails → conscripted into the combatant track regardless of their ambition. This is the one place civilian war forces a perspective shift.
- **Ambitions adapt** — `earth_migration` becomes harder (fewer ships, higher prices, longer clearance queues). `lazlos_owner` becomes about keeping the bar open under rationing. `ae_chief_engineer` accelerates if the player accepts war contracts, stalls if they refuse.

**Where the writing budget lives:** Lazlo's news headlines, NPC dialogue
shifts, the conscription dialogue tree, refugee NPC backstories, the
final-letter system for departed friends. This is hair-complexity work —
flavor without systemic entanglement, in the [DESIGN.md](DESIGN.md)
sense.

## The Phase 7 transition (UC 0079.01.03)

A single hard global flag flip. Effects on transition:

1. Newsfeed enters wartime mode (ongoing event stream begins)
2. Strategic war model starts churning (faction strengths now drift)
3. Conscription rolls activate (timed against player's combat-eligibility)
4. All active ambitions resolve their `warPayoff` field — see [social/ambitions.md](social/ambitions.md)
5. New wartime ambitions may unlock (deferred — Phase 7+ design)
6. Economy parameters shift
7. NPCs with combatant backstories leave the city; refugee NPCs spawn
8. Some buildings transition state; consulates close

Saves before this date are pre-war runs; saves after are wartime runs.
There is no rolling back. This is intentional — the war is a one-way door
the entire game has been pointed at.

## Permadeath and combat

The permadeath toggle changes combat stakes radically. The combat design
must work under both settings:

**Permadeath off (default):**
- Failed cockpit engagement → capture or hospitalization
- POW arc: held for N days, faction-rep penalty, possible interrogation events, eventual release or rescue
- Hospitalization arc: recovery time, injury (Phase 4 system), bills
- The character continues with meaningfully changed state

**Permadeath on:**
- Failed cockpit engagement → likely run end
- Players will (and should) be more cautious — Withdraw becomes load-bearing
- Combat stakes telegraphed loudly; no surprise unwinnable fights

Both modes share the same engagement structure. Permadeath is a *consequence
toggle*, not a separate combat system. Designs that only work under one
setting should be flagged and revised.

---

## Open questions I'm flagging for explicit decision

These are calls I made above that I'm least confident about. The user
should weigh in before implementation begins.

1. **Does the player pilot a real MS, or only simulators?**
   I assumed yes — after Phase 7's draft flow places a `mw_pilot` veteran
   into a cockpit, they get the real thing. The dramatic payoff of the
   ambition. Alternative: the player only ever sees MS in simulators and
   real MS combat is reserved for NPCs the player commands. **My
   recommendation: real MS for the pilot path. The ambition has to land.**

2. **Is mercenary tactical combat available pre-war?**
   I assumed Phase 6 reaches into 0078 as small-scale corporate-security
   skirmishes — pre-war merc work, low-stakes, optional. This makes the
   tactical layer playable before Phase 7 fires. **My recommendation: yes.
   Without it, tactical combat ships and immediately gets buried under the
   Phase 7 transition's other content.**

3. **Can the player refuse conscription?**
   I assumed yes via stat checks (rep, money, charisma, medical letter),
   with failure forcing the perspective shift. Alternative: hard
   conscription if `mw_pilot` was active, soft if not. **My recommendation:
   stat-checked roll for everyone, with mw_pilot biasing the roll heavily
   toward acceptance. Lets players who hated their ambition by Phase 7
   still escape it, but at cost.**

4. **Do NPCs the player knows visibly die in combat?**
   I assumed yes for named NPCs (with newsfeed/log notices), no for
   procedural background NPCs (silent disappearance). **My
   recommendation: yes, named-NPC death is required for apophenic war
   content to land. Without it, the war feels staged.**

5. **What's the macro scene's relationship to micro scenes?**
   I assumed the same flight/transit system used to reach Side 3 takes
   the player to deployment macro scenes. The macro scenes infrastructure
   already exists in `scenes.json5` (sceneType: 'macro'); it's just
   empty. **My recommendation: confirm. This is the cheapest path.**

6. **How frequent are tactical/cockpit engagements for a Combatant?**
   I haven't committed. Options:
   - **High** (weekly engagements during deployment): combat is the main
     gameplay loop for combatants. Risks burnout fast.
   - **Punctuated** (engagements as scripted-with-RNG date-keyed events):
     long gaps of barracks life and downtime, with engagements as the
     dramatic punctuation. Closer to actual military experience.
   - **Player-triggered** (combatants choose deployment intensity): more
     agency but harder to balance.
   **My recommendation: punctuated, with a small amount of player choice
   over deployment intensity. Matches the life-sim cadence.**

## Phasing

| Phase | Combat scope |
|---|---|
| **5.4c** | Cockpit minigame primitives ship in **simulator-only** form. AE MS-handling sim and Federation reservist drills are the player's only exposure. No real combat. No hostile NPCs — drills run against scripted patterns. |
| **6.0** | Pre-war mercenary tactical layer. Macro scene + squad orders + NPC pilots. Small-scale corporate-security skirmishes. Player's first taste of real combat. |
| **6.1** | Cockpit-tactical bridge: player character can deploy as one of the squad and zoom into cockpit mode for their own engagements. |
| **7.0** | Phase 7 trigger fires. Strategic war model goes live. Newsfeed wartime mode. Conscription. War-time ambitions. Civilian-war content (TV, prices, refugees, departing friends). |
| **7.1** | Real MS combat for the pilot path. Hostile cockpit primitives meet actual stakes. POW / hospital arcs for non-permadeath failure. |
| **7.2** | Faction-management combat: player runs a wartime cell with real strategic context. Tactical engagements have theater consequences. |
| **8+** | LLM-driven combat dialogue (battle chatter, surrender attempts, post-engagement debrief). |

## What combat is NOT

- **Not the heart of the game.** The heart is daily life under sim.
  Combat is one of several payoffs that life can lead toward.
- **Not Gundam Battle Operation.** No twin-stick action, no real-time
  squad joysticking, no flight physics. The minigame primitive model
  is the ceiling.
- **Not skippable for combatants.** A `mw_pilot` who reaches Phase 7
  expects to fight. The auto-resolve toggle from the simulator does
  **not** apply to real combat — that would gut the ambition's payoff.
- **Not punishing for non-combatants.** A `lazlos_owner` who never
  trained piloting must be able to play through Phase 7 without
  combat ever forcing itself on them, except through conscription —
  and conscription must be refusable on stat checks.

## Related

- [mobile-worker.md](mobile-worker.md) — cockpit minigame engine; primitive reskins for hostile variants
- [social/ambitions.md](social/ambitions.md) — `warPayoff` field routes ambitions into combat / non-combat tracks
- [social/faction-management.md](social/faction-management.md) — Phase 6 commander-mode squad combat
- [social/newsfeed.md](social/newsfeed.md) — strategic war's primary delivery channel
- [characters/index.md](characters/index.md) — permadeath toggle interaction
- [npc-ai.md](npc-ai.md) — combat drives reuse the city BT framework
- [phasing.md](phasing.md) — combat phasing relative to overall plan
