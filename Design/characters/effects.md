# Effects

The unified data model for "things that are currently true about a
character that change their numbers." Backgrounds, perks, conditions
(illness / injury / chronic stub), and future gear all reduce to the
same shape: an `Effect` carrying a list of `Modifier`s, plus optional
display metadata. The character's `StatSheet` is the fold of every
active Effect's modifiers over the base values. There is no second
"channel" engine — every gameplay lever a perk or condition wants to
pull is expressed as a Modifier on a Stat.

This file pins the data shapes, the compute order, the new ModType
entries (`floor`, `cap`), the banded-effects mechanism conditions use,
and the migration plan for backgrounds / perks / skills / conditions
onto Effects.

## Why one model

Three forces pulled toward unification:

1. **Two parallel modifier engines were drifting apart.** `src/stats/`
   already had `Modifier { statId, type, value, source }` for backgrounds
   and perks; the physiology spec was sketching a second `EffectModifier`
   shape with extra "channels" (`attributeFloor`, `attributeCap`,
   `skillMalus`, `actionLockout`, `workPerfMul`, `moodDebit`). Two
   serialization formats, two fold paths, two sets of authoring rules —
   for one underlying concept.
2. **The "channels" all reduce to stats once you allow more stats.** A
   strength cap of 30 is a `cap`-type modifier on `strength`. A skill
   malus is a `flat` modifier on the skill stat. A work-perf reduction
   is a modifier on `workPerfMul`. An action lockout is `walkSpeed = 0`.
   Adding two ModType entries (`floor`, `cap`) and promoting verb
   speeds + work-perf-mul + skills into the sheet covers every channel
   the physiology design listed.
3. **Authoring discipline.** "Modify this stat by this amount" is the
   only authoring shape an author needs to learn. Backgrounds, perks,
   gear, and condition templates all read the same way — a list of
   modifier rows — so the JSON5 catalogs stay homogeneous.

The cost is a bigger StatSheet (roughly 50 stat ids per character
instead of 17). Negligible at the entity counts we run.

## Effect

```ts
interface Effect {
  // Unique within this character's Effects list. Upstream systems
  // pick the format — e.g. 'bg:soldier', 'perk:long_distance',
  // 'cond:c-7f3a:peak' (instance + band index).
  id: string

  // Back-reference the upstream system uses to find / cleanup its own
  // Effects without scanning by id-prefix substring. ConditionInstance
  // sets this to instanceId; backgrounds set it to the background id.
  originId: string

  family: 'background' | 'perk' | 'condition' | 'gear'

  modifiers: Modifier[]

  // Display metadata — none of these participate in the fold.
  nameZh?: string
  descZh?: string
  flavorZh?: string         // condition symptom blurb at this severity band
  glyphRef?: string
  hidden?: boolean          // undiagnosed illness on the player; latent perks
  startedDay?: number
  expiresDay?: number | null
}
```

The `Effects` trait is `{ list: Effect[] }`. Effects are the **source
of truth**; the StatSheet's modifier arrays are derived. On Effect-list
mutation the sheet's modifier arrays rebuild from `flatMap(effect =>
effect.modifiers)`. Memoization on the sheet's `version` field stays
unchanged.

## ModType extension

```ts
type ModType = 'flat' | 'percentAdd' | 'percentMult' | 'floor' | 'cap'
```

Compute order:

```
val = (base + Σflat) × (1 + ΣpctAdd) × Π(1 + pctMul)
val = max(val, max(...floors))    // most generous floor wins
val = min(val, min(...caps))      // most restrictive cap wins
                                  // tie rule: when cap < floor, cap wins
                                  // (disabled trumps inspired)
```

Tie-break rationale: a "broken arm capped at strength 30" must beat a
"god-mode bracelet with a strength floor of 50" — the disabled state
matters more than the buff. RimWorld lands the same way.

`floor` and `cap` are stat-level clamps on the **folded** value. They
do not affect the `base`. Drift continues to write `base` only and
makes its own clamp decisions (see *Talent vs. cap modifiers* below).

## Stat catalog growth

Adding the channels-as-stats means new entries in `src/stats/schema.ts`:

| Group | Stat ids | Default base | Read by |
|---|---|---|---|
| Verb speeds | `walkingSpeed`, `eatingSpeed`, `sleepingSpeed`, `washingSpeed`, `workingSpeed`, `readingSpeed`, `drinkingSpeed`, `revelingSpeed`, `chattingSpeed`, `exercisingSpeed` | 1.0 | action FSM |
| Work performance | `workPerfMul` | 1.0 | `workSystem` |
| Skills (values) | `mechanics`, `marksmanship`, `athletics`, `cooking`, `medicine`, `computers`, `piloting`, `bartending`, `engineering` | XP-driven base | every system that reads a skill check |
| Skills (XP rate) | `<skill>XpMul` (×9) | 1.0 | XP-grant code |
| Mood drain (Phase 5) | `moodDrainMul` | 1.0 | Phase-5 mood system |

Verb-speed semantics: action FSM decrements `remaining` per tick by
`(dt × speed)`. Speed = 0 means the action never finishes — the FSM's
existing terminal check converts this into "action cannot complete,"
which is exactly what `actionLockout` was supposed to provide. A 0.5
speed means a limp; 1.5 means an athletic gait. Soft gradients fall
out of the same mechanism that handles binary lockout, free.

Work performance: `workSystem` switches from inline computation to
`getStat(sheet, 'workPerfMul')`. The base value is set by attribute
multipliers + tenure (existing logic, packaged into a single derived
formula on the stat). Conditions, perks, and gear stack `percentMult`
modifiers on top.

Skills: today `Skills` is a plain trait of integers
(`src/ecs/traits/character.ts:58`). Promotion into the sheet means:
- Skill **value** becomes a stat with `base` driven by XP (XP-to-level
  formula stays in `src/character/skills.ts`).
- Skill **XP gain rate** becomes a separate stat (`<skill>XpMul`) that
  perks like `skillXpMul` modify directly (currently bypasses the
  sheet — see `src/character/perks.ts:13`).

Mood drain: deferred. The stat enters the schema only when the Phase-5
mood layer ships. Authoring a condition that needs a mood debit
*before* mood ships is allowed — the modifier sits inert on a base of
1.0 with no consumer until Phase 5 wires it up.

## Banded condition effects

Conditions are the only Effect family with severity-driven modifier
sets. The template authors what Effects a bout produces at what
severity ranges; the engine reconciles the active set every time
severity changes.

```ts
interface BandedEffect {
  severityRange: [min: number, max: number]   // inclusive on both ends
  effect: EffectSpec                           // Effect template minus runtime fields
}

interface ConditionTemplate {
  // ... onset / lifecycle / recovery fields (unchanged from physiology-data.md)
  effects: BandedEffect[]
}
```

**Ranges may overlap.** The template can author a "mild fatigue
×1.2 always-on" entry (range `[20, 100]`) alongside a "severe fatigue
×1.5 stack" entry (range `[60, 100]`). At severity 70 both apply,
producing two separate Effects on the character; the StatSheet fold
adds them. This keeps each band's flavor text and glyph independent —
the player sees one Effect named "感冒(轻症)" plus a second named
"感冒(高烧)" — without forcing the author to write three exclusive
mutually-non-overlapping bands by hand.

The reconciler:

```
on instance.severity change:
  prevActiveBands = previously matching bands (cached on instance)
  nextActiveBands = template.effects.filter(b =>
    severity >= b.severityRange[0] && severity <= b.severityRange[1])

  for band in (prevActiveBands - nextActiveBands):
    remove Effect 'cond:<instanceId>:b<bandIndex>' from character

  for band in (nextActiveBands - prevActiveBands):
    add Effect 'cond:<instanceId>:b<bandIndex>' from band.effect

  instance.activeBands = nextActiveBands
```

The reconciler runs only on severity change — once per game-day during
the phase tick — and only emits add/remove operations when membership
flips. Per-tick reads of the StatSheet do not trigger any band logic.

**Lookup data structure.** For the realistic N (<10 bands per
template), `template.effects` is a plain array sorted by
`severityRange[0]`. The reconciler's `filter` is a linear scan. If a
future condition authors dozens of bands, swap to an interval tree
behind the same query function — no caller change. Don't pre-optimize.

**Stacking is upstream's job.** The Effects layer stores and folds. It
does not know "two soldiers is illegal" or "two flus on one character
is illegal." Each upstream system enforces its own rules:

| System | Stacking policy | Enforcement |
|---|---|---|
| Backgrounds | At most one per character | Character creator |
| Perks | Unique by id (id is the apply-once key) | `Ambitions.perks` is a string set |
| Conditions | Unique by `(templateId, bodyPart)` | Onset roll checks `Conditions` list |
| Gear (future) | Slot-based (one helm, one chest, …) | Equip system |

## Talent vs. cap modifiers

Talent is **not** a `cap`-type Modifier. It is a property of the drift
mechanism that bounds where `base` is allowed to settle.

```
drift writes base only:
    base += (target − base) × DRIFT
    target = clamp(recentUse × talent − recentStress, FLOOR, talentCap)

modifiers fold over base:
    val = (base + Σflat) × (1 + ΣpctAdd) × Π(1 + pctMul)
    val = max(val, max(...floors))
    val = min(val, min(...caps))
```

The two clamps live at different layers:
- **Talent** clamps `base` (where the natural range settles via drift).
- **Modifier `cap`** clamps the folded `val` (situational ceilings —
  injury, gear lockout).

A character with talentCap = 80 wearing a +10 strength belt reads
strength 90 (gear stacks past natural ceiling). The same character with
a broken-arm condition emitting `cap = 30` reads strength 30 (injury
overrides gear). When the injury resolves, strength returns to 90 with
no drift work. This is the intended split.

## Effects trait + save shape

The `Effects` trait replaces ad-hoc per-source modifier emission today
(`stats/perkSync.ts`, `character/backgrounds.ts` writing the sheet
directly).

```ts
export const Effects = trait(() => ({
  list: [] as Effect[],
}))
```

Save shape:

```json
{
  "Effects": { "list": [/* Effect POJOs */] },
  "Attributes": {
    "sheet": { "stats": { "<id>": { "base": <n> } }, "version": 1 },
    "drift": { /* unchanged */ },
    "lastDriftDay": <n>
  }
}
```

The serialized StatSheet drops the per-stat `modifiers` array — those
are derived. On load, the engine reads `Effects.list` and rebuilds the
sheet's modifier arrays before any system ticks. This shrinks save
size (modifiers were the bulky part of the sheet) and eliminates the
"modifier in save doesn't match an active source" inconsistency class.

## Reconcile / fold cadence

| Trigger | Work |
|---|---|
| `addEffect(e)` / `removeEffect(id)` | Append / remove from `Effects.list`; rebuild affected stats' modifier arrays; bump `sheet.version` once |
| Condition severity change (game-day) | Reconciler runs; emits 0+ add/remove ops |
| Per-tick stat read | `getStat()` — memoized by `version`, O(1) on cache hit |

There is no separate "effects fold cache." The StatSheet *is* the
fold. The cost of an Effect-list mutation is one rebuild of the
modifier arrays on touched stats; in practice fewer than five stats per
mutation.

## Migration plan

The Effects layer can land first; the channel consumers (verb-speed,
skills-as-stats, work-perf, conditions) sequence on top.

| Step | Scope | Player-visible? |
|---|---|---|
| 1. Effects trait + ModType `floor` / `cap` | New trait + sheet math + tests | No |
| 2. Backgrounds → Effect emitter | Replace `applyBackground()` with "produce Effect, push to list"; sheet rebuild flows from there | No (numbers unchanged) |
| 3. Perks → Effect emitter | Replace `syncPerkModifiers()`; non-`vitalDecay` perks (`wageMul`, `shopDiscountMul`, `rentMul`, `skillXpMul`) start round-tripping through the sheet | Yes — the four perk kinds that bypassed the sheet today now stack correctly |
| 4. Skills migration | Skills move into StatSheet; XP code writes `base`; consumers read via `getStat()` | No (numbers unchanged) |
| 5. Verb-speed stats | Add 10 `<verb>Speed` stats; action FSM switches to `getStat()` per tick | No (all bases at 1.0) |
| 6. `workPerfMul` stat | `workSystem` switches to `getStat()` | No |
| 7. Condition Effects | Phase 4.0 conditions — banded reconciler, first condition (cold) | Yes — Phase 4.0 demo |
| 8. Mood drain stat | Phase 5 — `moodDrainMul` stat + consumers | Yes — Phase 5 |

Steps 1–2 are mechanical and land in one PR. Steps 3, 4, 5, 6 each
land independently — each unlocks a class of condition effect without
needing the others first. Step 7 (Phase 4.0 conditions) requires
steps 1, 5, and 6 at minimum (verb-speed for stalled-injury lockouts;
work-perf for "flu reduces shift output"). Step 8 is on the Phase 5
critical path.

## What this enables

- **One authoring shape.** Background row, perk row, condition
  template row, gear row — all author a list of modifier entries
  against stat ids. Authors learn one DSL.
- **One fold path.** `getStat()` already memoizes per `version`;
  Effect mutations bump `version` once. No second fold cache.
- **One save shape.** `Effects.list` plus per-stat `base`. No per-stat
  modifier arrays in the save.
- **Soft + hard gates collapse.** A 0-speed verb is a hard lockout;
  0.5-speed is a soft slowdown — same mechanism. Authors don't pick
  between two lockout shapes.
- **Effect cards in UI come for free.** Each Effect is one row in the
  player's status panel. Conditions show as 1+ rows per active band,
  with the band's `flavorZh` as the body text. Backgrounds, perks, and
  gear all render through the same component.

## Related

- [attributes.md](attributes.md) — StatSheet engine; this file extends its ModType set and grows its stat catalog
- [physiology.md](physiology.md) — condition lifecycle; the banded effects mechanism described here is what its "effects fold" reduces to
- [physiology-data.md](physiology-data.md) — `ConditionTemplate.effects` adopts the BandedEffect shape pinned in this file (drops `EffectModifier.channel`, `minSeverity`, `maxSeverity`)
- [../saves.md](../saves.md) — save round-trip contract; Effects trait is part of the player snapshot
