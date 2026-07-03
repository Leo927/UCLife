import { test, expect, isExpectedTestModePortraitMissing, isKnownPixiBatcherStartup, isKnownPixiResolutionTeardown } from './_fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = any

// Regression gate: static city geometry (roads/walls/doors/buildings) must be
// tessellated ONCE and cached, not redrawn every render frame. Before this gate,
// PixiGroundRenderer called .clear()+redraw on every visible node every frame,
// forcing Pixi to re-tessellate + re-upload all of it continuously — the
// dominant cost while walking the dense procgen city (buildLine/toStrokeStyle/
// packAttributes owned the frame). With the camera stationary and no geometry
// change, the per-frame static-redraw count must be ZERO.
//
// Deterministic-by-construction: the assertion is on the INVARIANT (stationary
// camera ⇒ 0 static redraws), not on wall-clock ms, so it passes 1/1 under any
// load. The frozen test clock means no ship dock/undock can churn a door mid-window.
test('static city geometry is not re-tessellated every frame (regression gate)', async ({ sim }) => {
  sim.allowConsoleError(isExpectedTestModePortraitMissing)
  sim.allowConsoleError(isKnownPixiBatcherStartup)
  sim.allowConsoleError(isKnownPixiResolutionTeardown)

  await sim.boot({
    fixture: 'heavy-npc', // vonBraunCity — dense procgen geometry
    requireHandles: [
      '__uclife_test__.step',
      '__uclife__.movePlayerTo',
      '__uclife__.enableGroundStats',
      '__uclife__.groundStats',
    ],
  })

  // Place the player deep in the procgen city (x>=45) so walls/buildings/doors
  // fill the viewport, then wait for the render loop to mount its canvas.
  await sim.page.evaluate(() => (window as Win).__uclife__.movePlayerTo(70, 50))
  await sim.page.waitForFunction(() => document.querySelector('canvas') != null, undefined, { timeout: 30_000 })

  const res = await sim.page.evaluate(async () => {
    const U = (window as Win).__uclife__
    const raf = () => new Promise((r) => requestAnimationFrame(r))
    // Let the camera settle on the player and the initial geometry draw.
    for (let i = 0; i < 20; i++) await raf()

    // Reset counters, draw a few settled frames, then hold the camera stationary.
    U.enableGroundStats(true)
    for (let i = 0; i < 3; i++) await raf()
    const settled = U.groundStats()
    for (let i = 0; i < 40; i++) await raf()
    const held = U.groundStats()
    return {
      wallNodes: held.wallNodes,
      buildingNodes: held.buildingNodes,
      settledRedraws: settled.staticRedraws,
      heldRedraws: held.staticRedraws,
    }
  })

  // Sanity: the city geometry is actually on-screen (else the test is vacuous).
  expect(res.wallNodes + res.buildingNodes, 'dense city geometry must be visible for this test to be meaningful').toBeGreaterThan(0)

  // The invariant: 40 stationary render frames must trigger ZERO further
  // static-geometry re-tessellations. Pre-fix this grew by (roads+walls+doors+
  // buildings) every frame.
  expect(
    res.heldRedraws - res.settledRedraws,
    'a stationary camera must not re-tessellate any static geometry across render frames',
  ).toBe(0)
})
