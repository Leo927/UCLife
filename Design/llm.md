# LLM integration (Phase 8)

Designed for now, used later:

- Each NPC has a stable **persona blob** (immutable history, personality, allegiance) + **rolling memory log**. Persona is a perfect prompt-cache target.
- LLM never mutates state directly. It returns either a dialogue string or a `proposed_action` from a fixed schema; proposed actions feed back into the utility AI as scored candidates.
- Floor stays correct: utility AI alone always produces valid behavior. LLM is *flavor on top* — better dialogue, more in-character action selection.
- Provider: Claude API via `@anthropic-ai/sdk` with prompt caching.

## Related

- [npc-ai.md](npc-ai.md) — utility AI is the floor LLM augments
- [social/relationships.md](social/relationships.md) — opinion + memory feed dialogue context
- [phasing.md](phasing.md) — Phase 8 capstone, not foundation
