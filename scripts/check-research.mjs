// Phase 5.5.6 research-lab + planner smoke. Verifies:
//  1. A researchLab spawns in vonBraunCity and lists on the realtor as
//     state-owned factionMisc inventory.
//  2. realtorBuy transfers ownership.
//  3. factionInstallResearcher seats a civilian.
//  4. researchEnqueue('factory-tier-2') adds the row to the planner's queue.
//  5. forceResearchTick credits per-shift progress against the queue head.
//  6. After enough ticks, factory-tier-2 completes: done list contains
//     the id, unlock 'upgrade:factory-tier-2' is in factionUnlocks, and
//     lostOverflowToday > 0 (overflow into empty queue).

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { BOOT_READY_TIMEOUT_MS } from './_test-constants.mjs'

const TICK_DAY_BASE = 200
const TICK_COUNT = 22
const FIRST_TICK_DAY = 101

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
    && typeof window.__uclife__?.factionInstallResearcher === 'function'
    && typeof window.__uclife__?.researchEnqueue === 'function'
    && typeof window.__uclife__?.researchPlannerView === 'function'
    && typeof window.__uclife__?.forceResearchTick === 'function'
    && typeof window.__uclife__?.factionHasUnlock === 'function',
  null, { timeout: BOOT_READY_TIMEOUT_MS },
)

const listings = await page.evaluate(() => window.__uclife__.realtorListings())
const labListing = listings.find((l) => l.typeId === 'researchLab')
assert.ok(labListing, 'researchLab missing from realtor listings — procgen seed regression')
assert.equal(labListing.ownerKind, 'state', `researchLab ownerKind=${labListing.ownerKind} (want state)`)
assert.equal(labListing.category, 'factionMisc', `researchLab category=${labListing.category}`)
console.log(`researchLab listing: ${labListing.buildingKey} · asking ¥${labListing.askingPrice}`)

const buy = await page.evaluate((k) => window.__uclife__.realtorBuy(k), labListing.buildingKey)
assert.equal(buy.ok, true, `realtorBuy failed: ${buy.reason}`)
console.log(`realtor close: paid ¥${buy.paid}`)

const install = await page.evaluate(() => window.__uclife__.factionInstallResearcher())
assert.equal(install.ok, true, `factionInstallResearcher failed: ${install.reason}`)
console.log(`researcher installed: ${install.researcherName}`)

const enqueue = await page.evaluate(() => window.__uclife__.researchEnqueue('factory-tier-2'))
assert.equal(enqueue.ok, true, `researchEnqueue failed: ${enqueue.reason}`)

const view1 = await page.evaluate(() => window.__uclife__.researchPlannerView())
assert.equal(view1.queue.length, 1, `planner queue length=${view1.queue.length} (want 1)`)
assert.equal(view1.queue[0].id, 'factory-tier-2', `queue[0]=${view1.queue[0].id}`)

const tick1 = await page.evaluate(
  (day) => window.__uclife__.forceResearchTick(day),
  FIRST_TICK_DAY,
)
console.log(`tick day${FIRST_TICK_DAY}: progress=${tick1.progressGenerated.toFixed(1)} researchersWorked=${tick1.researchersWorked}`)
assert.equal(tick1.researchersWorked, 1, `researchersWorked=${tick1.researchersWorked} (want 1)`)

const view2 = await page.evaluate(() => window.__uclife__.researchPlannerView())
assert.ok(view2.queue[0].accumulated > 0,
  `planner accumulated after tick=${view2.queue[0].accumulated} (want > 0)`)

let totalLost = 0
for (let i = 0; i < TICK_COUNT; i++) {
  const r = await page.evaluate(
    (d) => window.__uclife__.forceResearchTick(d),
    TICK_DAY_BASE + i,
  )
  totalLost += r.lostOverflow
}

const view3 = await page.evaluate(() => window.__uclife__.researchPlannerView())
const unlocks = await page.evaluate(() => window.__uclife__.factionUnlocks())
const hasUnlock = await page.evaluate(
  () => window.__uclife__.factionHasUnlock('upgrade:factory-tier-2'),
)

console.log(`after ${TICK_COUNT} ticks: queue=${view3.queue.length} done=${view3.done.length} unlocks=[${unlocks.join(',')}]`)
assert.equal(view3.queue.length, 0, `queue after completion=${view3.queue.length} (want 0)`)
assert.equal(view3.done.length, 1, `done list length=${view3.done.length}`)
assert.equal(view3.done[0].id, 'factory-tier-2', `done[0]=${view3.done[0].id}`)
assert.ok(hasUnlock, 'FactionUnlocks missing upgrade:factory-tier-2 after completion')
assert.ok(totalLost > 0, `totalLost across ${TICK_COUNT} ticks=${totalLost} (want > 0 — overflow into empty queue)`)

assert.equal(pageErrors.length, 0,
  `page error(s) during test:\n${pageErrors.map((e) => '  ' + e).join('\n')}`)

await browser.close()

console.log('\nOK: research lab + planner + tick + completion + unlock + lost-overflow verified.')
