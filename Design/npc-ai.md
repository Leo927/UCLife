# NPC AI

## Architecture: utility AI + behavior trees

- **Utility AI** (custom, ~150 LOC) selects the *goal*. Each tick, score candidate considerations across drives, distance, capability, preference; pick the maximum.
- **Behavior trees** (mistreevous library) execute the *plan*. Sequence/fallback/retry: pathfind → use object → consume → log.

## Drives

Computed each tick from:

- **Vitals** (hungry → "eat" drive)
- **Schedule** (work shift active → "be at workstation" drive)
- **Social state** (lonely → "find friend X" drive)
- **Memory & opinions** (avoid disliked, return to favored)
- **Faction events** (rumor of war → fear → seek company/shelter)
- **External policy weights** (Phase 6: when player runs a faction, they author these)

## Memory

Per NPC: persona blob (immutable; perfect cache target for future LLM use) + rolling memory log (last N events). Memory affects opinions, drives, dialogue.

## Schedules

Soft priors on utility scores, not hard rules. NPCs *tend to* go to work at 9 because the utility of "be at workstation" rises sharply at 9, but they can skip if a stronger drive overrides.

## Player as NPC

The player character is structurally identical to NPCs — same trait set, same drive computations exist, just disabled and replaced by player input. This is what makes the Phase 6 transition (managing a faction) require zero rewrite: just toggle which characters are player-driven vs autonomous.

## Related

- [characters/index.md](characters/index.md) — vitals feed drives
- [social/relationships.md](social/relationships.md) — opinions and memory drive social NPC behavior
- [llm.md](llm.md) — Phase 8 LLM dialogue layered on persona blobs
- [time.md](time.md) — commitment-skip interactions
