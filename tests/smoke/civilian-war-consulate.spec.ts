// Phase 7.0.E.4 — wartime diplomatic-slot + hostile-guard smoke.
//
// Contract (issue #118):
//  1. A faction above threshold occupies a free slot; its staff spawn at the
//     airport and REACH the slot anchor.
//  2. A neutral player inside the restricted rect is NOT ejected; a player
//     aligned with an enemy faction IS ejected (MoveTarget → exit + toast).
//  3. Dropping the faction below threshold VACATES the slot (staff depart,
//     slot frees).
//  4. Save round-trip persists slot occupancy + guard + player-alignment state.
//
// Drives everything through __uclife__ handles (deterministic-tests rules 1–7):
// no DOM assertions, no real-time waits. forceWarTransitionTick flips IsWartime,
// forceSlotOccupancyTick runs the occupancy eval (bypassing the daily cadence),
// setFactionMemberCountForTest pushes the faction above/below threshold, and the
// guard BT runs via the normal npcSystem under sim-time stepping.

import { test, expect } from './_fixtures'

/* eslint-disable @typescript-eslint/no-explicit-any */

const H = (name: string) => `__uclife__.${name}`
const HANDLES = [
  '__uclife_test__.step', H('getGameState'),
  H('setGameDate'), H('forceWarTransitionTick'),
  H('forceSlotOccupancyTick'), H('getDiplomaticSlotState'),
  H('setPlayerAlignment'), H('setFactionMemberCountForTest'),
  H('getFactionStrength'), H('getPlayerAlignment'), H('saveGame'), H('loadGame'),
]

const ZEON = 'zeon'
const ENEMY = 'federation'
// Tiles → px (worldConfig.tilePx = 32). The smoke compares the guard / player
// position in px against the anchor / exit tiles.
const TILE = 32
const ARRIVE_TILES = 3 // generous: "within a few tiles" of the anchor

const slotState = () => (window as any).__uclife__.getDiplomaticSlotState()

async function flipWar(sim: any) {
  await sim.page.evaluate(() => (window as any).__uclife__.setGameDate('UC 0079.01.03'))
  await sim.page.evaluate(() => (window as any).__uclife__.forceWarTransitionTick())
}

test('consulate occupies + guard ejects hostile / passes neutral + vacates + persists', async ({ sim }) => {
  await sim.boot({ fixture: 'civilian-war-consulate', requireHandles: HANDLES })

  // ── Pre: no slot occupied yet. ─────────────────────────────────────────────
  let st = await sim.page.evaluate(slotState)
  expect(st.slots.length, 'fixture authored ≥3 diplomatic slots').toBeGreaterThanOrEqual(3)
  expect(st.slots.every((s: any) => s.occupant === null), 'all slots free pre-war').toBe(true)

  await flipWar(sim)

  // Zeon is at/above threshold (two fixture NPCs). Pin it high to be explicit.
  await sim.page.evaluate((f: string) => (window as any).__uclife__.setFactionMemberCountForTest(f, 5), ZEON)
  const strength = await sim.page.evaluate((f: string) => (window as any).__uclife__.getFactionStrength(f), ZEON)
  expect(strength.strength, 'zeon strength reflects the override').toBeGreaterThanOrEqual(2)

  // ── 1. Occupy + staff reach the anchor. ────────────────────────────────────
  await sim.page.evaluate(() => (window as any).__uclife__.forceSlotOccupancyTick())
  st = await sim.page.evaluate(slotState)
  const occupied = st.slots.find((s: any) => s.occupant === ZEON)
  expect(occupied, 'zeon occupies a slot after the occupancy tick').toBeTruthy()
  expect(occupied.staff.length, 'staff spawned for the occupied slot').toBeGreaterThan(0)
  expect(occupied.guards.length, 'a guard spawned for the occupied slot').toBeGreaterThan(0)
  const occupiedSlotId = occupied.slotId
  await sim.page.evaluate((id: string) => { (window as any).__consulateSlotId = id }, occupiedSlotId)

  // Step sim time until the staff + guard walk in from the airport and reach
  // the anchor (the reachability contract).
  await sim.stepUntil(() => {
    const s = (window as any).__uclife__.getDiplomaticSlotState()
    const slot = s.slots.find((x: any) => x.slotId === (window as any).__consulateSlotId)
    if (!slot) return false
    const near = (p: any) => p && Math.hypot(p.x - slot.anchor.x, p.y - slot.anchor.y) <= 3 * 32
    return slot.staff.every((m: any) => near(m.pos)) && slot.guards.every((g: any) => near(g.pos))
  }, 150)

  st = await sim.page.evaluate(slotState)
  const reached = st.slots.find((s: any) => s.slotId === occupiedSlotId)
  const nearAnchor = (p: any) => p && Math.hypot(p.x - reached.anchor.x, p.y - reached.anchor.y) <= ARRIVE_TILES * TILE
  expect(reached.staff.every((m: any) => nearAnchor(m.pos)), 'every staff reached the slot anchor').toBe(true)
  expect(reached.guards.every((g: any) => nearAnchor(g.pos)), 'the guard reached the slot anchor').toBe(true)

  // ── 2a. Neutral player inside the rect is NOT ejected. ─────────────────────
  // The guard is posted next to the player; step a little so its BT re-evaluates
  // detection several times and confirm it never ejects a neutral player.
  const ejectsBefore = st.ejectCount
  await sim.stepFor(15)
  st = await sim.page.evaluate(slotState)
  expect(st.ejectCount, 'a neutral player is not ejected').toBe(ejectsBefore)

  // ── 2b. Player aligned with the enemy faction IS ejected. ──────────────────
  await sim.page.evaluate((f: string) => (window as any).__uclife__.setPlayerAlignment(f), ENEMY)
  await sim.stepUntil(
    () => (window as any).__uclife__.getDiplomaticSlotState().ejectCount > 0,
    60,
  )
  st = await sim.page.evaluate(slotState)
  expect(st.ejectCount, 'the hostile player is ejected (eject episode recorded)').toBeGreaterThan(ejectsBefore)

  // The player's MoveTarget was force-set to the occupied slot's exit tile.
  const ejectedSlot = st.slots.find((s: any) => s.slotId === occupiedSlotId)
  expect(st.playerMoveTarget, 'player has a MoveTarget after eject').toBeTruthy()
  expect(st.playerMoveTarget.x, 'player MoveTarget.x driven to the slot exit').toBe(ejectedSlot.exit.x)
  expect(st.playerMoveTarget.y, 'player MoveTarget.y driven to the slot exit').toBe(ejectedSlot.exit.y)

  // ── 4. Save round-trip persists occupancy + alignment (do this while
  //       occupied, before vacating). ─────────────────────────────────────────
  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame(1) })
  await sim.page.reload({ waitUntil: 'domcontentloaded' })
  await sim.waitForBoot([H('getDiplomaticSlotState'), H('loadGame'), H('getFactionStrength')])
  const loadResult = await sim.page.evaluate(async () => (window as any).__uclife__.loadGame(1))
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)

  st = await sim.page.evaluate(slotState)
  const afterLoad = st.slots.find((s: any) => s.slotId === occupiedSlotId)
  expect(afterLoad?.occupant, 'slot occupancy survives save/load').toBe(ZEON)
  expect(afterLoad?.guards.length, 'guard re-materialized after load').toBeGreaterThan(0)
  expect(afterLoad?.staff.length, 'staff re-materialized after load').toBeGreaterThan(0)

  // Player alignment (FactionRole) survives the load.
  const alignment = await sim.page.evaluate(() => (window as any).__uclife__.getPlayerAlignment())
  expect(alignment, 'player enemy-faction alignment survives save/load').toBe(ENEMY)

  // ── 3. Drop zeon below threshold → vacate. ─────────────────────────────────
  await sim.page.evaluate((f: string) => (window as any).__uclife__.setFactionMemberCountForTest(f, 0), ZEON)
  await sim.page.evaluate(() => (window as any).__uclife__.forceSlotOccupancyTick())
  st = await sim.page.evaluate(slotState)
  const vacated = st.slots.find((s: any) => s.slotId === occupiedSlotId)
  expect(vacated?.occupant, 'slot frees when the faction drops below threshold').toBeNull()
  expect(vacated?.staff.length ?? 0, 'staff departed on vacate').toBe(0)
  expect(vacated?.guards.length ?? 0, 'guards departed on vacate').toBe(0)
})
