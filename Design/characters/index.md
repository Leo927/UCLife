# Player character

Sub-topics live in sibling files because they're large enough to read on their own:

- [skills.md](skills.md) — 27 skills, 6 groups, XP and decay model
- [attributes.md](attributes.md) — 6 stats, drift model, talent caps, stress feeds
- [physiology.md](physiology.md) — Phase 4 conditions (illness, injury, scars), diagnosis loop, contagion

This file covers character creation and vitals.

## Character creator

- **Origin**: Spacenoid / Earthnoid (affects starting Zero-G Ops, Endurance modifiers)
- **Background** (6 templates): AE technician, dock worker, civilian pilot trainee, freelancer, ex-Federation enlistee, medic. Each sets starting skills, apartment location, one NPC contact, one opening rumor.
- **Personality traits**: pick 2–3 from a pool (RimWorld-style). Affect mood modifiers and dialogue tags.
- **Portrait**: pre-drawn portrait set, not procedural.
- **Stat talent**: origin/background/traits set hidden talent multipliers (0.7×–1.4×) on each of the six attributes (see [attributes.md](attributes.md)). Spacenoid: +Reflex, −Strength (zero-G upbringing). AE technician: +Intelligence. Etc. Creator UI deferred — until it lands, all characters launch at talent = 1.0 across the board.
- **Ambitions**: at the end of creation the player picks 2 from the ambition menu (see [../social/ambitions.md](../social/ambitions.md)). Until the creator UI lands, ambitions are picked from a HUD panel after spawn.

## Vitals (drain-based, 0–100)

| Vital | Drain rule of thumb |
|---|---|
| Hunger | 0→100 over ~6 awake hours |
| Thirst | 0→100 over ~3 awake hours |
| Fatigue | 0→100 over ~16 awake hours |
| Hygiene | slow drain, fast recovery |
| Social | slow drain unless isolated |
| Comfort | environmental |
| Mood | derived; affected by all of the above + traits + recent events |

Death from neglect possible. (Permadeath off by default; toggle in Phase 4+.)

## Physiology (Phase 4)

Discrete named conditions (RimWorld-hediff-shaped) layered on top of vitals:
acute illness, injury with body parts, chronic stubs (scars), with diagnosis
as the player's central verb and contagion as the workforce-level risk.
Full design lives in [physiology.md](physiology.md).

## Related

- [skills.md](skills.md) — what the character does with their attributes
- [attributes.md](attributes.md) — slow-moving stats between vitals and skills
- [physiology.md](physiology.md) — Phase 4 conditions, diagnosis, contagion
- [../social/ambitions.md](../social/ambitions.md) — picked at character creation
- [../npc-ai.md](../npc-ai.md) — player and NPCs share trait set
