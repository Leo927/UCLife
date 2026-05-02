# Relationships & faction reputation

## Relationships

Modeled as Koota relations (entity-to-entity edges with data: opinion, last interaction, nature). Friendships and feuds emerge from accumulated interactions.

Per-pair state lives on the relation:

- `opinion: -100..+100`
- `lastInteractionTick`
- `nature` — tag (acquaintance, friend, rival, romantic, kin)

Decay applies if the pair hasn't interacted recently.

## Faction reputation

Player has a reputation (-100…+100) with each faction. Affects which NPCs will talk, which jobs are available, which areas accept them.

Phase 5.3 ships visible Federation and Zeon presence (consulates, uniformed NPCs); reputation hooks already exist but only AE meaningfully reads them until 5.3 lands.

## The talk verb (Phase 5.2)

Right-click any NPC → 1–2 line greeting that varies by:

- the NPC's stable persona (set at spawn, deterministic per seed)
- the NPC's faction tag
- the NPC's current drive
- the player's opinion meter with this NPC
- recent news the NPC has consumed (gossip layer for [newsfeed.md](newsfeed.md))

No branching dialogue tree at first ship. The verb is the value; branching can come later.

## Related

- [ambitions.md](ambitions.md) — ambitions involving "befriend X" read from this
- [newsfeed.md](newsfeed.md) — gossip channel pipes news through opinion-coloured NPCs
- [../characters/attributes.md](../characters/attributes.md) — Charisma drives opinion drift
- [../npc-ai.md](../npc-ai.md) — opinions affect NPC drives
