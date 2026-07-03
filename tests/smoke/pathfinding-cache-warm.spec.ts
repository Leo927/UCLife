import { test, expect } from './_fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = any

// Regression gate: the pathfinding wall/component/HPA caches must STAY WARM
// during steady-state gameplay. syncShipMarkers runs every tick; before this
// gate, its empty-gate branch re-locked already-locked bridge doors and called
// markPathfindingDirty() every tick, keeping the caches permanently dirty so
// every repath paid a full ~42ms component flood-fill (+ wall + HPA) rebuild —
// the "laggy when walking" stutter. With no ship state changing, ticking must
// produce ZERO dirty-marks and ZERO cache rebuilds.
//
// Deterministic-by-construction: asserts on invalidation COUNTS, never
// wall-clock ms, so it passes 1/1 on any runner load.
test('pathfinding caches stay warm across ticks when ship state is unchanged (regression gate)', async ({ sim }) => {
  await sim.boot({
    fixture: 'heavy-npc', // vonBraunCity — has drydock gates that exercise syncShipMarkers
    requireHandles: [
      '__uclife_test__.step',
      '__uclife__.enablePfCacheStats',
      '__uclife__.pfCacheStats',
    ],
  })

  // Let the first tick settle any initial door-lock state (empty gates lock
  // once on the first syncShipMarkers pass — a legitimate one-time invalidation).
  await sim.stepFor(2)

  // Start counting from a settled steady state. No ship docks/undocks in this
  // window, so nothing about walkable geometry changes.
  await sim.page.evaluate(() => (window as Win).__uclife__.enablePfCacheStats(true))

  await sim.stepFor(15)

  const pf: { dirtyMarks: number; wallRebuilds: number; compRebuilds: number } =
    await sim.page.evaluate(() => (window as Win).__uclife__.pfCacheStats())

  expect(
    pf.dirtyMarks,
    'steady-state ticks (no ship state change) must not mark pathfinding dirty — ' +
    'a per-tick dirty-mark keeps caches permanently dirty and makes every repath rebuild them',
  ).toBe(0)

  expect(
    pf.compRebuilds,
    'the O(COLS*ROWS) component flood-fill must not run during steady-state gameplay',
  ).toBe(0)

  expect(
    pf.wallRebuilds,
    'the wall grid must not be rebuilt during steady-state gameplay',
  ).toBe(0)
})
