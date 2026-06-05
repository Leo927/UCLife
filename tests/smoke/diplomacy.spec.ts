/**
 * Phase 6.4.D — diplomacy council smoke test.
 *
 * Drives all assertions through __uclife__ debug handles (deterministic-tests
 * rules 1+2): no DOM clicks, no fixed sleep, no real-time waits.
 *
 * Scenario:
 *   1. Boot with player, 3 ships, 2 officer NPCs. Provision faction-tier
 *      (2 colonies, 3 ships, canon rep ≥ 80), create the player faction,
 *      and push the AE inter-faction standing above the meeting threshold.
 *   2. Assign officers to colony roles (council attendees).
 *   3. Run the day:rollover meeting-request tick → assert an AE diplomat
 *      meeting request fires.
 *   4. Convene the diplomacy council with AE → propose + sign a trade
 *      agreement → assert the diplomatic-state record + the FactionEffect
 *      (treaty:trade:anaheim) land, and the meeting request clears.
 *   5. Propose + decline a nonaggression pact → assert no state change
 *      (still only the trade treaty on record).
 *   6. Assert the post-war escalation flag is present but inert.
 *   7. Save → load round-trip → assert treaties persist.
 */
import { test, expect } from './_fixtures'

const FIXTURE = 'diplomacy'
const POI_A = 'marikoRefinery'
const POI_B = 'colonyBuildSite'
const NPC_ADMIN = 'zhou-lin'
const NPC_COMMANDER = 'kai-huang'
const AE = 'anaheim'
const SAVE_SLOT = 11

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
  '__uclife__.claimColony',
  '__uclife__.colonyAssignRole',
  '__uclife__.setPlayerRep',
  '__uclife__.forceFactionTierTick',
  '__uclife__.createPlayerFaction',
  '__uclife__.setPlayerFactionInterRep',
  '__uclife__.forceDiplomacyMeetingTick',
  '__uclife__.getDiplomacyMeetingRequests',
  '__uclife__.conveneDiplomacyCouncil',
  '__uclife__.signTreaty',
  '__uclife__.declineTreaty',
  '__uclife__.getDiplomaticRecord',
]

test('diplomacy: meeting request, sign trade, decline pact, inert escalation, save round-trip', async ({ sim }) => {
  await sim.boot({ fixture: FIXTURE, requireHandles: REQUIRED_HANDLES })

  // ── 1. Provision faction-tier ─────────────────────────────────────────────
  await sim.page.evaluate((poi: string) => (window as any).__uclife__.claimColony(poi, null), POI_A)
  await sim.page.evaluate((poi: string) => (window as any).__uclife__.claimColony(poi, null), POI_B)

  await sim.page.evaluate(() => {
    ;(window as any).__uclife__.setPlayerRep('anaheim', 40)
    ;(window as any).__uclife__.setPlayerRep('federation', 40)
  })

  const tierTick = await sim.page.evaluate(
    (day: number) => (window as any).__uclife__.forceFactionTierTick(day),
    200,
  )
  expect(tierTick.hasFactionTier, 'faction-tier should unlock when thresholds met').toBe(true)

  const factionResult = await sim.page.evaluate(
    () => (window as any).__uclife__.createPlayerFaction(),
  )
  expect(factionResult.ok, 'createPlayerFaction should succeed').toBe(true)

  // Push AE standing above the meeting-request threshold deterministically.
  const setRep = await sim.page.evaluate(
    ({ fid, val }: { fid: string; val: number }) =>
      (window as any).__uclife__.setPlayerFactionInterRep(fid, val),
    { fid: AE, val: 50 },
  )
  expect(setRep.ok, 'setPlayerFactionInterRep should succeed').toBe(true)

  // ── 2. Assign officer roles on colony A ───────────────────────────────────
  const adminAssign = await sim.page.evaluate(
    ({ poi, key }: { poi: string; key: string }) =>
      (window as any).__uclife__.colonyAssignRole(poi, 'administrator', key),
    { poi: POI_A, key: NPC_ADMIN },
  )
  expect(adminAssign.ok, 'administrator assignment should succeed').toBe(true)

  const commanderAssign = await sim.page.evaluate(
    ({ poi, key }: { poi: string; key: string }) =>
      (window as any).__uclife__.colonyAssignRole(poi, 'garrisonCommander', key),
    { poi: POI_A, key: NPC_COMMANDER },
  )
  expect(commanderAssign.ok, 'garrison commander assignment should succeed').toBe(true)

  // ── 3. day:rollover meeting-request tick → AE diplomat requests a meeting ──
  await sim.page.evaluate((day: number) => (window as any).__uclife__.forceDiplomacyMeetingTick(day), 201)

  const requests = await sim.page.evaluate(
    () => (window as any).__uclife__.getDiplomacyMeetingRequests(),
  )
  const aeRequest = (requests as any[]).find((r) => r.factionId === AE)
  expect(aeRequest, 'AE diplomat should request a meeting once standing ≥ threshold').toBeTruthy()

  // ── 4. Convene + sign a trade agreement with AE ───────────────────────────
  const session = await sim.page.evaluate(
    ({ poi, fid, t }: { poi: string; fid: string; t: string }) =>
      (window as any).__uclife__.conveneDiplomacyCouncil(poi, fid, t),
    { poi: POI_A, fid: AE, t: 'trade' },
  )
  expect(session, 'conveneDiplomacyCouncil should return a session').not.toBeNull()
  const attendees = (session as any).attendees
  expect(attendees.length, 'diplomacy council should have attendees').toBeGreaterThan(0)
  for (const a of attendees) {
    expect(['support', 'oppose', 'neutral'], 'each attendee has a valid stance').toContain((a as any).stance)
  }

  const signResult = await sim.page.evaluate(
    ({ poi, fid, t }: { poi: string; fid: string; t: string }) =>
      (window as any).__uclife__.signTreaty(poi, fid, t),
    { poi: POI_A, fid: AE, t: 'trade' },
  )
  expect(signResult.ok, 'signTreaty should succeed').toBe(true)

  // Diplomatic-state record lands.
  const recordAfterTrade = await sim.page.evaluate(
    (fid: string) => (window as any).__uclife__.getDiplomaticRecord(fid),
    AE,
  )
  expect(recordAfterTrade, 'AE diplomatic record should exist after signing').not.toBeNull()
  const tradeTreaty = (recordAfterTrade as any).treaties.find((t: any) => t.type === 'trade')
  expect(tradeTreaty, 'trade treaty should be on record').toBeTruthy()

  // FactionEffect lands on the player-faction sheet.
  const effectIds = await sim.page.evaluate(
    () => (window as any).__uclife__.getGameState().getPlayerFactionEffectIds(),
  )
  expect(effectIds, 'trade treaty FactionEffect should land on the player-faction')
    .toContain(`treaty:trade:${AE}`)

  // Signing clears the pending meeting request.
  const requestsAfterSign = await sim.page.evaluate(
    () => (window as any).__uclife__.getDiplomacyMeetingRequests(),
  )
  expect(
    (requestsAfterSign as any[]).some((r) => r.factionId === AE),
    'meeting request should clear after signing',
  ).toBe(false)

  // ── 5. Propose + decline a nonaggression pact → no state change ────────────
  const declineResult = await sim.page.evaluate(
    ({ poi, fid, t }: { poi: string; fid: string; t: string }) =>
      (window as any).__uclife__.declineTreaty(poi, fid, t),
    { poi: POI_A, fid: AE, t: 'nonaggression' },
  )
  expect(declineResult.ok, 'declineTreaty should succeed').toBe(true)

  const recordAfterDecline = await sim.page.evaluate(
    (fid: string) => (window as any).__uclife__.getDiplomaticRecord(fid),
    AE,
  )
  const treatyTypes = (recordAfterDecline as any).treaties.map((t: any) => t.type)
  expect(treatyTypes, 'declining must not add a treaty').not.toContain('nonaggression')
  expect(treatyTypes, 'only the signed trade treaty remains on record').toEqual(['trade'])

  // ── 6. Post-war escalation flag present but inert ─────────────────────────
  expect(
    typeof tradeTreaty.postWarEscalation,
    'treaty carries an inert post-war escalation descriptor',
  ).toBe('string')
  expect(tradeTreaty.postWarEscalation.length, 'escalation descriptor is non-empty').toBeGreaterThan(0)

  // ── 7. Save → load round-trip → treaties persist ──────────────────────────
  await sim.page.evaluate(
    async (slot: number) => { await (window as any).__uclife__.saveGame(slot) },
    SAVE_SLOT,
  )
  const loadResult = await sim.page.evaluate(
    async (slot: number) => (window as any).__uclife__.loadGame(slot),
    SAVE_SLOT,
  )
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)

  const recordAfterLoad = await sim.page.evaluate(
    (fid: string) => (window as any).__uclife__.getDiplomaticRecord(fid),
    AE,
  )
  expect(recordAfterLoad, 'AE diplomatic record survives save/load').not.toBeNull()
  const tradeAfterLoad = (recordAfterLoad as any).treaties.find((t: any) => t.type === 'trade')
  expect(tradeAfterLoad, 'trade treaty persists after load').toBeTruthy()

  // The treaty FactionEffect also persists (rides on FactionEffectsList).
  const effectIdsAfterLoad = await sim.page.evaluate(
    () => (window as any).__uclife__.getGameState().getPlayerFactionEffectIds(),
  )
  expect(effectIdsAfterLoad, 'trade treaty FactionEffect persists after load')
    .toContain(`treaty:trade:${AE}`)
})
