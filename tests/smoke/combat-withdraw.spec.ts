// W2 Task 3 — mid-combat withdraw. Locked decision: withdraw is always
// available and CP-free (no orderCosts row — retreat was deleted from
// fleetConfig.commandPoints.orderCosts in Task 1).
//
// This proves the whole loop end to end:
//   1. Real contact detection (spaceSimSystem) prompts the engagement
//      modal — not startCombatCheat — so the modal's cooldown +
//      out-of-aggro re-prompt guard actually gets seeded the way it would
//      in normal play.
//   2. Engaging opens tactical combat.
//   3. A real two-click DOM confirm on the order palette's 撤退 button
//      (misclicking withdraw would be rage-inducing) ends combat via
//      endCombat('flee') -> applyFleePenalty(), applying the
//      combat.json5-configured hull/armor/CR penalty.
//   4. Because the ship never left contact range, the same cooldown +
//      out-of-aggro latch that guards every contact keeps the modal from
//      reopening even well past the cooldown window.

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
  '__uclife__.useCombatStore',
  '__uclife__.getShipState',
  '__uclife__.getGameState',
]

// src/config/combat.json5 fleePenalty — mirrored here as named constants
// rather than read live, matching this suite's existing convention (see
// fleet-orders.spec.ts's RALLY_ARRIVE_RADIUS_PX / RALLY_CLICK_TOLERANCE_PX).
const FLEE_HULL_LOSS_PCT = 0.35
const FLEE_CR_DRAIN = 50

// One contact-detection tick is enough once the ship sits exactly on the
// enemy's position — the dt value itself doesn't matter for a same-frame
// contact/prompt check.
const CONTACT_TICK_DT_SEC = 0.1

test('mid-combat withdraw: real click confirm, flee penalty applied, no instant re-prompt', async ({ sim }) => {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: REQUIRED_HANDLES })

  await sim.page.evaluate(() => (window as any).__uclife__.boardShip())
  await sim.page.waitForFunction(
    () => (window as any).__uclife__.getGameState().getScene().getId() === 'playerShipInterior',
    null, { timeout: DOM_COMMIT_TIMEOUT_MS })
  const helm = await sim.page.evaluate(() => (window as any).__uclife__.takeHelmCheat())
  expect(helm?.ok, `takeHelmCheat failed: ${helm?.message}`).toBe(true)
  await sim.page.waitForFunction(
    () => (window as any).__uclife__.getGameState().getScene().getId() === 'spaceCampaign',
    null, { timeout: DOM_COMMIT_TIMEOUT_MS })

  // takeHelmCheat() doesn't undock the flagship (Ship.dockedAtPoiId is
  // still set) — spaceSim's contact-detection loop requires the player be
  // actually flying (undocked), so the real navigateTo() launch path (via
  // debugNavigate) has to run first, same as a real player picking a
  // destination off the starmap. Infinite fuel isolates this test from the
  // sortie fuel budget (fuel-budget.spec.ts owns that coverage), matching
  // intercept-and-dock.spec.ts's convention.
  await sim.page.evaluate(() => (window as any).__uclife__.setInfiniteFuelSupply(true))

  const enemies = await sim.page.evaluate(() => (window as any).__uclife__.listEnemies())
  expect(enemies.length, 'no campaign enemies to engage').toBeGreaterThan(0)
  const target = enemies[0]

  const navRes = await sim.page.evaluate(
    (key: string) => (window as any).__uclife__.debugNavigate({ kind: 'enemy', enemyKey: key }),
    target.key,
  )
  expect(navRes.ok, `debugNavigate({kind:'enemy'}) failed: ${navRes.message}`).toBe(true)

  // Force contact deterministically (rather than waiting out the
  // autopilot transit): park the player ship exactly on the enemy, then
  // drive one real contact-detection tick.
  await sim.page.evaluate((p: { x: number; y: number }) => (window as any).__uclife__.moveShipTo(p.x, p.y), target.pos)
  await sim.page.evaluate((dt: number) => (window as any).__uclife__.tickSpace(dt), CONTACT_TICK_DT_SEC)
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getEngagement().isOpen()),
    'contact must prompt the engagement modal',
  ).toBe(true)

  // Engage through the real store action (the production contact ->
  // modal -> resolve('engage') path), not startCombatCheat, so the
  // spaceSim cooldown map + out-of-aggro set actually get seeded.
  await sim.page.evaluate(() => (window as any).__uclife__.useEngagement.getState().resolve('engage'))
  await sim.page.waitForSelector('.tactical-overlay', { timeout: DOM_COMMIT_TIMEOUT_MS })
  // PixiCanvas's Application.init() is async — wait for the arena canvas
  // to actually mount before touching the palette.
  await sim.page.waitForSelector('.tactical-canvas-host canvas', { timeout: DOM_COMMIT_TIMEOUT_MS })

  const before = await sim.page.evaluate(() => (window as any).__uclife__.getShipState())

  // ── Real DOM click, twice: arm the confirm, then commit ──────────────
  const withdrawBtn = sim.page.locator('[data-tactical-order="withdraw"]')
  await expect(withdrawBtn, 'withdraw is enabled and CP-free — no cost suffix, no Task 3 tooltip').toBeEnabled()
  await withdrawBtn.click()
  await expect(withdrawBtn, 'first click arms the confirm state').toHaveText('撤退 · 确认?')
  await expect(withdrawBtn, 'armed withdraw carries the shared pending-order visual cue').toHaveClass(/is-pending/)
  await withdrawBtn.click()

  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getCombat().isOpen()),
    'confirmed withdraw must close tactical combat',
  ).toBe(false)

  // ── Penalty applied per combat.json5, from one shared computation ────
  const after = await sim.page.evaluate(() => (window as any).__uclife__.getShipState())
  const expectedHullLoss = Math.floor(before.hullCurrent * FLEE_HULL_LOSS_PCT)
  expect(
    after.hullCurrent,
    'withdraw must apply the configured hull-loss percentage',
  ).toBe(Math.max(1, before.hullCurrent - expectedHullLoss))
  expect(after.armorCurrent, 'withdraw must zero the armor buffer').toBe(0)
  expect(
    after.crCurrent,
    'withdraw must drain the configured amount of combat readiness',
  ).toBe(Math.max(0, before.crCurrent - FLEE_CR_DRAIN))

  // ── No instant re-prompt: the ship sits exactly where it did in contact,
  // never having left aggro range, so the out-of-aggro latch keeps the
  // modal shut even once stepped well past the 5s cooldown window. ──────
  await sim.stepFor(0.2)
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getEngagement().isOpen()),
    'engagement must not re-prompt while the ship never left contact range',
  ).toBe(false)
})
