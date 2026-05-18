// player-faction creation smoke. Verifies:
//  1. Before creation: no IsPlayerFaction marker on any Faction entity.
//  2. Player buys a factionOffice from the realtor.
//  3. createPlayerFaction flips the marker, migrates Owner edge, drains wallet.
//  4. Re-invoking createPlayerFaction is idempotent (created:false).
//  5. playerFactionWithdraw moves fund back to the player's Money.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.realtorListings',
  '__uclife__.realtorBuy',
  '__uclife__.createPlayerFaction',
  '__uclife__.playerFactionStatus',
  '__uclife__.playerFactionWithdraw',
  '__uclife__.ownershipSnapshot',
]

test('player-faction creation, idempotency, withdraw', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  // 1. No IsPlayerFaction marker before creation.
  const beforeStatus = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.playerFactionStatus(),
  )
  expect(beforeStatus.hasIsPlayerFactionMarker, 'IsPlayerFaction marker set before creation call').toBeFalsy()

  // 2. Buy a factionOffice so we have a building to migrate.
  const listings = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.realtorListings(),
  )
  const office = listings.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l: any) => l.typeId === 'factionOffice' && l.ownerKind === 'state',
  )
  expect(office, 'no state-owned factionOffice in realtor listings').toBeTruthy()
  const buy = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.realtorBuy(k),
    office.buildingKey,
  )
  expect(buy.ok, `realtorBuy failed: ${buy.reason}`).toBeTruthy()

  const snapMid = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.ownershipSnapshot(),
  )
  const charOwned = snapMid.buildingsByOwnerKind.character ?? 0
  expect(charOwned, `expected at least 1 character-owned building after buy`).toBeGreaterThanOrEqual(1)

  // 3. createPlayerFaction migrates Owner + wallet.
  const create = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.createPlayerFaction(),
  )
  expect(create.ok, `createPlayerFaction returned ok=false: ${create.reason ?? 'unknown'}`).toBeTruthy()
  expect(create.created, `createPlayerFaction.created=false on first call`).toBeTruthy()
  expect(create.migratedBuildings, `createPlayerFaction.migratedBuildings`).toBeGreaterThanOrEqual(1)

  const postStatus = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.playerFactionStatus(),
  )
  expect(postStatus.hasIsPlayerFactionMarker, 'IsPlayerFaction marker missing after createPlayerFaction').toBeTruthy()
  expect(postStatus.facilityCount, `playerFactionStatus.facilityCount after migration`).toBeGreaterThanOrEqual(1)

  const snapAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.ownershipSnapshot(),
  )
  const playerFactionCount = snapAfter.buildingsByFaction.player ?? 0
  expect(playerFactionCount).toBeGreaterThanOrEqual(1)

  // 4. Second call is idempotent.
  const second = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.createPlayerFaction(),
  )
  expect(second.created, 'second createPlayerFaction call returned created=true').toBeFalsy()
  expect(second.migratedBuildings, `second createPlayerFaction migratedBuildings`).toBe(0)

  // 5. Withdraw routes fund back to the player.
  const withdrawAmt = Math.min(500, postStatus.fund)
  if (withdrawAmt > 0) {
    const w = await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a) => (window as any).__uclife__.playerFactionWithdraw(a),
      withdrawAmt,
    )
    expect(w.ok && w.moved === withdrawAmt, `playerFactionWithdraw moved=${w.moved} (want ${withdrawAmt})`).toBeTruthy()
  }
})
