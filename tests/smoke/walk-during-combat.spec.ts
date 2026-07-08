// Reported bug: the player could not move in the ship interior during combat.
// Root cause was TWO time authorities — the tactical-combat pause and the
// world clock — so pausing the fight also froze on-foot movement, and leaving
// the helm dropped the walking avatar into that frozen world. The fix unifies
// them into ONE clock (clock.speed): leaving the helm mid-fight resumes it, so
// the flagship fights on AI while the player walks.
//
// This guards the fix at the integration level: through the REAL startCombat +
// leaveBridge wiring, leaving the helm mid-fight resumes the single clock, the
// engagement stays live, and the avatar is present in the walkable interior —
// i.e. the player can now walk (clock running) in the ship (avatar aboard)
// during combat (engagement live), the exact state that was frozen before.
//
// The core proof is the unit layer — cockpit.test.ts (leaveBridge resumes the
// clock) + combat.test.ts (the arena tick is gated on clock.speed). The
// physical on-foot walk during a live fight is exercised end-to-end, through
// real input, in journey-first-sortie.spec.ts's MS-sortie leg. (Test-mode
// advanceSimByGameMs runs movementSystem unconditionally, so a smoke cannot
// isolate the prod speed-GATE on movement in loop.ts anyway.)
import { test, expect } from './_fixtures'

test('one clock: leaving the helm mid-combat resumes time so the avatar can walk', async ({ sim }) => {
  await sim.boot({
    fixture: 'ms-sortie',
    requireHandles: [
      '__uclife_test__.step',
      '__uclife__.getGameState',
      '__uclife__.startCombatCheat',
      '__uclife__.leaveBridgeCheat',
      '__uclife__.combatEntities',
      '__uclife__.playerSnapshot',
    ],
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.startCombatCheat('pirate_corsair', [], null))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.stepUntil(() => (window as any).__uclife__.getGameState().getCombat().isOpen() === true, 5)

  // Combat opens auto-paused: the single clock is stopped.
  expect(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getCombat().isPaused()),
    'combat opens with the single clock stopped',
  ).toBe(true)

  // Leave the helm → flagship on AI, and the single clock RESUMES.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.leaveBridgeCheat())
  expect(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sim.page.evaluate(() => (window as any).__uclife__.getGameState().getCombat().isPaused()),
    'leaving the helm mid-fight must resume the single clock (the reported-bug fix)',
  ).toBe(false)

  // The engagement is still live — the player just stepped away from the helm.
  expect(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sim.page.evaluate(() => (window as any).__uclife__.combatEntities().some((e: any) => e.side === 'enemy')),
    'the engagement stays live while the player is off the helm',
  ).toBe(true)

  // The avatar is present in the walkable interior (not stranded at a helm that
  // no longer exists) — so with the clock running it is free to walk.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = await sim.page.evaluate(() => (window as any).__uclife__.playerSnapshot())
  expect(snap, 'the avatar must be aboard in the walkable ship interior after leaving the helm').not.toBeNull()

  // The flagship fights on AI while the player is off the helm: a small step of
  // the single (running) clock advances the arena — the enemy takes damage. On
  // the old two-timeline model the world clock and the arena were decoupled;
  // now one running clock drives both.
  const enemyHull = async (): Promise<number> => sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = (window as any).__uclife__.combatEntities().find((x: any) => x.side === 'enemy')
    return e ? (e.hullCurrent as number) : -1
  })
  const hullBefore = await enemyHull()
  await sim.stepFor(0.1)
  const hullAfter = await enemyHull()
  expect(hullBefore, 'the engagement must be live when the player leaves the helm').toBeGreaterThan(0)
  expect(hullAfter, 'the fight runs on AI off the helm — the enemy takes damage as the single clock advances').toBeLessThan(hullBefore)
})
