// Active-fleet auto-launch + cross-POI transit + formation flying smoke.

import { test, expect, isKnownPixiBatcherStartup } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.fillJobVacancies',
  '__uclife__.listShipsInFleet',
  '__uclife__.listHangarsAllScenes',
  '__uclife__.enqueueShipDelivery',
  '__uclife__.runShipDeliveryTick',
  '__uclife__.receiveShipDelivery',
  '__uclife__.warRoomDescribe',
  '__uclife__.setIsInActiveFleet',
  '__uclife__.forceUndockFlagship',
  '__uclife__.forceDockFlagship',
  '__uclife__.runFleetTransitTick',
  '__uclife__.fleetTransitDescribe',
  '__uclife__.fleetEscortBodies',
  '__uclife__.combatPlayerSideSnapshot',
  '__uclife__.fleetActiveEscortPartition',
  '__uclife__.tickSpace',
  '__uclife__.cheatMoney',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]

const STEP_BUDGET_MIN = 60

test('active-fleet auto-launch, cross-POI transit, formation, save round-trip', async ({ sim }) => {
  sim.allowConsoleError(isKnownPixiBatcherStartup)
  // The original check-fleet-launch.mjs also filters one specific React
  // canvas-render console error during the same scene swap.
  sim.allowConsoleError((t) => t.includes('The above error occurred in the <PixiCanvas>'))
  sim.allowConsoleError((t) => /Cannot read properties of undefined \(reading 'push'\)/.test(t))
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.cheatMoney(2_000_000))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.fillJobVacancies(['hangar_manager']))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.fillJobVacancies(['hangar_manager']))

  // 0. Initial fleet: just the flagship.
  const initialFleet = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  expect(initialFleet.length, `expected one starting ship; got ${initialFleet.length}`).toBe(1)
  expect(initialFleet[0].dockedAtPoiId).toBe('vonBraun')

  // 1. Spawn Ship A at VB hangar + Ship B at Von Braun drydock.
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

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.enqueueShipDelivery(k, 'lunarMilitia', 1, 2),
    vbHangar.buildingKey,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.runShipDeliveryTick(3))
  const rxA = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.receiveShipDelivery(k, 0),
    vbHangar.buildingKey,
  )
  expect(rxA.ok, `Ship A receive failed: ${JSON.stringify(rxA)}`).toBeTruthy()
  const shipAKey = rxA.entityKey

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.enqueueShipDelivery(k, 'pegasusClass', 1, 5),
    drydock.buildingKey,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.runShipDeliveryTick(6))
  const rxB = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.receiveShipDelivery(k, 0),
    drydock.buildingKey,
  )
  expect(rxB.ok, `Ship B receive failed: ${JSON.stringify(rxB)}`).toBeTruthy()
  const shipBKey = rxB.entityKey

  const postBuyFleet = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shipA = postBuyFleet.find((s: any) => s.entityKey === shipAKey)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shipB = postBuyFleet.find((s: any) => s.entityKey === shipBKey)
  expect(shipA?.dockedAtPoiId).toBe('vonBraun')
  expect(shipB?.dockedAtPoiId).toBe('vonBraunDrydock')

  // 2. Promote A and B into the active fleet.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setIsInActiveFleet(k, true),
    shipAKey,
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setIsInActiveFleet(k, true),
    shipBKey,
  )

  const wr = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.warRoomDescribe(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rowA = wr.ships.find((r: any) => r.entityKey === shipAKey)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rowB = wr.ships.find((r: any) => r.entityKey === shipBKey)
  expect(rowA?.isInActiveFleet, `Ship A not in active fleet: ${JSON.stringify(rowA)}`).toBeTruthy()
  expect(rowB?.isInActiveFleet, `Ship B not in active fleet: ${JSON.stringify(rowB)}`).toBeTruthy()

  // 3. Partition assertion.
  const partition = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetActiveEscortPartition('vonBraun'),
  )
  expect(
    partition.sameAsFlagshipPoi.includes(shipAKey),
    `Ship A should be in sameAsFlagshipPoi: ${JSON.stringify(partition)}`,
  ).toBeTruthy()
  expect(
    partition.differentPoi.includes(shipBKey),
    `Ship B should be in differentPoi: ${JSON.stringify(partition)}`,
  ).toBeTruthy()

  // 4. Force flagship undock at gameDay=5: A auto-launches; B queues transit.
  const undock = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.forceUndockFlagship('vonBraun', 5),
  )
  expect(undock.launchedSameSite).toBe(1)
  expect(undock.queuedTransit).toBe(1)
  expect(undock.transitFailures).toBe(0)

  // 5. Ship A in flight, Ship B in transit.
  const afterUndock = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aAfter = afterUndock.find((s: any) => s.entityKey === shipAKey)
  expect(aAfter?.dockedAtPoiId).toBe('')

  const transits = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetTransitDescribe(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tB = transits.find((t: any) => t.shipKey === shipBKey)
  expect(tB, `Ship B not in transit list: ${JSON.stringify(transits)}`).toBeTruthy()
  expect(tB.originPoiId).toBe('vonBraunDrydock')
  expect(tB.destinationPoiId).toBe('vonBraun')
  expect(tB.arrivalDay).toBeGreaterThan(5)

  // 6. FleetEscort body for A exists; B has none (in transit).
  const bodies = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetEscortBodies(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bodyA = bodies.find((b: any) => b.shipKey === shipAKey)
  expect(bodyA, `escort body for A missing: ${JSON.stringify(bodies)}`).toBeTruthy()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bodyB = bodies.find((b: any) => b.shipKey === shipBKey)
  expect(bodyB, 'Ship B should not have an escort body while in transit').toBeFalsy()

  // 7. One space tick — A's Position lands at flagship.pos + formation offset.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.tickSpace(0.016))
  const bodiesAfterTick = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetEscortBodies(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bodyAAfter = bodiesAfterTick.find((b: any) => b.shipKey === shipAKey)
  expect(bodyAAfter?.formationOffset, `escort A missing formation offset`).toBeTruthy()
  const flagshipPos = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.shipPos(),
  )
  const expectedX = flagshipPos.x + bodyAAfter.formationOffset.dx
  const expectedY = flagshipPos.y + bodyAAfter.formationOffset.dy
  expect(
    Math.abs(bodyAAfter.pos.x - expectedX) < 0.01 && Math.abs(bodyAAfter.pos.y - expectedY) < 0.01,
    `escort A pos≠flagship+offset`,
  ).toBeTruthy()

  // 8. Demote A, undock flagship again — A should NOT auto-launch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.forceDockFlagship('vonBraun'))
  const afterRedock = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aRedocked = afterRedock.find((s: any) => s.entityKey === shipAKey)
  expect(aRedocked?.dockedAtPoiId).toBe('vonBraun')

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setIsInActiveFleet(k, false),
    shipAKey,
  )
  const undock2 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.forceUndockFlagship('vonBraun', 6),
  )
  expect(undock2.launchedSameSite).toBe(0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.forceDockFlagship('vonBraun'))
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setIsInActiveFleet(k, true, 0),
    shipAKey,
  )

  // 9. Cross-POI transit lander.
  const transitsBeforeLand = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetTransitDescribe(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tBBefore = transitsBeforeLand.find((t: any) => t.shipKey === shipBKey)
  const arrivalDay = tBBefore?.arrivalDay
  expect(arrivalDay, 'Ship B not in transit before land tick').toBeTruthy()

  const landResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (day) => (window as any).__uclife__.runFleetTransitTick(day),
    arrivalDay,
  )
  expect(landResult.landed).toBeGreaterThanOrEqual(1)

  const postLand = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bPostLand = postLand.find((s: any) => s.entityKey === shipBKey)
  expect(bPostLand?.dockedAtPoiId).toBe('vonBraun')
  const transitsAfterLand = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetTransitDescribe(),
  )
  expect(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !transitsAfterLand.find((t: any) => t.shipKey === shipBKey),
    'Ship B should be cleared from transit list after land',
  ).toBeTruthy()

  // 10. Tactical combat start: spawn CombatShipState for player-side escorts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.forceDockFlagship('vonBraun'))
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.startCombatCheat('pirateLight', [], null, {}),
  )
  const csSnap = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.combatPlayerSideSnapshot(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flagshipRow = csSnap.find((r: any) => r.isFlagship)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const escortRows = csSnap.filter((r: any) => !r.isFlagship && !r.isMs)
  expect(flagshipRow, 'no flagship row in combatPlayerSideSnapshot').toBeTruthy()
  expect(escortRows.length).toBeGreaterThanOrEqual(2)
  for (const er of escortRows) {
    expect(er.hullCurrent > 0 && er.hullMax > 0, `escort ${er.entityKey} hull invalid`).toBeTruthy()
    expect(er.weaponsCount, `escort ${er.entityKey} has no weapons`).toBeGreaterThan(0)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.fastWinCombat())
  await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cs = (window as any).__uclife__.useCombatStore.getState()
    if (cs.paused) cs.togglePause()
  })
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useClock.getState().mode !== 'combat',
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  // 11. Save round-trip.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.forceUndockFlagship('vonBraun', 10))
  const bodiesPreSave = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetEscortBodies(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bodyAPreSave = bodiesPreSave.find((b: any) => b.shipKey === shipAKey)
  expect(bodyAPreSave, 'escort body for A missing pre-save').toBeTruthy()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame('auto') })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.loadGame('auto') })

  await sim.waitForBoot(['__uclife__.fleetEscortBodies'])

  const postLoadFleet = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aPostLoad = postLoadFleet.find((s: any) => s.entityKey === shipAKey)
  expect(aPostLoad, 'Ship A missing post-load').toBeTruthy()
  expect(aPostLoad.dockedAtPoiId).toBe('')

  const bodiesPostLoad = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetEscortBodies(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bodyAPostLoad = bodiesPostLoad.find((b: any) => b.shipKey === shipAKey)
  expect(bodyAPostLoad, `escort body for Ship A missing post-load`).toBeTruthy()
})
