# Encounter form

*How POI events are structured. Phase 6+. The single biggest design
borrow from FTL/Starsector beyond combat shape itself: text-event-first
events with skill / crew / ship-keyed "blue options," resolving to
combat or non-combat outcomes.*

## Why this file exists

[starmap.md](starmap.md) commits to "each POI has an encounter pool"
without saying what an encounter is. [combat.md](combat.md) commits to
"Starsector-shape combat" without specifying how the player gets into a
fight. This file specifies the form: what an encounter is, what it
contains, how it composes.

This is the discipline that makes Phase 6+ tractable for a solo author.
FTL makes 160 starmap nodes interesting across a 4–8 hour run with
roughly 100 hand-authored event templates and a recombination engine.
Starsector ships hundreds of bar / station / planet interaction
templates on top of its tactical layer. 50–80 templates for UC's
Phase 6.0 ship is a tractable starting set; authoring 50–80 unique
combat scenarios would not be.

## Text-event-first

Every POI encounter opens with a **text event**, not a combat trigger.
The event:

- Names the situation in 1–3 zh-CN sentences
- Offers 2–4 numbered choices to the player
- Each choice resolves to a stat/RNG roll → outcome (combat / reward / loss / branch / nothing)

Most outcomes are **not combat**. A typical FTL run is 60–80% events,
20–40% combat; Starsector's exploration / interaction layer is similar.
UC inherits this ratio. War is mostly waiting and small decisions,
occasionally interrupted by violence. That's the texture of being on a
ship in a war and the design honors it.

**Illustrative event** (zh-CN draft, not final copy):

```
你的传感器在 Side 4 接近线捕获了一艘漂流货船的应急信号。
舱外没有动静。

1. 靠近调查
2. 派陆战队员搭乘舱过去      [需要：boarding pod / 陆战队员]
3. 远程扫描后再决定           [需要：sensors II+]
4. 绕开
```

The event-author writes **one** template; the player's specific kit
filters which options appear.

## Blue options

The highest payoff-to-cost-ratio pattern in the genre. An option that
only appears if the player meets a qualifier — a skill threshold, a
ship system, a crew-member type, an item, an origin. Cost: one extra
line in the event template. Payoff: the player's entire investment in
skills / crew / ship outfitting *pays attention to itself*.

Qualifier types UC supports out of the box:

| Qualifier | Reads from | Example |
|---|---|---|
| Crew skill threshold | existing 27-skill set | `engineering ≥ 50` opens "rewire the panel" |
| Ship system / level | ship state | `has boarding pod`, `sensors ≥ II` |
| Crew specialization | crew NPC traits | `has crew with mw_pilot background` |
| Faction rep | existing rep system | `federation ≥ 50` opens "flash creds" |
| Inventory | existing inventory | `carries forged ID` |
| Origin trait | existing Spacenoid/Earthnoid | `spacenoid crew` opens zero-G option |
| Player-faction tier (Phase 6.4+) | faction-management state | `player-faction recognized` opens diplomatic option |
| Newtype flag (Phase 7+) | reserved | "I sense someone alive in there" |

A single event template produces different playthroughs depending on
*who's reading it*. Two crews that share an event can have totally
different sessions through it. This is the cheap recombination layer.

## Composition: regions + POIs + events

[starmap.md](starmap.md) declares each region has an encounter pool and
each POI has a type. Concretely:

- Each **region** declares a weighted bag of event template ids:
  `{ id: 'distress_signal', weight: 3, conditions: { warPhase: 'pre' } }`
- Each **POI type** (mining outpost, derelict, distress signal, hostile patrol, asteroid field, …) further filters which events the region pool can roll into it
- A **POI visit** rolls one event, with parameters tuned by current state (war phase, faction control of the POI, day count, fleet state)
- **In-transit encounters** can also fire on the campaign map between POIs (Starsector pattern: hostile fleet intercepts, distress relays from passing ships) — same event engine, different trigger

All template authoring is data-driven in `data/encounters.json5`.
**Faction reskins multiply content for free** — the same "patrol stop"
template flavored Federation vs. Zeon vs. pirate is three events for
the price of one author-hour.

## Pause-on-event UX rule

When a significant event fires during a deployment, the game **auto-
pauses**. Significant = anything the player should not miss:

- Arriving at a POI (entering an event)
- Hostile fleet enters sensor range
- Crew injured or killed
- Ship system destroyed or critically damaged
- Hull crosses a threshold (50%, 25%)
- Boarders detected
- Long-range hostile spotted

This is FTL's discipline (and Starsector's) and it's effectively free
to implement (one rule in the loop). Without it, hyperspeed eats
moments the player should have responded to.

**Once tactical begins, the pause set narrows.** Routine status changes
(MS launches, dock-backs, resupply complete, weapon depleted, captain
order acks) post to the [combat event log](post-combat.md#combat-event-log)
instead of triggering a modal. The tactical auto-pause set is reduced
to: first contact, flagship hull crossing 25% / 10%, boarders detected
on the flagship, player-piloted MS at hull 0. Everything else flows
through the log so extended engagements stay playable.

## Combat encounters as a subset

Some choices resolve into combat ([combat.md](combat.md)). The event's
tree leads there: *"engage the patrol"* → tactical-mode combat begins;
*"flee"* → fuel cost + evasion roll. **Combat is one of several outcomes
a text event can have, not a parallel system.**

Once combat begins, the tactical Starsector-shape UI takes over until
resolution. After resolution, the **post-combat sequence** fires
([post-combat.md](post-combat.md)): a recoverables dialogue (capture /
salvage / scuttle each surviving hull and pod), then a tally dialogue
(loot routed + named POWs captured with portraits). Per-prisoner
verbs (interrogate / ransom / etc.) live on the brig walk-up later, not
on the post-combat screen — the tally is the *reveal*, the brig is the
*management*. Then the player returns to the campaign map.

## Authoring scale

Solo author budget. The starting content target is **30 templates** for
Phase 6.0 ship; **+20** for Phase 6.1 wiring combat; **+15–20** for the
Phase 6.4 Jupiter pool; wartime templates added in Phase 7. Each
template is a few zh-CN sentences + 2–4 choices + outcome formulas —
small enough to write a few per session.

Faction-flavored reskins of an existing template are recorded as
separate templates with shared logic, multiplying the apparent variety.

**Hard rule: no procedurally generated text.** Templates are hand-authored
prose with parameter slots. LLM-generated events are Phase 8+ territory
and explicit out of scope here.

## What this is NOT

- **Not a quest system.** Events do not chain into multi-stage stories
  by default. Some can; that's authored on top of the engine, not in it.
- **Not a dialogue system.** Events are at the situation level, not the
  per-line conversation level. Dialogue with named NPCs lives in the
  social layer.
- **Not the only source of POI interest.** Dockable POIs (Von Braun,
  Granada, Side 3 Zum City, player-built colonies, etc.) skip the event
  layer — the player walks into the city scene the POI represents.
  Events are the shape for POIs that are *not* walkable destinations.

## Phasing

| Phase | Scope |
|---|---|
| **6.0** | Event engine: parser, choice resolver, blue-option qualifier evaluator, region / POI-type pool selection, pause-on-event rule. ~30 starter templates. |
| **6.1** | Combat-instigation path: events route into tactical-mode combat and back out cleanly. +~20 templates emphasizing combat-or-not choices. |
| **6.2** | Multi-ship fleet aware events (escort losses, formation choices). Faction-flavored reskins. |
| **6.3** | Colony-defense events (raid alerts, refugee requests at your colony). |
| **6.4** | Jupiter expedition event pool (~15–20 templates with frontier-flavor pool). Faction-tier diplomatic events. |
| **7.0** | Wartime event pool: faction-control flips reshape which events fire where. New templates for conscription, refugee transit, war atrocities, hostile expeditions vs player colonies, etc. |
| **8+** | LLM-generated event variations on top of templates, for replayability past authored content. |

## Related

- [starmap.md](starmap.md) — campaign map that hosts these events at POIs
- [combat.md](combat.md) — combat-trigger subset
- [post-combat.md](post-combat.md) — what fires after the tactical layer resolves; combat event log; named-hostile reveals
- [sortie.md](sortie.md) — in-tactical MS resource layer; resupply complete is one of the events delivered through the log instead of a pause
- [characters/skills.md](characters/skills.md) — blue-option skill qualifiers
- [social/relationships.md](social/relationships.md) — crew NPCs supplying specialization qualifiers
- [social/faction-management.md](social/faction-management.md) — player-faction tier qualifier; colony-defense events
- [phasing.md](phasing.md) — Phase 6+
