// Renderer-pixel: portrait click-to-enlarge. Boots via ?test=1&assets=1
// so the StatusPanel portrait actually composites and the enlarge modal
// mounts a 400x560 SVG.

import { test, expect } from './_fixtures'

const ASSET_DRAIN_TIMEOUT_MS = 30_000
const DOM_COMMIT_TIMEOUT_MS = 10_000
const ESC_COMMIT_TIMEOUT_MS = 5_000

const SMALL_PORTRAIT_W = 96
const SMALL_PORTRAIT_H = 128
const ENLARGED_PORTRAIT_W = 400
const ENLARGED_PORTRAIT_H = 560

const REQUIRED_HANDLES = [
  'uclifeUI.getState',
  '__uclife__.awaitAssetsReady',
]

test('portrait click-to-enlarge → ESC closes', async ({ sim }) => {
  await sim.boot({ params: { assets: 1 }, requireHandles: REQUIRED_HANDLES })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().setStatus(true))
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (t) => (window as any).__uclife__.awaitAssetsReady({ timeoutMs: t }),
    ASSET_DRAIN_TIMEOUT_MS,
  )
  await sim.page.waitForFunction(
    () => !!document.querySelector('svg[class^="art"]'),
    null,
    { timeout: DOM_COMMIT_TIMEOUT_MS },
  )

  const findPortraitBoxes = () => sim.page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('div'))
      .filter((d) => {
        const cs = getComputedStyle(d)
        return cs.position === 'relative' && cs.overflow === 'hidden'
          && d.querySelector('svg.art1, svg.art2, svg.art3, svg.art4, svg.art5, svg.art6, svg.art7, svg.art8, svg.art9, svg.art10')
      })
    return containers.map((c) => {
      const r = c.getBoundingClientRect()
      const cs = getComputedStyle(c)
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        cursor: cs.cursor,
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
      }
    })
  })

  const beforeClick = await findPortraitBoxes()
  const playerBox = beforeClick.find((b) => b.w === SMALL_PORTRAIT_W && b.h === SMALL_PORTRAIT_H)
  expect(
    playerBox,
    `player portrait (${SMALL_PORTRAIT_W}x${SMALL_PORTRAIT_H}) not found; got ${JSON.stringify(beforeClick)}`,
  ).toBeTruthy()
  expect(playerBox!.cursor).toBe('zoom-in')

  await sim.page.mouse.click(playerBox!.x, playerBox!.y)
  await sim.page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).uclifeUI.getState().enlargedPortrait !== null,
    null,
    { timeout: DOM_COMMIT_TIMEOUT_MS },
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (t) => (window as any).__uclife__.awaitAssetsReady({ timeoutMs: t }),
    ASSET_DRAIN_TIMEOUT_MS,
  )
  await sim.page.waitForFunction(
    ({ w, h }) => {
      const containers = Array.from(document.querySelectorAll('div'))
      return containers.some((d) => {
        if (!d.querySelector('svg[class^="art"]')) return false
        const r = d.getBoundingClientRect()
        return Math.round(r.width) === w && Math.round(r.height) === h
      })
    },
    { w: ENLARGED_PORTRAIT_W, h: ENLARGED_PORTRAIT_H },
    { timeout: DOM_COMMIT_TIMEOUT_MS },
  )

  const afterClick = await findPortraitBoxes()
  const enlarged = afterClick.find((b) => b.w === ENLARGED_PORTRAIT_W && b.h === ENLARGED_PORTRAIT_H)
  expect(enlarged, `enlarged portrait did not appear`).toBeTruthy()

  const storeAfterClick = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).uclifeUI.getState().enlargedPortrait,
  )
  expect(storeAfterClick, 'uiStore.enlargedPortrait remained null after click').not.toBeNull()

  await sim.page.keyboard.press('Escape')
  await sim.page.waitForFunction(
    ({ w, h }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).uclifeUI.getState().enlargedPortrait !== null) return false
      const containers = Array.from(document.querySelectorAll('div'))
      return !containers.some((d) => {
        if (!d.querySelector('svg[class^="art"]')) return false
        const r = d.getBoundingClientRect()
        return Math.round(r.width) === w && Math.round(r.height) === h
      })
    },
    { w: ENLARGED_PORTRAIT_W, h: ENLARGED_PORTRAIT_H },
    { timeout: ESC_COMMIT_TIMEOUT_MS },
  )
  const storeAfterEsc = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).uclifeUI.getState().enlargedPortrait,
  )
  expect(storeAfterEsc, 'Escape did not close the portrait modal').toBeNull()

  const afterEsc = await findPortraitBoxes()
  const stillEnlarged = afterEsc.find((b) => b.w === ENLARGED_PORTRAIT_W && b.h === ENLARGED_PORTRAIT_H)
  expect(stillEnlarged, 'enlarged portrait still present after Escape').toBeUndefined()
})
