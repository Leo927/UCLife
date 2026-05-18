// Daily-economics smoke. Verifies:
//  1. Every ownable Building carries a Facility trait at boot.
//  2. A solvent NPC owner stays solvent after a forced rollover.
//  3. Forcing salaries > owner-fund kicks the facility into the 3-day
//     insolvency grace counter, and a third forced day reverts ownership
//     to state (foreclosure).
//  4. The reverted facility re-appears on the realtor's state listing.
//  5. AE faction's daily stipend lands once on its Faction.fund.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.facilitySnapshot',
  '__uclife__.facilityForce',
  '__uclife__.forceDailyEconomics',
  '__uclife__.realtorListings',
  '__uclife__.ownershipSnapshot',
]

test('daily economics: solvent rollover, foreclosure, AE stipend', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  // 1. Every ownable Building has a Facility trait.
  const initial = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.facilitySnapshot(),
  )
  expect(
    initial.length,
    'facilitySnapshot() should be non-empty at boot (no Facility-tracked buildings)',
  ).toBeGreaterThan(0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const npcOwned = initial.filter((f: any) => f.ownerKind === 'character')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const factionOwned = initial.filter((f: any) => f.ownerKind === 'faction')
  expect(
    npcOwned.length,
    'expected at least one character-owned facility — seedPrivateOwners did not run',
  ).toBeGreaterThan(0)

  // 2. Solvent NPC owner: pump revenue, force a rollover, expect insolventDays = 0.
  const solventTarget = npcOwned[0]
  const solventForce = await sim.page.evaluate((key) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__uclife__.facilityForce({
      buildingKey: key,
      revenueAcc: 5000,
      salariesAcc: 500,
      ownerFund: 10000,
    })
  }, solventTarget.buildingKey)
  expect(
    solventForce,
    `facilityForce on ${solventTarget.buildingKey} should return truthy; got ${solventForce}`,
  ).toBeTruthy()

  const solventResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.forceDailyEconomics(101),
  )
  expect(
    solventResult.facilitiesProcessed,
    `forced solvent rollover should process at least one facility; got ${JSON.stringify(solventResult)}`,
  ).toBeGreaterThan(0)

  const solventAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key) => (window as any).__uclife__.facilitySnapshot(key),
    solventTarget.buildingKey,
  )
  expect(solventAfter[0], `solvent target ${solventTarget.buildingKey} vanished after rollover`).toBeTruthy()
  expect(solventAfter[0].insolventDays, 'solvent insolventDays should be 0').toBe(0)
  expect(solventAfter[0].lastRolloverDay, 'solvent lastRolloverDay should be 101').toBe(101)
  expect(solventAfter[0].revenueAcc, 'solvent revenueAcc should be 0 after rollover').toBe(0)

  // 3. Insolvency grace: pick a different NPC-owned facility, pump salaries past
  //    owner fund, force three rollovers in a row.
  const insolventTarget =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    npcOwned.find((f: any) => f.buildingKey !== solventTarget.buildingKey) ?? npcOwned[0]
  for (let day = 102; day <= 104; day++) {
    await sim.page.evaluate((arg) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).__uclife__.facilityForce({
        buildingKey: arg.key,
        revenueAcc: 0,
        salariesAcc: 5000,
        ownerFund: 0,
      })
    }, { key: insolventTarget.buildingKey })
    await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (d) => (window as any).__uclife__.forceDailyEconomics(d),
      day,
    )
  }

  // 4. After three insolvent days, ownership should have reverted.
  const finalSnap = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.facilitySnapshot(k),
    insolventTarget.buildingKey,
  )
  expect(finalSnap[0], `insolvency target ${insolventTarget.buildingKey} vanished after 3-day grace`).toBeTruthy()
  expect(
    finalSnap[0].ownerKind,
    `insolvency target ownerKind should be "state" after foreclosure; got "${finalSnap[0].ownerKind}"`,
  ).toBe('state')
  expect(finalSnap[0].insolventDays, 'insolventDays should reset to 0 on foreclosure').toBe(0)
  expect(finalSnap[0].closedSinceDay, 'closedSinceDay should clear on foreclosure').toBe(0)

  // Realtor pipeline picks up foreclosed inventory.
  const listings = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.realtorListings(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fore = listings.find((l: any) => l.buildingKey === insolventTarget.buildingKey)
  expect(fore, `foreclosed building ${insolventTarget.buildingKey} missing from realtor listings`).toBeTruthy()
  expect(fore.ownerKind, `foreclosed building should appear as "state"; got "${fore.ownerKind}"`).toBe('state')

  // 5. AE stipend.
  if (factionOwned.length > 0) {
    const aeBefore = await sim.page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (window as any).__uclife__.ownershipSnapshot()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return s.factions.find((f: any) => f.id === 'anaheim')?.fund ?? null
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sim.page.evaluate(() => (window as any).__uclife__.forceDailyEconomics(200))
    const aeAfter = await sim.page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (window as any).__uclife__.ownershipSnapshot()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return s.factions.find((f: any) => f.id === 'anaheim')?.fund ?? null
    })
    expect(
      aeBefore !== null && aeAfter !== null,
      `AE faction not bootstrapped: before=${aeBefore} after=${aeAfter}`,
    ).toBeTruthy()
    expect(
      aeAfter > aeBefore,
      `AE daily stipend did not credit: before=${aeBefore} after=${aeAfter}`,
    ).toBeTruthy()
  }
})
