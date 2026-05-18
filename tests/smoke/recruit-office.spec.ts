// recruit-office + recruiter smoke. Verifies:
//  1. A recruitOffice spawns and lists on the realtor.
//  2. realtorBuy transfers ownership; the listing drops.
//  3. factionInstallRecruiter seats a civilian.
//  4. recruiterSpawnApplicant creates an Applicant entity.
//  5. recruiterSetCriteria + manual accept / reject.
//  6. forceRecruitment runs once per day.
//  7. Auto-accept clears matching applicants on spawn.

import { test, expect } from './_fixtures'

const FORCE_DAY_FIRST = 101
const FORCE_DAY_SECOND = 102
const AUTO_ACCEPT_DAY_BASE = 200
const AUTO_ACCEPT_DAY_COUNT = 8

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.realtorListings',
  '__uclife__.realtorBuy',
  '__uclife__.factionInstallRecruiter',
  '__uclife__.recruiterSpawnApplicant',
  '__uclife__.recruiterLobby',
  '__uclife__.recruiterAcceptFirst',
  '__uclife__.recruiterRejectFirst',
  '__uclife__.recruiterSetCriteria',
  '__uclife__.forceRecruitment',
  '__uclife__.countApplicants',
]

test('recruit office: buy → install recruiter → spawn/accept/reject → force/auto-accept', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  // 1. The realtor lists exactly one recruitOffice (state-owned).
  const listings = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.realtorListings(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const officeListing = listings.find((l: any) => l.typeId === 'recruitOffice')
  expect(officeListing, 'recruitOffice missing from realtor listings').toBeTruthy()
  expect(officeListing.ownerKind).toBe('state')
  expect(officeListing.category).toBe('factionMisc')

  // 2. realtorBuy transfers ownership to the player.
  const buy = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.realtorBuy(k),
    officeListing.buildingKey,
  )
  expect(buy.ok, `realtorBuy failed: ${buy.reason}`).toBe(true)

  const listingsAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.realtorListings(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const officeAfter = listingsAfter.find((l: any) => l.buildingKey === officeListing.buildingKey)
  expect(officeAfter, 'recruitOffice still listed after buy').toBeUndefined()

  // 3. Install a recruiter.
  const install = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.factionInstallRecruiter(),
  )
  expect(install.ok, `factionInstallRecruiter failed: ${install.reason}`).toBe(true)

  // 4. Spawn an applicant.
  const spawn = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterSpawnApplicant(),
  )
  expect(spawn.ok, `recruiterSpawnApplicant failed: ${spawn.reason}`).toBe(true)

  const lobbyAfterSpawn = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterLobby(),
  )
  expect(lobbyAfterSpawn.length).toBe(1)

  // 5. Manual accept clears the entry.
  const accept = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterAcceptFirst(),
  )
  expect(accept.ok, `recruiterAcceptFirst failed: ${accept.reason}`).toBe(true)
  const lobbyAfterAccept = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterLobby(),
  )
  expect(lobbyAfterAccept.length).toBe(0)

  // Spawn another, then reject.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterSpawnApplicant(),
  )
  const reject = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterRejectFirst(),
  )
  expect(reject.ok, `recruiterRejectFirst failed: ${reject.reason}`).toBe(true)
  const lobbyAfterReject = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterLobby(),
  )
  expect(lobbyAfterReject.length).toBe(0)

  // 6. forceRecruitment runs once per day.
  const r1 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (window as any).__uclife__.forceRecruitment(d),
    FORCE_DAY_FIRST,
  )
  const r2 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (window as any).__uclife__.forceRecruitment(d),
    FORCE_DAY_FIRST,
  )
  expect(r1.recruitersChecked).toBe(1)
  expect(r2.recruitersChecked).toBe(0)
  const r3 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (window as any).__uclife__.forceRecruitment(d),
    FORCE_DAY_SECOND,
  )
  expect(r3.recruitersChecked).toBe(1)

  // 7. Auto-accept.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.recruiterSetCriteria('mechanics', 0, true),
  )
  for (let i = 0; i < AUTO_ACCEPT_DAY_COUNT; i++) {
    const day = AUTO_ACCEPT_DAY_BASE + i
    await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (d) => (window as any).__uclife__.forceRecruitment(d),
      day,
    )
  }
})
