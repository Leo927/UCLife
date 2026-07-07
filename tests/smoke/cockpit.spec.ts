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
  // W3 Task 7 — destruction now arms the eject-confirm beat (auto-paused);
  // the clone despawns on the real DOM confirm, into a drifting pod.
  await sim.page.waitForSelector('[data-eject-confirm]', { timeout: 5_000 })
  await sim.page.click('[data-eject-confirm-button]')
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

// W3 (ms-identity) Task 6 — cockpit HUD gauges. The player must be able to
// answer "dock now or fight on dry?" from the HUD alone: propellant, per-
// hardpoint ammo, and life-support gauges must render (with machine-readable
// `data-cockpit-*` value attributes) only while piloting the launched MS, and
// must track the roster entity's live resources under real input.
const GAUGE_REQUIRED_HANDLES = [
  '__uclife_test__.step',
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
  '__uclife__.dockPlayerMs',
  '__uclife__.getMs',
  '__uclife__.swapMsWeapon',
  '__uclife__.setMsSortieResources',
  '__uclife__.getPilotedMsState',
]

const GAUGE_STEP_BUDGET_MIN = 60
const GAUGE_ROSTER_MS_KEY = 'ms-player-0'   // ms-sortie fixture's pinned starter key
const GAUGE_HARDPOINT_ID = 'hp-0'
// ms-weapons.json5 ms-ballisticGun.ammoCapacity — a finite-ammo swap-in so
// this test's real auto-fire visibly depletes the ammo gauge (gm_pre's
// default hp-0 mount, ms-beamRifle, is Infinity ammo and never moves).
const BALLISTIC_GUN_AMMO_CAP = 30

test('cockpit: HUD gauges render only while piloting and track real propellant/ammo/boost', async ({ sim }) => {
  await sim.boot({ fixture: 'ms-sortie', requireHandles: GAUGE_REQUIRED_HANDLES })

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
    GAUGE_STEP_BUDGET_MIN,
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
    GAUGE_STEP_BUDGET_MIN,
  )

  // Combat opens auto-paused on first contact — unpause so the tactical
  // physics tick actually advances while we drive real input below.
  await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cs = (window as any).__uclife__.useCombatStore.getState()
    if (cs.paused) cs.togglePause()
  })

  // Swap hp-0 to a finite-ammo ballistic gun BEFORE launch — gm_pre's
  // default beamRifle never depletes (Infinity ammo), so this test's real
  // auto-fire would otherwise never move the ammo gauge.
  const swapOk = await sim.page.evaluate(
    ({ msKey, hpId }: { msKey: string; hpId: string }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.swapMsWeapon(msKey, hpId, 'ms-ballisticGun'),
    { msKey: GAUGE_ROSTER_MS_KEY, hpId: GAUGE_HARDPOINT_ID },
  )
  expect(swapOk, 'swapMsWeapon to ms-ballisticGun should succeed').toBe(true)

  // swapMsWeapon only rewrites mountedWeapons — currentAmmoByWeapon re-caps
  // on resupply completion (sortieResupply.ts), not on swap. Seed it to the
  // new weapon's cap explicitly (same convention as ms-sortie-loop.spec.ts)
  // so this test's ammo gauge starts from a known, finite value.
  const seedAmmoOk = await sim.page.evaluate(
    ({ msKey, hpId, cap }: { msKey: string; hpId: string; cap: number }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.setMsSortieResources(msKey, { currentAmmoByWeapon: { [hpId]: cap } }),
    { msKey: GAUGE_ROSTER_MS_KEY, hpId: GAUGE_HARDPOINT_ID, cap: BALLISTIC_GUN_AMMO_CAP },
  )
  expect(seedAmmoOk, 'setMsSortieResources ammo seed should succeed').toBe(true)

  // ── Not piloting yet — no cockpit gauges in the DOM ────────────────────
  expect(
    await sim.page.evaluate(() => document.querySelectorAll('[data-cockpit-gauge]').length),
    'cockpit gauges must not render before the MS is launched',
  ).toBe(0)

  const launchRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.launchPlayerMs(),
  )
  expect(launchRes?.ok, `launchPlayerMs: ${JSON.stringify(launchRes)}`).toBe(true)
  await sim.stepUntil(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.useCockpit.getState().piloting === 'ms',
    GAUGE_STEP_BUDGET_MIN,
  )

  // ── Gauges present while piloting ──────────────────────────────────────
  const propellantGauge = sim.page.locator('[data-cockpit-gauge="propellant"]')
  const lifeSupportGauge = sim.page.locator('[data-cockpit-gauge="lifeSupport"]')
  const boostGauge = sim.page.locator('[data-cockpit-gauge="boost"]')
  const ammoGauge = sim.page.locator(`[data-cockpit-ammo="${GAUGE_HARDPOINT_ID}"]`)
  const flagshipSliver = sim.page.locator('[data-cockpit-flagship-sliver]')
  await expect(propellantGauge, 'propellant gauge must render while piloting the MS').toHaveCount(1)
  await expect(lifeSupportGauge, 'life-support gauge must render while piloting the MS').toHaveCount(1)
  await expect(boostGauge, 'boost gauge must render while piloting the MS').toHaveCount(1)
  await expect(ammoGauge, `ammo gauge must render for ${GAUGE_HARDPOINT_ID}`).toHaveCount(1)
  await expect(flagshipSliver, 'flagship status sliver must render while piloting the MS').toHaveCount(1)

  const ammoAtLaunch = Number(await ammoGauge.getAttribute('data-cockpit-value'))
  expect(ammoAtLaunch, 'ammo gauge should read the swapped ballistic gun cap at launch').toBe(BALLISTIC_GUN_AMMO_CAP)

  const propellantAtLaunch = Number(await propellantGauge.getAttribute('data-cockpit-value'))
  expect(propellantAtLaunch, 'propellant gauge should read a positive roster value at launch').toBeGreaterThan(0)

  const boostCooldownAtLaunch = Number(await boostGauge.getAttribute('data-cockpit-cooldown'))
  expect(boostCooldownAtLaunch, 'boost gauge cooldown must read 0 before any boost is triggered').toBe(0)

  // ── Real KeyW thrust drains the propellant gauge ───────────────────────
  await sim.page.keyboard.down('KeyW')
  await sim.stepFor(0.05)
  await sim.page.keyboard.up('KeyW')
  await expect
    .poll(
      async () => Number(await propellantGauge.getAttribute('data-cockpit-value')),
      { message: 'propellant gauge must decrease under real KeyW thrust' },
    )
    .toBeLessThan(propellantAtLaunch)

  // ── Real weapon auto-fire drains the ammo gauge ────────────────────────
  await sim.stepUntil(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ms = (window as any).__uclife__.getMs('ms-player-0')
    return ms !== null && (ms.currentAmmoByWeapon['hp-0'] as number) < 30
  }, GAUGE_STEP_BUDGET_MIN)
  await expect
    .poll(
      async () => Number(await ammoGauge.getAttribute('data-cockpit-value')),
      { message: 'ammo gauge must decrease once real auto-fire consumes a round' },
    )
    .toBeLessThan(BALLISTIC_GUN_AMMO_CAP)

  // ── Low-resource visual cue (sortie.json5 cockpitLowResourceFrac) ──────
  // Also disarms hp-0 (0 rounds) so the boost/cooldown scenario below has a
  // stable live target — same mitigation ms-boost.spec.ts uses: without it,
  // the MS's own continuing auto-fire can end the fight (or trigger the
  // first-contact/hull-threshold auto-pause) mid-stepUntil, freezing
  // boostCooldownSec's countdown along with the rest of combatSystem.
  const lowSeedOk = await sim.page.evaluate(
    ({ msKey, hpId }: { msKey: string; hpId: string }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.setMsSortieResources(msKey, { currentAmmoByWeapon: { [hpId]: 0 } }),
    { msKey: GAUGE_ROSTER_MS_KEY, hpId: GAUGE_HARDPOINT_ID },
  )
  expect(lowSeedOk, 'setMsSortieResources should succeed').toBe(true)
  await expect(ammoGauge, 'ammo gauge must switch to its low-resource visual near depletion').toHaveClass(/is-low/)

  // ── Real KeyF boost sets the cooldown gauge, which clears over sim time ─
  await sim.page.keyboard.press('KeyF')
  await expect
    .poll(
      async () => Number(await boostGauge.getAttribute('data-cockpit-cooldown')),
      { message: 'boost gauge cooldown must go positive immediately after a real KeyF trigger' },
    )
    .toBeGreaterThan(0)
  await sim.stepUntil(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (window as any).__uclife__.getPilotedMsState()
    return !!s && s.boostCooldownSec <= 0
  }, GAUGE_STEP_BUDGET_MIN)
  await expect
    .poll(
      async () => Number(await boostGauge.getAttribute('data-cockpit-cooldown')),
      { message: 'boost gauge cooldown must clear back to 0 once combat.ts\'s cooldown timer elapses' },
    )
    .toBe(0)

  // ── Dock — gauges vanish ────────────────────────────────────────────────
  const dockRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.dockPlayerMs(true),
  )
  expect(dockRes?.ok, `dockPlayerMs: ${JSON.stringify(dockRes)}`).toBe(true)
  await sim.stepUntil(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.useCockpit.getState().piloting === null,
    GAUGE_STEP_BUDGET_MIN,
  )
  await expect(
    sim.page.locator('[data-cockpit-gauge]'),
    'cockpit gauges must not render after docking',
  ).toHaveCount(0)
})
