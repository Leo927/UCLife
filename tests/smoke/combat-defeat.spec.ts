// Regression: losing a tactical engagement must resolve cleanly, not crash.
//
// combatSystem read the flagship's Ship trait unconditionally at the end of a
// tick (combat.ts §6). But an enemy weapon that destroys the flagship fires
// endCombat('defeat') MID-tick, which destroys the flagship entity
// (applyDefeatConsequence). The subsequent unguarded read then dereferenced a
// dead entity and threw, so every real defeat crashed the sim.
//
// Reproduction: cripple the flagship to 1 hp / 0 armor, then drive tactical
// time until an enemy beam lands. Leaving 1 hp (not 0) means the end-of-tick
// resolution never fires "clean" — defeat can ONLY resolve through the
// mid-tick endCombat('defeat') path, which is exactly the crash path.

import { test, expect, DOM_COMMIT_TIMEOUT_MS, isKnownPixiResolutionTeardown } from './_fixtures'

/* eslint-disable @typescript-eslint/no-explicit-any */

const REQUIRED_HANDLES = [
  '__uclife__.boardShip',
  '__uclife__.takeHelmCheat',
  '__uclife__.startCombatCheat',
  '__uclife__.listEnemies',
  '__uclife__.damageFlagship',
  '__uclife__.flagshipDamage',
  '__uclife__.tickCombatSystem',
  '__uclife__.useCombatStore',
]

const LEFTOVER_HULL = 1        // >0 so resolution fires only via a mid-tick kill
const TICK_DT_MS = 500
const MAX_DRIVE_TICKS = 600    // ~300s tactical; enemy closes 500→180px range in ~10s

test('combat defeat: flagship destroyed mid-tick resolves cleanly (no crash)', async ({ sim }) => {
  sim.allowConsoleError(isKnownPixiResolutionTeardown)
  // starter-fleet boots exactly one weak lightFreighter flagship — a 1-v-3
  // it cannot win, and the only owned hull, so defeat clears the roster.
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

  const enemies = await sim.page.evaluate(() => (window as any).__uclife__.listEnemies())
  expect(enemies.length, 'no campaign enemies to engage').toBeGreaterThan(0)

  // A heavy 1-v-3 the crippled flagship cannot clear before it dies — so
  // defeat reliably wins the race against the flagship's own auto-fire.
  await sim.page.evaluate((key) =>
    (window as any).__uclife__.startCombatCheat(
      'pirate_raider', ['pirate_skirmisher', 'pirate_skirmisher'], key),
    enemies[0].key)
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getCombat().isOpen()),
    'combat must open',
  ).toBe(true)

  // Cripple: 1 hp, 0 armor. The next beam that lands pipes straight to hull → 0.
  const before = await sim.page.evaluate(() => (window as any).__uclife__.flagshipDamage())
  await sim.page.evaluate(
    (arg) => (window as any).__uclife__.damageFlagship(arg.hullLoss, arg.armorLoss),
    { hullLoss: before.hullCurrent - LEFTOVER_HULL, armorLoss: before.armorCurrent })

  // Drive tactical time until an enemy beams the crippled flagship dead.
  // Pre-fix, tickCombatSystem throws when the flagship dies mid-tick.
  const outcome = await sim.page.evaluate(({ dt, maxTicks }) => {
    const u = (window as any).__uclife__
    for (let i = 0; i < maxTicks; i++) {
      const combat = u.getGameState().getCombat()
      if (!combat.isOpen()) return { closedAtTick: i }
      if (combat.isPaused()) u.useCombatStore.getState().togglePause()
      u.tickCombatSystem(dt)
    }
    return { closedAtTick: -1 }
  }, { dt: TICK_DT_MS, maxTicks: MAX_DRIVE_TICKS })

  expect(
    outcome.closedAtTick,
    'defeat must resolve within the drive budget (combat closed cleanly)',
  ).toBeGreaterThanOrEqual(0)
  // Defeat migrates the survivor to a rescue colony and destroys the flagship.
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getScene().getId()),
    'defeat drops the survivor at a ground colony',
  ).toMatch(/vonBraunCity|zumCity/)
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getPlayerFleet().getShipCount()),
    'losing the fight destroys the flagship',
  ).toBe(0)
})
