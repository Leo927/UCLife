// Map + flight-modal contents only — the actual scene-swap round-trip
// is exercised by check-scene-swap.

import { test, expect, DOM_COMMIT_TIMEOUT_MS } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  'uclifeUI.getState',
]

test('flight modal contents at VB + Zum City airports', async ({ sim }) => {
  await sim.page.setViewportSize({ width: 1280, height: 720 })
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().setMap(true))
  await sim.page.waitForSelector('.map-place-name', { timeout: DOM_COMMIT_TIMEOUT_MS })

  const mapNames = await sim.page.evaluate(() =>
    Array.from(document.querySelectorAll('.map-place-name')).map((e) => e.textContent),
  )

  const expectedDistricts = ['冯·布劳恩中心区', 'AE 工业区']
  for (const d of expectedDistricts) {
    expect(
      mapNames.includes(d),
      `vonBraunCity map should expose district "${d}"; got ${JSON.stringify(mapNames)}`,
    ).toBeTruthy()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().setMap(false))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().openFlight('vonBraunCityAirport'))
  await sim.page.waitForSelector('.transit-terminal-row', { timeout: DOM_COMMIT_TIMEOUT_MS })

  const startModal = await sim.page.evaluate(() => {
    const headerH2 = document.querySelector('.status-panel .status-header h2')?.textContent ?? null
    const rows = Array.from(document.querySelectorAll('.transit-terminal-row')).map((r) => ({
      name: r.querySelector('.transit-terminal-name')?.textContent ?? null,
      desc: Array.from(r.querySelectorAll('.transit-terminal-desc')).map((e) => e.textContent),
      btn: r.querySelector('.transit-terminal-go')?.textContent ?? null,
      disabled: (r.querySelector('.transit-terminal-go') as HTMLButtonElement | null)?.disabled ?? null,
    }))
    return { headerH2, rows }
  })

  expect(startModal.headerH2).toBe('售票处 · 冯·布劳恩航天港')
  expect(startModal.rows.length).toBe(1)
  expect(startModal.rows[0].name).toBe('祖姆市航天港')
  expect(
    startModal.rows[0].desc.some((d) => d?.includes('航程 6 小时') && d.includes('¥800')),
    `Von Braun row desc missing fare info; got ${JSON.stringify(startModal.rows[0].desc)}`,
  ).toBeTruthy()
  expect(startModal.rows[0].disabled).toBe(true)
  expect(startModal.rows[0].btn).toBe('钱不够')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().closeFlight())
  await sim.page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).uclifeUI.getState().flightHubId === null,
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().openFlight('zumCityAirport'))
  await sim.page.waitForSelector('.transit-terminal-row', { timeout: DOM_COMMIT_TIMEOUT_MS })

  const zumModal = await sim.page.evaluate(() => {
    const headerH2 = document.querySelector('.status-panel .status-header h2')?.textContent ?? null
    const rows = Array.from(document.querySelectorAll('.transit-terminal-row')).map((r) => ({
      name: r.querySelector('.transit-terminal-name')?.textContent ?? null,
      btn: r.querySelector('.transit-terminal-go')?.textContent ?? null,
    }))
    return { headerH2, rows }
  })

  expect(zumModal.headerH2).toBe('售票处 · 祖姆市航天港')
  expect(zumModal.rows.length).toBe(1)
  expect(zumModal.rows[0].name).toBe('冯·布劳恩航天港')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().closeFlight())
})
