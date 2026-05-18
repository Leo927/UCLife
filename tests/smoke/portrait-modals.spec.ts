// Renderer-pixel: portrait modals. Boots via ?test=1&assets=1 so every
// conversation surface composites its portrait through the real pipeline.
// Uses window.uclifePinClerk(specId) to pin an NPC to the target
// workstation in `working` state.

import { test, expect } from './_fixtures'

const ASSET_DRAIN_TIMEOUT_MS = 30_000
const DOM_COMMIT_TIMEOUT_MS = 10_000
const CLERK_SPEC_IDS = ['city_hr_clerk', 'realtor', 'ae_director']

const REQUIRED_HANDLES = [
  '__uclife__.fillJobVacancies',
  '__uclife__.awaitAssetsReady',
  'uclifePinClerk',
]

test('portrait modals render contained portraits for status + HR + realtor + AE', async ({ sim }) => {
  await sim.boot({ params: { assets: 1 }, requireHandles: REQUIRED_HANDLES })

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ids) => (window as any).__uclife__.fillJobVacancies(ids),
    CLERK_SPEC_IDS,
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (t) => (window as any).__uclife__.awaitAssetsReady({ timeoutMs: t }),
    ASSET_DRAIN_TIMEOUT_MS,
  )

  const probe = () => sim.page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('div'))
      .filter((d) => {
        const cs = getComputedStyle(d)
        return cs.position === 'relative' && cs.overflow === 'hidden'
          && d.querySelector('svg.art1, svg.art2, svg.art3, svg.art4, svg.art5, svg.art6, svg.art7, svg.art8, svg.art9, svg.art10')
      })
    const out: Array<{
      box: { w: number; h: number }
      svgCount: number
      svgBox: { w: number; h: number } | null
      overflow: boolean
    }> = []
    for (const c of containers) {
      const cb = c.getBoundingClientRect()
      const svgs = Array.from(c.querySelectorAll('svg'))
      out.push({
        box: { w: Math.round(cb.width), h: Math.round(cb.height) },
        svgCount: svgs.length,
        svgBox: svgs[0]
          ? (() => { const r = svgs[0].getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })()
          : null,
        overflow: svgs.some((s) => {
          const r = s.getBoundingClientRect()
          return r.right - cb.right > 5 || cb.left - r.left > 5 || r.bottom - cb.bottom > 5 || cb.top - r.top > 5
        }),
      })
    }
    return out
  })

  const openClerkDialogPinned = (specId: string) => sim.page.evaluate(({ specId }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const npc = w.uclifePinClerk?.(specId) ?? null
    if (!npc) return false
    w.uclifeUI.getState().setDialogNPC(npc)
    return true
  }, { specId })

  const runSurface = async (name: string, open: () => Promise<boolean>) => {
    const ok = await open()
    expect(ok, `fixture failed for ${name}`).toBeTruthy()
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
    const stats = await probe()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sim.page.evaluate(() => (window as any).uclifeUI.getState().setDialogNPC(null))
    await sim.page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).uclifeUI.getState().dialogNPC === null
        && !document.querySelector('svg[class^="art"]'),
      null,
      { timeout: DOM_COMMIT_TIMEOUT_MS },
    )
    return stats
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: Record<string, any[]> = {}

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
  results.status = await probe()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().setStatus(false))
  await sim.page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).uclifeUI.getState().statusOpen === false
      && !document.querySelector('svg[class^="art"]'),
    null,
    { timeout: DOM_COMMIT_TIMEOUT_MS },
  )

  results.hr = await runSurface('hr', () => openClerkDialogPinned('city_hr_clerk'))
  results.realtor = await runSurface('realtor', () => openClerkDialogPinned('realtor'))
  results.ae = await runSurface('ae', () => openClerkDialogPinned('ae_director'))

  const surfaces = ['status', 'hr', 'realtor', 'ae']
  for (const s of surfaces) {
    const r = results[s] ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const found = r.find((c: any) => c.svgCount > 0 && !c.overflow)
    expect(found, `${s} portrait container has no contained svg`).toBeTruthy()
  }
})
