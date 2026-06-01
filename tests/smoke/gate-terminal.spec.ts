// Hangar gate-terminal smoke. Fixture seeds a flagship docked at
// 'vonBraunDrydock' and drops the player in the drydock concourse. After
// the first tick, syncShipMarkers materialises the persistent gate
// triples and binds the flagship to the lowest-numbered smallCraft gate.
// The spec asserts:
//   1. Gates exist for the drydock, with C1..C{N} (capital) + S1..S{M}
//      (smallCraft) numbers and the bound ship's name + owner label.
//   2. Most gates are VACANT (boundShipKey === '').
//   3. The fixture's flagship is bound to exactly one gate; that gate's
//      shipName matches the fixture-authored '自由号'.
//   4. Opening the gate terminal mounts GateTerminalPanel.
//   5. The rename tab writes the new name to the Ship trait, and the
//      gate snapshot re-reflects it next tick.

import { test, expect, DOM_COMMIT_TIMEOUT_MS, isExpectedTestModePortraitMissing } from './_fixtures'

const FIXTURE = 'gate-at-drydock'
const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.listGates',
  '__uclife__.listShipsInFleet',
]

const STEP_BUDGET_MIN = 5
const RENAMED_TO = '英雄号'

test('gate terminal: dock binds, sign labels, terminal opens, rename writes', async ({ sim }) => {
  sim.allowConsoleError(isExpectedTestModePortraitMissing)
  await sim.boot({ fixture: FIXTURE, requireHandles: REQUIRED_HANDLES })

  // Advance one tick so syncShipMarkers fires and materialises gates.
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.listGates('vonBraunCity').length > 0,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  // 1. Gates exist with the configured prefix scheme.
  const gates = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listGates('vonBraunCity'),
  )
  expect(gates.length, 'expected gate triples in vonBraunDrydock').toBeGreaterThan(0)
  const capitalGates = gates.filter((g: { gateNumber: string }) => g.gateNumber.startsWith('C'))
  const smallCraftGates = gates.filter((g: { gateNumber: string }) => g.gateNumber.startsWith('S'))
  expect(capitalGates.length, 'no capital gates').toBeGreaterThan(0)
  expect(smallCraftGates.length, 'no smallCraft gates').toBeGreaterThan(0)

  // 2. Most gates are VACANT.
  const bound = gates.filter((g: { boundShipKey: string }) => g.boundShipKey !== '')
  const vacant = gates.filter((g: { boundShipKey: string }) => g.boundShipKey === '')
  expect(bound.length, 'expected exactly one bound gate (fixture has one ship)').toBe(1)
  expect(vacant.length, 'expected most gates to be vacant').toBeGreaterThan(0)

  // 3. The bound gate carries the fixture's name + player ownership.
  const boundGate = bound[0]
  expect(boundGate.slotClass, 'lightFreighter is smallCraft').toBe('smallCraft')
  expect(boundGate.shipName, `bound gate shipName should be 自由号`).toBe('自由号')
  expect(boundGate.ownerLabel, `bound gate owner should be 玩家`).toBe('玩家')

  // 4. Open the gate terminal via the UI store action (no DOM walk
  //    needed — the event handler funnels through openGateTerminal).
  await sim.page.evaluate((payload) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).uclifeUI.getState().openGateTerminal(payload)
  }, { gateNumber: boundGate.gateNumber, shipKey: boundGate.boundShipKey })

  await sim.page.waitForSelector('button[data-gate-tab="rename"]', { timeout: DOM_COMMIT_TIMEOUT_MS })

  // 5. Switch to the rename tab, type a new name, save.
  await sim.page.click('button[data-gate-tab="rename"]')
  await sim.page.waitForSelector('input[data-gate-rename-input]', { timeout: DOM_COMMIT_TIMEOUT_MS })
  await sim.page.fill('input[data-gate-rename-input]', RENAMED_TO)
  await sim.page.click('button[data-gate-rename-apply]')

  // The apply handler closes the rename tab; advance one tick so the
  // ground renderer re-snapshots and the gate listing reflects the
  // mutation.
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = (window as any).__uclife__.listGates('vonBraunCity')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return g.some((row: any) => row.boundShipKey && row.shipName === '英雄号')
      },
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const after = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listGates('vonBraunCity'),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renamed = after.find((g: any) => g.boundShipKey !== '')
  expect(renamed?.shipName, 'rename should write through to Ship.name').toBe(RENAMED_TO)
})
