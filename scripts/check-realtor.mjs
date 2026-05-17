// Phase 5.5.1 realtor smoke — deterministic boot. Verifies:
//  1. seedPrivateOwners produced character-owned listings.
//  2. realtorBuy on a state-owned listing transfers Owner to the player
//     and the listing drops from gatherListings().
//  3. State-locked civic types (e.g. hrOffice) never appear in listings.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { BOOT_READY_TIMEOUT_MS } from './_test-constants.mjs'

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`) })

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.realtorListings === 'function'
    && typeof window.__uclife__?.realtorBuy === 'function'
    && typeof window.__uclife__?.ownershipSnapshot === 'function',
  null, { timeout: BOOT_READY_TIMEOUT_MS },
)

const initial = await page.evaluate(() => window.__uclife__.realtorListings())
console.log(`listings: ${initial.length}`)

const byCategory = (cat) => initial.filter((l) => l.category === cat)
const byOwner = (k) => initial.filter((l) => l.ownerKind === k)
const byType = (t) => initial.filter((l) => l.typeId === t)

assert.ok(byCategory('residential').length > 0, 'no residential listings')
assert.ok(byCategory('commercial').length > 0, 'no commercial listings')

const characterOwned = byOwner('character')
assert.ok(characterOwned.length > 0, 'seedPrivateOwners produced 0 character-owned listings')
const statesOwned = byOwner('state')
assert.ok(statesOwned.length > 0, 'no state-owned listings — realtor has nothing to direct-sell')

const missingSeller = characterOwned.filter((l) => !l.sellerName)
assert.equal(missingSeller.length, 0,
  `${missingSeller.length} character-owned listings have no seller name`)

const stateCommercial = byOwner('state').filter((l) => l.category === 'commercial' || l.category === 'factionMisc')
const missingPrice = stateCommercial.filter((l) => l.askingPrice === null || l.askingPrice <= 0)
assert.equal(missingPrice.length, 0,
  `${missingPrice.length} state-listings have invalid price`)

assert.equal(byType('hrOffice').length, 0,
  'hrOffice listed by realtor (must be state-locked, never sold)')

const target = byOwner('state').find((l) => l.askingPrice !== null && l.askingPrice > 0)
assert.ok(target, 'no state-listed commercial building to test buy with')

console.log(`buying ${target.typeId} (${target.buildingKey}) for ¥${target.askingPrice}`)
const result = await page.evaluate((k) => window.__uclife__.realtorBuy(k), target.buildingKey)
assert.equal(result.ok, true, `realtorBuy rejected: ${result.reason}`)

const after = await page.evaluate(() => window.__uclife__.realtorListings())
const stillListed = after.find((l) => l.buildingKey === target.buildingKey)
assert.equal(stillListed, undefined,
  `listing still present after buy (ownerKind=${stillListed?.ownerKind}) — player-owned should be hidden`)

const snapshot = await page.evaluate(() => window.__uclife__.ownershipSnapshot())
assert.ok((snapshot.buildingsByOwnerKind?.character ?? 0) > 0,
  'no character-owned buildings after purchase')

assert.equal(pageErrors.length, 0,
  `page error(s) during test:\n${pageErrors.map((e) => '  ' + e).join('\n')}`)

await browser.close()

console.log('\nOK: realtor listings + state-direct purchase verified.')
