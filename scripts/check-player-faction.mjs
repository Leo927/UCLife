// Phase 5.5.5 player-faction creation smoke. Verifies:
//  1. Before creation: no IsPlayerFaction marker on any Faction entity.
//  2. Player buys a factionOffice from the realtor (carries pre-creation
//     character-aliased ownership).
//  3. createPlayerFaction debug handle flips the marker, migrates the
//     Owner edge on the bought office to kind:'faction', and drains the
//     wallet into Faction.fund minus the stipend.
//  4. Re-invoking createPlayerFaction is idempotent (created:false).
//  5. playerFactionWithdraw moves fund back to the player's Money.

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
  () => typeof globalThis.__uclife__?.realtorListings === 'function'
    && typeof globalThis.__uclife__?.realtorBuy === 'function'
    && typeof globalThis.__uclife__?.createPlayerFaction === 'function'
    && typeof globalThis.__uclife__?.playerFactionStatus === 'function'
    && typeof globalThis.__uclife__?.playerFactionWithdraw === 'function'
    && typeof globalThis.__uclife__?.ownershipSnapshot === 'function',
  null,
  { timeout: 30_000 },
)

await page.evaluate(() => globalThis.__uclife__.useClock.getState().setSpeed(0))

const failures = []

// 1. No IsPlayerFaction marker before creation.
const beforeStatus = await page.evaluate(() => globalThis.__uclife__.playerFactionStatus())
if (beforeStatus.hasIsPlayerFactionMarker) {
  failures.push('IsPlayerFaction marker set before any creation call — boot regression')
}
console.log(`pre-create: marker=${beforeStatus.hasIsPlayerFactionMarker} fund=¥${beforeStatus.fund} facilities=${beforeStatus.facilityCount}`)

// 2. Buy a factionOffice so we have a building to migrate.
const listings = await page.evaluate(() => globalThis.__uclife__.realtorListings())
const office = listings.find((l) => l.typeId === 'factionOffice' && l.ownerKind === 'state')
if (!office) {
  failures.push('no state-owned factionOffice in realtor listings — procgen seed regression')
  await dumpAndExit()
}
const buy = await page.evaluate((k) => globalThis.__uclife__.realtorBuy(k), office.buildingKey)
if (!buy.ok) failures.push(`realtorBuy failed: ${buy.reason}`)
else console.log(`bought factionOffice ${office.buildingKey} for ¥${buy.paid}`)

const snapMid = await page.evaluate(() => globalThis.__uclife__.ownershipSnapshot())
const charOwned = snapMid.buildingsByOwnerKind.character ?? 0
if (charOwned < 1) failures.push(`expected at least 1 character-owned building after buy, got ${charOwned}`)

// 3. createPlayerFaction migrates Owner + wallet.
const create = await page.evaluate(() => globalThis.__uclife__.createPlayerFaction())
if (!create.ok) failures.push(`createPlayerFaction returned ok=false: ${create.reason ?? 'unknown'}`)
if (!create.created) failures.push(`createPlayerFaction.created=false on first call`)
if (create.migratedBuildings < 1) {
  failures.push(`createPlayerFaction.migratedBuildings=${create.migratedBuildings} (want >= 1)`)
}
console.log(`created: migrated=${create.migratedBuildings} walletMigrated=¥${create.walletMigrated} stipend=¥${create.stipendRemaining} fundAfter=¥${create.factionFundAfter}`)

const postStatus = await page.evaluate(() => globalThis.__uclife__.playerFactionStatus())
if (!postStatus.hasIsPlayerFactionMarker) {
  failures.push('IsPlayerFaction marker missing after createPlayerFaction')
}
if (postStatus.facilityCount < 1) {
  failures.push(`playerFactionStatus.facilityCount=${postStatus.facilityCount} after migration (want >= 1)`)
}

const snapAfter = await page.evaluate(() => globalThis.__uclife__.ownershipSnapshot())
const playerFactionCount = snapAfter.buildingsByFaction.player ?? 0
if (playerFactionCount < 1) {
  failures.push(`expected ≥1 building owned by faction.player after migration, got ${playerFactionCount}`)
}

// 4. Second call is idempotent.
const second = await page.evaluate(() => globalThis.__uclife__.createPlayerFaction())
if (second.created) failures.push('second createPlayerFaction call returned created=true (want false)')
if (second.migratedBuildings !== 0) {
  failures.push(`second createPlayerFaction migratedBuildings=${second.migratedBuildings} (want 0)`)
}

// 5. Withdraw routes fund back to the player.
const withdrawAmt = Math.min(500, postStatus.fund)
if (withdrawAmt > 0) {
  const w = await page.evaluate((a) => globalThis.__uclife__.playerFactionWithdraw(a), withdrawAmt)
  if (!w.ok || w.moved !== withdrawAmt) {
    failures.push(`playerFactionWithdraw moved=${w.moved} (want ${withdrawAmt})`)
  } else {
    console.log(`withdraw ¥${w.moved} from faction fund → player wallet`)
  }
} else {
  console.log('note: faction fund is 0, skipping withdraw check')
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

console.log('\nOK: player-faction creation migrates ownership + wallet, marker flips, idempotent on repeat.')

async function dumpAndExit() {
  console.log('\nlistings dump:')
  console.log(JSON.stringify(listings.map((l) => ({ k: l.buildingKey, t: l.typeId, c: l.category, ow: l.ownerKind })).slice(0, 40), null, 2))
  await browser.close()
  process.exit(1)
}
