// Regression guard: the .hud bar must be visible above the space-view
// canvas when the player is at the helm (starmap / spaceCampaign scene).
// SpaceView renders with z-index:5; .hud must have a higher z-index so it
// renders on top — otherwise the dark canvas background swallows the bar.

import { test, expect, DOM_COMMIT_TIMEOUT_MS } from './_fixtures'

test('hud is visible above space-view when at helm', async ({ sim }) => {
  sim.allowConsoleError((t) => t.includes('The above error occurred in the <PixiCanvas>'))
  await sim.boot({ requireHandles: ['__uclife__.enterSpace'] })

  // Transition directly to the space campaign scene.
  await sim.page.evaluate(() => (window as any).__uclife__.enterSpace())

  // Wait for React to mount the SpaceView overlay.
  await sim.page.waitForSelector('.space-view', { timeout: DOM_COMMIT_TIMEOUT_MS })

  // elementFromPoint at the .hud's own position must return an element that
  // lives inside .hud — not something inside .space-view.  Before the z-index
  // fix, the space canvas sits on top and elementFromPoint returns a canvas
  // child instead.
  const result = await sim.page.evaluate(() => {
    const hud = document.querySelector('.hud')
    if (!hud) return { visible: false, topElement: 'no .hud' }
    const rect = hud.getBoundingClientRect()
    const el = document.elementFromPoint(rect.left + 10, rect.top + 10)
    if (!el) return { visible: false, topElement: 'null' }
    const visible = hud === el || hud.contains(el)
    return {
      visible,
      topElement: (el as HTMLElement).tagName + (el as HTMLElement).className
        ? `.${(el as HTMLElement).className.split(' ')[0]}`
        : '',
    }
  })

  expect(
    result.visible,
    `HUD bar must render above the space-view canvas — topmost element at HUD position was "${result.topElement}". Check .hud z-index vs SpaceView z-index:5.`,
  ).toBeTruthy()
})
