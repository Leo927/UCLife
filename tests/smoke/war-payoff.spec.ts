// Phase 7.0.D — warPayoff resolution smoke.
//
// Proves the prologue payoff: when the war fires (UC 0079.01.03), every active
// ambition's long-inert warPayoff route resolves (log + unlock flags + AP),
// the MOST-PROGRESSED active ambition claims the title spotlight while a
// lesser one resolves without it, the wartime-ambition tier unlocks (gated on
// IsWartime), pre-war perks survive the flip, and the resolved-payoff state +
// wartime unlock persist across a save/load round-trip.
//
// Drives everything through __uclife__ debug handles (deterministic-tests
// rules 1–7): no DOM assertions, no real-time waits. The clock is jumped with
// setGameDate; the transition is driven by forceWarTransitionTick, which flips
// IsWartime and emits war:transition → the warPayoff binding resolves.

import { test, expect } from './_fixtures'

/* eslint-disable @typescript-eslint/no-explicit-any */

const REQUIRED_HANDLES = [
  '__uclife__.getWarState',
  '__uclife__.forceWarTransitionTick',
  '__uclife__.setGameDate',
  '__uclife__.getWarPayoffState',
  '__uclife__.getAmbitions',
  '__uclife__.getFlags',
  '__uclife__.getEventLog',
  '__uclife__.grantAp',
  '__uclife__.purchasePerk',
  '__uclife__.pickAmbitionsAt',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]
const RELOAD_REQUIRED_HANDLES = [
  '__uclife__.getWarState',
  '__uclife__.getWarPayoffState',
  '__uclife__.getAmbitions',
  '__uclife__.loadGame',
]

// Authored copy from src/character/ambitions.json5 warPayoffRoutes — the
// headline (mw_pilot, most-progressed) route's title + log.
const MW_PILOT_WAR_TITLE = '机动工兵·战时征召'
const MW_PILOT_WAR_LOG = '战争来了。你的训练有了去处——一份盖着联邦印章的征召令递到手上。'
const PERK_ID = 'iron_stomach'

const warState = () => (window as any).__uclife__.getWarState()
const warPayoffState = () => (window as any).__uclife__.getWarPayoffState()
const ambitionsState = () => (window as any).__uclife__.getAmbitions()
const flagsState = () => (window as any).__uclife__.getFlags()

test('war-payoff: routes resolve, most-progressed headlines, perks survive, persists', async ({ sim }) => {
  await sim.boot({ fixture: 'war-payoff', requireHandles: REQUIRED_HANDLES })

  // Grant AP + buy a personal perk (the "pre-war perk" that must survive the
  // flip), then seed two active ambitions: mw_pilot mid-arc (most-progressed)
  // and lazlos_owner at stage 0 (the lesser one).
  const buy = await sim.page.evaluate((perk: string) => {
    ;(window as any).__uclife__.grantAp(3)
    return (window as any).__uclife__.purchasePerk(perk)
  }, PERK_ID)
  expect(buy.ok, `purchasePerk failed: ${JSON.stringify(buy)}`).toBe(true)

  await sim.page.evaluate(() => (window as any).__uclife__.pickAmbitionsAt([
    { id: 'mw_pilot', currentStage: 4 },
    { id: 'lazlos_owner', currentStage: 0 },
  ]))

  // Pre-war baseline.
  let amb = await sim.page.evaluate(ambitionsState)
  const apBefore = amb.apBalance
  expect(amb.perks, 'perk granted pre-war').toContain(PERK_ID)

  let wp = await sim.page.evaluate(warPayoffState)
  expect(wp.warPayoffResolved, 'warPayoff not resolved pre-war').toBe(false)
  for (const id of wp.wartimeAmbitionIds) {
    expect(wp.offeredAmbitionIds, `${id} hidden pre-war`).not.toContain(id)
  }
  let flags = await sim.page.evaluate(flagsState)
  expect(flags.war_route_mw_pilot, 'no war route flag pre-war').toBeFalsy()

  // Cross the war transition → IsWartime flips and war:transition fires, which
  // resolves the warPayoff routes via the binding.
  await sim.page.evaluate(() => (window as any).__uclife__.setGameDate('UC 0079.01.03'))
  const tick = await sim.page.evaluate(() => (window as any).__uclife__.forceWarTransitionTick())
  expect(tick.flipped, 'war flips on the trigger date').toBe(true)

  // 1. Each active ambition's warPayoff resolved: both unlock flags set, AP
  //    credited, and the headline log line posted.
  flags = await sim.page.evaluate(flagsState)
  expect(flags.war_route_mw_pilot, 'mw_pilot route resolved').toBe(true)
  expect(flags.war_route_bar_owner, 'lazlos_owner route resolved').toBe(true)

  amb = await sim.page.evaluate(ambitionsState)
  expect(amb.apBalance, 'AP credited by the warPayoff routes').toBeGreaterThan(apBefore)

  const log = await sim.page.evaluate(() => (window as any).__uclife__.getEventLog())
  expect(log.some((e: any) => e.textZh === MW_PILOT_WAR_LOG), 'headline route log posted').toBe(true)

  // 2. Most-progressed (mw_pilot) claims the title spotlight; the lesser one
  //    (lazlos_owner) resolved without overriding the title.
  expect(amb.title, 'headline title = most-progressed ambition route').toBe(MW_PILOT_WAR_TITLE)

  // 3. The wartime-ambition tier is unlocked (gated on IsWartime).
  wp = await sim.page.evaluate(warPayoffState)
  expect(wp.warPayoffResolved, 'warPayoff resolved latch set').toBe(true)
  for (const id of wp.wartimeAmbitionIds) {
    expect(wp.offeredAmbitionIds, `${id} unlocked in wartime`).toContain(id)
  }

  // 4. The pre-war perk survives the flip (no strip / re-seed).
  expect(amb.perks, 'perk survives the transition').toContain(PERK_ID)

  // Idempotency: re-ticking does not re-credit AP (the latch + the IsWartime
  // guard both hold).
  const apAfter = amb.apBalance
  await sim.page.evaluate(() => (window as any).__uclife__.forceWarTransitionTick())
  amb = await sim.page.evaluate(ambitionsState)
  expect(amb.apBalance, 'no double-credit on re-tick').toBe(apAfter)

  // 5. Save → reload → load → resolved-payoff state + wartime unlock + perks
  //    + headline title persist.
  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame(1) })
  await sim.page.reload({ waitUntil: 'domcontentloaded' })
  await sim.waitForBoot(RELOAD_REQUIRED_HANDLES)
  const loadResult = await sim.page.evaluate(async () => (window as any).__uclife__.loadGame(1))
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)

  wp = await sim.page.evaluate(warPayoffState)
  expect(wp.warPayoffResolved, 'resolved latch survives save/load').toBe(true)
  for (const id of wp.wartimeAmbitionIds) {
    expect(wp.offeredAmbitionIds, `${id} still unlocked after load`).toContain(id)
  }
  amb = await sim.page.evaluate(ambitionsState)
  expect(amb.apBalance, 'credited AP survives save/load').toBe(apAfter)
  expect(amb.title, 'headline title survives save/load').toBe(MW_PILOT_WAR_TITLE)
  expect(amb.perks, 'perk survives save/load').toContain(PERK_ID)
})
