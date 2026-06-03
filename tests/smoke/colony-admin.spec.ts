/**
 * Phase 6.3.D — Colony admin-load gate + officer assignment + detention smoke test.
 *
 * Drives all assertions through __uclife__ debug handles (deterministic-tests
 * rules 1+2): no DOM clicks, no fixed sleep, no real-time waits.
 *
 * Scenario:
 *   1. Boot with player (engineering = 0 → admin capacity = 1), an NPC
 *      administrator candidate, and a pegasusClass ship docked at colony A.
 *   2. Claim colony A; assert admin load = 1 colony, capacity = 1 (balanced).
 *   3. Claim colony B; assert admin load = 2, overloaded by 1.
 *   4. Force a daily rollover for both colonies; assert that player-administered
 *      colonies receive the admin-overload stability penalty.
 *   5. Assign the NPC as administrator of colony A; assert personal load drops
 *      (colony A now costs 0.4 instead of 1.0 → total = 1.4, not 2).
 *   6. Add prisoners to brig overflow; dock at colony A; route overflow to
 *      colony detention; assert detention occupancy increases.
 *   7. Save → load round-trip; assert role assignments + detention persist.
 */
import { test, expect } from './_fixtures'

const FIXTURE = 'colony-admin'
const POI_A = 'marikoRefinery'
const POI_B = 'colonyBuildSite'
const NPC_KEY = 'zhang-wei'
const SAVE_SLOT = 4

test('colony admin-load gate + officer assignment + detention', async ({ sim }) => {
  await sim.boot({
    fixture: FIXTURE,
    requireHandles: [
      '__uclife_test__.step',
      '__uclife__.getGameState',
      '__uclife__.saveGame',
      '__uclife__.loadGame',
      '__uclife__.claimColony',
      '__uclife__.colonyAssignRole',
      '__uclife__.brigAddOverflow',
      '__uclife__.brigGetOverflow',
      '__uclife__.colonyRouteBrigOverflow',
      '__uclife__.forceColonyEconomics',
      '__uclife__.colonyResetRolloverDay',
    ],
  })

  // ── 1. Claim colony A ────────────────────────────────────────────────────

  await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.claimColony(poi, null),
    POI_A,
  )

  const loadAfterOneColony = await sim.page.evaluate(
    () => (window as any).__uclife__.getGameState().getColonyAdminLoad(),
  )
  // Player has engineering = 0 → capacity = loadCapBase = 1.
  // One colony with no admin → personal load = 1. Balanced.
  expect(loadAfterOneColony.capacity, 'capacity at zero skill = loadCapBase (1)').toBe(1)
  expect(loadAfterOneColony.totalLoad, 'single colony = 1 load unit').toBeCloseTo(1, 5)
  expect(loadAfterOneColony.isOverloaded, 'one colony at capacity = not overloaded').toBe(false)

  // ── 2. Claim colony B → overloaded ───────────────────────────────────────

  await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.claimColony(poi, null),
    POI_B,
  )

  const loadAfterTwoColonies = await sim.page.evaluate(
    () => (window as any).__uclife__.getGameState().getColonyAdminLoad(),
  )
  expect(loadAfterTwoColonies.totalLoad, 'two colonies = 2 load units').toBeCloseTo(2, 5)
  expect(loadAfterTwoColonies.overloadAmount, 'overload = 2 - 1 = 1').toBeCloseTo(1, 5)
  expect(loadAfterTwoColonies.isOverloaded, 'two colonies with capacity 1 = overloaded').toBe(true)

  // ── 3. Stability penalty applies on daily rollover ────────────────────────

  const econBeforeA = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyEconomics(poi),
    POI_A,
  )

  // Reset rollover guard so we can force a second rollover on the same day.
  await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.colonyResetRolloverDay(poi),
    POI_A,
  )
  await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.colonyResetRolloverDay(poi),
    POI_B,
  )

  await sim.page.evaluate(() => (window as any).__uclife__.forceColonyEconomics())

  const econAfterA = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyEconomics(poi),
    POI_A,
  )
  // Colony A has no admin → should have received the overload stability penalty.
  // overload = 1, penalty per point = -10 → stability delta includes -10.
  const stabilityDeltaA = econAfterA.stabilityScore - econBeforeA.stabilityScore
  expect(stabilityDeltaA, 'colony A (no admin) gets admin-overload stability penalty').toBeLessThan(0)

  // ── 4. Assign NPC as administrator of colony A ────────────────────────────

  const assignResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ poi, key }: { poi: string; key: string }) => (window as any).__uclife__.colonyAssignRole(poi, 'administrator', key),
    { poi: POI_A, key: NPC_KEY },
  )
  expect(assignResult.ok, 'role assignment should succeed').toBe(true)

  const rolesA = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyRoles(poi),
    POI_A,
  )
  expect(rolesA.administratorKey, 'colony A administrator should be set to NPC key').toBe(NPC_KEY)

  // Admin reduces colony A load by adminLoadReductionFraction (0.6).
  // Colony A personal load = 1 * (1 - 0.6) = 0.4.
  // Colony B personal load = 1.
  // Total = 1.4, capacity = 1 → overload = 0.4 (less than before, which was 1).
  const loadAfterAdmin = await sim.page.evaluate(
    () => (window as any).__uclife__.getGameState().getColonyAdminLoad(),
  )
  expect(loadAfterAdmin.totalLoad, 'load drops after assigning admin').toBeLessThan(2)
  expect(loadAfterAdmin.totalLoad, 'total load ≈ 1.4 after admin assignment').toBeCloseTo(1.4, 5)
  expect(loadAfterAdmin.overloadAmount, 'overload drops from 1 to 0.4').toBeCloseTo(0.4, 5)

  // ── 5. Stability: colony A (now with admin) gets no penalty on next rollover ─

  const econBeforeA2 = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyEconomics(poi),
    POI_A,
  )
  const econBeforeB2 = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyEconomics(poi),
    POI_B,
  )

  await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.colonyResetRolloverDay(poi),
    POI_A,
  )
  await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.colonyResetRolloverDay(poi),
    POI_B,
  )
  await sim.page.evaluate(() => (window as any).__uclife__.forceColonyEconomics())

  const econAfterA2 = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyEconomics(poi),
    POI_A,
  )
  const econAfterB2 = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyEconomics(poi),
    POI_B,
  )

  const stabilityDeltaA2 = econAfterA2.stabilityScore - econBeforeA2.stabilityScore
  const stabilityDeltaB2 = econAfterB2.stabilityScore - econBeforeB2.stabilityScore

  // Colony A has an admin → no overload penalty for colony A.
  // Colony B has no admin → receives overload penalty (overload = 0.4 → penalty = -4).
  expect(stabilityDeltaA2, 'colony A (admin assigned) gets NO overload penalty').toBeGreaterThan(stabilityDeltaB2)

  // ── 6. Colony detention — brig overflow routing ───────────────────────────

  const detentionBefore = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyRoles(poi),
    POI_A,
  )
  expect(detentionBefore.detentionOccupants.length, 'detention starts empty').toBe(0)

  // Force-add prisoners to brig overflow (simulates brig at capacity).
  await sim.page.evaluate(
    (id: string) => (window as any).__uclife__.brigAddOverflow(id, 'pirate'),
    'pow-overflow-001',
  )
  await sim.page.evaluate(
    (id: string) => (window as any).__uclife__.brigAddOverflow(id, 'pirate'),
    'pow-overflow-002',
  )

  const overflowBefore = await sim.page.evaluate(
    () => (window as any).__uclife__.brigGetOverflow(),
  )
  expect(overflowBefore.length, 'overflow queue has 2 prisoners before routing').toBe(2)

  // Route overflow prisoners to colony A detention.
  const routeResult = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.colonyRouteBrigOverflow(poi),
    POI_A,
  )
  expect(routeResult.routed, '2 prisoners should route to colony detention').toBe(2)

  const overflowAfter = await sim.page.evaluate(
    () => (window as any).__uclife__.brigGetOverflow(),
  )
  expect(overflowAfter.length, 'overflow queue clears after routing').toBe(0)

  const detentionAfter = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyRoles(poi),
    POI_A,
  )
  expect(detentionAfter.detentionOccupants.length, 'detention has 2 occupants after routing').toBe(2)

  // ── 7. Save → load round-trip ─────────────────────────────────────────────

  await sim.page.evaluate(
    async (slot: number) => { await (window as any).__uclife__.saveGame(slot) },
    SAVE_SLOT,
  )

  const loadResult = await sim.page.evaluate(
    async (slot: number) => (window as any).__uclife__.loadGame(slot),
    SAVE_SLOT,
  )
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)

  const rolesAfterLoad = await sim.page.evaluate(
    (poi: string) => (window as any).__uclife__.getGameState().getColonyRoles(poi),
    POI_A,
  )
  expect(rolesAfterLoad.administratorKey, 'administrator key persists after save → load').toBe(NPC_KEY)
  expect(rolesAfterLoad.detentionOccupants.length, 'detention occupants persist after save → load').toBe(2)
})
