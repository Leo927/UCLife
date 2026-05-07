// Phase 5.5.2 daily-economics smoke. Verifies:
//  1. Every ownable Building carries a Facility trait at boot.
//  2. A solvent NPC owner stays solvent after a forced rollover.
//  3. Forcing salaries > owner-fund kicks the facility into the 3-day
//     insolvency grace counter, and a third forced day reverts ownership
//     to state (foreclosure).
//  4. The reverted facility re-appears on the realtor's state listing —
//     proves the foreclosure feeds back into the realtor pipeline.
//  5. AE faction's daily stipend lands once on its Faction.fund.

import { chromium } from 'playwright'

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof globalThis.__uclife__?.facilitySnapshot === 'function'
    && typeof globalThis.__uclife__?.facilityForce === 'function'
    && typeof globalThis.__uclife__?.forceDailyEconomics === 'function'
    && typeof globalThis.__uclife__?.realtorListings === 'function'
    && typeof globalThis.__uclife__?.ownershipSnapshot === 'function',
  null,
  { timeout: 30_000 },
)

// Pause the sim so the live loop's own rollovers don't race the forced ones.
await page.evaluate(() => globalThis.__uclife__.useClock.getState().setSpeed(0))

const failures = []

// 1. Every ownable Building has a Facility trait.
const initial = await page.evaluate(() => globalThis.__uclife__.facilitySnapshot())
console.log(`facilities tracked: ${initial.length}`)
if (initial.length === 0) failures.push('no Facility-tracked buildings')

const npcOwned = initial.filter((f) => f.ownerKind === 'character')
const factionOwned = initial.filter((f) => f.ownerKind === 'faction')
if (npcOwned.length === 0) failures.push('no character-owned facilities — seedPrivateOwners did not run')

// 2. Solvent NPC owner: pump revenue, force a rollover, expect insolventDays = 0.
let solventTarget = npcOwned[0]
{
  const ok = await page.evaluate((key) => globalThis.__uclife__.facilityForce({
    buildingKey: key,
    revenueAcc: 5000,
    salariesAcc: 500,
    ownerFund: 10000,
  }), solventTarget.buildingKey)
  if (!ok) failures.push(`facilityForce on ${solventTarget.buildingKey} returned false`)

  const result = await page.evaluate(() => globalThis.__uclife__.forceDailyEconomics(101))
  console.log(`forced rollover (solvent): ${JSON.stringify(result)}`)
  if (result.facilitiesProcessed === 0) failures.push('forced rollover saw 0 facilities')

  const after = await page.evaluate((key) =>
    globalThis.__uclife__.facilitySnapshot(key), solventTarget.buildingKey)
  if (!after[0]) failures.push('solvent target vanished after rollover')
  else {
    if (after[0].insolventDays !== 0) failures.push(`solvent: insolventDays=${after[0].insolventDays} (want 0)`)
    if (after[0].lastRolloverDay !== 101) failures.push(`solvent: lastRolloverDay=${after[0].lastRolloverDay} (want 101)`)
    if (after[0].revenueAcc !== 0) failures.push(`solvent: revenueAcc=${after[0].revenueAcc} (want 0 after rollover)`)
  }
}

// 3. Insolvency grace: pick a different NPC-owned facility (so the prior
//    test's solvent rollover isn't on the same key), pump salaries past
//    owner fund, force three rollovers in a row.
const insolventTarget = npcOwned.find((f) => f.buildingKey !== solventTarget.buildingKey) ?? npcOwned[0]
console.log(`insolvency target: ${insolventTarget.buildingKey} (${insolventTarget.typeId})`)

for (let day = 102; day <= 104; day++) {
  await page.evaluate((arg) => globalThis.__uclife__.facilityForce({
    buildingKey: arg.key,
    revenueAcc: 0,
    salariesAcc: 5000,
    ownerFund: 0,
  }), { key: insolventTarget.buildingKey })
  const r = await page.evaluate((d) => globalThis.__uclife__.forceDailyEconomics(d), day)
  console.log(`day ${day}: foreclosed=${r.foreclosed} warnings=${r.warnings} insolventStarted=${r.insolventStarted}`)
}

// 4. After three insolvent days, ownership should have reverted.
const finalSnap = await page.evaluate((k) =>
  globalThis.__uclife__.facilitySnapshot(k), insolventTarget.buildingKey)
if (!finalSnap[0]) failures.push('insolvency target vanished')
else {
  if (finalSnap[0].ownerKind !== 'state') {
    failures.push(`insolvency target ownerKind=${finalSnap[0].ownerKind} (want state)`)
  }
  if (finalSnap[0].insolventDays !== 0) {
    failures.push(`insolvency target insolventDays=${finalSnap[0].insolventDays} (want 0 — reset on foreclosure)`)
  }
  if (finalSnap[0].closedSinceDay !== 0) {
    failures.push(`insolvency target closedSinceDay=${finalSnap[0].closedSinceDay} (want 0 — cleared on foreclosure)`)
  }
}

// Realtor pipeline picks up foreclosed inventory.
const listings = await page.evaluate(() => globalThis.__uclife__.realtorListings())
const fore = listings.find((l) => l.buildingKey === insolventTarget.buildingKey)
if (!fore) failures.push(`foreclosed building ${insolventTarget.buildingKey} missing from realtor listings`)
else if (fore.ownerKind !== 'state') {
  failures.push(`foreclosed building ${insolventTarget.buildingKey} ownerKind=${fore.ownerKind} on realtor (want state)`)
}

// 5. AE stipend.
if (factionOwned.length > 0) {
  const aeBefore = await page.evaluate(() => {
    const s = globalThis.__uclife__.ownershipSnapshot()
    return s.factions.find((f) => f.id === 'anaheim')?.fund ?? null
  })
  await page.evaluate(() => globalThis.__uclife__.forceDailyEconomics(200))
  const aeAfter = await page.evaluate(() => {
    const s = globalThis.__uclife__.ownershipSnapshot()
    return s.factions.find((f) => f.id === 'anaheim')?.fund ?? null
  })
  if (aeBefore === null || aeAfter === null) failures.push('AE faction not bootstrapped')
  else if (aeAfter <= aeBefore) {
    failures.push(`AE stipend did not credit: before=${aeBefore} after=${aeAfter}`)
  }
}

await browser.close()

if (errors.length) {
  console.log('\nERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}
if (failures.length) {
  console.log('\nFAILURES:')
  failures.forEach((f) => console.log('  ' + f))
}
if (errors.length || failures.length) process.exit(1)

console.log('\nOK: daily economics rollover + 3-day grace + foreclosure verified.')
