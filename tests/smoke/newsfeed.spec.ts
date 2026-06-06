// Phase 7.0.A — newsfeed bar-TV channel smoke.
//
// Proves the diegetic chronicle: today's headline becomes available on its
// UC date; visiting the bar consumes it into the journal; a day spent away
// from the bar stays missed (missability); the war-day force-toast hook is
// authored but inert (no caller fires it); and the consumed journal survives
// a save/load round-trip.
//
// Drives everything through __uclife__ debug handles (deterministic-tests
// rules 1–7): no DOM assertions, no real-time waits. Day-scale advancement
// uses advanceGameDays + forceNewsfeedTick — the established force-tick pattern
// (stepping real sim time across days is millions of 16ms ticks). The forced
// tick runs the exact per-tick newsfeedSystem the prod loop drives.

import { test, expect } from './_fixtures'

/* eslint-disable @typescript-eslint/no-explicit-any */

const REQUIRED_HANDLES = [
  '__uclife__.getNewsfeedState',
  '__uclife__.forceNewsfeedTick',
  '__uclife__.fireWarDayToast',
  '__uclife__.advanceGameDays',
  '__uclife__.movePlayerTo',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]
const RELOAD_REQUIRED_HANDLES = [
  '__uclife__.getNewsfeedState',
  '__uclife__.loadGame',
]

const newsfeedState = () => (window as any).__uclife__.getNewsfeedState()

test('newsfeed: bar-TV consume, missability, war-day hook, persistence', async ({ sim }) => {
  await sim.boot({ fixture: 'newsfeed-pre-war', requireHandles: REQUIRED_HANDLES })

  // Game clock starts UC 0077.04.27; jump one day to the first authored date.
  await sim.page.evaluate(() => (window as any).__uclife__.advanceGameDays(1))

  // 1. The day's top headline is available; the player is parked away from the
  //    bar, so a tick consumes nothing.
  await sim.page.evaluate(() => (window as any).__uclife__.forceNewsfeedTick())
  let st = await sim.page.evaluate(newsfeedState)
  expect(st.currentDateKey, 'clock should be on UC 0077.04.28').toBe('UC 0077.04.28')
  expect(st.todayTopHeadlineId, 'UC 0077.04.28 should surface vb-dome-maintenance as top headline')
    .toBe('vb-dome-maintenance')
  expect(st.journal.length, 'nothing should be consumed before visiting the bar').toBe(0)
  expect(st.barCounterTile, 'vonBraunCity must have a bar counter landmark').toBeTruthy()

  const counter = st.barCounterTile as { x: number; y: number }

  // 2. Walk the player to the bar counter → a tick consumes the headline into
  //    the journal (passive, co-location).
  await sim.page.evaluate((c: any) => (window as any).__uclife__.movePlayerTo(c.x, c.y), counter)
  await sim.page.evaluate(() => (window as any).__uclife__.forceNewsfeedTick())
  st = await sim.page.evaluate(newsfeedState)
  expect(
    st.journal.some((j: any) => j.id === 'vb-dome-maintenance'),
    'headline should be consumed when co-located with the bar counter',
  ).toBe(true)

  // 3. Leave the bar; advance past the next authored day (UC 0077.04.29)
  //    without returning → that day's headline stays missed.
  await sim.page.evaluate(() => (window as any).__uclife__.movePlayerTo(8, 36))
  await sim.page.evaluate(() => (window as any).__uclife__.advanceGameDays(1))
  await sim.page.evaluate(() => (window as any).__uclife__.forceNewsfeedTick())
  st = await sim.page.evaluate(newsfeedState)
  expect(st.currentDateKey, 'clock should be on UC 0077.04.29').toBe('UC 0077.04.29')
  expect(st.todayTopHeadlineId, 'UC 0077.04.29 should surface zeon-autonomy-petition')
    .toBe('zeon-autonomy-petition')
  expect(
    st.journal.some((j: any) => j.id === 'zeon-autonomy-petition'),
    'a day spent away from the bar must NOT be recorded (missability)',
  ).toBe(false)

  // 4. War-day force-toast hook: authored but inert (no caller fires it).
  expect(st.warDayToastFired, 'war-day toast must not fire without a caller (inert in 7.0.A)').toBe(false)
  const hookExists = await sim.page.evaluate(
    () => typeof (window as any).__uclife__.fireWarDayToast === 'function',
  )
  expect(hookExists, 'war-day force-toast hook entry point must exist').toBe(true)

  // 5. Save → reload → load → the consumed journal persists.
  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame(1) })
  await sim.page.reload({ waitUntil: 'domcontentloaded' })
  await sim.waitForBoot(RELOAD_REQUIRED_HANDLES)
  await sim.page.evaluate(async () => { await (window as any).__uclife__.loadGame(1) })

  st = await sim.page.evaluate(newsfeedState)
  expect(
    st.journal.some((j: any) => j.id === 'vb-dome-maintenance'),
    'consumed headline must persist across save/load',
  ).toBe(true)
})
