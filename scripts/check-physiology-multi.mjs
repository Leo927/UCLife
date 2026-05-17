import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { BOOT_READY_TIMEOUT_MS, VIEWPORT } from './_test-constants.mjs'

// Phase 4.0 multi-condition smoke test — migrated to the deterministic
// API (Phase 6, Category A). Verifies that simultaneous cold + food_poisoning
// round-trip through the phase machine and the StatSheet without
// modifier collision.
//
// Coverage:
//   - both onset
//   - both progress through phases independently
//   - workPerfMul stacks multiplicatively (cold band × food_poisoning band)
//   - food_poisoning stalls at requiredTier 1 untreated
//   - clinic flow (diagnose + commitTreatment to tier 1) flips it back
//     to recovering on the next tick

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const PHASE_WALK_MAX_DAYS = 8
const STACKED_WORK_PERF_MUL_CEILING = 0.7
const FP_TREATMENT_TIER = 1
const FP_REGEN_RATE = 5

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
    && typeof window.__uclife__?.physiologyDiagnose === 'function'
    && typeof window.__uclife__?.physiologyCommitTreatment === 'function'
    && typeof window.__uclife__?.physiologyTickDay === 'function'
    && typeof window.__uclife__?.getPlayerStatValue === 'function'
    && typeof window.__uclife__?.getEffectsList === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

const cold = await page.evaluate(() => window.__uclife__.physiologyForceOnset('cold_common', 'A'))
const fp = await page.evaluate(() => window.__uclife__.physiologyForceOnset('food_poisoning', 'B'))
assert.ok(cold, 'cold_common onset failed')
assert.ok(fp, 'food_poisoning onset failed')

let bothActiveOnce = false
let stalledFp = null
for (let day = 1; day <= PHASE_WALK_MAX_DAYS; day++) {
  const list = await page.evaluate(() => window.__uclife__.physiologyTickDay(1))
  assert.ok(Array.isArray(list),
    `physiologyTickDay should return an array on day ${day}, got ${typeof list}`)
  const c = list.find((x) => x.templateId === 'cold_common')
  const f = list.find((x) => x.templateId === 'food_poisoning')
  if (c && f && c.phase !== 'incubating' && f.phase !== 'incubating') {
    const wpm = await page.evaluate(() => window.__uclife__.getPlayerStatValue('workPerfMul'))
    if (typeof wpm === 'number' && wpm < STACKED_WORK_PERF_MUL_CEILING && wpm > 0) {
      bothActiveOnce = true
    }
  }
  if (f && f.phase === 'stalled') stalledFp = f
}

assert.ok(bothActiveOnce,
  `expected workPerfMul < ${STACKED_WORK_PERF_MUL_CEILING} with cold + food_poisoning bands stacking`)
assert.ok(stalledFp,
  'food_poisoning did not stall (requiredTier 1 untreated)')

const diagOk = await page.evaluate((id) =>
  window.__uclife__.physiologyDiagnose(id), stalledFp.instanceId,
)
assert.ok(diagOk, 'diagnose returned false')

const commitOk = await page.evaluate(([id, tier, rate]) =>
  window.__uclife__.physiologyCommitTreatment(id, tier, rate),
  [stalledFp.instanceId, FP_TREATMENT_TIER, FP_REGEN_RATE],
)
assert.ok(commitOk, 'commitTreatment returned false')

const afterCommit = await page.evaluate(() => window.__uclife__.physiologyTickDay(1))
const fpAfter = afterCommit?.find?.((x) => x.templateId === 'food_poisoning')
if (fpAfter) {
  assert.notEqual(fpAfter.phase, 'stalled',
    `food_poisoning still stalled after pharmacy commit: ${JSON.stringify(fpAfter)}`)
}

const eff = await page.evaluate(() => window.__uclife__.getEffectsList())
const fpEffects = (eff ?? []).filter((e) =>
  e.family === 'condition' && (e.id ?? '').includes(stalledFp.instanceId),
)
assert.ok(fpEffects.length > 0,
  'expected food_poisoning band Effects to be present after diagnosis')
assert.ok(!fpEffects.some((e) => e.hidden === true),
  `expected hidden=false on every band after diagnosis; got ${JSON.stringify(fpEffects)}`)

assert.equal(errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`)

console.log('OK — check-physiology-multi:')
console.log(`  cold + food_poisoning stacked at workPerfMul < ${STACKED_WORK_PERF_MUL_CEILING}`)
console.log(`  food_poisoning stalled then resumed after pharmacy commit`)
console.log(`  diagnosed bands visible: ${fpEffects.length}`)

await browser.close()
