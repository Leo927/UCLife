# Physiology — Data model (Phase 4)

The system spec ([physiology.md](physiology.md)) describes onset paths,
lifecycle, recovery modes, treatment tiers, and contagion. The UX pass
([physiology-ux.md](physiology-ux.md)) describes how the player perceives
and acts on those. This file is the **data-model** pass: the two concrete
shapes the engine reads and writes.

## Why two shapes

A condition has two halves that change at very different cadences:

- **What a condition *is*** — its bands, its required treatment, its
  modifiers, its scar-out partner — is **authored once** and frozen.
  Editing it is a content task.
- **What this character's current bout looks like** — phase, severity,
  rolled durations, treatment in flight, peak tracking — **mutates every
  game-day** and round-trips through saves. Editing it is what the engine
  does.

Cramming both into one record forces every per-tick read to walk fields
it doesn't care about, makes saves balloon (you'd serialize `[1, 3]` band
ranges per active condition), and — the real hazard — invites authors to
edit live state. Splitting them keeps logic data-agnostic: the phase
machine, the band reconciler, and the recovery formula all read
templates, write instances, and never touch authored data.

```
ConditionTemplate          ConditionInstance
(static, frozen, JSON5)    (per-character, mutable, serialized)
        │                            │
        │  rolled at onset           │
        ├───────────────────────────►│  incubationDays, riseDays,
        │  (band → scalar)           │  peakSeverity, peakDays
        │                            │
        │  read each phase tick      │
        ├───────────────────────────►│  severity, phase, peakDayCounter
        │  (recoveryMode →           │
        │   formula dispatch)        │
        │                            │
        │  read on severity change   │
        ├──┐                         │  (no field on the instance —
        │  │ band reconciler         │   add/remove ops emitted into
        │  └─► character's Effects   │   the character's Effects trait,
        │     trait (effects.md)     │   keyed cond:<instanceId>:b<n>)
        │                            │
        │  read at resolve           │
        ├───────────────────────────►│  scar branch decision
        │  (scarThreshold,           │
        │   scarConditionId)         │
```

Templates are loaded from `src/data/conditions.json5` once at module
import and frozen. Instances live on the character's `Conditions` trait
list and are part of the save snapshot.

## ConditionTemplate

One row per condition id in `src/data/conditions.json5`. Authoring-only;
never mutated at runtime.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable key; used as instance reference. **Never rename** — saves break. Tombstone retired ids instead. |
| `displayName` | zh-CN string | Canonical name shown post-diagnosis (player) and always (inspector / NPCs) |
| `family` | enum | `acute` / `injury` / `chronic` / `mental` / `pregnancy`. Drives HUD glyph, body-part scope default, scar branching policy |
| `bodyPartScope` | enum | `systemic` (no body part) / `bodyPart` (one of {head, torso, leftArm, rightArm, leftLeg, rightLeg, hands, eyes}); injury templates use `bodyPart`, illnesses systemic |
| `recoveryMode` | enum | `treatment` / `lifestyle` / `chronic-permanent`. Discriminator — fields below are conditional on this. |
| `onsetPaths` | string[] | Subset of `vitals_saturation` / `ingestion` / `environment` / `contagion` / `behavior_pattern`. Declarative — the system that owns the cause checks this list before rolling. |
| `incubationDays` | `[min, max]` | Game-day range; rolled at onset |
| `riseDays` | `[min, max]` | Game-day range from rising→peak; rolled at onset |
| `peakSeverity` | `[min, max]` | 0–100 ceiling for this bout; rolled at onset |
| `peakDays` | `[min, max]` \| number | Game-days held at peak before exit; rolled at onset (default 1) |
| `peakSeverityFloor` | number | Clamp on `peakSeverity − peak_reduction_by_tier`; keeps treated illness non-trivial |
| `baseRecoveryRate` | number | Severity points/day during recovering, before endurance/treatment multipliers |
| `requiredTreatmentTier` | number | Ordinal; see *Treatment tier scale* below. **`recoveryMode = 'treatment'` only.** |
| `complicationRisk` | `{ daily: number, spawns: string }` | Daily prob of spawning the linked condition id while stalled. **Treatment mode only.** |
| `lifestylePredicates` | `{ ids: string[], requiredPerDay: number, driftRate: number }` | N-of-M predicate gate. **`recoveryMode = 'lifestyle'` only.** Predicate catalog lives in mood layer (Phase 5). |
| `severityFloors` | `{ pharmacy?: number, clinic?: number }` | Lifestyle-mode adjunct floors — meds/therapy raise the floor without resolving |
| `infectious` | bool | If true, contagion system reads the next two fields |
| `transmissionRate` | number | Per active-zone contact-tick probability |
| `contactRadius` | number | Tile-space radius for the SIR broad-phase |
| `scarThreshold` | number | If `instance.peakTracking ≥ scarThreshold` at resolve, spawn the scar |
| `scarConditionId` | string \| null | Chronic-family template id to spawn on scar; null = no souvenir possible |
| `scarTalentPenalty` | `{ stat: string, capDelta: number }` | Permanent talent-cap delta written to the scar instance, e.g. `{ stat: 'endurance', capDelta: -5 }` |
| `selfTreatVerbs` | `SelfTreatVerb[]` | First Aid unlocks (see below) |
| `effects` | `BandedEffect[]` | What this condition does to the character — see below |
| `symptomBlurbs` | `{ mild: string, moderate: string, severe: string }` | zh-CN, undiagnosed-card body text per severity tier |
| `eventLogTemplates` | `{ onset, diagnosis, recoveryClean, recoveryScar, complication, stalled }` | zh-CN line templates with `{source}` `{day}` `{name}` placeholders |
| `glyphRef` | string | HUD strip icon key |

### `BandedEffect`

> Superseded shape. Earlier drafts of this file authored a flat
> `EffectModifier[]` with per-row `channel` / `minSeverity` /
> `maxSeverity` fields. That has been collapsed into the unified
> [Effects](effects.md) data model: there are no "channels," only
> `Modifier`s on `Stat`s, and the severity band lives **on the band
> entry**, not on the modifier.

`ConditionTemplate.effects` is a list of `BandedEffect` rows. Each row
declares: "while severity is within this range, apply this Effect to
the character."

| Field | Type | Notes |
|---|---|---|
| `severityRange` | `[min, max]` | Inclusive on both ends. Ranges may overlap any other band — at severity 70 both a `[20, 100]` and a `[60, 100]` band can be simultaneously active. |
| `effect` | `EffectSpec` | An [Effect](effects.md#effect) template (same shape minus runtime fields like `id` / `startedDay`). Carries `modifiers: Modifier[]` plus `nameZh` / `flavorZh` / `glyphRef` for the player's status panel. |

The reconciler runs on severity change, computes the active band set,
and adds / removes the matching Effect on the character's `Effects`
trait. See [effects.md § Banded condition effects](effects.md#banded-condition-effects)
for the full algorithm and lookup-data-structure note.

### Treatment tier scale

Tiers are **ordinal numbers**, not enum strings. The recovery gate is the
plain comparison `instance.currentTreatmentTier >= template.requiredTreatmentTier`,
and per-tier multiplier tables (peak reduction, recovery multiplier) are
arrays indexed by tier. Encoding tiers as strings would force a parallel
ordering map; ordinals make the comparison self-documenting and the tables
indexable.

| Tier | Name | Meaning |
|---|---|---|
| 0 | untreated | Self-care (sleep + water). Default for fresh instances. |
| 1 | pharmacy | OTC meds; First Aid verbs default here when unlocked |
| 2 | clinic | Civilian clinic prescription, AE clinic prescription |

The scale is intentionally short and open-ended at the high end — a
future trauma-tier or research-grade tier can extend to 3+ without a
save break (numeric fields default-init cleanly on old saves).

The AE clinic is **tier 2**, same as civilian clinic. Its faction perk is
not a tier bump; it's a sidecar of additional benefits — extra peak
reduction, reduced scar threshold — applied via the `TreatmentEvent`
that committed it. Tier comparisons stay clean.

UI strings (`'药店'`, `'诊所'`, the stalled-badge copy) live in
zh-CN; numeric tiers never reach the player.

### `SelfTreatVerb`

Authored entries on the template. Running one populates
`instance.selfTreatActive` for its window.

| Field | Type | Notes |
|---|---|---|
| `verb` | string | `bandage` / `splint` / `clean_wound` / … |
| `requiresSkill` | number | First Aid threshold |
| `requiresItem` | string | Inventory key (`gauze`, `splint`, `antiseptic`) |
| `equivalentTier` | number | What tier this verb counts as for the recovery gate (typically 1 / pharmacy) |
| `dailyReduction` | number | Severity points/day on top of base recovery, while active |
| `durationDays` | number | How long the verb's effect lasts |

### Example template

```json5
{
  id: 'cold_common',
  displayName: '感冒',
  family: 'acute',
  bodyPartScope: 'systemic',
  recoveryMode: 'treatment',
  onsetPaths: ['vitals_saturation', 'contagion'],

  incubationDays: [1, 2],
  riseDays: [1, 2],
  peakSeverity: [35, 55],
  peakDays: 1,
  peakSeverityFloor: 20,
  baseRecoveryRate: 12,

  requiredTreatmentTier: 0,  // untreated — colds resolve on self-care
  complicationRisk: null,

  infectious: true,
  transmissionRate: 0.02,
  contactRadius: 1.5,

  scarThreshold: 80,
  scarConditionId: null,
  scarTalentPenalty: null,

  selfTreatVerbs: [],

  effects: [
    {
      severityRange: [20, 100],
      effect: {
        family: 'condition',
        nameZh: '感冒(轻症)',
        flavorZh: '你有些鼻塞,喉咙发痒。',
        modifiers: [
          { statId: 'fatigueDrainMul', type: 'percentMult', value: 0.3 },
          { statId: 'workPerfMul',     type: 'percentMult', value: -0.2 },
        ],
      },
    },
    {
      severityRange: [60, 100],
      effect: {
        family: 'condition',
        nameZh: '感冒(高烧)',
        flavorZh: '你高烧不退,几乎下不了床。',
        modifiers: [
          { statId: 'workPerfMul', type: 'percentMult', value: -0.4 },
        ],
      },
    },
  ],

  symptomBlurbs: {
    mild:     '你有些鼻塞,喉咙发痒。',
    moderate: '你浑身发冷,关节酸痛。',
    severe:   '你高烧不退,几乎下不了床。',
  },

  eventLogTemplates: {
    onset:          '{name}感冒了。{source}',
    diagnosis:      '{name}在{clinic}确诊感冒。',
    recoveryClean:  '{name}的感冒好了。',
    recoveryScar:   null,
    complication:   null,
    stalled:        null,
  },

  glyphRef: 'illness_respiratory',
}
```

## ConditionInstance

Entries in the `Conditions` trait list on each character. POJO; no
entity references; safe to JSON-serialize.

| Field | Type | Notes |
|---|---|---|
| `instanceId` | string | UUID-ish; uniqueness so two `injury_sprain` instances on different ankles don't collide |
| `templateId` | string | References `ConditionTemplate.id` |
| `phase` | enum | `incubating` / `rising` / `peak` / `recovering` / `stalled` |
| `severity` | number | 0–100, current |
| `peakTracking` | number | Max severity ever reached this bout; read at resolve for scar branching |
| `bodyPart` | string \| null | Pinned at onset; `null` if `template.bodyPartScope = 'systemic'` |
| `onsetDay` | number | Game-day stamp |
| `incubationDays` | number | Rolled from band at onset |
| `riseDays` | number | Rolled from band at onset |
| `peakSeverity` | number | Rolled from band at onset (this bout's ceiling, before treatment cap) |
| `peakDays` | number | Rolled from band at onset |
| `peakDayCounter` | number | Days elapsed at peak; reset when entering `peak` |
| `source` | string | Free-text apophenia tag — `'感染自李明(咳嗽)'`, `'在码头滑倒'`. Plain string, not entity ref — survives the source NPC's death/destroy. |
| `diagnosed` | bool | Player-only. NPCs read as diagnosed in inspector regardless. |
| `diagnosedDay` | number \| null | Set on diagnosis; drives the diagnosed card's "treatment record" line |
| `currentTreatmentTier` | number | Ordinal; see *Treatment tier scale* below. The active commitment, **not** a property of the template. |
| `treatmentExpiresDay` | number \| null | Day the current course lapses (e.g., 5-day pharmacy prescription). After this, `currentTreatmentTier` falls back to 0 (untreated) unless renewed. |
| `treatmentHistory` | `TreatmentEvent[]` | Append-only log: purchase / self-treat / lapse / clinic-visit. Drives the diagnosed card's history readback. |
| `selfTreatActive` | `SelfTreatActive \| null` | If a First Aid verb is currently boosting recovery: `{ verb, equivalentTier, dailyReduction, expiresDay }` |
| `lastDigestDay` | number | Last game-day a digest line was emitted; de-dup at rollover |
| `lastBandSurfaced` | enum | `mild` / `moderate` / `severe`. Last severity tier the HUD surfaced; pulse animation fires on change. |

Lifestyle-mode (`recoveryMode = 'lifestyle'`) instances additionally carry:

| Field | Type | Notes |
|---|---|---|
| `predicateMetTodayCount` | number | Set on day rollover; 0 if untracked yet today. Drives the digest readback. |
| `currentSeverityFloor` | number | Cached fold of `template.severityFloors` against active adjuncts; the daily decay clamps against this. |

### `TreatmentEvent`

One per treatment action taken on this instance:

| Field | Type | Notes |
|---|---|---|
| `day` | number | Game-day |
| `kind` | enum | `civilian_clinic` / `ae_clinic` / `pharmacy_purchase` / `self_treat` / `lapse` (descriptive category, not a tier) |
| `tierGranted` | number | Ordinal; see *Treatment tier scale* below |
| `durationDays` | number | How long this event's tier holds |
| `costMoney` | number | For player audit |
| `costRep` | `{ factionId: string, delta: number } \| null` | AE clinic burns rep |

### Example instance

```json
{
  "instanceId": "c-7f3a",
  "templateId": "cold_common",
  "phase": "rising",
  "severity": 28,
  "peakTracking": 28,
  "bodyPart": null,
  "onsetDay": 12,
  "incubationDays": 2,
  "riseDays": 2,
  "peakSeverity": 48,
  "peakDays": 1,
  "peakDayCounter": 0,
  "source": "感染自李明(咳嗽)",
  "diagnosed": false,
  "diagnosedDay": null,
  "currentTreatmentTier": 0,
  "treatmentExpiresDay": null,
  "treatmentHistory": [],
  "selfTreatActive": null,
  "lastDigestDay": 14,
  "lastBandSurfaced": "mild"
}
```

## Connections

| Engine moment | Reads | Writes |
|---|---|---|
| Onset | template bands, `bodyPartScope`, `onsetPaths` | new instance with rolled durations, `phase = incubating` |
| Day-rollover phase tick | template `recoveryMode`, `peakSeverityFloor`, `baseRecoveryRate`, `requiredTreatmentTier`, `complicationRisk`, `severityFloors` | instance `phase`, `severity`, `peakDayCounter`, `peakTracking`, optional spawn of complication instance |
| Effects reconcile | template `effects[]` × instance `severity` | add/remove Effects on the character's [`Effects`](effects.md#effects-trait--save-shape) trait — keyed `cond:<instanceId>:b<bandIndex>` |
| Diagnosis (clinic step 1) | template `displayName`, `requiredTreatmentTier`, base recovery params | instance `diagnosed = true`, `diagnosedDay`, append `TreatmentEvent` |
| Treatment commit (clinic step 2 / pharmacy / AE) | template `requiredTreatmentTier` | instance `currentTreatmentTier`, `treatmentExpiresDay`, append `TreatmentEvent` |
| Self-treat verb run | template `selfTreatVerbs[verb]`, character First Aid + inventory | instance `selfTreatActive`, append `TreatmentEvent`; consume item; award XP |
| Resolve (clean) | template `scarThreshold`, instance `peakTracking` | remove instance |
| Resolve (scarred) | template `scarConditionId`, `scarTalentPenalty` | remove instance, spawn fresh chronic-permanent instance pinned to same `bodyPart`, `source = '{parent.displayName}后遗症'` |

The phase machine reads only template fields and instance state. The
band reconciler reads only `template.effects[]` and `instance.severity`,
emitting add/remove ops on the character's `Effects` trait. The recovery
formula reads only template recovery params, character Endurance, and
instance `currentTreatmentTier`. No per-tick system needs to know "what
is a flu" — it reads the StatSheet, which is the fold of every active
Effect (see [effects.md](effects.md)).

## Save shape

The `Conditions` trait serializes as `{ list: ConditionInstance[] }`.
Each instance is plain JSON. Templates are not serialized — they're
code; saves load against current templates.

Implications:

- **Add fields to templates freely.** New fields default-init on instances
  loaded from older saves.
- **Never rename `ConditionTemplate.id`** — instance.templateId is the
  hard reference. Tombstone retired ids (keep the row, mark inert)
  instead of deleting.
- **`source` is a string, not an entity ref.** This is deliberate: the
  apophenia anchor is the *name*, and the source NPC may have been
  destroyed (scene migration, off-screen attrition) by the time the
  player reads the log line.
- **Body part is a string enum, not an entity.** Stable across saves.
- **`treatmentHistory` is append-only**, capped to the last N entries
  per instance (8 is plenty — the diagnosed card never shows more than
  the last 3) to bound save size on multi-week chronic cases.

## Effects placement

Conditions emit Effects into the character's [`Effects`](effects.md)
trait, identified by `cond:<instanceId>:b<bandIndex>`. There is no
per-condition fold cache — the StatSheet itself is the fold of every
active Effect's modifiers, memoized on its `version` field. Reconcile
triggers:

- onset / resolve / complication-spawn (instance list mutation → add /
  remove every band's Effect)
- severity crossing a band edge (one band's Effect goes on or off)
- treatment commit / lapse (only when it changes severity)

Per-tick reads are O(1) cache hits on the StatSheet. Reconcile is
O(bands per template), which is small (<10 per template). See
[effects.md § Reconcile / fold cadence](effects.md#reconcile--fold-cadence).

## What this enables

- **Authoring a new condition is a JSON5 edit.** No code change. Same
  authoring shape as backgrounds, perks, and gear (modifier rows on
  stat ids, per [effects.md](effects.md)).
- **The phase machine, band reconciler, recovery formula, and contagion
  all share one input format.** Adding a fifth recovery mode is a
  discriminator extension, not a parallel codepath.
- **Scar branching is a forward-reference.** A flu's `scarConditionId`
  points at a chronic-family template; that template is a normal row
  with `recoveryMode: 'chronic-permanent'`. No special-case scar logic.
- **Saves stay small.** ~20 fields × few active conditions ≈ <2 KB per
  character; templates contribute zero bytes to the save.
- **Mental-condition rows can ship as data when the lifestyle predicate
  catalog lands** (Phase 5). The schema is honest about what's missing
  via `recoveryMode = 'lifestyle'` requiring `lifestylePredicates`.

## Related

- [physiology.md](physiology.md) — system spec (lifecycle, recovery, treatment, contagion); this file is the data-shape pass over it
- [physiology-ux.md](physiology-ux.md) — the UI surfaces that read these shapes
- [effects.md](effects.md) — the unified Effect / Modifier model `ConditionTemplate.effects` produces into; canonical place for `BandedEffect`, ModType extension, fold rules
- [../saves.md](../saves.md) — save round-trip contract
- [attributes.md](attributes.md) — Attribute / StatSheet engine the Effects fold over
