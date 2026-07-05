# W3 — MS Combat Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make climbing into an MS worth the walk: a distinct flight feel (vernier boost, small hit profile), hostile MS with pilot-quality AI, AI MS wings launched by bridge order, a real cockpit HUD, and ejection with stakes — plus the two inherited bugs that block it (#163 MS damage never persists; #165 non-primary mounts unarmed).

**Architecture:** Workstream 3 of `docs/superpowers/specs/2026-07-04-ship-ms-combat-ux-design.md`. Builds on the shipped substrate: `sim/cockpit.ts` (launch/dock/eject state machine), `sim/hangarDoors.ts` (door queue), `sim/sortieDrain.ts`/`sortieResupply.ts` (per-sortie resources), `sim/recoveryTug.ts` (stranded-hull recovery), `systems/combat.ts` §1 unified directive + §4b MS fire, `fleetOrders.ts` + the W2 order palette (the reserved `msLaunchAuth` cost row finally gets its button). Hostile MS are authored as `isMs` rows in `enemyShips.json5` with a `pilot` quality block; enemy groups in `space-entities.json5` gain `msComplement`. Role tags live on the `Ms` trait and feed wing AI.

**Tech Stack:** TypeScript, koota ECS, zustand, React overlays, Playwright smokes (deterministic substrate, rule 8 for journey legs), json5 config/data.

## Global Constraints

- Player-facing strings zh-CN; code/comments/commits English. **No magic numbers in `.ts`** — new tunables go to `src/config/sortie.json5` / `combat.json5` / `ms.json5` or the data rows in `src/data/*.json5`, each with a derivation comment.
- TDD; smokes obey the 8 construction rules; journey legs are rule-8 read-only on `__uclife__`; `retries: 0` stays. Known #160 parallel flakes: verify serially (`--workers=1`) and note; CPU-heavy new specs go into `scripts/ci-local.mjs`'s serial bucket (the W2 CI fix established the mechanism).
- Verify per task: targeted `npm run ci:local -- --grep <pat>`, `npm run test:unit`, `npx tsc -b`, `npm run lint:arch`; full `npm run ci:local` before the last commits (Tasks 7–9). Commit every task; design docs sync in the same commit as behavior changes.
- Perf: everything new in the tactical tick stays O(deployed units) with no new cross-entity scans; per-frame N target ≤ ~8 ships + ~12 MS (DP-capped). Wing-AI door/resupply decisions are event/threshold-driven, not per-tick searches.
- Locked decisions (from the spec + this planning pass):
  - **Boost input is `KeyF`** (single unused key in the tactical handler; hint line documents it). Boost = temporary `topSpeed`/`accel` multiplier for `boostDurationSec`, then `boostCooldownSec`, costing `boostPropellantCost` per activation — all authored per frame in `ms-classes.json5`.
  - **Hostile MS are `enemyShips.json5` rows with `isMs: true`** (they are CombatShipState rows either way); player frames stay in `ms-classes.json5`. No shared-catalog shim.
  - **Pilot quality block** `pilot { reactionSec, aimJitterRad, boostUse }` on hostile-MS rows; consumed by enemy-MS AI only (ships keep their current AI).
  - **Ejection pod**: a small side-neutral CombatShipState-adjacent entity that drifts; recovered automatically when the engagement ends in victory/withdraw with the flagship alive; captured (pilot POW/lost) on defeat or if a hostile reaches it first (seeded roll windows — deterministic). Player pod under permadeath-on = survival roll → run end on failure; permadeath-off = injury via the physiology system. Life support at zero forces ejection.
  - **Role tags** `'skirmisher' | 'fireSupport' | 'antiMs' | 'antiShip'` on the `Ms` trait (persisted), set in the retrofit panel, consumed by wing AI as target-class preference + maintainRange multiplier (authored in `ms.json5`).

---

### Task 1: MS combat damage persists to the roster (#163)

**Files:**
- Modify: `src/sim/cockpit.ts` (`dockMs` ~line 339, `onMsDestroyed` ~372, `spawnPlayerMs` reads at ~223), `src/systems/combat.ts` (`applyDamageToMs` write-back hook or dock-time sync — pick ONE write-back point and justify), `src/ecs/msDamage.ts` (damageState recompute on write-back)
- Test: `src/systems/msCombatSync.test.ts` (or co-located), extend `tests/smoke/ms-sortie-loop.spec.ts`

**Interfaces:**
- Consumes: `Ms` trait (`hullCurrent/armorCurrent/damageState`), `CombatShipState` clone, `PLAYER_MS_KEY`, `computeMsDamageState`.
- Produces: `syncMsCombatDamageToRoster(msKey: string): void` — copies the combat clone's hull/armor to the persistent `Ms` entity + recomputes `damageState`. Called on dock-back AND on destruction (destruction writes hull 0 → Task 7's ejection builds on this). Wings (Task 5) reuse it per wing member.

- [ ] Failing test first: launch with full hull → damage the clone → `dockMs` → roster `Ms.hullCurrent` reflects the damage and `damageState` recomputed; destruction path writes hull 0. Red → implement → green. Guard: resupply must NOT restore hull (only propellant/ammo — verify against `sortieResupply.ts`).
- [ ] Update `Design/sortie.md`/`Design/fleet.md` in-repair notes if contradicted; close-comment referencing #163 in the commit body (`Fixes #163` goes in the eventual PR).
- [ ] Gates + commit: `fix(ms): combat damage persists to the roster — dock-back and destruction write back (#163)`

### Task 2: Hostile MS frames + pilot blocks + group complements (+ #165 mount fill)

**Files:**
- Modify: `src/data/enemyShips.json5` + `src/data/enemyShips.ts` (schema: `isMs?: true`, `pilot?: {reactionSec, aimJitterRad, boostUse}`; 2 junker MS rows, e.g. `pirate_junkerMs` light + `pirate_junkerMs_gun` fire-support), `src/data/space-entities.json5` + `.ts` (`msComplement?: string[]` per group; author onto 2-3 existing groups — NOT the vonBraun starter picket, which must stay a solo winnable fight), `src/systems/combat.ts` (`startCombat` spawns complement rows with `isMs: true, side: 'enemy'`), `src/data/ship-classes.json5` (#165: fill `defaultWeapons` arrays to match mount counts for lightFreighter/lunarMilitia/pegasusClass — re-derive dependent smoke constants, don't bump)
- Test: extend `src/data/space-entities.test.ts` (complement ids resolve; solo-picket invariant), `tests/smoke/space-combat.spec.ts` or new `ms-vs-ms.spec.ts`

**Interfaces:**
- Produces: enemy MS CombatShipState rows in tactical (small, fast, `isMs`), keyed `enemy-ms-<n>`; the `pilot` block rides on the row's `ai` extension for Task 4. The journey/fuel-budget smokes must stay green (their authored encounters unchanged).

- [ ] Failing data test → author rows → spawn wiring → smoke asserting a complement group fields MS rows in tactical and they fight (hull decreases on either side). #165 fill with a unit test asserting `defaultWeapons.length === mounts.length` for every class. Gates + commit.

### Task 3: MS flight identity — vernier boost + hit profile

**Files:**
- Modify: `src/data/ms-classes.json5` (per-frame `boost { speedMul, durationSec, cooldownSec, propellantCost }`, `hitRadiusPx`), `src/data/enemyShips.json5` MS rows (same fields), `src/systems/combat.ts` (§1 boost state on `CombatShipState` or a transient map; projectile/beam hit-testing reads per-class hit radius — investigate current hit-test shape first and report), `src/ui/TacticalView.tsx` (KeyF handler + hint), `src/config/sortie.json5` if any global knob emerges
- Test: `tests/smoke/ms-boost.spec.ts` (boost raises speed for the window, drains propellant, cooldown blocks re-trigger — drive via real KeyF where feasible, debug reads)

**Interfaces:**
- Produces: `boostState` readable per MS row (Task 4's `boostUse` AI + Task 6's cooldown gauge consume it).

- [ ] Investigate current hit-testing (projectile collision radius; beams instant-hit) and thread `hitRadiusPx` so MS are genuinely harder to hit than hulls — document before/after in the report. Failing smoke → implement → green. Gates + commit.

### Task 4: Pilot-quality AI for hostile MS

**Files:**
- Modify: `src/systems/combat.ts` (§4 enemy fire + §1 directive for `isMs` enemy rows: `reactionSec` delays target switches, `aimJitterRad` perturbs fire solutions via seeded RNG, `boostUse` probabilistically triggers boost on closing/disengage), `src/config/combat.json5` (any shared pilot-AI knobs)
- Test: unit-level where the math is pure (jitter distribution deterministic under seed), smoke asserting a high-jitter pilot misses more than a zero-jitter one over a fixed window (seeded, deterministic counts)

- [ ] Failing tests → implement → green. Perf note: all O(1) per enemy MS per tick. Gates + commit.

### Task 5: AI MS wings — launch order, wing AI, role tags, resupply loop

**Files:**
- Modify: `src/ecs/traits/ms.ts` (`roleTag` field, persisted — extend saveHandlers/ms.ts + round-trip), `src/ui/MsRetrofitPanel.tsx` (role-tag picker), `src/systems/combat.ts` + `src/sim/cockpit.ts` (wing launch path generalizing `spawnPlayerMs` — extract a shared spawn that takes `pilotedByPlayer: false` + pilot NPC; wing rows keyed `wing-<msKey>`), `src/ui/TacticalView.tsx` (msLaunchAuth palette button — W2 reserved the cost row; button enabled when ≥1 pilot-assigned MS aboard), `src/systems/fleetOrders.ts` (issueMsLaunchAuth), new `src/systems/msWings.ts` (wing resupply loop: propellant below `wingResupplyThresholdPct` → fly to flagship, requestDock, resupply via existing queue, relaunch — a small per-wing state machine, threshold-driven), `src/config/ms.json5` (role-tag AI table: target-class preference + maintainRange multiplier), `src/config/sortie.json5` (`wingResupplyThresholdPct`)
- Test: `tests/smoke/ms-wings.spec.ts` — launch order fields the pilot-assigned MS; role tags steer target choice (antiShip wing prefers the ship over the MS escort); dry wing docks, resupplies, relaunches (drive sim time; deterministic)

**Interfaces:**
- Consumes: Task 1's damage sync (per wing member on dock/destroy), Task 3's boost fields (wings may boost), `EmployedAsPilot.msKey` assignments (pilot roster), hangar-door queue.
- Produces: wing rows in tactical; `msLaunchAuth` order live (CP cost 2 per `orderCosts`); role-tag vocabulary for Task 6's HUD and Task 9's spec status.

- [ ] Order per brief: trait+save → retrofit UI → shared spawn extraction (refactor `spawnPlayerMs` without behavior change, prove with existing cockpit smokes) → palette button + order → wing AI role consumption → resupply loop. Failing smoke first per slice; commit may split in two (`feat(ms): wings launch by bridge order` + `feat(ms): wing resupply loop + role tags`) — note in report. Gates.

### Task 6: Cockpit HUD

**Files:**
- Modify: `src/ui/TacticalView.tsx` (while `piloting === 'ms'`: propellant / per-weapon ammo / life-support gauges, boost cooldown, resupply progress when docked-cycle pending, flagship sliver: hull % + AI stance line), `src/styles.css`
- Test: extend `tests/smoke/cockpit.spec.ts` — gauges reflect `Ms` instance values (drive drain via sim time, assert DOM gauge values via data attributes)

**Interfaces:** consumes `Ms` instance fields + Task 3 boost state + `sortieResupply` timer state; produces `data-cockpit-gauge="propellant|ammo|lifeSupport|boost"` attributes for the journey leg.

- [ ] Failing smoke → implement → green. The player must be able to answer "dock now or fight on dry?" from the HUD alone. Gates + commit.

### Task 7: Ejection with stakes

**Files:**
- Modify: `src/sim/cockpit.ts` (`onMsDestroyed` → eject flow), `src/systems/combat.ts` (auto-pause + confirm on player-MS hull 0 per the designed pause set; pod entity spawn; hostile-reach capture check — threshold/event-driven, not per-tick scans beyond one distance check for the pod), new `src/sim/ejection.ts` (pod state, recovery/capture resolution at engagement end, permadeath roll / physiology injury application — check how run-end and injury conditions are applied today: grep permadeath + physiology condition apply), `src/config/sortie.json5` (pod knobs: driftSpeed, captureRollWindow, survivalRollPermadeath), NPC wing pods (same fate roll; pilot NPC death/capture routes through the existing crew-loss path — investigate what exists for crew death and reuse)
- Test: `tests/smoke/ms-ejection.spec.ts` — player eject → confirm prompt (auto-paused) → pod drifts → victory recovers pilot (injury applied, permadeath off); defeat/hostile-reach captures; life-support zero forces ejection; NPC wing pod fate roll deterministic under seed

**Interfaces:** consumes Task 1's destruction write-back, Task 5's wings (NPC pods). The confirm prompt is a small modal (auto-pause per `post-combat.md`'s designed pause set) — real DOM.

- [ ] This is the largest task: follow the brief's slice order (player pod → life-support forced eject → NPC pods → permadeath/injury), failing test per slice. If run-end mechanics don't exist for permadeath, STOP and report BLOCKED with what exists (do not invent a game-over system inside this task). Gates + commit.

### Task 8: Doc amendments + spec status (W3.7)

**Files:**
- Modify: `Design/combat.md` (Cockpit-mode section rewritten around direct control; strike "the minigame primitive model is the ceiling" + the twin-stick prohibition; document boost/HUD/ejection/wings as shipped shape), `Design/mobile-worker.md` (keep the civilian minigame as future content; remove the "rehearsal becomes the fight" through-line), `docs/superpowers/specs/2026-07-04-ship-ms-combat-ux-design.md` (W3 status block)
- Also: file the `mw_pilot` ambition-verb tracking issue via `gh issue create` (the W1 spec ledger promised it; controller may do this instead — coordinate via report).

- [ ] Docs-only commit; verify no stale cross-references (grep "Engage/Evade/Suppress/Breach" outside historical notes). Commit.

### Task 9: Journey MS leg + full gates

**Files:**
- Modify: `tests/smoke/journey-first-sortie.spec.ts` — during the fight: leave the bridge (real topbar click), walk bridge → hangar (click-to-walk), E on the MS sprite (climbIntoMs), fight in the cockpit (KeyF boost at least once; read a gauge), dock back (返航 when in range — real click), walk back, retake helm (E), win as before. Every action real input; reads only.
- Verify: journey 2× serial; full `npm run ci:local` ×2 (serial-bucket the journey if runtime grew past the parallel budget); `test:unit`, `tsc -b`, `lint:arch`.

- [ ] Extend, run green deterministically, update the plan checkboxes + ledger. Commit: `test(journey): MS sortie leg — W3 acceptance spine green`.

---

## Task order & dependencies

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Task 1 is the foundation (damage persistence) everything above builds on; 2 before 3/4 (frames must exist before their feel/AI); 5 consumes 1+3; 6 consumes 3+5; 7 consumes 1+5. Perf statement for the PR: boost/pilot-AI/wing logic all O(1) per unit inside existing per-tick loops; the wing resupply loop is threshold-triggered (no per-tick pathfinding); pod adds one distance check per tick while a pod exists. Target N ≤ ~8 ships + ~12 MS.
