// Issue #71 — recoverables dialogue. Boots a Pegasus-class flagship aboard
// playerShipInterior docked at Von Braun, drives a deterministic engagement
// to resolution, and asserts the recoverables dialogue fires BEFORE the
// tally, the prize-crew gate, the salvaged-hull-in-flight state, pod →
// brig routing, and the next-dock delivery hand-off.
//
// Construction rules: __uclife__ only, sim-time only, seeded fixture, no
// retries, fail-loud expects.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.startCombatCheat',
  '__uclife__.breakDownEnemiesCheat',
  '__uclife__.getRecoverables',
  '__uclife__.canRecoverHull',
  '__uclife__.recoverHull',
  '__uclife__.recoverPod',
  '__uclife__.finishRecoverables',
  '__uclife__.capturedShips',
  '__uclife__.brigState',
  '__uclife__.setFlagshipCrewCount',
  '__uclife__.flagshipDockCheat',
  '__uclife__.deliverySnapshot',
]

const STEP_BUDGET_MIN = 60

async function fightToResolution(sim: any, enemyClass: string) {
  await sim.page.evaluate(
    (cls: string) => (window as any).__uclife__.startCombatCheat(cls, [], null),
    enemyClass,
  )
  await sim.page.evaluate(async (mins: number) => {
    await (window as any).__uclife_test__.step({
      until: () => (window as any).__uclife__.useCombatStore.getState().open === true,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)
  // Disable + resolve every hostile through the canonical path (records
  // recoverables in onEnemyDestroyed, then endCombat fires recoverables).
  await sim.page.evaluate(() => (window as any).__uclife__.breakDownEnemiesCheat())
  await sim.page.evaluate(async (mins: number) => {
    await (window as any).__uclife_test__.step({
      until: () => (window as any).__uclife__.useCombatStore.getState().open === false,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)
}

test('recoverables: dialogue before tally, prize-crew gate, in-flight hull, pod, dock delivery', async ({ sim }) => {
  await sim.boot({ fixture: 'recoverables', requireHandles: REQUIRED_HANDLES })

  // ── 1+2. With no idle crew, the dialogue fires before the tally and the
  // hull's Recover is gated with the stated reason. ─────────────────────
  await sim.page.evaluate(() => (window as any).__uclife__.setFlagshipCrewCount(0))
  await fightToResolution(sim, 'pirate_skirmisher')

  const firedBeforeTally = await sim.page.evaluate(() => {
    const w = window as any
    return {
      recoverablesOpen: w.uclifeUI.getState().recoverablesOpen,
      tally: w.uclifeUI.getState().combatTally,
    }
  })
  expect(firedBeforeTally.recoverablesOpen, 'recoverables dialogue opened').toBe(true)
  expect(firedBeforeTally.tally, 'tally is deferred until recoverables resolve').toBeNull()

  const rec = await sim.page.evaluate(() => (window as any).__uclife__.getRecoverables())
  expect(rec.hulls.length, 'one survivor hull listed').toBe(1)
  expect(rec.pods.length, 'one ejected pod listed').toBe(1)

  const gatedHullId = rec.hulls[0].id
  const gate = await sim.page.evaluate(
    (id: string) => (window as any).__uclife__.canRecoverHull(id),
    gatedHullId,
  )
  expect(gate.ok, 'Recover gated with no idle crew').toBe(false)
  expect(gate.reasonZh, 'gate states the plain reason').toContain('船员')

  const gatedRecover = await sim.page.evaluate(
    (id: string) => (window as any).__uclife__.recoverHull(id),
    gatedHullId,
  )
  expect(gatedRecover.ok, 'Recover refused when prize crew short').toBe(false)

  // Close the dialogue (defaults: scuttle hull, leave pod) → tally emits.
  await sim.page.evaluate(() => (window as any).__uclife__.finishRecoverables())
  const tally1 = await sim.page.evaluate(() => (window as any).uclifeUI.getState().combatTally)
  expect(tally1, 'tally emitted after recoverables resolved').toBeTruthy()
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().setCombatTally(null))

  // ── 3+5. Re-fight with enough prize crew. Recover the hull + the pod. ──
  await sim.page.evaluate(() => (window as any).__uclife__.setFlagshipCrewCount(8))
  const brigBefore = await sim.page.evaluate(() => (window as any).__uclife__.brigState())
  await fightToResolution(sim, 'pirate_skirmisher')

  const rec2 = await sim.page.evaluate(() => (window as any).__uclife__.getRecoverables())
  expect(rec2.hulls.length, 'one survivor hull on the re-fight').toBe(1)
  expect(rec2.pods.length, 'one pod on the re-fight').toBe(1)

  const recoverRes = await sim.page.evaluate(
    (id: string) => (window as any).__uclife__.recoverHull(id),
    rec2.hulls[0].id,
  )
  expect(recoverRes.ok, 'Recover succeeds with sufficient prize crew').toBe(true)

  const captured = await sim.page.evaluate(() => (window as any).__uclife__.capturedShips())
  expect(captured.length, 'a captured ship joined the fleet').toBe(1)
  const ship = captured[0]
  expect(ship.wasCaptured, 'WasCaptured marker present').toBe(true)
  expect(ship.homeHangarId, 'homeHangarId is null (in-flight)').toBe('')
  expect(ship.inActiveFleet, 'captured hull joins as reserve, not active fleet').toBe(false)
  expect(ship.currentSupply, 'bunkers at half-cap (>0)').toBeGreaterThan(0)
  expect(ship.currentFuel, 'fuel at half-cap (>0)').toBeGreaterThan(0)

  // Recover the pod → occupant lands in the brig (+1).
  const podRes = await sim.page.evaluate(
    (id: string) => (window as any).__uclife__.recoverPod(id),
    rec2.pods[0].id,
  )
  expect(podRes.ok, 'pod occupant recovered').toBe(true)
  const brigAfter = await sim.page.evaluate(() => (window as any).__uclife__.brigState())
  expect(
    brigAfter.occupied - brigBefore.occupied,
    'recovering the pod adds one prisoner to the brig',
  ).toBe(1)

  await sim.page.evaluate(() => (window as any).__uclife__.finishRecoverables())
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().setCombatTally(null))

  // ── 6. Dock the flagship → the captured hull queues a delivery row. ───
  const rowsBeforeDock = await sim.page.evaluate(
    () => (window as any).__uclife__.deliverySnapshot().length,
  )
  const rowsAfterDock = await sim.page.evaluate(() => {
    const u = (window as any).__uclife__
    u.flagshipDockCheat('vonBraun')
    return u.deliverySnapshot().length
  })
  expect(
    rowsAfterDock - rowsBeforeDock,
    'captured hull queued a delivery row on dock',
  ).toBeGreaterThanOrEqual(1)

  // The in-flight captured ship entity was consumed by the delivery hand-off.
  const capturedAfterDock = await sim.page.evaluate(
    () => (window as any).__uclife__.capturedShips(),
  )
  expect(
    capturedAfterDock.length,
    'in-flight captured hull despawned once queued for delivery',
  ).toBe(0)
})
