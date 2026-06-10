// Issue #142 — Skill Perks: crossing a milestone level forces a pick in
// the skill panel; the pick lands as a `skill_perk` Effect (modifiers fold,
// unlocks queryable); the on-duty Tutor respecs it for money + lost days;
// picks + respec count survive save/load. Catalog math and the authoring
// contract are covered by src/character/skillPerks.test.ts.

import { test, expect } from './_fixtures'

const HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.getSkillPerkState',
  '__uclife__.pickSkillPerk',
  '__uclife__.hasUnlock',
  '__uclife__.characterSnapshot',
  '__uclife__.characterEntityByKey',
  '__uclife__.setPlayerStat',
  '__uclife__.setGameDate',
  '__uclife__.advanceGameMinutes',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
  'uclifeUI.getState',
]

/* eslint-disable @typescript-eslint/no-explicit-any */
const perkState = () => (window as any).__uclife__.getSkillPerkState()

test('skill perks: milestone forced pick, effect + unlocks, tutor respec, save round-trip', async ({ sim }) => {
  await sim.boot({ fixture: 'skill-perks', requireHandles: HANDLES })

  // ── Below the milestone: nothing pending ──
  let st = await sim.page.evaluate(perkState)
  expect(st.picks, 'fresh character has no picks').toEqual([])
  expect(st.pending, 'cooking 29 must not unlock the tier-30 pick').toEqual([])

  // ── Cross level 30 → opening the skill panel forces the pick ──
  await sim.page.evaluate(() => (window as any).__uclife__.setPlayerStat('skills.cooking', 3000))
  st = await sim.page.evaluate(perkState)
  expect(st.pending, 'crossing level 30 queues the cooking tier').toEqual([{ skill: 'cooking', tier: 30 }])

  await sim.page.evaluate(() => (window as any).uclifeUI.getState().setStatus(true))
  const modal = sim.page.locator('[data-testid="skill-perk-modal"]')
  await modal.waitFor({ timeout: 5_000 })
  const optionButtons = modal.locator('button')
  expect(await optionButtons.count(), 'forced-pick modal must offer ≥2 options').toBeGreaterThanOrEqual(2)

  // The panel must refuse to close while the pick is unresolved.
  await sim.page.click('.status-close')
  await expect(modal, 'panel close is blocked until the pick resolves').toBeVisible()

  // Pick 美食家 → modal resolves, Effect lands, unlock queryable.
  await sim.page.click('[data-testid="skill-perk-option-gourmand"]')
  await expect(modal).toHaveCount(0)
  st = await sim.page.evaluate(perkState)
  expect(st.picks).toEqual([{ skill: 'cooking', tier: 30, optionId: 'gourmand', nameZh: '美食家' }])
  expect(st.pending).toEqual([])
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.hasUnlock('recipe:premium_meal')),
    'the picked perk grants its unlock flag',
  ).toBe(true)

  // The preview row marks the committed pick; panel now closes.
  await expect(
    sim.page.locator('[data-testid="skill-perk-preview-cooking"] [data-picked="gourmand"]'),
  ).toBeVisible()
  await sim.page.click('.status-close')
  await expect(sim.page.locator('[data-testid="skill-perk-preview-cooking"]')).toHaveCount(0)

  // ── Tutor respec: refund the slot for money + lost days ──
  // The clock boots Tuesday 09:00 (campaign default); the tutor only
  // staffs the seat 18–24 on her sparse workdays. Jump to a Monday
  // (UC 0077.05.03; 0077.04.27 is a Tuesday) and advance to 18:30.
  await sim.page.evaluate(() => (window as any).__uclife__.setGameDate('UC 0077.05.03'))
  await sim.page.evaluate(() => (window as any).__uclife__.advanceGameMinutes(390))
  await sim.stepUntil(
    () => (window as any).__uclife__.characterSnapshot('tutor-rena')?.action === 'working',
    120,
  )
  const opened = await sim.page.evaluate(() => {
    const w = window as any
    const npc = w.__uclife__.characterEntityByKey('tutor-rena')
    if (!npc) return false
    w.uclifeUI.getState().setDialogNPC(npc)
    return true
  })
  expect(opened, 'tutor NPC must resolve in the active scene').toBe(true)
  await sim.page.click('button:has-text("技能转科")')
  await sim.page.waitForSelector('[data-testid="tutor-respec"]', { timeout: 5_000 })

  const before = await sim.page.evaluate(() => ({
    money: (window as any).__uclife__.getGameState().getPlayerCharacter().getResource('Money'),
    nowMs: (window as any).__uclife__.useClock.getState().gameDate.getTime(),
    cost: (window as any).__uclife__.getSkillPerkState().nextRespecCost,
  }))
  await sim.page.click('[data-testid="tutor-respec-cooking-30"]')

  const after = await sim.page.evaluate(() => ({
    money: (window as any).__uclife__.getGameState().getPlayerCharacter().getResource('Money'),
    nowMs: (window as any).__uclife__.useClock.getState().gameDate.getTime(),
    st: (window as any).__uclife__.getSkillPerkState(),
    unlock: (window as any).__uclife__.hasUnlock('recipe:premium_meal'),
  }))
  expect(after.money, 'respec charges the quoted money cost').toBe(before.money - before.cost.money)
  expect(
    after.nowMs - before.nowMs,
    'respec advances the clock by the quoted lost days',
  ).toBe(before.cost.days * 24 * 60 * 60 * 1000)
  expect(after.st.picks, 'respec refunds the slot').toEqual([])
  expect(after.st.pending, 'the refunded tier is pending again').toEqual([{ skill: 'cooking', tier: 30 }])
  expect(after.st.respecCount).toBe(1)
  expect(after.st.nextRespecCost.money, 'cost grows with respec count').toBeGreaterThan(before.cost.money)
  expect(after.unlock, 'the refunded perk no longer grants its unlock').toBe(false)

  // ── Re-pick the other option, then save round-trip ──
  const repick = await sim.page.evaluate(() =>
    (window as any).__uclife__.pickSkillPerk('cooking', 30, 'meal_prep'),
  )
  expect(repick.ok).toBe(true)

  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame(1) })
  await sim.page.reload({ waitUntil: 'domcontentloaded' })
  await sim.waitForBoot(HANDLES)
  const loadResult = await sim.page.evaluate(async () => (window as any).__uclife__.loadGame(1))
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)

  st = await sim.page.evaluate(perkState)
  expect(st.picks, 'picks survive save/load').toEqual([
    { skill: 'cooking', tier: 30, optionId: 'meal_prep', nameZh: '备餐高手' },
  ])
  expect(st.respecCount, 'respec count survives save/load').toBe(1)
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.hasUnlock('cook:double_batch')),
    'unlock flags survive save/load',
  ).toBe(true)
})
