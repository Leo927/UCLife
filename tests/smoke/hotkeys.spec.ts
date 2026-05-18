// hotkeys smoke. Verifies the Hud's keydown handler:
//   1. C opens status; ESC closes status; C toggles back open then closed.
//   2. I opens inventory; ESC closes inventory.
//   3. C while inventory open is a no-op (anyModal block); inventory stays.
//   4. ESC with no modal open is a no-op.
//   5. ESC closes the system menu (opened directly via the UI store).

import { test, expect, DOM_COMMIT_TIMEOUT_MS, isExpectedTestModePortraitMissing } from './_fixtures'

const FIXTURE = 'minimal-player-only'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  'uclifeUI.getState',
]

test('hotkeys: C/I/ESC behave correctly', async ({ sim }) => {
  sim.allowConsoleError(isExpectedTestModePortraitMissing)
  await sim.boot({ fixture: FIXTURE, requireHandles: REQUIRED_HANDLES })

  // Wait for the Hud root to commit. The Hud's keydown listener is attached
  // in a useEffect, so once the `.hud` element is in the DOM the listener is
  // guaranteed live.
  await sim.page.waitForSelector('.hud', { timeout: DOM_COMMIT_TIMEOUT_MS })

  const readState = () => sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (window as any).uclifeUI.getState()
    return {
      statusOpen: s.statusOpen,
      inventoryOpen: s.inventoryOpen,
      mapOpen: s.mapOpen,
      systemOpen: s.systemOpen,
    }
  })

  // 1. C opens, ESC closes, C reopens, C closes.
  await sim.page.keyboard.press('c')
  let s = await readState()
  expect(s.statusOpen, `C should open status, got ${JSON.stringify(s)}`).toBe(true)

  await sim.page.keyboard.press('Escape')
  s = await readState()
  expect(s.statusOpen, `ESC should close status, got ${JSON.stringify(s)}`).toBe(false)

  await sim.page.keyboard.press('c')
  s = await readState()
  expect(s.statusOpen, `C should re-open status, got ${JSON.stringify(s)}`).toBe(true)

  await sim.page.keyboard.press('c')
  s = await readState()
  expect(s.statusOpen, `C should toggle status off, got ${JSON.stringify(s)}`).toBe(false)

  // 2. I opens inventory, ESC closes.
  await sim.page.keyboard.press('i')
  s = await readState()
  expect(s.inventoryOpen, `I should open inventory, got ${JSON.stringify(s)}`).toBe(true)

  await sim.page.keyboard.press('Escape')
  s = await readState()
  expect(s.inventoryOpen, `ESC should close inventory, got ${JSON.stringify(s)}`).toBe(false)

  // 3. C while inventory open: no-op (anyModal block).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().setInventory(true))
  await sim.page.keyboard.press('c')
  s = await readState()
  expect(s.statusOpen, `C should not open status while inventory open, got ${JSON.stringify(s)}`).toBe(false)
  expect(s.inventoryOpen, `Inventory should remain open after C press`).toBe(true)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().setInventory(false))

  // 4. ESC with no modal open: no-op.
  await sim.page.keyboard.press('Escape')
  s = await readState()
  expect(
    s.statusOpen || s.inventoryOpen || s.mapOpen || s.systemOpen,
    `ESC opened something with no modal: ${JSON.stringify(s)}`,
  ).toBe(false)

  // 5. ESC closes the system menu (opened via store, then real key press).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().setSystem(true))
  await sim.page.keyboard.press('Escape')
  s = await readState()
  expect(s.systemOpen, `ESC should close systemMenu, got ${JSON.stringify(s)}`).toBe(false)
})
