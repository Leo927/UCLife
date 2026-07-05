// debug "grant fleet" function smoke. Drives the __uclife__.grantFleet handle
// and asserts the composed state matches the documented end-to-end fleet shape.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.grantFleet',
  '__uclife__.listShipsInFleet',
  '__uclife__.fleetRosterSnapshot',
  '__uclife__.warRoomDescribe',
  '__uclife__.listHangarsAllScenes',
  '__uclife__.hangarSupplySnapshot',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]

test('grantFleet adds Pegasus + lunarMilitia, captains, save round-trip', async ({ sim }) => {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: REQUIRED_HANDLES })

  const before = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  expect(before.length, `baseline fleet should be one flagship; got ${before.length}`).toBe(1)

  const grant = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.grantFleet(),
  )
  expect(grant?.ok, `first grantFleet() should succeed; got ${JSON.stringify(grant)}`).toBeTruthy()

  const after = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  expect(after.length, `post-grant fleet should be 3 ships; got ${after.length}`).toBe(3)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pegasus = after.find((s: any) => s.templateId === 'pegasusClass')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const militia = after.find((s: any) => s.templateId === 'lunarMilitia')
  expect(pegasus, 'pegasus not in fleet after grant').toBeTruthy()
  expect(pegasus.dockedAtPoiId).toBe('vonBraunDrydock')
  expect(militia, 'lunarMilitia not in fleet after grant').toBeTruthy()
  expect(militia.dockedAtPoiId).toBe('vonBraun')

  const roster = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetRosterSnapshot(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pgRow = roster.find((r: any) => r.templateId === 'pegasusClass')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lmRow = roster.find((r: any) => r.templateId === 'lunarMilitia')
  expect(pgRow?.captainKey, `pegasus has no captain after grant`).toBeTruthy()
  expect(lmRow?.captainKey, `lunarMilitia has no captain after grant`).toBeTruthy()
  expect(lmRow.crewCount).toBeGreaterThanOrEqual(1)
  expect(pgRow.crewCount).toBeGreaterThanOrEqual(1)

  const hangars = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listHangarsAllScenes(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vbHangar = hangars.find((h: any) => h.typeId === 'hangarSurface')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drydock = hangars.find((h: any) => h.typeId === 'hangarDrydock')
  expect(vbHangar, 'VB surface hangar missing').toBeTruthy()
  expect(drydock, 'Von Braun drydock missing').toBeTruthy()

  const vbSupply = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarSupplySnapshot(k),
    vbHangar.buildingKey,
  )
  const ddSupply = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarSupplySnapshot(k),
    drydock.buildingKey,
  )
  expect(vbSupply.supplyCurrent).toBe(vbSupply.supplyMax)
  expect(ddSupply.supplyCurrent).toBe(ddSupply.supplyMax)

  const wr = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.warRoomDescribe(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pgWar = wr.ships.find((r: any) => r.templateId === 'pegasusClass')
  expect(pgWar?.isInActiveFleet, `pegasus should be in active fleet`).toBeTruthy()
  expect(pgWar.formationSlot, `pegasus should not occupy flagship slot`).not.toBe(wr.flagshipSlot)

  const grant2 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.grantFleet(),
  )
  expect(grant2?.ok, `second grantFleet() should be refused; got ${JSON.stringify(grant2)}`).toBe(false)
  expect(grant2.reason).toBe('already_granted')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame('auto') })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.loadGame('auto') })
  await sim.waitForBoot(['__uclife__.listShipsInFleet'])

  const afterLoad = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  expect(afterLoad.length, `post-load fleet count should be 3; got ${afterLoad.length}`).toBe(3)

  const rosterLoad = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetRosterSnapshot(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pgLoad = rosterLoad.find((r: any) => r.templateId === 'pegasusClass')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lmLoad = rosterLoad.find((r: any) => r.templateId === 'lunarMilitia')
  expect(pgLoad?.captainKey, 'pegasus captain not preserved across save/load').toBeTruthy()
  expect(lmLoad?.captainKey, 'lunarMilitia captain not preserved across save/load').toBeTruthy()

  const wrLoad = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.warRoomDescribe(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pgWarLoad = wrLoad.ships.find((r: any) => r.templateId === 'pegasusClass')
  expect(pgWarLoad?.isInActiveFleet, `pegasus active-fleet marker not preserved`).toBeTruthy()
})
