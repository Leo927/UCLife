/**
 * Phase 6.3.E — Colony threats smoke test.
 *
 * Covers pirate raids (force-raid handle, cooldown, auto-resolve) and stability-
 * collapse grace → ownership forfeit. All assertions go through __uclife__
 * debug handles — no DOM clicks, no fixed sleeps (deterministic-tests rules 1–7).
 *
 * Scenario A (raid fixture): pirate raid cooldown + auto-resolve mechanics.
 *   1. Claim the colony; verify garrison = 0 (no barracks, no commander).
 *   2. Force a raid at day 10 via colonyForceRaid; assert cooldown is set and
 *      the raid does NOT auto-resolve (garrison below threshold).
 *   3. Force another raid at day 11 (within 7-day cooldown); assert the
 *      colonyForceRaid still sets the threat state but the forceColonyThreats
 *      roll is gated by cooldown (raidsSpawned = 0 from the random system).
 *   4. Assert the raid cooldown gate works: forceColonyThreats within the
 *      cooldown window yields raidsSpawned = 0.
 *   5. Save → load; assert raid cooldown persists.
 *
 * Scenario B (collapse fixture): stability-collapse grace → ownership loss.
 *   6. Claim the colony; force economics rollovers to drop stability below floor.
 *   7. Force threat roll day 200 → assert warning fires + grace starts.
 *   8. Force threat roll day 201 → assert colony survives within grace.
 *   9. Save → load mid-grace; assert collapseGraceStartDay persists.
 *  10. Force threat roll day 203 (grace expired) → assert ownership lost.
 *  11. Assert colony is no longer player-owned and threat state is null.
 */
import { test, expect } from './_fixtures'
import { isKnownPixiBatcherStartup } from './_fixtures'

const POI_A = 'marikoRefinery'
const SAVE_SLOT = 5

// ── Scenario A: raid cooldown + auto-resolve ──────────────────────────────────

test('colony raid cooldown gate and auto-resolve detection', async ({ sim }) => {
  sim.allowConsoleError(isKnownPixiBatcherStartup)

  await sim.boot({
    fixture: 'colony-raid-target',
    requireHandles: [
      '__uclife_test__.step',
      '__uclife__.getGameState',
      '__uclife__.claimColony',
      '__uclife__.forceColonyEconomics',
      '__uclife__.colonyResetRolloverDay',
      '__uclife__.colonyGetThreatState',
      '__uclife__.colonySetThreatState',
      '__uclife__.forceColonyThreats',
      '__uclife__.colonyGetGarrisonStrength',
      '__uclife__.colonyForceRaid',
      '__uclife__.saveGame',
      '__uclife__.loadGame',
    ],
  })

  // 1. Claim the colony and verify the starting garrison is zero.
  await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.claimColony(poi, null),
    POI_A,
  )

  const ownership = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyOwnership(poi),
    POI_A,
  )
  expect(ownership.isPlayerOwned, 'colony must be player-owned after claim').toBe(true)

  const garrisonBefore = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.colonyGetGarrisonStrength(poi),
    POI_A,
  )
  expect(garrisonBefore.garrisonStrength, 'garrison = 0 with no barracks and no commander').toBe(0)
  expect(garrisonBefore.canAutoResolve, 'cannot auto-resolve without garrison').toBe(false)

  // 2. Force a raid at day 10 — confirm cooldown is set and auto-resolve = false.
  const raidResult = await sim.page.evaluate(
    ({ poi, day }: { poi: string; day: number }) => (window as any).__uclife__.colonyForceRaid(poi, day),
    { poi: POI_A, day: 10 },
  )
  expect(raidResult.ok, 'colonyForceRaid should succeed for a player colony').toBe(true)
  expect(raidResult.autoResolved, 'raid should NOT auto-resolve with zero garrison').toBe(false)
  expect(raidResult.garrisonStrength, 'garrison strength should be 0').toBe(0)

  const threatAfterRaid = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyThreatState(poi),
    POI_A,
  )
  expect(threatAfterRaid.lastRaidAttemptDay, 'lastRaidAttemptDay must be set after force raid').toBe(10)

  // 3+4. Verify the random-roll system respects the cooldown.
  //   forceColonyThreats at day 11 (1 day after last raid, cooldown = 7 days)
  //   should produce raidsSpawned = 0 regardless of RNG.
  const threatsWithinCooldown = await sim.page.evaluate(
    (day: number) => (window as any).__uclife__.forceColonyThreats(day),
    11,
  )
  expect(threatsWithinCooldown.raidsSpawned, 'no raid should spawn within the cooldown window').toBe(0)
  expect(threatsWithinCooldown.coloniesProcessed, 'threat system should still process the colony').toBe(1)

  // 4. Verify cooldown gate still holds on day 16 (10 + 7 - 1 = 16, still within window).
  const threatsAtEdge = await sim.page.evaluate(
    (day: number) => (window as any).__uclife__.forceColonyThreats(day),
    16,
  )
  expect(threatsAtEdge.raidsSpawned, 'no raid on day 16 (still within 7-day cooldown from day 10)').toBe(0)

  // 5. Save → load; assert raid cooldown persists.
  await sim.page.evaluate(
    async (slot: number) => { await (window as any).__uclife__.saveGame(slot) },
    SAVE_SLOT,
  )
  const loadResult = await sim.page.evaluate(
    async (slot: number) => (window as any).__uclife__.loadGame(slot),
    SAVE_SLOT,
  )
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)

  const threatAfterLoad = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyThreatState(poi),
    POI_A,
  )
  expect(threatAfterLoad.lastRaidAttemptDay, 'lastRaidAttemptDay must persist across save/load').toBe(10)
})

// ── Scenario B: stability collapse → ownership loss ───────────────────────────

test('colony stability collapse: grace period → ownership loss → no dangling refs', async ({ sim }) => {
  sim.allowConsoleError(isKnownPixiBatcherStartup)

  await sim.boot({
    fixture: 'colony-unstable',
    requireHandles: [
      '__uclife_test__.step',
      '__uclife__.getGameState',
      '__uclife__.claimColony',
      '__uclife__.colonyGetThreatState',
      '__uclife__.colonySetThreatState',
      '__uclife__.forceColonyThreats',
      '__uclife__.forceColonyEconomics',
      '__uclife__.colonyResetRolloverDay',
      '__uclife__.saveGame',
      '__uclife__.loadGame',
    ],
  })

  // 6. Claim the colony and drive stability below the floor via economics rollovers.
  //    marikoRefineryScene has a bar but no clinic.
  //    stability per rollover: baseScore(0) + bar(+10) - missingClinic(-15) = -5.
  //    After 7 rollovers: -35, below stabilityFloor (-30).
  await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.claimColony(poi, null),
    POI_A,
  )

  for (let d = 1; d <= 7; d++) {
    await sim.page.evaluate(
      (poi: string) => (window as any).__uclife__.colonyResetRolloverDay(poi),
      POI_A,
    )
    await sim.page.evaluate(
      (day: number) => (window as any).__uclife__.forceColonyEconomics(day),
      100 + d,
    )
  }

  const econAfter = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyEconomics(poi),
    POI_A,
  )
  expect(econAfter.stabilityScore, 'stability must be below the collapse floor (-30)').toBeLessThan(-30)

  // 7. Force threat roll on day 200 — first day below floor.
  const threats1 = await sim.page.evaluate(
    (day: number) => (window as any).__uclife__.forceColonyThreats(day),
    200,
  )
  expect(threats1.collapseWarningsFired, 'warning fires on first day below stability floor').toBe(1)
  expect(threats1.coloniesForfeited, 'colony is NOT forfeited on the first warning day').toBe(0)

  const threatState1 = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyThreatState(poi),
    POI_A,
  )
  expect(threatState1.collapseGraceStartDay, 'grace period starts on day 200').toBe(200)

  // 8. Force threat roll day 201 — within 3-day grace, no forfeit.
  const threats2 = await sim.page.evaluate(
    (day: number) => (window as any).__uclife__.forceColonyThreats(day),
    201,
  )
  expect(threats2.coloniesForfeited, 'colony survives within the grace period (day 201)').toBe(0)

  // 9. Save → load mid-grace; assert grace counter persists.
  await sim.page.evaluate(
    async (slot: number) => { await (window as any).__uclife__.saveGame(slot) },
    SAVE_SLOT,
  )
  const loadResult = await sim.page.evaluate(
    async (slot: number) => (window as any).__uclife__.loadGame(slot),
    SAVE_SLOT,
  )
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)

  const threatStateAfterLoad = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyThreatState(poi),
    POI_A,
  )
  expect(
    threatStateAfterLoad.collapseGraceStartDay,
    'collapseGraceStartDay persists across save/load round-trip',
  ).toBe(200)

  // 10. Force threat roll at day 203 (200 + 3 = grace expired; 203 − 200 = 3 ≥ collapseGraceDays).
  const threats3 = await sim.page.evaluate(
    (day: number) => (window as any).__uclife__.forceColonyThreats(day),
    203,
  )
  expect(threats3.coloniesForfeited, 'colony is forfeited when the grace period expires').toBe(1)

  // 11. Assert the colony is no longer player-owned (POI reverted).
  const ownershipAfterForfeit = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyOwnership(poi),
    POI_A,
  )
  expect(ownershipAfterForfeit.isPlayerOwned, 'colony must not be player-owned after forfeit').toBe(false)

  // Threat state should be null since the colony is no longer owned.
  const threatStateAfterForfeit = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyThreatState(poi),
    POI_A,
  )
  expect(threatStateAfterForfeit, 'threat state should be null after ownership loss').toBeNull()
})
