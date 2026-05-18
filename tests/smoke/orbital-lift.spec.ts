// orbital-lift smoke. Verifies:
//   1. The VB orbital-lift kiosk spawns at the spaceport.
//   2. The Granada drydock scene spawns its paired lift kiosk.
//   3. The cross-scene transit runs: charges fare, advances clock, migrates.
//   4. Opening NPCDialog on the drydock manager surfaces the readout.

import { test, expect, DOM_COMMIT_TIMEOUT_MS, isExpectedTestModePortraitMissing } from './_fixtures'

const FIXTURE = 'player-with-cash-at-vb'
const LIFT_ID = 'vonBraunGranadaLift'
const FROM_SCENE = 'vonBraunCity'
const TO_SCENE = 'granadaDrydock'
const LIFT_FARE = 500
const LIFT_DURATION_MIN = 90
const MS_PER_MINUTE = 60_000
const DRYDOCK_TYPE_ID = 'hangarDrydock'
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

test('orbital lift: VB → Granada transit, drydock manager dialog', async ({ sim }) => {
  sim.allowConsoleError(isExpectedTestModePortraitMissing)
  await sim.boot({ fixture: FIXTURE, requireHandles: REQUIRED_HANDLES })

  const initialScene = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getScene().getId(),
  )
  expect(initialScene, `fixture must boot in ${FROM_SCENE}, got ${initialScene}`).toBe(FROM_SCENE)

  // 1. Catalog + kiosks.
  const catalog = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.orbitalLiftCatalog(),
  )
  expect(catalog.length).toBe(1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vbLift = catalog.find((l: any) => l.id === LIFT_ID)
  expect(vbLift, `${LIFT_ID} missing from orbitalLiftCatalog`).toBeTruthy()
  expect(vbLift.sceneIdA).toBe(FROM_SCENE)
  expect(vbLift.sceneIdB).toBe(TO_SCENE)
  expect(vbLift.durationMin).toBe(LIFT_DURATION_MIN)
  expect(vbLift.fare).toBe(LIFT_FARE)

  const vbKiosks = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sceneId) => (window as any).__uclife__.listOrbitalLifts(sceneId),
    FROM_SCENE,
  )
  expect(vbKiosks.length).toBe(1)
  expect(vbKiosks[0].destSceneId).toBe(TO_SCENE)

  const granadaKiosks = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sceneId) => (window as any).__uclife__.listOrbitalLifts(sceneId),
    TO_SCENE,
  )
  expect(granadaKiosks.length).toBe(1)
  expect(granadaKiosks[0].destSceneId).toBe(FROM_SCENE)

  // 2. Capture pre-transit state.
  const pre = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    return {
      money: w.__uclife__.getGameState().getPlayerCharacter().getResource('Money'),
      clockMs: w.__uclife__.useClock.getState().gameDate.getTime(),
      sceneId: w.__uclife__.getGameState().getScene().getId(),
    }
  })

  // 3. Run the transit.
  const arrivedSceneId = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (liftId) => (window as any).__uclife__.runOrbitalLift(liftId),
    LIFT_ID,
  )
  expect(arrivedSceneId).toBe(TO_SCENE)

  const post = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    return {
      money: w.__uclife__.getGameState().getPlayerCharacter().getResource('Money'),
      clockMs: w.__uclife__.useClock.getState().gameDate.getTime(),
      sceneId: w.__uclife__.getGameState().getScene().getId(),
    }
  })

  expect(post.sceneId).toBe(TO_SCENE)
  expect(pre.money - post.money).toBe(LIFT_FARE)
  expect(post.clockMs - pre.clockMs).toBe(LIFT_DURATION_MIN * MS_PER_MINUTE)

  // 4. listHangars in Granada returns the drydock.
  const hangars = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listHangars(),
  )
  expect(hangars.length).toBe(1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drydock = hangars.find((h: any) => h.typeId === DRYDOCK_TYPE_ID)
  expect(drydock, `${DRYDOCK_TYPE_ID} missing from listHangars in Granada`).toBeTruthy()
  expect(drydock.tier).toBe('drydock')
  expect(drydock.slotCapacity.capital).toBe(EXPECTED_CAPITAL_SLOTS)
  expect(drydock.slotCapacity.smallCraft).toBe(EXPECTED_SMALL_CRAFT_SLOTS)
  expect(drydock.ownerKind).toBe('state')
  expect(drydock.workerCount).toBeGreaterThanOrEqual(1)

  // 5. Seat manager + workers.
  const filled = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fillJobVacancies(['hangar_manager', 'hangar_worker']),
  )
  expect(Array.isArray(filled), 'fillJobVacancies did not return an array').toBeTruthy()

  const after = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listHangars(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drydockAfter = after.find((h: any) => h.buildingKey === drydock.buildingKey)
  expect(drydockAfter?.manager, 'drydock manager seat still empty').toBeTruthy()
  expect(drydockAfter.manager.occupantName, 'drydock manager occupant has no name').toBeTruthy()

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
