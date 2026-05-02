# Faction management (Phase 6 — FTL/mercenary layer)

Player establishes a small group (e.g. mercenary cell). Members are NPCs governed by utility AI but with player-authored work priorities (RimWorld-style job × priority matrix). Player takes contracts, manages assets, doesn't micromanage actions.

The Phase 5 player-as-NPC architecture (see [../npc-ai.md](../npc-ai.md)) is what makes this transition cheap: the same drive computations that drove autonomous NPCs are now driven by player-authored weights. No rewrite required.

## Related

- [../npc-ai.md](../npc-ai.md) — player-as-NPC structural identity
- [relationships.md](relationships.md) — recruited members are existing NPCs with existing opinions
- [ambitions.md](ambitions.md) — ambitions like `lazlos_owner` may transition into this layer
- [../phasing.md](../phasing.md) — Phase 6
