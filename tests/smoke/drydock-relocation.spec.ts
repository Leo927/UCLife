// Drydock-relocation smoke (Design/phasing.md § NPC transit navigation §
// Step 2). The Granada drydock is folded into vonBraunCity as a spatially
// disconnected, player-hidden region reached only by the orbital lift.
//
// Asserts the design's acceptance criteria:
//   1. Riding the lift charges the up fare, advances the clock, and lands the
//      player in the drydock region — same vonBraunCity world, no scene swap.
//   2. Drydock NPCs tick on the vonBraunCity loop (they acquire jobs) rather
//      than being frozen as an off-map scene.
//   3. The drydock buildings are absent from the world map and the drydock
//      tiles sit outside the city camera region.
//   4. An NPC foot-routes from the city to the drydock bar via the lift
//      transit portal and arrives.
//   5. No `vonBraunDrydock` scene world remains; the lift is a same-world
//      transit edge (sceneIdA === sceneIdB), not a cross-scene migration.

import { test, expect } from './_fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = any

const FIXTURE = 'drydock'
const LIFT_ID = 'vonBraunDrydockLift'
const SCENE = 'vonBraunCity'
const FARE_UP = 500
const LIFT_DURATION_MIN = 90
const MS_PER_MINUTE = 60_000
const TILE_PX = 32

// Drydock region rect (tile-space) — must match scenes.json5's hidden
// camera region / replenishment region for vonBraunCity.
const DRYDOCK_RECT = { x: 10, y: 540, w: 60, h: 50 }
// Concourse tile two south of the bar's south door (bar at tile 16,551,
// door side 's') — a walkable approach the commuter routes to.
const BAR_APPROACH = { x: 20, y: 558 }
// The five relocated drydock building markers; none may appear on the map.
const DRYDOCK_PLACE_IDS = [
  'vonBraunStateDrydock',
  'vonBraunDrydockBar',
  'vonBraunDrydockClinic',
  'vonBraunDrydockSupplyDepot',
  'vonBraunDrydockOrbitalLift',
]

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.orbitalLiftCatalog',
  '__uclife__.listOrbitalLifts',
  '__uclife__.runOrbitalLift',
  '__uclife__.sceneIds',
  '__uclife__.worldMapPlaceIds',
  '__uclife__.isTileHidden',
  '__uclife__.cameraRegionForTile',
  '__uclife__.npcsInRegion',
  '__uclife__.placeEntityAtTile',
  '__uclife__.pathUsesPortal',
  '__uclife__.walkEntityViaMovement',
  '__uclife__.entityTile',
]

function inRect(t: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean {
  return t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h
}

test('drydock relocated into vonBraunCity as a hidden, lift-only region', async ({ sim }) => {
  await sim.boot({ fixture: FIXTURE, requireHandles: REQUIRED_HANDLES })

  // ── 5 (first, cheap): the drydock scene world is gone; the lift is now a
  //    same-world edge. ────────────────────────────────────────────────────
  const sceneIds = await sim.page.evaluate(() => (window as Win).__uclife__.sceneIds())
  expect(sceneIds, 'vonBraunDrydock scene world must be deleted').not.toContain('vonBraunDrydock')
  expect(sceneIds, 'vonBraunCity must still exist').toContain('vonBraunCity')

  const lift = await sim.page.evaluate((id) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as Win).__uclife__.orbitalLiftCatalog().find((l: any) => l.id === id), LIFT_ID)
  expect(lift, `${LIFT_ID} missing`).toBeTruthy()
  expect(lift.sceneIdA, 'lift must be a same-world edge').toBe(SCENE)
  expect(lift.sceneIdB, 'lift must be a same-world edge').toBe(SCENE)

  // ── 3: map-hiding + camera exclusion. ────────────────────────────────────
  const placeIds = await sim.page.evaluate((s) => (window as Win).__uclife__.worldMapPlaceIds(s), SCENE)
  expect(placeIds, 'city districts must still render on the map').toContain('vonBraunCity')
  for (const id of DRYDOCK_PLACE_IDS) {
    expect(placeIds, `${id} must be hidden from the city map`).not.toContain(id)
  }

  // The drydock kiosk tile (endpoint 'b') is the anchor for region checks.
  const kiosks = await sim.page.evaluate((s) => (window as Win).__uclife__.listOrbitalLifts(s), SCENE)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const surfaceKiosk = kiosks.find((k: any) => k.endpoint === 'a')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drydockKiosk = kiosks.find((k: any) => k.endpoint === 'b')
  expect(surfaceKiosk, 'surface kiosk missing').toBeTruthy()
  expect(drydockKiosk, 'drydock kiosk missing').toBeTruthy()
  expect(inRect(drydockKiosk.posTile, DRYDOCK_RECT), 'drydock kiosk must sit in the drydock region').toBe(true)

  const hidden = await sim.page.evaluate((t) => (window as Win).__uclife__.isTileHidden('vonBraunCity', t), drydockKiosk.posTile)
  expect(hidden, 'drydock tiles must be flagged hidden (off-map)').toBe(true)
  const cityHidden = await sim.page.evaluate(() => (window as Win).__uclife__.isTileHidden('vonBraunCity', { x: 20, y: 16 }))
  expect(cityHidden, 'city tiles must not be hidden').toBe(false)

  // The city camera region must not contain the drydock; the drydock has its
  // own (small) clamp region.
  const cityRegion = await sim.page.evaluate(() => (window as Win).__uclife__.cameraRegionForTile('vonBraunCity', { x: 20, y: 16 }))
  expect(cityRegion, 'city camera region missing').toBeTruthy()
  expect(inRect(drydockKiosk.posTile, cityRegion), 'drydock must lie outside the city camera bounds').toBe(false)

  // ── 2: drydock NPCs are seeded into the region and tick on the loop. ──────
  const seeded = await sim.page.evaluate((r) => (window as Win).__uclife__.npcsInRegion('vonBraunCity', r), DRYDOCK_RECT)
  expect(seeded.length, 'drydock region should be seeded with crew').toBeGreaterThanOrEqual(8)

  // Step the vonBraunCity loop until a drydock NPC takes a job — proves the
  // crew are simulated here, not frozen as an off-map scene.
  await sim.page.evaluate(async (r) => {
    await (window as Win).__uclife_test__.step({
      until: () => (window as Win).__uclife__.npcsInRegion('vonBraunCity', r)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .some((n: any) => n.hasJob),
      maxGameMinutes: 24 * 60,
    })
  }, DRYDOCK_RECT)
  const afterStep = await sim.page.evaluate((r) => (window as Win).__uclife__.npcsInRegion('vonBraunCity', r), DRYDOCK_RECT)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect(afterStep.some((n: any) => n.hasJob), 'a drydock NPC must acquire a job on the city loop').toBe(true)

  // ── 4: an NPC foot-routes city → drydock bar through the lift portal. ─────
  const placed = await sim.page.evaluate((t) => (window as Win).__uclife__.placeEntityAtTile('commuter', t), surfaceKiosk.posTile)
  expect(placed, 'commuter should reposition at the surface lift kiosk').toBe(true)

  const usesPortal = await sim.page.evaluate((t) => (window as Win).__uclife__.pathUsesPortal('commuter', t), BAR_APPROACH)
  expect(usesPortal, "the commuter's route to the drydock bar must traverse the lift portal").toBe(true)

  const arrived = await sim.page.evaluate((t) =>
    (window as Win).__uclife__.walkEntityViaMovement('commuter', t, 150, 2), BAR_APPROACH)
  expect(arrived, 'commuter should resolve to a tile after the walk').not.toBeNull()
  const dist = Math.hypot(arrived!.x - BAR_APPROACH.x, arrived!.y - BAR_APPROACH.y)
  expect(dist, `commuter should arrive near the drydock bar (got ${JSON.stringify(arrived)})`).toBeLessThanOrEqual(3)
  expect(inRect(arrived!, DRYDOCK_RECT), 'commuter must end up inside the drydock region').toBe(true)

  // ── 1: the player rides the lift up — same world, fare + clock. ───────────
  const pre = await sim.page.evaluate(() => {
    const w = window as Win
    return {
      money: w.__uclife__.getGameState().getPlayerCharacter().getResource('Money'),
      clockMs: w.__uclife__.useClock.getState().gameDate.getTime(),
    }
  })
  const arrivedScene = await sim.page.evaluate((id) => (window as Win).__uclife__.runOrbitalLift(id, 'a'), LIFT_ID)
  expect(arrivedScene, 'lift stays in the same world').toBe(SCENE)
  const post = await sim.page.evaluate(() => {
    const w = window as Win
    const p = w.__uclife__.getGameState().getPlayerCharacter().getPosition()
    return {
      money: w.__uclife__.getGameState().getPlayerCharacter().getResource('Money'),
      clockMs: w.__uclife__.useClock.getState().gameDate.getTime(),
      sceneId: w.__uclife__.getGameState().getScene().getId(),
      posY: p.y,
    }
  })
  expect(post.sceneId, 'player remains in vonBraunCity after the lift').toBe(SCENE)
  expect(pre.money - post.money, 'up fare deducted').toBe(FARE_UP)
  expect(post.clockMs - pre.clockMs, 'clock advanced by the ride duration').toBe(LIFT_DURATION_MIN * MS_PER_MINUTE)
  expect(post.posY, 'player arrives inside the drydock region').toBeGreaterThanOrEqual(DRYDOCK_RECT.y * TILE_PX)
})
