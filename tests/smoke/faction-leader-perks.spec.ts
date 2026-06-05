// Phase 6.4.E — faction-leader perks: AP-pool unlocks affecting faction-wide
// stats.
//
// Test outline:
//  1. Boot the pre-tier player → faction-leader perks are visible but LOCKED.
//  2. Grant faction-tier unlock + AP → buy a faction-leader perk → AP is
//     debited and the FactionEffect lands on the player-faction sheet
//     (recruitChanceMul rises on the next read).
//  3. Attempt a buy with insufficient AP → refused, no state change.
//  4. Save round-trip → purchased perk + its faction effect persist.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.getAmbitions',
  '__uclife__.grantAp',
  '__uclife__.grantPlayerFactionTierUnlock',
  '__uclife__.purchasePerk',
  '__uclife__.createPlayerFaction',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]

// The 2-AP recruitment-network faction perk targets recruitChanceMul.
const PERK_ID = 'recruitment_network'
const PERK_COST = 2
const PERK_EFFECT_ID = `perk:${PERK_ID}`
const RECRUIT_STAT = 'recruitChanceMul'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const uclife = (page: any) => (fn: string, ...args: unknown[]) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page.evaluate(([f, a]: [string, unknown[]]) => (window as any).__uclife__[f](...a), [fn, args])

test('faction-leader perks: visible-but-locked, AP spend, faction effect, save round-trip', async ({ sim }) => {
  await sim.boot({ fixture: 'faction-leader-perks', requireHandles: REQUIRED_HANDLES })
  const call = uclife(sim.page)

  // 1. Pre-tier — faction-leader perks visible but LOCKED.
  const lockedStore = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getFactionPerkStore(),
  )
  expect(lockedStore.length, 'faction-leader perks should be visible pre-tier').toBeGreaterThan(0)
  const recruitRow = lockedStore.find((r: { id: string }) => r.id === PERK_ID)
  expect(recruitRow, `${PERK_ID} should appear in the store`).toBeTruthy()
  expect(recruitRow.locked, 'faction perk must be locked before faction tier').toBe(true)
  expect(recruitRow.owned, 'faction perk not owned at start').toBe(false)

  // Buying while locked is refused.
  const lockedBuy = await call('purchasePerk', PERK_ID)
  expect(lockedBuy.ok, 'locked perk purchase should be refused').toBe(false)
  expect(lockedBuy.refusal, 'refusal reason should be locked').toBe('locked')

  // 2. Form the player-faction, cross the tier gate, and grant AP.
  await call('createPlayerFaction')
  const tier = await call('grantPlayerFactionTierUnlock')
  expect(tier.ok && tier.hasFactionTier, 'faction-tier unlock should be granted').toBe(true)
  await call('grantAp', PERK_COST)

  const beforeAp = await call('getAmbitions')
  const baselineStat = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: string) => (window as any).__uclife__.getGameState().getPlayerFactionStat(s),
    RECRUIT_STAT,
  )
  expect(baselineStat, 'recruitChanceMul baseline is the schema default').toBeCloseTo(1.0, 4)

  // Now unlocked.
  const unlockedStore = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getFactionPerkStore(),
  )
  const unlockedRow = unlockedStore.find((r: { id: string }) => r.id === PERK_ID)
  expect(unlockedRow.locked, 'faction perk unlocked after tier').toBe(false)
  expect(unlockedRow.affordable, 'perk affordable with granted AP').toBe(true)

  // Buy the perk.
  const buy = await call('purchasePerk', PERK_ID)
  expect(buy.ok, `purchase should succeed: ${JSON.stringify(buy)}`).toBe(true)

  // AP debited.
  const afterAp = await call('getAmbitions')
  expect(afterAp.apBalance, 'AP debited by perk cost').toBe(beforeAp.apBalance - PERK_COST)
  expect(afterAp.perks, 'perk recorded on the player').toContain(PERK_ID)

  // FactionEffect landed faction-wide — recruitment chance rises.
  const boostedStat = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: string) => (window as any).__uclife__.getGameState().getPlayerFactionStat(s),
    RECRUIT_STAT,
  )
  expect(boostedStat, 'recruitChanceMul rose after buying the perk').toBeGreaterThan(baselineStat)

  const effectIds = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getPlayerFactionEffectIds(),
  )
  expect(effectIds, 'faction effect id present on player-faction').toContain(PERK_EFFECT_ID)

  // 3. Insufficient AP — buying a different faction perk is refused (AP now 0).
  const poorBuy = await call('purchasePerk', 'war_economy')
  expect(poorBuy.ok, 'purchase without enough AP should be refused').toBe(false)
  expect(poorBuy.refusal, 'refusal reason should be insufficient-ap').toBe('insufficient-ap')

  // 4. Save round-trip — perk + faction effect persist.
  const save = await call('saveGame', 1)
  void save
  const loadResult = await call('loadGame', 1)
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)

  const afterLoadAmb = await call('getAmbitions')
  expect(afterLoadAmb.perks, 'purchased perk survives save/load').toContain(PERK_ID)

  const afterLoadStat = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: string) => (window as any).__uclife__.getGameState().getPlayerFactionStat(s),
    RECRUIT_STAT,
  )
  expect(afterLoadStat, 'faction effect survives save/load').toBeCloseTo(boostedStat, 4)
})
