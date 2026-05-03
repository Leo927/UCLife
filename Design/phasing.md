# Phasing

| Phase | Scope | Demo moment |
|---|---|---|
| **0. Skeleton** | Vite/React/Koota/Konva/Lingui set up; tile renderer; clock with pause+1×+2×+4×; player walks a hand-placed throwaway map | "I wander an empty district and the clock advances" |
| **1. Survival core** | Vitals; eat/sleep/wash interactables; death-from-neglect; commitment-skip for sleep | "I survive a week" |
| **2. Skills + economy** | Inventory; skill set; one job (work shift → wage); shops; books for skill grind | "Work → eat → train → sleep" loop closes |
| **3. NPC utility AI + procgen** | Procedural Von Braun district; 10–20 named NPCs with schedules/drives/pathfinding/memory; relations | "Sleep-skip and wake to a different station" |
| **4. Physiology** | Sickness, injury, contagion, clinic, permadeath toggle | "Flu spreads through a workplace" |
| **5.0 Ambitions** | Authored long-arc goals; player pursues any number from a menu of 6+; milestone payoffs (titles, log lines, dialogue unlocks, **Ambition Points**); perk catalog spendable from AP pool. `warPayoff` field present but inert. See [social/ambitions.md](social/ambitions.md). | "I have a target tomorrow morning, and the perks I earned last week make it cheaper" |
| **5.1 Newsfeed** | Date-keyed event content table; bar TV channel; journal HUD panel showing consumed headlines | "I duck into Lazlo's to catch the news" |
| **5.2 Talk verb + relationships** | "Talk" interaction on every NPC; per-NPC opinion; player-presence memory; ambitions involving NPC friendships start working | "The bartender remembers me" |
| **5.3 Factions deepen** | Federation + Zeon visible presence (consulates, uniformed NPCs); reputation deepens; faction-aligned ambitions earn real stakes | "My loyalty matters; war rumors land" |
| **5.4 Mobile worker subsystem** | First concrete verb behind the piloting skill: Sim Pod + MW Operator job + AE/Federation gated trials. Inertia-cockpit minigame. See [mobile-worker.md](mobile-worker.md). | "I bring a load through the gates and the cockpit feels different than it did yesterday" |
| **6.0 First ship + tactical foundation** | Player buys their first ship. Starsector-shape tactical view (top-down 2D, real-time + pause). Walkable flagship as scene. Earth Sphere continuous-space campaign map opens (Sides 1–7, Luna, Luna II, Earth orbit, asteroid clusters) — see [starmap.md](starmap.md). Single-ship pre-war merc work. | "I burn from Granada to Side 6, dock at a derelict, and decide whether to fight or run" |
| **6.1 Bridge ↔ hangar walk + MS pilot** | Player walks flagship rooms; physically transits bridge → hangar to climb into an MS. Cockpit primitives now have hostile counterparts. Walking-transit cost on flagship AI (leaving bridge mid-combat = AI-piloted flagship). | "I leave the bridge mid-fight to take an MS personally — and feel my fleet wobble while I'm gone" |
| **6.2 Multi-ship fleet** | Ship Command / Tactics / Leadership gate fleet capacity (no hard cap). Captain assignment for escorts (NPCs the player has recruited). Fleet orders in tactical combat. Persistent fleet damage between encounters. Escort losses are permanent. | "My old bartending friend captains my second ship" |
| **6.3 Colony establishment** | Player can claim an asteroid base or build a new colony from scratch. Walkable colony scenes (smaller than Von Braun, industrial building pool). Resupply hub, recruitment depth, income, pirate raids. Colony scale skill-gated (no hard cap). See [social/faction-management.md](social/faction-management.md). | "I land at my own colony and refuel my fleet from my own refinery" |
| **6.4 Faction tier** | Player-faction acquires its own faction reputation slot. Recruitment scale (open calls on colonies). Governance choices. Diplomacy with canon factions. Faction-leader perks unlock for the AP pool. Jupiter expedition ships as a frontier long-arc option. | "Federation patrols salute my flag, and an AE diplomat wants a meeting" |
| **7. War event** | UC 0079.01.03 hits; world state shift; factions go hostile; Von Braun changes; `warPayoff` routes resolve the most-progressed ambition. Civilian-war content (newsfeed wartime mode, conscription, refugees, departing friends), real cockpit combat for the pilot path, wartime faction management, hostile expeditions vs player colonies. See [combat.md](combat.md) for the full structural design. | The prologue payoff |
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
