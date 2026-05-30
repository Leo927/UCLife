import { test, expect } from './_fixtures'

// Step 1 — NPC-only transit navigation edges (Design/phasing.md).
//
// 1. An NPC standing at transit kiosk A whose destination is kiosk B (far
//    across the city) routes through the transit portal: its computed foot-
//    path contains a teleport waypoint, and driving it through the movement
//    system lands it at kiosk B.
// 2. The player's click-to-move to the same destination NEVER routes through
//    a transit portal — the fare gate holds; the player must ride the kiosk.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = any

test('an NPC routes across a transit edge; the player never does', async ({ sim }) => {
  await sim.boot({
    fixture: 'npc-transit',
    requireHandles: [
      '__uclife_test__.step',
      '__uclife__.transitPortals',
      '__uclife__.placeEntityAtTile',
      '__uclife__.pathUsesPortal',
      '__uclife__.playerPathUsesPortal',
      '__uclife__.walkEntityViaMovement',
      '__uclife__.entityTile',
    ],
  })

  // vonBraunCity's transit terminals form portals. Read them at runtime —
  // kiosk tiles are procgen-placed, so the test never hard-codes them. Pick
  // the farthest-apart pair so the walking alternative is unambiguously more
  // expensive than the portal (the route across the city core to the AE
  // district), making the NPC's transit preference deterministic.
  const portal = await sim.page.evaluate(() => {
    const portals = (window as Win).__uclife__.transitPortals() as
      Array<{ aTile: { x: number; y: number }; bTile: { x: number; y: number } }>
    let best: typeof portals[number] | null = null
    let bestD = -1
    for (const p of portals) {
      const d = Math.hypot(p.aTile.x - p.bTile.x, p.aTile.y - p.bTile.y)
      if (d > bestD) { bestD = d; best = p }
    }
    return best
  })
  expect(portal, 'vonBraunCity should expose at least one transit portal (terminal pair)').not.toBeNull()

  // Stand the commuter at kiosk A.
  const placed = await sim.page.evaluate((a) => (window as Win).__uclife__.placeEntityAtTile('commuter', a), portal!.aTile)
  expect(placed, 'commuter should be repositioned at kiosk A').toBe(true)

  // 1. NPC routing across the edge: its foot-path to kiosk B uses the portal.
  const npcUsesPortal = await sim.page.evaluate((b) => (window as Win).__uclife__.pathUsesPortal('commuter', b), portal!.bTile)
  expect(npcUsesPortal, "the NPC's path to the far kiosk must traverse the transit portal").toBe(true)

  // 2. Fare-gate asymmetry: the player's path to the same destination must NOT
  //    use the portal — click-to-move can't bypass the fare.
  const playerUsesPortal = await sim.page.evaluate((b) => (window as Win).__uclife__.playerPathUsesPortal(b), portal!.bTile)
  expect(playerUsesPortal, "the player's click-to-move must NEVER auto-route through a transit edge").toBe(false)

  // Diegetic execution: walk the commuter through the movement system (no BT
  // override) and confirm it traverses the portal and arrives at kiosk B.
  const arrived = await sim.page.evaluate((b) =>
    (window as Win).__uclife__.walkEntityViaMovement('commuter', b, 60, 1), portal!.bTile)
  expect(arrived, 'commuter should resolve to a tile after the movement steps').not.toBeNull()
  const dist = Math.hypot(arrived!.x - portal!.bTile.x, arrived!.y - portal!.bTile.y)
  expect(dist, `commuter should arrive near kiosk B (got ${JSON.stringify(arrived)} vs ${JSON.stringify(portal!.bTile)})`).toBeLessThanOrEqual(2)
})
