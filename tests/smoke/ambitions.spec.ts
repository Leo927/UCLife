// Deterministic ambitions smoke. Boots via ?test=1, drives the ambitions
// slot + stage tick + save/reload round-trip through the debug handle.
//
// Coverage:
//   1. No panel auto-opens at start.
//   2. pickAmbitions(['mw_pilot', 'lazlos_owner']) seats the slots.
//   3. After raising reflex+athletics and one game-day tick, mw_pilot
//      promotes from stage 0 → stage 1, the Character.title updates,
//      and the stage event lands in the event log.
//   4. The ambitions panel renders the new title.
//   5. Save → reload (same ?test=1 URL) → load preserves the slot.

import { test, expect, DOM_COMMIT_TIMEOUT_MS } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getAmbitions',
  '__uclife__.pickAmbitions',
  '__uclife__.setPlayerStat',
  '__uclife__.runAmbitionsTick',
  '__uclife__.getEventLog',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]

const RELOAD_REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getAmbitions',
  '__uclife__.loadGame',
]

const EXPECTED_TITLE = '机工预备生'

test('ambitions stage promotion + save round-trip', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  // 1. Panel must NOT auto-open at start; player should have a default ambition slot.
  const overlayCount = await sim.page.locator('.status-overlay').count()
  expect(overlayCount, `no overlay should auto-open at start; got ${overlayCount}`).toBe(0)

  const initial = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getAmbitions(),
  )
  expect(
    initial?.active?.length > 0,
    `player should boot with a pre-seeded ambition slot; got ${JSON.stringify(initial)}`,
  ).toBeTruthy()

  // 2. Replace placeholder with mw_pilot + lazlos_owner.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.pickAmbitions(['mw_pilot', 'lazlos_owner']),
  )

  // 3. Mutate stats so mw_pilot stage 1 thresholds clear, advance one game-
  //    day via the bespoke verb (clock-only mutation), then force one
  //    ambitions tick.
  await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = (window as any).__uclife__
    u.setPlayerStat('attributes.reflex', 35)
    u.setPlayerStat('skills.athletics', 600)
  })
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.advanceGameDays(1),
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.runAmbitionsTick(),
  )

  const after = await sim.page.evaluate(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    amb: (window as any).__uclife__.getAmbitions(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    log: (window as any).__uclife__.getEventLog(),
  }))
  expect(
    after.amb?.title,
    `Character.title should be "${EXPECTED_TITLE}" after stage 1 promotion; got "${after.amb?.title}"`,
  ).toBe(EXPECTED_TITLE)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mwSlot = after.amb?.active?.find((s: any) => s.id === 'mw_pilot')
  expect(mwSlot, 'mw_pilot slot missing from active list').toBeTruthy()
  expect(
    mwSlot.currentStage,
    `mw_pilot.currentStage should be 1 after threshold clear; got ${mwSlot.currentStage}`,
  ).toBe(1)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stageLog = after.log.find((e: any) => e.textZh.includes('体检合格'))
  expect(stageLog, 'expected stage-1 "体检合格" log line not found in event log').toBeTruthy()

  // 4. Open panel manually, verify title rendering.
  await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).uclifeUI.getState().setAmbitions(true)
  })
  await sim.page.waitForSelector('.status-panel', { timeout: DOM_COMMIT_TIMEOUT_MS })

  let titleEl = await sim.page.locator('[data-player-title]').first().textContent().catch(() => null)
  if (!titleEl || !titleEl.includes(EXPECTED_TITLE)) {
    await sim.page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ui = (window as any).uclifeUI.getState()
      ui.setAmbitions(false)
      ui.setStatus(true)
    })
    await sim.page.waitForSelector('.status-panel [data-player-title]', { timeout: DOM_COMMIT_TIMEOUT_MS })
    titleEl = await sim.page.locator('[data-player-title]').first().textContent().catch(() => null)
  }
  expect(
    titleEl && titleEl.includes(EXPECTED_TITLE),
    `StatusPanel [data-player-title] should contain "${EXPECTED_TITLE}"; got "${titleEl}"`,
  ).toBeTruthy()
  await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ui = (window as any).uclifeUI.getState()
    ui.setStatus(false)
    ui.setAmbitions(false)
  })

  // 5. Save → reload (still ?test=1) → load → assert persistence.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async () => { await (window as any).__uclife__.saveGame(1) },
  )

  await sim.page.reload({ waitUntil: 'domcontentloaded' })
  await sim.waitForBoot(RELOAD_REQUIRED_HANDLES)

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async () => { await (window as any).__uclife__.loadGame(1) },
  )

  const restored = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getAmbitions(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mwSlot2 = restored?.active?.find((s: any) => s.id === 'mw_pilot')
  expect(mwSlot2, 'after load, mw_pilot slot missing from active list').toBeTruthy()
  expect(
    mwSlot2.currentStage,
    `after load, mw_pilot.currentStage should be 1; got ${mwSlot2.currentStage}`,
  ).toBe(1)
  expect(
    restored?.title,
    `after load, Character.title should be "${EXPECTED_TITLE}"; got "${restored?.title}"`,
  ).toBe(EXPECTED_TITLE)
})
