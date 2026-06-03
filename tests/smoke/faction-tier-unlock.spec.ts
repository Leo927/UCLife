// Phase 6.4.A — faction-tier emergence + player-faction reputation slot.
//
// Test outline:
//  1. Boot below threshold → assert no faction-tier unlock, NPC greeting
//     context has isPlayerFactionLeader=false.
//  2. Grant holdings (2 colonies + canon-faction rep) → advance one
//     day:rollover via forceFactionTierTick → assert faction-tier unlock
//     is set and player-faction inter-rep slot exists alongside Fed/Zeon/AE.
//  3. Assert playerFactionHasTierUnlock() returns true (proves the NPC
//     greeting context would flip to the leader variant).
//  4. Save round-trip → assert unlock + player-faction inter-rep persist.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.forceFactionTierTick',
  '__uclife__.playerFactionHasTierUnlock',
  '__uclife__.playerFactionGetInterRep',
  '__uclife__.setPlayerRep',
  '__uclife__.claimColony',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]

const GAME_DAY = 101

test('faction-tier: gate fires on threshold + rep slot seeded + save round-trip', async ({ sim }) => {
  await sim.boot({ fixture: 'faction-tier-below', requireHandles: REQUIRED_HANDLES })

  // 1. Below threshold — no unlock yet.
  const noUnlock = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.playerFactionHasTierUnlock(),
  )
  expect(noUnlock, 'faction-tier should not be unlocked before threshold').toBe(false)

  const noInterRep = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.playerFactionGetInterRep(),
  )
  expect(noInterRep, 'inter-rep should be empty before tier-up').toBeTruthy()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const beforeRepValues = Object.values(noInterRep as any).filter((v) => (v as number) !== 0)
  expect(beforeRepValues.length, 'all inter-rep values should be 0 before tier-up').toBe(0)

  // 2. Tick without meeting colony threshold — still no unlock.
  const noColonyTick = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (day) => (window as any).__uclife__.forceFactionTierTick(day),
    GAME_DAY,
  )
  expect(noColonyTick.hasFactionTier, 'should not flip with 0 colonies').toBe(false)

  // 3. Grant 2 colonies + sufficient canon-faction rep, then trigger tick.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => {
      ;(window as any).__uclife__.claimColony('marikoRefinery', null)
      ;(window as any).__uclife__.claimColony('colonyBuildSite', null)
    },
  )

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => {
      ;(window as any).__uclife__.setPlayerRep('anaheim', 40)
      ;(window as any).__uclife__.setPlayerRep('federation', 40)
    },
  )

  const tierUpTick = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (day) => (window as any).__uclife__.forceFactionTierTick(day),
    GAME_DAY + 1,
  )
  expect(tierUpTick.hasFactionTier, 'faction-tier should flip once all thresholds met').toBe(true)

  // 4. Verify player-faction rep slot seeded alongside canon factions.
  const interRep = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.playerFactionGetInterRep(),
  )
  expect(interRep, 'inter-rep slot must exist after tier-up').not.toBeNull()
  // Slot should contain anaheim + federation (seeded from player's personal rep).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect((interRep as any).anaheim, 'anaheim seeded in inter-rep').toBeDefined()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect((interRep as any).federation, 'federation seeded in inter-rep').toBeDefined()

  // 5. Faction-tier unlock persists through save round-trip.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (slot) => { await (window as any).__uclife__.saveGame(slot) },
    1,
  )
  const loadResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (slot) => (window as any).__uclife__.loadGame(slot),
    1,
  )
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)

  const afterLoad = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.playerFactionHasTierUnlock(),
  )
  expect(afterLoad, 'faction-tier unlock must survive save/load').toBe(true)

  const afterLoadRep = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.playerFactionGetInterRep(),
  )
  expect(afterLoadRep, 'inter-rep slot must survive save/load').not.toBeNull()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect((afterLoadRep as any).anaheim, 'anaheim in inter-rep after load').toBeDefined()
})
