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
  hangarCapacity: 4,            // # of MS sortie slots aboard
  hangarDoors: [                // physical launch/recovery ports — see sortie.md
    { id: 'side-port', position: { x:  8, y: 0 }, facing:  90, bayId: 'bay-1' },
    { id: 'side-stbd', position: { x: -8, y: 0 }, facing: -90, bayId: 'bay-2' },
    // door count may be < hangarCapacity → MS share doors and queue
  ],
  mechanicCrewSlots: 12,        // forward-repair crew complement
  onShipRepairCap: 0.8,         // hull/armor ceiling for in-sortie repair
  onShipRepairFloor: 0.4,       // integrity floor — units below this can't be touched aboard
  mounts: [                     // hardpoints + the weapon at each — fixed at template
    { id: 'fwd-l1', position: { x: 0, y: 12 }, weapon: 'mega-particle-cannon' },
    { id: 'fwd-l2', position: { x: 0, y: -12 }, weapon: 'mega-particle-cannon' },
    // ...
  ],
  crewRequired: 220,
  brigCapacity: 4,              // POW slots; 0 for civilian-spec hulls — see post-combat.md
  bridge: 'standard',           // hooks the walkable interior layout (bridge + captain's office room)
  dpCost: 6,                    // tactical deployment-points cost
}
```

Mount `position` + `weapon` lets the renderer and combat layer compute turret arcs and visual mount slots without per-class hand-coding. There is no runtime mount-state on ships — what's authored is what fights. If a ship class needs a different loadout for a different role, that's a *new ship class* (e.g. `salamis-kai-escort` vs. `salamis-kai-fire-support`), not a retrofit.

### Ship runtime instance

ECS entity in the campaign world. Carries only state that changes:

- `templateId: string` — looks up the immutable template
- `currentHull / currentArmor` — projected onto the `ShipStatSheet` as the runtime damage state
- `combatReadiness` — Starsector CR; degrades with deployment, restored at depot
- `currentSupply / currentFuel / currentCargo` — drawn down by daily systems; replenished from the hosting hangar's `supplyStorage` / `fuelStorage`
- `hangarUnits: Array<vehicleInstanceId>` — *sortie-loaded only*; storage lives in the depot hangar
- `assignedCaptainId: EntityKey | null`
- `crewIds: Array<EntityKey>` — NPC characters aboard, beyond the captain
- `homeHangarId: EntityKey` — the hangar slot the ship returns to at rest
- `transitDestinationId / transitArrivalDay` — set when in cross-POI transit; nullable
- `mothballed: boolean`
- `IsInActiveFleet: boolean` — war-room-set; gates auto-launch + formation-keep + DP commit
- `aggression: 'cautious' | 'steady' | 'aggressive'` — combat doctrine; orthogonal to active/reserve
- `formationSlot: int` — only meaningful while `IsInActiveFleet` and not in transit
- `IsFlagshipMark` — present iff the player is currently aboard
- `WasCaptured: boolean` — set true at recovery (see [post-combat.md](post-combat.md)); influences faction relations, ransom/buyback opportunities, and crew loyalty drift on this hull
- `prisoners: Array<EntityKey>` — POWs in the brig; max `brigCapacity`. Surplus routes to less-secure quarters with escape risk (see [post-combat.md](post-combat.md#prisoners))

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
| **Fleet roster** | What ships do I have, where's each housed, who's on each, what's their state (active / reserve / mothballed)? | View / mothball / scrap / set-doctrine / assign-captain (switching flagship is physical transit through the hangar — not a roster verb; *active-fleet selection* is the war-room verb, not a roster cell) |
| **War-room plot table** (flagship bridge) | What ships are in my active fleet right now; what's the formation; what's the route; what's committed for the next engagement? | Drag-token-onto-formation / drag-token-back-to-reserve (sets `IsInActiveFleet`); formation slot arrangement; DP commit; route plan. The single allowed UI-dense surface per [social/diegetic-management.md](social/diegetic-management.md#the-war-room-is-the-one-allowed-abstraction). |
| **Captain's office** (per ship; flagship's also hosts fleet-wide) | Is *this ship* ready to sortie (supply / fuel / crew / MS / pilots)? Who do I want to talk to privately right now? Which prisoners are aboard? | Pre-launch readiness summary read off this ship's state; "**man the rest from idle pool**" delegation to the captain; comm-panel face wall for any first-touched crew member; prisoner verbs (interrogate / ransom / recruit / execute / hand-over / release) from the comm panel. See [social/diegetic-management.md](social/diegetic-management.md#captains-office). |
| **Hangar floor** (per facility, opened from manager talk-verb) | What's in this hangar — units, repair state, units awaiting placement, current daily throughput, **current supply / fuel against storage cap**? | Receive-delivery / repair-priority / scrap / **transfer-unit-to-other-hangar** (paid + delayed) — manager owns these; per-unit verbs route to the unit itself in the bay |
| **On-ship hangar deck** (per ship, opened from ship's hangar boss talk-verb) | Which vehicles are loaded onto *this ship* for the current/next sortie; what's the forward-repair state? | Pull-from-surface-hangar / unload-back-to-surface (loadout); repair-priority / inspect (forward repair, within `[onShipRepairFloor, onShipRepairCap]`); no refit, no assembly, no destroyed→ready — those route to a surface hangar |
| **Vehicle retrofit panel** (per unit, opened by walking up to the unit in the hangar) | What's this fighter / MW / MS carrying; what frame mods are installed? | Swap-weapon / install-mod / uninstall-mod / set-role-tags |
| **Pilot roster** | Who can pilot, who's assigned to which unit, who's idle? | Assign / reassign |
| **Crew assignment** | Which NPCs are aboard which ships? | Move / hire / fire |
| **Officer dialog** (existing NPC dialog) | Who is this person? | Hire-as-captain / hire-as-pilot / hire-as-crew / fire / talk |
| **Buy/sell-ship dialog** (AE sales rep at the spaceport; AE rep at Granada drydock for capital — POC implementation. Long-term: many brokers, rotating + rarity-gated inventories, La Vien Rose lead-time orders.) | What ship hulls are in this broker's current inventory; what will they pay for one of mine? | Purchase (queues delivery to a hangar with capacity) / sell (sell requires the ship be vacant of the player) |
| **Buy-vehicle dialog** (AE fighter / MW broker at the spaceport — POC. MS aren't public in 0077; fighters and mobile workers are the early-game catalog.) | What fighter / mobile-worker frames + parts are available? | Purchase frame / purchase weapon / purchase mod (frames queue delivery against vehicle-slot capacity; weapons / mods route to depot parts inventory) |
| **Supply-dealer dialog** (AE supply dealer at the industrial compound — POC; other industrial compounds host their own dealers later) | What's the price-per-unit of supply and fuel; what's my hangar inventory state? | Order supply / order fuel → confirm target hangar → confirm amount; shipment arrives ~2 in-game days later (configured per route). Secretary's bulk-order verb is the late-game scale shortcut. |
| **Fleet HUD sliver** in starmap | What's my fleet doing right now? | Read-only awareness |

There is **no ship retrofit panel**, anywhere. A buy-ship dialog produces a ship instance with the class's authored loadout; that's the fight-state for the rest of that ship's service life.

Cargo: there is no flagship-only cargo screen. Cargo lives across the fleet (especially mules / freighters); the fleet roster expands per-ship cargo views, and an aggregate "what the fleet is carrying" tab rolls them up.

## Flagship — definitionally minimal

The flagship is **the ship the player is currently crewing.** It gets:

- The walkable interior scene (existing scene-world infra, hydrated from the ship class's `bridge` template).
- An `IsFlagshipMark` tag for fast lookup.

That is the entire mechanical specialness. No promote-to-flagship ceremony, no story-rare gating. Switching flagship is **physical transit** between two of your ships — not a roster verb. The `IsFlagshipMark` follows the player's body. The act of switching is the act of walking back to the hangar where another of your ships sits, walking up its airlock, and entering its interior scene.

**Selling a vessel the captain is still aboard is forbidden.** The hangar manager refuses to process the sale (paperwork is fine; physical handover with the owner inside the ship is not). To sell your *current* flagship, board a different ship in your fleet (walk back to its hangar, enter it) and then close the sale through the broker; or — if it is your last hull — disembark to the hangar floor and the sale is processed as **fleet termination**: the bridge scene goes dark, the comm panel with it, and hired captains / pilots / crew route through a paid-out-or-disbanded branch back into civilian life. Selling a *non-flagship* ship is paperwork-only at the broker — the hangar manager takes possession in place, decommissions, and the slot frees up on the next day's rollover. This mirrors the realty office's rule for selling a residence the player still occupies, and makes the inverse of the acquisition arc carry the same diegetic weight as acquisition itself.

The walkable scene is hydrated lazily per ship: when the player boards, the scene hydrates from the ship-class template + the instance's stored interior blob (where the player left a coffee mug); when the player leaves, it serializes back. Per-ship interior content is **authored per class, not per instance** — five ship classes = five interior templates regardless of fleet size.

## Where the fleet physically lives — hangars, not abstraction

Fleet inventory is **fully diegetic**. Every ship, MS, and MA the player owns sits in a physical **hangar facility** — either player-owned or rented at a state-owned hangar — at a surface or orbital POI. There is no off-screen storage. If the player wants to see a unit, they walk to the hangar housing it.

This kills the prior "rest of fleet holds in local orbit" abstraction entirely. The orbital model was a soft violation of [social/diegetic-management.md](social/diegetic-management.md) — fleet-as-floating-data instead of fleet-as-walkable-objects.

### Two hangar tiers

Capital-ship scale doesn't fit on a civilian surface tilemap, so hangar facilities come in two physical scales — both built from the same template:

1. **Surface hangars** — at city POIs (Von Braun, Granada, Jaburo, Lisbon, Side-colony civilian sectors). Houses **MS, MA, shuttles, and small craft**. A surface-hangar slot is sized for a 20m mobile suit, not a 200m cruiser. Surface hangars are facility-class entities in `facility-types.json5`, owned and run on the same payroll/maintenance/revenue spine as the bar, the HR office, and the research lab.
2. **Orbital drydocks** — at orbital POIs (Granada drydock cluster, Earth-orbit dock complex, Side-colony orbital sectors). Houses **cruisers, battleships, and anything too large for civilian-dome berths**. Same hangar-facility class — manager, workers, capacity, daily economics — hosted at a `spaceCampaign` POI with a walkable scene attached. The walk to manage capital ships is "spaceport → orbital lift interactable → drydock concourse." UC canon supports this: capital ships base in space; lunar-surface industrial complexes are construction yards, not parking lots.

From the player's seat, both tiers feel the same: walk to a hangar, talk to the manager, units sit in the bay. The split is structural (visual scale, UC physics), not a separate vocabulary the player has to learn.

### Hangar facility shape

See [social/facilities-and-ownership.md](social/facilities-and-ownership.md#hangar-facility) for the canonical definition. The shape that matters here:

- **Capacity** — total slots available, configured per facility template, by tier. A small surface hangar might hold 4 MS slots; a major drydock might hold 4 cruiser slots + 12 small-craft slots. Buying a unit you have no slot for blocks delivery until a slot opens.
- **Manager** — the verb surface for hangar operations. Receive delivery, repair-priority, refit-MS, assemble-MS, scrap. Future verbs slot in here ([social/diegetic-management.md](social/diegetic-management.md) discipline: never workstation cells).
- **Workers** — repair and resupply throughput.
  ```
  dailyThroughput  =  Σ(worker.workPerformance) × manager.workPerformance
                       (in repairPointsPerDay)
  spread             =  dailyThroughput / (count of units not yet fully repaired-and-supplied)
  ```
  Each ship/MS class declares `repairCostPoints` per damage tier in `ship-classes.json5` / `ms-classes.json5`. The manager's **repair-priority** verb overrides the spread, focusing the full pool on a single unit until it's done — without this, after a heavy engagement the player can't get one critical hull ready for re-sortie and the system fights them.
- **Daily economics** — payroll, maintenance, revenue per the existing facility formula in [facilities-and-ownership.md](social/facilities-and-ownership.md). Phase 6.3+ may open hangars to outside customers (revenue from refit fees); MVP runs them as pure cost centers for the player's own fleet.

### State-owned rental hangars — the early-game escape valve

One **state-owned hangar per major POI** (Von Braun, Granada, Earth-orbit dock complex, Side-colony hubs). Cannot be bought. Always large; staffed at a fixed baseline by state employees the player can't hire/fire. The player rents slots **per slot per day**.

- **Rental rate is configured to ~5× the equivalent operating cost** of an owned slot at baseline tuning (payroll + maintenance amortized per slot). Rate lives in `facility-types.json5`; tunable.
- **State-hangar workers do not benefit from the player's faction research efficiency bonuses** ([research.md](social/research.md)). The state efficiency baseline is fixed; only owned hangars scale with research.
- The state hangar is the dominant choice in the very early game (no capital outlay, instant capacity) and the dominated choice late-game (5× operating cost is a real bleed). This is the rent-vs-own arc, mirroring residential apartments.

### Receive-delivery and the late-game scale valve

Buying a ship/MS at a broker doesn't materialize the unit in space. It enters a **delivery queue** against the player's hangar inventory:

1. **Slot available** — delivery routes to the matching hangar (player-owned or state-rental) automatically. Walk to that hangar, talk to the manager, the unit is there. Manager exposes a "**receive delivery**" verb when units are awaiting placement; resolving it places the unit in a slot.
2. **No slot** — the unit waits at the broker's holding bay. The broker tells the player "we're holding it for you; come back when you have space." Hyperspeed auto-breaks if a delivery sits unplaced past N days (TBD; nudge state).
3. **Placement at MVP is auto-snap** — manager picks the next free slot. Manual rearrangement of units in placeable space is a Phase 6.3+ feature, gated on a real mechanical lever (e.g., proximity-to-workshop repair bonus). Sandbox-only placement is a toy that doesn't earn its slot.
4. **Secretary auto-house verb** — at the faction office, the secretary exposes "**auto-house all undelivered inventory**" that batches receive-delivery across every hangar the player owns or rents. This is the late-game scale valve — at fleet-of-30 size, walking to each hangar is a death march.

### Boarding, launching, and the flagship handoff

Boarding a ship is the act of becoming its captain (and so, its flagship-marker). Walk to the hangar where the ship sits → walk up to the ship's airlock interactable → enter the walkable interior scene. The `IsFlagshipMark` migrates on entry. Launching is the existing helm-tile flow: sit at the bridge helm, undock, the ship transitions to the `spaceCampaign` scene. The hangar bay reflects the empty slot.

Capital-ship boarding works the same way — the player just rides the orbital lift first to reach the drydock.

### On-ship hangar vs. surface hangar — the depot/forward asymmetry

Ship templates declare `hangarCapacity` (MS sortie slots) and `mechanicCrewSlots` (the crew complement that services those MS). MS at rest live in the player's surface hangar facility — *storage is depot-only*. But during sortie, the on-ship hangar is a real working facility: the ship's mechanic crew, led by the ship's **hangar boss** NPC, services the MS aboard between engagements. Without this, multi-leg sorties become impossible — any scratch on a GM means flying home, which is the wrong pacing.

The surface hangar's structural advantage over the on-ship hangar is **depth of work**, not throughput:

| Capability | Surface hangar (depot) | On-ship hangar (forward) |
|---|---|---|
| Resupply (ammo, consumables) | Yes, no cap | Yes, no cap |
| Repair effective range | `[0, 1.0]` | `[onShipRepairFloor, onShipRepairCap]` — **band**, not just a ceiling |
| Repair `damaged → ready` | Up to 100% | Up to **`onShipRepairCap`** (~0.8 baseline) |
| Below **`onShipRepairFloor`** (~0.4 baseline) | Repairs from any state, including 0 | **Untouchable for repair aboard** — ship crew can stabilize but can't restore deep structural damage |
| Repair `destroyed → ready` | Yes | **No** — depot-only state transition |
| Refit (swap weapons, install mods) | Yes | **No** — parts inventory lives at the depot |
| Assemble new MS from parts | Yes (Phase 6.3+) | **No** |
| Throughput formula | `Σ(worker.workPerformance) × manager.workPerformance` | `Σ(ship.mechanicCrew.workPerformance) × ship's hangar boss workPerformance` |

Four levers carry the asymmetry:

1. **Repair cap (ceiling).** Ship hangars patch combat damage but cannot restore deep structure. The cap is a **stat** on the ship (`onShipRepairCap`, default `0.8`); see "Ships, MS, MA as stat-bearing entities" below. Combat-ready in the field; needs depot for full restoration.
2. **Repair floor (deep-damage threshold).** Ship hangars can't even *start* on a unit damaged below `onShipRepairFloor` (default `0.4`). This is also a stat on the ship — different hulls (tenders, mobile drydocks) have lower baseline floors and can salvage units in worse shape, while small escorts have higher floors. The floor produces a meaningful in-mission state: a Gundam that drops to 35% in combat is sidelined for the rest of the sortie regardless of crew throughput; the player either flies home or writes that unit off until depot.
3. **No refit / no assembly aboard.** Parts and frame-mods inventory lives at the surface depot — you cannot swap a beam rifle for a 240mm cannon mid-sortie because the 240mm is not on the ship. This protects the surface hangar's role as the customization platform.
4. **Destroyed → ready is depot-only.** A combat-disabled MS sitting in a ship hangar takes no further damage, but its `destroyed → ready` state transition happens at depot.

### Throughput scales with ship class

Because ship throughput is `Σ(mechanicCrew) × hangarBoss`, large ships (cruisers, battleships, **dedicated tenders**) carry enough mechanic complement to outpace a small surface hangar in raw repair speed. A kitted-out fleet with a tender hull can sustain a long-arc sortie without ever depoting for routine damage — and that is the *intended* tradeoff. The depot still wins on deep work (refit, assembly, destroyed-state recovery, full hull restoration), so surface hangars never become irrelevant; they become *specialized*.

This also makes "buy a tender" a real loadout decision: a fleet with strong forward-repair throughput trades cargo / firepower slots for sustainment.

### Storage stays on the surface

MS / MA / fighters / mobile workers at rest still live in surface hangars, not aboard ships. On-ship hangars are sortie facilities, not storage. The pre-deployment loadout pull — *"send this Salamis with 4 fighters or 4 mobile workers?"* (and later, *"4 GM Cannons or 4 GM Snipers"*) — happens at sortie time, in the surface hangar bay, by the manager's loadout verb. On return from sortie, units unload back to the surface hangar (default), or stay aboard if a re-sortie is imminent. This avoids the split-inventory trap ("which Gundam is on which ship") while preserving the in-flight working hangar.

### Cross-POI transit lives on the hangar manager

A player who buys a vehicle at AE Von Braun but wants it at Granada drydock does **not** ferry it manually. The hangar manager exposes a **transfer-unit-to-other-hangar** verb: pick a destination hangar (any hangar the player owns or rents), pay the route fee, the unit ships out. Transit takes configured per-route in-game days (`transferDays` in `facility-types.json5`); the unit appears at the destination at the end of the window. While in transit the unit is unavailable for sortie, refit, repair — it's "in shipment."

Same flow handles non-flagship active ships whose home hangar differs from the flagship's current POI: when the player launches the flagship, any active ship at a different POI auto-queues a transit to the flagship's POI and joins the formation when it arrives. This is one of the real costs the active/reserve distinction surfaces — you don't get instant fleet teleportation.

## Active fleet composition (war-room verb)

Owning a ship and *sortieing with it* are two different commitments. The `IsInActiveFleet` flag distinguishes them; the war-room plot table on the flagship bridge is the surface that sets it.

### Three states per ship

| State | Cost | Action |
|---|---|---|
| **Active** | Salary + supply drain; consumes a formation slot | Auto-launches with the flagship when it leaves a hangar; transits to the flagship's POI if at a different hangar; station-keeps in formation in space; participates in DP commit during tactical |
| **Reserve** | Salary + supply drain; no formation slot | Sits in its home hangar; does not follow the flagship; available to be promoted to active at the war room |
| **Mothballed** | No salary, no supply, no maintenance | Sits in its home hangar; off the books until un-mothballed |

Reserve is the state that captures *"I own this freighter and I want to keep its crew paid and its cargo runs running, but I don't want it following me into combat"* — distinct from mothballing (no upkeep, no activity).

### War-room mechanics

The war-room plot table renders the player's fleet as **tokens**. Owned ships either sit on the formation grid (active) or in a side "reserve" tray. The player drags tokens between the two; doing so writes `IsInActiveFleet` and reshuffles formation slots. Mothballed ships do not appear on the table — un-mothballing is a roster-side verb that returns them to the reserve tray.

This is the *only* place fleet composition is set. The fleet roster panel shows current state (active / reserve / mothballed) but is read-only for the active/reserve transition; the cell opens the war room when clicked. This preserves the rule that the bridge is where command happens.

### Why this collapses three muddier ideas

A previous draft of this design had a separate "follow-flagship doctrine," "formation membership," and "DP commit list" as three distinct data channels. They were all really the same selection. Folding them into `IsInActiveFleet` keeps one source of truth and one player-side verb. Aggression doctrine (cautious / steady / aggressive) stays separate — that's *how* an active ship fights, not *whether* it's in the fight.

## Ships, MS, MA as stat-bearing entities

Every numerical field on a ship, MS, or MA template is a **stat with a base** in a `StatSheet`, modifiable by `Effect`s the same way a character's strength or skill is. There is no second numerics engine for fleet entities; the engine [characters/effects.md](characters/effects.md) defines for characters and [social/research.md](social/research.md) reuses for factions is reused a third time here.

The principle: *any number that can change at runtime is a stat.* Ship hull baseline, top speed, supply consumption, hangar throughput modifiers, repair floor, repair cap — all stats. Mounts, hardpoint shapes, bridge template id — structured / enum, not stats; they stay template-only fields.

### Schema split

Within each template (`ship-classes.json5`, `ms-classes.json5`, …), fields fall into two categories:

- **Stat bases** (scalar numbers): `hullPoints`, `armorPoints`, `topSpeed`, `maneuverability`, `supplyPerDay`, `supplyStorage`, `fuelStorage`, `cargoCapacity`, `hangarCapacity`, `mechanicCrewSlots`, `onShipRepairCap`, `onShipRepairFloor`, `crewRequired`, `brigCapacity`, `dpCost`. The template's value is the stat's `base`; runtime modifiers fold over it via `getStat(shipSheet, statId)`.
- **Template-only fields** (compound / enum / structured): `id`, `name`, `hullClass`, `mounts: [...]`, `hangarDoors: [...]`, `bridge: 'standard'`. These don't enter the StatSheet.

For MS, the same split: scalars (`hullPoints`, `armorPoints`, `topSpeed`, `supplyPerDay`, `supplyPerRepairDay`, `dpCost`, **`propellantStorage`**, **`lifeSupportMinutes`**, plus per-MS new stats like `repairResistance` if a future frame mod wants to tweak how *this* MS responds to repair throughput) become stats; `hardpoints: [...]`, `defaultLoadout: {...}` stay template. The per-sortie resource fields on the MS instance (`currentPropellant`, `currentAmmoByWeapon`, `currentLifeSupport`) are runtime state, not template — see [sortie.md](sortie.md).

### Modifier sources

Same five-channel taxonomy as characters / factions, mapped to fleet-tier sources:

| Channel | Targets | Example |
|---|---|---|
| **Officer skills** | Ship stats of the ship the officer is aboard | A chief mechanic with high `mechanics` emits `flat -0.05` on `onShipRepairFloor`. A captain with high `tactics` emits `percentMult +0.10` on `topSpeed` while in tactical. |
| **Frame mods** (MS only) | MS stats | Armor plating mod: `flat +50` on `armorPoints`. Sub-thruster pack: `percentMult +0.15` on `topSpeed`. Frame mods install via the depot retrofit panel and emit Effects against the MS sheet. |
| **Damage state** | Self stats | A ship at `combatReadiness < 0.5` emits `cap 0.7` on its own `topSpeed` and `flat +0.10` on its own `onShipRepairFloor` — limping back is harder, and so is patching units while limping. |
| **Faction research** | Fleet-wide ship/MS stats | "Field repair tactics" research line emits `flat -0.05` on `onShipRepairFloor` against every player-faction ship. Authored as a `FactionEffect` that produces per-ship `Effect`s on assignment. |
| **Doctrine stance** | Ship stats while active | "Engineering focus" stance emits `flat -0.10` on `onShipRepairFloor` plus `percentMult -0.20` on `topSpeed` while held. Stance-emitted Effects are removed when the stance switches. |

All five sources author through the existing modifier shape — `{ statId, type, value, source }` — with namespaced source ids (`'officer:Yamada:mechanics'`, `'mod:armor-plating'`, `'damage:combatReadiness'`, `'research:field-repair'`, `'doctrine:engineering-focus'`) so `removeBySource()` keeps working.

### Save / load

Same round-trip as character: `serializeSheet()` strips formulas + memo cache + modifier arrays; `attachFormulas()` re-seeds on load; `Effects` traits on each ship/MS/MA round-trip as POJOs and rebuild the modifier arrays at boot. No new save shape.

### Why this matters mechanically

The unification makes loadout decisions matter without inventing a second engine for any of them. *"This captain is worth re-hiring at twice the salary"* becomes a question the player can answer by looking at the Effects he emits on the ship sheet. *"This frame mod is more valuable on a Gundam than on a GM"* becomes a question of which MS sheet it produces a bigger effective `cap` change against. *"Researching field repair pays off in fewer trips home"* becomes a question of how much the floor drops fleet-wide. The numbers aren't hidden behind hand-rolled per-feature math — they're stats, the player learns one mental model, and the engine renders them through the same status-panel component characters already use.

## Auto-assignment

Where the system can pick a sensible default, it does. Player can always override.

- **MS pilot.** When an MS lands in a hangar without a pilot, auto-assign the highest-`piloting` idle pilot in the fleet's pilot pool. (`piloting` is the unified skill across mobile workers, spacecraft, and mobile suits — see [characters/skills.md](characters/skills.md).) When a pilot dies, the MS is unpiloted (not auto-reassigned — that's the player's call).
- **Ship captain.** Same shape: highest-Ship-Command idle officer.
- **Hangar slot.** A purchased unit auto-routes to the first hangar (player-owned, then rented) with a free slot of the matching tier. If no slot exists, delivery queues at the broker until capacity opens.
- **Crew.** Crew gap on a ship = auto-pull from idle hireable pool to fill `crewRequired - currentCrew`.
- **Active-fleet membership.** The first ship the player buys (or already owns at the singleton-to-plural migration) is auto-marked `IsInActiveFleet = true` — otherwise launching the flagship alone would feel like a downgrade. Subsequent purchases default to **reserve** so the player explicitly opts each one into the active fleet via the war-room verb. Mothballed ships never auto-promote.

Every auto-assignment is overridable from the relevant screen.

## Debug "grant fleet" function

Phase 6.2 debug action. Single click does all of the following:

1. Ensure the player has a flagship (existing behavior) and a hangar to house it (grants a small player-owned surface hangar at Von Braun if none exists; for capital-class flagships, grants a rented slot at the Granada drydock).
2. Add a **second ship** to the player's fleet (a small escort or freighter). Auto-route to the player's hangar inventory; rent a slot at the state hangar if needed.
3. Generate a sizable batch of NPCs (~30; concrete number TBD) via `nameGen` / `appearanceGen` — covering captain-grade, pilot-grade, hangar-manager-grade, hangar-worker-grade, and general-crew shapes — and mark all of them as **hired by the player**. Distribute per auto-assignment rules.
4. Stock the surface hangar with a couple of MS instances and auto-assign pilots from the new hire pool. (Phase 6.2.5+ — MS layer.)

This is what makes the system testable end-to-end without grinding hire dialogs. Faction-management's hire flow ([social/faction-management.md](social/faction-management.md)) defines the proper hire path; this debug action short-circuits it for testing.

## Phasing

| Phase | Scope |
|---|---|
| **6.1.5** | **Structural prep, no player-visible content.** Ship-template/instance split. Move existing flagship class data into `ship-classes.json5`. Singleton-`Ship` → plural with `templateId` lookup. Save handler in `saveHandlers/` for fleet roster. Pre-existing saves migrate to single-ship fleet cleanly. No new gameplay. |
| **6.2** | **Fleet POC: two hulls, one broker, one drydock.** Two ship classes — one light hull (limited weaponry, one on-ship hangar slot) + Pegasus-class capital (White Base equivalent). AE sales rep NPC at Von Braun spaceport handles all ship sales for POC; AE rep at Granada drydock for capital. Surface-hangar facility class in `facility-types.json5` (light + MS / fighter / MW slot tiers). Orbital-drydock facility at Granada drydock POI (capital slots). State-owned rental hangars at Von Braun + Granada. Hangar manager + workers job sites; receive-delivery, repair-priority, scrap, **transfer-to-other-hangar** verbs. Daily-throughput formula. Per-hangar `supplyStorage` + `fuelStorage` caps. Supply dealer NPC at AE; order supply / fuel verbs with 2-day delivery. Secretary's bulk-order verb. Debug "grant fleet" function. Per-ship + crew supply economics. Fleet roster + crew assignment screens. **War-room plot table on the flagship bridge** — fleet composition (active / reserve toggle), formation slot arrangement, route plan. **Comm panel relocates to the captain's office** (single-ship 6.0/6.1 didn't need it; multi-ship does). **Officer-led crew auto-man verb** on the captain (talk → "man the rest from idle pool"); supersedes the prior auto-pull stub. Hire-as-captain / hire-as-crew on NPC dialog. Buy-ship dialog — purchase queues delivery to player's hangar inventory; capacity gates the purchase. Mothballing. Active-fleet auto-launch + cross-POI auto-transit. Persistent fleet damage between encounters; repair routes through hangar throughput. Doctrine slider (aggression). `ShipStatSheet` + `ShipEffects` engine reused from character/faction. **`brigCapacity` stat on ship classes; brig as an authored ship-class room** — capacity gating only at this phase, prisoner verbs land at 6.2.5. **Tally dialogue full** (loot routed + named POW reveal panel); **notable-hostile authoring on `space-entities.json5` rows** (named captains visible in tactical, named in event log on death) — see [post-combat.md](post-combat.md). Long-term broker design (multiple brokers, rotating inventories, rarity gates, La Vien Rose lead-time orders) deferred. |
| **6.2.5** | **Vehicle + pilot + retrofit layer — the depth phase.** `vehicle-classes.json5` (or split into `fighters.json5` + `mobile-workers.json5` + later `ms-classes.json5`), `vehicle-weapons.json5`, `vehicle-frame-mods.json5`. Runtime vehicle entity with `mountedWeapons` + `frameMods` per-instance state. Pilot roster, pilot assignment. Per-vehicle supply + repair-supply economics. **On-ship hangar deck = sortie loadout surface; surface-hangar facility = storage + retrofit surface.** Retrofit panel opens by walking up to a vehicle in any hangar (player-owned or rented). Buy-vehicle dialog at AE fighter / MW broker — frames queue delivery against vehicle-slot capacity; weapons + mods route to depot parts inventory. Hangar manager's refit / assemble verbs land here. `VehicleStatSheet` + `VehicleEffects`. Auto-assign + override flow. Secretary's auto-house-undelivered verb. **Per-MS sortie resources**: `currentPropellant`, `currentAmmoByWeapon`, `currentLifeSupport` on the runtime instance; `propellantStorage` + `lifeSupportMinutes` as MS stats. **Mid-combat resupply protocol** — 15s base, full crew/boost formula. **Per-ship-class `hangarDoors[]` authoring + door queueing.** **Stranded-MS recovery tug.** See [sortie.md](sortie.md). **Prisoner verbs** on the brig walk-up + captain's office comm panel (interrogate / ransom / recruit / execute / hand-over / release); in-flight prisoner upkeep via brig-condition stats. **MS-parts loot** via per-class salvage table. See [post-combat.md](post-combat.md). |
| **6.2.7** | **CP + DP.** Command points + deployment points wired into tactical. Doctrine sliders fully active. Out-of-CP standing-orders behavior. |
| **6.3** | Mules / freighters as content (extra classes); multi-ship walkable interior switching (player can move flagship freely between own ships at docked-with-fleet moments). **Recoverables dialogue full** — capture / salvage / scuttle each surviving hull and pod; prize-crew gate (need idle crew aboard to fly a captured hull). **Salvaged-hull-in-flight pattern** — recovered hull joins fleet immediately with `homeHangarId = null`, draws on its own halved bunkers until next dock; queues delivery on dock like a fresh purchase. **`WasCaptured` marker + faction-relation hooks** (Federation rep penalty when keeping a Federation hull; AE buyback markup; hostile-faction ransom branches). **Colony detention** as brig-overflow target. See [post-combat.md](post-combat.md). |

Promote-to-flagship as a separate phase is **gone.** Flagship is just "the ship the player is on," routine, not ceremonial.

## 6.2 sub-phase slicing

The Phase 6.2 row above is a fleet-sized chunk — multi-ship economics, two new hulls, hangar facilities, the war room, hire branches, supply, mothballing, and the debug fleet grant. Each row below is intended as a separate PR / commit that demos a real thing without leaving half-built UX in the tree between merges.

| # | Slice | Demo | Depends on |
|---|---|---|---|
| **6.2.0** ✅ | Shipped at `b3b6917`. Comm panel relocates to the captain's office; brig as ship-class room + `brigCapacity` stat (capacity gating only); tally dialogue full with named-POW reveal; `notable-hostile` authoring on `space-entities.json5` rows. | "A captured pirate's portrait stares back at me from the post-combat tally." | 6.1.5 |
| **6.2.A.1** ✅ | **Hangar facility class + Von Braun state-rental (surface).** `hangar` facility-class shape in `facility-types.json5` (surface + drydock tiers + slotCapacity per slot class; capacity-only verbs at this slice). VB state-rental surface hangar lands as a fixedBuilding east of the central district (14×14, manager + 4 workers). `Hangar` trait attaches at spawn; the manager talk-verb (`hangarManager` branch) reads capacity counts off the trait. Existing flagship hangar slot migrates conceptually into this facility — the hangar is the diegetic home of the flagship. | Walk to the VB state hangar, talk to the manager, see "MS 泊位 0/4 · 小艇泊位 0/4". | 6.1.5 |
| **6.2.A.2** ✅ | **Granada orbital drydock + orbital-lift transit.** Walkable `granadaDrydock` micro-scene with one state-owned `hangarDrydock` facility (drydock tier; `slotCapacity: { capital: 4, smallCraft: 12 }`). Orbital-lift kiosk authored in a new `orbital-lifts.json5` catalog + spawned via `fixedInteractables` on both ends — VB lift at the spaceport's east apron, Granada lift at the drydock concourse entrance. Cross-scene transit on tap: charge fare (¥500), advance clock by `durationMin` (90), `migratePlayerToScene` to the paired kiosk. Manager dialog reads the drydock-tier capacity off the same `Hangar` trait shape `hangarSurface` uses. 6.2.C2's "buy a Pegasus at Granada" inherits this scene + lift wiring for free. | Walk to the VB spaceport apron, step into the orbital lift, fade out → 90 minutes pass + ¥500 deducted → fade in at Granada drydock; talk to the dock manager, see "主力舰泊位 0/4 · 小艇泊位 0/12". | 6.2.A.1 |
| **6.2.B** ✅ | **`ShipStatSheet` + `ShipEffects` + persistent fleet damage + repair throughput.** Per-ship `ShipStatSheet` projected at spawn from `ship-classes.json5` (`hullPoints`, `armorPoints`, `topSpeed`, `crewRequired`, `brigCapacity`, `fuelStorage`, `supplyStorage`), with the remaining stat ids (`maneuverability`, `supplyPerDay`, `cargoCapacity`, `hangarCapacity`, `mechanicCrewSlots`, `onShipRepairCap`, `onShipRepairFloor`, `dpCost`) authored on the schema for downstream slices. `ShipEffectsList` shares the character/faction `Effect` engine — modifier rows fold over the sheet via `rebuildSheetFromEffects`; round-trips through the ship save handler. Persistent damage: `startCombat` no longer regenerates armor between encounters. Daily repair on `day:rollover:settled` walks every hangar, computes `dailyThroughput = Σ(worker.workPerformance) × manager.workPerformance × baseRepairPerWorker` (from `fleet.json5`), and credits ships docked at the hangar's POI (armor first, then hull). Manager dialog adds a 修理优先级 panel: lists damaged docked ships, shows current daily throughput, lets the player click 集中修理 to focus all output on one ship (auto-clears when that ship is fully restored). Hangar trait carries `repairPriorityShipKey`; per-hangar block in the save bundle. | Take damage in combat → dock → damage persists → wait N days → manager repair-priority finishes restoration. | 6.2.A.1 |
| **6.2.C1** ✅ | **Light-hull buy at the AE Von Braun spaceport.** New `lunarMilitia` ship class (civilian-grade light escort, fits a `smallCraft` slot). `ShipClassDef` grows a `hangarSlotClass` field validated against the facility-types union. AE sales rep NPC (`ae_ship_sales_vb`) seated at a programmatically-spawned desk inside the VB airport. `aeShipSales` dialogue branch surfaces ship stats + price + a hangar picker (active scene only at 6.2.C1; capital tonnage from Granada lands at 6.2.C2); buy enqueues a `ShipDeliveryRow` on the target `Hangar.pendingDeliveries`. `shipDeliverySystem` runs on `day:rollover:settled` and flips rows to `arrived` once `arrivalDay` is reached. Hangar manager dialog grows a 待交付订单 section with a 领取交付 button that spawns the ship entity (mirrors flagship bootstrap shape minus `IsFlagshipMark`), sets `dockedAtPoiId` to the host POI, and pops the row. Slot capacity readout is now derived from live `Ship` entities (no second source of truth). | Talk to AE rep → buy → wait 2 days → hangar manager exposes 领取交付 → ship appears in `smallCraft` slot. | 6.2.A.1, 6.2.B |
| **6.2.C2** ✅ | **Pegasus-class buy at the Granada drydock + fleet roster screen.** Second ship class (`pegasusClass`, `hangarSlotClass: 'capital'`, UC-canon Pegasus/White-Base lineage). New AE sales rep (`ae_ship_sales_granada`) at the Granada drydock concourse — `aeShipSales` branch generalizes: each rep declares which class it sells via `fleetConfig.salesRepCatalog`. Capital hulls ship on `fleet.delivery.capital` (5-day) lead-time. Drydock receive-delivery uses the existing C1 pipeline; the `granada` POI now binds to `sceneId: 'granadaDrydock'` so `poiIdForHangarScene` resolves. Fleet-roster modal opened from the captain's-desk "船长简报" panel: lists every owned Ship across every scene world with template name, hangar location, captain placeholder (—, until 6.2.D), hull/armor, and `flagshipBadge`. Cell-level 封存 / 拆解 buttons are toast-only stubs (real verbs at 6.2.G+). | Buy a Pegasus at Granada rep → 5 game-day delivery → receive-delivery at drydock manager → roster shows flagship + pegasus. | 6.2.C1 |
| **6.2.D** ✅ | **Hire-as-captain / hire-as-crew branches + crew assignment + officer auto-man.** Two hire branches on civilian NPC dialog (`hireAsCaptain`, `hireAsCrew`) — shown only when at least one Ship has the matching vacancy. Each hire deducts the per-class signing fee (`fleet.hireCaptainSigningFee`, `hireCrewSigningFee`) and registers a daily salary debit (`fleetCrewSalarySystem` on `day:rollover:settled`). Hired NPCs get a stable `npc-crew-<N>` key so the save/load immigrant-respawn path re-materializes them. `EmployedAsCrew({ shipKey, role })` marks the NPC for the BT job-seek skip + the hire-branch eligibility gate. `Ship.assignedCaptainId` + `Ship.crewIds[]` carry the inverse references (EntityKey strings, save-safe). Captain hire emits `eff:officer:<key>:engineering` on the ship's `ShipStatSheet` — a `percentMult` against `topSpeed` scaled by the captain's engineering skill level (placeholder for the real ship-command / tactics skills at Phase 6+). Crew-assignment screen lives as a per-row drill-down in the existing `FleetRosterPanel`: pick a ship, see captain + crew rows, move / fire / hire-from-idle. Captain's-office (per ship via `IsFlagshipMark`) gains a 从待业池征募补员 button that walks the procedural civilian pool, hires until vacancy is filled / money runs out / the per-click cap fires. | Hire 5 idle NPCs → walk to the second ship's captain → "man the rest" fills `crewRequired`. | 6.2.C2 |
| **6.2.E1** ✅ | **War-room plot table on flagship bridge + `IsInActiveFleet` + aggression doctrine.** War-room kiosk lives on the `lightFreighter` bridge (no dedicated war-room room there) and inside the `pegasusClass` `warRoom` room. Click-to-pick token UX between active formation grid + reserve tray; per-ship 3-position aggression slider (cautious / steady / aggressive). `IsInActiveFleet` is a separate marker trait (mirrors `IsFlagshipMark`) — query cost matches the existing pattern; flagship always carries it and anchors at `fleet.activeFleetGrid.flagshipSlot` (default = center cell). Aggression + formationSlot ride on the Ship trait; round-trip through the ship save handler. Roster's active/reserve + aggression columns read state read-only (the toggle verbs live at the war-room only). Newly-delivered ships default to reserve + `steady`. | Drag the second ship into the formation grid → roster reflects active state. | 6.2.D |
| **6.2.E2** | **Active-fleet auto-launch + cross-POI auto-transit + formation flying.** Active ships at the flagship's POI auto-launch when the flagship undocks; active ships at a different POI queue cross-POI transit (shares the shipment-day pipeline with 6.2.G's transfer-to-other-hangar — whichever lands first defines the infra, the other adds its user surface). Tactical formation: one `Course` per fleet, computed positions per tick; non-flagship ships station-keep at fixed slots. | Launch flagship from VB → active escort at Granada queues transit → arrives in time for the next sortie. | 6.2.E1 |
| **6.2.F** ✅ | **Supply + fuel economy.** AE supply-dealer kiosk in the AE Complex lobby (new `ae_supply_dealer` job + special-NPC). `order-supply` / `order-fuel` verbs on the dealer's talk-verb panel: pick destination hangar + quantity, pay `pricePerUnit × qty` from `fleet.json5`, enqueue a 2-day delivery against the target hangar. Per-hangar `supplyStorage` / `fuelStorage` caps project from `facility-types.json5` at spawn (surface 1000/400; drydock 5000/2000). `Hangar` trait grows `supplyCurrent` / `supplyMax` / `fuelCurrent` / `fuelMax` / `pendingSupplyDeliveries`. Daily aggregate drain on `day:rollover:settled` walks every Ship across every scene world, computes per-POI drain from non-mothballed ships at `supplyPerDay > 0`, debits the hosting hangar (cap at 0). Delivery tick runs alongside, decrementing pending deliveries and landing units when `daysRemaining` hits zero. `mothballed` field defaults to `false` on `Ship` ahead of 6.2.G's verb. Campaign HUD (SpaceView overlay) shows fleet-wide aggregate supply / fuel. Secretary's bulk-order verb at the faction office mirrors the dealer's flow but at `secretaryBulkOrderMarkup` (1.5×) for `secretaryBulkOrderDeliveryDays` (1) — the late-game scale valve. Save round-trip persists supplyCurrent / fuelCurrent / pendingSupplyDeliveries. | Daily drain ticks down storage → order supply at the AE dealer → 2-day delivery lands in the target hangar. | 6.2.A.1 |
| **6.2.G** | **Mothball + transfer-to-other-hangar.** Mothball verb on the roster cell (toggles `mothballed`, kills drain + salary, removes from active fleet). Hangar manager's `transfer-to-other-hangar` verb (paid + delayed via `transferDays`). | Mothball a ship → daily supply drain drops; transfer the light ship from VB → Granada. | 6.2.C2, 6.2.F |
| **6.2.H** | **Debug "grant fleet" function** — populates flagship + second ship + ~30 hired NPCs, distributes per auto-assignment rules. | One click → end-to-end fleet ready to exercise the downstream phases. | All above |

### Ordering rationale

- **B before C1** — shipping multi-ship buy without persistent damage means a second ship can't *do* anything different in combat yet; bundling stat-sheet + damage + repair keeps the system shipping coherently.
- **E1 / E2 split** — the war-room UI is a chunky surface on its own; bundling auto-launch + formation + cross-POI transit AI into the same slice makes it too big to review safely.
- **F (supply) intentionally lands later** even though it could land right after A — supply's value only reads at multi-ship scale, and HUD/UX for daily drain is easier to tune when there's a fleet to drain.
- **Transfer-pipeline ownership floats** between 6.2.E2 and 6.2.G: whichever ships first defines the shipment-day infra (`transferDays` in `facility-types.json5`, the `transit*` instance fields); the other adds its user-facing surface. Both depend on 6.2.A.1's hangar manager.
- **No slice promises new data authoring *and* new ECS systems *and* new UI in one PR.** The biggest rows (C2, E1, E2, F) each span at most two of those.

## Top risks

1. **Save schema migration when singleton becomes plural.** `Ship` was a flat singleton before 6.1.5; the plural migration landed there — the save handler writes an array of ship entities each with template/instance state, the `IsFlagshipMark` marker survives the round-trip, and legacy single-ship payloads load as a one-ship fleet on the flagship entity. Captain-EntityKey references per ship and MS/pilot back-references land at 6.2 / 6.2.5.

2. **Per-ship + per-MS supply UI legibility.** A 10-ship fleet × 4 MS each = 50 line items. **Mitigation:** roll up to ship-level totals on the campaign HUD; expand to per-MS only on the MS bay screen.

3. **MS-pilot assignment at scale.** Auto-assign needs to be predictable; manual override needs to be frictionless. **Mitigation:** clear `idle / assigned / damaged / dead` state in the pilot roster; manual override is one click in either the MS bay or pilot roster screen.

4. **Crew NPC count explodes save size.** A 30+ NPC hired roster has ECS + serialization cost; multiply across a fleet that can grow further. **Mitigation:** profile at 6.2 debug-fleet size; if save grows past budget, push hired-NPC representation onto a leaner shape than full Character (TBD; revisit only if measured).

5. **Off-helm autopilot interactions across N ships.** Naive N-body formation flocking is a perf trap. **Mitigation:** the hangar-storage model means non-flagship ships only fly in formation while the fleet is *sortied*; ships at rest sit in hangar slots and don't tick autopilot at all. While sortied, non-flagship ships station-keep at fixed `formationSlot` offsets behind the flagship; one `Course` in the campaign world per fleet, computed positions per tick. Real ship AI activates only in tactical, where active-pause carries the load.

6. **Hangar-capacity gating must be perceivable, not silent.** A new player who tries to buy a second ship and gets "no capacity" without a clear reason will read it as a bug. **Mitigation:** the broker's purchase verb names the gate explicitly ("你没有空闲机库位 — 去 Granada 找个 drydock 位，或者从 Von Braun 国营机库租一个."), and the buy dialog shows current occupied / total slot counts per tier. The state-rental escape valve is the safety net; it should be one verb away at any major POI.

## What this is NOT

- **Not a fleet-builder game.** Fleet exists for the life-sim consequences of building it.
- **Not a ship retrofit system.** Ships ship as authored. Customization lives one layer down on the MS — that is the design's deliberate asymmetry. Want a different ship loadout? Buy a different ship class.
- **Not an OP/flux fitting game even at the MS layer.** MS retrofit is integer-slot bolt-on, not a points budget.
- **Not per-ship independent autopilot.** Station-keeping in transit; tactical-only AI.
- **Not flagship-centric.** The flagship is whichever ship the player is on.
- **Not size-capped by a player-skill formula.** Ship count is capped by economics + command bandwidth. Per-engagement combat scale (CP, DP) stays skill-gated.
- **Not freighter-less.** Mules and freighters are first-class fleet roles.
- **Not officer skill trees.** Officers are characters with the existing skill XP system.
- **Not a part-swap salvage economy at the ship tier.** Hostile hulls are recovered whole (capture → join the fleet, see [post-combat.md](post-combat.md)) or broken down for raw materials + MS parts; they are *not* a source of swappable ship modules, because ships don't refit. MS-side parts salvage (weapons, frame mods) does drop from broken-down hulls.
- **Not floating-data fleet inventory.** Every ship, MS, and MA the player owns sits in a physical hangar slot. There is no "in storage" abstraction. Capacity is a third gate alongside economics and command bandwidth — buying a hull you have no slot for blocks delivery until a slot opens.
- **Not orbital station-keeping while at rest.** Idle non-flagship ships sit in hangar slots, not in formation around the flagship. Formation flying is a sortie behavior only.

## Cross-doc alignment

This iteration aligned the sibling design docs with the new shape — and with the **MS-primary, no-ship-retrofit** call:

- **[combat.md](combat.md)** — "Settled commitments" #2 rewritten as economics-gated, no skill-formula cap; #6 rewritten as "whichever ship the player is on is walkable, switching is routine transit." Open question #3 replaced (CP/DP concrete numbers, not capacity formula). Phase 6.2 row replaced; 6.2.5 (MS+pilot+retrofit) and 6.2.7 (CP/DP) rows added. Fleet-scale section rewritten. Starsector→UC mapping table now flags ship mounts as fixed-at-template and points the customization arrow at MS.
- **[starmap.md](starmap.md)** — Continuous-fuel/supply-economy section replaced; supply is now `sum of per-ship supplyPerDay + sum of per-MS supplyPerDay + sum of per-MS supplyPerRepairDay + crewUpkeep`, storage is per-ship. Phase 6.2 row updated to call out "no ship refit at any tier"; 6.2.5 (MS retrofit at hangars) / 6.2.7 added.
- **[social/faction-management.md](social/faction-management.md)** — "Fleet: skill-gated" section rewritten to economics-gated. Ship classes section now references `ship-classes.json5`, the template/instance split, and explicitly states ships do not refit (customization energy redirected to MS retrofit). Captain section expanded to captain + pilot. Colony scale section reworded to "administrative load" gate so it no longer claims same-pattern-as-fleet. Phase 6.2 row replaced; 6.2.5 / 6.2.7 added.
- **[characters/skills.md](characters/skills.md)** — No structural change needed; the catalog defers Ship Command / Tactics / Leadership to Phase 6+ already. `piloting` (the unified pilot/mobile-suit skill in the catalog) gates MS pilot quality. Mechanics gates MS retrofit speed at hangars.
- **[phasing.md](phasing.md)** — Phase 6.2 row rewritten with "no retrofit" call-out; 6.1.5 / 6.2.5 (MS+pilot+retrofit) / 6.2.7 rows added. Walkability framing softened from "flagship as scene" to "walkable current ship." Colony cap reworded to administrative-load gate.

The proper hire flow (hire-as-captain / hire-as-pilot / hire-as-crew dialog branches) remains owned by faction-management; the debug "grant fleet" function in this doc is a short-circuit for testing.

## Related

- [starmap.md](starmap.md) — campaign map; orbital drydock POIs (Phase 6.2) host capital-ship hangars
- [combat.md](combat.md) — locks the no-hard-cap, walkable-flagship, permanent-loss commitments this file resolves into a data shape; combat.md's Starsector→UC mapping table reflects the MS-primary asymmetry
- [sortie.md](sortie.md) — in-tactical MS lifecycle: per-sortie resources, mid-combat resupply protocol, hangar-door queueing, pilot recovery
- [post-combat.md](post-combat.md) — combat event log + narrowed tactical auto-pause; recoverables / tally / prisoner dialogues; salvaged-hull-in-flight pattern; brig + named-hostile authoring
- [social/facilities-and-ownership.md](social/facilities-and-ownership.md) — hangar facility class is the canonical home of fleet inventory; same Owner / payroll / maintenance / revenue spine as every other facility
- [characters/skills.md](characters/skills.md) — Ship Command / Tactics / Leadership feed CP cap and doctrine effectiveness; `piloting` (existing unified skill) gates MS pilot quality; Mechanics gates hangar-worker throughput contribution
- [characters/index.md](characters/index.md) — captains, pilots, crew, hangar managers, hangar workers, and POWs are full Character entities, including death pipeline
- [social/faction-management.md](social/faction-management.md) — full hire flow + Phase 6.3+ colony layer
- [social/diegetic-management.md](social/diegetic-management.md) — physical hubs + comm panel + council pattern that the surfaces above are projections of; the hangar facility and the captain's office are two of those hubs
- [phasing.md](phasing.md) — Phase 6 phasing
- `src/ecs/traits/ship.ts` — `Ship` plural-by-construction since 6.1.5; flagship found via `IsFlagshipMark` marker
- `src/sim/ship.ts` — flagship helpers (`getFlagshipEntity`) + `getFleetEntities` (shipped at 6.1.5)
- `src/data/ship-classes.json5` — shipped at 6.1.5 (renamed from `ships.json5`); add `ms-classes.json5`, `ms-weapons.json5`, `ms-frame-mods.json5` at 6.2.5. **No `turrets.json5`** — ship mounts are inline in the ship class.
