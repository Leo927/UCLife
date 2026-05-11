# Sortie loop

*The in-tactical lifecycle of an MS, MA, or fighter: launch from the ship's hangar, fight under per-sortie resource constraints, dock back, resupply, relaunch. Single-source design — implementation lands across multiple phases (see §Phasing).*

## Why this file exists

[combat.md](combat.md) commits to "the player walks into the cockpit, the MS launches as a fighter wing." [fleet.md](fleet.md) commits to per-MS supply economics at the day scale and a forward-repair throughput formula. Neither file specifies what happens *during* a tactical engagement: how an MS runs out of ammo, how it docks back, how long resupply takes, where on the flagship it physically launches from. This file is the in-tactical resource and protocol layer underneath those promises.

## MS as a tactical-time resource entity

Per [fleet.md](fleet.md), the MS runtime instance carries `currentHull / currentArmor / mountedWeapons / frameMods / damageState / repairProgress`. For sortie play the instance carries three more **per-sortie** resource fields, all stats on the `VehicleStatSheet`:

- `currentPropellant` — sortie-fuel reserve. Capped by `propellantStorage` (template stat). Drains under thrust / Δv during cockpit play. Hitting zero strands the MS at its current position (drift, no thrust authority); it can still fire but cannot dock without a recovery tug from the flagship.
- `currentAmmoByWeapon: Record<weaponInstanceId, number>` — per-weapon ammo for ammo-limited weapons. Capped by the weapon template's `ammoCapacity` (energy weapons declare `ammoCapacity: Infinity` and never deplete). Hitting zero on a weapon disables that weapon for the rest of the sortie until resupply.
- `currentLifeSupport` — pilot life-support minutes. Long enough that no normal sortie touches the floor; *eject and drift* events test it.

These are stats so frame mods (extended propellant tank, autoloader, life-support pod) emit Effects against them the same way frame mods emit against `topSpeed` or `armorPoints` today. Same modifier shape, same `removeBySource()` discipline.

## Sortie state lifecycle

```
ready (in on-ship hangar)
  → launching          [t = ~2s, occupies hangar door, CP cost paid]
  → deployed           [in tactical scene, cockpit-controlled or AI-piloted]
  → docking            [t = ~2s, occupies hangar door, requires hangar door clear]
  → resupplying        [t = 15s base, occupies hangar bay slot]
  → ready              [back in on-ship hangar; relaunch available]
```

Two terminal-state branches:

- `damaged` — taken in cockpit play. If `currentHull < onShipRepairCap` after dock, transitions through `in-repair` (slow, per-day throughput, see [fleet.md](fleet.md)). If `currentHull < onShipRepairFloor` aboard, the MS is sidelined on-ship and cannot be touched until depot.
- `lost` — pilot ejected and not recovered, or MS destroyed. Removed from `hangarUnits` for the rest of the sortie; recovery (if applicable) happens at post-combat ([post-combat.md](post-combat.md)).

## Mid-combat resupply protocol

Resupply replenishes `currentPropellant` and `currentAmmoByWeapon` to caps. It does **not** touch `currentHull / currentArmor` — that's repair, slow, per-day throughput. Resupply is fast on purpose: returning to the ship and relaunching already costs a meaningful amount of tactical-time (transit to door + dock + resupply queue + walk-to-cockpit / pilot-walks-to-cockpit + launch); slow resupply on top of that turns the dock-and-relaunch loop into a death march and pushes players to play through their last clip rather than dock when they should.

```
resupplyTime  =  baseResupplySec
                  / hangarBoss.workPerformance
                  / (1 + Σ(mechanicCrewEfficiency at this bay))
                  / resourceBoostMul
```

- `baseResupplySec` — config (`config/sortie.json5`), default **15** tactical-seconds.
- `hangarBoss.workPerformance` — same character-side stat the day-scale formula uses; carries through here so a Mechanics-leveled boss noticeably accelerates turnaround.
- `Σ(mechanicCrewEfficiency at this bay)` — additive contribution from on-duty mechanic crew at the bay. Idle / panicked / wounded crew don't count. The `+1` baseline guarantees a zero-crew bay still completes resupply at the boss-modified rate, just slowly.
- `resourceBoostMul` — frame-mod / facility-tier / faction-research multiplier (e.g. an upgraded autoloader bay knocks resupply down further, *Field Logistics* research unlocks a fleet-wide multiplier).

Every term is configurable; baseline tuning is one knob (`baseResupplySec`).

A returning MS occupies a **bay slot** for the duration; if all bay slots are full, the MS queues outside the door and pays a queue-wait penalty (drifting near the ship under hostile fire) until a slot opens. Queue order is FIFO.

The resupply clock runs against tactical-time (1:1 real-second). It does *not* tick during paused tactical (active-pause freezes it like everything else).

**No auto-pause on resupply complete.** Completion is published to the [combat event log](post-combat.md#combat-event-log) — Starsector-shape, top-left, no modal interrupt. If the player wants to relaunch immediately they're already watching the log; if they're piloting another MS they'll catch it on the next breath. This is the point — combat does not stop to ask the player about logistics.

## Hangar door / launch position is per-ship-class

Each ship class authors **where on its hull** an MS launches from. A Pegasus (White Base) opens its bow doors and catapults forward; a Salamis-Kai drops a cradle out of its underside; a Magellan rolls launch arms out of side bays. Launch direction matters for re-engagement geometry, for collision avoidance with the parent ship, and for the look-and-feel of "this is *that* ship, launching MS the way *that* ship launches MS."

Authored on the ship-class template in `ship-classes.json5`:

```js
{
  id: 'pegasus',
  // ...
  hangarDoors: [
    { id: 'bow-port',  position: { x:  6, y:  24 }, facing:    0, bayId: 'bay-1' },
    { id: 'bow-stbd',  position: { x: -6, y:  24 }, facing:    0, bayId: 'bay-2' },
    { id: 'aft-port',  position: { x:  6, y: -28 }, facing:  180, bayId: 'bay-3' },
  ],
}
```

Each `hangarDoor`:

- declares its `position` (hull-local coords) and `facing` (launch direction in degrees).
- binds to a `bayId`, which must match an on-ship hangar bay slot authored elsewhere on the template.
- gates one launch / one dock at a time. A door cycles through `idle → launching → idle → docking → idle` and locks for the few seconds the operation takes.

The launching MS spawns at `(ship.position + door.position rotated by ship.facing)` with initial velocity along `door.facing + ship.facing`. Docking requires the MS to approach within a small radius of an idle door at low relative velocity (config: `dockApproachRadiusPx`, `dockApproachMaxRelVel`); the cockpit minigame handles the approach as a Lift primitive against the door.

If a class has fewer doors than `hangarCapacity`, multiple MS share doors and queue. This is the *carrier-vs-frigate* asymmetry: a Pegasus with 3 doors and 4 bays cycles 3 MS at a time; a Salamis-Kai with 1 door and 4 bays cycles 1 MS at a time and feels it during a heavy launch.

## Launching

Two trigger paths, both diegetic:

- **Player walks into the cockpit and confirms launch.** Walking into the cockpit interactable opens a brief "ready / not ready" pre-launch dialogue read off the MS state (resources at cap? hull above floor? pilot assigned? — same readiness fields surfaced at the [captain's office](social/diegetic-management.md#captains-office) for the ship). Confirming pays the CP cost (per [fleet.md](fleet.md#command-points)) and queues the MS at the next free door bound to its bay.
- **Bridge order via comm panel.** From the captain's office during tactical, the player issues *launch wing X*; the assigned pilot NPC walks to the cockpit, climbs in, launches. Same door queueing, same readiness gating.

If the player is the pilot, the cockpit-minigame view replaces the tactical view at the moment the door opens. The transition is hard-cut, not a fade — the player needs to be flying immediately because the tactical situation does not pause.

## Docking and relaunch

Docking is the inverse: cockpit play maneuvers the MS within `dockApproachRadiusPx` of an idle door at < `dockApproachMaxRelVel`, releases controls, the door grabs the MS and pulls it into the bay. Tactical view returns to the bridge feed (or stays in cockpit if the player is now flying *another* MS — see below).

Once in the bay, resupply ticks per the formula above. The player can:

- **Walk away from the cockpit** to take the helm or do anything else aboard. Resupply continues unattended; completion fires into the combat event log.
- **Stay in the cockpit** waiting for resupply. The cockpit view shows a resupply HUD with the live timer and a flagship-feed picture-in-picture so the player isn't blind to the tactical situation.
- **Switch to a different MS** by walking to that MS's cockpit and confirming launch. Same door-queueing rules.

Recovery of a *destroyed* MS (or a stranded one with `currentPropellant = 0`) is handled by the flagship sending a recovery tug (`computers + mechanics` skill check on a crew member); the tug occupies a hangar door for the duration of the recovery and the recovered MS arrives at the bay in `damaged` state. Salvage recovery of *destroyed enemy* MS happens at post-combat — see [post-combat.md](post-combat.md).

## Pilot recovery

A pilot who ejects in-tactical drifts at their ejection point. The flagship recovers them by maneuvering within recovery range (config: `pilotRecoveryRadiusPx`); pilots inside the radius automatically dock to a hangar bay's life-support cradle, no door required. Hostile fleets may recover before the player does — the pilot is then captured by the hostiles. The symmetric case (player recovers a hostile pod) feeds the prisoner system in [post-combat.md](post-combat.md#prisoners).

## Save / load

Sortie state survives save/load *during* tactical only if a tactical save is written; tactical save support is a separate decision (TBD; combat is intentionally a session-bound experience for now). For day-scale save/load between deployments, all sortie resources are reset to cap on dock-and-rest at a hangar facility, so they don't enter the persistent save shape. The MS's `damageState` and `repairProgress` *do* persist (already in [fleet.md](fleet.md)).

## Phasing (implementation, not design)

Design is locked above. Implementation can land in pieces:

| Phase | What ships |
|---|---|
| **6.1** | MS launch + cockpit transition + dock back; single hangar door per ship as a placeholder; no per-MS resources yet (MS combat is hull-only). Combat event log present with launch / dock / kill entries. |
| **6.2.5** | `currentPropellant` + `currentAmmoByWeapon` + `currentLifeSupport`; mid-combat resupply protocol with full crew/boost formula; per-ship-class `hangarDoors[]` authoring; door queueing; recovery tug for stranded MS. |
| **6.3+** | Frame mods that emit Effects against per-sortie resource caps. Tactical-save support (if pursued). Faction research lines that emit fleet-wide `resourceBoostMul`. |

## Related

- [combat.md](combat.md) — combat event log, tactical-time clock, cockpit-minigame primitives, narrowed tactical auto-pause set
- [fleet.md](fleet.md) — MS template / instance, on-ship hangar, hangar boss, mechanic crew, day-scale repair, hangar door authoring on ship classes
- [post-combat.md](post-combat.md) — what happens to ejected pilots, destroyed MS, and surviving hostile hulls after the engagement
- [mobile-worker.md](mobile-worker.md) — cockpit-minigame primitive set; Lift primitive used for dock approach
- [social/diegetic-management.md](social/diegetic-management.md) — captain's office hosts the pre-launch readiness summary and bridge-order verbs
- [characters/skills.md](characters/skills.md) — Mechanics gates `workPerformance` for hangar boss + crew; Computers gates recovery-tug acquisition
