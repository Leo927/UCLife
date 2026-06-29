import { test, expect } from './_fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = any

// A player click onto an unreachable target (sealed behind a door overlay that
// shares the start's wall component) must fail fast via the door-aware
// reachability gate — not by exhausting the abstract graph. A reachable target
// must not trip the gate.
test('unreachable click fails fast via the reachability gate; reachable click does not', async ({ sim }) => {
  await sim.boot({
    fixture: 'player-with-cash-at-vb',
    requireHandles: [
      '__uclife_test__.step',
      '__uclife__.pfDiagSealedProbe',
      '__uclife__.pfDiagOpenProbe',
    ],
  })

  const sealed = await sim.page.evaluate(() => (window as Win).__uclife__.pfDiagSealedProbe())
  expect(
    sealed.found,
    `vonBraunCity should expose an unreachable target the gate catches: ${JSON.stringify(sealed)}`,
  ).toBe(true)
  expect(sealed.pathLen, 'player path into the sealed target must be empty').toBe(0)
  expect(
    sealed.reachabilityGateFail,
    'the door-aware reachability gate must catch the sealed target (not abstractAStar exhaustion)',
  ).toBeGreaterThan(0)

  const open = await sim.page.evaluate(() => (window as Win).__uclife__.pfDiagOpenProbe())
  expect(open.found, 'a reachable open target near the player should exist').toBe(true)
  expect(open.pathLen, 'player path to an open target must be non-empty').toBeGreaterThan(0)
  expect(open.reachabilityGateFail, 'the gate must not fire for a reachable target').toBe(0)
})
