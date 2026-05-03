# Ambitions

*Long-arc player goals. Phase 5.0.*

## What this system is for

The system that tells the player **what to want**.

A life sim without authored long-arcs collapses to "more money, more skills, then nothing." UC Life Sim's underlying systems (AE rank, attributes, skills, money, faction rep, residence tier) exist *to be aimed at*; ambitions provide the aiming. This is the missing layer between the day-loop and the Phase 7 war event.

See the design principles in [../DESIGN.md](../DESIGN.md): *anything in the sim that doesn't transfer to player understanding is wasted.* Ambitions are how attribute / skill / rep accumulation transfers into player understanding.

## Player verb

At character creation — or, until the creator UI lands, in a HUD-accessible Ambition panel — the player picks **2 ambitions** from a menu of ~12–15. Each declares a multi-stage ladder; progress per stage is tracked and visible.

A player can swap ambitions at most once per in-game year (cost: lose progress on the dropped ambition). The picker surfaces conflicts at selection time ("吉翁义勇兵 conflicts with 回归地球").

## Anatomy of an ambition

```json5
{
  id: 'mw_pilot',
  nameZh: '机动工兵驾驶员',
  blurbZh: '...一段诱人的开场...',
  conflicts: ['earth_migration'],
  stages: [
    {
      stageNameZh: '基础体能',
      requirements: { reflex: 30, athletics: 20 },
      payoff: { titleZh: '机工预备生', logZh: '...' },
    },
    {
      stageNameZh: '通过资格考试',
      requirements: { piloting: 40, money: 40000, federationRep: 10 },
      payoff: { titleZh: '驾驶员候补', logZh: '...', unlocks: ['mw_school_dialogue'] },
    },
    // up to ~5 stages
  ],
  warPayoff: 'drafted_as_mw_operator',  // Phase 7 wiring
}
```

**Requirements draw only from existing systems.** New ambitions don't introduce new sim state — they read from sim state. This is the discipline that keeps the ambition pool growing cheaply.

## Starter set (Phase 5.0 ship)

Six ambitions cover the major life-trajectory archetypes. Authoring more is cheap once the engine ships.

| ID | Name | Spine |
|---|---|---|
| `mw_pilot` | 机动工兵驾驶员 | Reflex/Athletics → Piloting skill → Federation rep → cockpit |
| `ae_chief_engineer` | AE 总工程师 | Engineering/Mechanics → AE rank 4 → board friendships → MS project |
| `lazlos_owner` | 酒馆老板 | Bartending → Charisma → savings → Lazlo friendship → ownership |
| `zeon_volunteer` | 吉翁义勇兵 | Side 3 residency → Zeon rep → enlistment |
| `earth_migration` | 回归地球 | ¥2M savings + Federation rep → ticket. Conflicts with all war-side ambitions. |
| `dropout` | 赤贫流浪者 | 365 days at flop tier with no Job. Achievement run. |

## War-day payoff (Phase 7 wiring)

Each ambition declares a `warPayoff` string. Phase 7's UC 0079.01.03 trigger reads this and routes the player into a different post-war state. The `warPayoff` field can ship as a placeholder log line during Phase 5.0; the actual routing fires in Phase 7.

## What ambitions are NOT

- **Not quests.** No NPC hands them out. Player picks from a menu, then plays.
- **Not achievement lists.** Each stage has a *milestone payoff felt mid-game* — a HUD title, an NPC line, a new interactable, a faction promotion. The reward is felt along the way, not just at the climax.
- **Not gameplay constraints.** A player who picked `mw_pilot` can still take a factory job, still drink at the bar, still skip work. Ambitions describe a *direction*, not a *path*.

## Phasing

| Phase | Scope |
|---|---|
| **5.0** | Ambition data schema (`data/ambitions.json5`), HUD panel, 6 starter ambitions with milestone payoffs (titles + log lines + flag-based dialogue unlocks). `warPayoff` field present but inert. |
| **5.1** | Newsfeed hooks: ambitions tag news entries (e.g. Federation news weighted for `mw_pilot`), surfacing flavor as if it were the player's personal story. |
| **5.2** | Ambitions involving NPC friendships read from the talk-verb opinion system. |
| **5.3** | Faction-aligned ambitions deepen as Federation/Zeon visible presence ships. |
| **7** | `warPayoff` routes wire up; war-day asymmetry resolves each ambition's climax. |

## Related

- [newsfeed.md](newsfeed.md) — surfaces ambitions as personal narrative
- [relationships.md](relationships.md) — supplies "befriend X" verb
- [../characters/attributes.md](../characters/attributes.md) — supplies stat thresholds
- [../characters/skills.md](../characters/skills.md) — supplies skill thresholds
- [../mobile-worker.md](../mobile-worker.md) — verb that fulfills the `mw_pilot` ambition
- [../combat.md](../combat.md) — what `warPayoff` resolves into; civilian-war is the default Phase 7 experience
- [../phasing.md](../phasing.md) — overall phase order
