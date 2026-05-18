// Renderer-pixel: LPC sprite tester. Boots via ?test=1&assets=1 so
// composeSheet actually fetches LPC layers + recolors them.

import { test, expect } from './_fixtures'

const ASSET_DRAIN_TIMEOUT_MS = 30_000
const CANVAS_TIMEOUT_MS = 10_000

const SHEET_W = 832
const SHEET_H = 256
const MIN_OPAQUE_PIXELS = 1000
const TESTER_OVERLAY_Z_INDEX = '9999'

const REQUIRED_HANDLES = [
  'uclifeSpriteTester',
  '__uclife__.awaitAssetsReady',
]

test('LPC sprite tester: composeSheet output 832x256, opaque pixels, /lpc/ requests', async ({ sim }) => {
  await sim.boot({ params: { assets: 1 }, requireHandles: REQUIRED_HANDLES })

  const lpcRequests: Array<{ url: string; status: number }> = []
  sim.page.on('response', (r) => {
    const u = r.url()
    if (u.includes('/lpc/')) lpcRequests.push({ url: u, status: r.status() })
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeSpriteTester())
  await sim.page.waitForSelector(
    `div[style*="z-index: ${TESTER_OVERLAY_Z_INDEX}"] canvas`,
    { timeout: CANVAS_TIMEOUT_MS },
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (t) => (window as any).__uclife__.awaitAssetsReady({ timeoutMs: t }),
    ASSET_DRAIN_TIMEOUT_MS,
  )

  await sim.page.fill(
    `div[style*="z-index: ${TESTER_OVERLAY_Z_INDEX}"] input[type=text]`,
    'Wei Tanaka',
  )
  const genderSelect = sim.page
    .locator(`div[style*="z-index: ${TESTER_OVERLAY_Z_INDEX}"] label`)
    .filter({ hasText: 'gender:' })
    .locator('select')
  await genderSelect.selectOption('male')
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (t) => (window as any).__uclife__.awaitAssetsReady({ timeoutMs: t }),
    ASSET_DRAIN_TIMEOUT_MS,
  )

  const stats = await sim.page.evaluate((zIndex) => {
    const overlay = Array.from(document.querySelectorAll('div')).find(
      (d) => getComputedStyle(d).zIndex === zIndex,
    )
    const canvas = overlay?.querySelector('canvas')
    if (!canvas) return { found: false }
    const ctx = canvas.getContext('2d')
    if (!ctx) return { found: true, ctx: false }
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let opaque = 0
    for (let i = 3; i < img.length; i += 4) {
      if (img[i] > 0) opaque++
    }
    return {
      found: true,
      ctx: true,
      width: canvas.width,
      height: canvas.height,
      opaquePixels: opaque,
      totalPixels: img.length / 4,
    }
  }, TESTER_OVERLAY_Z_INDEX)

  expect(stats.found, 'no canvas found in sprite tester overlay').toBeTruthy()
  expect(stats.ctx, 'canvas has no 2D context').toBeTruthy()
  expect(stats.width, `expected ${SHEET_W}x${SHEET_H} sheet`).toBe(SHEET_W)
  expect(stats.height, `expected ${SHEET_W}x${SHEET_H} sheet`).toBe(SHEET_H)
  expect(stats.opaquePixels, `only ${stats.opaquePixels} opaque pixels`).toBeGreaterThanOrEqual(MIN_OPAQUE_PIXELS)

  expect(lpcRequests.length, 'no /lpc/ requests captured').toBeGreaterThan(0)
  const failCount = lpcRequests.filter((r) => r.status !== 200).length
  expect(failCount, `${failCount} sprite requests returned non-200`).toBe(0)
})
