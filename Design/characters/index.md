# Player character

Sub-topics live in sibling files because they're large enough to read on their own:

- [skills.md](skills.md) — shipped 9-skill catalog, XP, book cap
- [attributes.md](attributes.md) — six stats, modifier-based StatSheet engine, drift, talent
- [physiology.md](physiology.md) — Phase 4 conditions (illness, injury, scars), diagnosis, contagion

This file covers the character entity's trait set, vitals, appearance / portrait pipeline, character creation status, and the player-side deltas vs. NPCs.

## Trait set

A character (player or NPC) is the union of these koota traits — see
`src/ecs/traits/character.ts` for the canonical definitions. The same trait
list spawns on both `spawnPlayer()` and `spawnNPC()` so every system reads
players and NPCs uniformly.

| Trait | Purpose |
|---|---|
| `Character` | zh-CN display name, sprite tint color, title (often overridden by ambition payoff) |
| `Position` / `MoveTarget` | Tile-space location; pathfinder writes the target |
| `Action` | Current verb (`idle` / `walking` / `eating` / `sleeping` / …) + remaining minutes |
| `Vitals` | hunger, thirst, fatigue, hygiene, **boredom** (0–100 each) |
| `Health` | hp + dead flag |
| `Money` | Cash on hand |
| `Skills` | Per-skill XP — see [skills.md](skills.md) |
| `Attributes` | Modifier-folded `StatSheet` (six attributes + per-vital max/drain mult + HP max/regen) plus per-attribute drift buffers — see [attributes.md](attributes.md) |
| `Inventory` | water, meal, premiumMeal, books |
| `Job` / `JobPerformance` / `JobTenure` | Workstation ref + per-rank tenure |
| `Home` / `PendingEviction` | Bed ref + post-eviction grace pass |
| `Reputation` | Sparse `{factionId → -100..+100}` map |
| `FactionRole` | Faction membership + role tier (`staff` / `manager` / `board`) |
| `Appearance` | Body / hair / eye / makeup parameters consumed by both render pipelines |
| `EntityKey` | Stable identity for save round-trip |

Player-only adds: `IsPlayer`, `Active` (always-on tag), `Ambitions` (active
goals + AP balance + bought perks — see [../social/ambitions.md](../social/ambitions.md)),
`Flags` (string-keyed booleans written by ambition payoffs).

NPCs additionally carry `WanderState`, `ChatTarget` / `ChatLine`, `Knows`
(asymmetric opinion / familiarity relations), and `RoughUse` while at a
public tap / scavenge spot.

## Vitals

Five drain meters, scale 0–100. Drain rates feed through the StatSheet's
`<vital>DrainMul` channel — backgrounds, perks, and (Phase 4) conditions
modulate them via stacking modifiers instead of hardcoded numbers.

| Vital | zh-CN label | Drain rule of thumb |
|---|---|---|
| Hunger | 饥饿 | 0→100 over ~6 awake hours |
| Thirst | 口渴 | 0→100 over ~3 awake hours |
| Fatigue | 疲劳 | 0→100 over ~16 awake hours |
| Hygiene | 卫生 | slow drain, fast recovery |
| Boredom | 烦闷 | drains while doing repetitive work / no recreation |

Mood is **not** a stored vital. It will be a derived readout in Phase 5
(see [../phasing.md](../phasing.md)); until then, "is the player suffering"
reads off saturated vitals + HP bands + per-attribute `recentStress`. Social
isolation and physical comfort are likewise unmodeled at the vital layer
today — long-arc social/comfort signals live in the relations and stress
systems, not in `Vitals`.

Death from neglect is possible via `Health.dead`. Permadeath is a save-time
toggle deferred to Phase 4.

## Appearance and portrait

Every character carries an `Appearance` trait that drives **two** render
pipelines:

- **LPC top-down sprite** (worldspace) — `src/render/sprite/`. `appearanceToLpc.ts` adapts UC's `Appearance` trait to LPC layer keys.
- **FC pregmod portrait** (HUD / inspector / status panel) — `src/render/portrait/`. See [../architecture.md](../architecture.md) for the bridge / cache / adapter seams and the upstream-sync workflow.

Appearance values are pinned at spawn by `setupAppearance(name, gender)`
(in `src/character/spawn.ts`):

1. The procedural generator (`appearanceGen.ts`) hashes the character's name (FNV-1a → mulberry32) into a full `AppearanceData` record. **Same name → same body**, so saves and reloads stay visually stable without persisting appearance separately from name.
2. A hand-authored override in `src/character/npc-appearance.json5` can override any subset of fields by name match. Special NPCs (AE board members, the player slot `新人`) use this layer to look distinctive.

This is a deliberate departure from the "pre-drawn portrait set" placeholder
the doc previously described: the FC portrait pipeline gives every NPC a
generated portrait without the asset cost of hand-painting one each, while
the override file lets named characters look intentional. License
consequences (GPL-3.0 viral) are documented under
[../architecture.md](../architecture.md) and `src/render/portrait/README.md`.

## Character creation (deferred)

Player creation UI is **not yet shipped**. Until it lands, the player spawns
with hard-coded defaults via `spawnPlayer()`:

- Name: `'新人'`
- Title: `'市民'`
- Talent = 1.0 across every attribute (talentCap = 100)
- Stat bases = 50, recentUse = 50, recentStress = 0
- Starting inventory: 1 water, 1 meal, 0 books, 0 premiumMeal
- Starting money: 30
- Hand-tuned appearance override (`新人` entry in `npc-appearance.json5`)
- Empty `Ambitions` slot — the HUD picker forces open until the player picks at least one

The shipped backgrounds (`src/character/backgrounds.json5`) already work as
a modifier source: each background applies a stat-modifier bundle to the
character's StatSheet under the source key `bg:<id>`, and
`removeBackground()` cleanly unwinds them. A future creator UI can wire in
without trait churn.

What the creator UI is intended to set when it ships:

| Knob | Status | Notes |
|---|---|---|
| **Background** | 3 catalogued (退役军人 / 学者 / 幸存者); designed for ~6 to span the playable archetypes | Each is a stat-modifier bundle; no apartment / NPC contact / opening rumor wiring shipped — those were aspirational and may or may not survive design pass |
| **Talent multipliers** (0.7×–1.4×) on each of the six attributes | Not shipped; everyone runs at 1.0 | Origin + background + traits will compose the per-stat multiplier when wired |
| **Origin** (Spacenoid / Earthnoid) | Not shipped | Flavor + starting talent skew (e.g., Spacenoid: +Reflex / −Strength) |
| **Personality traits** (RimWorld-style 2–3 picks from a pool) | Not shipped | Pool not authored yet; `Flags` trait can carry the picks once it is |
| **Ambitions** | Shipped | HUD-accessible picker; at least one required to leave the picker — see [../social/ambitions.md](../social/ambitions.md) |
| **Portrait** | Shipped via FC + override file | No "portrait set" picker; players who want a custom look edit the override file's `新人` entry. Whether to expose this in-UI is a future decision |

## Cross-scene migration

The player can move between scenes (Von Braun ↔ player ship interior ↔ space
campaign). Entity ids are world-stamped, so the migration is a
destroy-and-respawn that snapshots **portable** traits and drops scene-bound
ones — see `src/character/migrate.ts`.

| Carried | Dropped |
|---|---|
| `Character`, `Vitals`, `Health`, `Money`, `Skills`, `Inventory`, `Attributes` (sheet + drift), `Reputation`, `JobTenure`, `Appearance`, `FactionRole`, `Flags`, `Ambitions`, `EntityKey` | `Job`, `Home`, `PendingEviction` (origin-scene refs) |

Re-establishing job and home is the destination scene's bootstrap problem,
not the character's.

## Physiology (Phase 4)

Discrete named conditions (RimWorld-hediff-shaped) layered on top of vitals:
acute illness, injury with body parts, chronic stubs (scars), with diagnosis
as the player's central verb and contagion as the workforce-level risk.
Full design lives in [physiology.md](physiology.md).

## Related

- [skills.md](skills.md) — what the character does with their attributes
- [attributes.md](attributes.md) — six stats, modifier-based StatSheet
- [physiology.md](physiology.md) — Phase 4 conditions, diagnosis, contagion
- [../social/ambitions.md](../social/ambitions.md) — picked at character creation; AP currency + perks fold back through `Attributes` modifiers
- [../npc-ai.md](../npc-ai.md) — player and NPCs share trait set; NPCs add the BT-driven traits
- [../architecture.md](../architecture.md) — render & portrait pipelines, save round-trip
- [../saves.md](../saves.md) — character traits round-trip via EntityKey
