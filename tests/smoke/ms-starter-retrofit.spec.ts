// Phase 6.2.5.A smoke — starter MS grant + weapon-swap retrofit.
//
// Steps:
//   1. Boot fixture with auto-granted starter MS aboard the flagship.
//   2. Assert one Ms entity owned by player, storedOnShipKey='ship', bayIndex=0.
//   3. Assert parts inventory has at least 2 alternative weapons.
//   4. Swap the weapon at hardpoint hp-0 via the debug helper.
//   5. Assert mountedWeapons['hp-0'] updated and parts inventory decremented.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getMsRoster',
  '__uclife__.getMsWeaponCounts',
  '__uclife__.swapMsWeapon',
  '__uclife__.getMs',
]

const STARTER_MS_KEY = 'ms-player-0'
const SWAP_TARGET_WEAPON = 'ms-ballisticGun'
const HARDPOINT_ID = 'hp-0'

test('ms-starter: auto-grant + weapon swap at retrofit terminal', async ({ sim }) => {
  await sim.boot({ fixture: 'ms-starter', requireHandles: REQUIRED_HANDLES })

  // 1. Assert the starter MS was auto-granted.
  const roster = await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.getMsRoster() as Array<{
      key: string; storedOnShipKey: string; bayIndex: number;
      mountedWeapons: Record<string, string>
    }>,
  )
  expect(roster.length, 'starter MS roster should have at least one entry').toBeGreaterThanOrEqual(1)
  const starter = roster.find((m) => m.key === STARTER_MS_KEY)
  expect(starter, `starter MS entity key "${STARTER_MS_KEY}" not found`).toBeTruthy()
  expect(starter!.storedOnShipKey, 'starter MS should be stored on flagship').toBe('ship')
  expect(starter!.bayIndex, 'starter MS should occupy bay 0').toBe(0)

  // 2. Assert parts inventory has the swap target weapon.
  const parts = await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.getMsWeaponCounts() as Record<string, number>,
  )
  expect(
    parts[SWAP_TARGET_WEAPON] ?? 0,
    `parts inventory should have at least 1 "${SWAP_TARGET_WEAPON}"`,
  ).toBeGreaterThanOrEqual(1)

  const originalWeapon = starter!.mountedWeapons[HARDPOINT_ID]
  const originalPartCount = parts[SWAP_TARGET_WEAPON] ?? 0

  // 3. Perform weapon swap via debug helper.
  const swapOk = await sim.page.evaluate(
    ({ msKey, hpId, weaponId }: { msKey: string; hpId: string; weaponId: string }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.swapMsWeapon(msKey, hpId, weaponId),
    { msKey: STARTER_MS_KEY, hpId: HARDPOINT_ID, weaponId: SWAP_TARGET_WEAPON },
  )
  expect(swapOk, 'swapMsWeapon should return true').toBe(true)

  // 4. Assert the weapon slot was updated.
  const afterMs = await sim.page.evaluate(
    (msKey: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getMs(msKey) as { mountedWeapons: Record<string, string> } | null,
    STARTER_MS_KEY,
  )
  expect(afterMs, 'getMs should return the entity after swap').toBeTruthy()
  expect(
    afterMs!.mountedWeapons[HARDPOINT_ID],
    `hardpoint ${HARDPOINT_ID} should now hold ${SWAP_TARGET_WEAPON}`,
  ).toBe(SWAP_TARGET_WEAPON)

  // 5. Assert inventory was decremented and old weapon returned.
  const afterParts = await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.getMsWeaponCounts() as Record<string, number>,
  )
  expect(
    afterParts[SWAP_TARGET_WEAPON] ?? 0,
    `${SWAP_TARGET_WEAPON} count should decrease by 1`,
  ).toBe(originalPartCount - 1)

  if (originalWeapon && originalWeapon !== SWAP_TARGET_WEAPON) {
    expect(
      afterParts[originalWeapon] ?? 0,
      `old weapon "${originalWeapon}" should be returned to inventory`,
    ).toBeGreaterThanOrEqual(1)
  }
})
