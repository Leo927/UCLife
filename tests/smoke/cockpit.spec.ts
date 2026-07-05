// Verify the bridge ↔ hangar walk + MS pilot loop:
//   1. Boot, board, helm, jump straight into combat against a pirate.
//   2. By default piloting='flagship' and useCombatStore.open === true.
//   3. launchPlayerMs() → MS spawned, piloting='ms', tactical still open.
//   4. msState() reflects the live MS pose; pilotedByPlayer=true.
//   5. dockPlayerMs(true) → MS despawns, useCombatStore.open === false,
//      piloting=null. Combat itself is still engaged (clock.mode='combat').
//   6. takeFlagshipControl() → tactical re-opens, piloting='flagship'.
//   7. fastWinCombat → combat resolves cleanly.
//
// Issue #163 — a second launch/dock pass proves combat damage taken on the
// tactical clone survives dock-back onto the persistent roster Ms entity
// (starter-fleet's `ms-player-0`), and a third pass proves the destruction
// exit writes hull 0.

import { test, expect, type Sim } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.startCombatCheat',
  '__uclife__.launchPlayerMs',
  '__uclife__.dockPlayerMs',
  '__uclife__.takeFlagshipControl',
  '__uclife__.leaveBridgeCheat',
  '__uclife__.msState',
  '__uclife__.useCockpit',
  '__uclife__.getMs',
  '__uclife__.setPilotedMsHullCheat',
  '__uclife__.onMsDestroyedCheat',
  '__uclife__.endCombatCheat',
]

const STARTER_MS_KEY = 'ms-player-0'

const STEP_BUDGET_MIN = 60

test('cockpit: launch MS, dock, re-helm flagship', async ({ sim }) => {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: REQUIRED_HANDLES })

  // Boot + board + helm + jump into combat.
  const setupOk = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = (window as any).__uclife__
    return u.cheatMoney(80000) && u.cheatPiloting(10)
  })
  expect(setupOk, 'cheatMoney+cheatPiloting failed at setup').toBeTruthy()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.boardShip())
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useScene.getState().activeId === 'playerShipInterior',
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const helmRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.takeHelmCheat(),
  )
  expect(helmRes?.ok, `takeHelmCheat should succeed; got ${JSON.stringify(helmRes)}`).toBe(true)

  const enemies = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listEnemies(),
  )
  expect(enemies && enemies.length > 0, 'no enemies present in spaceCampaign').toBeTruthy()

  await sim.page.evaluate((key) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.startCombatCheat('pirateLight', [], key)
  }, enemies[0].key)

  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      until: () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__uclife__.useCombatStore.getState().open === true
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        && (window as any).__uclife__.useCockpit.getState().piloting === 'flagship',
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  // Launch the MS.
  const launchRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.launchPlayerMs(),
  )
  expect(launchRes?.ok, `launchPlayerMs should succeed; got ${JSON.stringify(launchRes)}`).toBe(true)
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useCockpit.getState().piloting === 'ms',
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const ms = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.msState(),
  )
  expect(ms, 'msState() returned null after launch').toBeTruthy()
  expect(ms.pilotedByPlayer, 'MS pilotedByPlayer should be true after launch').toBe(true)
  expect(
    ms.hullCurrent,
    `MS launched at less than full hull: ${ms.hullCurrent}/${ms.hullMax}`,
  ).toBe(ms.hullMax)

  // Issue #163 — damage the clone directly (deterministic; no projectile
  // RNG) and verify dock-back writes it to the roster.
  const damageOk = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.setPilotedMsHullCheat(90, 5),
  )
  expect(damageOk, 'setPilotedMsHullCheat should succeed while an MS is deployed').toBe(true)
  const damagedMs = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.msState(),
  )
  expect(damagedMs.hullCurrent, 'clone hull should reflect the cheat').toBe(90)
  expect(damagedMs.armorCurrent, 'clone armor should reflect the cheat').toBe(5)

  // Force-dock the MS.
  const dockRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.dockPlayerMs(true),
  )
  expect(dockRes?.ok, `dockPlayerMs should succeed; got ${JSON.stringify(dockRes)}`).toBe(true)
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      until: () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__uclife__.msState() === null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        && (window as any).__uclife__.useCockpit.getState().piloting === null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        && (window as any).__uclife__.useCombatStore.getState().open === false,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const sceneAfterDock = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.useScene.getState().activeId,
  )
  expect(
    sceneAfterDock,
    `expected to be in playerShipInterior after dock; got "${sceneAfterDock}"`,
  ).toBe('playerShipInterior')

  // Issue #163 — the roster entity (not just the despawned clone) must
  // carry the damage. Still aboard the ship (dockMs doesn't move custody),
  // so damageState stays 'ready' per Task 9's depot-only in-repair rule.
  const rosterAfterDock = await sim.page.evaluate(
    (key) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getMs(key),
    STARTER_MS_KEY,
  )
  expect(rosterAfterDock, 'roster MS should still exist after dock').toBeTruthy()
  expect(rosterAfterDock!.hullCurrent, 'roster hullCurrent should reflect the docked damage').toBe(90)
  expect(rosterAfterDock!.armorCurrent, 'roster armorCurrent should reflect the docked damage').toBe(5)
  expect(rosterAfterDock!.damageState, 'still aboard ship — damageState stays ready').toBe('ready')

  // Issue #163 — relaunch the same roster MS and verify the damage carried
  // through the previous dock, then destroy it in-tactical and verify the
  // destruction exit writes hull 0 back to the roster.
  const relaunchRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.launchPlayerMs(),
  )
  expect(relaunchRes?.ok, `relaunch should succeed; got ${JSON.stringify(relaunchRes)}`).toBe(true)
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useCockpit.getState().piloting === 'ms',
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const relaunchedMs = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.msState(),
  )
  expect(
    relaunchedMs.hullCurrent,
    'relaunch should spawn the clone at the roster\'s (damaged) hull, not full hull',
  ).toBe(90)

  const destroyOk = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.setPilotedMsHullCheat(0, 0),
  )
  expect(destroyOk, 'setPilotedMsHullCheat(0, 0) should succeed').toBe(true)
  const destroyRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.onMsDestroyedCheat(),
  )
  expect(destroyRes, 'onMsDestroyedCheat should succeed').toBe(true)
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      until: () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__uclife__.msState() === null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        && (window as any).__uclife__.useCockpit.getState().piloting === null,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const rosterAfterDestroy = await sim.page.evaluate(
    (key) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getMs(key),
    STARTER_MS_KEY,
  )
  expect(rosterAfterDestroy, 'roster MS should still exist (as a wreck) after destruction').toBeTruthy()
  expect(rosterAfterDestroy!.hullCurrent, 'destruction should write hull 0 back to the roster').toBe(0)
  expect(rosterAfterDestroy!.armorCurrent, 'destruction should write armor 0 back to the roster').toBe(0)

  // Re-take the helm via takeFlagshipControl.
  const helmAgain = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.takeFlagshipControl(),
  )
  expect(helmAgain?.ok, `takeFlagshipControl should succeed; got ${JSON.stringify(helmAgain)}`).toBe(true)
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      until: () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__uclife__.useCockpit.getState().piloting === 'flagship'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        && (window as any).__uclife__.useCombatStore.getState().open === true,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  // Resolve cleanly via fastWinCombat.
  await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cs = (window as any).__uclife__.useCombatStore.getState()
    if (cs.paused) cs.togglePause()
  })
  const won = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fastWinCombat(),
  )
  expect(won, 'fastWinCombat returned false (no enemy entity)').toBeTruthy()
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useCombatStore.getState().open === false,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useClock.getState().mode === 'normal',
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useCockpit.getState().piloting === null,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)
})

// Issue #163 — endCombat's teardown destroyed the piloted MS's tactical
// clone in its CombatShipState cleanup loop BEFORE resetCockpitForEndCombat
// ran, so combat ending while the player was still flying the MS undocked
// (the common way fights end — winning while piloting) discarded the
// clone's damage and the roster MS came back pristine. Shared setup for the
// two regressions below: boot, board, helm, jump into combat, launch the MS
// and damage its clone, all WITHOUT docking back.
async function launchDamagedUndockedMs(sim: Sim): Promise<void> {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: REQUIRED_HANDLES })

  const setupOk = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = (window as any).__uclife__
    return u.cheatMoney(80000) && u.cheatPiloting(10)
  })
  expect(setupOk, 'cheatMoney+cheatPiloting failed at setup').toBeTruthy()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.boardShip())
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useScene.getState().activeId === 'playerShipInterior',
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const helmRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.takeHelmCheat(),
  )
  expect(helmRes?.ok, `takeHelmCheat should succeed; got ${JSON.stringify(helmRes)}`).toBe(true)

  const enemies = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listEnemies(),
  )
  expect(enemies && enemies.length > 0, 'no enemies present in spaceCampaign').toBeTruthy()

  await sim.page.evaluate((key) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.startCombatCheat('pirateLight', [], key)
  }, enemies[0].key)

  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      until: () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__uclife__.useCombatStore.getState().open === true
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        && (window as any).__uclife__.useCockpit.getState().piloting === 'flagship',
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const launchRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.launchPlayerMs(),
  )
  expect(launchRes?.ok, `launchPlayerMs should succeed; got ${JSON.stringify(launchRes)}`).toBe(true)
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useCockpit.getState().piloting === 'ms',
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const damageOk = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.setPilotedMsHullCheat(90, 5),
  )
  expect(damageOk, 'setPilotedMsHullCheat should succeed while an MS is deployed').toBe(true)
}

test('cockpit: endCombat(victory) while piloting an undocked MS syncs damage to the roster (#163)', async ({ sim }) => {
  await launchDamagedUndockedMs(sim)

  // Resolve WITHOUT docking first — this is the scenario the destroy loop
  // used to race: it wiped the clone before resetCockpitForEndCombat ran.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.endCombatCheat('victory'),
  )
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      until: () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__uclife__.useCombatStore.getState().open === false
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        && (window as any).__uclife__.useCockpit.getState().piloting === null,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const cloneAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.msState(),
  )
  expect(cloneAfter, 'the clone must be gone once combat has ended').toBeNull()

  const rosterAfter = await sim.page.evaluate(
    (key) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getMs(key),
    STARTER_MS_KEY,
  )
  expect(rosterAfter, 'roster MS should still exist after a won fight').toBeTruthy()
  expect(
    rosterAfter!.hullCurrent,
    'endCombat must write the undocked clone\'s damage back to the roster before destroying it',
  ).toBe(90)
  expect(
    rosterAfter!.armorCurrent,
    'endCombat must write the undocked clone\'s armor damage back to the roster before destroying it',
  ).toBe(5)
})

test('cockpit: endCombat(defeat) does not throw when the roster MS is destroyed with the lost flagship (#163)', async ({ sim }) => {
  await launchDamagedUndockedMs(sim)

  // The starter-fleet fixture stows ms-player-0 aboard the flagship
  // (storedOnShipKey: 'ship'), which applyDefeatConsequence destroys.
  // syncActiveMsToRosterIfLaunched must write back the clone's damage
  // before that destroy loop runs, and the subsequent loss of the roster
  // entity to applyDefeatConsequence must not throw (interaction guard —
  // the sync's own no-op-on-missing-entity behavior is exercised once the
  // roster entity is gone on any later call, not this one).
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.endCombatCheat('defeat'),
  )
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useClock.getState().mode === 'normal',
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const rosterAfterDefeat = await sim.page.evaluate(
    (key) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getMs(key),
    STARTER_MS_KEY,
  )
  expect(
    rosterAfterDefeat,
    'the starter MS aboard the lost flagship must be destroyed with it, not orphaned',
  ).toBeNull()
})
