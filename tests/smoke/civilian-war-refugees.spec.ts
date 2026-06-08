// Phase 7.0.E.1 — wartime refugee-intake smoke.
//
// Proves the war reshapes the city's civilian texture: once wartime, procedural
// refugees arrive into the opt-in city region at its safe arrival tile (never a
// locked luxury cell), fill toward the region's replenishment target without
// overfilling, carry the distinct npc-ref- EntityKey prefix, and the intake
// bookkeeping survives a save round-trip. The sealed drydock region (no
// refugeeIntake) takes none.
//
// Drives everything through __uclife__ handles (deterministic-tests rules 1–7):
// no DOM assertions, no real-time waits. setGameDate jumps the clock,
// forceWarTransitionTick flips IsWartime, forceRefugeeSpawnRoll runs the daily
// intake (bypassing the cadence gate), and seedSimRng pins the seeded rolls.

import { test, expect } from './_fixtures'

/* eslint-disable @typescript-eslint/no-explicit-any */

const H = (name: string) => `__uclife__.${name}`
const HANDLES = [
  H('forceRefugeeSpawnRoll'), H('getRefugeeState'), H('seedSimRng'),
  H('setGameDate'), H('forceWarTransitionTick'), H('getGameState'),
  H('saveGame'), H('loadGame'),
]

const CITY_REGION = 'vonBraunCity#0'
const ARRIVAL_TILE = { x: 20, y: 16 }
const ROLL_SEED = 'refugees-s1'

const refugeeState = () => (window as any).__uclife__.getRefugeeState()

async function flipWar(sim: any) {
  await sim.page.evaluate(() => (window as any).__uclife__.setGameDate('UC 0079.01.03'))
  await sim.page.evaluate(() => (window as any).__uclife__.forceWarTransitionTick())
}

function forceRoll(sim: any, seed: string) {
  return sim.page.evaluate((s: string) => {
    ;(window as any).__uclife__.seedSimRng(s)
    return (window as any).__uclife__.forceRefugeeSpawnRoll()
  }, seed)
}

const cityRegion = (roll: any) =>
  roll.regions.find((r: any) => r.regionKey === CITY_REGION)

test('refugees: wartime intake fills the city region into flop housing without overfilling', async ({ sim }) => {
  await sim.boot({ fixture: 'civilian-war-refugees', requireHandles: HANDLES })

  // Pre-war: no refugees have ever spawned.
  let st = await sim.page.evaluate(refugeeState)
  expect(st.refugeeCounter, 'no refugees before the war').toBe(0)

  await flipWar(sim)

  // First intake roll: refugees arrive into the opt-in city region.
  const roll = await forceRoll(sim, ROLL_SEED)
  expect(roll.totalSpawned, 'refugees arrive once wartime').toBeGreaterThan(0)

  // Only the opt-in city region takes refugees; the sealed drydock region
  // (no refugeeIntake) is absent from the results.
  expect(
    roll.regions.map((r: any) => r.regionKey),
    'only the refugeeIntake region takes refugees',
  ).toEqual([CITY_REGION])

  const city = cityRegion(roll)
  expect(city.spawned, 'city region received refugees').toBeGreaterThan(0)
  // They appear on the region's safe arrival tile — never a locked luxury cell.
  expect(city.tile, 'refugees spawn on the safe arrival tile').toEqual(ARRIVAL_TILE)
  // Distinct EntityKey prefix so refugees are distinguishable in saves.
  expect(
    city.keys.every((k: string) => k.startsWith('npc-ref-')),
    'refugee EntityKeys use the npc-ref- prefix',
  ).toBe(true)
  // Bounded influx: the spawn never pushes live refugees past the region cap.
  expect(city.aliveAfter, 'intake stays at or below the refugee cap').toBeLessThanOrEqual(city.cap)
  expect(city.aliveAfter, 'live-refugee count grows by exactly the spawned batch')
    .toBe(city.aliveBefore + city.spawned)

  // Keep rolling until the region reaches its refugee cap — intake must halt.
  let last = roll
  for (let i = 0; i < 30 && cityRegion(last).spawned > 0; i++) {
    last = await forceRoll(sim, ROLL_SEED)
  }
  const full = cityRegion(last)
  expect(full.spawned, 'intake halts once the region is at its refugee cap').toBe(0)
  expect(full.aliveBefore, 'a full region holds exactly the refugee cap').toBe(full.cap)

  // The intake bookkeeping survives a save round-trip.
  const counterBefore = (await sim.page.evaluate(refugeeState)).refugeeCounter
  expect(counterBefore, 'refugees were spawned this run').toBeGreaterThan(0)

  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame(1) })
  await sim.page.reload({ waitUntil: 'domcontentloaded' })
  await sim.waitForBoot([H('getRefugeeState'), H('loadGame')])
  const loadResult = await sim.page.evaluate(async () => (window as any).__uclife__.loadGame(1))
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)

  st = await sim.page.evaluate(refugeeState)
  expect(st.refugeeCounter, 'refugee counter survives save/load').toBe(counterBefore)
})
