// W4 Task 7 — negotiate = clean peaceful disengage on a paid toll.
//
// Locked decision (docs/superpowers/plans/2026-07-07-w4-embodied-ship.md):
//   toll = combat.json5 negotiate.tollBase + tollPerEscort × escort count.
//   afford → toll debited off the AVATAR (never the space-world ship),
//            no tactical combat store opens, a peaceful-disengage debrief
//            beat renders with the toll line.
//   can't afford → the sim escalates to a real fight (startCombat).
//
// Reuses the real contact → engagement-modal path (not startCombatCheat) so
// the escort list the modal carries is the production one, and the toll is a
// pure config × escort-count function (deterministic).

import { test, expect, DOM_COMMIT_TIMEOUT_MS } from './_fixtures'

/* eslint-disable @typescript-eslint/no-explicit-any */

const REQUIRED_HANDLES = [
  '__uclife__.boardShip',
  '__uclife__.takeHelmCheat',
  '__uclife__.listEnemies',
  '__uclife__.moveShipTo',
  '__uclife__.tickSpace',
  '__uclife__.debugNavigate',
  '__uclife__.setInfiniteFuelSupply',
  '__uclife__.useEngagement',
  '__uclife__.getGameState',
  '__uclife__.getPlayerMoney',
  '__uclife__.cheatMoney',
]

// src/config/combat.json5 negotiate — mirrored as named constants, matching
// this suite's convention (combat-withdraw.spec.ts's FLEE_* constants).
const TOLL_BASE = 300
const TOLL_PER_ESCORT = 150

// One contact-detection tick once the ship sits exactly on the enemy is
// enough — the dt value doesn't matter for a same-frame contact/prompt check.
const CONTACT_TICK_DT_SEC = 0.1

// Board → set avatar funds while the avatar is the active-scene IsPlayer
// (playerShipInterior) → take helm → intercept → force one contact tick.
// Returns once the engagement modal is open.
async function driveToContact(sim: any, avatarMoney: number): Promise<void> {
  await sim.page.evaluate(() => (window as any).__uclife__.boardShip())
  await sim.page.waitForFunction(
    () => (window as any).__uclife__.getGameState().getScene().getId() === 'playerShipInterior',
    null, { timeout: DOM_COMMIT_TIMEOUT_MS })

  // cheatMoney sets the active-scene IsPlayer; do it here (avatar active)
  // so the toll debits/affordability read the AVATAR, not the space ship.
  await sim.page.evaluate((amt: number) => (window as any).__uclife__.cheatMoney(amt), avatarMoney)

  const helm = await sim.page.evaluate(() => (window as any).__uclife__.takeHelmCheat())
  expect(helm?.ok, `takeHelmCheat failed: ${helm?.message}`).toBe(true)
  await sim.page.waitForFunction(
    () => (window as any).__uclife__.getGameState().getScene().getId() === 'spaceCampaign',
    null, { timeout: DOM_COMMIT_TIMEOUT_MS })

  await sim.page.evaluate(() => (window as any).__uclife__.setInfiniteFuelSupply(true))

  const enemies = await sim.page.evaluate(() => (window as any).__uclife__.listEnemies())
  expect(enemies.length, 'no campaign enemies to engage').toBeGreaterThan(0)
  const target = enemies[0]

  const navRes = await sim.page.evaluate(
    (key: string) => (window as any).__uclife__.debugNavigate({ kind: 'enemy', enemyKey: key }),
    target.key)
  expect(navRes.ok, `debugNavigate({kind:'enemy'}) failed: ${navRes.message}`).toBe(true)

  await sim.page.evaluate((p: { x: number; y: number }) => (window as any).__uclife__.moveShipTo(p.x, p.y), target.pos)
  await sim.page.evaluate((dt: number) => (window as any).__uclife__.tickSpace(dt), CONTACT_TICK_DT_SEC)
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getEngagement().isOpen()),
    'contact must prompt the engagement modal').toBe(true)
}

async function readEscortCount(sim: any): Promise<number> {
  return sim.page.evaluate(
    () => (window as any).__uclife__.useEngagement.getState().enemyEscorts.length)
}

test('negotiate afford: toll debited off the avatar, no combat, peaceful debrief', async ({ sim }) => {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: REQUIRED_HANDLES })

  const AVATAR_MONEY = 1_000_000
  await driveToContact(sim, AVATAR_MONEY)

  const escortCount = await readEscortCount(sim)
  const expectedToll = TOLL_BASE + TOLL_PER_ESCORT * escortCount
  const before = await sim.page.evaluate(() => (window as any).__uclife__.getPlayerMoney())
  expect(before, 'avatar must start affluent enough to pay the toll').toBe(AVATAR_MONEY)

  // Real DOM click on the modal's negotiate choice.
  const negotiateBtn = sim.page.locator('[data-engagement-negotiate]')
  await expect(negotiateBtn, 'an affordable toll leaves negotiate enabled').toBeEnabled()
  await negotiateBtn.click()

  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getEngagement().isOpen()),
    'paying the toll must close the engagement modal').toBe(false)
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getCombat().isOpen()),
    'a paid negotiation must NOT open tactical combat').toBe(false)

  await sim.page.waitForSelector('[data-combat-debrief]', { timeout: DOM_COMMIT_TIMEOUT_MS })
  const debrief = sim.page.locator('[data-combat-debrief]')
  await expect(debrief, 'a paid negotiation announces the peaceful-disengage outcome').toHaveAttribute(
    'data-combat-debrief-outcome', 'negotiate')
  const debriefText = await debrief.innerText()
  expect(debriefText, 'debrief must show the toll paid').toContain(String(expectedToll))

  await sim.page.locator('[data-combat-debrief-continue]').click()
  await expect(debrief, 'continue must close the debrief beat').toBeHidden()

  const after = await sim.page.evaluate(() => (window as any).__uclife__.getPlayerMoney())
  expect(
    after,
    'toll must be debited off the avatar by exactly tollBase + tollPerEscort × escorts',
  ).toBe(before - expectedToll)
})

test('negotiate unaffordable: escalates to a real fight, debits nothing', async ({ sim }) => {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: REQUIRED_HANDLES })

  // Below tollBase (300) → unaffordable regardless of escort count.
  const POOR_MONEY = 100
  await driveToContact(sim, POOR_MONEY)

  const before = await sim.page.evaluate(() => (window as any).__uclife__.getPlayerMoney())
  expect(before, 'avatar must be too poor to pay any toll').toBe(POOR_MONEY)

  // Resolve negotiate: the sim can't pay the toll, so it must escalate to
  // tactical combat rather than disengage for free. (The modal disables the
  // button when unaffordable, so this exercises the sim fallback directly.)
  await sim.page.evaluate(() => (window as any).__uclife__.useEngagement.getState().resolve('negotiate'))

  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getCombat().isOpen()),
    'an unaffordable negotiation must escalate to tactical combat').toBe(true)
  const after = await sim.page.evaluate(() => (window as any).__uclife__.getPlayerMoney())
  expect(after, 'a failed negotiation must not debit any money').toBe(before)
})
