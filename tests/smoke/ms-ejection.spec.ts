// W3 (ms-identity) Task 7 system smoke — ejection with stakes.
//
// Proves the ejection loop against the deterministic substrate:
//   1. Player MS destroyed → tactical auto-pauses + the eject-confirm modal
//      (real DOM) opens; confirming spawns a drifting pod, combat resumes
//      with the player as observer; victory recovers the pilot and applies
//      the physiology injury (permadeath off).
//   2. Life support drained to zero forces the same eject beat.
//   3. A hostile reaching the pod captures it (probability pinned to 1):
//      permadeath-off → rescued-later beat (injury, run continues);
//      permadeath-on + survival roll pinned to fail → run end (Health.dead).
//   4. NPC wing destroyed → wing pod; the fate roll (pinned) either kills
//      the pilot NPC through the crew-death route or recovers them injured.
//
// System smoke (not a journey): startCombatCheat + hull/resource seeds are
// debug verbs; the eject confirm itself is a REAL DOM click, per the brief.

import { test, expect, type Sim } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.startCombatCheat',
  '__uclife__.endCombatCheat',
  '__uclife__.breakDownEnemiesCheat',
  '__uclife__.tickCombatSystem',
  '__uclife__.useCombatStore',
  '__uclife__.useCockpit',
  '__uclife__.launchPlayerMs',
  '__uclife__.msState',
  '__uclife__.getMs',
  '__uclife__.setPilotedMsHullCheat',
  '__uclife__.onMsDestroyedCheat',
  '__uclife__.setMsSortieResources',
  '__uclife__.ejectionState',
  '__uclife__.setPermadeathCheat',
  '__uclife__.setEjectionConfigCheat',
  '__uclife__.setCombatPosCheat',
  '__uclife__.destroyWingCheat',
  '__uclife__.getWings',
  '__uclife__.npcHealthByKey',
  '__uclife__.npcConditionsByKey',
  '__uclife__.playerHealthState',
  '__uclife__.playerConditionsList',
]

const STEP_BUDGET_MIN = 60
const RIDE_MS_KEY = 'ms-player-0'
const WING_MS_KEY = 'ms-w'
const WING_PILOT_KEY = 'pilot-w'
// data/conditions.json5 — sortie.json5 ejection.pilotInjuryConditionId.
const INJURY_CONDITION_ID = 'concussion'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Boot the ejection fixture straight into an open, unpaused engagement.
async function bootIntoCombat(sim: Sim): Promise<void> {
  await sim.boot({ fixture: 'ms-ejection', requireHandles: REQUIRED_HANDLES })
  await sim.page.evaluate(() => (window as any).__uclife__.startCombatCheat('pirateLight', [], null))
  await sim.stepUntil(() => (window as any).__uclife__.useCombatStore.getState().open === true, STEP_BUDGET_MIN)
  await sim.page.evaluate(() => {
    const cs = (window as any).__uclife__.useCombatStore.getState()
    if (cs.paused) cs.togglePause()
  })
}

// Launch the player's MS and wait until the cockpit binds to it.
async function launchPlayerMs(sim: Sim): Promise<void> {
  const launchRes = await sim.page.evaluate(() => (window as any).__uclife__.launchPlayerMs())
  expect(launchRes?.ok, `launchPlayerMs should succeed; got ${JSON.stringify(launchRes)}`).toBe(true)
  await sim.stepUntil(() => (window as any).__uclife__.useCockpit.getState().piloting === 'ms', STEP_BUDGET_MIN)
}

// Destroy the piloted MS through the canonical path and confirm the eject
// beat via the REAL DOM modal button. Returns after the pod exists.
async function destroyAndConfirmEject(sim: Sim): Promise<void> {
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.setPilotedMsHullCheat(0, 0)),
    'setPilotedMsHullCheat(0,0) should succeed while the MS is deployed',
  ).toBe(true)
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.onMsDestroyedCheat()),
    'onMsDestroyedCheat should trigger the eject beat',
  ).toBe(true)

  // The destruction beat auto-pauses (post-combat.md designed pause set) and
  // arms the confirm.
  const beat = await sim.page.evaluate(() => ({
    paused: (window as any).__uclife__.useCombatStore.getState().paused,
    pendingConfirm: (window as any).__uclife__.ejectionState().pendingConfirm,
  }))
  expect(beat.paused, 'MS destruction must auto-pause the tactical').toBe(true)
  expect(beat.pendingConfirm, 'the eject confirm beat must be armed').toBe(true)

  // Real DOM confirm — the modal is a beat, not a choice.
  await sim.page.waitForSelector('[data-eject-confirm]', { timeout: 5_000 })
  await sim.page.click('[data-eject-confirm-button]')

  await sim.stepUntil(() => (window as any).__uclife__.ejectionState().pods.length === 1, STEP_BUDGET_MIN)
}

test('ms-ejection: destroy → confirm beat → pod → victory recovery applies the injury', async ({ sim }) => {
  await bootIntoCombat(sim)
  await launchPlayerMs(sim)
  await destroyAndConfirmEject(sim)

  const after = await sim.page.evaluate(() => ({
    ejection: (window as any).__uclife__.ejectionState(),
    ms: (window as any).__uclife__.msState(),
    piloting: (window as any).__uclife__.useCockpit.getState().piloting,
    combat: (window as any).__uclife__.useCombatStore.getState(),
  }))
  expect(after.ejection.pendingConfirm, 'confirm must clear the pending beat').toBe(false)
  expect(after.ejection.pods[0].kind, 'the drifting pod is the player pod').toBe('player')
  expect(after.ms, 'the MS clone must despawn on eject').toBeNull()
  expect(after.piloting, 'the pilot is in the pod — no piloted unit').toBeNull()
  expect(after.combat.open, 'the tactical view stays open — the player watches').toBe(true)
  expect(after.combat.paused, 'combat resumes after the confirm beat').toBe(false)

  // The pod drifts under sim time (velocity inherited from the dead MS).
  const rosterAfterEject = await sim.page.evaluate(
    (key) => (window as any).__uclife__.getMs(key), RIDE_MS_KEY,
  )
  expect(rosterAfterEject.hullCurrent, 'destruction writes hull 0 back to the roster').toBe(0)

  // Victory with the flagship alive → pod recovered; permadeath-off applies
  // the ejection injury through the physiology path.
  await sim.page.evaluate(() => (window as any).__uclife__.breakDownEnemiesCheat())
  await sim.stepUntil(() => (window as any).__uclife__.useCombatStore.getState().open === false, STEP_BUDGET_MIN)

  const outcome = await sim.page.evaluate(() => ({
    pods: (window as any).__uclife__.ejectionState().pods,
    conditions: (window as any).__uclife__.playerConditionsList(),
    health: (window as any).__uclife__.playerHealthState(),
  }))
  expect(outcome.pods, 'the pod resolves at engagement end').toHaveLength(0)
  expect(
    outcome.conditions,
    'victory recovery with permadeath off must apply the ejection injury',
  ).toContain(INJURY_CONDITION_ID)
  expect(outcome.health?.dead, 'a recovered pilot is alive').toBe(false)
})

test('ms-ejection: life support at zero forces the eject beat', async ({ sim }) => {
  await bootIntoCombat(sim)
  await launchPlayerMs(sim)

  expect(
    await sim.page.evaluate(
      (key) => (window as any).__uclife__.setMsSortieResources(key, { currentLifeSupport: 0.01 }),
      RIDE_MS_KEY,
    ),
    'setMsSortieResources should seed a near-empty life-support pool',
  ).toBe(true)

  // The continuous life-support drain (Task 3b) hits the floor within a tick
  // of sim time → forced eject arms the same confirm beat.
  await sim.stepUntil(() => (window as any).__uclife__.ejectionState().pendingConfirm === true, STEP_BUDGET_MIN)
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.useCombatStore.getState().paused),
    'the forced eject must auto-pause the tactical',
  ).toBe(true)

  await sim.page.waitForSelector('[data-eject-confirm]', { timeout: 5_000 })
  await sim.page.click('[data-eject-confirm-button]')
  await sim.stepUntil(() => (window as any).__uclife__.ejectionState().pods.length === 1, STEP_BUDGET_MIN)

  const state = await sim.page.evaluate(() => ({
    ms: (window as any).__uclife__.msState(),
    pods: (window as any).__uclife__.ejectionState().pods,
  }))
  expect(state.ms, 'the abandoned MS clone despawns on forced eject').toBeNull()
  expect(state.pods[0].kind, 'the forced eject spawns the player pod').toBe('player')
})

// Shared driver for the two hostile-reach capture branches: eject, pin the
// capture roll to certain, park the hostile on top of the pod, and advance
// until the pod is gone.
async function ejectAndGetCaptured(sim: Sim): Promise<void> {
  await destroyAndConfirmEject(sim)
  const pod = (await sim.page.evaluate(() => (window as any).__uclife__.ejectionState())).pods[0]
  await sim.page.evaluate((pos) => {
    (window as any).__uclife__.setCombatPosCheat('enemy-ship-0', pos.x, pos.y)
  }, { x: pod.pos.x, y: pod.pos.y })
  await sim.stepUntil(() => (window as any).__uclife__.ejectionState().pods.length === 0, STEP_BUDGET_MIN)
}

test('ms-ejection: hostile reach captures the pod — permadeath off rescues the pilot injured', async ({ sim }) => {
  await bootIntoCombat(sim)
  await launchPlayerMs(sim)
  await sim.page.evaluate(() => {
    const u = (window as any).__uclife__
    u.setPermadeathCheat(false)
    u.setEjectionConfigCheat({ podCaptureProbability: 1 })
  })
  await ejectAndGetCaptured(sim)

  const state = await sim.page.evaluate(() => ({
    health: (window as any).__uclife__.playerHealthState(),
    conditions: (window as any).__uclife__.playerConditionsList(),
    combatOpen: (window as any).__uclife__.useCombatStore.getState().open,
  }))
  expect(state.health?.dead, 'permadeath off — capture is a rescued-later beat, not a run end').toBe(false)
  expect(state.conditions, 'the captured-then-rescued pilot carries the ejection injury').toContain(INJURY_CONDITION_ID)
  expect(state.combatOpen, 'combat continues — the flagship is still fighting').toBe(true)
})

test('ms-ejection: permadeath on — capture with a failed survival roll ends the run', async ({ sim }) => {
  await bootIntoCombat(sim)
  await launchPlayerMs(sim)
  await sim.page.evaluate(() => {
    const u = (window as any).__uclife__
    u.setPermadeathCheat(true)
    u.setEjectionConfigCheat({ podCaptureProbability: 1, podSurvivalRollPermadeath: 1 })
  })
  await ejectAndGetCaptured(sim)

  const health = await sim.page.evaluate(() => (window as any).__uclife__.playerHealthState())
  expect(health?.dead, 'permadeath on + failed survival roll must end the run (Health.dead)').toBe(true)
})

// Wing-pod fate: destroy the AI wing through the canonical path, pin the
// recovery roll, resolve at engagement end.
async function launchWingAndDestroy(sim: Sim): Promise<void> {
  await sim.page.waitForSelector('[data-tactical-order="msLaunchAuth"]:not([disabled])', { timeout: 5_000 })
  await sim.page.click('[data-tactical-order="msLaunchAuth"]')
  await sim.stepUntil(() => (window as any).__uclife__.getWings().length === 1, STEP_BUDGET_MIN)

  expect(
    await sim.page.evaluate((key) => (window as any).__uclife__.destroyWingCheat(key), WING_MS_KEY),
    'destroyWingCheat should route the wing through onWingDestroyed',
  ).toBe(true)
  const pods = (await sim.page.evaluate(() => (window as any).__uclife__.ejectionState())).pods
  expect(pods, 'the destroyed wing must eject a pod').toHaveLength(1)
  expect(pods[0].kind, 'the pod is a wing pod').toBe('wing')
  expect(pods[0].pilotKey, 'the pod carries the assigned pilot').toBe(WING_PILOT_KEY)
}

test('ms-ejection: wing pod lost — the pilot NPC dies through the crew-death route', async ({ sim }) => {
  await bootIntoCombat(sim)
  await sim.page.evaluate(() => (window as any).__uclife__.setEjectionConfigCheat({ wingPodRecoveryProbability: 0 }))
  await launchWingAndDestroy(sim)

  await sim.page.evaluate(() => (window as any).__uclife__.endCombatCheat('victory'))
  await sim.stepUntil(() => (window as any).__uclife__.useCombatStore.getState().open === false, STEP_BUDGET_MIN)

  const state = await sim.page.evaluate((args) => ({
    health: (window as any).__uclife__.npcHealthByKey(args.pilot),
    ms: (window as any).__uclife__.getMs(args.ms),
  }), { pilot: WING_PILOT_KEY, ms: WING_MS_KEY })
  expect(state.health, 'the pilot NPC must still exist as an entity').not.toBeNull()
  expect(state.health!.dead, 'a lost wing pod kills the pilot NPC (crew-loss texture)').toBe(true)
  expect(state.ms.pilotId, 'the dead pilot\'s seat is released on the wreck').toBe('')
})

test('ms-ejection: wing pod recovered — the pilot survives with an injury', async ({ sim }) => {
  await bootIntoCombat(sim)
  await sim.page.evaluate(() => (window as any).__uclife__.setEjectionConfigCheat({
    wingPodRecoveryProbability: 1,
    wingPodInjuryProbability: 1,
  }))
  await launchWingAndDestroy(sim)

  await sim.page.evaluate(() => (window as any).__uclife__.endCombatCheat('victory'))
  await sim.stepUntil(() => (window as any).__uclife__.useCombatStore.getState().open === false, STEP_BUDGET_MIN)

  const state = await sim.page.evaluate((args) => ({
    health: (window as any).__uclife__.npcHealthByKey(args.pilot),
    conditions: (window as any).__uclife__.npcConditionsByKey(args.pilot),
  }), { pilot: WING_PILOT_KEY })
  expect(state.health!.dead, 'a recovered wing pilot survives').toBe(false)
  expect(
    state.conditions,
    'the recovered pilot carries the ejection injury via the physiology path',
  ).toContain(INJURY_CONDITION_ID)
})
