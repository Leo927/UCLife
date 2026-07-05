// Task 8 — ship <-> depot MS custody smoke. Closes the frame-mod retrofit
// catch-22: before this task, the starter MS rode aboard the flagship
// (W1 Task 5/7) with no verb to move it to a depot, and the depot msTerminal
// was scene-guarded to playerShipInterior only — so the depot-only
// frame-mod install verb was unreachable by construction. Verifies:
//   1. The hangar-manager panel's new "MS 卸运" verb (real DOM click) flips
//      the starter MS's custody from storedOnShipKey -> dockedAtPoiId.
//   2. The depot msTerminal interactable (spawned by refreshDepotMsLayout)
//      is now reachable outside playerShipInterior — walking to it and
//      pressing interact opens the retrofit panel.
//   3. The depot-only frame-mod install verb — previously unreachable —
//      succeeds once the panel is open, closing the whole chain.

import { test, expect, DOM_COMMIT_TIMEOUT_MS } from './_fixtures'

const STARTER_MS_KEY = 'ms-player-0'
const VB_POI_ID = 'vonBraun'
const VB_SCENE_ID = 'vonBraunCity'
const FRAME_MOD_ID = 'armorPlating'
const STEP_BUDGET_MIN = 5

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.fillJobVacancies',
  '__uclife__.listHangarsForMs',
  '__uclife__.hangarManagerEntity',
  '__uclife__.getMs',
  '__uclife__.depotMsTerminalTile',
  '__uclife__.movePlayerTo',
  '__uclife__.queueInteract',
]

test('ms-custody: unload verb + depot terminal reachability + frame-mod install', async ({ sim }) => {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: REQUIRED_HANDLES })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.fillJobVacancies(['hangar_manager']))

  const starterBefore = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key) => (window as any).__uclife__.getMs(key),
    STARTER_MS_KEY,
  )
  expect(starterBefore, 'starter MS should exist pre-unload').toBeTruthy()
  expect(starterBefore.storedOnShipKey, 'starter MS should start aboard the flagship').toBe('ship')
  expect(starterBefore.dockedAtPoiId, 'starter MS should start with no depot custody').toBe('')

  const hangars = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listHangarsForMs(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vb = hangars.find((h: any) => h.poiId === VB_POI_ID && h.sceneId === VB_SCENE_ID)
  expect(vb, `${VB_POI_ID} hangar missing from ${VB_SCENE_ID}`).toBeTruthy()

  // 1. Open the hangar-manager dialogue and drive the new unload verb via
  // a real DOM click (this is the surface Task 8 adds).
  const opened = await sim.page.evaluate((buildingKey) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const manager = w.__uclife__.hangarManagerEntity(buildingKey)
    if (!manager) return false
    w.uclifeUI.getState().setDialogNPC(manager)
    return true
  }, vb.buildingKey)
  expect(opened, 'could not open NPCDialog for hangar manager').toBeTruthy()

  await sim.page.waitForSelector('button.dialog-option', { timeout: DOM_COMMIT_TIMEOUT_MS })
  await sim.page.click('button.dialog-option:has-text("机库状况")')
  await sim.page.waitForSelector(
    'section[data-dialogue-node="hangarManager"]',
    { timeout: DOM_COMMIT_TIMEOUT_MS },
  )

  const unloadRow = `[data-ms-unload-row="${STARTER_MS_KEY}"]`
  await sim.page.waitForSelector(unloadRow, { timeout: DOM_COMMIT_TIMEOUT_MS })
  await sim.page.click(`button[data-ms-unload-confirm="${STARTER_MS_KEY}"]`)

  const afterUnload = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key) => (window as any).__uclife__.getMs(key),
    STARTER_MS_KEY,
  )
  expect(afterUnload.storedOnShipKey, 'unload should clear storedOnShipKey').toBe('')
  expect(afterUnload.dockedAtPoiId, 'unload should set dockedAtPoiId to the hangar POI').toBe(VB_POI_ID)

  // Close the dialogue so it doesn't intercept the interact click below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().setDialogNPC(null))

  // 2. The depot msTerminal is now reachable outside playerShipInterior —
  // walk to it and press interact (ECS-level equivalent of a real click,
  // same primitive StatusPanel's "go to work" button uses).
  const terminalTile = await sim.page.evaluate(
    ({ sceneId, key }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.depotMsTerminalTile(sceneId, key),
    { sceneId: VB_SCENE_ID, key: STARTER_MS_KEY },
  )
  expect(terminalTile, 'depot msTerminal sprite not found after refreshDepotMsLayout').toBeTruthy()

  await sim.page.evaluate(
    (tile) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.movePlayerTo(tile.x, tile.y),
    terminalTile,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.queueInteract())

  // stepUntil's predicate runs in an isolated browser eval — it can only
  // reach `window`, not this file's outer-scope constants (see
  // _fixtures.ts's stepUntil doc), so the msKey is inlined as a literal.
  await sim.stepUntil(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).uclifeUI.getState().msRetrofitKey === 'ms-player-0',
    STEP_BUDGET_MIN,
  )

  await sim.page.waitForSelector('[data-testid="ms-retrofit-panel"]', { timeout: DOM_COMMIT_TIMEOUT_MS })

  // 3. Install a frame mod — the depot-only verb the catch-22 blocked.
  // starter-fleet's parts fixture stocks one of each frame mod.
  const modButton = `button[data-install-frame-mod="${FRAME_MOD_ID}"]`
  await sim.page.waitForSelector(modButton, { timeout: DOM_COMMIT_TIMEOUT_MS })
  await sim.page.click(modButton)

  const afterInstall = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key) => (window as any).__uclife__.getMs(key),
    STARTER_MS_KEY,
  )
  expect(
    afterInstall.frameMods.includes(FRAME_MOD_ID),
    `frame mod "${FRAME_MOD_ID}" should be installed after the depot-only verb`,
  ).toBeTruthy()
})
