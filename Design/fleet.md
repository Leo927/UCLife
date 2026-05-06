# Fleet management

*The roster of ships ranged around the player's flagship, the captains
who command them, and the screens through which the player sees them.
Phase 6.1.5 (structural prep) → Phase 6.2 (MVP) → Phase 6.2.5+ (promote-to-flagship).*

## Why this file exists

[starmap.md](starmap.md) and [combat.md](combat.md) reference Phase 6.2
"multi-ship fleet" as a placeholder. That placeholder hides several
load-bearing decisions — singleton-`Ship` → plural, where escorts live
in the world graph, what player-facing surfaces exist, what to copy
from Starsector and what to drop. This file fixes those before any
6.1.5 code lands.

## The pitch

Fleet in UC Life Sim is **the small, named crew of ships ranged around
your flagship like extended family**. Where Starsector's fleet is a
*loadout*, UC's fleet is *consequence* — the residue of social,
financial, and ambition choices made over years of city life. You don't
optimize a fleet; you grow attached to one and dread losing it, because
every escort has a captain whose name you know, hired from the same NPC
pool you've drunk with at Lazlo's.

That framing kills 60% of Starsector's fleet UI before we start.

## Copy from Starsector vs. drop

UC is a life sim with a fleet-shaped payoff for one career track. It is
not a fleet-builder game. Copy the ~70% of Starsector's fleet system
that delivers player-experience value; drop the 30% that exists because
Starsector's *game* is shipfitting at scale.

**Copy** (load-bearing for the life-sim payoff):

- **Officer-as-Character with persistent identity.** Crew = NPCs from
  the existing Character pool, full trait set. Loss matters because the
  captain you lost is the one you drank with. Do not invent a lighter
  shape.
- **Persistent damage between encounters; repair at safe POIs.**
  Already locked in [combat.md](combat.md). Drives the limp-home loop.
- **Mothballing.** One boolean. Lets the player keep their first
  freighter for sentimental reasons without paying the supply drain.
- **Permanent ship loss.** Replacement via recruitment + procurement,
  not story event. Already locked.
- **Doctrine sliders, lite.** Per-escort `aggression` (cautious /
  steady / aggressive). One dropdown replaces the AI commander tab.

**Drop or radically simplify:**

- **Refit / OP budget screen.** The most beloved part of Starsector to
  a Starsector player. Not load-bearing here. Ships ship with their
  `defaultWeapons`; weapons swap 1:1 at a friendly station, no OP math.
  The interesting choice is "buy the destroyer or hire a third escort,"
  not "underfit my flux to fit one more medium."
- **Command points.** UC pacing target is small; CP exists to throttle
  micro on 30-ship battles we will not have.
- **Deployment points in tactical.** Same reason — the fleet is small
  enough by skill-gate that you deploy everything you have.
- **Per-ship supply consumption.** Roll up into one aggregate
  `MaintenanceLoad` (already sketched in `src/ecs/traits/ship.ts`) that
  scales the existing flagship `supplyDrainPerHour`. Don't itemize.
- **Sensor strength by composition.** Defer to the sensors phase
  ([starmap.md](starmap.md) Phase 6.1) and only ship if the player can
  see the consequence.
- **Mules / freighters as a class.** Drop entirely. UC's economy is
  centered on the flagship's hold; spreading cargo across the fleet is
  bookkeeping with no tradeoff worth feeling.
- **Salvage ship recovery from wrecks.** Drop in 6.2; revisit at 6.3
  when colonies create salvage demand.
- **Officer skill trees.** Officers are characters; characters already
  have skill XP. A second progression layer would fragment the system.

## Player-facing surfaces

Three views, total. Each answers exactly one question.

| Screen | Question | Verb |
|---|---|---|
| **Fleet roster modal** (open from bridge or starmap HUD) | What ships do I have, who's on each, what's their state? | View / mothball / scrap / promote-to-flagship |
| **Officer dialog** (reuses existing NPC dialog) | Who is this person? | Hire / fire / reassign / talk |
| **In-flight fleet panel** (sliver in starmap HUD) | Where is my fleet right now? | Read-only awareness |

No refit screen. No standalone hire screen. Hiring an officer is a
dialogue branch on the existing NPC dialog when the character qualifies
(right skills, available, willing). Buying a ship is a dialogue branch
at AE / merc-broker NPCs at relevant POIs — same shape as the Phase 6.0
capstone purchase.

The cargo screen already exists implicitly via the flagship hold. Don't
add a fleet-wide cargo screen; there is no fleet cargo.

## Structural data shape

**Singleton-`Ship` → multi-ship.** Two-tier; do not give every escort
its own koota world.

- **Flagship** keeps the current architecture: one scene world
  (`playerShipInterior`), `Ship` trait, walkable, full room/door
  layout. The `Ship` singleton persists, but it is no longer "the only
  ship" — it is "the walkable one." Add an `IsFlagship` marker tag.
- **Escorts** live as entities in the **`spaceCampaign` world**
  alongside the flagship's body. New `EscortShip` trait carries the
  same Starsector-shape stat block as `Ship` (hull / armor / flux / topSpeed
  / maneuverability / aggression doctrine) but no `roomLayout`, no
  scene world. They tick in the campaign world like enemy ships do.
  During tactical, they project into the tactical arena via the same
  path enemies already use.

**Mothballed ships** = `mothballed: boolean` on the `EscortShip`
entity. They don't tick supply drain, don't appear on the campaign map,
don't deploy. They're entities that exist but sleep. No separate "ship
inventory hold" object — that's gold-plating.

**Officers** are full Character entities. Each escort has an
`assignedCaptainId: EntityKey` pointing into the existing character
pool. Save round-trip is already solved by EntityKey.

**Escort movement in flight** is station-keeping to flagship at fixed
formation offsets — `formationSlot: int`, computed positions per tick:
`pos = flagshipPos + slotOffset`. There is exactly one `Course` in the
campaign world: the flagship's. Escorts do not have independent
autopilot. This is cheap and adequate; real escort AI only kicks in
during tactical, where the player is paused most of the time anyway.

**Promote-to-flagship** is the load-bearing question. The walkable
scene is bound to whichever entity has the `IsFlagship` tag, not to a
fixed scene id. On promote: the old flagship's scene world serializes
into a "stored" blob attached to the demoted entity, the new flagship's
stored blob (or a fresh-from-class blob if first promote) hydrates into
a scene at `playerShipInterior`, the player teleports to the new
bridge. Expensive but rare ([combat.md](combat.md) calls it
"story-rare"). Defer the implementation to **6.2.5**; the 6.2 MVP says
"your starter freighter is your flagship forever."

## Skill-gated capacity formula

[combat.md](combat.md) commits to "linear-with-skill, no soft cap, no
hard cap." Concrete formula:

```
fleetCapacity =
  floor(
    shipCommandLevel / 20            // player Ship Command, 0..5
    + tacticsLevel / 30              // player Tactics, 0..3.3
    + leadershipLevel / 40           // player Leadership, 0..2.5
    + officerCommandBonus            // each officer SC≥40 → +0.5; SC≥80 → +1
  )
  + 1                                 // flagship is always free
```

Sanity table:

| Player skills | Officers | Capacity |
|---|---|---|
| 0 / 0 / 0 | 0 | 1 (flagship only — matches 6.0/6.1) |
| SC 40 / Tac 30 / Lead 20 | 0 | 4 (frigate + two destroyers feel) |
| SC 80 / Tac 60 / Lead 60 | 2 trained | ~10 (squadron endgame) |
| SC 100 / Tac 100 / Lead 100 | 4 trained | ~14 |

**Why no soft cap:** the **writing budget is the natural cap**. Each
escort needs a named captain, a hire dialogue, a loss event flavored by
backstory. ~10 escorts is the ceiling content can sustain. The formula
doesn't have to enforce a number that the content already enforces.

## Phasing

Three slices. The first one ships before Phase 6.2 even starts.

| Phase | Scope |
|---|---|
| **6.1.5** | **Singleton-to-plural structural prep, no player-visible content.** Split `Ship` into flagship-singleton block + `IsFlagship` marker + new `EscortShip` trait with the same combat stat block. Rename `getPlayerShipEntity` → `getFlagshipEntity`; add `getFleetEntities`. Save handler in `saveHandlers/` for fleet roster (escort entities + captain refs). No fleet UI. No second ship. The point is that adding ships later doesn't require a refactor. |
| **6.2** | **Fleet MVP.** Two new ship classes in `ships.json5` (one frigate, one destroyer) → three classes total. Fleet roster screen. Hire-officer branch on existing NPC dialog when a Character has `shipCommand ≥ 30`. Buy-ship branch at AE broker / merc-broker NPCs at Von Braun, Granada, Side 3. Capacity formula gates "you may hire a third ship." Escorts deploy in tactical, accept doctrine slider. Mothballing. Persistent fleet damage between encounters. Promote-to-flagship explicitly **deferred**. |
| **6.2.5** | Promote-to-flagship: scene-world serialize/rehydrate, walkable-scene swap. Story-rare flagship change. |

## Top three risks

1. **Save schema migration when singleton becomes plural.** `Ship` is
   currently a flat singleton serialized once; going plural means an
   array of escort entities each with their own state, plus a
   captain-EntityKey reference per escort. Pre-6.2 saves must
   round-trip cleanly. **Mitigation:** treat 6.1.5 as a
   structural-only migration with explicit save handler, ship it
   *before* any new gameplay lands. Don't bundle migration with new
   content.

2. **Off-helm autopilot interactions across N ships.** Naive N-body
   formation flocking is a perf trap. **Mitigation:** escorts don't
   have independent `Course` traits; they station-keep to flagship at
   fixed `formationSlot` offsets. One Course in the world per fleet,
   computed positions per tick. Real escort AI only activates in
   tactical mode.

3. **Writing burden of N named captains.** This is the pitch's biggest
   exposure. If captains feel generic, the emotional payoff collapses
   and we're left with Starsector-without-the-fleet-fantasy.
   **Mitigation:** small named-captain pool (5–10 hand-authored,
   hireable at specific narrative moments) plus procedural fillers
   from existing `nameGen` / `appearanceGen`. Loss events reuse the
   existing physiology/death pipeline. Don't write per-captain
   dialogue trees; reuse the NPC dialog framework with captain-aware
   lines gated by backstory tags.

## What this is NOT

- **Not a fleet-builder game.** UC is a life sim with a fleet-shaped
  payoff for one career track.
- **Not a refit / OP-budget system.** No flux math at fitting time. The
  decision space is "hire a better captain / buy a better ship," not
  "underfit my flux."
- **Not per-escort independent autopilot.** Station-keeping only.
- **Not freighter / mule logistics.** One cargo pool: the flagship's.
- **Not officer skill trees.** Officers are characters with the
  existing skill XP system.
- **Not a salvage / wreck-recovery economy.** Defer until colonies
  create salvage demand (Phase 6.3+).
- **Not unlimited fleet through min-maxing.** Capacity is uncapped by
  formula, but capped by the writing budget at ~10 escorts.

## Related

- [starmap.md](starmap.md) — campaign map; escorts live in the
  `spaceCampaign` world alongside the flagship
- [combat.md](combat.md) — locks the no-hard-cap, walkable-flagship,
  permanent-loss commitments this file resolves into a formula and
  data shape
- [characters/skills.md](characters/skills.md) — Ship Command /
  Tactics / Leadership are the gating skills
- [characters/index.md](characters/index.md) — captains are full
  Character entities, including death pipeline
- [social/faction-management.md](social/faction-management.md) —
  Phase 6.3+ colony layer interacts with fleet (player-faction
  colonies become target-eligible)
- [phasing.md](phasing.md) — Phase 6 phasing
- `src/ecs/traits/ship.ts` — `Ship` singleton today; gains
  `IsFlagship` marker + `EscortShip` trait at 6.1.5
- `src/sim/ship.ts` — singleton helpers (`getPlayerShipEntity`)
  rename to flagship helpers + add `getFleetEntities`
- `src/data/ships.json5` — one class today; three at 6.2 MVP
