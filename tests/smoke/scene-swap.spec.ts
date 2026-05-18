// scene-swap smoke. Two-leg flight:
//   1. Open the Von Braun flight modal via the UI store.
//   2. Click the real 购票 button.
//   3. Wait for the RAF-driven transition + scene to swap.
//   4. Repeat for the return leg (zumCity → vonBraunCity).

import { test, expect, DOM_COMMIT_TIMEOUT_MS, isExpectedTestModePortraitMissing } from './_fixtures'

const FIXTURE = 'player-with-cash-at-vb'
const VB_HUB = 'vonBraunCityAirport'
const ZUM_HUB = 'zumCityAirport'
const VB_SCENE = 'vonBraunCity'
const ZUM_SCENE = 'zumCity'
const BUY_LABEL = '购票'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.listAirports',
  'uclifeUI.getState',
  '__uclife__.useScene.getState',
  '__uclife__.useTransition.getState',
]

test('scene swap: VB → Zum City → VB via flight modal', async ({ sim }) => {
  sim.allowConsoleError(isExpectedTestModePortraitMissing)
  await sim.boot({ fixture: FIXTURE, requireHandles: REQUIRED_HANDLES })

  const initialScene = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getScene().getId(),
  )
  expect(initialScene, `fixture must boot in ${VB_SCENE}, got ${initialScene}`).toBe(VB_SCENE)

  const airports = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listAirports(),
  )
  const arrivalByHub = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    airports.filter((a: any) => a.placement).map((a: any) => [a.hubId, a.placement.arrivalPx]),
  )
  const zumArrival = arrivalByHub[ZUM_HUB]
  const vbArrival = arrivalByHub[VB_HUB]
  expect(zumArrival, `${ZUM_HUB} placement missing`).toBeTruthy()
  expect(vbArrival, `${VB_HUB} placement missing`).toBeTruthy()

  const flyVia = async (
    fromHubId: string,
    expectedSceneId: string,
    expectedArrivalPx: { x: number; y: number },
    label: string,
  ) => {
    await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (hubId) => (window as any).uclifeUI.getState().openFlight(hubId),
      fromHubId,
    )

    await sim.page.waitForSelector('.transit-terminal-go', {
      state: 'visible',
      timeout: DOM_COMMIT_TIMEOUT_MS,
    })

    const btnText = await sim.page.locator('.transit-terminal-go').first().textContent()
    expect(btnText, `${label}: expected buy button '${BUY_LABEL}'`).toBe(BUY_LABEL)

    await sim.page.click('.transit-terminal-go')

    await sim.page.waitForSelector('.transition-overlay', {
      state: 'detached',
      timeout: DOM_COMMIT_TIMEOUT_MS,
    })
    await sim.page.waitForFunction(
      (sceneId) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__uclife__.useScene.getState().activeId === sceneId
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        && (window as any).__uclife__.useTransition.getState().inProgress === false,
      expectedSceneId,
      { timeout: DOM_COMMIT_TIMEOUT_MS },
    )

    const after = await sim.page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gs = (window as any).__uclife__.getGameState()
      return {
        activeId: gs.getScene().getId(),
        pos: gs.getPlayerCharacter().getPosition(),
      }
    })
    expect(after.activeId, `${label}: scene id mismatch`).toBe(expectedSceneId)
    expect(after.pos.scene).toBe(expectedSceneId)
    expect(after.pos.x).toBe(expectedArrivalPx.x)
    expect(after.pos.y).toBe(expectedArrivalPx.y)
  }

  await flyVia(VB_HUB, ZUM_SCENE, zumArrival, 'leg 1 (vonBraunCity → zumCity)')
  await flyVia(ZUM_HUB, VB_SCENE, vbArrival, 'leg 2 (zumCity → vonBraunCity)')
})
