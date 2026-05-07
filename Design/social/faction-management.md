# Faction management (Phase 6 — Starsector layer)

*The late-game arc where a single character grows from one ship to a
fleet, then to a colony, then to a small faction with stakes in the UC
0079 war.*

## What this layer is for

Phase 5 closes the day-loop and gives the player long-arc ambitions to
aim at. Phase 6 opens the **third scale** of play: above daily life,
above ship deployments, the player establishes a persistent
multi-ship, multi-colony presence in the Earth Sphere — a small
faction with assets, subordinates, and reputation in its own right.

The **Faction abstraction itself** (members, leader, fund, owned
properties, relations, war edges) and the **Owner = Character |
Faction** ownership model are introduced earlier, in
[facilities-and-ownership.md](facilities-and-ownership.md) — the
Phase 5.5 *civilian* prelude that lets the player run a small
faction-of-one out of Von Braun without ever buying a ship. Phase 6
inherits those abstractions; it does not redefine them. Read that
file first if you arrive here looking for ownership, payroll,
recruitment-from-cities, or the realtor pattern.

This is the Starsector capstone. Done well, it pays off years of
relationship work (your bartender becomes your bridge officer; your AE
co-worker captains your second ship), gives the war event real
stakes (your colony is now a target), and offers a strategic-agent
alternative to the single-pilot wartime experience.

The Phase 5 player-as-NPC architecture (see [../npc-ai.md](../npc-ai.md))
is what makes this transition cheap: the same drive computations that
drove autonomous NPCs are now driven by player-authored weights for
subordinates the player has hired into their faction. No rewrite
required.

## The progression: ship → fleet → colony → faction

Phase 6 is structured as a four-step ladder, each step gated by the
previous and by skill development:

1. **First ship (Phase 6.0)** — player buys a small ship, hires a few
   crew from city relationships. Single-ship pre-war merc work.
2. **Bridge ↔ hangar walk + MS pilot mode (Phase 6.1)** — player
   personally pilots an MS launched from their flagship.
3. **Fleet (Phase 6.2)** — player acquires more ships, assigns
   captains (NPCs they've recruited), commands them in tactical
   combat. Capacity is gated by economics + command bandwidth, no
   hard cap (see [../fleet.md](../fleet.md)).
4. **Colony (Phase 6.3)** — player claims an existing asteroid base
   or builds a new colony from scratch. Walkable scene.
5. **Faction-tier (Phase 6.4)** — player-faction acquires its own
   faction rep with the canon factions; recruitment scales beyond
   personal relationships; governance choices affect colony output
   and stability.

Each step is **optional**. A player who tops out at Phase 6.0 with a
single ship and one short merc career has played a complete Phase 6
arc. A player who pushes through to Phase 6.4 has played a different,
longer Phase 6 arc. Both are valid.

## Surface design: read this first

Every management verb described below — hire, fire, assign, retrofit,
set doctrine, set policy, declare diplomacy — happens on a body or in
a place. The discipline is in [diegetic-management.md](diegetic-management.md);
it defines the physical hubs (bridge, war room, hangar deck,
recruitment post, colony command center, council chamber), the
first-touch + comm-panel pattern that lets order-as-conversation scale
past 20 ships, and the rule that roster panels are *projections* of
the diegetic surface, not the primary verb. Read that file before
extending this one.

## Fleet: economics-gated, no skill formula on fleet size

There is **no hard fleet-size cap and no skill formula gating ship
count.** Fleet *size* is gated by economics and command bandwidth, per
[../fleet.md](../fleet.md). Per-engagement *combat scale* (CP and DP)
**is** skill-gated:

- **Per-ship + per-MS supply consumption** (Starsector model). Each
  ship class has a fixed `supplyPerDay`; each MS in a hangar adds its
  own per-MS cost; each MS in repair adds further per-MS-day cost.
- **Command points** (Minovsky-comm bandwidth). CP cap scales with
  player Ship Command + Tactics and the flagship comm officer; CP is
  spent on fleet-wide tactical actions.
- **Deployment points** in tactical engagements. Fleet size and
  per-engagement combat scale decouple.

Player Ship Command / Tactics / Leadership still matter — they feed CP
cap, doctrine effectiveness, and crew-morale resilience — but they no
longer translate linearly to "you may field N ships." A player who
specializes in command runs a more *coordinated* fleet, not a strictly
larger one; growing the fleet means growing the income stream that
feeds it.

### Ship classes and procurement

Ship classes (frigate, destroyer, cruiser, carrier, capital, **mule,
freighter**) are authored as templates in `data/ship-classes.json5`.
Each template carries class name, fixed `supplyPerDay`, hull / armor,
top speed and maneuverability, supply / fuel / cargo storage, hangar
capacity, **mounts (hardpoint position + the weapon at each, fixed at
template-time)**, crew requirement, bridge interior layout, and DP
cost. See [../fleet.md](../fleet.md) for the full data shape.

**Ships do not refit.** The mounts a ship class is authored with are
the mounts that ship fights with for its entire service life. If a
class needs a different loadout for a different role, that's a new
ship class, not a runtime fitting choice. The customization energy
that would otherwise sit on ship loadouts goes one layer down to the
**MS retrofit** layer — see [../fleet.md](../fleet.md#ms-retrofit--the-customization-platform).

Mules and freighters are **first-class fleet roles**, not optional
bookkeeping — cargo / fuel / supply storage spread across the fleet
rather than getting stuffed into the flagship.

Ships are **bought** at major shipyard POIs (Granada, Luna II, certain
Side hubs). Pre-war: catalog is broad, AE-aligned shipyards favor
civilian-spec hulls. Post-war: military-grade hulls require faction
rep gates; civilian hulls become scarcer as production pivots. The
buy-ship dialog selects a class; what gets delivered is that class's
authored loadout — no fitting screen.

Ships are **lost permanently** in combat. Replacement is procurement
+ recruitment, not story event. This is the Starsector pattern; it
gives wins and losses real weight on a campaign timeline. (Custom-MS
loss is even more painful — a kitted-out Gundam with months of
retrofit work behind it does not come back.)

### Captain and pilot assignment

Each ship needs a captain; each MS in a hangar needs a pilot. Captains
and pilots are NPCs the player has recruited — most often from city
relationships built up over previous play. The captain's Ship Command,
Tactics, Piloting skills determine how their ship fights when
AI-controlled in tactical combat; the pilot's `piloting` skill (the
unified pilot/MS skill already in the catalog) determines MS
performance when AI-controlled.

Auto-assignment picks sensible defaults (highest-skill idle officer or
pilot); the player can override anywhere. See [../fleet.md](../fleet.md)
for the auto-assign + override flow.

This is where the relationship layer pays off concretely: the friend
you talked to for a year at Lazlo's is now the captain who keeps your
formation cohesive, or the pilot in the MS three klicks out.

### Fleet orders

In tactical view, the player issues orders to fleetmates:

- **Engage [target]** — pursue and attack
- **Screen [ship]** — protect a friendly from incoming fire / boarders
- **Hold position**
- **Retreat** — disengage; ship leaves the engagement (returns to
  fleet at conclusion if the player escapes)
- **Stand down** — cease fire; useful in surrender / civilian
  encounters

Order quality scales with player Tactics + officer Tactics. Low-skill
fleetmates execute orders sluggishly or interpret them loosely; high-
skill ones anticipate and adjust.

## Colony: claim or build

At Phase 6.3 the player can establish their first colony. Two
acquisition arcs, both diegetic, both producing a walkable scene that
becomes a persistent POI on the Earth Sphere campaign map. Per the
[diegetic-management.md](diegetic-management.md#acquisition-is-part-of-the-surface)
discipline, neither arc is a click — both have on-site verbs, embodied
NPC obstacles, and a walked moment of taking possession.

### Claim path

Worldgen seeds **3–5 authored, named claimable POIs** at game start
(abandoned helium-3 refinery, pirate-occupied salvage yard, bankrupt
mining concern), each carrying backstory in the [newsfeed](newsfeed.md).
New candidates surface monthly as news events generate them. Pure
procgen alone makes "claim X vs Y" feel arbitrary; named candidates
with character make it a real choice.

The arc:
1. **Spot a candidate** on the [starmap](../starmap.md), flagged with
   its newsfeed hook ("the Mariko Concern collapsed last week").
2. **Dock and resolve the human factor on-site.** The obstacle is an
   NPC, not a stat check — pirates to clear in tactical, a bankrupt
   owner to negotiate with via talk-verb, or a squatting survivor-
   administrator the player can hire as their first colony admin. A
   player with city relationships may discover the bankrupt owner is
   someone they already know.
3. **Take possession in a walked moment.** The empty administrator's
   chair in the candidate's command center is the claim verb. Walk to
   it, sit, install your first hire. That action seals ownership.

Faster, lower establishment cost, smaller starting facility stock —
but layout and faction context are fixed by what you found.

### Build path

The arc:
1. **File a charter in person.** Walk to a Federation, Zeon, or AE
   permits official at a major POI. Faction rep gates fee and
   approval; building in unclaimed asteroid space skips the charter
   entirely but draws pirate attention.
2. **One freighter trip, not a logistics chain.** Buy a "colony
   establishment package" — a physical cargo item bundling capital +
   supplies + a tagged construction crew — at a major shipyard. Fly
   it to the chosen point. Subsequent facilities each need *a* trip +
   *a* credit cost but never a multi-shipment supply chain. We are
   not X4.
3. **The first walkable scene is one hab pod.** Drop the
   establishment package; the scene starts as a single life-support
   module with construction NPCs sleeping on cots. Each authorized
   facility extends the scene over game-time; the colony grows
   visibly under the player's feet across months.
4. **Construction time has interrupts.** Worker injury, faction
   inspector visit, contested supply shipment — small events that
   pull the player out of hyperspeed. Without these the player skips
   weeks and arrives at a finished base, which is the menu pattern
   with extra steps.

Slower, more capital-intensive, fully customizable layout because the
player authored each facility.

In both cases the resulting colony is a **walkable koota scene**,
sized smaller than Von Braun (one or two districts of a city, not the
full thing), reusing the existing scene/facility/cell procgen pipeline
with a new facility-type pool tilted industrial. Established cities
(Von Braun, Zum) only sell *existing* facility stock through the
realtor; **colonies are the only place the player can build new
facilities that don't already exist on the map** — that is the
colony arc's mechanical reason to exist.

- **Refinery** — converts raw materials to refined goods (income)
- **Hydroponics / agro-dome** — produces food (consumed by crew + sells)
- **Habitation** — population capacity
- **Hangar / repair facility** — small MS repair / retrofit
- **Warship slipway** — **colony-only**; the Phase 6 capital ship
  production pipeline does not exist in established cities
- **Large MS factory** — **colony-only**; small-scale retrofit and
  repair are available at city hangar facilities, but at-scale MS
  production is gated to colonies
- **Barracks** — garrison capacity (defends against expeditions)
- **Command center** — stability + administration
- **Mining drill** (asteroid only) — raw material output
- **Bar / market / clinic** — civilian quality-of-life facilities
  (NPCs migrate in if these exist; otherwise stability suffers)

NPCs in colonies are mostly procedural (background population), with
named NPCs assignable to key roles (colony administrator, lead
engineer, garrison commander) by the player.

### Colony scale: skill-gated administrative load

There is **no hard colony cap.** Colony capacity is gated by player
administrative load:

- **Leadership (player)** — primary contributor; how many colonies the
  player can simultaneously administer
- **Officer assignment** — a colony with a high-Leadership administrator
  reduces the player's load, allowing more colonies
- **Garrison adequacy** — under-protected colonies are raid magnets;
  Tactics + Ship Command on the assigned defense forces matter

Unlike the fleet (gated by per-ship economics + CP), colony scale is a
pure administrative-load gate: there is no per-colony "supply" that
bleeds out, but there *is* a per-colony budget for stability +
production that the player must keep positive. Specific formula is
Phase 6.3 implementation work; structural commitment: linear-with-Leadership
+ delegation, no hard cap.

### Colony services to the player

Owning a colony provides:

- **Resupply hub** — fuel + supplies + repair at no markup
- **Recruitment depth** — NPCs in the colony are pre-loyal; cheap to hire
- **Income** — refineries + mining drills generate periodic credits
- **Strategic asset** — colonies in contested space project influence
- **Storage** — warehouse for cargo / spare ship modules / MSs

### Colony threats

Colonies attract attention. Threats include:

- **Pirates** — raid attempts; chance scales with colony wealth and
  garrison weakness
- **Hostile faction expeditions (Phase 7+)** — full fleet attacks
  ordered by Federation / Zeon when player-faction is on their bad
  side. Player must defend personally or assign sufficient defensive
  forces.
- **Stability collapse** — under-supplied or under-administered
  colonies revolt; player loses ownership

Defending a colony is a normal tactical-mode engagement, just with the
colony rendered as a backdrop POI the player must keep alive.

## Faction tier (Phase 6.4)

At sufficient size — multiple colonies, multi-ship fleet, accumulated
faction rep with the canon factions — the player-faction acquires its
own **faction reputation slot**, parallel to Federation / Zeon / AE.
Other faction NPCs respond to the player as a faction leader, not a
private citizen.

Mechanically this opens:

- **Recruitment scale** — hire NPCs en masse via a recruitment officer
  at a colony recruitment post (see Recruitment, above, and
  [diegetic-management.md](diegetic-management.md#recruitment-scale-via-diegetic-delegation)).
- **Governance choices** — set faction-wide policies (taxation,
  alignment, trade priorities) by **calling a council** at the largest
  owned colony. Senior officers and colony administrators attend in
  person and argue from their personas; the player resolves the room
  by speaking. See [diegetic-management.md](diegetic-management.md#governance-is-a-council-not-a-menu).
- **Diplomacy** — formal relationships with other factions: nonaggression,
  trade agreements, mutual defense. Pre-war: low stakes, mostly
  flavor. Post-war: real consequences (treaties trigger faction wars).
  Diplomacy verbs surface as council scenes alongside governance.
- **Faction-leader perks** — ambition perks unlock at this tier (see
  [ambitions.md](ambitions.md)) that affect faction-wide stats.

The player-faction is **canonically minor**. UC's named factions
dominate the war; the player-faction is at most a regional power. This
keeps the player from accidentally rewriting Gundam canon — the war
still goes the way the war goes; the player's faction has agency *within*
that, not over it.

## Recruitment

NPC recruitment scales across phases, but every tier routes through
embodied verbs — see [diegetic-management.md](diegetic-management.md#recruitment-scale-via-diegetic-delegation)
for the surface details:

- **Phase 6.0–6.1** — recruit named NPCs from city relationships one by
  one via talk-verb interactions. Loyalty is per-NPC, built through prior
  friendship or paid for via signing bonus.
- **Phase 6.2–6.3** — recruit from the broader city population (named +
  procedural). The talk-verb hire path scales by being available on more
  NPCs, not by acquiring a filter UI.
- **Phase 6.4+** — the player hires a **recruitment officer** at a
  colony recruitment post. The player sets criteria *as a conversation*
  with that officer; applicants then walk up to the post over game-time
  and the player can inspect / approve / reject, or trust the officer's
  Leadership skill to do it for them. There is no filter dialog that
  spawns a list of names; there is a booth, an officer, and a queue of
  bodies.

The Phase 5 talk-verb opinion system feeds directly into early
recruitment quality. NPCs with high opinion of the player accept lower
signing bonuses and are more loyal under stress (less likely to
defect / mutiny / desert).

## Witness-mode parity

A player who never engages with this layer (`lazlos_owner`, `dropout`,
civilian `earth_migration`, AE-only `ae_chief_engineer`) sees the
faction-management layer in only two ways:

- **Newsfeed mentions** — if a player-faction grew large enough on a
  past run, news entries reference that history (lore continuity flavor)
- **As NPCs** — other player-tier-equivalent NPCs (small mercenary
  factions in canon, like the Kojima Battalion or the Junk Guild) exist
  in the world whether the player engages with them or not. They appear
  as faction tags on encounter NPCs.

The Witness player loses **nothing** by not engaging with this layer.
The unified Ambition Points + perks system from
[ambitions.md](ambitions.md) ensures small-scale ambitions (running
the bar, surviving the war as a civilian) award equivalent
mechanical reward to large-scale ones. Scale of *narrative* differs;
scale of *mechanical reward* does not.

## Phasing

| Phase | Scope |
|---|---|
| **6.0** | Player buys first ship. Single-ship pre-war merc work. Crew recruited one by one from city relationships. |
| **6.1** | Bridge ↔ hangar walk; MS pilot mode. |
| **6.2** | Multi-ship fleet MVP (ships only, no retrofit). Ship-template/instance split. Per-ship + crew supply economics (Starsector model). Two more ship classes (escort + small freighter). Captain assignment + fleet orders in tactical. Persistent fleet damage. Debug "grant fleet" populates a 2-ship fleet + ~30 hired NPCs for testing. See [../fleet.md](../fleet.md). |
| **6.2.5** | MS + pilot + retrofit layer in fleet (per-MS supply, hangar UI, pilot roster, MS retrofit panel). The customization-depth phase. |
| **6.2.7** | CP / DP wired into tactical combat. |
| **6.3** | Colony establishment (claim or build). Walkable colony scenes. Industrial facility pool, including colony-only classes (warship slipway, large MS factory). Colony stability + threats. Pirate raids. |
| **6.4** | Faction-tier features: faction reputation slot, recruitment scale, governance choices, diplomacy, faction-leader perks. |
| **7.0+** | Hostile faction expeditions vs player colonies. Wartime recruitment shifts. Player-faction can ally with / against canon factions. |

## Related

- [diegetic-management.md](diegetic-management.md) — surface-design discipline: physical hubs, comm panel, council chamber, recruitment post; how every verb in this file is presented to the player
- [../combat.md](../combat.md) — Starsector tactical layer where fleets fight; current-ship walkability
- [../starmap.md](../starmap.md) — campaign map where colonies persist as POIs
- [ambitions.md](ambitions.md) — fleet/colony/faction-tier ambitions feed AP; perk catalog
- [relationships.md](relationships.md) — recruitment quality scales with prior NPC opinion
- [../npc-ai.md](../npc-ai.md) — subordinate NPCs reuse player-as-NPC architecture; player authors their drive weights
- [../characters/skills.md](../characters/skills.md) — Ship Command + Tactics feed CP cap and doctrine effectiveness; Leadership gates colony administrative load; `piloting` (existing unified skill) gates MS pilot quality
- [../fleet.md](../fleet.md) — fleet roster, MS + pilot layer, supply / CP / DP economics, debug "grant fleet"
- [../worldgen.md](../worldgen.md) — colony interiors reuse city procgen with industrial facility pool
- [facilities-and-ownership.md](facilities-and-ownership.md) — Phase 5.5 civilian prelude that introduces the Faction abstraction, Owner = Character | Faction model, daily payroll/maintenance, and the realtor / HR-office / faction-office surfaces this file's Phase 6 ladder builds on
- [../phasing.md](../phasing.md) — Phase 6 sub-phasing
