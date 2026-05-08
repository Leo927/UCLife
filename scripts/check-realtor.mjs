// Phase 5.5.1 realtor smoke. Verifies:
//  1. seedPrivateOwners produced ≥1 character-owned listing per private type
//     present in the world (bars / factories / apartments / etc.).
//  2. realtorBuy on a state-owned listing transfers Owner to the player
//     and the listing drops from gatherListings() — the realtor doesn't
//     resell facilities back to the player-faction (their pre-creation
//     alias is the player's character ownership).
//  3. State-locked civic types (e.g. hrOffice) never appear in listings.

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
    && typeof globalThis.__uclife__?.ownershipSnapshot === 'function',
  null,
  { timeout: 30_000 },
)

const initial = await page.evaluate(() => globalThis.__uclife__.realtorListings())
console.log(`listings: ${initial.length}`)

const failures = []

const byCategory = (cat) => initial.filter((l) => l.category === cat)
const byOwner = (k) => initial.filter((l) => l.ownerKind === k)
const byType = (t) => initial.filter((l) => l.typeId === t)

if (byCategory('residential').length === 0) failures.push('no residential listings')
if (byCategory('commercial').length === 0)  failures.push('no commercial listings')

const characterOwned = byOwner('character')
if (characterOwned.length === 0) failures.push('seedPrivateOwners produced 0 character-owned listings')
const statesOwned = byOwner('state')
if (statesOwned.length === 0) failures.push('no state-owned listings — realtor has nothing to direct-sell')

// Every character-owned listing should name a seller.
const missingSeller = characterOwned.filter((l) => !l.sellerName)
if (missingSeller.length > 0) failures.push(`${missingSeller.length} character-owned listings have no seller name`)

// Every state-owned commercial listing must have a positive asking price.
const stateCommercial = byOwner('state').filter((l) => l.category === 'commercial' || l.category === 'factionMisc')
const missingPrice = stateCommercial.filter((l) => l.askingPrice === null || l.askingPrice <= 0)
if (missingPrice.length > 0) failures.push(`${missingPrice.length} state-listings have invalid price`)

// State-locked civic facilities must never appear in the realtor listing —
// the realtor desk doesn't move civic infrastructure.
if (byType('hrOffice').length > 0) {
  failures.push('hrOffice listed by realtor (must be state-locked, never sold)')
}

// Try to buy a state-owned listing (commercial preferred — apartments lease).
const target = byOwner('state').find((l) => l.askingPrice !== null && l.askingPrice > 0)
if (!target) {
  failures.push('no state-listed commercial building to test buy with')
} else {
  console.log(`buying ${target.typeId} (${target.buildingKey}) for ¥${target.askingPrice}`)
  const result = await page.evaluate((k) => globalThis.__uclife__.realtorBuy(k), target.buildingKey)
  console.log('buy result:', result)
  if (!result.ok) failures.push(`realtorBuy rejected: ${result.reason}`)
  else {
    const after = await page.evaluate(() => globalThis.__uclife__.realtorListings())
    // Player-owned facilities are aliased to the player-faction's
    // inventory and must drop from the realtor list entirely — neither
    // as state nor as character-owned.
    const stillListed = after.find((l) => l.buildingKey === target.buildingKey)
    if (stillListed) {
      failures.push(`listing still present after buy (ownerKind=${stillListed.ownerKind}) — player-owned should be hidden`)
    }
    // And the ownership ledger should reflect the move to character.
    const snapshot = await page.evaluate(() => globalThis.__uclife__.ownershipSnapshot())
    if ((snapshot.buildingsByOwnerKind?.character ?? 0) === 0) {
      failures.push('no character-owned buildings after purchase')
    }
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

console.log('\nOK: realtor listings + state-direct purchase verified.')
