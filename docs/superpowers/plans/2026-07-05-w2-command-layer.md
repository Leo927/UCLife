# W2 — Command Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Give the tactical layer its command game: fleet orders with real effects (rally / focus-fire / regroup), a CP gauge, DP commit in the war room, mid-combat withdraw, minimal manual fire control, and defeat/flee debrief beats — surfacing the CP/DP backend that shipped dark in `fleetCommandPoints.ts`.

**Architecture:** Workstream 2 of `docs/superpowers/specs/2026-07-04-ship-ms-combat-ux-design.md`. One new system module (`src/systems/fleetOrders.ts` — per-engagement order state + effects consumed by `combat.ts` §1's escort directive), UI additions to `TacticalView.tsx` (palette, CP gauge, weapon-mode rows) and `WarRoomPanel.tsx` (DP section), one new debrief panel, config moves into `combat.json5`. Key discovery baked into this plan: `issueFleetOrder` only debits CP — **order effects do not exist yet**; escort AI runs a fixed nearest-hostile `maintainRange` directive (`combat.ts:1377-1402`). W2.1 is therefore backend + UI, not UI-only.

**Tech Stack:** TypeScript, koota ECS, zustand, React overlays, Playwright smokes on the deterministic substrate, json5 config.

## Global Constraints

- Player-facing strings zh-CN (via `dialogueText` / inline in overlay components per existing convention); code/comments/commits English.
- **No magic numbers in `.ts`** — tunables to `src/config/*.json5`. This plan explicitly migrates `FLEE_HULL_LOSS_PCT` / `FLEE_CR_DRAIN` / `DEFEAT_SURVIVOR_MONEY` (`combat.ts:627-633`).
- TDD; smokes obey the 8 construction rules; journey specs are read-only on `__uclife__` (CLAUDE.md rule 8); `retries: 0` stays.
- Verify per task: relevant smokes via `npm run ci:local -- --grep <pat>`, `npm run test:unit`, `npx tsc -b`, `npm run lint:arch`; full `npm run ci:local` before the last commit of Tasks 6–8. Known #160 parallel flakes: rerun `--workers=1` and note.
- Commit every task. Design-doc sync in the same commit when shipped behavior changes (`Design/combat.md` tactical section, spec status).
- Decisions locked here (from the spec + design review during planning):
  - **Withdraw is always available and CP-free** (design: "withdraw is always available"). The `retreat` row in `fleetConfig.commandPoints.orderCosts` is deleted (no shim). CP-costed orders: `rally`, `focusFire`, `formationChange` (surfaced as 重整队形/regroup). `msLaunchAuth` stays in config but gets **no palette button until W3** (AI MS wings don't exist yet).
  - **Manual fire control is auto/hold/volley per mount, target-picked** — volley fires the mount's ready shot at the in-arc enemy nearest the aim cursor; it is NOT a free-space aimed projectile (deliberate scope guard, documented in the spec status note).
  - Order state is per-engagement transient (like `CombatShipState` / the DP commit set) — reset at `startCombat`, never persisted.

---

### Task 1: Fleet-order effects backend (`fleetOrders.ts` + escort directive consumption)

**Files:**
- Create: `src/systems/fleetOrders.ts`, `src/systems/fleetOrders.test.ts`
- Modify: `src/systems/combat.ts` (§1 directive block ~1377-1402; `startCombat` reset ~586-604)
- Modify: `src/systems/fleetCommandPoints.ts` (delete the CP-regen info log at ~320; keep 耗尽 warn)
- Modify: `src/config/fleet.json5` (delete `orderCosts.retreat`; keep rally/focusFire/formationChange/msLaunchAuth)

**Interfaces:**
- Consumes: `issueFleetOrder(orderId)` (CP debit + refusal), `useCpDp`, `CombatShipState` rows (`side==='player'`, `!pilotedByPlayer`, `!isMs` = escorts), `pushCombatLog`.
- Produces (later tasks call these):
  ```ts
  // src/systems/fleetOrders.ts
  export type FleetOrderId = 'rally' | 'focusFire' | 'regroup'
  export interface FleetOrdersState {
    rallyPoint: { x: number; y: number } | null
    focusTargetKey: string | null
  }
  export function issueRally(point: {x:number;y:number}): OrderResult   // debits 'rally'
  export function issueFocusFire(enemyKey: string): OrderResult          // debits 'focusFire'
  export function issueRegroup(): OrderResult                            // debits 'formationChange'; clears rally+focus
  export function activeOrders(): FleetOrdersState
  export function resetFleetOrders(): void                               // startCombat calls this
  ```

- [x] **Step 1: Failing unit tests** (`fleetOrders.test.ts`, plain zustand/no browser): issuing rally with sufficient CP sets `rallyPoint` + debits; with insufficient CP refuses AND leaves `rallyPoint` unchanged; focus-fire stores the key; regroup clears both; reset clears all. Seed CP via `useCpDp.getState().setCp(n, n)`. Run → FAIL (module missing).
- [x] **Step 2: Implement `fleetOrders.ts`.** Thin zustand store + the issue functions: each calls `issueFleetOrder('<id>')`; on `ok`, writes effect state and pushes one zh-CN combat-log line (`集结指令 · 舰队向指定坐标机动` / `集火指令 · 目标 {name}` / `重整队形 · 各舰返回编队位`); on refusal returns the result unchanged (caller toasts). Run tests → PASS.
- [x] **Step 3: Consume in the escort directive.** In `combat.ts` §1, for entities where `cs.side === 'player' && !cs.pilotedByPlayer && !cs.isMs && !cs.isFlagship`:
  - focus: if `focusTargetKey` resolves to a live enemy `CombatShipState`, use it as `nearest` (fall through to nearest-hostile when dead/gone — and clear the stale key once, with a `目标已失去` info log);
  - rally: if `rallyPoint` set, `thrustWorld` steers toward the rally point (aim still at nearest hostile); within `combatConfig.rallyArriveRadiusPx` (new config key) hold position/strafe.
  Priority: rally movement > default maintainRange movement; focus only changes target selection. Enemies and the piloted ship are untouched. Wire `resetFleetOrders()` into `startCombat` next to `clearBrigPendingTally()`. Delete the CP-regen log line (Task 2 adds the gauge that replaces it).
- [x] **Step 4: System smoke** (`tests/smoke/fleet-orders.spec.ts`, debug-drive allowed): boot a fixture with the flagship + 1 active escort + 2 enemies (extend `starter-fleet` pattern or reuse the fleet fixture the cp-dp spec boots), `startCombatCheat`, issue focus-fire via a new thin debug handle (`__uclife__.issueFleetOrderDebug({kind:'focusFire', enemyKey})` in `src/boot/debugHandles/`), `stepFor` combat seconds, assert the escort's shots/target track the focused enemy (read via a combat snapshot debug READ — add `getCombat().getEscortTargets()` style read if needed) and CP debited. Same for rally (escort position converges toward the point) and regroup. Run → PASS.
- [x] **Step 5: Gates + commit**

```bash
git add -A && git commit -m "feat(combat): fleet orders get real effects — rally/focus-fire/regroup consumed by escort AI"
```

---

### Task 2: Order palette + CP gauge in the tactical HUD

**Files:**
- Modify: `src/ui/TacticalView.tsx` (palette strip + CP gauge + click-target mode), `src/index.css` (or the stylesheet the tactical classes live in)
- Test: `tests/smoke/fleet-orders.spec.ts` (extend with real-input palette clicks — DOM buttons + arena click)

**Interfaces:**
- Consumes: Task 1's `issueRally/issueFocusFire/issueRegroup`, `commandPoolDescribe()`, `PixiTacticalRenderer.screenToWorld(sx,sy)` (already used by mouse-aim at `TacticalView.tsx:446-454`), enemy snapshots (`snapshotEnemies()` keys + positions).
- Produces: `data-tactical-order="rally|focusFire|regroup|withdraw"` buttons, `data-tactical-cp` gauge — Task 8's journey clicks these.

- [x] **Step 1: CP gauge.** In the topbar (`CockpitTopbar`), render `指挥点 {current}/{max}` from `commandPoolDescribe()` (the 30Hz `tick` poll already re-renders). `data-tactical-cp` attribute carrying `current/max`.
- [x] **Step 2: Palette strip.** New `OrderPalette` component (rendered near the topbar, visible while `piloting === 'flagship'` — an MS pilot has no comm authority; note in a comment): four buttons — 集结 (rally), 集火 (focusFire), 重整队形 (regroup), 撤退 (withdraw — wired in Task 3, disabled until then with a tooltip). Rally/focus enter a **click-target mode**: store `pendingOrder` in component state, change the cursor hint line, and the next arena click resolves — rally: `screenToWorld` point → `issueRally`; focus: nearest enemy snapshot within `combatConfig.orderPickRadiusPx` (new config key) of the world point → `issueFocusFire(key)`, no enemy near → cancel toast. Esc or right-click cancels the mode. Refusals (`insufficient_cp`) toast the reason. Buttons show each order's CP cost read from `fleetConfig.commandPoints.orderCosts`.
- [x] **Step 3: Works paused.** Verify issuing while `paused` writes the effect state (it must — pause is the planning moment); the effect applies on unpause. Cover in the smoke: pause → click focus → click enemy → unpause → assert targeting.
- [x] **Step 4: Extend the smoke with real input** for the palette path (DOM clicks + arena `page.mouse.click` at `getEnemyScreenCoords`), keeping Task 1's debug-driven cases for the backend. Run → PASS. Gates.
- [x] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): tactical order palette + CP gauge — the pause finally commands"
```

---

### Task 3: Mid-combat withdraw + flee consequences surfaced + penalty config

**Files:**
- Modify: `src/systems/combat.ts` (withdraw entry; move the three constants), `src/config/combat.json5` (new `fleePenalty { hullLossPct, crDrain }`, `defeat { survivorMoney }`), `src/ui/TacticalView.tsx` (enable palette 撤退 + topbar verb), `src/ui/EngagementModal.tsx` (consequence copy on 脱离)
- Test: `tests/smoke/combat-withdraw.spec.ts` (new)

**Interfaces:**
- Consumes: `endCombat('flee')` + `applyFleePenalty()` (both exist), `useCombatStore`.
- Produces: `withdrawFromCombat(): void` exported from combat.ts (palette + topbar call it); Task 6's debrief consumes the `'flee'` outcome payload.

- [x] **Step 1: Failing smoke**: boot fleet fixture → `startCombatCheat` → click 撤退 (real DOM) → confirm dialog (add a lightweight confirm step in the palette — withdrawing by misclick would be rage-inducing) → assert combat closed, hull/CR penalties applied per config, engagement cooldown prevents instant re-prompt (the spaceSim cooldown map already handles this — assert no modal within a stepFor window). Run → FAIL.
- [x] **Step 2: Implement.** `withdrawFromCombat()` = `applyFleePenalty()` semantics via `endCombat('flee')` (check `endCombat`'s flee branch applies the penalty — if `applyFleePenalty` is only called by the modal path today, route both through one place). Move the three constants into `combat.json5` and read via `combatConfig`; delete the consts. Withdraw needs no CP (locked decision) — enable the palette button + add the topbar 撤退 button.
- [x] **Step 3: Modal copy.** `EngagementModal.tsx:54`'s 脱离 button gains a one-line consequence subtitle derived from config: `脱离 · 船体 -{hullLossPct}% · 战备 -{crDrain}` (values interpolated, no hardcoded numbers). Same numbers therefore appear in both surfaces from one source.
- [x] **Step 4: Green + gates + commit**

```bash
git add -A && git commit -m "feat(combat): mid-combat withdraw verb; flee costs surfaced and config-ified"
```

---

### Task 4: DP commit in the war room

**Files:**
- Modify: `src/ui/WarRoomPanel.tsx` (new DP section), `src/data/dialogue-text.json5` + `src/data/dialogueText.ts` (strings)
- Test: `tests/smoke/cp-dp.spec.ts` (extend with real-input war-room clicks) or a new `war-room-dp.spec.ts`

**Interfaces:**
- Consumes: `deploymentDescribe()`, `computeDpCap()`, `commitShipToEngagement(key)` / `uncommitShipFromEngagement(key)`, `dpCostForShip` (via `warRoomDescribe` rows — extend `fleetWarRoom.warRoomDescribe()` to include each ship's `dpCost` so the panel needs no ECS reads).
- Produces: `data-war-room-dp-cap`, `data-war-room-dp-commit={shipKey}` toggles — the journey/system smokes click these.

- [x] **Step 1: Failing smoke**: boot the multi-ship fleet fixture (grant-fleet / cp-dp's), open the war room via the real interactable path (walk + E — reuse `ms-custody.spec.ts`'s walk pattern), assert the DP section shows cap + per-ship chips; click a commit toggle; assert `deploymentDescribe().committedShipKeys` gained the key; toggle past the cap → refusal toast `超出部署点上限`. Run → FAIL.
- [x] **Step 2: Implement.** New section under the aggression list: header `部署点 {committed}/{cap}` (`data-war-room-dp-cap`), one row per ACTIVE non-flagship ship: name · `DP {dpCost}` chip · commit toggle button (aria-pressed). Flagship row rendered as implicitly committed (disabled, badge 旗舰·自动部署). Over-budget refusal toasts. Empty commit set keeps the existing deploy-everything back-compat — say so in a hint line (`未指派时全体出击`).
- [x] **Step 3: Green + gates + commit**

```bash
git add -A && git commit -m "feat(ui): DP commit lands in the war room — deployment stops being debug-only"
```

---

### Task 5: Manual fire control (auto / hold / volley)

**Files:**
- Modify: `src/systems/combat.ts` (§3 player weapon block ~1494-1527; fire-mode state), `src/ui/TacticalView.tsx` (weapon rows clickable + mode badges)
- Test: `tests/smoke/fire-control.spec.ts` (new)

**Interfaces:**
- Consumes: `useCombatStore` (add `fireModeByMount: Record<number, 'auto'|'hold'|'volley'>`, reset in `reset()`), `WeaponMount` query, `store.aimMouse`.
- Produces: `data-tactical-weapon-mode={mountIdx}` cycle buttons; `cycleFireMode(mountIdx)`; volley click behavior. Repurposes or deletes the dead `selectedMountIdx` (`combat.ts:210,226,252` — if nothing uses it after this task, DELETE it; no dead state).

- [x] **Step 1: Failing unit-ish smoke** (`fire-control.spec.ts`, debug-drive): with mode `hold` on mount 0, stepFor combat seconds → assert mount 0 fired zero shots while mount 1 (auto) fired (read shot counts via a combat debug READ — add if needed); with `volley`, assert no auto-fire but a `volleyFire(mountIdx)` debug call (or real row click in the UI case) fires exactly one ready shot at the in-arc enemy nearest the aim cursor. Run → FAIL.
- [x] **Step 2: Implement combat side.** §3 gates: `mode==='hold'` → charge accumulates, never fires; `mode==='volley'` → charges, fires only when `volleyRequested` for that mount is consumed (set by UI click; single-shot semantics), target = in-arc enemy nearest `store.aimMouse` (fallback: nearest in-arc); `auto` = today's behavior. Keep enemies/§4 untouched.
- [x] **Step 3: UI.** Weapon rows: left area shows mode badge (自动/待命/齐射); clicking the badge cycles modes; clicking the row body while mode=volley and ready fires (calls the store's volley request). Update the hint line text to mention 点击武器行切换射击模式. Delete `selectedMountIdx` if now unused.
- [x] **Step 4: Green + gates + commit**

```bash
git add -A && git commit -m "feat(combat): per-mount fire modes — hold and volley give the player trigger agency"
```

---

### Task 6: Defeat / flee debrief beats

**Files:**
- Create: `src/ui/CombatDebriefPanel.tsx`
- Modify: `src/systems/combat.ts` (`endCombat` defeat/flee branches emit a debrief payload), `src/ui/App-level mount point` (wherever `CombatTallyPanel` mounts — grep its mount), `src/ui/uiStore.ts` (panel state)
- Test: extend `tests/smoke/combat-defeat.spec.ts` + `tests/smoke/combat-withdraw.spec.ts`

**Interfaces:**
- Consumes: `endCombat('defeat'|'flee')` internals — hull/armor/CR deltas, `DEFEAT_DROP` scene, MS destroyed with the ship (W1's `随舰损失的MS` path), survivor money (all values already computed in those branches; capture into the payload rather than recomputing).
- Produces: `data-combat-debrief` panel with `data-combat-debrief-continue` button.

- [x] **Step 1: Failing smokes**: after a forced defeat (existing combat-defeat pattern) assert the debrief panel renders outcome 战败, losses list (ship, MS count, money floor, drop location) and the continue button closes it into the city scene; after withdraw assert outcome 脱离 with the penalty lines. Run → FAIL.
- [x] **Step 2: Implement.** `endCombat` builds `{ outcome, lines: {labelZh, valueZh}[] }` for the two non-victory branches and opens the panel via uiStore; victory path unchanged (recoverables → tally). Panel styling mirrors `CombatTallyPanel`. One continue button; no choices (this is a beat, not a menu).
- [x] **Step 3: Green + gates + commit**

```bash
git add -A && git commit -m "feat(ui): defeat and flee get their debrief beat — non-victory stops dead-ending"
```

---

### Task 7: Combat log / status panel overlap fix

**Files:**
- Modify: the stylesheet defining `.combat-log` / `.tactical-hud-player` (grep `combat-log {`), possibly `TacticalView.tsx` container structure
- Test: extend `tests/smoke/fleet-orders.spec.ts` (or the withdraw smoke) with a DOM-geometry assertion

**Interfaces:** none new.

- [x] **Step 1: Failing assertion**: in an open engagement with ≥6 log lines pushed (push via `pushCombatLog` debug or by playing), read `boundingBox()` of `.combat-log` and `.tactical-hud-player` and assert no intersection (named invariant: combat log must not cover the hull readout). Run → confirm it FAILS at HEAD (the playtest observed overlap; if it doesn't fail, measure why — viewport size — and pin the failing viewport via `sim.page.setViewportSize`).
- [x] **Step 2: Fix layout** — constrain the log's max-height/width and offset it below the player HUD (or move the HUD), CSS-only if possible. Re-run → PASS at both the default and pinned viewport. Gates.
- [x] **Step 3: Commit**

```bash
git add -A && git commit -m "fix(ui): combat log no longer covers the player status readout"
```

---

### Task 8: Journey extension + spec status + full-suite gate

**Files:**
- Modify: `tests/smoke/journey-first-sortie.spec.ts` (order leg), `src/test/gameStateView.ts` (+`getCombat().getCommandPool()` read + unit test), `docs/superpowers/specs/2026-07-04-ship-ms-combat-ux-design.md` (W2 status)

**Interfaces:**
- Consumes: everything above. Journey stays read-only on `__uclife__` (rule 8) — all order actions via real input.

- [x] **Step 1: Extend the journey fight leg**: once combat opens — press Space (pause), read CP via the new `getCommandPool()` read, click 集火 then click the enemy (real input; `getEnemyScreenCoords`), assert CP debited by `orderCosts.focusFire` (named invariant: issuing an order must spend command points), unpause, win as before. Keep the added segment minimal — the deep order coverage lives in the system smokes.
- [x] **Step 2: Deterministic double-run**: `npm run ci:local -- --grep "journey" --workers=1` twice, then full `npm run ci:local` twice back-to-back (note #160 flakes if any, rerun serial).
- [x] **Step 3: Spec status + commit**: add the W2 shipped-status block (per W2.x item, incl. the volley scope note and the withdraw-is-CP-free decision).

```bash
git add -A && git commit -m "test(journey): command-layer leg — W2 acceptance spine green"
```

---

## Task order & dependencies

1 → 2 → 3 (orders backend → palette → withdraw share the palette surface). 4, 5, 6, 7 are independent of each other but depend on nothing later than 3 — execute sequentially anyway (single branch). 8 last. Perf: order effects add O(1) per escort inside the existing §1 loop (target N ≤ ~8 escorts; no new scans — focus lookup is one key comparison per escort per tick); state the numbers in the PR body.
