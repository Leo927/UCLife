/**
 * Phase 6.3.A — Colony claim smoke test.
 *
 * Verifies the end-to-end take-possession flow:
 *   1. Player boots inside the Mariko Refinery colony scene.
 *   2. Colony is unowned at boot.
 *   3. Claiming via the debug handle seals IsPlayerColony.
 *   4. Ownership survives a save → load round-trip.
 *
 * The admin-chair walk-up and UI interaction are intentionally driven
 * through __uclife__ debug handles (deterministic-tests rule 1+2): no
 * DOM clicks, no fixed sleep.
 */
import { test, expect } from './_fixtures'

const FIXTURE = 'player-flagship-near-derelict'
const POI_ID = 'marikoRefinery'
const SCENE_ID = 'marikoRefineryScene'
const SAVE_SLOT = 3

test('colony claim — boot, claim, save/load round-trip', async ({ sim }) => {
  await sim.boot({
    fixture: FIXTURE,
    requireHandles: [
      '__uclife_test__.step',
      '__uclife__.getGameState',
      '__uclife__.saveGame',
      '__uclife__.loadGame',
      '__uclife__.claimColony',
    ],
  })

  // 1. Player should be in the colony scene.
  const sceneId = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getScene().getId(),
  )
  expect(sceneId, 'player should be in the colony scene after boot').toBe(SCENE_ID)

  // 2. Colony must be unowned at boot.
  const beforeClaim = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.getGameState().getColonyOwnership(poi),
    POI_ID,
  )
  expect(beforeClaim.isPlayerOwned, 'colony must be unowned at fixture boot').toBe(false)

  // 3. Claim the colony via the debug handle (bypasses UI — deterministic).
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.claimColony(poi, null),
    POI_ID,
  )

  const afterClaim = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.getGameState().getColonyOwnership(poi),
    POI_ID,
  )
  expect(afterClaim.isPlayerOwned, 'IsPlayerColony should be set after claim').toBe(true)

  // 4. Save → load round-trip: ownership must survive.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (slot: number) => { await (window as any).__uclife__.saveGame(slot) },
    SAVE_SLOT,
  )

  const loadResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (slot: number) => (window as any).__uclife__.loadGame(slot),
    SAVE_SLOT,
  )
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)

  const afterLoad = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.getGameState().getColonyOwnership(poi),
    POI_ID,
  )
  expect(afterLoad.isPlayerOwned, 'ownership must persist after save → load').toBe(true)
})
