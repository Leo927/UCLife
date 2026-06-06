// Phase 7.0.B — war-transition trigger + strategic-war model smoke.
//
// Proves the structural pivot: the IsWartime gate flips exactly once when the
// clock crosses UC 0079.01.03, the war-day force-toast fires regardless of
// player location, the strategic-war model resolves date-keyed events against
// the faction-strength numbers on subsequent days, the newsfeed flips to
// wartime mode, and the whole war state survives a save/load round-trip
// (a post-flip save stays wartime).
//
// Drives everything through __uclife__ debug handles (deterministic-tests
// rules 1–7): no DOM assertions, no real-time waits. The clock is jumped with
// setGameDate (deterministic single set) and the day:rollover:settled path is
// driven by forceWarTransitionTick — the same systems the prod loop runs.

import { test, expect } from './_fixtures'

/* eslint-disable @typescript-eslint/no-explicit-any */

const REQUIRED_HANDLES = [
  '__uclife__.getWarState',
  '__uclife__.forceWarTransitionTick',
  '__uclife__.getNewsfeedState',
  '__uclife__.setGameDate',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]
const RELOAD_REQUIRED_HANDLES = [
  '__uclife__.getWarState',
  '__uclife__.loadGame',
]

const warState = () => (window as any).__uclife__.getWarState()
const setDate = (key: string) => (window as any).__uclife__.setGameDate(key)
const forceTick = () => (window as any).__uclife__.forceWarTransitionTick()

test('war-transition: flips once on UC 0079.01.03, strategic model churns, persists', async ({ sim }) => {
  await sim.boot({ fixture: 'war-transition', requireHandles: REQUIRED_HANDLES })

  // Pre-war baseline.
  let st = await sim.page.evaluate(warState)
  expect(st.isWartime, 'world starts pre-war').toBe(false)
  expect(st.newsfeedMode, 'newsfeed starts in prewar mode').toBe('prewar')

  // 1a. The day before the war — ticking must NOT flip the gate.
  await sim.page.evaluate(setDate, 'UC 0079.01.02')
  let tick = await sim.page.evaluate(forceTick)
  expect(tick.flipped, 'no flip before the trigger date').toBe(false)
  st = await sim.page.evaluate(warState)
  expect(st.isWartime, 'still pre-war on UC 0079.01.02').toBe(false)

  // 1b. Cross UC 0079.01.03 → the gate flips exactly once and the war-day
  //     toast fires even though the player is parked away from the bar.
  await sim.page.evaluate(setDate, 'UC 0079.01.03')
  tick = await sim.page.evaluate(forceTick)
  expect(tick.flipped, 'the gate flips on the trigger date').toBe(true)
  expect(tick.isWartime, 'wartime after the flip').toBe(true)

  st = await sim.page.evaluate(warState)
  expect(st.isWartime, 'IsWartime is set').toBe(true)
  expect(st.transitionDay, 'transition day recorded').toBeGreaterThan(0)

  const nf = await sim.page.evaluate(() => (window as any).__uclife__.getNewsfeedState())
  expect(nf.warDayToastFired, 'war-day force-toast fired regardless of location').toBe(true)

  // The strategic-war model is seeded and the 0079.01.03 event resolved,
  // moving a faction-strength value off its initial seed.
  const fedAfterDay1 = st.factionStrength.federation
  expect(fedAfterDay1, 'federation strength changed from the op-british event').toBeLessThan(100)
  expect(st.resolvedEventIds, 'the op-british-strike event resolved').toContain('op-british-strike')

  // Idempotency: re-ticking the same day must not re-flip or double-apply.
  tick = await sim.page.evaluate(forceTick)
  expect(tick.flipped, 're-tick does not flip again').toBe(false)
  st = await sim.page.evaluate(warState)
  expect(st.factionStrength.federation, 'strength not double-applied on re-tick').toBe(fedAfterDay1)

  // 2. Advance a day → the model keeps churning: the next date-keyed war event
  //    resolves and a faction-strength value changes again.
  await sim.page.evaluate(setDate, 'UC 0079.01.04')
  tick = await sim.page.evaluate(forceTick)
  expect(tick.resolved, 'battle-of-loum resolves on UC 0079.01.04').toContain('battle-of-loum')
  st = await sim.page.evaluate(warState)
  expect(st.factionStrength.federation, 'federation strength drops further at Loum')
    .toBeLessThan(fedAfterDay1)

  // 3. The newsfeed is in wartime mode.
  expect(st.newsfeedMode, 'newsfeed flipped to wartime mode').toBe('wartime')

  // 4. Save → reload → load → the war state (gate + model) persists. A
  //    post-flip save stays a wartime run.
  const fedFinal = st.factionStrength.federation
  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame(1) })
  await sim.page.reload({ waitUntil: 'domcontentloaded' })
  await sim.waitForBoot(RELOAD_REQUIRED_HANDLES)

  // Fresh boot is pre-war until the save loads (proves a pre-flip world is
  // pre-war, and that the flag isn't ambiently set).
  let reloaded = await sim.page.evaluate(warState)
  expect(reloaded.isWartime, 'fresh boot is pre-war before load').toBe(false)

  const loadResult = await sim.page.evaluate(
    async () => (window as any).__uclife__.loadGame(1),
  )
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)

  reloaded = await sim.page.evaluate(warState)
  expect(reloaded.isWartime, 'wartime gate survives save/load').toBe(true)
  expect(reloaded.factionStrength.federation, 'strategic-war model survives save/load')
    .toBe(fedFinal)
  expect(reloaded.resolvedEventIds, 'resolved war events survive save/load')
    .toContain('battle-of-loum')
})
