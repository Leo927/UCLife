// Issue #64 smoke — the acquire-parts-at-scale pipeline end-to-end:
//   1. Boot at Von Braun with known funds; the AE parts dealer is seated.
//   2. Buy one catalog weapon + one frame mod; assert funds debited by the
//      derived prices and PlayerPartsInventory incremented.
//   3. Enter combat against a pirate_raider (fixed salvage table) and break
//      it down via the canonical destruction path.
//   4. Assert the tally lists the guaranteed salvaged part and the parts
//      inventory reflects the drop.
//   5. Install the purchased weapon on the starter MS — closing the
//      acquire → install loop.
//
// All gates run through __uclife__ debug handles + sim.stepUntil, per
// CLAUDE.md § Smoke-test reliability. Salvage is deterministic by
// construction: pirate_raider's table has a chance:1.0 ms-ballisticGun drop.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.cheatMoney',
  '__uclife__.cheatPiloting',
  '__uclife__.boardShip',
  '__uclife__.takeHelmCheat',
  '__uclife__.useScene',
  '__uclife__.useCombatStore',
  '__uclife__.startCombatCheat',
  '__uclife__.breakDownEnemiesCheat',
  '__uclife__.buyPartCheat',
  '__uclife__.getMsWeaponCounts',
  '__uclife__.getMsFrameModCounts',
  '__uclife__.getMsRoster',
  '__uclife__.swapMsWeapon',
  '__uclife__.openMsRetrofit',
  '__uclife__.shipSalesRepEntity',
  '__uclife__.getPlayerMoney',
]

const STEP_BUDGET_MIN = 60
const PLAYER_MS_KEY = 'ms-player-0'
const HARDPOINT_ID = 'hp-0'
const BUY_WEAPON = 'ms-missileRack'   // small-arms, not equipped + not in starter parts
const BUY_FRAMEMOD = 'autoloader'
const SALVAGE_WEAPON = 'ms-ballisticGun'   // pirate_raider chance:1.0 drop

test('ms-parts: buy at dealer, salvage from combat, install on MS', async ({ sim }) => {
  await sim.boot({ fixture: 'ms-parts', requireHandles: REQUIRED_HANDLES })

  // ── 1. The AE parts dealer is seated at world-init ─────────────────────
  const dealer = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.shipSalesRepEntity('ae_parts_dealer_vb'),
  )
  expect(dealer, 'ae_parts_dealer_vb rep should be seated after boot').toBeTruthy()

  // ── 2. Buy one weapon + one frame mod ──────────────────────────────────
  const moneyBefore = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getPlayerMoney(),
  )
  expect(moneyBefore, 'getPlayerMoney should resolve the fixture player').toBeGreaterThan(0)

  const wBefore = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getMsWeaponCounts(),
  )
  const fBefore = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getMsFrameModCounts(),
  )

  const buyWeapon = await sim.page.evaluate(
    (id) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.buyPartCheat('weapon', id),
    BUY_WEAPON,
  )
  expect(buyWeapon?.ok, `buyPartCheat(weapon) failed: ${JSON.stringify(buyWeapon)}`).toBe(true)

  const buyMod = await sim.page.evaluate(
    (id) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.buyPartCheat('frameMod', id),
    BUY_FRAMEMOD,
  )
  expect(buyMod?.ok, `buyPartCheat(frameMod) failed: ${JSON.stringify(buyMod)}`).toBe(true)

  const wAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getMsWeaponCounts(),
  )
  const fAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getMsFrameModCounts(),
  )
  expect(
    (wAfter[BUY_WEAPON] ?? 0) - (wBefore[BUY_WEAPON] ?? 0),
    `${BUY_WEAPON} stockpile should increment by 1`,
  ).toBe(1)
  expect(
    (fAfter[BUY_FRAMEMOD] ?? 0) - (fBefore[BUY_FRAMEMOD] ?? 0),
    `${BUY_FRAMEMOD} stockpile should increment by 1`,
  ).toBe(1)

  // Funds debited by exactly the two derived prices.
  const moneyAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getPlayerMoney(),
  )
  expect(
    moneyBefore - moneyAfter,
    'funds should be debited by the sum of the two derived part prices',
  ).toBe(buyWeapon.price + buyMod.price)

  // ── 3. Enter combat against a pirate_raider ────────────────────────────
  await sim.page.evaluate(() => (window as any).__uclife__.cheatPiloting(10))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.boardShip())
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useScene.getState().activeId === 'playerShipInterior',
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const salvageWeaponBefore = await sim.page.evaluate(
    (id) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getMsWeaponCounts()[id] ?? 0,
    SALVAGE_WEAPON,
  )

  await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.startCombatCheat('pirate_raider', [], null)
  })
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useCombatStore.getState().open === true,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  // Break down the hostile through the canonical destruction path (rolls
  // salvage in onEnemyDestroyed, routes drops + tally in endCombat).
  await sim.page.evaluate(() => (window as any).__uclife__.breakDownEnemiesCheat())
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useCombatStore.getState().open === false,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  // Issue #71 — the recoverables dialogue fires before the tally now.
  // Resolve it with defaults so the tally (with the salvaged-parts rows)
  // emits. The MS-parts salvage is already credited at endCombat,
  // independent of the tally being shown.
  await sim.page.evaluate(() => (window as any).__uclife__.finishRecoverables())

  // ── 4. Tally lists the salvaged part + inventory reflects the drop ─────
  const tally = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).uclifeUI.getState().combatTally,
  )
  expect(tally, 'combatTally should be non-null after victory').toBeTruthy()
  expect(
    Array.isArray(tally.salvagedParts),
    'tally.salvagedParts should be an array',
  ).toBe(true)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dropped = tally.salvagedParts.find((s: any) => s.partId === SALVAGE_WEAPON)
  expect(
    dropped,
    `tally should list the guaranteed ${SALVAGE_WEAPON} drop; saw ${JSON.stringify(tally.salvagedParts)}`,
  ).toBeTruthy()
  expect(dropped.kind).toBe('weapon')
  expect(dropped.qty).toBeGreaterThanOrEqual(1)

  const salvageWeaponAfter = await sim.page.evaluate(
    (id) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getMsWeaponCounts()[id] ?? 0,
    SALVAGE_WEAPON,
  )
  expect(
    salvageWeaponAfter - salvageWeaponBefore,
    `${SALVAGE_WEAPON} stockpile should grow by the salvaged qty`,
  ).toBe(dropped.qty)

  // ── 5. Install the purchased weapon on the starter MS ──────────────────
  const roster = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getMsRoster(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const starter = roster.find((m: any) => m.key === PLAYER_MS_KEY)
  expect(starter, `starter MS ${PLAYER_MS_KEY} should exist`).toBeTruthy()

  await sim.page.evaluate(
    (key) => (window as any).__uclife__.openMsRetrofit(key),
    PLAYER_MS_KEY,
  )

  const installed = await sim.page.evaluate(
    ({ msKey, hpId, weaponId }: { msKey: string; hpId: string; weaponId: string }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.swapMsWeapon(msKey, hpId, weaponId),
    { msKey: PLAYER_MS_KEY, hpId: HARDPOINT_ID, weaponId: BUY_WEAPON },
  )
  expect(
    installed,
    `purchased ${BUY_WEAPON} should be installable on ${PLAYER_MS_KEY} ${HARDPOINT_ID}`,
  ).toBe(true)
})
