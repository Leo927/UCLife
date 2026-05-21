// granadaDrydock mini-station smoke. Verifies the concourse expansion:
//   1. Boot lands in the granadaDrydock concourse.
//   2. The three service buildings (drydockBar, drydockClinic, supplyDepot)
//      spawn in the scene.
//   3. The AE supply dealer special NPC is seated at the supply depot and
//      its order-supply dialog branch surfaces while on duty.

import { test, expect, DOM_COMMIT_TIMEOUT_MS, isExpectedTestModePortraitMissing } from './_fixtures'

const FIXTURE = 'granada-station'
const SCENE = 'granadaDrydock'
const SERVICE_BUILDINGS = ['drydockBar', 'drydockClinic', 'supplyDepot']

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.fillJobVacancies',
  '__uclife__.aeSupplyDealerEntity',
]

test('granada mini-station: service buildings spawn, supply dealer on duty', async ({ sim }) => {
  sim.allowConsoleError(isExpectedTestModePortraitMissing)
  await sim.boot({ fixture: FIXTURE, requireHandles: REQUIRED_HANDLES })

  // 1. Boot lands in the drydock concourse.
  const sceneId = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getScene().getId(),
  )
  expect(sceneId, `fixture must boot in ${SCENE}`).toBe(SCENE)

  // 2. The three service buildings spawned on the concourse.
  const typeIds = await sim.page.evaluate(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getGameState().getScene().getBuildings()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((b: any) => b.typeId),
  )
  for (const typeId of SERVICE_BUILDINGS) {
    expect(typeIds.includes(typeId), `${typeId} missing from ${SCENE} buildings`).toBeTruthy()
  }

  // 3. Force the AE supply dealer on-shift — fillJobVacancies sets the
  // 'working' action so isAeSupplyDealerOnDuty fires (same setup the
  // fleet-supply smoke uses). The dealer is the special NPC already
  // seated at the supply depot's workstation.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fillJobVacancies(['ae_supply_dealer']),
  )

  // The AE supply dealer is seated at the supply depot...
  const dealerOpened = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const dealer = w.__uclife__.aeSupplyDealerEntity()
    if (!dealer) return false
    w.uclifeUI.getState().setDialogNPC(dealer)
    return true
  })
  expect(dealerOpened, `no AE supply dealer seated in ${SCENE} supply depot`).toBeTruthy()

  // ...and the order-supply branch surfaces while on duty.
  await sim.page.waitForSelector('button.dialog-option', { timeout: DOM_COMMIT_TIMEOUT_MS })
  const orderBranches = await sim.page.locator('button.dialog-option:has-text("订补给")').count()
  expect(orderBranches, 'AE supply-dealer order branch missing from dealer dialog').toBeGreaterThan(0)
})
