# World generation

Procedural, **seeded** (same seed → same Von Braun; saved with the save file).

## Hybrid: anchored landmarks + procedural fill

- **Fixed landmarks** always generate with stable names: Anaheim subcontractor workshop, Spaceport gate, "Lazlo's" bar, public clinic, Federation/Zeon consulates, player's apartment block. Authored as room-template JSON.
- **Procedural fill** for residences, shops, alleys, corridors, secondary facilities.

A **facility** is the ownable / revenue-bearing projection of a
building (in worldgen terms, a room cluster). The two names refer to
the same data: worldgen builds the geometry; facility ownership
([social/facilities-and-ownership.md](social/facilities-and-ownership.md))
is what the city-side faction layer attaches to it.

## Generator approach

Constraint-based, not noise-based:

1. Sectors: residential / commercial / industrial / civic
2. Place landmarks first by required sector
3. Stamp room templates per sector with required adjacencies (clinic→corridor, apartments cluster, industrial→dock corridor)
4. Weave corridors connecting all rooms
5. Validate connectivity; retry on failure

WFC is **not** used for floorplan generation (wrong tool for the job). It may show up in Phase 2+ for *decorating* rooms with coherent furniture.

## NPCs are also procedural per seed

Named NPCs with procedurally-assigned apartments, jobs, daily routes. Combined with fixed landmarks, the *cast* and *paths* differ each run while the *places* stay iconic.

## Related

- [setting.md](setting.md) — what gets anchored vs procedural
- [npc-ai.md](npc-ai.md) — how procedural NPCs behave
- [saves.md](saves.md) — seeded determinism keeps saves small
- [social/facilities-and-ownership.md](social/facilities-and-ownership.md) — facility ownership layered on top of the buildings worldgen produces
