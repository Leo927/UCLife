# Ambitions

*Long-arc player goals. Phase 5.0.*

## What this system is for

The system that tells the player **what to want**, and the system that
makes wanting things mechanically pay off.

A life sim without authored long-arcs collapses to "more money, more
skills, then nothing." UC Life Sim's underlying systems (AE rank,
attributes, skills, money, faction rep, residence tier) exist *to be
aimed at*; ambitions provide the aiming. This is the missing layer
between the day-loop and the Phase 7 war event.

See the design principles in [../DESIGN.md](../DESIGN.md): *anything in
the sim that doesn't transfer to player understanding is wasted.*
Ambitions are how attribute / skill / rep accumulation transfers into
player understanding — and the **perk** layer is how that
understanding compounds back into mechanical advantage.

## The Sims aspiration model, ported to UC

UC ambitions follow The Sims' aspiration / satisfaction-points / reward
trait pattern, with one key adaptation: ambitions are mostly *narrative*
objects (with named stages, titles, dialogue unlocks, war-day routing),
while perks are *mechanical* objects (passive bonuses, unlocks,
multipliers). The two are joined by a single currency:

- **Stage completion** → awards **Ambition Points (AP)**
- **AP** → spent on **Perks** at any time
- **Same AP currency for every ambition.** Bartender stages and
  warlord stages award points on the same scale, allowing the
  bartender path to feel as mechanically rewarding as the warlord
  path even though their narrative scales differ

This matters for the design's universal-completeness claim: a
`lazlos_owner` playthrough must feel like a real, worthwhile run, not
a tutorial. The unified AP currency is what guarantees that.

## Player verb

The player picks ambitions from a HUD-accessible Ambition panel. There
is **no cap** on simultaneous active ambitions — the player can pursue
as many as they like in parallel. Realistically most players will keep
2–4 active because requirements compete for time, but the system does
not enforce a number.

A player can drop an ambition at any time without penalty (no progress
refund either; you simply stop tracking it). They can re-pick it later
and resume from where they were.

The picker surfaces conflicts at selection time, but conflicts are
**informational**, not blocking. If you pursue both `mw_pilot` and
`earth_migration`, both will track points until you hit a stage in one
that mechanically excludes the other (you can't be a Federation MS
operator AND have already emigrated to Earth). The warning lets the
player plan; the system doesn't paternalize.

The player **does not** lose ambition pursuit if they game the system
— picking up `dropout` for a year of flop-tier living to farm points
is allowed. Min-max play is a valid expression. The system trusts the
player.

## Anatomy of an ambition

```json5
{
  id: 'mw_pilot',
  nameZh: '机动工兵驾驶员',
  blurbZh: '...一段诱人的开场...',
  conflicts: ['earth_migration'],   // informational warning at pick time
  stages: [
    {
      stageNameZh: '基础体能',
      requirements: { reflex: 30, athletics: 20 },
      payoff: {
        titleZh: '机工预备生',
        logZh: '...',
        ap: 1,                         // Ambition Points awarded on completion
      },
    },
    {
      stageNameZh: '通过资格考试',
      requirements: { piloting: 40, money: 40000, federationRep: 10 },
      payoff: {
        titleZh: '驾驶员候补',
        logZh: '...',
        unlocks: ['mw_school_dialogue'],
        ap: 2,
      },
    },
    // up to ~5 stages, total AP ~5–10 per full ambition
  ],
  warPayoff: 'drafted_as_mw_operator',  // Phase 7 wiring (orthogonal to AP)
}
```

**Requirements draw only from existing systems.** New ambitions don't
introduce new sim state — they read from sim state. This is the
discipline that keeps the ambition pool growing cheaply.

**AP awards scale with stage difficulty**, not with narrative
"importance." A low-friction stage (drink at Lazlo's 30 nights) awards
1 AP. A high-friction stage (reach AE rank 4) awards 3–4 AP. This
keeps the bartender vs. warlord scale balanced: the bartender's
ambition has more low-AP stages and ships at a similar total to the
warlord's fewer-but-bigger stages.

## Perks

Perks are the spendable side of AP. Each perk has a fixed AP cost and
provides a passive mechanical effect. They are **broadly useful** — a
perk earned on a `lazlos_owner` run should be just as desirable on a
`mw_pilot` run, mostly. This is the Sims pattern: aspiration-specific
flavor lives in stage names and titles; perks are mostly cross-cutting.

Sample perk categories (final catalog is implementation-time work in
`data/perks.json5`):

- **Vital perks** — vital decay -10%, sleep more efficient, hunger threshold deeper
- **Skill perks** — skill XP gain +20% in a category, books cap raised, decay slower
- **Social perks** — talk-verb opinion gain +20%, faction rep gain +10%, charisma rolls +1
- **Economic perks** — wage +10%, shop discount, rent -10%
- **Combat perks** (unlock at Phase 6+) — flagship maneuver +5%, MS ejection survival +20%, fleet-AI quality +1
- **Faction-leader perks** (unlock at Phase 6.4+) — colony stability +1, recruitment quality +1, fleet capacity +1 (above the skill-gated baseline)

Some perks are **flavor-locked** to the ambitions that grant them — a
"Bar Owner's Eye" perk that gives a small charisma bonus when first
meeting an NPC at a bar is thematically tied to the bartender path.
But these are the minority. Most perks are cross-applicable.

Perks are **permanent** once purchased. There is no respec. Choices
matter; a long-lived character accumulates a build.

## Starter set (Phase 5.0 ship)

Six ambitions cover the major life-trajectory archetypes. Authoring
more is cheap once the engine ships.

| ID | Name | Spine |
|---|---|---|
| `mw_pilot` | 机动工兵驾驶员 | Reflex/Athletics → Piloting skill → Federation rep → cockpit |
| `ae_chief_engineer` | AE 总工程师 | Engineering/Mechanics → AE rank 4 → board friendships → MS project |
| `lazlos_owner` | 酒馆老板 | Bartending → Charisma → savings → Lazlo friendship → ownership |
| `zeon_volunteer` | 吉翁义勇兵 | Side 3 residency → Zeon rep → enlistment |
| `earth_migration` | 回归地球 | ¥2M savings + Federation rep → ticket. Conflicts with all war-side ambitions. |
| `dropout` | 赤贫流浪者 | 365 days at flop tier with no Job. Slow but steady AP source. |

Phase 6+ adds **fleet-tier ambitions** (own a fleet of N ships, command
M crew, found a colony, achieve K standing with a faction). These
become natural late-game point sources for Starsector-shape players.
See [faction-management.md](faction-management.md).

## War-day payoff (Phase 7 wiring)

Each ambition declares a `warPayoff` string. Phase 7's UC 0079.01.03
trigger reads this and routes the player into a different post-war
state. The `warPayoff` field can ship as a placeholder log line during
Phase 5.0; the actual routing fires in Phase 7.

`warPayoff` is **orthogonal to AP**. Completing more stages of an
ambition awards more AP, but the war routing fires off whichever
ambition's `warPayoff` is most progressed at the moment of the trigger.
Multiple ambitions in pursuit at war-day means the highest-progress one
wins routing; other ambitions simply continue tracking AP through the
new wartime context.

## What ambitions are NOT

- **Not quests.** No NPC hands them out. Player picks from a menu, then plays.
- **Not achievement lists.** Each stage has a *milestone payoff felt mid-game* — a HUD title, an NPC line, a new interactable, a faction promotion, plus AP. The reward is felt along the way, not just at the climax.
- **Not gameplay constraints.** A player who picked `mw_pilot` can still take a factory job, still drink at the bar, still skip work. Ambitions describe a *direction*, not a *path*.
- **Not min-max-prevention.** The system trusts the player. If they want to farm `dropout` for AP, they can.
- **Not cap-limited.** Pursue as many ambitions as you want simultaneously.

## Phasing

| Phase | Scope |
|---|---|
| **5.0** | Ambition data schema (`data/ambitions.json5`), HUD panel showing active ambitions + AP balance + perk store, 6 starter ambitions with milestone payoffs (titles + log lines + flag-based dialogue unlocks + AP awards), perk catalog (`data/perks.json5`) with ~15 starter perks. `warPayoff` field present but inert. |
| **5.1** | Newsfeed hooks: ambitions tag news entries (e.g. Federation news weighted for `mw_pilot`), surfacing flavor as if it were the player's personal story. |
| **5.2** | Ambitions involving NPC friendships read from the talk-verb opinion system. |
| **5.3** | Faction-aligned ambitions deepen as Federation/Zeon visible presence ships. |
| **6.x** | Fleet-tier and colony-tier ambitions unlock as the corresponding faction-management features ship. New perk categories (combat, faction-leader). |
| **7** | `warPayoff` routes wire up; war-day asymmetry resolves each ambition's climax. Wartime ambitions added to the menu. |

## Related

- [newsfeed.md](newsfeed.md) — surfaces ambitions as personal narrative
- [relationships.md](relationships.md) — supplies "befriend X" verb
- [faction-management.md](faction-management.md) — Phase 6+ fleet/colony ambitions; perk categories that unlock with faction tier
- [../characters/attributes.md](../characters/attributes.md) — supplies stat thresholds
- [../characters/skills.md](../characters/skills.md) — supplies skill thresholds
- [../mobile-worker.md](../mobile-worker.md) — verb that fulfills the `mw_pilot` ambition
- [../combat.md](../combat.md) — what `warPayoff` resolves into; civilian-war is the default Phase 7 experience
- [../phasing.md](../phasing.md) — overall phase order
