// Renderer-pixel: portrait composite. Boots via ?test=1&assets=1 so
// portrait cache + SvgQueue actually run; awaitAssetsReady() drains each
// preset switch deterministically.

import { test, expect } from './_fixtures'

const ASSET_DRAIN_TIMEOUT_MS = 30_000
// First portrait render fetches hundreds of fc-pregmod SVGs through a COLD
// ephemeral Vite (ci-local spawns a fresh server per run; nothing else in
// the suite touches these assets, so no pass pre-warms them). The transform
// storm alone can exceed a DOM-commit budget — this is a cold-asset budget,
// not a DOM-commit one (observed 15s flaking 2/2 serial runs on 2026-07-06
// while every warmed run passes in <3s).
const COLD_ASSET_TIMEOUT_MS = 45_000
const PRESETS = ['default-female', 'default-male', 'preg', 'punk']
const MIN_SVG_DIM_PX = 50

const REQUIRED_HANDLES = [
  'uclifePortraitTester',
  '__uclife__.awaitAssetsReady',
]

test('portrait composite: art layers + CSS, contained, walks PRESETS', async ({ sim }) => {
  await sim.boot({ params: { assets: 1 }, requireHandles: REQUIRED_HANDLES })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifePortraitTester())
  await sim.page.waitForSelector('svg[class^="art"]', { timeout: COLD_ASSET_TIMEOUT_MS })
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (t) => (window as any).__uclife__.awaitAssetsReady({ timeoutMs: t }),
    ASSET_DRAIN_TIMEOUT_MS,
  )

  const stats = await sim.page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('div'))
      .filter((d) => {
        const cs = getComputedStyle(d)
        return cs.position === 'relative' && cs.overflow === 'hidden' && d.querySelector('svg')
      })
    const out: Array<{
      box: { w: number; h: number }
      svgCount: number
      styleCount: number
      svgBoxes: Array<{ w: number; h: number; top: number; left: number }>
      anyOverflowing: boolean
    }> = []
    for (const c of containers) {
      const cb = c.getBoundingClientRect()
      const svgs = Array.from(c.querySelectorAll('svg'))
      const styleEls = Array.from(c.querySelectorAll('style'))
      out.push({
        box: { w: Math.round(cb.width), h: Math.round(cb.height) },
        svgCount: svgs.length,
        styleCount: styleEls.length,
        svgBoxes: svgs.slice(0, 3).map((s) => {
          const r = s.getBoundingClientRect()
          return {
            w: Math.round(r.width),
            h: Math.round(r.height),
            top: Math.round(r.top - cb.top),
            left: Math.round(r.left - cb.left),
          }
        }),
        anyOverflowing: svgs.some((s) => {
          const r = s.getBoundingClientRect()
          return r.right - cb.right > 5 || cb.left - r.left > 5 || r.bottom - cb.bottom > 5 || cb.top - r.top > 5
        }),
      })
    }
    return out
  })

  for (const p of PRESETS) {
    await sim.page.locator('label').filter({ hasText: p }).click({ force: true })
    await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t) => (window as any).__uclife__.awaitAssetsReady({ timeoutMs: t }),
      ASSET_DRAIN_TIMEOUT_MS,
    )
  }

  const renderedContainer = stats.find((c) => c.svgCount > 0)
  expect(renderedContainer, 'no portrait container with an svg child found').toBeTruthy()
  expect(renderedContainer!.svgCount).toBeGreaterThanOrEqual(1)
  expect(renderedContainer!.styleCount).toBeGreaterThanOrEqual(1)
  const firstSvg = renderedContainer!.svgBoxes[0]
  expect(firstSvg, 'first svg bounding box missing').toBeTruthy()
  expect(
    firstSvg.w > MIN_SVG_DIM_PX && firstSvg.h > MIN_SVG_DIM_PX,
    `first svg too small (${firstSvg.w}x${firstSvg.h}, want >${MIN_SVG_DIM_PX}px each side)`,
  ).toBeTruthy()
  expect(renderedContainer!.anyOverflowing, 'svg overflowed its container').toBe(false)
})
