// Phase 6.4.B recruitment-scale smoke test.
//
// Verifies:
//  1. Criteria with faction lean stored on the recruiter station.
//  2. Procgen applicants spawn with factionLean rolled at spawn time.
//  3. Manual approve routes the applicant into the hired roster + salary.
//  4. High-Leadership officer auto-approves matching applicants.
//  5. Low-Leadership officer mis-hires off-criteria applicants (seeded RNG).
//  6. Save round-trip: criteria + queued applicants persist.

import { test, expect, isExpectedTestModePortraitMissing } from './_fixtures'

const FORCE_DAY_CRITERIA = 300
const FORCE_DAY_HIGH_SKILL = 400
const FORCE_DAY_LOW_SKILL = 500

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.realtorListings',
  '__uclife__.realtorBuy',
  '__uclife__.factionInstallRecruiter',
  '__uclife__.recruiterSpawnApplicant',
  '__uclife__.recruiterLobby',
  '__uclife__.recruiterAcceptFirst',
  '__uclife__.recruiterSetCriteria',
  '__uclife__.forceRecruitment',
  '__uclife__.countApplicants',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
  '__uclife__.setOfficerLeadershipXp',
  '__uclife__.countRecruitedMembers',
  '__uclife__.forceFactionSalaryTick',
  '__uclife__.runOfficerAutoApproveForLobby',
  '__uclife__.recruiterLobbyFactionLeans',
  '__uclife__.recruiterCriteriaSnapshot',
]

test('recruitment-scale: criteria, spawn, approve, officer Leadership, save round-trip', async ({ sim }) => {
  sim.allowConsoleError(isExpectedTestModePortraitMissing)
  await sim.boot({ fixture: 'colony-recruitment-post', requireHandles: REQUIRED_HANDLES })

  // 1. Buy the recruiter office and install an officer.
  const listings = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.realtorListings(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const officeListing = listings.find((l: any) => l.typeId === 'recruitOffice')
  expect(officeListing, 'recruitOffice missing from realtor listings').toBeTruthy()

  const buy = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.realtorBuy(k),
    officeListing.buildingKey,
  )
  expect(buy.ok, `realtorBuy failed: ${buy.reason}`).toBe(true)

  const install = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.factionInstallRecruiter(),
  )
  expect(install.ok, `factionInstallRecruiter failed: ${install.reason}`).toBe(true)

  // 2. Set criteria with faction lean ('federation') and a skill gate.
  const setCrit = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterSetCriteria('piloting', 20, false, 'federation'),
  )
  expect(setCrit.ok, `recruiterSetCriteria failed: ${setCrit.reason}`).toBe(true)

  const crit0 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterCriteriaSnapshot(),
  )
  expect(crit0, 'criteria snapshot should be non-null').not.toBeNull()
  expect(crit0.factionLean, 'factionLean should be set to federation').toBe('federation')
  expect(crit0.skill).toBe('piloting')
  expect(crit0.minLevel).toBe(20)

  // 3. Force-spawn applicants and verify factionLean is rolled.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterSpawnApplicant(),
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterSpawnApplicant(),
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterSpawnApplicant(),
  )

  const leans = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterLobbyFactionLeans(),
  )
  expect(leans.length).toBeGreaterThanOrEqual(1)
  // Every spawned applicant should have a non-null factionLean from the pool.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const entry of leans as any[]) {
    expect(
      ['federation', 'zeon', 'anaheim', 'civilian'].includes(entry.factionLean),
      `factionLean '${entry.factionLean}' not in pool`,
    ).toBe(true)
  }

  // 4. Manually approve first applicant → verify hired roster grows and salary is non-zero.
  const preApproveCount = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.countRecruitedMembers(),
  )

  const accept = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterAcceptFirst(),
  )
  expect(accept.ok, `recruiterAcceptFirst failed: ${accept.reason}`).toBe(true)

  const postApproveCount = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.countRecruitedMembers(),
  )
  expect(postApproveCount).toBe(preApproveCount + 1)

  const salary0 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.forceFactionSalaryTick(),
  )
  expect(salary0.membersPaid).toBeGreaterThanOrEqual(1)
  expect(salary0.totalDebit).toBeGreaterThan(0)

  // 5. High-Leadership officer: set autoAccept + set officer skill >= threshold.
  //    Force daily roll → matching applicants should be auto-accepted.
  const HIGH_XP = 3000 // engineering level ~30+
  const highSkillRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (xp) => (window as any).__uclife__.setOfficerLeadershipXp(xp),
    HIGH_XP,
  )
  expect(highSkillRes.ok, `setOfficerLeadershipXp high failed: ${highSkillRes.reason}`).toBe(true)
  expect(highSkillRes.level, 'officer level should be >= threshold after HIGH_XP').toBeGreaterThanOrEqual(30)

  // Enable autoAccept with lenient criteria (accept any skill ≥0 with any faction).
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterSetCriteria('piloting', 0, true, null),
  )

  const preHighCount = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.countRecruitedMembers(),
  )
  for (let i = 0; i < 8; i++) {
    const day = FORCE_DAY_HIGH_SKILL + i
    await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (d) => (window as any).__uclife__.forceRecruitment(d),
      day,
    )
  }
  const postHighCount = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.countRecruitedMembers(),
  )
  // High-skill officer should have auto-accepted at least some matching applicants.
  expect(postHighCount, 'high-skill officer should auto-accept matching applicants').toBeGreaterThan(preHighCount)

  // 6. Low-Leadership officer mis-hire: set officer skill = 0 (level 0 < threshold 30),
  //    set impossibly restrictive criteria (minLevel 99), pre-fill lobby,
  //    run auto-approve-for-lobby and assert some mis-hires occur.
  const lowSkillRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.setOfficerLeadershipXp(0),
  )
  expect(lowSkillRes.ok, `setOfficerLeadershipXp low failed: ${lowSkillRes.reason}`).toBe(true)
  expect(lowSkillRes.level ?? 0, 'officer level should be 0 after XP=0').toBe(0)

  // Very restrictive criteria: no real applicant can match minLevel 99.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterSetCriteria('piloting', 99, true, null),
  )

  // Pre-fill lobby with off-criteria applicants (minLevel 99 means none will match).
  // Spawn enough that the 30% mis-hire rate almost certainly produces ≥1 acceptance.
  for (let i = 0; i < 10; i++) {
    await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__uclife__.recruiterSpawnApplicant(),
    )
  }
  const lobbyBeforeMishire = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.countApplicants(),
  )
  expect(lobbyBeforeMishire, 'should have applicants in lobby before mis-hire test').toBeGreaterThan(0)

  // Apply officer auto-approve for the pre-filled lobby (seeded RNG → deterministic).
  // lowSkillMishireRate=0.3, 10 applicants → P(0 mis-hires) ≈ 2.8% (very unlikely).
  const mishireResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.runOfficerAutoApproveForLobby(),
  )
  expect(mishireResult.applied, 'should have applied auto-approve to lobby').toBeGreaterThan(0)
  expect(mishireResult.accepted, 'low-skill officer should mis-hire at least one off-criteria applicant').toBeGreaterThan(0)

  // 7. Save round-trip: criteria + queued applicants persist across save/load.
  // Reset to simple criteria for the save test.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterSetCriteria('mechanics', 15, false, 'zeon'),
  )
  // Spawn a couple of applicants that will persist in the queue.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterSpawnApplicant(),
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterSpawnApplicant(),
  )

  const preSaveCrit = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterCriteriaSnapshot(),
  )
  const preSaveCount = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.countApplicants(),
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame('auto') })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.loadGame('auto') })

  const postLoadCrit = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterCriteriaSnapshot(),
  )
  const postLoadCount = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.countApplicants(),
  )

  expect(postLoadCrit, 'criteria should survive save/load').toEqual(preSaveCrit)
  expect(postLoadCount, 'applicant queue count should survive save/load').toBe(preSaveCount)
  expect(postLoadCrit.factionLean, 'factionLean in criteria should survive save/load').toBe('zeon')
})
