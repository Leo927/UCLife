# Post-combat resolution

*What happens after the last hostile breaks contact: the combat event log winds down, the post-engagement dialogues fire, the player decides what to recover and what to scuttle, loot routes into fleet inventory, prisoners route to the flagship brig. Single-source design — implementation lands across multiple phases (see §Phasing).*

## Why this file exists

[combat.md](combat.md) ends with "after resolution, the event re-opens for its post-combat beat (loot text, faction-rep delta, log line) and the player returns to the campaign map." [encounters.md](encounters.md) calls this the post-combat beat without specifying what's in it. [fleet.md](fleet.md) used to defer ship-tier salvage to a later phase; the design is now locked here, in single-source form. Implementation can still arrive in waves — that's a build-order decision below the design fold.

## Combat event log

Tactical does not auto-pause for routine status changes. Instead, tactical renders a **combat event log** in the top-left of the tactical view, Starsector-shape — a scrolling list of recent events.

The log is the unified delivery channel for:

- MS launched / MS docked / MS resupply complete / MS in-repair (see [sortie.md](sortie.md))
- Hull / armor thresholds crossed (50%, 25%, 10%) on any ship
- Weapon depleted / weapon offline / shields down
- Friendly / hostile destroyed
- Boarding action started / repelled
- CP regen tick / CP exhausted (per [fleet.md](fleet.md#command-points))
- Captain orders ack ("Yamada acknowledges screen order")
- Bridge chatter (zh-CN voice / log lines from named officers)

Each entry:

- carries a four-tier severity (`info`, `warn`, `crit`, `narr`) that controls color and sort priority.
- shows a portrait where the source is a named NPC (named officer, named hostile).
- fades after `combatLogVisibleSec` (config) but stays queryable in a Tab-toggled full log scroll.

[encounters.md](encounters.md)'s **pause-on-event** rule is preserved but narrowed once tactical begins. The tactical auto-pause set is:

- **First contact** — one pause to brief the engagement.
- **Flagship hull crosses 25% / 10%** — life-of-the-flagship beats.
- **Boarders detected on the flagship**.
- **Player-piloted MS at hull 0** — eject confirmation prompt.

Everything else routes through the log. This matches Starsector's discipline; without it, extended engagements become modal-spam.

## The post-combat sequence

The moment the last hostile is destroyed, fled, or surrenders, tactical resolves. **Two sequenced dialogues** fire on the bridge, in order. Combat is over by definition so neither pauses tactical-time, but each blocks campaign-time progression while open.

```
1. Recoverables dialogue   — [decide what to do with surviving hostile hulls + ejected pods]
2. Tally dialogue          — [read-only summary: loot routed + named POWs captured]
```

The player may close either dialogue early; defaults apply (recoverables → scuttle, leave; tally → confirm).

Per-prisoner verbs (interrogate / ransom / recruit / execute / hand-over / release) are **not** on the tally dialogue — they live on the brig walk-up later, so the player encounters their captives as bodies in a room rather than as menu rows. This preserves the diegetic frame; the post-combat tally is the *reveal*, not the management screen.

## Recoverables dialogue

The dialogue lists every **survivor hull** (hostile ship at <10% hull and disabled, plus fled-but-re-engaged hulls that stopped fighting) and every **ejected pod** (hostile MS pilots + crew escape pods).

Per hull, three options:

- **Recover** — the hull joins the player's fleet as a salvaged ship instance (see §Recovered-hull state on join below). Costs supply (config: `salvageRecoverSupplyCost` per hull tier). Requires available *capture-prize-crew* aboard the flagship — the player has to dedicate crew to fly the captured hull, pulled from the flagship's idle crew pool, sized to the hull's `crewRequired / 4` minimum-prize-crew. If there isn't enough, the option is gated and the dialogue says so plainly ("not enough idle crew aboard to fly this hull").
- **Salvage** — the hull is broken down for parts. Yields MS-class parts (weapons + frame mods if present), supplies, fuel, credits per the salvage table on the ship class. No crew cost; takes a configured amount of post-combat time (handled by the abstract end-of-engagement tick, not real-time).
- **Scuttle** — leave it. No cost, no payout.

Per pod, two options:

- **Recover** — crew/pilot enters the flagship as a prisoner (see §Prisoners). Costs nothing material but takes a brig slot.
- **Leave** — no cost, no payout. The pod drifts; in cold UC space, the occupant dies offscreen unless another hostile fleet recovers them.

### Recovered-hull state on join

A recovered hull joins the player's fleet **already in-flight**, not in a hangar. Concretely:

- A new ship runtime instance is created with `templateId` matching the hull. (If the hull is a class the player hasn't seen before, the ship-classes table must already include it — pre-author every hostile-eligible class.)
- The instance is marked `IsInActiveFleet = false` (reserve), `mothballed = false`, captain is the assigned prize-crew lead.
- `homeHangarId` is **null** until the flagship next docks. While `homeHangarId` is null, the ship station-keeps with the formation but **does not draw supply / fuel from any hangar's storage**; it draws from its own `currentSupply` / `currentFuel`, which are whatever was on the hostile hull at recovery, halved for the violence of the takeover.
- On the flagship's next dock at any POI, the hull queues delivery to a hangar with capacity at that POI — same flow as a freshly bought ship ([fleet.md](fleet.md#receive-delivery-and-the-late-game-scale-valve)). If no slot exists, the player gets the same broker-side prompt (find a slot or rent one at the state hangar). If the player never docks, the hull stays with the fleet indefinitely on its own dwindling stocks — at which point [starmap.md](starmap.md) supply-zero behavior kicks in (mutiny risk), and the prize crew may abandon ship.

This is the **in-flight pattern**: a captured hull is part of the fleet immediately, but the hangar question is deferred to the moment one is needed. There is no "captured-but-not-yet-housed" half-state; the ship is in the fleet, station-keeping, drawing on its own bunkers.

### Damage / resupply state on recovered hulls

A recovered hull carries:

- `currentHull / currentArmor` at end-of-combat values (the damage that *disabled* it). Forward repair routes through the on-ship hangar boss for stabilization (subject to the floor — most prize hulls drop below `onShipRepairFloor` at the moment of capture and are depot-only). Full restoration waits for the next dock.
- `currentSupply / currentFuel` at half-cap (per above).
- `hangarUnits` empty — any MS still aboard a captured hull is its own recoverable in this same dialogue, not carried over with the hull.
- `crewIds` empty — captured crew route to the prisoner flow, not to the new ship.
- A `WasCaptured: true` marker that influences future loyalty / morale / faction relations (Federation rep penalty if a Federation hull is captured and kept; AE will buy it back at a markup; some hostile factions will pay ransom to recover one of theirs).

## Tally dialogue

A single read-only screen with two panels:

**Left panel — loot routed:**

- **Credits** — direct deposit to the player faction fund. Show the delta and the new balance.
- **Supplies / fuel** — split across the flagship and any active fleet ships' cargo holds, prioritizing storage-cap headroom. Overflow (rare) becomes a freight-burden warning that the player will see on the campaign HUD.
- **MS parts (weapons, frame mods)** — route to the player's depot parts inventory at the flagship's home-hangar. While in-flight, parts ride aboard the flagship's cargo and transfer to depot inventory at next dock.
- **Cargo trade goods** (later phases: trade economy) — same routing as supplies/fuel.

**Right panel — captured:**

- **Named POWs** with portraits + a one-line context per name ("the redhead in the custom Zaku — you've heard about him on the news"). Anonymous crew tallied as a count below the names.
- A note of where they're physically held: "Brig: 3 / 24 occupied" on a Pegasus, or "Brig over capacity: 4 in secure quarters with escape risk."

A single "OK, return to bridge" closes the dialogue. There is no per-line accept/reject — that's spreadsheet UI.

## Prisoners

POWs are full Character entities (same trait set as any NPC), held physically on the flagship in a **brig** room (authored in the ship-class interior layout — small ships may have one cell, capital ships have a brig facility). Brig capacity is per-ship-class (`brigCapacity` template stat; default 0 for civilian-spec hulls, 4 for a Salamis-Kai, 24 for a Pegasus).

Brig over-capacity: surplus prisoners are housed in less-secure quarters with an escape-attempt risk (the loyalty / morale system already applies; brig-condition stats — food, water, medical access — tick the same way crew vitals do). At a player-owned colony, surplus can route to a colony detention facility (later phase). If neither option is viable, the prisoner cap forces the player's hand at the recoverables dialogue — recover fewer pods.

Per-prisoner verbs route through the talk-verb on the brig cell or via the comm panel from the **captain's office** ([social/diegetic-management.md](social/diegetic-management.md#captains-office)):

- **Interrogate** — extract intel: faction-rep / fleet-position / known-cargo-route data. Skill check (Intelligence + Charisma; Phase 6+ may add a Combat-Interrogation perk).
- **Ransom** — return to their faction for credits + a small rep delta on both sides. Brig slot frees up at next dock.
- **Recruit** — convert to crew. High-loyalty-cost hire; only viable for prisoners with low pre-capture faction loyalty or strong personal bonds the player can leverage.
- **Execute** — instant resolve; major rep penalty across most factions; some factions (Zeon hardliners post-war) approve.
- **Hand over to a third party** — turn over to a faction with an interest. Pays out per faction relations.
- **Release** — let them go at the next docked colony. Small positive rep with their home faction.

Prisoner death pipeline reuses the existing physiology / death machinery. A prisoner who dies in the brig (starvation, neglect, escape-attempt violence) carries the same rep penalty pattern as execution, just without the player having actively chosen it — neglect is its own faction-rep signal.

### Notable hostiles authoring

A pirate fleet may carry a **named hostile** captain or pilot — Char Aznable in disguise circa 0077, Anavel Gato pre-Operation Stardust, Ramba Ral as a corporate raider. These are authored on the **space-entity row**, not procgen:

```js
// space-entities.json5
{
  id: 'shoal-zone-pirate-flotilla-3',
  spawn: { x: 8200, y: 13400 },
  faction: 'pirate',
  aiMode: 'patrol',
  aggroRadius: 24,
  ships: [
    {
      class: 'salamis-kai-pirate-refit',
      captainId: 'char-aznable-0077-disguise',     // optional named hostile
      crewMS: [{ class: 'zaku-ii-custom-red', pilotId: 'char-aznable-0077-disguise' }],
    },
    { class: 'musai-pirate', /* anonymous */ },
  ],
}
```

Captain / pilot ids resolve into the existing **special-npcs.json5** named-character pool. The tally dialogue lists named POWs with portrait + one-line context; until they're captured / ransomed / interrogated, the player only knows them by pirate handle ("the Red Comet rumor"). Capturing is the player's first explicit confirmation of *who they fought*.

A named hostile killed in combat (rather than captured) is announced in the combat event log with their portrait + a single line of bridge chatter; the body is unrecoverable but the rumor outlives them in the [newsfeed](social/newsfeed.md).

## Phasing (implementation, not design)

Design is locked above. Implementation lands in waves; the order is deliberate — log + tally (cheap) → notable hostiles (cheap, big payoff) → prisoners (a real subsystem) → ship recovery (expands the fleet acquisition channel — the moment of real economy impact). Each layer is a functioning surface alone; the sequence layers depth.

| Phase | What ships |
|---|---|
| **6.0** | **Combat event log surface** — Starsector top-left, fading scroll, four severity tiers, Tab-toggled full history. Lands with the tactical foundation; populated with launch / dock / kill / threshold entries as those systems come online. **Tactical auto-pause set narrowed** to first-contact + flagship hull 25% / 10% + boarders + player-piloted-MS at hull 0; routine status changes route to the log instead. **Tally dialogue minimum** — credits + supplies + fuel only (parts inventory + brig don't exist yet). |
| **6.2** | **Tally dialogue full surface** — loot panel routes credits / supplies / fuel / parts into fleet inventory per the rules above; captured-panel shows named POW portraits + one-line context (the brig itself is a 6.2 room with `brigCapacity`, but per-prisoner verbs land at 6.2.5). **Notable-hostile authoring on `space-entities.json5` rows** — `captainId` / `pilotId` reference into `special-npcs.json5`; named captains visible in tactical, named in the event log on death. |
| **6.2.5** | **Prisoner system** — talk-verb verbs on the brig walk-up + the captain's office comm panel (interrogate / ransom / recruit / execute / hand-over / release). **In-flight prisoner upkeep** via brig-condition stats (food / water / medical) reusing the physiology pipeline. Brig-over-capacity routes to less-secure quarters with escape risk (loyalty/morale system). **MS-parts loot** via per-class salvage table — weapons + frame mods drop from broken-down hostile MS into the depot parts inventory at next dock. |
| **6.3+** | **Recoverables dialogue full** — capture / salvage / scuttle each surviving hull and pod; prize-crew gate (idle crew aboard the flagship sized to `crewRequired / 4`). **Salvaged-hull-in-flight pattern** — recovered hull joins the fleet immediately with `homeHangarId = null`, station-keeps in formation, draws on its own halved bunkers; queues delivery to a hangar with capacity at the flagship's next dock, exactly like a fresh purchase. **`WasCaptured` marker + faction-relation hooks** (Federation rep penalty when keeping a Federation hull; AE buyback markup; hostile-faction ransom). **Colony detention** as brig-overflow target. Faction-specific ransom / hand-over branches. |

## Related

- [combat.md](combat.md) — tactical engagement that this file resolves; combat event log is rendered in the tactical view
- [encounters.md](encounters.md) — text-event-first engine; post-combat dialogues hook into the same dialogue surface; pause-on-event rule narrows during tactical
- [fleet.md](fleet.md) — receive-delivery flow that recovered hulls re-enter at next dock; `brigCapacity` template stat; `WasCaptured` instance marker
- [sortie.md](sortie.md) — pilot ejection + recovery feeds prisoners (theirs) and pod recovery (yours); destroyed-MS recovery tug
- [starmap.md](starmap.md) — supply-zero behavior the salvaged-hull-in-flight fallback relies on
- [characters/index.md](characters/index.md) — prisoners are full Character entities; physiology applies to brig conditions
- [social/diegetic-management.md](social/diegetic-management.md) — captain's office hosts the prisoner-management verbs via comm panel
- [social/faction-management.md](social/faction-management.md) — faction relations affected by capture / ransom / release / execute decisions
- [social/newsfeed.md](social/newsfeed.md) — named hostiles killed in combat survive as newsfeed rumor
- [characters/skills.md](characters/skills.md) — Intelligence + Charisma gate interrogation
