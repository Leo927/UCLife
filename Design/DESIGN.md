# UC Life Sim — Design Document

*Player-facing language: zh-CN. Dev artifacts (this doc, code, comments, inspector UI): English.*
*License: GPL-3.0-or-later.*

---

## Vision

A web-based RPG life simulator set in the Gundam Universal Century. The player is one ordinary human in lunar city **Von Braun**, **UC 0077** — two years before the One Year War. They eat, sleep, get sick, learn skills, hold jobs, build relationships, and witness a world that simulates around them whether they engage with it or not. Over the long arc of the game, that world drifts toward war.

The game compensates for low-fidelity graphics with **simulation depth + apophenic storytelling** — the RimWorld and Dwarf Fortress lesson — and lays in **LLM-driven NPC dialogue** as a late-phase capstone, not a foundation.

## Design principles

Drawn from Tynan Sylvester's *The Simulation Dream*:

1. **Player-model first.** What matters is the mental model the player builds, not what's actually simulated. Anything in the sim that doesn't transfer to the player's understanding is wasted.
2. **Simulate only what generates story.** Vitals, schedules, skills, social ties. Skip what doesn't (fluid dynamics, weather, realistic economics).
3. **Hair complexity.** Backstories, named injuries, faction newsfeeds — flavor without systemic entanglement.
4. **Apophenia is free depth.** Name the NPCs, log their actions verbosely, let players invent the meaning.
5. **Constraint generates emergence**, not elaborate rules.

Two concrete tactics that fall out of this:

- **Inspector mode** — click any entity, see all traits.
- **Verbose event log** — every NPC action emits a readable line; the log *is* the story.

## How to navigate this doc

This document is an **index**, not a monolith. Each topic below lives in its own file. Read the index, follow the one or two links you need, then recurse via each file's `## Related` footer. Avoid reading the whole tree.

| Topic | File |
|---|---|
| Setting (where, when, factions, timeline) | [setting.md](setting.md) |
| Time, control, commitment-skip | [time.md](time.md) |
| Player character (creator, vitals, physiology) | [characters/index.md](characters/index.md) |
| ↳ Skills (27 skills, 6 groups) | [characters/skills.md](characters/skills.md) |
| ↳ Attributes (6 stats, drift model) | [characters/attributes.md](characters/attributes.md) |
| NPC AI (utility + BT, drives, memory) | [npc-ai.md](npc-ai.md) |
| Social pillar overview | [social/index.md](social/index.md) |
| ↳ Ambitions (Phase 5.0) | [social/ambitions.md](social/ambitions.md) |
| ↳ Newsfeed (Phase 5.1) | [social/newsfeed.md](social/newsfeed.md) |
| ↳ Relationships & faction reputation | [social/relationships.md](social/relationships.md) |
| ↳ Faction management (Phase 6) | [social/faction-management.md](social/faction-management.md) |
| Combat (Starsector-shape with MS-as-fighter, Phase 6+) | [combat.md](combat.md) |
| Macro-geography & campaign map (Earth Sphere continuous-space + Jupiter, Phase 6+) | [starmap.md](starmap.md) |
| Encounter form (text-event-first, blue options, Phase 6+) | [encounters.md](encounters.md) |
| Mobile worker minigame (Phase 5.4) | [mobile-worker.md](mobile-worker.md) |
| World generation | [worldgen.md](worldgen.md) |
| Saves | [saves.md](saves.md) |
| LLM integration (Phase 8) | [llm.md](llm.md) |
| Localization | [localization.md](localization.md) |
| Tech stack & architecture | [architecture.md](architecture.md) |
| Phasing & deferred | [phasing.md](phasing.md) |

## Contributing to this doc

- New content goes in the topic file it belongs to. If a single file grows beyond ~300 lines, split it and add the children to the index.
- Cross-file references use **relative paths**, never section numbers — section numbers break the moment a file is re-split.
- Every file ends with a `## Related` footer of 2–4 sibling links. This is the recursion mechanism agents use to discover what they need.
- Keep this index file under ~100 lines. Vision, principles, and the link table belong here; actual content does not.
