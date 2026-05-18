// Boot smoke. Across two viewports (desktop + phone) verify the page boots
// cleanly, exposes __uclife__ with the canonical handles, and the campaign
// world finished procgen with a player + buildings + roads + flight hubs.
// Status panel toggle is exercised via the UI store, not a DOM click —
// the click path is covered by systemmenu.spec.ts / portrait-modals.spec.ts.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife__.useScene.getState',
  '__uclife__.useClock.getState',
  '__uclife__.playerSnapshot',
  '__uclife__.countByKind',
  '__uclife__.flightHubCount',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
  'uclifeUI.getState',
]

test.describe('boot smoke', () => {
  for (const { label, viewport } of [
    { label: 'desktop', viewport: { width: 1280, height: 800 } },
    { label: 'phone', viewport: { width: 390, height: 844 } },
  ]) {
    test(`boots cleanly on ${label}`, async ({ sim }) => {
      await sim.page.setViewportSize(viewport)
      await sim.boot({ prod: true, requireHandles: REQUIRED_HANDLES })

      const snap = await sim.page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = (globalThis as any).__uclife__
        return {
          activeScene: u.useScene.getState().activeId,
          player: u.playerSnapshot(),
          counts: u.countByKind(),
          hubs: u.flightHubCount(),
          title: document.title,
        }
      })

      expect(snap.player, `${label}: playerSnapshot returned null — no player spawned`).toBeTruthy()
      expect(snap.activeScene, `${label}: activeScene mismatch`).toBe('vonBraunCity')
      expect(snap.counts?.buildings ?? 0, `${label}: procgen produced no buildings`).toBeGreaterThan(0)
      expect(snap.counts?.roads ?? 0, `${label}: procgen produced no roads`).toBeGreaterThan(0)
      expect(snap.hubs ?? 0, `${label}: flightHubCount=${snap.hubs} — no airports placed`).toBeGreaterThan(0)

      // Open + close the status panel via the UI store. Smoke value: if
      // store wiring is broken at boot the panel never renders.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await sim.page.evaluate(() => (globalThis as any).uclifeUI.getState().setStatus(true))
      await sim.page.waitForFunction(() => !!document.querySelector('.status-panel'))
      const statusOpen = await sim.page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (globalThis as any).uclifeUI.getState().statusOpen,
      )
      expect(statusOpen, `${label}: setStatus(true) did not flip uiStore.statusOpen`).toBeTruthy()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await sim.page.evaluate(() => (globalThis as any).uclifeUI.getState().setStatus(false))
      await sim.page.waitForFunction(() => !document.querySelector('.status-panel'))
    })
  }
})
