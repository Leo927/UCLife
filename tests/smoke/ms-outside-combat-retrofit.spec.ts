// W4 Task 7 — climbIntoMs outside combat = retrofit shortcut, not a dead end.
//
// Aboard the flagship (playerShipInterior) with no combat in progress, walking
// up to an aboard MS's climb-in sprite and interacting used to toast
// "尚未进入战斗 · 无需出击". It now opens the MS retrofit panel (there is
// nothing to sortie into from a docked bridge, so the click becomes a
// retrofit shortcut — mirroring the adjacent msTerminal). In-combat sortie
// launch is unchanged and covered elsewhere.

import { test, expect } from './_fixtures'

/* eslint-disable @typescript-eslint/no-explicit-any */

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.interactableTileByKind',
  '__uclife__.movePlayerTo',
  '__uclife__.queueInteract',
]

const MS_KEY = 'ms-player-0'
const STEP_BUDGET_MIN = 5

test('climbIntoMs outside combat opens the retrofit panel', async ({ sim }) => {
  await sim.boot({ fixture: 'ms-starter', requireHandles: REQUIRED_HANDLES })

  // Precondition: aboard the flagship, not in combat.
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getScene().getId()),
    'ms-starter boots the player aboard the flagship interior',
  ).toBe('playerShipInterior')
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getCombat().isOpen()),
    'the retrofit redirect is the OUTSIDE-combat branch',
  ).toBe(false)

  const tile = await sim.page.evaluate(
    () => (window as any).__uclife__.interactableTileByKind('climbIntoMs'))
  expect(tile, 'an aboard MS must carry a climb-in sprite in the hangar bay').toBeTruthy()

  await sim.page.evaluate((t: { x: number; y: number }) => (window as any).__uclife__.movePlayerTo(t.x, t.y), tile)
  await sim.page.evaluate(() => (window as any).__uclife__.queueInteract())

  // The interaction resolves on the next sim tick; wait on the retrofit
  // store flag rather than a fixed sleep.
  // NB: the predicate runs in-browser and is closure-restricted — it can only
  // reference window, so the MS key is inlined rather than closed over.
  await sim.stepUntil(
    () => (window as any).uclifeUI.getState().msRetrofitKey === 'ms-player-0',
    STEP_BUDGET_MIN)

  await sim.page.waitForSelector('[data-testid="ms-retrofit-panel"]', { timeout: 2_000 })
  expect(
    await sim.page.evaluate(() => (window as any).uclifeUI.getState().msRetrofitKey),
    'climbing an aboard MS outside combat opens its retrofit panel',
  ).toBe(MS_KEY)
})
