/**
 * Phase 6.3.C — Colony build-path smoke test.
 *
 * Verifies the end-to-end build-path arc:
 *   1. File a charter at a permits official; assert granted (or fee-gated when rep is short).
 *   2. Buy an establishment package; assert it is tracked as a cargo item in the fleet.
 *   3. Drop the package at a colony site; assert a new colony exists with a hab pod.
 *   4. Authorize a refinery; advance construction days; assert facility transitions
 *      from in-progress to operational and appears in the facility roster.
 *   5. Assert warship slipway and large MS factory are colony-only (not city-realtor stock).
 *   6. Trigger a construction interrupt deterministically; assert it pauses the game.
 *   7. Save round-trip; assert in-progress construction + facility roster persist.
 *
 * All assertions drive through __uclife__ debug handles — no DOM clicks,
 * no fixed sleeps (deterministic-tests rules 1–7).
 */
import { test, expect } from './_fixtures'

const FIXTURE = 'colony-build-ready'
const POI_ID = 'colonyBuildSite'
const SAVE_SLOT = 5

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.createPlayerFaction',
  '__uclife__.setPlayerStat',
  '__uclife__.colonyGrantCharter',
  '__uclife__.colonyBuyEstablishmentPackage',
  '__uclife__.colonyDropPackage',
  '__uclife__.colonyAuthorizeFacility',
  '__uclife__.colonyConstructionSnapshot',
  '__uclife__.forceColonyConstruction',
  '__uclife__.colonyFacilityRoster',
  '__uclife__.colonyOnlyFacilityTypes',
  '__uclife__.colonyTriggerInterrupt',
  '__uclife__.getSpeed',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]

test('colony build path — charter, package, construct, interrupt, save/load', async ({ sim }) => {
  await sim.boot({ fixture: FIXTURE, requireHandles: REQUIRED_HANDLES })

  // Create player faction so ownership operations have a faction to key on.
  const factionResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.createPlayerFaction(),
  )
  expect(factionResult.ok, `createPlayerFaction failed: ${JSON.stringify(factionResult)}`).toBe(true)

  // 1. Charter — the gate reads the player's live faction reputation
  // (diegetic), not a test-supplied number. With no standing, reject.
  const rejectedCharter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.colonyGrantCharter('efsf'),
  )
  expect(rejectedCharter.ok, 'charter with rep=0 should be rejected').toBe(false)
  expect(rejectedCharter.reason, 'reason should be rep_too_low').toBe('rep_too_low')

  // Raise EFSF standing above the gate, then the charter should be granted.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.setPlayerStat('reputation.efsf', 50),
  )
  const grantedCharter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.colonyGrantCharter('efsf'),
  )
  expect(grantedCharter.ok, `charter with rep=50 should succeed; got ${JSON.stringify(grantedCharter)}`).toBe(true)
  expect(grantedCharter.charterGranted, 'charterGranted should be true').toBe(true)

  // 2. Buy an establishment package; assert cargoId returned.
  const pkgResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.colonyBuyEstablishmentPackage(),
  )
  expect(pkgResult.ok, `colonyBuyEstablishmentPackage failed: ${JSON.stringify(pkgResult)}`).toBe(true)
  expect(pkgResult.cargoId, 'cargoId should be the establishment-package id').toBe('colony-establishment-package')

  // 3. Drop the package at the colony site; assert ownership and scene.
  const colonyShouldBeUnowned = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.getGameState().getColonyOwnership(poi),
    POI_ID,
  )
  expect(colonyShouldBeUnowned.isPlayerOwned, 'colony should be unowned before drop').toBe(false)

  const dropResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyDropPackage(poi),
    POI_ID,
  )
  expect(dropResult.ok, `colonyDropPackage failed: ${JSON.stringify(dropResult)}`).toBe(true)
  expect(dropResult.sceneId, 'sceneId should be colonyBuildSiteScene').toBe('colonyBuildSiteScene')

  const colonyOwned = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.getGameState().getColonyOwnership(poi),
    POI_ID,
  )
  expect(colonyOwned.isPlayerOwned, 'colony should be owned after drop').toBe(true)

  // Hab pod should already exist as a fixed building in the scene.
  const initialRoster = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyFacilityRoster(poi),
    POI_ID,
  )
  expect(
    initialRoster.includes('colonyHabPod'),
    `initial roster should include colonyHabPod; got ${JSON.stringify(initialRoster)}`,
  ).toBe(true)

  // 4. Authorize a refinery and advance construction to completion.
  const authorizeResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyAuthorizeFacility(poi, 'colonyRefinery'),
    POI_ID,
  )
  expect(authorizeResult.ok, `colonyAuthorizeFacility failed: ${JSON.stringify(authorizeResult)}`).toBe(true)
  const jobId = authorizeResult.jobId as string

  // Verify job is in-progress.
  const snapshotBefore = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyConstructionSnapshot(poi),
    POI_ID,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jobBefore = (snapshotBefore.jobs as any[]).find((j: any) => j.id === jobId)
  expect(jobBefore, 'authorized job should appear in snapshot').toBeTruthy()
  expect(jobBefore.status, 'job should start inProgress').toBe('inProgress')

  // Advance construction past durationDays for colonyRefinery (7 days from config).
  // We force construction with a gameDay = authorizedDay + durationDays + 1 to
  // guarantee completion regardless of exact current day.
  const targetDay = (jobBefore.authorizedDay as number) + (jobBefore.durationDays as number) + 1
  const constructResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (day: number) => (window as any).__uclife__.forceColonyConstruction(day),
    targetDay,
  )
  expect(
    constructResult.jobsCompleted,
    `forceColonyConstruction should complete at least 1 job; got ${JSON.stringify(constructResult)}`,
  ).toBeGreaterThan(0)

  // Job should now be completed.
  const snapshotAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyConstructionSnapshot(poi),
    POI_ID,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jobAfter = (snapshotAfter.jobs as any[]).find((j: any) => j.id === jobId)
  expect(jobAfter.status, 'job should be completed after construction advance').toBe('completed')

  // Refinery Building entity should now exist in the scene.
  const rosterAfterConstruction = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyFacilityRoster(poi),
    POI_ID,
  )
  expect(
    rosterAfterConstruction.includes('colonyRefinery'),
    `roster should include colonyRefinery after completion; got ${JSON.stringify(rosterAfterConstruction)}`,
  ).toBe(true)

  // 5. Colony-only facility types include warship slipway + large MS factory.
  const colonyOnly = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.colonyOnlyFacilityTypes(),
  )
  expect(
    (colonyOnly as string[]).includes('colonyWarshipSlipway'),
    `colonyOnlyFacilityTypes should include colonyWarshipSlipway; got ${JSON.stringify(colonyOnly)}`,
  ).toBe(true)
  expect(
    (colonyOnly as string[]).includes('colonyMSFactory'),
    `colonyOnlyFacilityTypes should include colonyMSFactory; got ${JSON.stringify(colonyOnly)}`,
  ).toBe(true)

  // 6. Authorize another facility so there's an active job for the interrupt test.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyAuthorizeFacility(poi, 'colonyBarracks'),
    POI_ID,
  )

  const speedBefore = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getSpeed(),
  )
  // Speed is at least 0 before the interrupt; we just need to confirm the
  // interrupt call succeeds and sets speed to 0.
  const interruptResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyTriggerInterrupt(poi),
    POI_ID,
  )
  expect(interruptResult.ok, `colonyTriggerInterrupt failed: ${JSON.stringify(interruptResult)}`).toBe(true)

  const speedAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getSpeed(),
  )
  expect(speedAfter, `speed should be 0 after interrupt (was ${speedBefore})`).toBe(0)

  // 7. Save → load round-trip: construction state must persist.
  const snapshotBeforeSave = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyConstructionSnapshot(poi),
    POI_ID,
  )

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (slot: number) => { await (window as any).__uclife__.saveGame(slot) },
    SAVE_SLOT,
  )
  const loadResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (slot: number) => (window as any).__uclife__.loadGame(slot),
    SAVE_SLOT,
  )
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)

  const snapshotAfterLoad = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyConstructionSnapshot(poi),
    POI_ID,
  )
  expect(snapshotAfterLoad, 'colonyConstructionSnapshot should be non-null after load').toBeTruthy()
  expect(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (snapshotAfterLoad.jobs as any[]).length,
    `job count should match after load: expected ${(snapshotBeforeSave.jobs as any[]).length}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ).toBe((snapshotBeforeSave.jobs as any[]).length)

  // Verify completed job still reads as completed after load.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const completedAfterLoad = (snapshotAfterLoad.jobs as any[]).find((j: any) => j.id === jobId)
  expect(completedAfterLoad, 'completed job should survive save/load').toBeTruthy()
  expect(completedAfterLoad.status, 'completed status should persist').toBe('completed')

  // Facility roster from the scene world should also be restored.
  // Note: completed-job Building entities are re-spawned from saved construction
  // state during restore — see boot/saveHandlers/colony.ts.
  const rosterAfterLoad = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poi: string) => (window as any).__uclife__.colonyFacilityRoster(poi),
    POI_ID,
  )
  expect(
    rosterAfterLoad.includes('colonyHabPod'),
    `roster after load should still include colonyHabPod; got ${JSON.stringify(rosterAfterLoad)}`,
  ).toBe(true)
})
