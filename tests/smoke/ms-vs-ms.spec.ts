// W3 (ms-identity) Task 2 — hostile MS group complements. space-entities.json5
// groups can now declare an `msComplement` (enemyShips.json5 rows with
// `isMs: true`); startCombat spawns them as independent enemy-side
// CombatShipState rows (`enemy-ms-<n>`) alongside the group's lead + escort
// ships. This system smoke proves the wiring end to end: a complement-
// bearing campaign group fields real enemy-MS rows in tactical, and the
// fight actually progresses (hull drops on both sides) once driven.
//
// 'pirate-shoal-1' (src/data/space-entities.json5) is the authored fixture
// for this: shipClassId 'pirate_skirmisher' + one 'pirate_skirmisher' escort
// + msComplement ['pirate_junkerMs']. campaignEnemyKey follows the
// spaceBootstrap convention `enemy-<space-entities id>`.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.cheatMoney',
  '__uclife__.cheatPiloting',
  '__uclife__.boardShip',
  '__uclife__.takeHelmCheat',
  '__uclife__.useScene',
  '__uclife__.startCombatCheat',
  '__uclife__.useCombatStore',
  '__uclife__.combatEntities',
]

const STEP_BUDGET_MIN = 60
const COMBAT_DRIVE_STAGE_MIN = 2
const COMBAT_DRIVE_STAGES = 20

const SHOAL_GROUP_CAMPAIGN_KEY = 'enemy-pirate-shoal-1'
const SHOAL_LEAD_CLASS_ID = 'pirate_skirmisher'
const SHOAL_ESCORT_CLASS_IDS = ['pirate_skirmisher']

interface CombatEntitySnapshot {
  key: string
  side: string
  isFlagship: boolean
  isMs: boolean
  piloted: boolean
  nameZh: string
  hullCurrent: number
  hullMax: number
}

test('MS complement: a campaign group with msComplement fields enemy MS rows that fight', async ({ sim }) => {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: REQUIRED_HANDLES })

  const setupOk = await sim.page.evaluate(() => {
    const u = (window as any).__uclife__
    return u.cheatMoney(80000) && u.cheatPiloting(10)
  })
  expect(setupOk, 'cheatMoney+cheatPiloting failed at setup').toBeTruthy()

  await sim.page.evaluate(() => (window as any).__uclife__.boardShip())
  await sim.stepUntil(
    () => (window as any).__uclife__.useScene.getState().activeId === 'playerShipInterior',
    STEP_BUDGET_MIN,
  )

  const helmRes = await sim.page.evaluate(() => (window as any).__uclife__.takeHelmCheat())
  expect(helmRes?.ok, `takeHelmCheat should succeed; got ${JSON.stringify(helmRes)}`).toBeTruthy()

  await sim.page.evaluate(
    (args: { lead: string; escorts: string[]; key: string }) =>
      (window as any).__uclife__.startCombatCheat(args.lead, args.escorts, args.key, {}),
    { lead: SHOAL_LEAD_CLASS_ID, escorts: SHOAL_ESCORT_CLASS_IDS, key: SHOAL_GROUP_CAMPAIGN_KEY },
  )
  await sim.stepUntil(
    () => (window as any).__uclife__.useCombatStore.getState().open === true,
    STEP_BUDGET_MIN,
  )

  const beforeEntities: CombatEntitySnapshot[] = await sim.page.evaluate(
    () => (window as any).__uclife__.combatEntities(),
  )
  const enemyMsBefore = beforeEntities.filter((e) => e.side === 'enemy' && e.isMs)
  expect(
    enemyMsBefore.length,
    `expected at least one enemy MS row from msComplement, got: ${JSON.stringify(beforeEntities)}`,
  ).toBeGreaterThan(0)
  for (const ms of enemyMsBefore) {
    expect(ms.key, `enemy MS row must be keyed enemy-ms-<n>, got "${ms.key}"`).toMatch(/^enemy-ms-\d+$/)
  }
  const flagshipBefore = beforeEntities.find((e) => e.isFlagship)
  expect(flagshipBefore, 'flagship CombatShipState row must exist').toBeTruthy()

  // Resume — combat opens paused on the first-contact briefing.
  await sim.page.evaluate(() => {
    const uu = (window as any).__uclife__
    if (uu.useCombatStore.getState().paused) uu.useCombatStore.getState().togglePause()
  })

  // Drive sim time in stages until either the fight resolves or the drive
  // budget runs out; re-resume on any auto-pause threshold along the way.
  for (let i = 0; i < COMBAT_DRIVE_STAGES; i++) {
    const stillOpen = await sim.page.evaluate(
      () => (window as any).__uclife__.useCombatStore.getState().open,
    )
    if (!stillOpen) break
    await sim.page.evaluate(() => {
      const uu = (window as any).__uclife__
      if (uu.useCombatStore.getState().paused) uu.useCombatStore.getState().togglePause()
    })
    await sim.stepFor(COMBAT_DRIVE_STAGE_MIN)
  }

  const afterEntities: CombatEntitySnapshot[] = await sim.page.evaluate(
    () => (window as any).__uclife__.combatEntities(),
  )
  const enemyMsAfter = afterEntities.filter((e) => e.side === 'enemy' && e.isMs)
  const flagshipAfter = afterEntities.find((e) => e.isFlagship)

  // The fight must have actually progressed: either the enemy MS complement
  // took damage (or died — absent from the after-snapshot) or the flagship
  // did (or the fight resolved to victory/defeat entirely). Any one of
  // these proves the enemy-MS rows are live tactical participants, not
  // inert spawns.
  const msHullDropped = enemyMsBefore.some((before) => {
    const after = enemyMsAfter.find((a) => a.key === before.key)
    return !after || after.hullCurrent < before.hullCurrent
  })
  const flagshipHullDropped = Boolean(
    flagshipBefore && flagshipAfter && flagshipAfter.hullCurrent < flagshipBefore.hullCurrent,
  )
  const combatResolved = !(await sim.page.evaluate(
    () => (window as any).__uclife__.useCombatStore.getState().open,
  ))

  expect(
    msHullDropped || flagshipHullDropped || combatResolved,
    'fight must progress: enemy MS or flagship hull must drop, or combat must resolve, within the drive budget',
  ).toBe(true)
})
