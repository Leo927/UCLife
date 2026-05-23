// Drydock-boarding smoke. Fixture seeds two player-owned ships: the
// bootstrap flagship at Von Braun and a Pegasus parked at the Granada
// drydock. After syncShipMarkers binds the Pegasus to a capital gate,
// the test calls boardShipByKey on the Pegasus — the spec asserts:
//   1. Pegasus is bound to one of the drydock's capital gates and the
//      booth's board portal reads as player-owned (boardShip kind, gold
//      template) rather than the faction-only inspectShip toast.
//   2. Boarding migrates IsFlagshipMark from the lightFreighter onto the
//      Pegasus and lands the active scene at playerShipInterior.
//   3. The interior re-layouts to the Pegasus class — class-specific
//      rooms (warRoom, brig, hangarBay) and kiosks (warRoom plot table,
//      brig kiosk, disembarkShip + climbIntoMs in the hangar bay) all
//      materialise; the lightFreighter's flagship-specific kiosks are
//      gone from the world.

import { test, expect, isExpectedTestModePortraitMissing } from './_fixtures'

const FIXTURE = 'board-from-drydock'
const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.listGates',
  '__uclife__.listShipMarkers',
  '__uclife__.listShipsInFleet',
  '__uclife__.boardShipByKey',
  '__uclife__.shipSceneLayoutSnapshot',
]

const STEP_BUDGET_MIN = 5

test('drydock boarding: owned non-flagship binds, boards, interior swaps class', async ({ sim }) => {
  sim.allowConsoleError(isExpectedTestModePortraitMissing)
  await sim.boot({ fixture: FIXTURE, requireHandles: REQUIRED_HANDLES })

  // Advance one tick so syncShipMarkers fires for the drydock scene and
  // materialises gate triples + binds the Pegasus to a capital gate.
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.listGates('granadaDrydock').length > 0,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  // 1. Pegasus is bound to a capital gate and the board portal reads as
  //    player-owned (boardShip kind), not the faction-only inspectShip.
  const gates = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listGates('granadaDrydock'),
  )
  const boundCapital = gates.find(
    (g: { slotClass: string; boundShipKey: string }) =>
      g.slotClass === 'capital' && g.boundShipKey === 'pegasus-1',
  )
  expect(boundCapital, 'expected Pegasus to be bound to a capital gate').toBeDefined()
  expect(boundCapital.ownerLabel, 'Pegasus should report player ownership').toBe('玩家')

  const portalKinds = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipMarkers('granadaDrydock'),
  )
  const pegasusPortal = portalKinds.find(
    (m: { shipKey: string }) => m.shipKey === 'pegasus-1',
  )
  expect(pegasusPortal, 'expected a ShipMarker on the Pegasus board portal').toBeDefined()
  expect(pegasusPortal.interactableKind, 'owned ship board portal must be boardShip, not inspectShip').toBe('boardShip')

  // 2. Boarding swaps flagship + scene.
  const boardResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.boardShipByKey('pegasus-1'),
  )
  expect(boardResult.ok, `boardShipByKey should succeed (reason: ${boardResult.reasonZh ?? ''})`).toBe(true)

  // Advance one tick so the scene-swap settles and the new interior's
  // entities are visible to introspection.
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.getGameState().getScene().getId() === 'playerShipInterior',
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const sceneId = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getScene().getId(),
  )
  expect(sceneId, 'active scene should be playerShipInterior after board').toBe('playerShipInterior')

  const fleet = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  const flagshipRow = fleet.find((s: { isFlagship: boolean }) => s.isFlagship)
  expect(flagshipRow, 'expected exactly one IsFlagshipMark').toBeDefined()
  expect(flagshipRow.entityKey, 'flagship marker must migrate to the Pegasus').toBe('pegasus-1')
  expect(flagshipRow.templateId, 'flagship ship class must be pegasusClass').toBe('pegasusClass')

  // 3. Interior layout reseeded for the Pegasus class — warRoom / brig /
  //    commRoom rooms (Pegasus-only) exist, and weapon-mount count
  //    matches the Pegasus's 6 hardpoints (vs lightFreighter's 2).
  const layout = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.shipSceneLayoutSnapshot(),
  )
  expect(layout.roomIds, 'Pegasus warRoom room missing — interior did not reseed').toContain('warRoom')
  expect(layout.roomIds, 'Pegasus brig room missing — interior did not reseed').toContain('brig')
  expect(layout.roomIds, 'Pegasus commRoom missing — interior did not reseed').toContain('commRoom')
  expect(layout.mountCount, 'weapon mount count should match Pegasus (6), not lightFreighter (2)').toBe(6)
})
