// Phase 5.5.6 facility-tier smoke (issue #141). Drives the investment loop
// through the deterministic substrate: own a factory → tier-2 row
// visible-but-locked → research unlock flips it available → upgrade
// deducts credits and starts downtime → tier state survives save/load
// mid-downtime → forced countdown ticks complete the install and spawn
// the new seats. Day-scale time is driven via forceFacilityTierTick
// (the forceDailyEconomics / forceResearchTick pattern) — no whole-day
// sim stepping. The "downtime seats produce no output / pay no salary"
// rule is unit-tested through workSystem + researchSystem in
// src/systems/facilityTiers.test.ts.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.cheatMoney',
  '__uclife__.getPlayerMoney',
  '__uclife__.cheatOwnBuilding',
  '__uclife__.facilitySnapshot',
  '__uclife__.facilityTierPanel',
  '__uclife__.facilityTierStart',
  '__uclife__.facilityTierState',
  '__uclife__.forceFacilityTierTick',
  '__uclife__.grantFactionUnlock',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]

const FACTORY_T2_UNLOCK = 'upgrade:factory-tier-2'
const SAVE_SLOT = 7

test('facility tiers: locked → available → credit + downtime → seats live', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  // ── Take ownership of a factory ────────────────────────────────────
  // Ownership is granted directly — the realtor/foreclosure acquisition
  // loops are covered by daily-economics.spec.
  const facilities = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.facilitySnapshot(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const factorySnap = facilities.find((f: any) => f.typeId === 'factory')
  expect(factorySnap, 'world must contain a factory').toBeTruthy()
  const key = factorySnap.buildingKey as string
  const owned = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.cheatOwnBuilding(k), key,
  )
  expect(owned, 'cheatOwnBuilding must hand the factory to the player').toBe(true)

  // ── Visible-but-locked before the unlock ───────────────────────────
  const lockedPanel = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.facilityTierPanel(k), key,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lockedRow = lockedPanel.find((r: any) => r.knob === 'jobSiteCount' && r.tier === 2)
  expect(lockedRow, 'tier-2 row must stay visible while locked').toBeTruthy()
  expect(lockedRow.state).toBe('locked')
  expect(lockedRow.gateTextZh, 'locked row must name the gating research').toContain('工厂扩容')

  const refused = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.facilityTierStart(k, 'jobSiteCount', 2), key,
  )
  expect(refused.ok).toBe(false)
  expect(refused.reason).toBe('locked')

  // ── Unlock flips the row to available ──────────────────────────────
  const granted = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (id) => (window as any).__uclife__.grantFactionUnlock(id), FACTORY_T2_UNLOCK,
  )
  expect(granted, 'grantFactionUnlock must find the civilian faction').toBe(true)
  const availPanel = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.facilityTierPanel(k), key,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const availRow = availPanel.find((r: any) => r.knob === 'jobSiteCount' && r.tier === 2)
  expect(availRow.state).toBe('available')
  expect(availRow.creditCost).toBeGreaterThan(0)
  expect(availRow.downtimeDays).toBeGreaterThan(0)
  expect(availRow.addStationsCount).toBeGreaterThan(0)

  // Fund the wallet with exactly the authored credit cost — the upgrade
  // charges the character owner, so no literal budget is needed.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n) => (window as any).__uclife__.cheatMoney(n), availRow.creditCost,
  )

  // ── Start the upgrade: credits out, downtime on ────────────────────
  const stateBefore = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.facilityTierState(k), key,
  )
  const moneyBefore = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getPlayerMoney(),
  )
  const started = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.facilityTierStart(k, 'jobSiteCount', 2), key,
  )
  expect(started.ok, `facilityTierStart failed: ${started.reason}`).toBe(true)
  const moneyAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getPlayerMoney(),
  )
  expect(moneyAfter, 'upgrade must deduct the credit cost at install')
    .toBe(moneyBefore - availRow.creditCost)

  const inDowntime = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.facilityTierState(k), key,
  )
  expect(inDowntime.inDowntime).toBe(true)
  expect(inDowntime.upgrade.daysRemaining).toBe(availRow.downtimeDays)

  // The panel surfaces the in-progress state with days remaining.
  const progressPanel = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.facilityTierPanel(k), key,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const progressRow = progressPanel.find((r: any) => r.knob === 'jobSiteCount' && r.tier === 2)
  expect(progressRow.state).toBe('inProgress')
  expect(progressRow.daysRemaining).toBe(availRow.downtimeDays)

  // ── One countdown day, then save/load mid-downtime ─────────────────
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.forceFacilityTierTick(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async (slot) => { await (window as any).__uclife__.saveGame(slot) }, SAVE_SLOT)
  const loadResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (slot) => (window as any).__uclife__.loadGame(slot), SAVE_SLOT,
  )
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)
  const restored = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.facilityTierState(k), key,
  )
  expect(restored, 'tier state must survive save/load').not.toBeNull()
  expect(restored.inDowntime, 'mid-downtime upgrade must survive load').toBe(true)
  expect(restored.upgrade.daysRemaining).toBe(availRow.downtimeDays - 1)

  // ── Remaining countdown days complete the install ──────────────────
  for (let d = 1; d < availRow.downtimeDays; d++) {
    await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__uclife__.forceFacilityTierTick(),
    )
  }
  const completed = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.facilityTierState(k), key,
  )
  expect(completed.upgrade).toBeNull()
  expect(completed.inDowntime).toBe(false)
  expect(completed.tiers.jobSiteCount).toBe(2)
  expect(completed.stationsInside, 'tier-2 must add its authored seats')
    .toBe(stateBefore.stationsInside + availRow.addStationsCount)

  // Panel shows the row done.
  const donePanel = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.facilityTierPanel(k), key,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doneRow = donePanel.find((r: any) => r.knob === 'jobSiteCount' && r.tier === 2)
  expect(doneRow.state).toBe('done')
})
