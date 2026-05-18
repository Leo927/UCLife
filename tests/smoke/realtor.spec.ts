// realtor smoke. Verifies:
//  1. seedPrivateOwners produced character-owned listings.
//  2. realtorBuy on a state-owned listing transfers Owner and drops listing.
//  3. State-locked civic types (e.g. hrOffice) never appear in listings.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.realtorListings',
  '__uclife__.realtorBuy',
  '__uclife__.ownershipSnapshot',
]

test('realtor listings + state-direct purchase', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  const initial = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.realtorListings(),
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byCategory = (cat: string) => initial.filter((l: any) => l.category === cat)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byOwner = (k: string) => initial.filter((l: any) => l.ownerKind === k)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byType = (t: string) => initial.filter((l: any) => l.typeId === t)

  expect(byCategory('residential').length, 'no residential listings').toBeGreaterThan(0)
  expect(byCategory('commercial').length, 'no commercial listings').toBeGreaterThan(0)

  const characterOwned = byOwner('character')
  expect(characterOwned.length, 'seedPrivateOwners produced 0 character-owned listings').toBeGreaterThan(0)
  const statesOwned = byOwner('state')
  expect(statesOwned.length, 'no state-owned listings').toBeGreaterThan(0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const missingSeller = characterOwned.filter((l: any) => !l.sellerName)
  expect(missingSeller.length, 'character-owned listings missing seller name').toBe(0)

  const stateCommercial = byOwner('state').filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l: any) => l.category === 'commercial' || l.category === 'factionMisc',
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const missingPrice = stateCommercial.filter((l: any) => l.askingPrice === null || l.askingPrice <= 0)
  expect(missingPrice.length, 'state-listings with invalid price').toBe(0)

  expect(byType('hrOffice').length, 'hrOffice listed by realtor — must be state-locked').toBe(0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const target = byOwner('state').find((l: any) => l.askingPrice !== null && l.askingPrice > 0)
  expect(target, 'no state-listed commercial building to test buy with').toBeTruthy()

  const result = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.realtorBuy(k),
    target.buildingKey,
  )
  expect(result.ok, `realtorBuy rejected: ${result.reason}`).toBe(true)

  const after = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.realtorListings(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stillListed = after.find((l: any) => l.buildingKey === target.buildingKey)
  expect(stillListed, 'listing still present after buy — player-owned should be hidden').toBeUndefined()

  const snapshot = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.ownershipSnapshot(),
  )
  expect(
    (snapshot.buildingsByOwnerKind?.character ?? 0),
    'no character-owned buildings after purchase',
  ).toBeGreaterThan(0)
})
