// Dock-picker dormant-but-live smoke. Every POI in pois.json5 currently
// maps to a single landing scene, so the picker never opens through the
// disembarkShip interactable. This spec drives the picker via the debug
// handle (openDockPicker) to assert the shell still functions when a
// future multi-scene POI activates it.
//
// Coverage:
//   1. Picker is closed at boot (dockPicker payload is null).
//   2. openDockPicker stamps the payload and renders the option rows.
//   3. closeDockPicker (via the panel's close button) clears the payload.

import { test, expect, DOM_COMMIT_TIMEOUT_MS } from './_fixtures'

const FIXTURE = 'minimal-player-only'

const REQUIRED_HANDLES = [
  '__uclife__.openDockPicker',
  '__uclife__.dockPickerSnapshot',
]

test('dock picker: open via debug handle renders rows, close clears state', async ({ sim }) => {
  await sim.boot({ fixture: FIXTURE, requireHandles: REQUIRED_HANDLES })

  const initial = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.dockPickerSnapshot(),
  )
  expect(initial, 'picker should be closed at boot').toBeNull()

  // Two real landing scenes — the picker resolves each candidate's title, so
  // they must be live scene ids (the former vonBraunDrydock is no longer one).
  const payload = {
    poiId: 'vonBraun',
    shipKey: 'ship',
    candidates: ['vonBraunCity', 'zumCity'],
  }
  const opened = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (p) => (window as any).__uclife__.openDockPicker(p),
    payload,
  )
  expect(opened?.poiId, 'openDockPicker should stamp the payload').toBe('vonBraun')
  expect(opened?.candidates).toEqual(['vonBraunCity', 'zumCity'])

  await sim.page.waitForSelector('[data-dock-picker-row="vonBraunCity"]', { timeout: DOM_COMMIT_TIMEOUT_MS })
  const rowCount = await sim.page.locator('[data-dock-picker-row]').count()
  expect(rowCount, 'one row per candidate').toBe(2)

  await sim.page.click('button.status-close[aria-label="关闭"]')
  await sim.page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.dockPickerSnapshot() === null,
      maxGameMinutes: 1,
    })
  })
  const cleared = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.dockPickerSnapshot(),
  )
  expect(cleared, 'close button should clear the picker payload').toBeNull()
})
