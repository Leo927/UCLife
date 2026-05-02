# Phasing

| Phase | Scope | Demo moment |
|---|---|---|
| **0. Skeleton** | Vite/React/Koota/Konva/Lingui set up; tile renderer; clock with pause+1×+2×+4×; player walks a hand-placed throwaway map | "I wander an empty district and the clock advances" |
| **1. Survival core** | Vitals; eat/sleep/wash interactables; death-from-neglect; commitment-skip for sleep | "I survive a week" |
| **2. Skills + economy** | Inventory; skill set; one job (work shift → wage); shops; books for skill grind | "Work → eat → train → sleep" loop closes |
| **3. NPC utility AI + procgen** | Procedural Von Braun district; 10–20 named NPCs with schedules/drives/pathfinding/memory; relations | "Sleep-skip and wake to a different station" |
| **4. Physiology** | Sickness, injury, contagion, clinic, permadeath toggle | "Flu spreads through a workplace" |
| **5.0 Ambitions** | Authored long-arc goals; player picks 2 from a menu of 6+; milestone payoffs (titles, log lines, dialogue unlocks); `warPayoff` field present but inert | "I have a target tomorrow morning" |
| **5.1 Newsfeed** | Date-keyed event content table; bar TV channel; journal HUD panel showing consumed headlines | "I duck into Lazlo's to catch the news" |
| **5.2 Talk verb + relationships** | "Talk" interaction on every NPC; per-NPC opinion; player-presence memory; ambitions involving NPC friendships start working | "The bartender remembers me" |
| **5.3 Factions deepen** | Federation + Zeon visible presence (consulates, uniformed NPCs); reputation deepens; faction-aligned ambitions earn real stakes | "My loyalty matters; war rumors land" |
| **6. Faction management (FTL layer)** | Player establishes group; work priority matrix; contracts; assets | "I run a 4-person merc cell" |
| **7. War event** | UC 0079.01.03 hits; world state shift; factions go hostile; Von Braun changes; `warPayoff` routes resolve every active ambition | The prologue payoff |
| **8. LLM dialogue + intent** | Persona-cached Claude prompts for dialogue and proposed actions | "Talking to NPCs feels alive" |

## Open / deferred

- Permadeath UX (unlock in Phase 4)
- Save migration policy when traits churn pre-1.0
- LLM cost model and rate-limiting (Phase 8 design)
- Sound design (deferred indefinitely; ambient tracks + UI clicks adequate)
- Mobile suit subsystem when UC 0079+ unlocks mobile suit access (uses the unified Piloting skill)
- Character creator UX (sets stat talents per [characters/attributes.md](characters/attributes.md)); NPC talent randomization via seeded RNG. Until both land, every character launches at talent = 1.0.
- Stat balance pass after first playtests of attributes: tune `DRIFT`, the floor, and the use/stress feed weights once the harshness reads in actual play.

## Related

- Every topic file references this for phase-tagged work
- [DESIGN.md](DESIGN.md) — index of all topic files
