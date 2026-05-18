// research-lab + planner smoke.
//  1. A researchLab spawns and lists on the realtor as state-owned.
//  2. realtorBuy transfers ownership.
//  3. factionInstallResearcher seats a civilian.
//  4. researchEnqueue('factory-tier-2') adds the row to the planner's queue.
//  5. forceResearchTick credits per-shift progress against the queue head.
//  6. After enough ticks, factory-tier-2 completes; unlock present.

import { test, expect } from './_fixtures'

const TICK_DAY_BASE = 200
const TICK_COUNT = 22
const FIRST_TICK_DAY = 101

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.realtorListings',
  '__uclife__.realtorBuy',
  '__uclife__.factionInstallResearcher',
  '__uclife__.researchEnqueue',
  '__uclife__.researchPlannerView',
  '__uclife__.forceResearchTick',
  '__uclife__.factionHasUnlock',
]

test('research lab: buy, install researcher, enqueue, complete, unlock', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  const listings = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.realtorListings(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const labListing = listings.find((l: any) => l.typeId === 'researchLab')
  expect(labListing, 'researchLab missing from realtor listings').toBeTruthy()
  expect(labListing.ownerKind).toBe('state')
  expect(labListing.category).toBe('factionMisc')

  const buy = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.realtorBuy(k),
    labListing.buildingKey,
  )
  expect(buy.ok, `realtorBuy failed: ${buy.reason}`).toBe(true)

  const install = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.factionInstallResearcher(),
  )
  expect(install.ok, `factionInstallResearcher failed: ${install.reason}`).toBe(true)

  const enqueue = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.researchEnqueue('factory-tier-2'),
  )
  expect(enqueue.ok, `researchEnqueue failed: ${enqueue.reason}`).toBe(true)

  const view1 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.researchPlannerView(),
  )
  expect(view1.queue.length).toBe(1)
  expect(view1.queue[0].id).toBe('factory-tier-2')

  const tick1 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (day) => (window as any).__uclife__.forceResearchTick(day),
    FIRST_TICK_DAY,
  )
  expect(tick1.researchersWorked).toBe(1)

  const view2 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.researchPlannerView(),
  )
  expect(view2.queue[0].accumulated).toBeGreaterThan(0)

  let totalLost = 0
  for (let i = 0; i < TICK_COUNT; i++) {
    const r = await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (d) => (window as any).__uclife__.forceResearchTick(d),
      TICK_DAY_BASE + i,
    )
    totalLost += r.lostOverflow
  }

  const view3 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.researchPlannerView(),
  )
  const hasUnlock = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.factionHasUnlock('upgrade:factory-tier-2'),
  )

  expect(view3.queue.length).toBe(0)
  expect(view3.done.length).toBe(1)
  expect(view3.done[0].id).toBe('factory-tier-2')
  expect(hasUnlock, 'FactionUnlocks missing upgrade:factory-tier-2').toBeTruthy()
  expect(totalLost, `totalLost across ${TICK_COUNT} ticks`).toBeGreaterThan(0)
})
