# Issue #64 — Ralph loop progress

## Status: IN PROGRESS

## Done
- (iter 1) Branch `claude/issue-64-ms-parts-broker-loot` off main; committed loop spec.

## Architecture decided (iter 1 research complete)
- **Pricing (data):** `src/data/partsPricing.ts` — pure `weaponPrice(def)` / `frameModPrice(def)`
  derived from config constants in `fleet.json5 partsPricing`. Unit-tested.
- **Catalog (config):** `fleet.json5` — `partsSalesDeskTileVB`, `partsSalesCatalog`
  (`ae_parts_dealer_vb` → {weapons[], frameMods[]}), `partsPricing` constants.
- **Transaction (systems):** `src/systems/partsSales.ts` `buyPart(specId, kind, partId)` —
  validates catalog membership, debits Money, credits PlayerPartsInventory. Called by
  both the React branch and the `buyPartCheat` debug handle (ui→systems is downward-OK).
- **Salvage (systems/combat.ts):** module accumulator reset in `startCombat`, rolled in
  `onEnemyDestroyed` via `getSimRng()` from `getEnemyShip(cs.shipClassId).salvage`, drained
  in `endCombat('victory')` → routes to PlayerPartsInventory + `salvagedParts` payload.
  New exported `breakDownEnemiesForVictory()` (canonical onEnemyDestroyed→destroy→endCombat)
  + `breakDownEnemiesCheat` handle so the smoke kills deterministically (one chance:1.0 entry
  on the engaged class makes it deterministic-by-construction).
- **Tally UI:** `CombatTallyPayload.salvagedParts` + new section in `CombatTallyPanel.tsx`.
- **Dialogue:** `isAEPartsDealerOnDuty` role (types.ts + NPCDialog.tsx + fleet.ts default),
  `aePartsSales.tsx` branch, builder wire, `dialogue-text.json5` strings.
- **NPC + spawn:** `ae_parts_dealer_vb` in special-npcs.json5 (tile = partsSalesDeskTileVB),
  desk spawn in spawn.ts spawnAirport.
- **Debug handles:** `getMsFrameModCounts`, `buyPartCheat`, `partsDealerRepEntity`,
  `breakDownEnemiesCheat`.
- **Smoke:** ONE fixture `ms-parts.json5` (player aboard flagship at vonBraun + cash +
  piloting + starter MS) — buyPartCheat works from anywhere; combat via startCombatCheat +
  breakDownEnemiesCheat. Mirrors captains-office (tally read) + pegasus-buy (handle-driven).

## Gate state (last checked: not yet)
- test:unit: ?
- ci:local --grep ms-parts-acquisition: ?
- lint:arch: ?
- build: ?
- docs: ?
