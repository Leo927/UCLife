# Attributes (stats)

Six character attributes layered between vitals and skills. They represent **trained physical/mental capacity** — slow-moving, drift up *or* down with use and neglect. Distinct from vitals (instantaneous bodily state) and skills (learned proficiencies).

Inspired by *Jack o' Nine Tails*: stats are bidirectional, gated by a hidden per-character talent multiplier, and react to both deliberate training and chronic neglect.

| Stat | Domain |
|---|---|
| 力量 Strength | Physical labor, melee, lift caps, drink tolerance |
| 耐力 Endurance | Fatigue / hunger / thirst drain rates, HP regen, illness recovery |
| 魅力 Charisma | Social appeal, shop prices, bar tips, NPC opinion drift |
| 智力 Intelligence | Skill-learning rate, book efficiency, mental-job performance, error rate |
| 反应 Reflex | Reaction time, fine motor, movement speed; gates piloting |
| 意志 Resolve | Mood tolerance; gates Newtype-related skills and activity (Phase 7+) |

## Modifier-based StatSheet

The `Attributes` trait carries **one `StatSheet`** that holds far more than
the six attributes — it's the single modifier-stacking surface every system
reads when it needs an effective number. The schema, in
`src/stats/schema.ts`, registers these stat ids on every character:

| Group | Stat ids | Default base | Read by |
|---|---|---|---|
| Attributes | `strength`, `endurance`, `charisma`, `intelligence`, `reflex`, `resolve` | 50 | work / vitals / movement / skill XP / etc. |
| Vital maxes | `hungerMax`, `thirstMax`, `fatigueMax`, `hygieneMax`, `boredomMax` | 100 | vital clamp |
| Vital drain mults | `hungerDrainMul`, `thirstDrainMul`, `fatigueDrainMul`, `hygieneDrainMul`, `boredomDrainMul` | 1 | vitals system |
| Health | `hpMax`, `hpRegenMul` | 100 / 1 | health system |

Computation order (from the upstream C# CharacterStats reference, ported to
TS in `src/stats/sheet.ts`):

```
final = (formula(base) + Σflat) × (1 + ΣpercentAdd) × Π(1 + percentMult)
```

Modifiers carry a string `source` key (e.g. `'bg:soldier'`,
`'perk:long_distance'`) so `removeBySource()` cleanly unwinds whatever the
source added — used when a background is re-rolled in the (deferred)
character creator and when the perk-sync layer rebuilds drain-mult
modifiers after a perk purchase.

Modifier sources currently shipped:

- **Backgrounds** (`character/backgrounds.json5`) — applied via `applyBackground()`; idempotent re-apply safely replaces the prior set
- **Perks** (`character/perks.json5`) — `vitalDecay` perks fold into `<vital>DrainMul` via `stats/perkSync.ts` whenever the player's `Ambitions.perks` array changes
- **(Phase 4) Conditions** — illness / injury / chronic stub will emit modifiers per the [physiology.md](physiology.md) effects-fold design

This is what lets a Phase-4 flu emit a `fatigueDrainMul ×1.5` modifier
without `vitalsSystem` having to know about flu — it just reads the
effective `fatigueDrainMul` per tick.

## Per-stat state

```
base          : 0–100             stored in StatSheet; what daily drift writes
modifiers[]   : flat / pctAdd /   modifier list per stat id
                pctMult, sourced
value         = getStat(sheet, id) — folded read; what every system actually consumes

talent        : 0.7–1.4            hidden, set once at character creation; lives in attr.drift[id]
talentCap     = floor(talent × 100), clamped to 100
recentUse     : 0–100              rolling 7-day intensity buffer
recentStress  : 0–100              rolling 7-day stress buffer
```

**Floor = 5** (catatonic-but-alive baseline). Sustained neglect can drag a
stat this low. Drift writes only `base`; modifiers stack on top, so a perk
that grants `+5 Strength` shows up in `value` but doesn't change the drift
target. This separation is intentional: drift tracks the character's lived
capability, modifiers track the situational bonuses on top.

## Daily drift

Once per game-day, per character, per drifting stat:

```
recentUse    *= 0.87        (5-day half-life)
recentStress *= 0.91        (7-day half-life)
target = clamp(recentUse × talent − recentStress, FLOOR, talentCap)
base += (target − base) × DRIFT
```

`DRIFT = 0.10` — a fully-grinding week (recentUse maxed, no stress) takes
roughly **3 game-weeks** to land at the target base. Tuneable; revisit
after playtesting.

The 7-day rolling buffers smooth out single-day spikes — one heroic session
doesn't move the needle, a lifestyle shift does.

**Resolve is excluded from drift today** — its feed source is Newtype-tier
activity (Phase 7+) and drifting it now would atrophy unstoppably. Resolve
spawns at base 50 and stays there until its feed lands.

## Use sources (feed `recentUse`)

| Stat | Sources |
|---|---|
| Strength | `working` at labor/mechanic stations; heavy lifting (Phase 4+); drinking sessions (small) |
| Endurance | long shifts; full sleep cycles; sustained activity while vitals are above 70 |
| Charisma | `reveling` at the bar; shop transactions; workplace co-presence with other characters; social interactions (haggling, persuading, defusing) |
| Intelligence | `reading`; jobs with skill ∈ {computers, medicine, electronics, fabrication}; debate / explanation moves in dialogue |
| Reflex | piloting actions (Phase 5+); fine-skill jobs (mechanics, electronics, fabrication, medicine); distance covered while walking; future sports/zero-G interactable |
| Resolve | Newtype-related skills and activity (Phase 7+) — TBD until those systems land |

## Stress sources (feed `recentStress`)

Conditions that have been true the majority of the last game-day. Multiple triggers stack additively on the same stat.

| Trigger | Stresses |
|---|---|
| Hygiene > 70 sustained | Charisma |
| Hunger > 70 sustained | Strength, Endurance |
| Thirst > 70 sustained | Endurance, Intelligence |
| Fatigue > 70 sustained | Reflex, Intelligence |
| Boredom (fun) > 70 sustained | Resolve |
| Homelessness > 1 day | Charisma, Resolve |
| Unemployment > 7 days | all (mild) |
| Sleeping at flop tier sustained | Resolve (mild) |
| `reveling` session (alcohol) | Strength (small, per session) |
| HP < 50 | all (proportional) |
| HP < 25 | all (strong) |
| Sickness, injury (Phase 4+) | Strength, Endurance, Reflex |
| Low mood < 30 sustained (Phase 5+) | Charisma, Resolve |

**This list is the seed, not the final.** More triggers will be added as Phase 4 physiology, Phase 5 social/mood, and Phase 7 war-era systems land.

## Downstream effects

Each stat reads into one or more systems via a default **0.5×–1.5× multiplier mapping** (0.5× at value=0, 1.5× at value=100). Mappings can be system-specific (some are inverse — high stat = lower drain).

| Stat | Reads into |
|---|---|
| Strength | Mechanic / labor job perf multiplier; carry capacity (when inventory expands); melee damage (Phase 5+); drink tolerance — alcohol stress on Strength is reduced when Strength is already high |
| Endurance | **Fatigue drain rate (inverse — high Endurance = slower fatigue accumulation)**; hunger drain rate (inverse, mild); thirst drain rate (inverse, mild); HP regen rate; sleep efficiency (inverse — recover the same fatigue from less time in bed); sickness recovery duration (Phase 4) |
| Charisma | Shop buy/sell prices; bar fun-recovery rate; bar tip income when working as bartender; HR / interview success at higher-tier jobs (Phase 2 polish); NPC opinion drift speed (Phase 5); success chance on social-attempt moves (persuade, charm, haggle, defuse) |
| Intelligence | Skill-XP gain multiplier; `reading` duration (inverse — smarter = faster read); mental-job perf multiplier (computers, medicine, electronics, fabrication, engineering); error rate on piloting / medical procedures (inverse, Phase 4+) |
| Reflex | Movement speed (px/game-min); mobile-worker / spacecraft / mobile-suit piloting performance (Phase 5+); fine-skill action speed (mechanics, electronics, surgery); reflexive event interrupts (Phase 4+ — dodge a falling crate, catch a dropped tool) |
| Resolve | Mood tolerance (mood degradation slower); ability to keep working / finishing actions while vitals are critical; success chance on confrontational social moves (intimidate, refuse, hold composure under threat); Newtype Aptitude prerequisite signal (Phase 7+) |

## Talent and randomization

Talent is **hidden**. It reveals itself indirectly: a character's value approaches its talentCap and stops rising, signalling "this is your ceiling here."

For the MVP wiring, all characters launch with **talent = 1.0** across every stat (talentCap = 100). Talent randomization is deferred to:

- The **character creator** (player) — sets talent from origin + background + traits.
- The **NPC generator** (Phase 3 procgen) — sets NPC talent from a seeded RNG.

Until both land, every character has the same ceiling, but differentiated stat *values* still emerge from differentiated activity, stress, backgrounds, and perks.

## Phasing within attributes

| Phase | Stat work |
|---|---|
| **Shipped** | Stats infrastructure (state + drift + use buffer); Strength→work-perf, Endurance→fatigue-drain, Reflex→move-speed, Intelligence→skill-XP, Charisma→work-perf; stress sources for saturated vitals (hygiene/hunger/thirst/fatigue), HP bands, homelessness, unemployment grace, alcohol |
| **Phase 2 polish** | Charisma→shop prices; bar fun-recovery; reading-duration scaling |
| **Phase 3** | NPC talent randomization; stress sources for boredom + flop sleep (gated on Resolve participating) |
| **Phase 4** | Sickness/injury stress; HP-based stress |
| **Phase 5** | Mood-based stress; Charisma→NPC opinion shifts |
| **Phase 5+** | Reflex piloting downstream; social-move stat checks (Charisma persuade/haggle, Resolve intimidate/refuse) |

## Related

- [index.md](index.md) — vitals feed stress; full character trait set
- [skills.md](skills.md) — Intelligence multiplies XP, Reflex feeds piloting
- [physiology.md](physiology.md) — Phase 4 conditions emit modifiers into the StatSheet; HP-based stress is anticipated here
- [../social/ambitions.md](../social/ambitions.md) — perks bought with AP fold into the StatSheet via `stats/perkSync.ts`; ambitions gate on stat thresholds
- [../phasing.md](../phasing.md) — overall phase order
