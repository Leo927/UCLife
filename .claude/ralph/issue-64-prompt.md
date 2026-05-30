# Ralph Loop — Issue #64: AE MS-parts broker + MS-parts combat loot

You are implementing GitHub issue **Leo927/UCLife#64** on branch
`claude/issue-64-ms-parts-broker-loot` in `D:\Repos\uclife-web`.

This is a **Ralph loop**: this same prompt is fed to you every iteration. Your
previous work persists in the files and git history. Each iteration you:

1. **Re-orient.** Read `.claude/ralph/issue-64-progress.md` (your own running
   log — create it on iteration 1). Run `git log --oneline origin/main..HEAD`
   to see what's already committed.
2. **Check the gates** (see "Definition of done"). Run only what's cheap/needed
   to learn the current state — you don't have to run everything every time.
3. **Do the next smallest unit of work** toward green gates, following TDD.
4. **Commit** it (see "Commit discipline"). Never leave the tree dirty.
5. **Update** `.claude/ralph/issue-64-progress.md` with what you did + what's next.
6. If — and only if — **every gate is green**, emit the completion promise
   (see "Completion").

Work in **small, verifiable increments**. Do not try to write everything in one
iteration. A half-finished feature with a failing gate is the expected mid-loop
state; converge toward green.

---

## Goal (the acceptance scenario)

> The player buys a weapon and a frame mod at the AE parts dealer, sorties,
> breaks down a hostile MS/ship, and the post-combat tally drops a salvaged part
> straight into the same `PlayerPartsInventory` the retrofit panel pulls from.

Two halves, both feeding `PlayerPartsInventory`:

### A. AE MS-parts broker
- **`ae_parts_dealer_vb` special NPC** seated at a programmatically-spawned desk
  in the VB AE complex (the Von Braun airport, same scene as `ae_ship_sales_vb` /
  `ae_vehicle_sales_vb`).
- **`aePartsSales` dialogue branch** — two-section catalog: **weapons** (from
  `ms-weapons.json5`) and **frame mods** (from `ms-frame-mods.json5`). Each row
  shows stats + price. Buy debits `Money` and credits `PlayerPartsInventory`
  (`weapons[id]++` / `frameMods[id]++`). **Immediate** — no delivery queue
  (these are crates, not housed vehicles).
- **Public-catalog gating** — only fighter/MW-era (tier-1) parts are public in
  0077. All current parts are tier-1, so all qualify.

### B. MS-parts combat loot
- **Per-enemy-class salvage table** authored on **`enemyShips.json5`** rows (the
  per-class file — decided), shape `salvage: [{ partId, kind: 'weapon' | 'frameMod', chance, qty }]`.
- **Post-combat tally routing** — when a hostile MS/ship is broken down, roll its
  salvage table with the **seeded combat RNG** (`getSimRng()`) and route drops to
  `PlayerPartsInventory`. The tally payload + dialogue grow a **salvaged-parts
  section**.

---

## Locked design decisions (do NOT revisit)

1. **Salvage table location:** `src/data/enemyShips.json5`, per enemy ship class.
   (The issue text said `space-entities.json5`, but per-class data lives in
   `enemyShips.json5`; `space-entities.json5` only holds campaign instances that
   reference a `shipClassId`.)
2. **Salvage `kind`:** `'weapon' | 'frameMod'` (matches `PlayerPartsInventory`
   shape, NOT `'part'`).
3. **Catalog scope:** sell **all current tier-1 parts** publicly — weapons
   `ms-beamRifle`, `ms-ballisticGun`, `ms-missileRack`; frame mods
   `extPropellantTank`, `autoloader`, `lifeSupportPod`, `armorPlating`,
   `subThruster`.
4. **Pricing:** **derived** prices, authored in config (`fleet.json5`). Scale off
   the existing fleet economy (e.g. weapon price from `damage`, frame-mod price
   from `slotCount` + effect magnitude). Put the derivation constants in config —
   **NO magic numbers in `.ts`** (see CLAUDE.md "No magic number"). If a literal
   price-per-part is cleaner than a formula, author the literal map in
   `fleet.json5` `partsSalesCatalog`.

---

## Patterns to mirror (verified paths + line anchors)

### Broker (half A)
- **NPC declaration:** `src/character/special-npcs.json5` — copy the
  `ae_vehicle_sales_vb` rep entry (fields: `name`, `color`, `title`, `tileX`,
  `tileY`, `fatigue`, `money`, `skills`, `factionRole`, `workstation`). The
  `tileX/tileY` MUST equal the new desk tile in `fleet.json5` or seat-linkage
  fails silently. `workstation` = `'ae_parts_dealer_vb'`.
- **Desk tile + catalog config:** `src/config/fleet.json5` — add a
  `partsSalesDeskTileVB` near `vehicleSalesDeskTileVB: { x: 128, y: 27 }` (pick a
  free adjacent tile inside the airport rect 108,10..138,60 that doesn't collide,
  e.g. `{ x: 132, y: 27 }`), and a `partsSalesCatalog` mapping
  `ae_parts_dealer_vb` → `{ weapons: [...ids], frameMods: [...ids] }` plus pricing
  data.
- **Desk spawn:** `src/ecs/spawn.ts` `spawnAirport` (~lines 667-689) — copy the
  ship/vehicle desk `world.spawn(Position(...), Workstation({ specId:
  'ae_parts_dealer_vb', occupant: null, managerStation: null }), EntityKey({ key:
  'ws-ae_parts_dealer_vb' }))` block.
- **Role flag:** add `isAEPartsDealerOnDuty` to `src/ui/dialogue/types.ts`
  (`DialogueRoles`, ~line 53), set it in `src/ui/NPCDialog.tsx` (~line 87-91:
  `specId in fleetConfig.partsSalesCatalog && onShift`), and default it `false` in
  `src/boot/debugHandles/fleet.ts` (~line 256).
- **Dialogue branch:** new file `src/ui/dialogue/branches/aePartsSales.tsx`. Model
  the catalog rendering on `aeVehicleSales.tsx`, but model the **transaction**
  (debit `Money`, credit inventory immediately, no delivery queue) on
  `aeSupplyDealer.tsx` (read it — it's the closest "buy → resource now" template).
  Read `PlayerPartsInventory` via `useQueryFirst(PlayerPartsInventory)` and mutate
  with `partsEnt.set(PlayerPartsInventory, { ...cur, weapons: {...cur.weapons,
  [id]: (cur.weapons[id] ?? 0) + 1 } })`.
- **Wire branch:** `src/ui/dialogue/builder.ts` — import + add `aePartsSalesBranch`
  to `ROLE_BRANCHES`.
- **zh-CN strings:** `src/data/dialogue-text.json5` — add `buttons.aePartsSales`
  + `branches.aePartsSales.*` (mirror the `aeVehicleSales` block). Player-facing
  text is zh-CN; everything else English.

### Combat loot (half B)
- **Tally payload:** `src/ui/uiStore.ts` `CombatTallyPayload` (lines 18-30) — add
  `salvagedParts: Array<{ partId: string; kind: 'weapon' | 'frameMod'; nameZh: string; qty: number }>`.
- **Salvage roll + routing:** `src/systems/combat.ts`. `onEnemyDestroyed(ent)`
  (lines 612-641) fires when an enemy hull crosses zero — roll the destroyed
  ship's class `salvage[]` here with `getSimRng()` (`getSimRng().next() < chance`,
  qty via `getSimRng().int(...)` if you make qty a range, else the fixed `qty`),
  accumulating into a module-scope tally list (reset at `startCombat`). In
  `endCombat` victory path (lines 733-776) route the accumulated drops into
  `PlayerPartsInventory` and include `salvagedParts` in the
  `emitSim('ui:open-combat-tally', {...})` payload. Resolve the enemy's ship-class
  id from `CombatShipState` (inspect what field it carries; if it lacks a class
  id, thread it in at spawn — check how enemies get their `CombatShipState`).
- **Tally UI:** `src/ui/CombatTallyPanel.tsx` — insert a new salvaged-parts
  `<section>` (after fuel, before POWs). Use `dialogue-text.json5` for the heading.
- **Enemy data:** `src/data/enemyShips.json5` — add `salvage: [...]` to the
  class(es) the smoke fixture engages. Keep the smoke's class deterministic.
- **Determinism:** all loot rolls go through `getSimRng()` (already seeded in
  test mode). Same seed + fixture → same drops. NO `Math.random`.

### Debug handle for the smoke
- `src/boot/debugHandles/ms.ts` already exposes `getMsWeaponCounts()` (lines
  113-119). Add a sibling `getMsFrameModCounts()` (same shape, returns
  `{...inv.frameMods}`) so the smoke can assert frame-mod drops/buys. Register it
  on `__uclife__` the same way.

---

## Smoke test (the primary gate) — TDD: write it (failing) FIRST

Create **`tests/smoke/ms-parts-acquisition.spec.ts`** and
**`tests/fixtures/ms-parts.json5`**. Read the `deterministic-tests` skill
(`.claude/skills/deterministic-tests/SKILL.md`) before authoring. Use
`import { test, expect } from './_fixtures'`, `sim.boot({ fixture: 'ms-parts' })`,
`sim.stepFor/stepUntil`, and `getGameState()` / `__uclife__` handles. Drive
through `__uclife__`, not the DOM. No `waitForTimeout`. Retries stay 0.

Model the fixture on `tests/fixtures/ms-sortie.json5` + `player-with-cash-at-vb.json5`,
and the combat-driving + tally-reading pattern on
`tests/smoke/captains-office.spec.ts` (lines ~110-135: drive victory, read
`uclifeUI.getState().combatTally`) and `tests/smoke/space-combat.spec.ts`.

The spec asserts:
1. Boot a fixture at the VB AE complex with known funds.
2. Talk to `ae_parts_dealer_vb`; buy one catalog weapon + one frame mod; assert
   `Money` debited by the catalog prices and `getMsWeaponCounts()` /
   `getMsFrameModCounts()` incremented.
3. Boot/seed a combat fixture with one hostile carrying a fixed salvage table;
   resolve the engagement (victory).
4. Assert the tally payload lists the salvaged part(s) and `PlayerPartsInventory`
   reflects the drop (deterministic under the seed).
5. Open the MS retrofit panel (`openMsRetrofit(msKey)`); assert the newly-acquired
   weapon is installable — closes the acquire → install loop.

If any step can't be made deterministic, simplify the scenario rather than adding
sleeps/retries. Prefer driving combat via the same cheat handles the existing
combat smokes use (`startCombatCheat` / `fastWinCombat` / `endCombatCheat`) but
with the fixture's seeded salvage so drops are repeatable.

---

## Definition of done (ALL must be green)

Run from `D:\Repos\uclife-web`:

1. `npm run test:unit` — green (add unit tests for any pure logic you extract,
   e.g. a price-derivation helper or salvage-roll helper).
2. `npm run ci:local -- --grep ms-parts-acquisition` — the new smoke passes.
   Then a broader `npm run ci:local` run to confirm you broke no sibling smoke
   (do the broad run at least once before promising).
3. `npm run lint:arch` — no NEW dependency-cruiser violations (respect the engine
   boundary + layer direction; do not refresh the baseline to hide a new
   violation).
4. `npm run build` — `tsc -b && vite build` clean (no type errors).
5. Design docs in sync: update `Design/fleet.md` (the "Deferred from 6.2.5.B"
   section — mark these two follow-ups shipped) and `Design/post-combat.md` if the
   tally section changed materially.

---

## Engineering rules (from CLAUDE.md — non-negotiable)

- **TDD:** failing test first, then code.
- **No magic numbers in `.ts`** — every literal lives in a `.json5` config.
- **zh-CN** for player-facing strings; **English** for code/comments/labels.
- **Layer direction** strict downward: `config → data → procgen → ecs → sim/ai →
  systems → save/render → ui → boot`. No upward imports. `src/engine/` boundary
  intact.
- **Comments** only for non-obvious intent; default to none.
- **Refactor discipline:** delete obsoleted code fully; no shims; no half-merged
  state in the tree.
- **Smoke determinism rules 1-7** (drive through `__uclife__`, no sleeps, sim time
  only, seeded, no retries, fail loud).
- **Save round-trip:** if you add persisted state, it already flows through
  `src/boot/saveHandlers/ms.ts` (PlayerPartsInventory is already persisted) — keep
  it that way.

---

## Commit discipline

After each green-able increment, commit on this branch with a message shaped like
the repo's history, e.g.:

```
feat(fleet): Issue #64 — <what this commit did>

<one or two lines of why/what>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

Do NOT push or open a PR from inside the loop. Do NOT merge to main. The human
will review the branch after the loop completes.

---

## Completion

When — and only when — `test:unit`, the new smoke + a broad `ci:local`,
`lint:arch`, and `build` are ALL green and the design docs are updated, AND the
working tree is clean (all work committed), output the literal tag on its own
line:

```
<promise>ISSUE_64_COMPLETE</promise>
```

Before emitting it, paste the tail of each gate's output proving green. If you are
not certain every gate is green, do NOT emit the promise — do another iteration.
