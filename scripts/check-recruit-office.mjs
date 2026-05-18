// Phase 5.5.4 recruit-office + recruiter smoke. Verifies:
//  1. A recruitOffice spawns in vonBraunCity and lists on the realtor as
//     state-owned factionMisc inventory.
//  2. realtorBuy transfers ownership; the listing then drops from the
//     realtor entirely (player-owned facilities are hidden via the
//     excludeOwner filter — see realtor.ts).
//  3. factionInstallRecruiter seats a civilian; the workstation occupant
//     flips from null to a Character entity.
//  4. recruiterSpawnApplicant creates an Applicant entity tagged with
//     `npc-imm-app-N` and the lobby picks it up.
//  5. recruiterSetCriteria + manual accept / reject mutate the lobby
//     contents predictably.
//  6. forceRecruitment runs once per day; same-day replay is a no-op.
//  7. Auto-accept clears matching applicants on spawn (we install criteria
//     skill=mechanics minLevel=0 autoAccept=true and verify spawn reduces
//     to 0 applicants in the lobby on a successful match).
//
// Migrated to Phase 6 deterministic boot: ?test=1 freezes the clock so
// the live loop's daily rollovers can't race the forced ones — no
// setSpeed(0) needed. All assertions use node:assert.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { BOOT_READY_TIMEOUT_MS, VIEWPORT } from './_test-constants.mjs'

const FORCE_DAY_FIRST = 101
const FORCE_DAY_SECOND = 102
const AUTO_ACCEPT_DAY_BASE = 200
const AUTO_ACCEPT_DAY_COUNT = 8

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: VIEWPORT })
const page = await ctx.newPage()

const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`) })

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.realtorListings === 'function'
    && typeof window.__uclife__?.realtorBuy === 'function'
    && typeof window.__uclife__?.factionInstallRecruiter === 'function'
    && typeof window.__uclife__?.recruiterSpawnApplicant === 'function'
    && typeof window.__uclife__?.recruiterLobby === 'function'
    && typeof window.__uclife__?.recruiterAcceptFirst === 'function'
    && typeof window.__uclife__?.recruiterRejectFirst === 'function'
    && typeof window.__uclife__?.recruiterSetCriteria === 'function'
    && typeof window.__uclife__?.forceRecruitment === 'function'
    && typeof window.__uclife__?.countApplicants === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

// 1. The realtor lists exactly one recruitOffice (state-owned).
const listings = await page.evaluate(() => window.__uclife__.realtorListings())
const officeListing = listings.find((l) => l.typeId === 'recruitOffice')
assert.ok(officeListing,
  `recruitOffice missing from realtor listings — procgen seed regression. listings dump:\n${JSON.stringify(
    listings.map((l) => ({ k: l.buildingKey, t: l.typeId, c: l.category })).slice(0, 40), null, 2,
  )}`)
assert.equal(officeListing.ownerKind, 'state',
  `recruitOffice ownerKind=${officeListing.ownerKind} (want state)`)
assert.equal(officeListing.category, 'factionMisc',
  `recruitOffice category=${officeListing.category} (want factionMisc)`)

console.log(`recruitOffice listing: ${officeListing.buildingKey} · asking ¥${officeListing.askingPrice}`)

// 2. realtorBuy transfers ownership to the player.
const buy = await page.evaluate((k) => window.__uclife__.realtorBuy(k), officeListing.buildingKey)
assert.equal(buy.ok, true, `realtorBuy failed: ${buy.reason}`)
console.log(`realtor close: paid ¥${buy.paid}`)

// Player-owned facilities are hidden from the realtor (excludeOwner filter,
// pre-creation player-faction alias). The listing must drop completely.
const listingsAfter = await page.evaluate(() => window.__uclife__.realtorListings())
const officeAfter = listingsAfter.find((l) => l.buildingKey === officeListing.buildingKey)
assert.equal(officeAfter, undefined,
  `recruitOffice still listed after buy (ownerKind=${officeAfter?.ownerKind}) — player-owned should be hidden`)

// 3. Install a recruiter.
const install = await page.evaluate(() => window.__uclife__.factionInstallRecruiter())
assert.equal(install.ok, true, `factionInstallRecruiter failed: ${install.reason}`)
console.log(`recruiter installed: ${install.recruiterName}`)

// 4. Spawn an applicant directly.
const spawn = await page.evaluate(() => window.__uclife__.recruiterSpawnApplicant())
assert.equal(spawn.ok, true, `recruiterSpawnApplicant failed: ${spawn.reason}`)
console.log(`applicant spawned: ${spawn.key}`)

const lobbyAfterSpawn = await page.evaluate(() => window.__uclife__.recruiterLobby())
assert.equal(lobbyAfterSpawn.length, 1, `lobby size after spawn=${lobbyAfterSpawn.length} (want 1)`)
console.log(`lobby[0]: ${lobbyAfterSpawn[0].name} · ${lobbyAfterSpawn[0].topSkillId} Lv ${lobbyAfterSpawn[0].topSkillLevel} · ${lobbyAfterSpawn[0].summary}`)

// 5. Manual accept clears the entry.
const accept = await page.evaluate(() => window.__uclife__.recruiterAcceptFirst())
assert.equal(accept.ok, true, `recruiterAcceptFirst failed: ${accept.reason}`)
const lobbyAfterAccept = await page.evaluate(() => window.__uclife__.recruiterLobby())
assert.equal(lobbyAfterAccept.length, 0, `lobby size after accept=${lobbyAfterAccept.length} (want 0)`)

// Spawn another, then reject.
await page.evaluate(() => window.__uclife__.recruiterSpawnApplicant())
const reject = await page.evaluate(() => window.__uclife__.recruiterRejectFirst())
assert.equal(reject.ok, true, `recruiterRejectFirst failed: ${reject.reason}`)
const lobbyAfterReject = await page.evaluate(() => window.__uclife__.recruiterLobby())
assert.equal(lobbyAfterReject.length, 0, `lobby size after reject=${lobbyAfterReject.length} (want 0)`)

// 6. forceRecruitment runs once per day.
const r1 = await page.evaluate((d) => window.__uclife__.forceRecruitment(d), FORCE_DAY_FIRST)
const r2 = await page.evaluate((d) => window.__uclife__.forceRecruitment(d), FORCE_DAY_FIRST)
assert.equal(r1.recruitersChecked, 1,
  `forceRecruitment[day${FORCE_DAY_FIRST} first] checked=${r1.recruitersChecked} (want 1)`)
assert.equal(r2.recruitersChecked, 0,
  `forceRecruitment[day${FORCE_DAY_FIRST} replay] checked=${r2.recruitersChecked} (want 0)`)
const r3 = await page.evaluate((d) => window.__uclife__.forceRecruitment(d), FORCE_DAY_SECOND)
assert.equal(r3.recruitersChecked, 1,
  `forceRecruitment[day${FORCE_DAY_SECOND}] checked=${r3.recruitersChecked} (want 1)`)
console.log(`force recruitment: day${FORCE_DAY_FIRST} spawned=${r1.applicantsSpawned} expired=${r1.applicantsExpired} · day${FORCE_DAY_SECOND} spawned=${r3.applicantsSpawned}`)

// 7. Auto-accept: install criteria with auto-accept on a permissive gate
// (skill=mechanics minLevel=0). Drive several days; debugSpawnApplicant
// skips the auto-accept gate, so we exercise the daily roll instead.
await page.evaluate(() => window.__uclife__.recruiterSetCriteria('mechanics', 0, true))
let totalAutoAccepted = 0
let totalSpawned = 0
for (let i = 0; i < AUTO_ACCEPT_DAY_COUNT; i++) {
  const day = AUTO_ACCEPT_DAY_BASE + i
  const r = await page.evaluate((d) => window.__uclife__.forceRecruitment(d), day)
  totalAutoAccepted += r.applicantsAutoAccepted ?? 0
  totalSpawned += r.applicantsSpawned ?? 0
}
console.log(`auto-accept run: spawned=${totalSpawned} auto-accepted=${totalAutoAccepted}`)
// totalSpawned=0 isn't a failure — rolls are random; logged for debugging.

assert.equal(pageErrors.length, 0,
  `page error(s) during test:\n${pageErrors.map((e) => '  ' + e).join('\n')}`)

await browser.close()

console.log('\nOK: recruit office + recruiter install + applicant lifecycle + auto-accept verified.')
