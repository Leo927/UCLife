# Research and faction unlocks (Phase 5.5.6 — Civilian Faction)

The faction-tier progression spine. Researchers in a player-owned
research lab generate research progress over time; completed research
grants faction-level effects (numerical) and unlocks (binary gates)
that the rest of the game reads from. This is the channel through
which a Phase 5.5 city player makes their faction *better at being a
faction* — better factories, more efficient workers, eventually access
to weapon blueprints, ship classes, and colony facility types at Phase
6+.

## What this layer is for

Owning facilities and hiring people gives the player a flat economy.
Without a progression spine, a player who's bought a bar by month 3 is
doing the same thing in month 6 that they were doing in month 3 — just
with a bigger bank account. Research is the **investment channel**:
progress accumulates, gates fall, the kit changes shape. It is also
the natural seat for "you just unlocked X" content — MS weapon
blueprints, ship classes, colony facility types, and the higher rows
of every facility's tier ladder ([facility-tiers.md](facility-tiers.md)).

The mechanism is deliberately RimWorld-ish: a researcher at a bench,
time passing, a tree of options. The diegetic surface is the embodied
researcher, with dense queue + tree management routed through a
`"show me the planner"` verb on that conversation. The data model is
one **Research** entry → effects + unlocks, applied to the **owning
faction**.

## The research lab as a facility class

A new facility class, listed by the realtor as `factionMisc`. It ships
with the same shape every facility has at this scale:

- **Owner** — character | faction (per
  [facilities-and-ownership.md](facilities-and-ownership.md)).
- **Job sites** — `researcher` seats. **At tier-1 the lab has one
  researcher seat.** Additional seats land via the job-site-count tier
  on the lab itself ([facility-tiers.md](facility-tiers.md)) — the lab
  dogfoods the universal tier system instead of hardcoding two seats.
- **Worker on duty is the surface** — no clickable bench. Owner-side
  and player-facing verbs route through the seated researcher per the
  worker-not-workstation rule.

If the lab is unowned or has no researcher on shift, it produces no
research progress and exposes no verbs. The dark lab is the legible
signal that progress has stopped.

## Faction stats and faction effects

Factions get a `FactionStatSheet` parallel to the per-character sheet.
Same engine (`src/stats/sheet.ts`), same `Modifier` shape (`flat |
percentAdd | percentMult | floor | cap`), same Effect family contract
from [../characters/effects.md](../characters/effects.md). What
differs is the schema — a different list of stat ids, scoped to
faction-level levers:

| Group | Stat ids (initial) | Default base | Read by |
|---|---|---|---|
| Economy | `revenueMul`, `salaryMul`, `maintenanceMul` | 1.0 | dailyEconomics |
| Research | `researchSpeedMul` | 1.0 | researchSystem |
| Recruitment | `recruitChanceMul` | 1.0 | recruitmentSystem |
| Loyalty drift | `loyaltyDriftMul` | 1.0 | housingPressureSystem + on-job ticks |

A `FactionEffect` is an Effect entry on the faction's `Effects` list,
identical in shape to a character Effect. Source strings are
namespaced — `'research:factory-tier-2'`,
`'background:ae-subsidiary'` (slot, deferred),
`'condition:foreclosure-spree'` (slot, deferred).

This unifies authoring discipline: a research's payload is a list of
modifier rows against faction stat ids, the same shape a character
background or perk authors. Authors learn one DSL.

The existing `factionRevenueMultiplier` knob in the daily-economics
formula now resolves to `getStat(faction.sheet, 'revenueMul')`. No
ad-hoc field; the StatSheet is the single channel.

## Faction unlocks: separate from stats

Binary gates — *the GM Cannon blueprint is now buildable*, *tier-2
factory capacity is now installable*, *warship slipway facility class
is now constructable at colonies* — **do not live on the StatSheet.**
They live on a parallel `FactionUnlocks: Set<string>` trait.

Why split: a stat sheet is the right tool for additive numerical
modifiers (`revenueMul = 1.0 + 0.1 + 0.05`) and the wrong tool for "a
flag that is either set or unset." Modeling 100+ unlock flags as 100+
stats with `base = 0` and a `flat = +1` modifier *works*, but it
pollutes the stat schema with one entry per piece of game content,
which is poor signal-to-noise for both authors and inspector mode.
Two shapes, two engines:

- **Numerical levers** → faction stat + modifier. The player feels
  the gradient.
- **Binary unlocks** → string in `FactionUnlocks`. The player sees
  the option appear.

Consumers query the faction's set: the MS broker's available-frames
list filters on `faction.unlocks.has('blueprint:gm-cannon')`; the
factory's manage-interactable shows tier-2 as available iff
`faction.unlocks.has('upgrade:factory-tier-2')`. The unlock id is the
contract; what produced it is the research's business.

## Research data shape

`src/data/research.json5`. One row per research. Pure authoring;
immutable at runtime.

```js
{
  id: 'factory-tier-2',
  nameZh: '工厂扩容 II',
  descZh: '提升工厂的最大产能上限。',
  flavorZh: '车间老师傅画了三天图纸，说："这才像个厂子。"',
  cost: 500,                            // research progress required
  prereqs: [],                          // other research ids that must be done first
  effects: [],                          // FactionEffect modifier rows (numerical levers)
  unlocks: ['upgrade:factory-tier-2'],  // strings added to FactionUnlocks
  category: 'economy',                  // for tree grouping in the planner
  significant: false,                   // newsfeed flag
}
```

Everything quantitative is data — no magic numbers in code.

## Daily progress generation

At `day:rollover`, after `dailyEconomics` (so research can react to
today's economy), `researchSystem` walks every faction-owned research
lab:

```
for each research lab L owned by faction F:
  for each seated researcher R at L during today's shift:
    progress = baseResearchPerShift
             × R.workPerformance
             × L.efficiencyTier.mul     // facility-tier system
             × getStat(F, 'researchSpeedMul')
    F.researchProgress += progress
```

`F.researchProgress` accumulates against the head of the queue. When
`progress ≥ head.cost`, the head completes: its effects are applied to
the faction's Effects list and its unlocks are added to
`FactionUnlocks`. **Overflow** rolls into the next queued research. If
the queue is empty, overflow is **lost** — and the loss is reported,
not silent (see "Visibility").

## Queue mechanics

- **Add to queue** — append research id; the system validates prereqs
  cleared, not already done, not already in queue.
- **Remove from queue (non-head)** — drops the entry; no progress
  involved.
- **Reorder via drag** — drag rows in the planner. Reordering the
  *head* downward forfeits its accumulated progress; the player gets a
  one-time confirm prompt that names the cost ("将丢失 67 进度"). Other
  reorders are free.
- **Cancel head** — same as reorder-out-of-head; accumulated discards
  with confirmation.

Discarding accumulated progress on head displacement is the friction
that makes "queue order is a real commitment" rather than free
re-planning.

## Visibility: lost overflow + ETAs are first-class

Two failure modes the player has to be able to see:

1. **Lost overflow** — when the queue is empty and the lab still
   produces progress, that day's lost amount surfaces in:
   - the **planner's "today" line** (`今日产出 12 进度，队列为空，已丢
     失`), and
   - the **secretary's `bookSummary`** brief at the faction office
     ("研究室昨日产出 12 进度无去处。"), if a faction office exists.
2. **ETAs** — every queued research displays an estimate:
   `≈ ⌈(cost − accumulated) / yesterdayPerDay⌉ 天`. Yesterday's
   per-day rate is the basis (not a 7-day average) — it tracks
   workPerformance / efficiency-tier changes immediately and the
   wobble is the player's first signal that something changed at the
   lab.

A silent failure mode is a bug. Both lines are required content for
5.5.6 — not deferred polish.

## Surface: the researcher delegate

Standing at the seated researcher and opening the talk-verb exposes
short consultative options — the secretary pattern from
[facilities-and-ownership.md](facilities-and-ownership.md#the-secretary-is-a-delegate-not-a-god-panel),
applied here:

- **"现在在搞什么？" — "Any progress?"** → embodied status: head
  research nameZh, today's progress, ETA, queue length. One paragraph,
  in-character.
- **"有什么新的可以研究的？" — "What could we look into?"** → ~5
  newly-eligible researches (prereqs cleared, not yet queued or done).
  Pick one to queue at the back. This is a starting tap, not the
  catalog.
- **"先停下手头的吧。" — "Stop the current work."** → cancels head
  with confirm.
- **"给我看一下计划。" — "Show me the planner."** → opens the dense
  panel (below).

The researcher is a delegate. Anything denser routes through one
verb: *show me the planner*.

## Surface: the planner (dense view)

The one allowed dense view in this layer. Opens from the researcher's
`"show me the planner"` verb.

- **Tree** — categorized rows (economy / military / colony /
  quality-of-life). Each row shows status (locked / available /
  in-queue / done), nameZh, descZh, cost, ETA at current rate, and a
  preview of what completing it does (effect rows + unlock strings,
  rendered as zh-CN human-readable lines).
- **Queue** — drag-reorder, add, remove. Head row shows accumulated
  progress as a fraction of cost. Reorder-out-of-head prompts confirm.
- **Today** — yesterday's progress, today's projected progress, and
  any lost-overflow tally.

Locked rows show their gate text inline (`需要前置研究: 工厂扩容 I`)
— never blank, never hidden. The player can plan paths through the
tree from day one even when most of it is locked.

If the catalog grows past what the researcher's verb can comfortably
gate (>~30 rows in the tree, plausibly Phase 6+), the planner can be
promoted to a **walkable wall whiteboard** in the lab scene — the
war-room exception from
[diegetic-management.md](diegetic-management.md#the-war-room-is-the-one-allowed-abstraction).
Not 5.5.6 work; the verb-anchored panel is sufficient at launch
catalog size.

## The first research: Factory Capacity II

The 5.5.6 demo research. Cost ≈ 3 weeks of single-researcher output at
default workPerformance (specific number lives in `research.json5`).

- **Effects** — none on the StatSheet.
- **Unlocks** — `upgrade:factory-tier-2`.

The factory's manage-interactable
([facility-tiers.md](facility-tiers.md)) reads this unlock and
surfaces the tier-2 row. Before the unlock fires, the row is
**visible-but-locked** with explicit gate text (`需要研究: 工厂扩容
II`). The locked row is the diegetic seed — a player who never owned
a research lab still sees the gate, and that's how they learn research
exists.

## Significant-research newsfeed

A research with `significant: true` emits a one-line newsfeed entry on
completion (`<faction.name> 完成研究: <research.nameZh>`). Use
sparingly — the factory-tier-2 unlock is *not* significant; an
"Anaheim wins the beam-saber license bid" canon-touching research
*is*. This is hair complexity that costs one author flag.

## Faction-tier governance hook (Phase 6.4)

Phase 6.4's council chamber can pass a faction policy that modifies
`researchSpeedMul` against named categories — "this faction is going
to focus on military research," etc. The Effect that policy emits is
just another row on the FactionEffects list. No new mechanism; the
policy lever is data on a council outcome.

## Phasing

| Phase | Scope |
|---|---|
| **5.5.6** | Research lab facility class + realtor `factionMisc` listing. `FactionStatSheet` + `FactionEffects` + `FactionUnlocks` traits. `researchSystem` at `day:rollover`. `research.json5` authoring; first research = `factory-tier-2`. Researcher consultative talk-verb + planner panel. Per-day progress + overflow + lost-if-empty with visible reporting. Save handlers (`FactionStatSheet`, `FactionEffects`, `FactionUnlocks`, queue + accumulated). |
| **5.5.7** | Authoring pass: ~10 economy / quality-of-life researches that exercise the FactionStatSheet (`revenueMul`, `recruitChanceMul`, `researchSpeedMul`, `loyaltyDriftMul`) plus ~3 facility-tier-gating unlocks per facility class. |
| **6.0+** | Authoring pass: military researches that unlock MS weapons, frame mods, ship classes, colony-only facility types. Promote planner to walled whiteboard if catalog surpasses verb-clarity threshold. |
| **6.4** | Council-chamber policy outcomes can author FactionEffects against named research categories. |

## Related

- [facility-tiers.md](facility-tiers.md) — investment-into-owned-facility system; research is what unlocks higher tiers
- [facilities-and-ownership.md](facilities-and-ownership.md) — research lab is a `factionMisc` facility under this layer; the `factionRevenueMultiplier` knob now folds through `FactionStatSheet`
- [diegetic-management.md](diegetic-management.md) — researcher = consultative delegate; planner is the verb-anchored dense exception until catalog scale earns a walked artifact
- [../characters/effects.md](../characters/effects.md) — Effect + StatSheet engine reused for the faction-side sheet
- [faction-management.md](faction-management.md) — Phase 6 fleet / colony unlocks (MS, ship classes, colony-only facilities) live behind research gates
- [../fleet.md](../fleet.md) — MS broker / ship broker filter availability against `FactionUnlocks`
- [../phasing.md](../phasing.md) — sub-phasing
