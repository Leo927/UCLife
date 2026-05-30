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

## Skill Perks

The mechanism that turns a skill from a multiplier into a **build
identity**. Inspired by Stardew Valley's profession tiers: at fixed
skill levels, the player picks **one of N mutually-exclusive perks**
for that skill. Picks are visible from level 1 so the player can aim,
permanent once taken (with respec via a diegetic retraining verb), and
**at least one option per tier unlocks or transforms a verb** —
passive multiplier-only options are allowed alongside, but every tier
must offer at least one gameplay-changing choice. That authoring
contract is what separates this system from "another multiplier
track."

### Tier structure

| Level reached | Picks granted |
|---|---|
| 30 | 1 of N (N ≥ 2) |
| 60 | 1 of N (N ≥ 2) |
| 90 | reserved — not authored until consumer systems land |

Level 30 is the **book cap**: the threshold at which the player has
committed to actually using the skill, not just reading about it.
Level 60 is the deep-investment tier.

### Currency: free per-skill

A milestone pick costs **no AP**. Each skill grants its own picks
independently as its level crosses 30 and 60. This keeps two clean
identity axes:

- **Ambition Perks** (bought from a store with AP) — "what I want to
  do with my life." See [../social/ambitions.md](../social/ambitions.md).
- **Skill Perks** (picked at level milestones, free) — "how my hands
  work."

### Respec

The player respecs via a **diegetic retraining verb** offered by a
rare **Tutor** worker role that occasionally takes a shift at one of
the city's bars. Not every bar hosts a tutor seat; not every tutor
seat is staffed on a given day. Discovery is part of the loop — the
player finds the right bar at the right time (or hears about it via
the newsfeed in Phase 5.1+) and pays cash for a respec slot.

Routing follows the worker-not-workstation principle
([../DESIGN.md](../DESIGN.md)): the verb lives on the on-duty Tutor
NPC, not on a fixed tile. An empty seat exposes no verb. Tutoring is
**never** an AE service — Skill Perks stay a civilian / personal
identity axis, deliberately decoupled from faction politics.

**Cost grows per character per respec.** The first respec is cheap
enough to forgive an hour-5 mistake; the third or fourth is meant to
sting. Both money and lost days scale monotonically with the player's
prior respec count (final curve at implementation time; money is the
dominant lever, days are a smaller fixed-plus-scaling block). The
system trusts the first reroll and disciplines compulsive
re-rolling — a level-30 mistake should be a recoverable choice, not
a free reset button.

Authoring: the Tutor is a new workstation type + worker role
(`src/data/building-types.json5`); a sparse subset of bars in
worldgen / scene authoring host the slot.

### Data: Skill Perks ride the Effect channel

Skill Perks reuse the unified `Effect` shape from
[effects.md](effects.md) — same `Modifier` model, same fold path, same
save round-trip — under a new `family: 'skill_perk'`. The `originId`
is the perk id (e.g. `'skill_perk:cooking:30:meal_prep'`).

Three orthogonal payload kinds may appear on one skill perk:

1. **`modifiers: Modifier[]`** — the existing stat-folding channel.
2. **`unlocks: string[]`** — passive flag strings consumed by upstream
   systems (interaction menu, recipe registry, dialogue gates,
   diagnose verb). E.g. `'recipe:premium_meal'`, `'verb:self_treat'`,
   `'diagnose:reveal_all'`. Possessing the flag is binary; multiple
   sources granting the same flag are idempotent.
3. **`abilities: AbilityGrant[]`** *(consumer deferred — requires the
   active-abilities subsystem)* — active abilities with cooldowns the
   player triggers via a hotkey or HUD button. E.g. Mechanics tier-2's
   "emergency MS subsystem repair, 5-minute cooldown, requires being
   in a hangar or MS cockpit." The data model reserves the slot from
   day one so authored perks don't churn when combat ships.

**At least one option per tier must use `unlocks` or `abilities`** —
not just `modifiers`. This is the authoring contract that protects
the "gameplay-changing" promise. A tier whose options are all
percentMult rows fails review.

### Coverage

Real perks are authored only for skills with **shipped or imminent
consumer systems**. Skills with no consumer get **placeholder rows**
that exercise the UI / data model / system end-to-end without locking
in flavor.

| Skill | Author state | Notes |
|---|---|---|
| Cooking, Bartending, Medicine, Mechanics, Engineering, Computers, Athletics | Real perks at 30 / 60 | Consumer systems shipped or near-term |
| Marksmanship, Piloting | Placeholder rows only | Real authoring lands with Phase 6+ combat / Phase 5.4 mobile worker |

Placeholder = `unlocks: ['placeholder:<skill>:30:a']` plus a
`nameZh` / `descZh` that reads as "未授权占位" (occupied slot, not
authored yet), not as flavor pretending to be real. Picking a
placeholder still consumes the milestone slot — the player must
respec to reclaim it once real perks ship.

### Authoring sketch

Catalog lives in `src/config/skill-perks.json5`. Example row shapes
(final content at implementation time):

| Skill | Tier | Option | Payload kind | Effect |
|---|---|---|---|---|
| Cooking | 30 | *备餐高手* (Meal Prep) | unlocks | `'cook:double_batch'` — `cook` verb produces 2 meals per action |
| Cooking | 30 | *美食家* (Gourmand) | unlocks | `'recipe:premium_meal'` — premium meal becomes craftable from raw stock |
| Medicine | 30 | *自疗* (Self-Treat) | unlocks | `'verb:self_treat'` — treat your own conditions, slower than a doctor but free |
| Medicine | 30 | *分诊* (Triage) | unlocks | `'diagnose:reveal_all'` — diagnosing an NPC reveals every active condition, not just the most-severe |
| Mechanics | 30 | *拾荒者* (Salvager) | unlocks | `'verb:salvage_workstation'` — broken workstations become a parts source |
| Mechanics | 30 | *修补匠* (Tinkerer) | modifiers | `percentMult −0.50` on `workstationDegradeRate` |
| Mechanics | 60 | *战地工程师* (Field Engineer) | abilities | `{ id: 'ms_emergency_repair', cooldownSec: 259200 }` — instant MS subsystem repair mid-combat, ~3-day cooldown at first tuning *(deferred until combat ships; value will move during balance)* |
| Bartending | 30 | *招牌特饮* (Signature Cocktail) | unlocks | `'recipe:signature_drink'` — author one bespoke drink in your inventory with a custom buff bundle |
| Bartending | 30 | *吧台老练* (Tabkeeper) | modifiers | `percentMult +0.20` on bar-revenue stat |
| Marksmanship | 30 | *placeholder a* | unlocks | `'placeholder:marksmanship:30:a'` |
| Marksmanship | 30 | *placeholder b* | unlocks | `'placeholder:marksmanship:30:b'` |

### Stacking with Ambition Perks

Architecturally identical (both fold via `Effect`). Semantically
distinct: a skill perk and an ambition perk modifying the same stat
stack normally per the fold order in [effects.md](effects.md). A skill
perk's `unlocks` flag and an ambition perk's `unlocks` flag of the
same value are idempotent — possessing either is enough; flag removal
checks all sources.

### Discoverability

The skill panel ([../characters/index.md](index.md)) gains, per skill,
a "perk preview" row showing both tier-30 options and both tier-60
options grayed out until reached. The player sees what's coming and
can aim. When a tier unlocks, the row becomes a forced-pick modal that
must be resolved before the panel closes — same shape as the Ambition
picker's "at least one required" gate.

### Phasing

| Phase | Scope |
|---|---|
| **5.0** (alongside Ambition Perks) | Skill Perks data schema, `Effect.family = 'skill_perk'` + `unlocks` field on Effect, picker UI in skill panel, real perks for the 7 authored skills, placeholder rows for marksmanship / piloting, retraining verb at a placeholder NPC |
| **6.x** | `abilities` field consumers — active-abilities subsystem (hotkey binding, cooldown ticker, HUD button) lands with tactical combat; first real `AbilityGrant` rows for Mechanics 60, Marksmanship 60, Piloting 60 |
| **6.4+** | Faction-management consumers for Engineering / Computers tier-60 unlocks (e.g. "decrypt one enemy comms packet per intel cycle") |

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
| _(stand-in note)_ | Issue #69's CP/DP formulas (`maxCommandPoints`, `dpCap`) need `Tactics` / `Ship Command` and a comm-officer `command` skill, but those don't earn ids until a trainer verb ships. The formulas read existing skills as stand-ins (player `piloting`; flagship captain's `engineering`), keyed in `src/config/fleet.json5` so the swap is config-only once the real skills land. | [../fleet.md](../fleet.md) |
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
- [effects.md](effects.md) — Skill Perks ride the unified Effect channel; `family: 'skill_perk'` + `unlocks` + `abilities` payloads live there
- [physiology.md](physiology.md) — Medicine is the skill-side lever on conditions; First Aid will split off when injuries ship
- [../social/ambitions.md](../social/ambitions.md) — Ambition Perks are the other identity axis (AP-bought, cross-cutting); many ambitions also gate on specific skill thresholds (mw_pilot → piloting; ae_chief_engineer → engineering + mechanics; lazlos_owner → bartending)
- [../mobile-worker.md](../mobile-worker.md) — first concrete verb behind the piloting skill
- [../combat.md](../combat.md) — Phase 6+ consumer for marksmanship / piloting skill perks and the active-abilities subsystem
- [index.md](index.md) — character creator (when it ships) sets starting skills; skill panel hosts the perk picker UI
