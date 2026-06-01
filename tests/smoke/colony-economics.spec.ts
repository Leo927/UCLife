/**
 * Phase 6.3.B — Colony economics smoke test.
 *
 * Verifies the end-to-end colony-economics slice:
 *   1. Boot with a pre-colony fixture; create player faction + claim colony.
 *   2. Record initial colony economics state.
 *   3. Run N day-rollover ticks; assert accumulatedIncome grew by the
 *      authored formula and stability tracked QoL facility contributions.
 *   4. Colony depot resupply costs 0 credits (no markup vs AE dealer price).
 *   5. Colony hire preview: signing-fee discount + loyalty bonus apply.
 *   6. Warehouse store + save/load round-trip preserves income + stability
 *      + warehouse contents.
 *
 * All assertions drive through __uclife__ debug handles — no DOM clicks,
 * no fixed sleeps (deterministic-tests rules 1–4).
 */
import { test, expect } from './_fixtures'

const FIXTURE = 'player-owned-colony'
const POI_ID = 'marikoRefinery'
const SAVE_SLOT = 4

// Income per day from the colonyRefineryShell facility (matches colony.json5).
// Both the test and the system read from the same config; this constant
// documents the expected formula so assertion failures are self-describing.
const REFINERY_INCOME_PER_DAY = 500

// QoL types defined in colony.json5: bar, clinic.
// marikoRefinery scene has a bar (procgen district), no clinic.
// stability per day = baseScore(0) + bar(+10) - missingClinic(-15) = -5
const EXPECTED_STABILITY_DELTA_PER_DAY = -5

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.claimColony',
  '__uclife__.createPlayerFaction',
  '__uclife__.colonyEconomicsSnapshot',
  '__uclife__.forceColonyEconomics',
  '__uclife__.colonyResetRolloverDay',
  '__uclife__.colonyResupply',
  '__uclife__.colonyStoreItem',
  '__uclife__.colonyHirePreview',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]

test('colony economics: income, stability, resupply, hire discount, warehouse persist', async ({ sim }) => {
  await sim.boot({ fixture: FIXTURE, requireHandles: REQUIRED_HANDLES })

  // 1. Create player faction and claim the colony.
  const factionResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.createPlayerFaction(),
  )
  expect(factionResult.ok, `createPlayerFaction failed: ${JSON.stringify(factionResult)}`).toBe(true)

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.claimColony(poi, null),
    POI_ID,
  )

  const ownership = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.getGameState().getColonyOwnership(poi),
    POI_ID,
  )
  expect(ownership.isPlayerOwned, 'colony must be owned after claim').toBe(true)

  // 2. Record initial state.
  const initialEcon = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyEconomicsSnapshot(poi),
    POI_ID,
  )
  expect(initialEcon, 'colonyEconomicsSnapshot should be non-null after claim').toBeTruthy()
  const initialStability = initialEcon.stabilityScore as number
  const initialAccumulatedIncome = initialEcon.accumulatedIncome as number

  // 3. Run two day rollovers; assert accumulated income + stability.
  const ROLLOVER_DAYS = 2
  for (let d = 1; d <= ROLLOVER_DAYS; d++) {
    // Reset the guard so the forced rollover fires even within the same clock-day.
    await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (poi: string) => (window as any).__uclife__.colonyResetRolloverDay(poi),
      POI_ID,
    )
    const rolloverResult = await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (day: number) => (window as any).__uclife__.forceColonyEconomics(day),
      100 + d,
    )
    expect(
      rolloverResult.coloniesProcessed,
      `day ${d} rollover should process at least 1 colony`,
    ).toBeGreaterThan(0)
    expect(
      rolloverResult.totalIncomeCredit,
      `day ${d} rollover should credit income to faction fund`,
    ).toBeGreaterThan(0)
  }

  const econAfterRollovers = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyEconomicsSnapshot(poi),
    POI_ID,
  )
  const expectedIncomeDelta = REFINERY_INCOME_PER_DAY * ROLLOVER_DAYS
  expect(
    econAfterRollovers.accumulatedIncome - initialAccumulatedIncome,
    `accumulatedIncome should have grown by ${expectedIncomeDelta} after ${ROLLOVER_DAYS} rollovers`,
  ).toBe(expectedIncomeDelta)

  const expectedStabilityDelta = EXPECTED_STABILITY_DELTA_PER_DAY * ROLLOVER_DAYS
  expect(
    econAfterRollovers.stabilityScore - initialStability,
    `stability should have drifted by ${expectedStabilityDelta} after ${ROLLOVER_DAYS} rollovers`,
  ).toBe(expectedStabilityDelta)

  // 4. Colony resupply at no markup.
  // Force a rollover to stock the colony depot before testing resupply.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyResetRolloverDay(poi),
    POI_ID,
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d: number) => (window as any).__uclife__.forceColonyEconomics(d),
    200,
  )

  const resupplyResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyResupply(poi, 'supply', 10),
    POI_ID,
  )
  expect(resupplyResult.ok, `colonyResupply should succeed; got ${JSON.stringify(resupplyResult)}`).toBe(true)
  expect(
    resupplyResult.creditCharged,
    `colony resupply should charge 0 credits (no markup); charged ${resupplyResult.creditCharged}`,
  ).toBe(0)
  expect(
    resupplyResult.aeEquivalentCost,
    'AE equivalent cost should be > 0 so the no-markup comparison is meaningful',
  ).toBeGreaterThan(0)

  // 5. Hire discount: colony NPCs get a signing-fee discount + loyalty bonus.
  const hirePreview = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyHirePreview(poi),
    POI_ID,
  )
  expect(hirePreview.inColony, 'colonyHirePreview should report inColony = true').toBe(true)
  expect(
    hirePreview.effectiveSigningBonus,
    `effective signing bonus should be discounted vs standard (${hirePreview.standardSigningBonus})`,
  ).toBeLessThan(hirePreview.standardSigningBonus)
  expect(
    hirePreview.colonyOpinionBonusOnAccept,
    `colony opinion bonus (${hirePreview.colonyOpinionBonusOnAccept}) should exceed base (${hirePreview.baseOpinionBonusOnAccept})`,
  ).toBeGreaterThan(hirePreview.baseOpinionBonusOnAccept)

  // 6. Store an item in the colony warehouse.
  const storeResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyStoreItem(poi, { kind: 'parts', id: 'beam-rifle', qty: 3 }),
    POI_ID,
  )
  expect(storeResult.ok, `colonyStoreItem should succeed; got ${JSON.stringify(storeResult)}`).toBe(true)

  // 6. Save → load round-trip: income, stability, and warehouse must persist.
  const econBeforeSave = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyEconomicsSnapshot(poi),
    POI_ID,
  )

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (slot: number) => { await (window as any).__uclife__.saveGame(slot) },
    SAVE_SLOT,
  )
  const loadResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (slot: number) => (window as any).__uclife__.loadGame(slot),
    SAVE_SLOT,
  )
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)

  const econAfterLoad = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyEconomicsSnapshot(poi),
    POI_ID,
  )
  expect(econAfterLoad, 'colonyEconomicsSnapshot should be non-null after load').toBeTruthy()
  expect(
    econAfterLoad.accumulatedIncome,
    `accumulatedIncome should persist: expected ${econBeforeSave.accumulatedIncome}`,
  ).toBe(econBeforeSave.accumulatedIncome)
  expect(
    econAfterLoad.stabilityScore,
    `stabilityScore should persist: expected ${econBeforeSave.stabilityScore}`,
  ).toBe(econBeforeSave.stabilityScore)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const warehouseParts = (econAfterLoad.warehouseContents as any[]).find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (w: any) => w.kind === 'parts' && w.id === 'beam-rifle',
  )
  expect(
    warehouseParts,
    'warehouse contents should survive save/load round-trip',
  ).toBeTruthy()
  expect(
    warehouseParts.qty,
    'warehouse item quantity should be preserved',
  ).toBe(3)
})
