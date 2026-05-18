import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { BOOT_READY_TIMEOUT_MS, VIEWPORT } from './_test-constants.mjs'

// Phase 4.1 injury demo smoke test — migrated to the deterministic API
// (Phase 6, Category A). "I sprained my ankle and limp until I get it
// splinted." The sim clock is frozen by ?test=1; physiologyTickDay
// advances the phase machine one game-day per call.
//
// Coverage:
//   - body-part-scoped onset on a specific limb
//   - phase machine reaches peak with walkingSpeed reduced
//   - untreated tier-1 injury stalls at peak (sprain requires pharmacy)
//   - commitTreatment(tier=1) flips stalled → recovering
//   - resolve clears the instance and restores walkingSpeed to 1

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const PEAK_PHASE_MAX_DAYS = 8
const RECOVERY_MAX_DAYS = 30
const BASELINE_WALKING_SPEED = 1
const SPRAIN_TREATMENT_TIER = 1

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: VIEWPORT })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })

await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.physiologyForceOnset === 'function'
    && typeof window.__uclife__?.physiologyCommitTreatment === 'function'
    && typeof window.__uclife__?.physiologyTickDay === 'function'
    && typeof window.__uclife__?.getPlayerStatValue === 'function'
    && typeof window.__uclife__?.getEffectsList === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

const onset = await page.evaluate(() =>
  window.__uclife__.physiologyForceOnset('sprain', '滑倒', 'left-ankle'),
)
assert.ok(onset, 'forceOnset returned null — sprain template missing or trait absent')
assert.equal(onset.bodyPart, 'left-ankle',
  `expected bodyPart left-ankle, got ${onset.bodyPart}`)
assert.equal(onset.phase, 'incubating',
  `expected initial phase incubating, got ${onset.phase}`)
const instanceId = onset.instanceId

const baselineSpeed = await page.evaluate(() => window.__uclife__.getPlayerStatValue('walkingSpeed'))
assert.equal(baselineSpeed, BASELINE_WALKING_SPEED,
  `baseline walkingSpeed should be ${BASELINE_WALKING_SPEED}, got ${baselineSpeed}`)

let stalledSeen = false
let speedReducedAtPeak = null
for (let day = 1; day <= PEAK_PHASE_MAX_DAYS; day++) {
  const list = await page.evaluate(() => window.__uclife__.physiologyTickDay(1))
  assert.ok(Array.isArray(list),
    `physiologyTickDay should return an array on day ${day}, got ${typeof list}`)
  const inst = list.find((c) => c.instanceId === instanceId)
  assert.ok(inst, `sprain instance vanished prematurely on day ${day}`)
  if (inst.phase === 'peak') {
    const wspeed = await page.evaluate(() => window.__uclife__.getPlayerStatValue('walkingSpeed'))
    assert.ok(typeof wspeed === 'number' && wspeed < BASELINE_WALKING_SPEED,
      `walkingSpeed should be reduced at peak; got ${wspeed} at severity ${inst.severity}`)
    speedReducedAtPeak = wspeed
  }
  if (inst.phase === 'stalled') { stalledSeen = true; break }
}
assert.ok(stalledSeen,
  `untreated sprain did not stall within ${PEAK_PHASE_MAX_DAYS} game-days`)
assert.ok(speedReducedAtPeak !== null,
  'did not observe reduced walkingSpeed during peak')

const treated = await page.evaluate((id) =>
  window.__uclife__.physiologyCommitTreatment(id, 1, null),
  instanceId,
)
assert.ok(treated, `commitTreatment(tier=${SPRAIN_TREATMENT_TIER}) did not land`)

let resolved = false
for (let day = 1; day <= RECOVERY_MAX_DAYS; day++) {
  const list = await page.evaluate(() => window.__uclife__.physiologyTickDay(1))
  if (list.length === 0 || !list.some((c) => c.instanceId === instanceId)) {
    resolved = true
    break
  }
}
assert.ok(resolved,
  `sprain did not resolve within ${RECOVERY_MAX_DAYS} game-days post-treatment`)

const speedAfter = await page.evaluate(() => window.__uclife__.getPlayerStatValue('walkingSpeed'))
assert.equal(speedAfter, BASELINE_WALKING_SPEED,
  `walkingSpeed should be ${BASELINE_WALKING_SPEED} after resolve, got ${speedAfter}`)

const effList = await page.evaluate(() => window.__uclife__.getEffectsList())
const condEffects = (effList ?? []).filter((e) => e.family === 'condition' && e.id.includes(instanceId))
assert.equal(condEffects.length, 0,
  `expected zero condition Effects for resolved sprain, got ${condEffects.length}: ${JSON.stringify(condEffects)}`)

assert.equal(errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`)

console.log('OK — check-physiology-injury:')
console.log(`  instance: ${instanceId} bodyPart=${onset.bodyPart}`)
console.log(`  walkingSpeed at peak: ${speedReducedAtPeak}`)
console.log(`  walkingSpeed after resolve: ${speedAfter}`)

await browser.close()
