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
//
// Final-review finding 2 — applyDefeatConsequence destroyed the flagship but
// left any Ms.storedOnShipKey pointing at the dead key: custody verbs would
// refuse forever, fleetSupplyDrain would bill the lost MS forever, and the
// idempotent starter-MS grant key would never free up for a re-buy. Fixed
// diegetically: MS stowed aboard the lost flagship are lost with the ship.
// Covered below — no dangling storedOnShipKey, no more supply drain for the
// lost MS, and a freshly bought hull re-grants the starter bundle.

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
  '__uclife__.getMsRoster',
  '__uclife__.runFleetSupplyDrainTick',
  '__uclife__.listHangarsAllScenes',
  '__uclife__.enqueueShipDelivery',
  '__uclife__.runShipDeliveryTick',
  '__uclife__.receiveShipDelivery',
  '__uclife__.boardShipByKey',
  '__uclife__.getGameDay',
]

const LEFTOVER_HULL = 1        // >0 so resolution fires only via a mid-tick kill
const TICK_DT_MS = 500
const MAX_DRIVE_TICKS = 600    // ~300s tactical; enemy closes 500→180px range in ~10s
const LOST_FLAGSHIP_KEY = 'ship'     // starter-fleet fixture's flagship EntityKey
const STARTER_MS_KEY = 'ms-player-0' // config/ms.json5 starterMsEntityKey
const REBUY_LEAD_DAYS = 3
const REBUY_HULL_CLASS = 'lightFreighter'
const REBUY_HANGAR_TYPE = 'hangarSurface'

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

  // Finding 2 — the starter-fleet fixture stows ms-player-0 aboard the lost
  // flagship (storedOnShipKey: 'ship'). It must be destroyed with the ship,
  // not orphaned with a dangling reference to the dead key.
  const rosterAfterDefeat = await sim.page.evaluate(() => (window as any).__uclife__.getMsRoster())
  expect(
    rosterAfterDefeat.some((m: any) => m.storedOnShipKey === LOST_FLAGSHIP_KEY),
    'no MS entity may still reference the destroyed flagship key',
  ).toBe(false)
  expect(
    rosterAfterDefeat.some((m: any) => m.key === STARTER_MS_KEY),
    'the starter MS aboard the lost flagship must be destroyed, not orphaned',
  ).toBe(false)

  // Finding 2 — fleetSupplyDrainSystem walks every Ms entity regardless of
  // whether its storedOnShipKey still resolves; a destroyed-but-lingering
  // MS would bill upkeep forever. With the MS gone, the drain tick must not
  // count it.
  const gameDay = await sim.page.evaluate(() => (window as any).__uclife__.getGameDay())
  const drainResult = await sim.page.evaluate(
    (day: number) => (window as any).__uclife__.runFleetSupplyDrainTick(day),
    gameDay,
  )
  expect(drainResult.msDraining, 'the lost MS must not keep billing supply upkeep').toBe(0)

  // Finding 2 — grantStarterMsToShip's idempotency check keys on the starter
  // MS entity existing at all (config/ms.json5 starterMsEntityKey). With it
  // destroyed, the player's next bought hull must re-grant the starter
  // bundle rather than silently skipping it forever.
  const hangars = await sim.page.evaluate(() => (window as any).__uclife__.listHangarsAllScenes())
  const rebuyHangar = hangars.find((h: any) => h.typeId === REBUY_HANGAR_TYPE)
  expect(rebuyHangar, 'no state hangar available to re-buy a hull after defeat').toBeTruthy()

  const enq = await sim.page.evaluate(
    (arg) => (window as any).__uclife__.enqueueShipDelivery(arg.k, arg.cls, arg.orderDay, arg.lead),
    { k: rebuyHangar.buildingKey, cls: REBUY_HULL_CLASS, orderDay: gameDay, lead: REBUY_LEAD_DAYS },
  )
  expect(enq, 'enqueueShipDelivery rejected the post-defeat re-buy').toBeTruthy()

  await sim.page.evaluate(
    (day: number) => (window as any).__uclife__.runShipDeliveryTick(day),
    gameDay + REBUY_LEAD_DAYS,
  )
  const rx = await sim.page.evaluate(
    (arg) => (window as any).__uclife__.receiveShipDelivery(arg.k, arg.idx),
    { k: rebuyHangar.buildingKey, idx: enq.rowIndex },
  )
  expect(rx.ok, `receiveShipDelivery failed: ${JSON.stringify(rx)}`).toBe(true)

  const boardResult = await sim.page.evaluate(
    (key: string) => (window as any).__uclife__.boardShipByKey(key),
    rx.entityKey,
  )
  expect(boardResult.ok, `boardShipByKey failed: ${boardResult.reasonZh ?? ''}`).toBe(true)

  const rosterAfterRebuy = await sim.page.evaluate(() => (window as any).__uclife__.getMsRoster())
  expect(
    rosterAfterRebuy.some((m: any) => m.key === STARTER_MS_KEY && m.storedOnShipKey === rx.entityKey),
    'the starter MS bundle must re-grant onto the newly bought hull',
  ).toBe(true)
})
