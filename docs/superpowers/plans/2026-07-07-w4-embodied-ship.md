# W4 — Embodied Ship + Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ship a place, not a set of menus. Hired crew physically live aboard the flagship on real duty schedules; the crew rooms are furnished with beds, a mess, and stations crew actually use; a hangar-boss crew member runs an on-ship hangar deck (which closes the two cross-workstream deferrals — W1.5 on-ship MS repair band and W3.6 real resupply crew stats); boarding collapses to a single airlock with a real readiness briefing; the last stub seams (leave-the-helm-in-world, climb-into-MS-outside-combat, negotiate) become diegetic; and the loop's presentation gets a floor (label layout, tactical starfield + per-class ship sprites, tally formatting).

**Architecture:** Workstream 4 (final) of `docs/superpowers/specs/2026-07-04-ship-ms-combat-ux-design.md`. Builds on shipped substrate: `systems/npc.ts` bucket scheduler + `ai/agent.ts` BT + `ai/trees.ts` (crew reuse the city NPC brain, gated like the existing `Guard` branch), `systems/fleetCrew.ts` (`Ship.crewIds` roster + `EmployedAsCrew`), `ecs/spawn.ts` `seedShipSceneLayout` (ship-interior seeding), `systems/hangarRepair.ts` + `stats/shipSchema.ts` (`onShipRepairCap`/`onShipRepairFloor` declared, read nowhere yet), `sim/sortieResupply.ts` (placeholder resupply constants), `systems/msCustody.ts` (load/unload verbs), `sim/engagement.ts` + `ui/EngagementModal.tsx` (negotiate stub), `render/ground/PixiGroundRenderer.ts` (shared interior labels), `render/space/PixiTacticalRenderer.ts` (chevron ships, no starfield), `ui/CombatTallyPanel.tsx` (tally loot lines).

**Tech Stack:** TypeScript, koota ECS, zustand, React overlays, Pixi.js renderer, Playwright smokes (deterministic substrate, CLAUDE.md rule 8 for journey legs), json5 config/data.

## Global Constraints

- Player-facing strings zh-CN; code/comments/commits English. **No magic numbers in `.ts`** — new tunables go to `src/config/*.json5` or the data rows in `src/data/*.json5` (crew station tiles + duty hours in `ship-classes.json5` / a new `crew.json5`; toll costs in `combat.json5`; repair-band rate + resupply fallbacks in `sortie.json5`), each with a derivation comment.
- TDD; smokes obey the 8 construction rules; journey legs are rule-8 read-only on `__uclife__` (debug handles observe, never drive); `retries: 0` stays. Known #160 parallel flakes: verify serially (`--workers=1`) and note; CPU-heavy new specs go into `scripts/ci-local.mjs`'s serial bucket.
- Verify per task: targeted `npm run ci:local -- --grep <pat>`, `npm run test:unit`, `npx tsc -b`, `npm run lint:arch`; full `npm run ci:local` before the capstone commits. Commit every task; design docs (`Design/fleet.md`, `Design/sortie.md`, `Design/ship.md` if present) sync in the same commit as behavior changes.
- Perf (CLAUDE.md budget rule): crew aboard reuse the existing `npcSystem` bucket scheduler at game-tick rate on the **active scene only**; **N ≤ crewMax (≤ 200 on Pegasus)**; duty resolution is O(1) per crew per re-think (read `Ship` dock/transit state + a schedule lookup, no scan). Budget: within the existing `btBudgetPerFrame`; no new scaling class. Renderer: starfield is **static** (built once in the tactical-renderer constructor, never per-frame); per-class ship sprites stay pooled `Graphics` redrawn only on class change. Tactical arena budget stays `< 2 ms/frame @ N=100 projectiles`.
- Engine/layer boundary: mutation logic in `src/systems/*` + `src/sim/*` (no React); `src/ui/*` reads via `useQuery*` / `getGameState()`; dialogue branches localize via `dialogue-text.json5`. Upward imports are bugs.

## Decisions locked (spec + this planning pass)

- **Full crew duty scheduler (answer 1).** Crew get a real time-of-day schedule primitive: man assigned stations when **underway**, otherwise cycle **mess (meal windows) / quarters (sleep window) / off-duty**. Authored as data (station anchor tiles + duty roles + shift/meal hours), consumed by a new crew-duty BT branch mirroring the existing `Guard` gate. Not a "present-only" slice.
- **Readiness is advisory, not a launch gate (answer 2).** The captain's-office panel gains three readiness rows (crew slots filled, MS loaded, pilots assigned) with clear red/green states; **`takeHelm()` stays ungated** — the player may still sortie undercrewed. No soft-lock risk.
- **Crew eat at a shared mess station (answer 3).** The mess `eat` interactable is real (player hunger recovery) AND crew walk to it and consume a **shared ship mess supply** (config-authored drawdown on the ship's supply pool), not personal `Inventory.meal`. A new crew eat-at-station BT action + supply-drawdown bookkeeping.
- **Crew are respawned by key, never moved across worlds.** koota entity ids are per-world; crew bodies aboard are materialized in `playerShipInterior` keyed `npc-crew-<N>`, and the save respawn path + flagship-switch teardown are reconciled so a crew key resolves to exactly one world. This is the correctness spine of Task 1.
- **`repairProgress` is NOT reintroduced.** The W1.5 implementation deliberately omitted it (the hull/armor deficit *is* the progress; `computeMsDamageState` derives `damageState`). The spec's W1.5 line mentioning `repairProgress` is stale prose, not a gap — do not add the field. The on-ship band clamps the deficit, nothing more.
- **Negotiate = clean peaceful disengage on paid toll.** Toll `= tollBase + tollPerEscort × escortCount` (config). Afford + pay → new `resolvePeacefulDisengage()` (no flee penalty, opens a debrief with the toll line); can't afford or refuse → `startCombat(...)`. Money debits the **avatar** (`findPlayer()` → the `Money`-bearing entity), never the space-world `IsPlayer` ship.
- **One airlock.** Delete the legacy airport `boardShip` kiosk + its orphaned `ship-board` template + the now-dead marker-less `boardShip` fallback branch; the gate-booth board pad is the sole airlock. No smoke depends on the kiosk.

## Ordering & parallelization

Unlike W2 (near-pure-parallel UI), W4 has a hard spine:

```
Task 1 (crew seeding + save reconcile)  ─┬─►  Task 2 (duty scheduler + BT)
                                         ├─►  Task 3 (furnished rooms, incl. crew mess/beds)
                                         └─►  Task 4 → Task 5 (hangar boss + on-ship deck)
Task 6 (one airlock + readiness) ──── independent leaf (parallelizable now)
Task 7 (diegetic seams) ───────────── independent leaf (parallelizable now)
Task 8 (presentation floor) ───────── independent leaf (parallelizable now)
Task 9 (W4 journey capstone) ──────── last, after 1–8
```

Tasks **6, 7, 8** touch disjoint files and depend on nothing in Task 1's spine — dispatch them as parallel worktree-isolated agents. Tasks **1 → 2/3/4** must sequence (they share `ecs/spawn.ts` crew-seeding + the `Ms`/`Ship` reads). Task **5** follows Task 4. Task **9** is the capstone and lands last.

---

### Task 1: Crew live aboard — seeding + save reconcile (W4.1 spine)

**Files:**
- Modify: `src/ecs/spawn.ts` (`seedShipSceneLayout` ~1176; new `seedCrewAboard`/reconcile; `tearDownShipSceneLayout` ~1239 currently spares `Character` — must reconcile on switch), `src/sim/scene.ts` (`boardShipByKey` ~131 calls the reconcile), `src/systems/fleetCrew.ts` (roster read helpers), `src/save/index.ts` (~408 crew now respawn in the ship world, not their pre-hire snapshot scene), possibly `src/boot/saveHandlers/`
- New: `src/systems/crewAboard.ts` (materialize/reconcile a `Character` body per `Ship.crewIds` + `assignedCaptainId` in `playerShipInterior`, keyed `npc-crew-<N>`, tag `EmployedAsCrew`)
- Trait: activate the reserved `CrewStation` (`src/ecs/traits/character.ts:351`, currently unused)
- Test: `src/systems/crewAboard.test.ts` (unit: reconcile idempotence, save round-trip world identity), fixture + `tests/smoke/crew-aboard.spec.ts`

**Interfaces:**
- Consumes: `Ship.crewIds`/`assignedCaptainId` (EntityKey strings), `spawnNPC` trait bag, `SHIP_SCENE_ID`.
- Produces: `reconcileCrewAboard(shipEnt): void` — idempotent; after it, exactly the roster's crew (+captain) exist as bodies in `playerShipInterior` keyed `npc-crew-<N>`; extras removed, missing spawned. Called from `seedShipSceneLayout`, `boardShipByKey`, and after `tearDownShipSceneLayout` on flagship switch.

- [ ] Failing test first: board a flagship whose roster has N crew → assert N crew `Character` bodies exist in `playerShipInterior` with `EmployedAsCrew`; hire/fire one → reconcile → count tracks; **save → reload → each `npc-crew-<N>` resolves in exactly one world (the ship), no duplicate/orphan**; flagship switch → old bodies gone, new roster seeded. Red → implement → green.
- [ ] Perf note in commit body: N ≤ crewMax, reconcile is O(crewIds) at board/switch (event-driven, not per-tick); bodies then tick on the existing active-scene `npcSystem` bucket scheduler.
- [ ] Gates + commit: `feat(ship): hired crew live aboard the flagship — seed + save-reconcile (W4.1)`

### Task 2: Crew duty scheduler + BT branch (W4.1 full)

**Files:**
- Data: `src/data/ship-classes.json5` (per-room duty **station anchor tiles**; validate walkable, not on a `Wall`), new `src/config/crew.json5` + `src/config/crew.ts` (duty roles, shift hours, meal windows, sleep window — all tunable)
- Modify: `src/ai/trees.ts` (crew-duty branch, gated ahead of the generic drive tree, mirroring `Guard` at ~26-44), `src/ai/agent.ts` (conditions `isCrewOnDuty`/`isUnderway`; actions `goToStation`/`holdStation`/`goToMess`/`goToQuarters`), `src/systems/crewAboard.ts` (an `underway` resolver from `Ship.dockedAtPoiId`/transit state), `src/config/ai.json5` (labels/thresholds if any)
- Test: `src/ai/crewDuty.test.ts` (schedule resolution: underway→station, meal window→mess, sleep window→quarters), extend `tests/smoke/crew-aboard.spec.ts`

**Interfaces:**
- Consumes: `CrewStation`, `EmployedAsCrew`, the `underway` resolver, the schedule config.
- Produces: crew whose current BT target is duty-correct for `(underway, time-of-day)`; off-duty falls through to the existing vital-driven drives (which now find the Task 3 furniture).

- [ ] Failing test first: seed crew, set ship underway → crew path to their station anchor and hold; dock + advance to a meal window → crew at mess; advance to sleep window → crew in quarters. Drive sim time via `step({until})`, read positions/actions via `getGameState()`. Red → implement → green.
- [ ] Confirm the station-anchor tiles are walkable (pathfinding warmed; no anchor on a wall) — reuse `markPathfindingDirty(SHIP_SCENE_ID)`.
- [ ] Gates + commit: `feat(ship): crew duty schedules — stations underway, mess/quarters off-duty (W4.1)`

### Task 3: Furnished rooms — player + crew usable (W4.2)

**Files:**
- Data: `src/data/ship-classes.json5` (append `interactables` to `crewQ` = player bed + N crew beds; `mess` = eat station; author as tile `offset`s; skip `lunarMilitia`/rooms without space; `bar` only where a room has spare tiles), `src/data/object-templates.json5` (visual templates for ship bed / mess station / bar)
- Modify: `src/ecs/spawn.ts` (extend `SHIP_KIOSK_TEMPLATES` ~1477 with `sleep`/`eat`(/`bar`) bindings — currently throws at boot for unmapped kinds; extend the ship-room spawn loop ~1216-1231 to also attach `Bed(...)` on `sleep` kiosks and `BarSeat` on `bar`, mirroring city `spawnBed`/`spawnBarSeat`), `src/config/kinds.ts` (crew-bed tier if a new non-lounge tier is needed so `findBestOpenBed` accepts it), `src/systems/interaction.ts` (ship bed = free-claim branch — the current non-lounge path toasts "go see the realtor"; ship bunks must be free)
- Crew eat-at-station (answer 3): `src/ai/agent.ts` (new `eatAtMess` action: walk to mess `eat` interactable, consume a **shared ship mess supply** — config drawdown on the ship supply pool), `src/config/crew.json5` (per-meal supply cost), `src/systems/crewAboard.ts` or a mess-supply helper
- Test: `tests/fixtures/ship-furnished.json5` (new), `tests/smoke/ship-furnished.spec.ts` (player walks to bunk→`sleeping`+fatigue recovers, to mess→`eating`+hunger recovers; a crew NPC claims a crew bed and eats at the mess drawing ship supply)

**Interfaces:**
- Consumes: the Task 1 crew bodies + Task 2 off-duty branch; `Bed`/`Interactable` queries (`findBestOpenBed`, mess `Interactable({kind:'eat'})`).
- Produces: player bunk (free sleep) + mess (eat) aboard; crew-usable beds (non-lounge tier, same region) + a mess station crew consume from shared supply.

- [x] Failing test first (player leg): board → walk to `crewQ` bunk → `Action.kind==='sleeping'`, `Vitals.fatigue` recovers; walk to `mess` → `eating`, `Vitals.hunger` recovers. Red → author data + templates + spawn traits + free-claim branch → green.
- [x] Failing test (crew leg): a seeded crew NPC on its off-duty branch claims a crew bed (`findBestOpenBed` returns it) and eats at the mess, decrementing the shared mess supply. Red → add `eatAtMess` action + supply drawdown → green.
- [x] Sync `Design/ship.md`/`Design/fleet.md` room-furnishing notes. Gates + commit: `feat(ship): furnish crew quarters and mess — player + crew usable (W4.2)`

### Task 4: Hangar boss + on-ship MS repair band — completes W1.5 (W4.3a)

**Files:**
- Modify: `src/ecs/spawn.ts` (designate one seeded crew body as hangar boss in the `hangarBay` room — a role field or a `hangar_boss` workstation spec seeded there), `src/ui/dialogue/types.ts` (`DialogueRoles` gains `isHangarBossOnDuty`), `src/ui/NPCDialog.tsx` (~124-127 compute the role)
- New: `src/systems/onShipRepair.ts` (band-clamped aboard-MS repair reading `onShipRepairCap`/`onShipRepairFloor` via `getStat(shipSheet,…)`; hull/armor fraction rises only into `[floor, cap]`; MS below floor refused; **completes W1.5** — these stats are declared in `shipSchema.ts:37-38` but read nowhere today), `src/config/sortie.json5` (on-ship repair rate knob)
- Test: `src/systems/onShipRepair.test.ts` (aboard-MS below floor stays; within band repairs toward cap, never past; depot repair still reaches 100%), extend a smoke

**Interfaces:**
- Consumes: aboard-MS (`Ms.storedOnShipKey === flagshipKey`, `dockedAtPoiId===''`), ship stats `onShipRepairCap`/`onShipRepairFloor`.
- Produces: `runOnShipRepair(ship)` per repair tick; `describeOnShipRepair(ship)` read for the Task 5 panel.

- [x] Failing test first: aboard damaged MS below `onShipRepairFloor` → not repaired; MS within band → hull/armor climbs to `onShipRepairCap` and stops; depot MS (unloaded) still repairs to 100% via `hangarRepair.ts`. Red → implement → green. Route `damageState` only through `computeMsDamageState` (never hand-set).
- [x] Sync `Design/fleet.md`/`Design/sortie.md` on-ship-repair notes; note "completes W1.5" in commit body. Gates + commit: `feat(ship): hangar boss + on-ship MS repair band — completes W1.5 (W4.3)`

### Task 5: On-ship hangar-deck surface + real resupply stats — completes W3.6 (W4.3b)

**Files:**
- New: `src/ui/dialogue/branches/hangarBoss.tsx` (talk-verb surface gated on `isHangarBossOnDuty`: aboard-MS list, forward-repair-priority control bounded by the on-ship band — mirrors `RepairPriorityPanel` but targets aboard-MS; load/unload verbs reusing `msCustody.ts` `unloadMsToDepot`/`loadMsAboard`, surfaced only when the flagship is docked)
- Modify: `src/ui/dialogue/builder.ts` (wire the branch), `src/data/dialogue-text.json5` + `src/data/dialogueText.ts` (zh-CN labels), `src/sim/sortieResupply.ts` (~54-55: replace `defaultHangarBossPerformance` with the boss NPC's `workPerfMul` per the `hangarRepair.ts:294` pattern, and `defaultMechanicCrewCount` with real on-duty mechanic crew aboard; remove the `void Ship; void ShipStatSheet` placeholder marker; keep a config fallback when no boss is aboard — **completes W3.6**)
- Optional rider (design call): fix **#167** — `src/sim/cockpit.ts` `dockMs` (~414) unconditionally exits `piloting`; add a stay-seated dock variant so the player can watch their own MS resupply from the cockpit. Only if the design wants the live resupply timer reachable for the player's own MS; otherwise drive the resupply readout from this walkable hangar-deck surface and leave #167 as filed.
- Test: extend `tests/smoke/ms-sortie-loop.spec.ts` or a new `hangar-deck.spec.ts` (real resupply time responds to boss stat; load/unload at dock via the panel; forward-repair-priority respects the band)

**Interfaces:**
- Consumes: Task 4's `describeOnShipRepair`, `msCustody.ts` verbs, boss `workPerfMul` + mechanic-crew count.
- Produces: the diegetic hangar-deck panel; resupply time now a function of real crew stats.

- [x] Failing test first: resupply time shrinks when a higher-`workPerfMul` boss is aboard vs the config fallback; forward-repair-priority routes on-ship repair to the chosen MS within the band; load/unload verbs move MS ship↔depot at dock. Red → implement → green.
- [x] Sync deferral status in the spec's W1.5/W3.6/W4.3 notes; note "completes W3.6" in commit body. Gates + commit: `feat(ship): on-ship hangar deck + real resupply crew stats — completes W3.6 (W4.3)`

### Task 6: One boarding affordance + readiness briefing (W4.4) — parallel leaf

**Files:**
- Delete: `src/ecs/spawn.ts` legacy airport `boardShip` kiosk (~658-668), `src/data/object-templates.json5` orphaned `ship-board` template (~129), and collapse the now-dead marker-less `boardShip` `else` branch in `src/systems/interaction.ts` (~254-260); prune imports that fall unused (verify `boardShip` stays imported for the debug handle — scope carefully). Keep `kind:'boardShip'`, the marker branch, and `scene.ts` `boardShip`/`boardShipByKey`.
- Modify: `src/ui/CaptainsOfficePanel.tsx` (new advisory readiness section: crew filled via `crewVacancyForShip`, MS loaded = count `Ms` where `storedOnShipKey===flagshipKey`, pilots assigned = subset with `pilotId!==''`; red/green states; `data-*` hooks for smoke reads — **do not** use combat-gated `countLaunchableWings()`), `src/data/dialogue-text.json5` (zh-CN readiness labels)
- Test: `tests/smoke/captains-office.spec.ts` (extend — readiness rows read correct counts against the `starter-fleet` fixture; boarding still works via the gate pad after kiosk deletion)

- [ ] Confirm no smoke references the kiosk (`boardship-`/`ship-board`/`登船`) — grep clean; `journey-first-sortie.spec.ts` already boards via the gate pad (`BOARD_PAD_KEY`). Delete cleanly (CLAUDE.md: no dead flags/imports).
- [ ] Failing test first: readiness section shows filled/loaded/assigned counts and states; `takeHelm()` stays ungated (advisory). Red → implement → green.
- [ ] Gates + commit: `feat(ship): single airlock + captain's-office readiness briefing (W4.4)`

### Task 7: Diegetic seams (W4.5) — parallel leaf

**Files:**
- `climbIntoMs` redirect: `src/systems/interaction.ts` (~349-352 flagship-interior outside-combat branch) — replace the `尚未进入战斗 · 无需出击` toast with `emitSim('ui:open-ms-retrofit',{msKey})` (guard empty `msKey`, mirroring the `msTerminal` branch)
- Negotiate de-stub: `src/config/combat.json5` + `src/config/combat.ts` (typed `negotiate { tollBase, tollPerEscort }`), `src/sim/engagement.ts` (~85-87 implement: toll = config × `enemyEscorts.length`; read `findPlayer().get(Money)`; afford → debit + new `resolvePeacefulDisengage()` in `src/systems/combat.ts` (no flee penalty, opens debrief with toll line); else `startCombat(...)`), `src/ui/EngagementModal.tsx` (~55,62-64 show toll subtitle mirroring flee-cost copy; relabel/disable when unaffordable)
- Diegetic leave-seat verb: `src/ui/SpaceView.tsx` (orbit map) and/or `src/ui/TacticalView.tsx` (tactical) — render an on-seat "离开操舵台 / 下舰桥" affordance anchored to the helm sprite calling existing `leaveHelm()`/`leaveBridge()`; keep the corner/topbar buttons as shortcuts. **No sim change** — reuse the entity-identity-safe verbs verbatim.
- Test: `tests/smoke/negotiate.spec.ts` (pay→disengage: money debited, no combat store; refuse/can't-afford→combat), `tests/smoke/ms-outside-combat-retrofit.spec.ts` (climb helm-side MS outside combat → retrofit panel opens)

- [ ] Failing test first (negotiate): fixture pirate + N escorts; afford → toll debited, no combat; unaffordable → `startCombat`. Toll is pure config × escort count (deterministic). Red → implement → green.
- [ ] Failing test (climbIntoMs): outside combat, climb an aboard MS → `ui:open-ms-retrofit` fires / panel opens. Red → one-branch redirect → green.
- [ ] Re-run `src/sim/cockpit.test.ts` (`leaveBridge` regression) if any leave logic is touched — never call `migratePlayerToScene` from a helm/space-active context (don't destroy the `IsPlayer+ShipBody` campaign ship). Gates + commit: `feat(ship): diegetic seams — climbIntoMs retrofit, negotiate toll, leave-seat verb (W4.5)`

### Task 8: Presentation floor (W4.6) — parallel leaf

**Files:**
- Tally loot line (**testable, DOM**): `src/ui/CombatTallyPanel.tsx` (~59-66 salvaged-parts value line renders delta-only, leaving an orphan `margin-right`), `src/styles.css` (~2520) — make the salvage value line consistent with credits/supplies/fuel rows.
- Ship-interior label layout (presentation): `src/render/ground/PixiGroundRenderer.ts` (interactable label ~949-954, room/building label ~447-449) — add `wordWrapWidth`, shrink/stagger co-room kiosk label offsets; **keep generic** (shared with the city — not a ship-only restyle); label offsets/wrap → config, not inline.
- Tactical starfield (presentation): `src/render/space/PixiTacticalRenderer.ts` — add a **static** star `Container` behind `border` in the constructor (~141-148); star count/seed → `combatConfig`/`spaceConfig`. Never redraw stars per-frame (perf).
- Per-class ship sprites (presentation; mapping logic testable): `src/render/space/PixiTacticalRenderer.ts` (`ShipSnap` ~18-33 + `drawShip()` ~297-326), `src/ui/TacticalView.tsx` (`playerVisual`/`enemyVisual`/`playerMsVisual` ~563-599 thread `shipClass`/`shipClassId`) — replace chevrons with pooled per-class silhouettes keyed off the existing `shipClass` field; a pure `classShape(shipClassId)` mapping is unit-testable even though pixels aren't.
- Test: extend the tally smoke (salvage row markup/text); unit-test `classShape` mapping. **Flag in commit:** starfield / label geometry / sprite pixels are presentation-only (test mode has no WebGL canvas, no renderer handle) — not smoke-assertable by design.

- [ ] Failing test first (tally): assert the salvaged-parts row renders consistent with other loot lines (no orphan margin). Red → fix DOM/CSS → green.
- [ ] Unit test `classShape` mapping (class id → shape spec). Red → implement → green.
- [ ] Apply presentation fixes (labels, starfield, sprites) with config-driven sizes; verify by eye via `npm run dev` (renderer not smoke-assertable). Gates + commit: `feat(render): presentation floor — tally, interior labels, tactical starfield + ship sprites (W4.6)`

### Task 9: W4 acceptance capstone — journey extension

**Files:**
- Modify: `tests/smoke/journey-first-sortie.spec.ts` (extend the existing capstone with W4 diegetic legs, all through **real input**, `__uclife__` reads only)

**Journey additions (rule 8 — debug observes, never drives):**
- After boarding: assert crew bodies are present in `playerShipInterior` (`getGameState()` read) and, if underway, at stations.
- Walk to the captain's office → assert the readiness briefing renders the three rows (advisory).
- On first contact: through the engagement modal, **negotiate** a toll (real click) → assert money debited + peaceful disengage OR, on the combat branch, keep the existing fight→win path (pick the deterministic route the fixture guarantees).
- Outside combat, climb an aboard MS via real interaction → assert the retrofit panel opens (not a toast).
- Leave the helm via the in-world seat verb (real click) → assert scene returns to `playerShipInterior` and the campaign ship entity still exists.

- [x] Extend the journey spec; keep it deterministic (seeded fixture, `step({until})`, no `waitForTimeout`). Full `npm run ci:local` green ×2 (serial + parallel) before commit.
- [x] Update the spec's W4 shipped-status section + this plan's checkboxes; update the program memory. Gates + commit: `test(journey): W4 embodied-ship + diegetic-seams capstone (W4)`

---

## Acceptance

W4 is done when: crew live aboard on real schedules; crew rooms are furnished and used by player and crew; a hangar-boss crew member runs the on-ship hangar deck (W1.5 + W3.6 deferrals closed); boarding is a single airlock with an advisory readiness briefing; climbIntoMs/negotiate/leave-seat are diegetic; presentation has a floor; and `journey-first-sortie.spec.ts` plays the extended loop through real input, green ×2 under full `ci:local`, with `test:unit`, `lint:arch`, and `tsc -b` clean.

## Perf statement (CLAUDE.md budget rule)

- **Crew aboard (Tasks 1-2):** N ≤ crewMax (≤ 200 Pegasus); reconcile is O(crewIds) event-driven at board/switch; per-tick cost is the existing `npcSystem` bucket scheduler on the active scene only, bounded by `btBudgetPerFrame`. Duty resolution O(1) per crew per re-think (dock/transit read + schedule lookup). No new scaling class; profile via the existing NPC profiler.
- **On-ship repair (Task 4):** O(aboard-MS), N ≤ hangar bays (single digits), runs on the existing daily repair chain — no per-frame cost.
- **Renderer (Task 8):** starfield static (built once); per-class sprites pooled `Graphics` redrawn only on class change. Tactical arena stays `< 2 ms/frame @ N=100 projectiles`.
