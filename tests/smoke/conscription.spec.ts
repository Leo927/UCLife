// Phase 7.0.C — conscription smoke.
//
// Proves war can force itself on a civilian while staying refusable: a draft
// notice issues once wartime; a civilian with Federation standing + a clinic
// medical letter dodges it and stays civilian; a combatant-eligible named NPC
// is drafted and leaves; the draft state survives a save round-trip; and an
// mw_pilot player's refusal roll is biased hard toward acceptance, so refusing
// fails and fires the perspective-shift routing point.
//
// Drives everything through __uclife__ handles (deterministic-tests rules
// 1–7): no DOM assertions, no real-time waits. setGameDate jumps the clock,
// forceWarTransitionTick flips IsWartime, forceConscriptionRoll runs the daily
// roll, and seedSimRng pins the seeded refusal / draft rolls.

import { test, expect } from './_fixtures'

/* eslint-disable @typescript-eslint/no-explicit-any */

const H = (name: string) => `__uclife__.${name}`
const COMMON_HANDLES = [
  H('getConscriptionState'), H('getDraftRefusalChance'), H('forceConscriptionRoll'),
  H('resolveDraft'), H('grantMedicalLetter'), H('seedSimRng'), H('setPlayerStat'),
  H('setGameDate'), H('forceWarTransitionTick'), H('getGameState'),
  H('saveGame'), H('loadGame'),
]

// s7: first uniforms 0.265, 0.383 — both small, so the roll drafts the NPC
// (npcDraftChance 0.5) and issues the player notice (noticeChance 0.6).
const ROLL_SEED = 's7'
// s3: first uniform 0.620 — below the high-mod refusal ceiling (0.95, succeeds)
// but above the floored/base chances (drafted), so one seed pins every roll.
const RES_SEED = 's3'

const conscription = () => (window as any).__uclife__.getConscriptionState()

async function flipWar(sim: any) {
  await sim.page.evaluate(() => (window as any).__uclife__.setGameDate('UC 0079.01.03'))
  await sim.page.evaluate(() => (window as any).__uclife__.forceWarTransitionTick())
}

test('conscription: civilian dodges the draft, named NPC is drafted, state persists', async ({ sim }) => {
  await sim.boot({ fixture: 'conscription-civilian', requireHandles: [...COMMON_HANDLES, H('pickAmbitionsAt')] })

  // A civilian (no pro-pilot ambition) with high Federation standing +
  // Charisma + a clinic medical letter → strong refusal odds.
  await sim.page.evaluate(() => {
    const u = (window as any).__uclife__
    u.pickAmbitionsAt([]) // clear any default active ambition (no pro-pilot bias)
    u.setPlayerStat('reputation.federation', 80)
    u.setPlayerStat('attributes.charisma', 80)
    u.grantMedicalLetter()
  })

  await flipWar(sim)

  // Pre-roll: no notice, and the refusal odds are high (mods stacked).
  let st = await sim.page.evaluate(conscription)
  expect(st.noticeOutstanding, 'no notice before the roll').toBe(false)
  const chance = await sim.page.evaluate(() => (window as any).__uclife__.getDraftRefusalChance())
  expect(chance, 'modifiers push refusal odds high').toBeGreaterThan(0.9)

  // The draft roll issues a notice AND drafts the combatant-eligible NPC.
  const roll = await sim.page.evaluate((seed: string) => {
    ;(window as any).__uclife__.seedSimRng(seed)
    return (window as any).__uclife__.forceConscriptionRoll()
  }, ROLL_SEED)
  expect(roll.noticeIssued, 'a draft notice issues to the player').toBe(true)
  expect(roll.draftedNpcs, '加图 is drafted out of the city').toContain('阿纳贝尔·加图')

  st = await sim.page.evaluate(conscription)
  expect(st.noticeOutstanding, 'notice now outstanding').toBe(true)

  // The drafted NPC has left the world (looked up by its fixture EntityKey).
  const gatoGone = await sim.page.evaluate(
    () => (window as any).__uclife__.getGameState().getCharacter('gato') === null,
  )
  expect(gatoGone, 'drafted NPC removed from the world').toBe(true)

  // Resolve by refusing — high odds + the pinned roll → stays civilian, letter
  // consumed.
  const outcome = await sim.page.evaluate((seed: string) => {
    ;(window as any).__uclife__.seedSimRng(seed)
    return (window as any).__uclife__.resolveDraft('refuse')
  }, RES_SEED)
  expect(outcome.outcome, 'civilian dodges the draft').toBe('civilian')

  st = await sim.page.evaluate(conscription)
  expect(st.noticeOutstanding, 'notice cleared after resolution').toBe(false)
  expect(st.resolution, 'recorded as refused').toBe('refused')
  expect(st.medicalLetterHeld, 'medical letter consumed on use').toBe(false)
  expect(st.cooldownUntilDay, 'cooldown set').toBeGreaterThan(0)

  // Save → reload → load → the draft state (mid-cooldown) persists.
  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame(1) })
  await sim.page.reload({ waitUntil: 'domcontentloaded' })
  await sim.waitForBoot([H('getConscriptionState'), H('loadGame')])
  const loadResult = await sim.page.evaluate(async () => (window as any).__uclife__.loadGame(1))
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)

  st = await sim.page.evaluate(conscription)
  expect(st.resolution, 'resolution survives save/load').toBe('refused')
  expect(st.cooldownUntilDay, 'cooldown survives save/load').toBeGreaterThan(0)
})

test('conscription: mw_pilot is biased toward acceptance — refusing fails into the front', async ({ sim }) => {
  await sim.boot({ fixture: 'conscription-pilot', requireHandles: [...COMMON_HANDLES, H('pickAmbitionsAt')] })

  await sim.page.evaluate(() => (window as any).__uclife__.pickAmbitionsAt([
    { id: 'mw_pilot', currentStage: 1 },
  ]))

  await flipWar(sim)

  // The pro-pilot bias floors the refusal odds (they want in).
  const chance = await sim.page.evaluate(() => (window as any).__uclife__.getDraftRefusalChance())
  expect(chance, 'mw_pilot refusal odds floored toward acceptance').toBeLessThan(0.1)

  const roll = await sim.page.evaluate((seed: string) => {
    ;(window as any).__uclife__.seedSimRng(seed)
    return (window as any).__uclife__.forceConscriptionRoll()
  }, ROLL_SEED)
  expect(roll.noticeIssued, 'a draft notice issues').toBe(true)

  // Refusing fails (floored odds + pinned roll) → drafted, perspective shift.
  const outcome = await sim.page.evaluate((seed: string) => {
    ;(window as any).__uclife__.seedSimRng(seed)
    return (window as any).__uclife__.resolveDraft('refuse')
  }, RES_SEED)
  expect(outcome.outcome, 'refusal fails — drafted to the front').toBe('drafted')

  const st = await sim.page.evaluate(conscription)
  expect(st.resolution, 'recorded as drafted (perspective-shift routing fired)').toBe('drafted')
})
