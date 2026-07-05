// Task 4 (W2 command layer) — DP commit lands in the war room.
//
// Before this test, deployment commit was debug-handle-only
// (commitShipToEngagement / uncommitShipFromEngagement, exercised by
// cp-dp.spec.ts with no UI surface). This smoke drives the real war-room
// panel: walk onto the flagship's warRoom kiosk + press interact (mirrors
// tests/smoke/ms-custody.spec.ts's movePlayerTo + queueInteract walk-up),
// then click the DP commit toggle like a player would.
//
// Reuses the cp-dp fixture (flagship dpCost 3, escort-a dpCost 2, escort-b
// dpCost 10; player piloting level 50 -> dpCap 8 per cp-dp.spec.ts's
// documented formula walkthrough).

import { test, expect, DOM_COMMIT_TIMEOUT_MS } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.setIsInActiveFleet',
  '__uclife__.boardShip',
  '__uclife__.interactableTileByKind',
  '__uclife__.movePlayerTo',
  '__uclife__.queueInteract',
  '__uclife__.deploymentDescribe',
  '__uclife__.computeDpCap',
]

const EXPECTED_DP_CAP = 8
const ESCORT_A_DP_COST = 2
const ESCORT_B_DP_COST = 10
const STEP_BUDGET_MIN = 5

test('war room: DP commit toggle, cap display, over-budget refusal', async ({ sim }) => {
  await sim.boot({ fixture: 'cp-dp', requireHandles: REQUIRED_HANDLES })

  // Promote both escorts into the active fleet — only active ships get a
  // DP row (the reserve tray isn't part of the deployment budget).
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.setIsInActiveFleet('escort-a', true),
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.setIsInActiveFleet('escort-b', true),
  )

  // Board the flagship, then walk onto its warRoom kiosk + press interact —
  // the same primitive ms-custody.spec.ts uses for its depot-terminal walk.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.boardShip())
  await sim.stepUntil(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getScene().getId() === 'playerShipInterior',
    STEP_BUDGET_MIN,
  )

  const warRoomTile = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.interactableTileByKind('warRoom'),
  )
  expect(warRoomTile, 'warRoom kiosk not found in playerShipInterior').toBeTruthy()

  await sim.page.evaluate(
    (tile) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.movePlayerTo(tile.x, tile.y),
    warRoomTile,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.queueInteract())
  await sim.stepUntil(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).uclifeUI.getState().warRoomOpen === true,
    STEP_BUDGET_MIN,
  )

  await sim.page.waitForSelector('[data-war-room]', { timeout: DOM_COMMIT_TIMEOUT_MS })

  // DP cap display matches the formula (piloting level 50 -> 8, per
  // cp-dp.spec.ts).
  const capAttr = await sim.page.getAttribute('[data-war-room-dp-cap]', 'data-war-room-dp-cap')
  expect(Number(capAttr), 'DP cap header should show the computed cap').toBe(EXPECTED_DP_CAP)

  const dpCapText = await sim.page.textContent('[data-war-room-dp-cap]')
  expect(dpCapText, 'DP header should show committed/cap').toContain(`0/${EXPECTED_DP_CAP}`)

  // Deploy-everything hint line present.
  expect(await sim.page.textContent('body')).toContain('未指派时全体出击')

  // Flagship row: implicitly committed, no commit toggle, auto-deploy badge.
  const flagshipCommitButton = await sim.page.$('[data-war-room-dp-commit="ship"]')
  expect(flagshipCommitButton, 'flagship must not render a commit toggle').toBeNull()
  expect(await sim.page.textContent('body')).toContain('旗舰·自动部署')

  // Per-ship DP chips visible for both active escorts.
  const rowA = await sim.page.textContent('[data-war-room-dp-row="escort-a"]')
  const rowB = await sim.page.textContent('[data-war-room-dp-row="escort-b"]')
  expect(rowA, 'escort-a DP row missing dpCost chip').toContain(`DP ${ESCORT_A_DP_COST}`)
  expect(rowB, 'escort-b DP row missing dpCost chip').toContain(`DP ${ESCORT_B_DP_COST}`)

  // Commit escort-a (dpCost 2) via a real click — fits under cap 8.
  await sim.page.click('[data-war-room-dp-commit="escort-a"]')

  const pressedA = await sim.page.getAttribute('[data-war-room-dp-commit="escort-a"]', 'aria-pressed')
  expect(pressedA, 'escort-a toggle should read aria-pressed=true after commit').toBe('true')

  const deploymentAfterA = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.deploymentDescribe(),
  )
  expect(deploymentAfterA.committedShipKeys).toContain('escort-a')
  expect(deploymentAfterA.committed).toBe(ESCORT_A_DP_COST)

  // Commit escort-b (dpCost 10) — 2 + 10 = 12 > cap 8 -> refused, no debit,
  // refusal toast surfaces the exact copy the brief specifies.
  await sim.page.click('[data-war-room-dp-commit="escort-b"]')

  const pressedB = await sim.page.getAttribute('[data-war-room-dp-commit="escort-b"]', 'aria-pressed')
  expect(pressedB, 'escort-b toggle must stay unpressed after a refused over-budget commit').toBe('false')

  const deploymentAfterB = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.deploymentDescribe(),
  )
  expect(deploymentAfterB.committedShipKeys, 'over-cap commit must not change committed set').not.toContain('escort-b')
  expect(deploymentAfterB.committed, 'over-cap commit must not change the committed total').toBe(ESCORT_A_DP_COST)

  const toasts = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).uclifeUI.getState().toasts,
  )
  expect(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toasts.some((toast: any) => toast.text === '超出部署点上限'),
    `expected the over-budget refusal toast; got ${JSON.stringify(toasts)}`,
  ).toBe(true)

  // Uncommit escort-a — toggle flips back, deployment total returns to 0.
  await sim.page.click('[data-war-room-dp-commit="escort-a"]')
  const pressedAAfterUncommit = await sim.page.getAttribute('[data-war-room-dp-commit="escort-a"]', 'aria-pressed')
  expect(pressedAAfterUncommit).toBe('false')
  const deploymentAfterUncommit = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.deploymentDescribe(),
  )
  expect(deploymentAfterUncommit.committed).toBe(0)
})
