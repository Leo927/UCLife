// orbital-lift smoke. The drydock is now the hidden orbital region of
// vonBraunCity, so both lift kiosks live in one world. Verifies:
//   1. The lift catalog row is same-world (sceneIdA === sceneIdB).
//   2. Both kiosks spawn in vonBraunCity: the surface end charges the up
//      fare, the drydock end is free to leave.
//   3. Riding the lift charges the up fare, advances the clock, and lands the
//      player in the drydock region — same world, no scene swap.
//   4. The drydock hangar is reachable and its manager dialog reads out.

import { test, expect, DOM_COMMIT_TIMEOUT_MS, isExpectedTestModePortraitMissing } from './_fixtures'

const FIXTURE = 'player-with-cash-at-vb'
const LIFT_ID = 'vonBraunDrydockLift'
const SCENE = 'vonBraunCity'
const FARE_UP = 500
const FARE_DOWN = 0
const LIFT_DURATION_MIN = 90
const MS_PER_MINUTE = 60_000
const TILE_PX = 32
const DRYDOCK_TYPE_ID = 'hangarDrydock'
const DRYDOCK_REGION_MIN_Y = 540
const EXPECTED_CAPITAL_SLOTS = 4
const EXPECTED_SMALL_CRAFT_SLOTS = 12

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.listOrbitalLifts',
  '__uclife__.runOrbitalLift',
  '__uclife__.orbitalLiftCatalog',
  '__uclife__.listHangars',
  '__uclife__.hangarManagerEntity',
  '__uclife__.fillJobVacancies',
]

test('orbital lift: same-world VB → drydock transit, drydock manager dialog', async ({ sim }) => {
  sim.allowConsoleError(isExpectedTestModePortraitMissing)
  await sim.boot({ fixture: FIXTURE, requireHandles: REQUIRED_HANDLES })

  const initialScene = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getScene().getId(),
  )
  expect(initialScene, `fixture must boot in ${SCENE}, got ${initialScene}`).toBe(SCENE)

  // 1. Catalog — same-world lift (both endpoints in vonBraunCity).
  const catalog = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.orbitalLiftCatalog(),
  )
  expect(catalog.length).toBe(1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vbLift = catalog.find((l: any) => l.id === LIFT_ID)
  expect(vbLift, `${LIFT_ID} missing from orbitalLiftCatalog`).toBeTruthy()
  expect(vbLift.sceneIdA).toBe(SCENE)
  expect(vbLift.sceneIdB).toBe(SCENE)
  expect(vbLift.durationMin).toBe(LIFT_DURATION_MIN)
  expect(vbLift.fareUp).toBe(FARE_UP)
  expect(vbLift.fareDown).toBe(FARE_DOWN)

  // 2. Both kiosks live in vonBraunCity, one per endpoint, with split fares.
  const kiosks = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sceneId) => (window as any).__uclife__.listOrbitalLifts(sceneId),
    SCENE,
  )
  expect(kiosks.length, 'expected two same-world lift kiosks in vonBraunCity').toBe(2)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const surfaceKiosk = kiosks.find((k: any) => k.endpoint === 'a')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drydockKiosk = kiosks.find((k: any) => k.endpoint === 'b')
  expect(surfaceKiosk, 'surface (endpoint a) kiosk missing').toBeTruthy()
  expect(drydockKiosk, 'drydock (endpoint b) kiosk missing').toBeTruthy()
  expect(surfaceKiosk.fare, 'surface (up) leg must charge the up fare').toBe(FARE_UP)
  expect(drydockKiosk.fare, 'drydock (down) leg must be free so the player cannot strand').toBe(FARE_DOWN)
  // The drydock kiosk sits inside the hidden southern region.
  expect(drydockKiosk.posTile.y, 'drydock kiosk must sit in the drydock region')
    .toBeGreaterThanOrEqual(DRYDOCK_REGION_MIN_Y)

  // 3. Capture pre-transit state, then ride the surface lift up.
  const pre = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    return {
      money: w.__uclife__.getGameState().getPlayerCharacter().getResource('Money'),
      clockMs: w.__uclife__.useClock.getState().gameDate.getTime(),
      sceneId: w.__uclife__.getGameState().getScene().getId(),
    }
  })

  // Explicit endpoint 'a' so the ride direction is deterministic regardless
  // of the player's spawn-to-kiosk distances.
  const arrivedSceneId = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (liftId) => (window as any).__uclife__.runOrbitalLift(liftId, 'a'),
    LIFT_ID,
  )
  expect(arrivedSceneId, 'transit must stay in the same world').toBe(SCENE)

  const post = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const p = w.__uclife__.getGameState().getPlayerCharacter().getPosition()
    return {
      money: w.__uclife__.getGameState().getPlayerCharacter().getResource('Money'),
      clockMs: w.__uclife__.useClock.getState().gameDate.getTime(),
      sceneId: w.__uclife__.getGameState().getScene().getId(),
      posY: p.y,
    }
  })

  expect(post.sceneId, 'player stays in vonBraunCity after the lift').toBe(SCENE)
  expect(pre.money - post.money).toBe(FARE_UP)
  expect(post.clockMs - pre.clockMs).toBe(LIFT_DURATION_MIN * MS_PER_MINUTE)
  expect(post.posY, 'player must arrive inside the drydock region')
    .toBeGreaterThanOrEqual(DRYDOCK_REGION_MIN_Y * TILE_PX)

  // 4. The drydock hangar is present in vonBraunCity (alongside the surface
  // yard); find it by type rather than asserting a single hangar.
  const hangars = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listHangars(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drydock = hangars.find((h: any) => h.typeId === DRYDOCK_TYPE_ID)
  expect(drydock, `${DRYDOCK_TYPE_ID} missing from listHangars`).toBeTruthy()
  expect(drydock.tier).toBe('drydock')
  expect(drydock.slotCapacity.capital).toBe(EXPECTED_CAPITAL_SLOTS)
  expect(drydock.slotCapacity.smallCraft).toBe(EXPECTED_SMALL_CRAFT_SLOTS)
  expect(drydock.ownerKind).toBe('state')
  expect(drydock.workerCount).toBeGreaterThanOrEqual(1)

  // 5. Seat manager + workers, then read the manager dialog. vonBraunCity now
  // hosts two hangars (surface yard + drydock), so a single fillJobVacancies
  // seats only the first vacant hangar_manager — repeat until the drydock's
  // own manager seat fills (each call seats the next vacant station).
  const drydockManagerName = await sim.page.evaluate((buildingKey) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    for (let i = 0; i < 6; i++) {
      w.__uclife__.fillJobVacancies(['hangar_manager', 'hangar_worker'])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const h = w.__uclife__.listHangars().find((x: any) => x.buildingKey === buildingKey)
      if (h?.manager?.occupantName) return h.manager.occupantName
    }
    return null
  }, drydock.buildingKey)
  expect(drydockManagerName, 'drydock manager seat should fill after seating both hangars').toBeTruthy()

  const opened = await sim.page.evaluate((buildingKey) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const manager = w.__uclife__.hangarManagerEntity(buildingKey)
    if (!manager) return false
    w.uclifeUI.getState().setDialogNPC(manager)
    return true
  }, drydock.buildingKey)
  expect(opened, `could not open NPCDialog for drydock manager`).toBeTruthy()

  await sim.page.waitForSelector('button.dialog-option', { timeout: DOM_COMMIT_TIMEOUT_MS })
  await sim.page.click('button.dialog-option:has-text("机库状况")')
  await sim.page.waitForSelector('section[data-dialogue-node="hangarManager"]', { timeout: DOM_COMMIT_TIMEOUT_MS })

  const text = await sim.page.evaluate(() => {
    const node = document.querySelector('section[data-dialogue-node="hangarManager"]')
    return node?.textContent ?? ''
  })
  expect(text.includes('0 / 4'), `manager panel missing 0/4 capital readout`).toBeTruthy()
  expect(text.includes('0 / 12'), `manager panel missing 0/12 smallCraft readout`).toBeTruthy()
  expect(text.includes('船坞') || text.includes('轨道'), `manager panel missing drydock tier label`).toBeTruthy()
})
