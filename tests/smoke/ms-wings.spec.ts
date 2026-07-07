// W3 (ms-identity) Task 5 system smoke — AI MS wings.
//
// Proves the wing loop end-to-end against the deterministic substrate:
//   A. Bridge-order launch: a REAL palette click on the msLaunchAuth button
//      debits the CP cost (2) and spawns one wing per pilot-assigned MS
//      aboard the flagship. Role tags steer target selection — the antiShip
//      wing locks the enemy SHIP even while an enemy MS is closer, and the
//      skirmisher wing takes the nearest hostile (the MS). Wing combat damage
//      then syncs back to its OWN roster row (not the player's slot) on
//      endCombat, leaving the other wing's roster untouched.
//   B. Resupply loop: a wing drained below wingResupplyThresholdPct flies to
//      the flagship, docks through the hangar-door queue, resupplies, and
//      relaunches — all driven by simulated time.
//
// System smoke (not a journey): startCombatCheat + debug pose/resource seeds
// are permitted; the launch itself is real DOM input, per the brief.

import { test, expect, type Sim } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.startCombatCheat',
  '__uclife__.endCombatCheat',
  '__uclife__.tickCombatSystem',
  '__uclife__.useCombatStore',
  '__uclife__.useClock',
  '__uclife__.commandPoolDescribe',
  '__uclife__.getWings',
  '__uclife__.setCombatPosCheat',
  '__uclife__.setWingHullCheat',
  '__uclife__.getMs',
  '__uclife__.setMsSortieResources',
  '__uclife__.getFlagshipCombatPose',
]

const STEP_BUDGET_MIN = 60
const MS_LAUNCH_AUTH_CP = 2   // fleet.json5 orderCosts.msLaunchAuth
const TICK_DT_MS = 100

/* eslint-disable @typescript-eslint/no-explicit-any */

// Boot, enter a combat with an enemy ship + an enemy MS, unpause, and launch
// both pilot-assigned MS as wings by a real palette click. Returns the CP
// pool current value observed immediately after the launch debit.
async function bootAndLaunchWings(
  sim: Sim, escorts: string[] = ['pirate_junkerMs'],
): Promise<{ cpBefore: number; cpAfter: number }> {
  await sim.boot({ fixture: 'ms-wings', requireHandles: REQUIRED_HANDLES })

  // Lead pirateLight (enemy-ship-0, a hull) + optional escorts. The default
  // adds one pirate_junkerMs (enemy-ship-1, isMs) so the arena holds both an
  // enemy ship AND an enemy MS for the role-preference assertion.
  await sim.page.evaluate((esc) =>
    (window as any).__uclife__.startCombatCheat('pirateLight', esc, null), escorts)

  await sim.stepUntil(() => (window as any).__uclife__.useCombatStore.getState().open === true, STEP_BUDGET_MIN)

  // Tactical opens paused on first contact — unpause so combatSystem ticks.
  await sim.page.evaluate(() => {
    const cs = (window as any).__uclife__.useCombatStore.getState()
    if (cs.paused) cs.togglePause()
  })

  const cpBefore = (await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())).current

  // Real palette click — the button is enabled because two pilot-assigned MS
  // are stowed aboard the flagship.
  await sim.page.waitForSelector('[data-tactical-order="msLaunchAuth"]:not([disabled])', { timeout: 5_000 })
  await sim.page.click('[data-tactical-order="msLaunchAuth"]')

  const cpAfter = (await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())).current
  return { cpBefore, cpAfter }
}

test('ms-wings: bridge-order launch, role-tag targeting, per-member damage sync', async ({ sim }) => {
  const { cpBefore, cpAfter } = await bootAndLaunchWings(sim)

  // ── Launch order debits the msLaunchAuth CP cost ─────────────────────────
  expect(cpAfter, 'msLaunchAuth must debit its CP cost on the real palette click').toBe(cpBefore - MS_LAUNCH_AUTH_CP)

  // ── Both pilot-assigned MS field as wings ────────────────────────────────
  const wings = await sim.page.evaluate(() => (window as any).__uclife__.getWings())
  const wingKeys = wings.map((w: any) => w.cloneKey).sort()
  expect(wingKeys, 'both pilot-assigned MS should launch as wing clones').toEqual(['wing-ms-a', 'wing-ms-b'])

  // ── Role tags steer target selection ─────────────────────────────────────
  // Deterministic board: enemy MS (enemy-ship-1) sits CLOSER to both wings
  // than the enemy ship (enemy-ship-0). The antiShip wing must still lock the
  // ship; the skirmisher wing takes the nearer hostile (the MS).
  await sim.page.evaluate(() => {
    const u = (window as any).__uclife__
    u.setCombatPosCheat('enemy-ship-1', 380, 300)   // enemy MS — closer
    u.setCombatPosCheat('enemy-ship-0', 520, 300)   // enemy ship — farther
    u.setCombatPosCheat('wing-ms-a', 300, 300)      // antiShip
    u.setCombatPosCheat('wing-ms-b', 300, 310)      // skirmisher
  })
  // One tick resolves each wing's directive target from the seeded poses.
  await sim.page.evaluate((dt) => (window as any).__uclife__.tickCombatSystem(dt), TICK_DT_MS)

  const targeted = await sim.page.evaluate(() => (window as any).__uclife__.getWings())
  const wingA = targeted.find((w: any) => w.cloneKey === 'wing-ms-a')
  const wingB = targeted.find((w: any) => w.cloneKey === 'wing-ms-b')
  expect(
    wingA.currentTargetKey,
    'antiShip wing must target the enemy SHIP even though the enemy MS is closer',
  ).toBe('enemy-ship-0')
  expect(
    wingB.currentTargetKey,
    'skirmisher wing takes the nearest hostile (the enemy MS)',
  ).toBe('enemy-ship-1')

  // ── Per-member damage sync ──────────────────────────────────────────────
  // Damage ms-a's wing clone, end the fight, and confirm the loss lands on
  // ms-a's OWN roster row while ms-b's roster stays pristine.
  const msBFull = await sim.page.evaluate(() => (window as any).__uclife__.getMs('ms-b'))
  await sim.page.evaluate(() => (window as any).__uclife__.setWingHullCheat('ms-a', 40, 3))
  await sim.page.evaluate(() => (window as any).__uclife__.endCombatCheat('victory'))
  await sim.stepUntil(() => (window as any).__uclife__.useCombatStore.getState().open === false, STEP_BUDGET_MIN)

  const msA = await sim.page.evaluate(() => (window as any).__uclife__.getMs('ms-a'))
  const msB = await sim.page.evaluate(() => (window as any).__uclife__.getMs('ms-b'))
  expect(msA.hullCurrent, 'wing damage must write back to its OWN roster row on endCombat').toBe(40)
  expect(msA.armorCurrent, 'wing armor damage must write back too').toBe(3)
  expect(msB.hullCurrent, 'the other wing\'s roster row must stay untouched (per-member keys)').toBe(msBFull.hullCurrent)
})

test('ms-wings: a dry wing docks, resupplies, and relaunches', async ({ sim }) => {
  // One lone hostile only — the resupply loop is the subject, not a real
  // fight. We pin the flagship (corner) + the hostile (far corner) every tick
  // below so the weak flagship never charges into weapon range: no hull-
  // threshold auto-pause, no flagship loss, combat stays open with a live
  // enemy while the wing runs its dock → resupply → relaunch cycle.
  await bootAndLaunchWings(sim, [])

  // Drain ms-a below wingResupplyThresholdPct so it heads home to resupply.
  await sim.page.evaluate(() => {
    const u = (window as any).__uclife__
    u.setCombatPosCheat('ship', 120, 120)
    u.setCombatPosCheat('wing-ms-a', 128, 120)
    u.setMsSortieResources('ms-a', { currentPropellant: 1 })
  })

  // Deterministic pinned drive: every tick re-pins the flagship + hostile so
  // neither engages, then advances combat. Bounded loop; breaks as soon as the
  // full cycle (dock → resupply-start → relaunch) is observed. No RNG in ship
  // physics, no auto-pause (flagship takes no damage), so this is stable.
  const result = await sim.page.evaluate(() => {
    const u = (window as any).__uclife__
    let dockedResup = false
    let relaunched = false
    let relaunchProp = -1
    for (let i = 0; i < 1200 && !relaunched; i++) {
      // Cluster the flagship + the idle sibling wing far from the lone hostile
      // every tick: nothing is ever in weapon range, so the enemy can't be
      // killed (no victory end) and the flagship takes no damage (no auto-
      // pause / defeat). Only ms-a's wing is left free to run the loop.
      u.setCombatPosCheat('ship', 120, 120)
      u.setCombatPosCheat('wing-ms-b', 120, 220)
      u.setCombatPosCheat('enemy-ship-0', 950, 550)
      const cs = u.useCombatStore.getState()
      if (cs.paused) cs.togglePause()
      u.tickCombatSystem(100)
      const ms = u.getMs('ms-a')
      if ((ms?.resupplySecTotal ?? 0) > 0) dockedResup = true
      // Relaunch: the wing clone reappears AFTER a real resupply cycle.
      if (dockedResup && u.getWings().some((w: any) => w.cloneKey === 'wing-ms-a')) {
        relaunched = true
        relaunchProp = ms.currentPropellant
      }
    }
    return { dockedResup, relaunched, relaunchProp, cap: u.getMs('ms-a')?.propellantStorageCap }
  })

  expect(result.dockedResup, 'the dry wing must dock and enter resupply (ResupplyState attached)').toBe(true)
  expect(result.relaunched, 'the resupplied wing must relaunch (its clone reappears)').toBe(true)
  expect(
    result.relaunchProp,
    'a relaunched wing must have had its propellant restored to the cap by resupply',
  ).toBe(result.cap)
})
