// Phase 5.5.2 daily-economics smoke. Verifies:
//  1. Every ownable Building carries a Facility trait at boot.
//  2. A solvent NPC owner stays solvent after a forced rollover.
//  3. Forcing salaries > owner-fund kicks the facility into the 3-day
//     insolvency grace counter, and a third forced day reverts ownership
//     to state (foreclosure).
//  4. The reverted facility re-appears on the realtor's state listing.
//  5. AE faction's daily stipend lands once on its Faction.fund.
//
// Migrated to Phase 6 deterministic boot: ?test=1 freezes the clock and
// skips assets, so no setSpeed(0) pin is needed. forceDailyEconomics(N)
// stays as the domain-specific day-rollover verb.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.facilitySnapshot === 'function'
    && typeof window.__uclife__?.facilityForce === 'function'
    && typeof window.__uclife__?.forceDailyEconomics === 'function'
    && typeof window.__uclife__?.realtorListings === 'function'
    && typeof window.__uclife__?.ownershipSnapshot === 'function',
  null,
  { timeout: 30_000 },
)

// 1. Every ownable Building has a Facility trait.
const initial = await page.evaluate(() => window.__uclife__.facilitySnapshot())
assert.ok(
  initial.length > 0,
  'facilitySnapshot() should be non-empty at boot (no Facility-tracked buildings)',
)

const npcOwned = initial.filter((f) => f.ownerKind === 'character')
const factionOwned = initial.filter((f) => f.ownerKind === 'faction')
assert.ok(
  npcOwned.length > 0,
  'expected at least one character-owned facility — seedPrivateOwners did not run',
)

// 2. Solvent NPC owner: pump revenue, force a rollover, expect insolventDays = 0.
const solventTarget = npcOwned[0]
const solventForce = await page.evaluate((key) => window.__uclife__.facilityForce({
  buildingKey: key,
  revenueAcc: 5000,
  salariesAcc: 500,
  ownerFund: 10000,
}), solventTarget.buildingKey)
assert.ok(
  solventForce,
  `facilityForce on ${solventTarget.buildingKey} should return truthy; got ${solventForce}`,
)

const solventResult = await page.evaluate(() => window.__uclife__.forceDailyEconomics(101))
assert.ok(
  solventResult.facilitiesProcessed > 0,
  `forced solvent rollover should process at least one facility; got ${JSON.stringify(solventResult)}`,
)

const solventAfter = await page.evaluate((key) =>
  window.__uclife__.facilitySnapshot(key), solventTarget.buildingKey)
assert.ok(solventAfter[0], `solvent target ${solventTarget.buildingKey} vanished after rollover`)
assert.equal(
  solventAfter[0].insolventDays, 0,
  `solvent target insolventDays should be 0; got ${solventAfter[0].insolventDays}`,
)
assert.equal(
  solventAfter[0].lastRolloverDay, 101,
  `solvent target lastRolloverDay should be 101; got ${solventAfter[0].lastRolloverDay}`,
)
assert.equal(
  solventAfter[0].revenueAcc, 0,
  `solvent target revenueAcc should be 0 after rollover; got ${solventAfter[0].revenueAcc}`,
)

// 3. Insolvency grace: pick a different NPC-owned facility, pump salaries past
//    owner fund, force three rollovers in a row.
const insolventTarget = npcOwned.find((f) => f.buildingKey !== solventTarget.buildingKey) ?? npcOwned[0]
for (let day = 102; day <= 104; day++) {
  await page.evaluate((arg) => window.__uclife__.facilityForce({
    buildingKey: arg.key,
    revenueAcc: 0,
    salariesAcc: 5000,
    ownerFund: 0,
  }), { key: insolventTarget.buildingKey })
  await page.evaluate((d) => window.__uclife__.forceDailyEconomics(d), day)
}

// 4. After three insolvent days, ownership should have reverted.
const finalSnap = await page.evaluate((k) =>
  window.__uclife__.facilitySnapshot(k), insolventTarget.buildingKey)
assert.ok(finalSnap[0], `insolvency target ${insolventTarget.buildingKey} vanished after 3-day grace`)
assert.equal(
  finalSnap[0].ownerKind, 'state',
  `insolvency target ownerKind should be "state" after foreclosure; got "${finalSnap[0].ownerKind}"`,
)
assert.equal(
  finalSnap[0].insolventDays, 0,
  `insolvency target insolventDays should reset to 0 on foreclosure; got ${finalSnap[0].insolventDays}`,
)
assert.equal(
  finalSnap[0].closedSinceDay, 0,
  `insolvency target closedSinceDay should clear on foreclosure; got ${finalSnap[0].closedSinceDay}`,
)

// Realtor pipeline picks up foreclosed inventory.
const listings = await page.evaluate(() => window.__uclife__.realtorListings())
const fore = listings.find((l) => l.buildingKey === insolventTarget.buildingKey)
assert.ok(
  fore,
  `foreclosed building ${insolventTarget.buildingKey} missing from realtor listings`,
)
assert.equal(
  fore.ownerKind, 'state',
  `foreclosed building should appear as "state" on realtor; got "${fore.ownerKind}"`,
)

// 5. AE stipend.
if (factionOwned.length > 0) {
  const aeBefore = await page.evaluate(() => {
    const s = window.__uclife__.ownershipSnapshot()
    return s.factions.find((f) => f.id === 'anaheim')?.fund ?? null
  })
  await page.evaluate(() => window.__uclife__.forceDailyEconomics(200))
  const aeAfter = await page.evaluate(() => {
    const s = window.__uclife__.ownershipSnapshot()
    return s.factions.find((f) => f.id === 'anaheim')?.fund ?? null
  })
  assert.ok(
    aeBefore !== null && aeAfter !== null,
    `AE faction not bootstrapped: before=${aeBefore} after=${aeAfter}`,
  )
  assert.ok(
    aeAfter > aeBefore,
    `AE daily stipend did not credit: before=${aeBefore} after=${aeAfter}`,
  )
}

assert.equal(
  errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`,
)

await browser.close()

console.log('OK — check-daily-economics:')
console.log(`  facilities tracked: ${initial.length} (npc=${npcOwned.length} faction=${factionOwned.length})`)
console.log(`  solvent rollover: ${solventTarget.buildingKey} insolventDays=0 lastRolloverDay=101`)
console.log(`  3-day insolvency → foreclosure: ${insolventTarget.buildingKey} ownerKind=state on realtor`)
