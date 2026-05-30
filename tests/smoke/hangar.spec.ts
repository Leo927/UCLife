// hangar smoke. Verifies:
//   1. The Von Braun state hangar spawns with the Hangar trait carrying
//      tier='surface' and slotCapacity matching facility-types.json5.
//   2. The hangar is state-owned and the realtor never lists it.
//   3. The hangar manager seat is BT-claimable: fillJobVacancies seats it.
//   4. Opening NPCDialog on the manager and clicking the hangarManager
//      branch surfaces the authored capacity readout.

import { test, expect, DOM_COMMIT_TIMEOUT_MS, isExpectedTestModePortraitMissing } from './_fixtures'

const FIXTURE = 'minimal-player-only'
const HANGAR_TYPE_ID = 'hangarSurface'
const EXPECTED_MS_SLOTS = 4
const EXPECTED_SMALL_CRAFT_SLOTS = 4
const EXPECTED_TIER = 'surface'
const EXPECTED_OWNER_KIND = 'state'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.listHangars',
  '__uclife__.hangarManagerEntity',
  '__uclife__.fillJobVacancies',
  '__uclife__.realtorListings',
]

test('hangar: state-owned with correct slots, manager dialog readout', async ({ sim }) => {
  sim.allowConsoleError(isExpectedTestModePortraitMissing)
  await sim.boot({ fixture: FIXTURE, requireHandles: REQUIRED_HANDLES })

  const scene = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getScene().getId(),
  )
  expect(scene, `fixture must boot in vonBraunCity, got ${scene}`).toBe('vonBraunCity')

  // 1. Surface hangar spawned with the right facility shape. vonBraunCity
  // now also hosts the orbital drydock (hidden region), so select the
  // surface yard by type rather than assuming a single hangar.
  const hangars = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listHangars(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vb = hangars.find((h: any) => h.typeId === HANGAR_TYPE_ID)
  expect(vb, `${HANGAR_TYPE_ID} missing from vonBraunCity hangars`).toBeTruthy()
  expect(vb.typeId).toBe(HANGAR_TYPE_ID)
  expect(vb.tier).toBe(EXPECTED_TIER)
  expect(vb.slotCapacity.ms).toBe(EXPECTED_MS_SLOTS)
  expect(vb.slotCapacity.smallCraft).toBe(EXPECTED_SMALL_CRAFT_SLOTS)
  expect(vb.ownerKind).toBe(EXPECTED_OWNER_KIND)
  expect(vb.workerCount).toBeGreaterThanOrEqual(1)

  // 2. Realtor never lists it.
  const listings = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.realtorListings(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hangarListed = listings.find((l: any) => l.typeId === HANGAR_TYPE_ID)
  expect(hangarListed, `hangar appeared on realtor — stateLocked filter regression`).toBeUndefined()

  // 3. fillJobVacancies seats the manager + workers deterministically.
  const filled = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fillJobVacancies(['hangar_manager', 'hangar_worker']),
  )
  expect(Array.isArray(filled), `fillJobVacancies did not return an array`).toBeTruthy()

  const after = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listHangars(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vbAfter = after.find((h: any) => h.buildingKey === vb.buildingKey)
  expect(vbAfter?.manager, `hangar manager seat still empty after fillJobVacancies`).toBeTruthy()
  expect(vbAfter.manager.occupantName, `hangar manager occupant has no Character name`).toBeTruthy()

  // 4. Open NPCDialog on the manager.
  const opened = await sim.page.evaluate((buildingKey) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const manager = w.__uclife__.hangarManagerEntity(buildingKey)
    if (!manager) return false
    w.uclifeUI.getState().setDialogNPC(manager)
    return true
  }, vb.buildingKey)
  expect(opened, `could not open NPCDialog for hangar manager`).toBeTruthy()

  await sim.page.waitForSelector('button.dialog-option', { timeout: DOM_COMMIT_TIMEOUT_MS })
  await sim.page.click('button.dialog-option:has-text("机库状况")')
  await sim.page.waitForSelector('section[data-dialogue-node="hangarManager"]', { timeout: DOM_COMMIT_TIMEOUT_MS })

  const text = await sim.page.evaluate(() => {
    const node = document.querySelector('section[data-dialogue-node="hangarManager"]')
    return node?.textContent ?? ''
  })
  expect(text.includes('MS 泊位'), `manager panel missing MS slot label`).toBeTruthy()
  expect(text.includes('小艇泊位'), `manager panel missing smallCraft slot label`).toBeTruthy()
  expect(text.includes('0 / 4'), `manager panel missing 0/4 capacity readout`).toBeTruthy()
  expect(text.includes('地面机库'), `manager panel missing surface tier label`).toBeTruthy()
})
