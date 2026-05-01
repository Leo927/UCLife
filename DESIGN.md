# UC Life Sim — Design Document

*Version 0.1 — Pre-implementation design*
*Player-facing language: zh-CN. Dev artifacts (this doc, code, comments, inspector UI): English.*

---

## 1. Vision

A web-based RPG life simulator set in the Gundam Universal Century. The player is one ordinary human living in lunar city **Von Braun** in **UC 0077** — two years before the One Year War. They eat, sleep, get sick, learn skills, hold jobs, build relationships, and witness a world that simulates around them whether they engage with it or not. Over the long arc of the game, that world drifts toward war.

The game compensates for low-fidelity graphics with **simulation depth + apophenic storytelling** — RimWorld and Dwarf Fortress' lesson — and lays in **LLM-driven NPC dialogue** as a late-phase capstone, not a foundation.

## 2. Design principles

Drawn from Tynan Sylvester's *The Simulation Dream*:

1. **Player-model first.** What matters is the mental model the player builds, not what's actually simulated. Anything in the sim that doesn't transfer to the player's understanding is wasted.
2. **Simulate only what generates story.** Vitals, schedules, skills, social ties. Skip what doesn't (fluid dynamics, weather, realistic economics).
3. **Hair complexity.** Backstories, named injuries, faction newsfeeds — flavor without systemic entanglement.
4. **Apophenia is free depth.** Name the NPCs, log their actions verbosely, let players invent the meaning.
5. **Constraint generates emergence**, not elaborate rules.

Two concrete tactics that fall out of this:
- **Inspector mode** — click any entity, see all traits.
- **Verbose event log** — every NPC action emits a readable line; the log *is* the story.

## 3. Setting

### 3.1 Where & When
- **Lunar city Von Braun**, single map (a *district* of the city, not the whole thing).
- **UC 0077, calendar starts on a player-selectable date.** Mobile suits do not yet exist publicly; mobile workers (industrial exo-frames) and shuttlecraft do. Anaheim Electronics is a major employer.
- **Indoor only.** A sealed dome. No weather. Artificial day/night cycle as a single global ambient phase.
- **1/6 G** — flavor only, not physically simulated.

### 3.2 Factions visible from day 1
- **Earth Federation** — military presence, civic infrastructure
- **Republic of Zeon** — consulate, sympathizer presence
- **Anaheim Electronics** — neutral mercenary corporate
- **Civilian/Independent** — most NPCs

### 3.3 Timeline as state
The world clock is `UC YYYY.MM.DD HH:MM`. Setting events are scripted against dates (Operation British: 0079.01.03; etc.). When the player reaches them through normal play or saves over years, the world *changes*. This is a Phase 5+ payoff but the mechanism (date-keyed event triggers) exists from Phase 0.

## 4. Player character

### 4.1 Character creator
- **Origin**: Spacenoid / Earthnoid (affects starting Zero-G Ops, Endurance modifiers)
- **Background** (6 templates): AE technician, dock worker, civilian pilot trainee, freelancer, ex-Federation enlistee, medic. Each sets starting skills, apartment location, one NPC contact, one opening rumor.
- **Personality traits**: pick 2–3 from a pool (RimWorld-style). Affect mood modifiers and dialogue tags.
- **Portrait**: pre-drawn portrait set, not procedural.
- **Stat talent**: origin/background/traits set hidden talent multipliers (0.7×–1.4×) on each of the six attributes (§4.5). Spacenoid: +Reflex, −Strength (zero-G upbringing). AE technician: +Intelligence. Etc. Creator UI deferred — until it lands, all characters launch at talent = 1.0 across the board.

### 4.2 Vitals (drain-based, 0–100)
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

### 4.3 Physiology (Phase 4)
- Sickness with contagion (a flu can sweep a workplace)
- Injuries with named body parts and recovery curves
- Immune system as a hidden stat
- Clinic interaction → medicine skill matters

### 4.4 Skills (UC 0077 — 27 skills, 6 groups)
TRV-style: many narrow skills, XP from use, optional decay. Each skill has level (0–100) + per-character talent multiplier (0.7×–1.4×) → some characters are natural pilots.

**Combat & Piloting**: Marksmanship, Melee, Tactics, Mobile Worker Piloting, Spacecraft Piloting, Mobile Suit Piloting (*locked until UC 0079+*), Ship Command

**Technical**: Mechanics, Electronics, Computers, Engineering, Minovsky Physics (*hidden start, requires teacher*), Fabrication

**Body & Space**: Athletics, Zero-G Ops, Endurance

**Knowledge & Medicine**: Medicine, First Aid, Astrogation, Chemistry

**Social**: Negotiation, Leadership, Deception, Streetwise, Etiquette

**Crafts & Culture**: Cooking, Bartending, Performance

**Esoteric**: **Newtype Aptitude** (*hidden, ungrindable; awakens via specific traumatic events from ~UC 0079 onward in <1% of characters*)

XP gained by use (books cap at level 30). Skill rust applies after months of disuse. Cross-skill effects exist: high Tactics buffs allies' Marksmanship in combat.

### 4.5 Attributes (stats)

Six character attributes layered between vitals and skills. They represent **trained physical/mental capacity** — slow-moving, drift up *or* down with use and neglect. Distinct from vitals (instantaneous bodily state) and skills (learned proficiencies).

Inspired by *Jack o' Nine Tails*: stats are bidirectional, gated by a hidden per-character talent multiplier, and react to both deliberate training and chronic neglect.

| Stat | Domain |
|---|---|
| 力量 Strength | Physical labor, melee, lift caps, drink tolerance |
| 耐力 Endurance | Fatigue / hunger / thirst drain rates, HP regen, illness recovery |
| 魅力 Charisma | Social appeal, shop prices, bar tips, NPC opinion drift |
| 智力 Intelligence | Skill-learning rate, book efficiency, mental-job performance, error rate |
| 反应 Reflex | Reaction time, fine motor, movement speed; gates piloting |
| 意志 Resolve | Mood tolerance; gates Newtype-related skills and activity (Phase 7+) |

#### 4.5.1 Per-stat state

```
value         : 0–100              visible "level"
talent        : 0.7–1.4            hidden, set once at character creation
talentCap     = floor(talent × 100), clamped to 100
recentUse     : 0–100               rolling 7-day intensity buffer
recentStress  : 0–100               rolling 7-day stress buffer
```

**Floor = 5** (catatonic-but-alive baseline). Sustained neglect can drag a stat this low.

#### 4.5.2 Daily drift

Once per game-day, per character, per stat:

```
target = clamp(recentUse × talent − recentStress, FLOOR, talentCap)
value += (target − value) × DRIFT
```

`DRIFT = 0.10` — a fully-grinding week (recentUse maxed, no stress) takes roughly **3 game-weeks** to land at the target value. Tuneable; revisit after playtesting.

The 7-day rolling buffers smooth out single-day spikes — one heroic session doesn't move the needle, a lifestyle shift does.

#### 4.5.3 Use sources (feed `recentUse`)

| Stat | Sources |
|---|---|
| Strength | `working` at labor/mechanic stations; heavy lifting (Phase 4+); drinking sessions (small) |
| Endurance | long shifts; full sleep cycles; sustained activity while vitals are above 70 |
| Charisma | `reveling` at the bar; shop transactions; workplace co-presence with other characters; social interactions (haggling, persuading, defusing) |
| Intelligence | `reading`; jobs with skill ∈ {computers, medicine, electronics, fabrication}; debate / explanation moves in dialogue |
| Reflex | piloting actions (Phase 5+); fine-skill jobs (mechanics, electronics, fabrication, medicine); distance covered while walking; future sports/zero-G interactable |
| Resolve | Newtype-related skills and activity (Phase 7+) — TBD until those systems land |

#### 4.5.4 Stress sources (feed `recentStress`)

Conditions that have been true the majority of the last game-day. Multiple triggers stack additively on the same stat.

| Trigger | Stresses |
|---|---|
| Hygiene > 70 sustained | Charisma |
| Hunger > 70 sustained | Strength, Endurance |
| Thirst > 70 sustained | Endurance, Intelligence |
| Fatigue > 70 sustained | Reflex, Intelligence |
| Boredom (fun) > 70 sustained | Resolve |
| Homelessness > 1 day | Charisma, Resolve |
| Unemployment > 7 days | all (mild) |
| Sleeping at flop tier sustained | Resolve (mild) |
| `reveling` session (alcohol) | Strength (small, per session) |
| HP < 50 | all (proportional) |
| HP < 25 | all (strong) |
| Sickness, injury (Phase 4+) | Strength, Endurance, Reflex |
| Low mood < 30 sustained (Phase 5+) | Charisma, Resolve |

**This list is the seed, not the final.** More triggers will be added as Phase 4 physiology, Phase 5 social/mood, and Phase 7 war-era systems land.

#### 4.5.5 Downstream effects

Each stat reads into one or more systems via a default **0.5×–1.5× multiplier mapping** (0.5× at value=0, 1.5× at value=100). Mappings can be system-specific (some are inverse — high stat = lower drain).

| Stat | Reads into |
|---|---|
| Strength | Mechanic / labor job perf multiplier; carry capacity (when inventory expands); melee damage (Phase 5+); drink tolerance — alcohol stress on Strength is reduced when Strength is already high |
| Endurance | **Fatigue drain rate (inverse — high Endurance = slower fatigue accumulation)**; hunger drain rate (inverse, mild); thirst drain rate (inverse, mild); HP regen rate; sleep efficiency (inverse — recover the same fatigue from less time in bed); sickness recovery duration (Phase 4) |
| Charisma | Shop buy/sell prices; bar fun-recovery rate; bar tip income when working as bartender; HR / interview success at higher-tier jobs (Phase 2 polish); NPC opinion drift speed (Phase 5); success chance on social-attempt moves (persuade, charm, haggle, defuse) |
| Intelligence | Skill-XP gain multiplier; `reading` duration (inverse — smarter = faster read); mental-job perf multiplier (computers, medicine, electronics, fabrication, engineering); error rate on piloting / medical procedures (inverse, Phase 4+) |
| Reflex | Movement speed (px/game-min); mobile-worker / spacecraft / mobile-suit piloting performance (Phase 5+); fine-skill action speed (mechanics, electronics, surgery); reflexive event interrupts (Phase 4+ — dodge a falling crate, catch a dropped tool) |
| Resolve | Mood tolerance (mood degradation slower); ability to keep working / finishing actions while vitals are critical; success chance on confrontational social moves (intimidate, refuse, hold composure under threat); Newtype Aptitude prerequisite signal (Phase 7+) |

#### 4.5.6 Talent and randomization

Talent is **hidden**. It reveals itself indirectly: a character's value approaches its talentCap and stops rising, signalling "this is your ceiling here."

For the MVP wiring, all characters launch with **talent = 1.0** across every stat (talentCap = 100). Talent randomization is deferred to:

- The **character creator** (player) — sets talent from origin + background + traits.
- The **NPC generator** (Phase 3 procgen) — sets NPC talent from a seeded RNG.

Until both land, every character has the same ceiling, but differentiated stat *values* still emerge from differentiated activity and stress.

#### 4.5.7 Phasing within attributes

| Phase | Stat work |
|---|---|
| **Shipped** | Stats infrastructure (state + drift + use buffer); Strength→work-perf, Endurance→fatigue-drain, Reflex→move-speed, Intelligence→skill-XP, Charisma→work-perf; stress sources for saturated vitals (hygiene/hunger/thirst/fatigue), HP bands, homelessness, unemployment grace, alcohol |
| **Phase 2 polish** | Charisma→shop prices; bar fun-recovery; reading-duration scaling |
| **Phase 3** | NPC talent randomization; stress sources for boredom + flop sleep (gated on Resolve participating) |
| **Phase 4** | Sickness/injury stress; HP-based stress |
| **Phase 5** | Mood-based stress; Charisma→NPC opinion shifts |
| **Phase 5+** | Reflex piloting downstream; social-move stat checks (Charisma persuade/haggle, Resolve intimidate/refuse) |

## 5. Time & control

| | |
|---|---|
| Real → game ratio | **25 real-min = 24 game-hours** |
| Sim tick | **1 game-minute** (≈ 1 tick / real-second at 1×) |
| Render | 60 fps, interpolated between sim ticks |
| Speeds | pause / 1× / 2× / 4× |

### 5.1 Commitment-skip mode

When the player commits to a long action (sleep 8h, study 2h, surgery, travel, work shift), simulation runs at max speed (~1 game-second per real ms) until:

- duration completes
- vitals threshold crossed (e.g. injury, contagion)
- scheduled event hits (appointment, contract deadline)
- NPC enters interaction range with high `wants_to_talk` drive
- urgent inbox event arrives
- player cancels

Wakes the player back into normal time at the moment of interruption with a log entry explaining why. NPCs continue to run their AI through skip — when the player returns from sleep, the world has changed.

## 6. NPC AI

### 6.1 Architecture: utility AI + behavior trees
- **Utility AI** (custom, ~150 LOC) selects the *goal*. Each tick, score candidate considerations across drives, distance, capability, preference; pick the maximum.
- **Behavior trees** (mistreevous library) execute the *plan*. Sequence/fallback/retry: pathfind → use object → consume → log.

### 6.2 Drives
Computed each tick from:
- **Vitals** (hungry → "eat" drive)
- **Schedule** (work shift active → "be at workstation" drive)
- **Social state** (lonely → "find friend X" drive)
- **Memory & opinions** (avoid disliked, return to favored)
- **Faction events** (rumor of war → fear → seek company/shelter)
- **External policy weights** (Phase 6: when player runs a faction, they author these)

### 6.3 Memory
Per NPC: persona blob (immutable; perfect cache target for future LLM use) + rolling memory log (last N events). Memory affects opinions, drives, dialogue.

### 6.4 Schedules
Soft priors on utility scores, not hard rules. NPCs *tend to* go to work at 9 because the utility of "be at workstation" rises sharply at 9, but they can skip if a stronger drive overrides.

### 6.5 Player as NPC
The player character is structurally identical to NPCs — same trait set, same drive computations exist, just disabled and replaced by player input. This is what makes the Phase 6 transition (managing a faction) require zero rewrite: just toggle which characters are player-driven vs autonomous.

## 7. Social & factions

### 7.1 Relationships
Modeled as Koota relations (entity-to-entity edges with data: opinion, last interaction, nature). Friendships and feuds emerge from accumulated interactions.

### 7.2 Faction reputation
Player has a reputation (-100…+100) with each faction. Affects which NPCs will talk, which jobs are available, which areas accept them.

### 7.3 Newsfeed (Phase 5)
Date-keyed events fire as radio/news ticker entries. Pre-war: low-grade Zeon autonomy debates, AE contract leaks, civic items. War-era: dramatic shifts. Pure flavor that drives mood and contextualizes drives.

### 7.4 Faction management (Phase 6 — FTL/mercenary layer)
Player establishes a small group (e.g. mercenary cell). Members are NPCs governed by utility AI but with player-authored work priorities (RimWorld-style job × priority matrix). Player takes contracts, manages assets, doesn't micromanage actions.

## 8. World generation

Procedural, **seeded** (same seed → same Von Braun; saved with the save file).

### 8.1 Hybrid: anchored landmarks + procedural fill
- **Fixed landmarks** always generate with stable names: Anaheim subcontractor workshop, Spaceport gate, "Lazlo's" bar, public clinic, Federation/Zeon consulates, player's apartment block. Authored as room-template JSON.
- **Procedural fill** for residences, shops, alleys, corridors, secondary buildings.

### 8.2 Generator approach
Constraint-based, not noise-based:
1. Sectors: residential / commercial / industrial / civic
2. Place landmarks first by required sector
3. Stamp room templates per sector with required adjacencies (clinic→corridor, apartments cluster, industrial→dock corridor)
4. Weave corridors connecting all rooms
5. Validate connectivity; retry on failure

WFC is **not** used for floorplan generation (wrong tool for the job). It may show up in Phase 2+ for *decorating* rooms with coherent furniture.

### 8.3 NPCs are also procedural per seed
Named NPCs with procedurally-assigned apartments, jobs, daily routes. Combined with fixed landmarks, the *cast* and *paths* differ each run while the *places* stay iconic.

## 9. Saves

- Slot-based + autosave on day-rollover and on commitment-skip start
- Save = `{ rngSeed, clock, allTraits, playerId, version }` serialized via superjson
- Versioned migrations from day 1
- Storage: idb-keyval (IndexedDB)
- Permadeath later = flag that disables save-on-load and deletes slot on death

## 10. LLM integration (Phase 8)

Designed for now, used later:
- Each NPC has a stable **persona blob** (immutable history, personality, allegiance) + **rolling memory log**. Persona is a perfect prompt-cache target.
- LLM never mutates state directly. It returns either a dialogue string or a `proposed_action` from a fixed schema; proposed actions feed back into the utility AI as scored candidates.
- Floor stays correct: utility AI alone always produces valid behavior. LLM is *flavor on top* — better dialogue, more in-character action selection.
- Provider: Claude API via `@anthropic-ai/sdk` with prompt caching.

## 11. Localization

- **Player-facing language: zh-CN.** Source-of-truth strings authored in Chinese.
- **i18n hooks present from day 1** so future translation is a translation job, not a refactor.
- **Library**: LinguiJS — compile-time extraction (no missing keys at ship), 10.4 KB.
- **Source language config**: `zh-CN`. English (and others) become target locales later.
- **Dev artifacts in English**: code, comments, this document, inspector UI, console logs, error messages.
- **Fonts**: system stack `"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif`. One brand font subsetted to GB2312 second-tier (~6,500 chars) via glyphhanger.
- **Canvas text**: `wrap='char'` for CJK line-breaking, offscreen-cached for static labels, lazy-rendered for dynamic.

## 12. Tech stack

```
Vite + React + TypeScript
├─ Koota .................. ECS (sim state, traits, relations, queries)
├─ react-konva ............ canvas rendering
├─ zustand + immer ........ UI state (non-sim)
├─ easystarjs ............. async A* pathfinding
├─ rot.js ................. seeded RNG, procgen utilities
├─ mistreevous ............ behavior trees (NPC plan execution)
├─ LinguiJS ............... i18n (zh-CN source)
├─ idb-keyval ............. save slots
├─ superjson .............. save serialization
├─ @anthropic-ai/sdk ...... LLM (Phase 8 only)
└─ (custom) ............... tick loop, utility AI, room generator
```

Combined runtime budget ≈ 80 KB gzipped + brand font.

## 13. Architecture

```
┌── Time/Scheduler ────┐   tick-based, decoupled from frames
│                      │   pause/1×/2×/4×/commitment-skip
│                      │
├── World (Koota) ─────┤   Tiles, Items, Characters as entities
│                      │   Components = Koota traits
│                      │   Relationships = Koota relations
│                      │
├── Simulation systems ┤   Each tick, in order:
│                      │     1. Vitals (drain & recovery)
│                      │     2. Physiology (sickness/injury)
│                      │     3. Skills (XP, decay)
│                      │     4. AI (utility scoring → BT execution)
│                      │     5. Pathfinding (easystar, async)
│                      │     6. Social (memory, relations)
│                      │     7. Events (date-keyed, log emission)
│                      │
├── Render (Konva) ────┤   useQuery to subscribe to renderable entities
│                      │   pure read of sim state + interpolation
│                      │
└── UI (React) ────────┘   Inspector, character card, newsfeed,
                           journal, faction map, dialogue
```

**Critical principle**: rendering is a pure read of the sim. The sim must be runnable headless — this is what unlocks tests, accelerated time, and (later) putting the sim in a Web Worker via Comlink.

### 13.1 Project structure
```
src/
  sim/          tick loop, speed control, commitment-skip
  ecs/          Koota traits, relations, world setup
  systems/      one file per system (vitals, ai, social, ...)
  ai/           utility AI, drives, behavior tree definitions
  procgen/      room templates, sector generator, NPC generator
  render/       Konva components, sprite atlas, camera
  ui/           React UI panels (zustand-backed)
  data/         landmark templates, item defs, skill defs, news events
  i18n/         Lingui catalogs, message extraction config
  save/         serialization, migrations, idb-keyval wrapper
  llm/          (Phase 8) Claude client, persona/memory packing
```

## 14. Phasing

| Phase | Scope | Demo moment |
|---|---|---|
| **0. Skeleton** | Vite/React/Koota/Konva/Lingui set up; tile renderer; clock with pause+1×+2×+4×; player walks a hand-placed throwaway map | "I wander an empty district and the clock advances" |
| **1. Survival core** | Vitals; eat/sleep/wash interactables; death-from-neglect; commitment-skip for sleep | "I survive a week" |
| **2. Skills + economy** | Inventory; skill set; one job (work shift → wage); shops; books for skill grind | "Work → eat → train → sleep" loop closes |
| **3. NPC utility AI + procgen** | Procedural Von Braun district; 10–20 named NPCs with schedules/drives/pathfinding/memory; relations | "Sleep-skip and wake to a different station" |
| **4. Physiology** | Sickness, injury, contagion, clinic, permadeath toggle | "Flu spreads through a workplace" |
| **5. Social + factions + news** | Faction reputation; faction-tagged NPCs; date-keyed news ticker; relationship dynamics | "My loyalty matters; war rumors land" |
| **6. Faction management (FTL layer)** | Player establishes group; work priority matrix; contracts; assets | "I run a 4-person merc cell" |
| **7. War event** | UC 0079.01.03 hits; world state shift; factions go hostile; Von Braun changes | The prologue payoff |
| **8. LLM dialogue + intent** | Persona-cached Claude prompts for dialogue and proposed actions | "Talking to NPCs feels alive" |

## 15. Open / deferred

- Permadeath UX (unlock in Phase 4)
- Save migration policy when traits churn pre-1.0
- LLM cost model and rate-limiting (Phase 8 design)
- Sound design (deferred indefinitely; ambient tracks + UI clicks adequate)
- Mobile suit subsystem when UC 0079+ unlocks Mobile Suit Piloting skill
- Character creator UX (sets stat talents per §4.5.6); NPC talent randomization via seeded RNG. Until both land, every character launches at talent = 1.0.
- Stat balance pass after first playtests of §4.5: tune `DRIFT`, the floor, and the use/stress feed weights once the harshness reads in actual play.

---

*End of design document. Phase 0 implementation begins after this is locked.*
