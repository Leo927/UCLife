// W3 (ms-identity) Task 3 smoke — MS vernier boost (KeyF).
//
// Walks the real cockpit input path: board, take helm, enter combat, launch
// the MS, hold real KeyW to build up speed, then trigger boost with a real
// KeyF press and assert:
//   1. Speed rises past the un-boosted topSpeed cap while boost is active.
//   2. Propellant is debited by exactly the frame's boost.propellantCost.
//   3. An immediate re-trigger is blocked by the cooldown (no further debit).
//   4. Once the cooldown clears, boost re-triggers (debits propellant again).
//
// Reuses the `ms-sortie` fixture (gm_pre MS pinned at 'ms-player-0', aboard
// the flagship at Von Braun) — same baseline other MS-sortie smokes use.
// gm_pre's authored stats (ms-classes.json5): topSpeed 180, accel 220,
// boost { speedMul: 1.6, durationSec: 2.5, cooldownSec: 6, propellantCost: 20 }.
// If gm_pre's balance changes, update the three GM_PRE_* constants below.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.cheatMoney',
  '__uclife__.cheatPiloting',
  '__uclife__.boardShip',
  '__uclife__.takeHelmCheat',
  '__uclife__.listEnemies',
  '__uclife__.startCombatCheat',
  '__uclife__.useCombatStore',
  '__uclife__.useScene',
  '__uclife__.useCockpit',
  '__uclife__.launchPlayerMs',
  '__uclife__.getPilotedMsState',
  '__uclife__.getMs',
]

const STEP_BUDGET_MIN = 60
const ROSTER_MS_KEY = 'ms-player-0'   // ms-sortie fixture's pinned starter key
const GM_PRE_TOP_SPEED = 180
const GM_PRE_BOOST_PROPELLANT_COST = 20

test('ms-boost: KeyF raises speed, drains propellant, cooldown blocks re-trigger', async ({ sim }) => {
  await sim.boot({ fixture: 'ms-sortie', requireHandles: REQUIRED_HANDLES })

  const setupOk = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = (window as any).__uclife__
    return u.cheatMoney(80000) && u.cheatPiloting(10)
  })
  expect(setupOk, 'cheatMoney+cheatPiloting setup').toBeTruthy()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.boardShip())
  await sim.stepUntil(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.useScene.getState().activeId === 'playerShipInterior',
    STEP_BUDGET_MIN,
  )

  const helmRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.takeHelmCheat(),
  )
  expect(helmRes?.ok, `takeHelmCheat: ${JSON.stringify(helmRes)}`).toBe(true)

  const enemies = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listEnemies(),
  )
  expect(enemies && enemies.length > 0, 'spaceCampaign should have enemies for startCombatCheat').toBeTruthy()

  await sim.page.evaluate((key) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.startCombatCheat('pirateLight', [], key)
  }, enemies[0].key)

  await sim.stepUntil(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.useCombatStore.getState().open === true,
    STEP_BUDGET_MIN,
  )

  // Combat opens auto-paused on first contact — unpause so the tactical
  // physics tick actually advances while we drive real input below.
  await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cs = (window as any).__uclife__.useCombatStore.getState()
    if (cs.paused) cs.togglePause()
  })

  const launchRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.launchPlayerMs(),
  )
  expect(launchRes?.ok, `launchPlayerMs: ${JSON.stringify(launchRes)}`).toBe(true)
  await sim.stepUntil(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.useCockpit.getState().piloting === 'ms',
    STEP_BUDGET_MIN,
  )

  // ── Let the launch-kick velocity decay to ~0 before measuring ──────────
  await sim.stepUntil(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (window as any).__uclife__.getPilotedMsState()
    return !!s && Math.hypot(s.vel.x, s.vel.y) < 5
  }, STEP_BUDGET_MIN)

  // ── 1. Hold real KeyW, confirm thrust works (speed rises under the
  //      un-boosted cap) before boost enters the picture ──────────────────
  await sim.page.keyboard.down('KeyW')
  await sim.stepUntil(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (window as any).__uclife__.getPilotedMsState()
    return !!s && Math.hypot(s.vel.x, s.vel.y) >= 150
  }, STEP_BUDGET_MIN)
  const speedNoBoost = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (window as any).__uclife__.getPilotedMsState()
    return Math.hypot(s.vel.x, s.vel.y)
  })
  expect(speedNoBoost, "un-boosted speed must stay under gm_pre's topSpeed cap").toBeLessThan(GM_PRE_TOP_SPEED)

  // ── 2. Trigger boost via real KeyF while still holding forward thrust ──
  const propellantBefore = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key) => (window as any).__uclife__.getMs(key)!.currentPropellant,
    ROSTER_MS_KEY,
  )
  await sim.page.keyboard.press('KeyF')

  await sim.stepUntil(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (window as any).__uclife__.getPilotedMsState()
    // Above the un-boosted topSpeed cap — only reachable with boost active.
    return !!s && Math.hypot(s.vel.x, s.vel.y) >= 200
  }, STEP_BUDGET_MIN)
  const speedBoosted = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (window as any).__uclife__.getPilotedMsState()
    return Math.hypot(s.vel.x, s.vel.y)
  })
  expect(speedBoosted, 'boost must raise speed above the un-boosted topSpeed cap').toBeGreaterThan(GM_PRE_TOP_SPEED)

  const propellantAfterBoost = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key) => (window as any).__uclife__.getMs(key)!.currentPropellant,
    ROSTER_MS_KEY,
  )
  expect(
    propellantBefore - propellantAfterBoost,
    "boost must debit exactly gm_pre's boost.propellantCost",
  ).toBe(GM_PRE_BOOST_PROPELLANT_COST)

  // ── 3. Cooldown blocks an immediate re-trigger — no further debit ──────
  await sim.page.keyboard.press('KeyF')
  const propellantAfterRetrigger = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key) => (window as any).__uclife__.getMs(key)!.currentPropellant,
    ROSTER_MS_KEY,
  )
  expect(
    propellantAfterRetrigger,
    'a blocked re-trigger while on cooldown must not debit propellant again',
  ).toBe(propellantAfterBoost)

  await sim.page.keyboard.up('KeyW')

  // ── 4. Once the cooldown clears, boost re-triggers (debits again) ─────
  await sim.stepUntil(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (window as any).__uclife__.getPilotedMsState()
    return !!s && s.boostCooldownSec <= 0
  }, STEP_BUDGET_MIN)

  await sim.page.keyboard.press('KeyF')
  const propellantAfterSecondBoost = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key) => (window as any).__uclife__.getMs(key)!.currentPropellant,
    ROSTER_MS_KEY,
  )
  expect(
    propellantAfterRetrigger - propellantAfterSecondBoost,
    'once the cooldown clears, boost must re-trigger and debit propellant again',
  ).toBe(GM_PRE_BOOST_PROPELLANT_COST)
})
