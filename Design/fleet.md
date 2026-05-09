# Fleet management

*The roster of ships, MS, pilots, and crew the player operates in UC space. Phase 6.1.5 (structural prep) → Phase 6.2 (fleet + crew MVP, ships only) → Phase 6.2.5 (MS + pilot + retrofit, the customization-depth phase) → Phase 6.2.7 (CP/DP).*

## Why this file exists

[starmap.md](starmap.md) and [combat.md](combat.md) reference Phase 6.2 "multi-ship fleet" as a placeholder. That placeholder hides a stack of load-bearing decisions — singleton-`Ship` → plural, ship-template authoring vs. runtime-instance state, where MS and pilots fit, how supply / command / deployment economics gate fleet size, what player-facing surfaces exist, what to copy from Starsector and what UC-universe constraints add on top.

## The pitch

**MS is the primary combat platform; ships are operational sideline content.** The depth the player tinkers with — loadouts, retrofits, frame upgrades, pilot pairings — lives one layer down on the MS. Ships are the platforms that move MS to the fight, survive long enough to recover them, and provide a walkable home. **There is no ship retrofit system.** Ships ship with their authored loadout and that is what they fight with for their entire service life.

UC Life is **not flagship-centric.** The fleet is your operational force — capital ships that move and fight, MS units that do the actual fighting, and the crew (captains, pilots, NPCs aboard) who fill them. The flagship is merely whichever ship the player is currently *on*; nothing about that ship is mechanically special.

Fleet management depth is **operational, not customizational**. The suppressors that prevent "biggest possible fleet without paying for it":

1. **Per-ship supply consumption** (Starsector model). Each class declares a fixed supply cost. Each MS in a hangar adds supply cost. Each MS in repair adds further supply cost. You don't grow a fleet without growing the economic engine to feed it.
2. **Command points.** Minovsky particle scatter makes long-range comms unreliable in UC, so coordinating a large fleet costs command bandwidth. CP gates fleet-wide actions per engagement.
3. **Deployment points.** A 30-ship fleet doesn't fight as a 30-ship blob — you commit a subset to each engagement, capped by player skill + flagship comm suite.

Sensors are **dropped entirely** — sensors don't work reliably in the UC universe by lore. The fleet doesn't have a "sensor strength" stat.

## Copy from Starsector vs. drop / replace

**Copy:**

- **Per-ship supply consumption.** Each ship class declares `supplyPerDay`. MS in hangar add per-MS cost. Damaged MS in repair add further per-MS-day cost while repairing. This is the economic suppressor — aggregate computed across the whole fleet, not rolled into one flagship multiplier.
- **Command points** at fleet level. UC justification: Minovsky comms.
- **Deployment points** in tactical engagements. Fleet size and combat scale decouple.
- **Officer-as-Character with persistent identity.** Captains and pilots are NPCs from the existing Character pool, full trait set. Loss matters because you knew them.
- **Persistent damage between encounters; repair at safe POIs.** Already locked in [combat.md](combat.md). Drives the limp-home loop.
- **Mothballing.** One boolean per ship. Mothballed ships don't drain supply, don't deploy, don't appear in tactical.
- **Permanent ship loss.** Replacement via hire + procurement, not story event.
- **Doctrine sliders, lite.** Per-ship `aggression` (cautious / steady / aggressive).
- **Mules and freighters as ship classes.** Cargo, fuel, and supply storage spread across the fleet, not stuffed into the flagship.
- **Refit / OP budget screen — but at the MS layer, not the ship layer.** MS is the customization platform; see [MS retrofit](#ms-retrofit--the-customization-platform) below. Ships do not refit.

**Drop or replace:**

- **Ship refit.** No ship loadout customization at any tier. A ship's mounts are part of the class template; what you buy is what you fight with. The interesting fleet-tier choice is "hire a third escort vs. buy a destroyer," not "underfit my flux." Customization energy goes into MS, where it belongs.
- **Sensor strength by composition.** Sensors don't work in UC. Cut entirely.
- **Salvage ship recovery from wrecks.** Defer to Phase 6.3+ when colonies create salvage demand.
- **Officer skill trees.** Officers and pilots are Characters; characters already have skill XP. No second progression layer.
- **Hard fleet-size cap by formula.** Ship count is gated by economics + command bandwidth, not by a player-skill formula. (CP and DP throughput, which gate per-engagement combat scale, *are* skill-gated — see below.)

## Data model — template / instance split

Ships and MS follow the same authoring pattern: **template lives in data; instance lives in ECS**. The asymmetry between the two is deliberate — ships are mostly template (fixed loadout); MS carry a real per-instance customization layer.

### Ship template

`src/data/ship-classes.json5`. One row per class. Pure authoring content; immutable at runtime. **Ship mounts are part of the template, not a swappable runtime field** — the player does not retrofit ships.

```js
{
  id: 'salamis-kai',
  name: 'Salamis Kai',
  hullClass: 'cruiser',         // frigate | destroyer | cruiser | battleship | mule | freighter
  hullPoints: 4800,
  armorPoints: 600,
  topSpeed: 90,
  maneuverability: 0.6,
  supplyPerDay: 8,              // fixed class cost (Starsector model)
  supplyStorage: 600,           // how much supply this hull can carry
  fuelStorage: 240,
  cargoCapacity: 0,             // mules / freighters are where cargo lives
  hangarCapacity: 4,            // # of MS slots
  mounts: [                     // hardpoints + the weapon at each — fixed at template
    { id: 'fwd-l1', position: { x: 0, y: 12 }, weapon: 'mega-particle-cannon' },
    { id: 'fwd-l2', position: { x: 0, y: -12 }, weapon: 'mega-particle-cannon' },
    // ...
  ],
  crewRequired: 220,
  bridge: 'standard',           // hooks the walkable interior layout
  dpCost: 6,                    // tactical deployment-points cost
}
```

Mount `position` + `weapon` lets the renderer and combat layer compute turret arcs and visual mount slots without per-class hand-coding. There is no runtime mount-state on ships — what's authored is what fights. If a ship class needs a different loadout for a different role, that's a *new ship class* (e.g. `salamis-kai-escort` vs. `salamis-kai-fire-support`), not a retrofit.

### Ship runtime instance

ECS entity in the campaign world. Carries only state that changes:

- `templateId: string` — looks up the immutable template
- `currentHull / currentArmor`
- `combatReadiness` — Starsector CR; degrades with deployment, restored at safe POI
- `currentSupply / currentFuel / currentCargo`
- `hangarUnits: Array<msInstanceId>`
- `assignedCaptainId: EntityKey | null`
- `crewIds: Array<EntityKey>` — NPC characters aboard, beyond the captain
- `mothballed: boolean`
- `aggression: 'cautious' | 'steady' | 'aggressive'`
- `formationSlot: int` — formation position in fleet
- `IsFlagshipMark` — present iff the player is currently aboard

Conspicuous by absence: no `mountedTurrets`. Ships do not have per-instance loadout state.

### MS template

`src/data/ms-classes.json5`. Same template pattern, but MS carry a **per-instance retrofit layer** on top — see [MS retrofit](#ms-retrofit--the-customization-platform) below. The `defaultLoadout` on the template is the kit the MS rolls off the line with; the player swaps from there.

```js
{
  id: 'gm-cannon',
  name: 'GM Cannon',
  frameClass: 'mid-range-fire-support',
  hullPoints: 800,
  armorPoints: 120,
  topSpeed: 140,
  hardpoints: [
    { id: 'shoulder-cannon', type: 'medium-beam' },
    { id: 'rh', type: 'small-arms' },
    { id: 'lh', type: 'small-arms' },
    { id: 'back-stowage', type: 'medium-stowage' },
  ],
  defaultLoadout: { 'shoulder-cannon': '240mm-cannon', 'rh': 'beam-rifle', /* ... */ },
  supplyPerDay: 0.4,            // per-unit hangar cost
  supplyPerRepairDay: 1.5,      // additional cost while in-repair
  dpCost: 1,
}
```

Mount `type` vocabulary (`large-beam`, `medium-missile`, `small-arms`, `medium-stowage`, …) gates compatibility — a `medium-beam` hardpoint takes any weapon tagged `medium-beam`.

### MS runtime instance

ECS entity. Lives in a ship's `hangarUnits`. State that changes:

- `templateId: string`
- `currentHull / currentArmor`
- `pilotId: EntityKey | null` — NPC character
- `assignedShipId: EntityKey` — back-pointer to the ship whose hangar holds this unit
- `mountedWeapons: Record<hardpointId, weaponInstanceId>` — **the retrofit field; player-mutable at hangar**
- `frameMods: Array<frameModId>` — bolt-on frame upgrades (armor plating, thruster packs, sensor pods); player-installable at hangar (Phase 6.2.5+)
- `damageState: 'ready' | 'damaged' | 'destroyed' | 'in-repair'`
- `repairProgress: 0..1` — when in-repair

### MS weapons and frame mods

`src/data/ms-weapons.json5` and `src/data/ms-frame-mods.json5`. Templates only; runtime ownership and per-MS install state live on the instance. **There is no `turrets.json5`** — ship mounts are authored inline in the ship class, not from a swappable parts catalog.

Weapons and frame mods swap at any friendly hangar (your flagship's hangar counts if docked at a station with maintenance crew, or at any colony you own). No OP/flux math; compatibility is purely by mount type. This is the customization surface the player tinkers with — and the only one in the fleet layer.

## MS retrofit — the customization platform

This is where fleet depth lives for the player. Ships are operational; **MS is where the player tunes their force**.

The hangar-side retrofit screen (Phase 6.2.5) lets the player, per MS:

- **Swap weapons** at any compatible hardpoint, drawing from the player's MS-weapons inventory
- **Install frame mods** (armor plating, sub-thruster packs, sensor pods, EWAR suites) — bolt-on items that consume frame slots
- **Reassign pilot** to / from this MS
- **Set role tags** for AI behavior (skirmisher, fire support, anti-MS, anti-ship) — feeds the MS's tactical-AI heuristics when not personally piloted
- **Move between hangars** — assign this MS to a different ship in the fleet

The retrofit screen is the player's primary post-procurement customization activity. It's where the GM Cannon you bought last week becomes "the GM Cannon **with the long-range scope and the spare beam saber my friend the engineer modded for free,**" and that distinction matters in the next engagement.

Retrofit is **non-modal in time** — it's an action at the hangar, not a separate game mode. The player walks to the hangar, opens the retrofit panel for one MS, makes changes, walks out. Hangar work happens in real game-time; busy hangar crew accelerate it (Mechanics-skilled NPCs in the hangar shave time off retrofit / repair).

What retrofit explicitly does **not** include:
- **Frame swap** — the GM Cannon does not become a Zaku II by retrofit. New frame = buy a new MS.
- **Stat-block tuning** — base hull/armor/speed are fixed by the frame; mods add on rather than replace.
- **OP / flux budgeting** — there is no fitting points system. Frame slots are integer-counted; either it fits or it doesn't.

Custom-tuned MS are a real progression artifact: a player who carefully built a kitted-out Gundam over a campaign feels it the moment they lose it. Retrofit makes loss meaningful.

## Supply / command / deployment economics

### Supply

Aggregate per day:

```
fleetSupplyPerDay =
    sum(ship.template.supplyPerDay for each non-mothballed ship)
  + sum(ms.template.supplyPerDay for each MS in any non-mothballed hangar)
  + sum(ms.template.supplyPerRepairDay for each MS currently in-repair)
  + crewUpkeepPerDay
```

This is the number the campaign HUD reads. (`starmap.md`'s continuous fuel/supply economy section is aligned to this formula — supply storage and drain are per-ship, not rolled up onto the flagship.)

Supply is **stored across the fleet** in each ship's `currentSupply`, capped by the ship's class `supplyStorage`. Auto-pooled at a friendly station / when reorganizing, but during a deployment you can run out on one ship while another has slack. Same goes for fuel and cargo.

### Command points

Pool refilled per engagement (and partially per day in campaign). CP source:

```
maxCommandPoints =
    base                              // 4
  + player.shipCommand / 25
  + player.tactics / 30
  + flagshipCommOfficer.command / 30
  + commArrayShipCount * 1            // dedicated comm-relay ships, later phase
```

CP is *spent* by fleet-wide commands during tactical (rally to point, focus fire, retreat order, formation change, MS launch authorization). Out of CP, the fleet acts on standing doctrine sliders only. This is the player-skill-gated comm bandwidth, justified diegetically by Minovsky particle scatter.

### Deployment points

DP is a per-engagement budget. Each ship class has `dpCost`; each MS has `dpCost`. The player commits ships + MS up to DP cap. DP cap is a function of player skills + flagship comm suite. **This decouples fleet size from tactical complexity** — a 20-ship fleet might field 8 ships in any one engagement, with the rest holding station, refitting, or guarding cargo.

(Concrete CP/DP numbers TBD; the framework is what 6.2 needs to land.)

## Player-facing surfaces

The table below describes the **data projections** the fleet system needs to expose. The *primary* verb model — where in the world the player physically stands and who they speak to — is in [social/diegetic-management.md](social/diegetic-management.md). Read that first; the panels below are read-mostly notebooks that pop open from the bridge for at-a-glance status, not the way the player issues writes. Roster cells route writes through the diegetic surface (walk to the captain, or click their face on the comm panel).

UI scope is broader than the previous draft because MS + pilot + retrofit management is core UC content. Note the asymmetry: ships have *one* management surface (the roster); MS have *three* (bay, pilot roster, retrofit) — that asymmetry is the design.

| Screen | Question | Verb |
|---|---|---|
| **Fleet roster** | What ships do I have, who's on each, what's their state? | View / mothball / scrap / set-doctrine / assign-captain (switching flagship is physical transit, not a roster verb — see below) |
| **MS bay** (per-ship tab + fleet-wide tab) | Which MS are in this hangar, who's piloting, repair state? | Reassign-MS-to-hangar / assign-pilot / scrap-MS / repair-priority |
| **MS retrofit panel** (per MS, opened from MS bay) | What's this MS carrying; what frame mods are installed? | Swap-weapon / install-mod / uninstall-mod / set-role-tags |
| **Pilot roster** | Who can pilot, who's assigned to which MS, who's idle? | Assign / reassign |
| **Crew assignment** | Which NPCs are aboard which ships? | Move / hire / fire |
| **Officer dialog** (existing NPC dialog) | Who is this person? | Hire-as-captain / hire-as-pilot / hire-as-crew / fire / talk |
| **Buy/sell-ship dialog** (broker NPCs) | What ship hulls are available where; what will the broker pay for one of mine? | Purchase / sell — sell requires the ship be vacant of the player |
| **Buy-MS dialog** (broker NPCs at MS-trading POIs) | What MS frames + parts are available? | Purchase frame / purchase weapon / purchase mod |
| **Fleet HUD sliver** in starmap | What's my fleet doing right now? | Read-only awareness |

There is **no ship retrofit panel**, anywhere. A buy-ship dialog produces a ship instance with the class's authored loadout; that's the fight-state for the rest of that ship's service life.

Cargo: there is no flagship-only cargo screen. Cargo lives across the fleet (especially mules / freighters); the fleet roster expands per-ship cargo views, and an aggregate "what the fleet is carrying" tab rolls them up.

## Flagship — definitionally minimal

The flagship is **the ship the player is currently crewing.** It gets:

- The walkable interior scene (existing scene-world infra, hydrated from the ship class's `bridge` template).
- An `IsFlagshipMark` tag for fast lookup.

That is the entire mechanical specialness. No promote-to-flagship ceremony, no story-rare gating. Switching flagship is **physical transit** between two of your ships, not a roster verb — the `IsFlagshipMark` follows the player's body.

**Where the rest of the fleet sits when the flagship lands.** Capital ships do not all dock at a civilian surface dome. When the flagship descends to a surface POI (Von Braun, Lisbon, Granada, Jaburo), the rest of the fleet holds station in **local orbit** — lunar orbit for Moon POIs, low Earth orbit for Earth POIs. Individual surface take-off fuel costs (12 for the Moon, 80 for Earth — see [starmap.md](starmap.md)) are paid per-ship, so it's economically nonsensical to land escorts you don't need to walk onto. At Side colonies, asteroid bases, and Luna II — proper space facilities with multi-ship berthing — the whole fleet (or as much of it as fits) can dock side-by-side at the station.

Two transit shapes therefore exist:

1. **At a multi-berth station** — walk a concourse or umbilical between two of your ships docked at adjacent berths.
2. **In formation in deep space** — shuttle hop (small-craft transit) between fleet ships flying together. Canonical UC pattern.

**There is no third shape on the ground.** When the flagship is at Von Braun, the only ship the player can walk onto is the flagship. Switching flagship while groundside therefore demands lifting off first, paying the current flagship's surface take-off fuel and rendezvousing with the fleet in orbit. That friction is intentional — flagship is the player's diegetic self, swapping it should not be a free menu act.

**Selling the ship-the-player-is-on is forbidden.** The broker at the port handles paperwork freely for any non-flagship ship in the fleet — it's a transaction, not a physical handover; the orbital crew is notified via comm and the ship is decommissioned in place. But a vessel with the captain still aboard cannot be sold. To sell your *current* flagship, transit to another of your own ships and then close the sale (which from the surface means lifting off first, per the orbital model above); or — if it is your last hull — disembark to the city dock and the broker treats the sale as **fleet termination**: the bridge scene goes dark, the comm panel with it, and hired captains / pilots / crew route through a paid-out-or-disbanded branch back into civilian life. This mirrors the realty office's rule for selling a residence the player still occupies, and makes the inverse of the acquisition arc carry the same diegetic weight as acquisition itself.

The walkable scene is hydrated lazily per ship: when the player boards, the scene hydrates from the ship-class template + the instance's stored interior blob (where the player left a coffee mug); when the player leaves, it serializes back. Per-ship interior content is **authored per class, not per instance** — five ship classes = five interior templates regardless of fleet size.

## Auto-assignment

Where the system can pick a sensible default, it does. Player can always override.

- **MS pilot.** When an MS arrives at a hangar without a pilot, auto-assign the highest-`piloting` idle pilot in the fleet's pilot pool. (`piloting` is the unified skill across mobile workers, spacecraft, and mobile suits — see [characters/skills.md](characters/skills.md).) When a pilot dies, the MS is unpiloted (not auto-reassigned — that's the player's call).
- **Ship captain.** Same shape: highest-Ship-Command idle officer.
- **Hangar slot.** When a new MS is added to the fleet, place it in the first ship with an open hangar slot.
- **Crew.** Crew gap on a ship = auto-pull from idle hireable pool to fill `crewRequired - currentCrew`.

Every auto-assignment is overridable from the relevant screen.

## Debug "grant fleet" function

Phase 6.2 debug action. Single click does all of the following:

1. Ensure the player has a flagship (existing behavior).
2. Add a **second ship** to the player's fleet (a small escort or freighter). Auto-place in formation.
3. Generate a sizable batch of NPCs (~30; concrete number TBD) via `nameGen` / `appearanceGen` — covering captain-grade, pilot-grade, and general-crew shapes — and mark all of them as **hired by the player**. Distribute them across the two ships per auto-assignment rules.
4. Stock the second ship's hangar with a couple of MS instances and auto-assign pilots from the new hire pool.

This is what makes the system testable end-to-end without grinding hire dialogs. Faction-management's hire flow ([social/faction-management.md](social/faction-management.md)) defines the proper hire path; this debug action short-circuits it for testing.

## Phasing

| Phase | Scope |
|---|---|
| **6.1.5** | **Structural prep, no player-visible content.** Ship-template/instance split. Move existing flagship class data into `ship-classes.json5`. Singleton-`Ship` → plural with `templateId` lookup. Save handler in `saveHandlers/` for fleet roster. Pre-existing saves migrate to single-ship fleet cleanly. No new gameplay. |
| **6.2** | **Fleet MVP (ships only, no retrofit).** Two more ship classes (one escort, one small freighter). Debug "grant fleet" function (above). Per-ship + crew supply economics (no MS layer yet — flagship's existing hangar stays as-is). Fleet roster + crew assignment screens. Hire-as-captain / hire-as-crew on NPC dialog (stub; full hire flow lives in faction-management). Buy-ship dialog at brokers — purchase delivers a ship with its authored loadout, no fitting screen. Mothballing. Persistent fleet damage between encounters. Doctrine slider per ship. |
| **6.2.5** | **MS + pilot + retrofit layer — the depth phase.** `ms-classes.json5`, `ms-weapons.json5`, `ms-frame-mods.json5`. MS runtime entity with `mountedWeapons` + `frameMods` per-instance state. Hangar UI, pilot roster, pilot assignment. Per-MS supply + per-MS repair-supply economics. MS bay screen. **MS retrofit panel** — weapon swap, mod install, role tags. Buy-MS dialog at MS brokers. Auto-assign + override flow. This phase is where the customization energy that *isn't* going into ships lands. |
| **6.2.7** | **CP + DP.** Command points + deployment points wired into tactical. Doctrine sliders fully active. Out-of-CP standing-orders behavior. |
| **6.3** | Mules / freighters as content (extra classes), salvage from wrecks (MS parts + frame mods only — no ship parts since ships don't refit), multi-ship walkable interior switching (player can move flagship freely between own ships at docked-with-fleet moments). |

Promote-to-flagship as a separate phase is **gone.** Flagship is just "the ship the player is on," routine, not ceremonial.

## Top risks

1. **Save schema migration when singleton becomes plural.** `Ship` is currently a flat singleton; going plural means an array of ship entities each with template/instance state, plus a captain-EntityKey reference per ship and (eventually) MS/pilot back-references. Pre-6.2 saves must round-trip cleanly. **Mitigation:** treat 6.1.5 as a structural-only migration with explicit save handler; ship it before any new gameplay lands. Don't bundle migration with new content.

2. **Per-ship + per-MS supply UI legibility.** A 10-ship fleet × 4 MS each = 50 line items. **Mitigation:** roll up to ship-level totals on the campaign HUD; expand to per-MS only on the MS bay screen.

3. **MS-pilot assignment at scale.** Auto-assign needs to be predictable; manual override needs to be frictionless. **Mitigation:** clear `idle / assigned / damaged / dead` state in the pilot roster; manual override is one click in either the MS bay or pilot roster screen.

4. **Crew NPC count explodes save size.** A 30+ NPC hired roster has ECS + serialization cost; multiply across a fleet that can grow further. **Mitigation:** profile at 6.2 debug-fleet size; if save grows past budget, push hired-NPC representation onto a leaner shape than full Character (TBD; revisit only if measured).

5. **Off-helm autopilot interactions across N ships.** Naive N-body formation flocking is a perf trap. **Mitigation:** non-flagship ships station-keep at fixed `formationSlot` offsets in transit; one Course in the campaign world per fleet, computed positions per tick. Real ship AI activates only in tactical, where active-pause carries the load.

## What this is NOT

- **Not a fleet-builder game.** Fleet exists for the life-sim consequences of building it.
- **Not a ship retrofit system.** Ships ship as authored. Customization lives one layer down on the MS — that is the design's deliberate asymmetry. Want a different ship loadout? Buy a different ship class.
- **Not an OP/flux fitting game even at the MS layer.** MS retrofit is integer-slot bolt-on, not a points budget.
- **Not per-ship independent autopilot.** Station-keeping in transit; tactical-only AI.
- **Not flagship-centric.** The flagship is whichever ship the player is on.
- **Not size-capped by a player-skill formula.** Ship count is capped by economics + command bandwidth. Per-engagement combat scale (CP, DP) stays skill-gated.
- **Not freighter-less.** Mules and freighters are first-class fleet roles.
- **Not officer skill trees.** Officers are characters with the existing skill XP system.
- **Not a salvage / wreck-recovery economy at the ship tier.** MS-side salvage (parts, frame mods) is in scope from Phase 6.3+; ship hulls are not part-swap salvageable since ships don't refit.

## Cross-doc alignment

This iteration aligned the sibling design docs with the new shape — and with the **MS-primary, no-ship-retrofit** call:

- **[combat.md](combat.md)** — "Settled commitments" #2 rewritten as economics-gated, no skill-formula cap; #6 rewritten as "whichever ship the player is on is walkable, switching is routine transit." Open question #3 replaced (CP/DP concrete numbers, not capacity formula). Phase 6.2 row replaced; 6.2.5 (MS+pilot+retrofit) and 6.2.7 (CP/DP) rows added. Fleet-scale section rewritten. Starsector→UC mapping table now flags ship mounts as fixed-at-template and points the customization arrow at MS.
- **[starmap.md](starmap.md)** — Continuous-fuel/supply-economy section replaced; supply is now `sum of per-ship supplyPerDay + sum of per-MS supplyPerDay + sum of per-MS supplyPerRepairDay + crewUpkeep`, storage is per-ship. Phase 6.2 row updated to call out "no ship refit at any tier"; 6.2.5 (MS retrofit at hangars) / 6.2.7 added.
- **[social/faction-management.md](social/faction-management.md)** — "Fleet: skill-gated" section rewritten to economics-gated. Ship classes section now references `ship-classes.json5`, the template/instance split, and explicitly states ships do not refit (customization energy redirected to MS retrofit). Captain section expanded to captain + pilot. Colony scale section reworded to "administrative load" gate so it no longer claims same-pattern-as-fleet. Phase 6.2 row replaced; 6.2.5 / 6.2.7 added.
- **[characters/skills.md](characters/skills.md)** — No structural change needed; the catalog defers Ship Command / Tactics / Leadership to Phase 6+ already. `piloting` (the unified pilot/mobile-suit skill in the catalog) gates MS pilot quality. Mechanics gates MS retrofit speed at hangars.
- **[phasing.md](phasing.md)** — Phase 6.2 row rewritten with "no retrofit" call-out; 6.1.5 / 6.2.5 (MS+pilot+retrofit) / 6.2.7 rows added. Walkability framing softened from "flagship as scene" to "walkable current ship." Colony cap reworded to administrative-load gate.

The proper hire flow (hire-as-captain / hire-as-pilot / hire-as-crew dialog branches) remains owned by faction-management; the debug "grant fleet" function in this doc is a short-circuit for testing.

## Related

- [starmap.md](starmap.md) — campaign map; non-flagship ships live in the `spaceCampaign` world alongside the flagship
- [combat.md](combat.md) — locks the no-hard-cap, walkable-flagship, permanent-loss commitments this file resolves into a data shape; combat.md's Starsector→UC mapping table reflects the MS-primary asymmetry
- [characters/skills.md](characters/skills.md) — Ship Command / Tactics / Leadership feed CP cap and doctrine effectiveness; `piloting` (existing unified skill) gates MS pilot quality
- [characters/index.md](characters/index.md) — captains, pilots, and crew are full Character entities, including death pipeline
- [social/faction-management.md](social/faction-management.md) — full hire flow + Phase 6.3+ colony layer
- [social/diegetic-management.md](social/diegetic-management.md) — physical hubs + comm panel + council pattern that the surfaces above are projections of
- [phasing.md](phasing.md) — Phase 6 phasing
- `src/ecs/traits/ship.ts` — `Ship` singleton today; splits into template-lookup + instance traits at 6.1.5
- `src/sim/ship.ts` — singleton helpers (`getPlayerShipEntity`) rename to flagship helpers + add `getFleetEntities`
- `src/data/ships.json5` — restructure to `ship-classes.json5` at 6.1.5; add `ms-classes.json5`, `ms-weapons.json5`, `ms-frame-mods.json5` at 6.2.5. **No `turrets.json5`** — ship mounts are inline in the ship class.
