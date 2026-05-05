# Skills

Hand-authored skill catalog stored as cumulative XP per character. Level =
`floor(xp / xpPerLevel)`, capped at 100. Catalog, labels, group binding, and
display order live in `src/config/skills.json5`; the SkillId union and helpers
live in `src/character/skills.ts`.

## Shipped catalog (9 skills, 5 groups)

| Group (zh-CN) | Skills (en id — zh-CN label) |
|---|---|
| 技术 (Technical) | mechanics — 机械, engineering — 工程, computers — 计算机 |
| 战斗 (Combat) | marksmanship — 枪法, piloting — 驾驶 |
| 身体 (Body) | athletics — 体力 |
| 生活 (Life) | cooking — 烹饪, bartending — 调酒 |
| 知识 (Knowledge) | medicine — 医学 |

Adding a skill = JSON5 row in `skills.json5` + SkillId union update in
`character/skills.ts`. The label / group / order data is purely cosmetic
for the StatusPanel.

## XP sources

XP is awarded by use:

- **Working** a Workstation typed for the relevant skill (the dominant XP source).
- **Books** — capped at the **book level cap** (default 30). Above this level the skill must be ground through actual use; books no longer grant XP.
- **Action-side XP** for cooking / drinking / etc. on the verbs that ship them.

Intelligence multiplies XP gain at the read site
(see [attributes.md](attributes.md) downstream effects).

## Not yet shipped

- **Skill rust** (decay after sustained disuse) — designed; not shipped. XP is currently monotonic.
- **Per-character talent multipliers (0.7×–1.4×)** on a per-skill basis — the talent layer lives at the attribute level today (see [attributes.md](attributes.md)). Whether skills get their own talent track or borrow the attribute's is a future decision.

## Skills the catalog is reserved for

The original design listed 27 skills across 6 groups + Esoteric. The shipped
9-skill catalog is a deliberate scope cut — the city-life loop is fully
covered, and combat / piloting / social / knowledge skills will earn their
own ids only when the systems that consume them ship. The discipline:

> **A skill earns a slot when there's a verb that can train it AND a system that consumes its level.** Both gates apply. Adding a skill that nothing reads is just a number that drifts.

Designed-but-deferred candidates, with the phase that would justify them:

| Skill | Reason deferred | Earned by |
|---|---|---|
| Melee, Tactics, Ship Command | Phase 6+ tactical / fleet combat | [../combat.md](../combat.md) |
| Electronics, Fabrication, Minovsky Physics | Phase 6+ ship/MS work and tech-level gating | [../combat.md](../combat.md) |
| First Aid | Phase 4 physiology — splits off `medicine` for self-treat verbs | [physiology.md](physiology.md) |
| Chemistry | Phase 4+ — pharma crafting hook | [physiology.md](physiology.md) |
| Astrogation | Phase 6+ campaign navigation | [../starmap.md](../starmap.md) |
| Negotiation, Leadership, Deception, Streetwise, Etiquette | Phase 5+ relationships, faction-management | [../social/index.md](../social/index.md), [../social/faction-management.md](../social/faction-management.md) |
| Performance | Phase 5+ bar / busking verb | [../social/index.md](../social/index.md) |
| Newtype Aptitude | Phase 7+ war-era awakening — hidden, ungrindable, rare | [../combat.md](../combat.md) |

`piloting` is intentionally one skill across mobile workers, spacecraft,
and (Phase 7+) mobile suits. Splitting it is a future decision; the verb
catalog can grow without splitting the skill.

`Endurance` and `Zero-G Ops` are **not** going to be promoted to skills —
they belong at the attribute layer and don't need a separate progression
track.

## Related

- [attributes.md](attributes.md) — Intelligence multiplies XP gain; the talent layer caps stat values that gate work performance per-skill
- [physiology.md](physiology.md) — Medicine is the skill-side lever on conditions; First Aid will split off when injuries ship
- [../social/ambitions.md](../social/ambitions.md) — many ambitions gate on specific skill thresholds (mw_pilot → piloting; ae_chief_engineer → engineering + mechanics; lazlos_owner → bartending)
- [../mobile-worker.md](../mobile-worker.md) — first concrete verb behind the piloting skill
- [index.md](index.md) — character creator (when it ships) sets starting skills
