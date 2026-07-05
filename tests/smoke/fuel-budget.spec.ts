// W1 Task 7 — contact/pursuit/fuel tuning.
//
// Encodes the spec's economy budget: a standard sortie (undock, intercept
// the nearest authored pirate to contact, return to dock) must fit within
// half of a starter tank. Runs WITHOUT setInfiniteFuelSupply (unlike Task
// 6's intercept-and-dock smoke) — that's the point, this proves the
// realistic-fuel round trip actually fits the budget.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife__.debugNavigate',
  '__uclife__.listEnemies',
  '__uclife__.shipPos',
  '__uclife__.useEngagement',
  '__uclife__.getGameState',
]

test('starter sortie round trip uses at most half the tank', async ({ sim }) => {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: REQUIRED_HANDLES })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const read = () => sim.page.evaluate(() => (window as any).__uclife__.getGameState().getPlayerFleet().getFuel())
  const before = await read()

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

  // Leg 1: intercept the nearest authored pirate to contact.
  const navRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key) => (window as any).__uclife__.debugNavigate({ kind: 'enemy', enemyKey: key }),
    nearestKey,
  )
  expect(navRes.ok, `debugNavigate({kind:'enemy'}) failed: ${navRes.message}`).toBe(true)

  await sim.stepUntil(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__uclife__.getGameState().getEngagement().isOpen()
  }, 60 * 12)

  // Decline via store reset — this budget test is about navigation fuel
  // economy, not tactical-combat resolution.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.useEngagement.getState().dismiss())

  // Leg 2: dock back at vonBraun.
  const dockRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.debugNavigate({ kind: 'dock', poiId: 'vonBraun' }),
  )
  expect(dockRes.ok, `debugNavigate({kind:'dock'}) failed: ${dockRes.message}`).toBe(true)

  await sim.stepUntil(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__uclife__.getGameState().getPlayerFleet().getDockedPoiId() === 'vonBraun'
  }, 60 * 24)

  const after = await read()
  const used = before.current - after.current
  expect(used, 'sortie round trip must fit in ≤50% of a starter tank').toBeLessThanOrEqual(0.5 * before.max)
})
