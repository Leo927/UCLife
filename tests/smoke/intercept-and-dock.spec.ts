// W1 Task 6 — intercept courses + reliable docking.
//
// 1. Intercept: debugNavigate({ kind: 'enemy' }) commits a Course that
//    chases the nearest authored pirate's live position every tick
//    (systems/spaceSim.ts retarget block) until contact opens the
//    engagement modal.
// 2. Course.destEnemyKey round-trips through save/load
//    (src/boot/saveHandlers/space.ts).
// 3. After declining the encounter, a dock course reliably parks the
//    ship AT the live POI position — not a stale snapshot in empty
//    space — while the POI keeps orbiting.
//
// System-level smoke: drives navigation via the debug handle rather than
// real clicks (journey specs own the click path; see
// .claude/skills/deterministic-tests/SKILL.md).

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife__.debugNavigate',
  '__uclife__.listEnemies',
  '__uclife__.shipPos',
  '__uclife__.poiLivePos',
  '__uclife__.courseSnapshot',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
  '__uclife__.useEngagement',
  '__uclife__.getGameState',
  '__uclife__.setInfiniteFuelSupply',
]

const SAVE_SLOT = 9
// Dock-arrival tolerance for "parked at the live POI, not empty space" —
// spaceConfig.autopilotArriveRadiusPx (4px) is the autopilot's own arrival
// tolerance; this check just needs to prove the ship is at the POI, not at
// its own weapons-grade thrust-cutoff precision.
const DOCK_POSITION_TOLERANCE_PX = 50

test('intercept course chases a live enemy to contact; dockAt reliably parks at an orbiting POI', async ({ sim }) => {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: REQUIRED_HANDLES })
  // This spec isolates the navigation/dock-retargeting loop under test from
  // fleet fuel economy (a separate concern with its own coverage — see
  // fleet-supply.spec.ts). starter-fleet's lightFreighter has only a
  // 16-unit tank; chasing a live lunar patrol to contact and back can
  // legitimately burn through it, which strands the ship with an active,
  // unfulfillable course and never satisfies the dock predicate below —
  // a real bug (see Design/ or the task report), but a fuel-economy one,
  // not the retargeting reliability this test is about.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.setInfiniteFuelSupply(true))

  const nearestKey = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = (window as any).__uclife__
    const ship = u.shipPos() as { x: number; y: number }
    const enemies = u.listEnemies() as { key: string; pos: { x: number; y: number } }[]
    let best: string | null = null
    let bestD2 = Infinity
    for (const en of enemies) {
      const dx = en.pos.x - ship.x
      const dy = en.pos.y - ship.y
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) { bestD2 = d2; best = en.key }
    }
    return best
  })
  expect(nearestKey, 'no authored enemies present in spaceCampaign').not.toBeNull()

  const navRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key) => (window as any).__uclife__.debugNavigate({ kind: 'enemy', enemyKey: key }),
    nearestKey,
  )
  expect(navRes.ok, `debugNavigate({kind:'enemy'}) failed: ${navRes.message}`).toBe(true)

  const committedKey = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.courseSnapshot().destEnemyKey,
  )
  expect(committedKey, 'Course.destEnemyKey not set after intercept navigateTo').toBe(nearestKey)

  // Save/load round-trip — proves destEnemyKey persists through
  // src/boot/saveHandlers/space.ts, not just the live in-memory Course.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate((slot) => (window as any).__uclife__.saveGame(slot), SAVE_SLOT)
  const loadRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (slot) => (window as any).__uclife__.loadGame(slot),
    SAVE_SLOT,
  )
  expect(loadRes.ok, `loadGame failed: ${JSON.stringify(loadRes)}`).toBe(true)
  const reloadedKey = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.courseSnapshot().destEnemyKey,
  )
  expect(reloadedKey, 'Course.destEnemyKey did not round-trip through save/load').toBe(nearestKey)

  await sim.stepUntil(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__uclife__.getGameState().getEngagement().isOpen()
  }, 60 * 12)

  const contactKey = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getEngagement().getEnemyKey(),
  )
  expect(contactKey, 'engagement modal opened against a different enemy than the intercept target')
    .toBe(nearestKey)

  // Decline via store reset (system smoke) — this test is about the
  // navigation/dock loop, not the tactical-combat resolution path.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.useEngagement.getState().dismiss())

  const dockRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.debugNavigate({ kind: 'dock', poiId: 'vonBraun' }),
  )
  expect(dockRes.ok, `debugNavigate({kind:'dock'}) failed: ${dockRes.message}`).toBe(true)

  await sim.stepUntil(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__uclife__.getGameState().getPlayerFleet().getDockedPoiId() === 'vonBraun'
  }, 60 * 24)

  // The dock-reliability check: dockedPoiId reads 'vonBraun' is not
  // enough on its own — the playtest-reported bug left the ship resting
  // at a stale point in empty space while dockedPoiId still read the
  // target POI. Assert the ship's actual position matches vonBraun's
  // *live* (still-orbiting) position.
  const [shipPos, poiPos] = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = (window as any).__uclife__
    return [u.shipPos(), u.poiLivePos('vonBraun')]
  })
  const dist = Math.hypot(shipPos.x - poiPos.x, shipPos.y - poiPos.y)
  expect(
    dist,
    `docked ship at (${shipPos.x}, ${shipPos.y}) is ${dist}px from vonBraun's live position ` +
    `(${poiPos.x}, ${poiPos.y}) — expected it parked at the POI, not resting in empty space`,
  ).toBeLessThan(DOCK_POSITION_TOLERANCE_PX)
})
