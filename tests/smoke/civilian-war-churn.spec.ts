// Phase 7.0.E.2 — wartime non-combatant churn smoke.
//
// Proves the war thins the city's familiar faces: once wartime, non-combatant
// named NPCs flee the colony or are killed offscreen (each with a fate), a
// combatant-eligible named NPC is left untouched (conscription's to draft, so
// the two churns are disjoint — an NPC leaves once, not twice), and the churn
// bookkeeping survives a save round-trip.
//
// Drives everything through __uclife__ handles (deterministic-tests rules 1–7):
// no DOM assertions, no real-time waits. setGameDate jumps the clock,
// forceWarTransitionTick flips IsWartime, forceCivilianChurnRoll runs the daily
// churn (bypassing the cadence gate), and seedSimRng pins the seeded roll.

import { test, expect } from './_fixtures'

/* eslint-disable @typescript-eslint/no-explicit-any */

const H = (name: string) => `__uclife__.${name}`
const HANDLES = [
  H('forceCivilianChurnRoll'), H('getCivilianChurnState'), H('seedSimRng'),
  H('setGameDate'), H('forceWarTransitionTick'), H('getGameState'),
  H('saveGame'), H('loadGame'),
]

const GATO = '阿纳贝尔·加图'
const ROLL_SEED = 'churn-s1'

const churnState = () => (window as any).__uclife__.getCivilianChurnState()

async function flipWar(sim: any) {
  await sim.page.evaluate(() => (window as any).__uclife__.setGameDate('UC 0079.01.03'))
  await sim.page.evaluate(() => (window as any).__uclife__.forceWarTransitionTick())
}

test('civilian churn: non-combatants flee/killed, combatant untouched, bookkeeping persists', async ({ sim }) => {
  await sim.boot({ fixture: 'civilian-war-churn', requireHandles: HANDLES })

  // Pre-war: nobody has churned.
  let st = await sim.page.evaluate(churnState)
  expect(st.churned, 'no churn before the war').toEqual([])

  // The combatant-eligible NPC is present before the roll.
  const gatoBefore = await sim.page.evaluate(
    () => (window as any).__uclife__.getGameState().getCharacter('gato') !== null,
  )
  expect(gatoBefore, 'combatant NPC present before the churn').toBe(true)

  await flipWar(sim)

  // The churn roll removes a seeded subset of the non-combatant named roster.
  const roll = await sim.page.evaluate((seed: string) => {
    ;(window as any).__uclife__.seedSimRng(seed)
    return (window as any).__uclife__.forceCivilianChurnRoll()
  }, ROLL_SEED)

  expect(roll.churned.length, 'non-combatants churn once wartime').toBeGreaterThan(0)
  // Every churned NPC has a concrete fate.
  expect(
    roll.churned.every((c: any) => c.fate === 'fled' || c.fate === 'killed'),
    'each churned NPC fled or was killed offscreen',
  ).toBe(true)

  const churnedNames: string[] = roll.churned.map((c: any) => c.name)
  // Disjoint from conscription: the combatant-eligible NPC is never churned here.
  expect(churnedNames, 'combatant NPC is not churned by the civilian path').not.toContain(GATO)
  const gatoStillHere = await sim.page.evaluate(
    () => (window as any).__uclife__.getGameState().getCharacter('gato') !== null,
  )
  expect(gatoStillHere, 'combatant NPC survives the civilian churn').toBe(true)

  // Bookkeeping reflects the roll.
  st = await sim.page.evaluate(churnState)
  expect(st.churned.slice().sort(), 'churn state records exactly the churned roster')
    .toEqual(churnedNames.slice().sort())

  // The churn bookkeeping survives a save round-trip. (We assert the churned
  // set, not Gato's post-load presence: the fixture-placed combatant uses a
  // non-procedural EntityKey that the load path doesn't re-materialize, which
  // is a fixture/save limitation unrelated to churn. Disjointness is already
  // proven pre-save above.)
  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame(1) })
  await sim.page.reload({ waitUntil: 'domcontentloaded' })
  await sim.waitForBoot([H('getCivilianChurnState'), H('loadGame')])
  const loadResult = await sim.page.evaluate(async () => (window as any).__uclife__.loadGame(1))
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)

  st = await sim.page.evaluate(churnState)
  expect(st.churned.slice().sort(), 'churned roster survives save/load')
    .toEqual(churnedNames.slice().sort())
})
