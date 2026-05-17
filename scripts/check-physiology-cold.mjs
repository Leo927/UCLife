import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { BOOT_READY_TIMEOUT_MS, VIEWPORT } from './_test-constants.mjs'

// Phase 4.0 cold lifecycle smoke test — migrated to the deterministic
// API (Phase 6, Category A). The sim clock is frozen by ?test=1; the
// physiologyTickDay verb advances the phase machine one game-day at a
// time without driving the wall clock.
//
// Coverage:
//   - force-onset cold_common
//   - day-by-day phase advance: incubating → rising → peak → recovering
//     → resolved-clean
//   - StatSheet modifier presence during rising/peak (workPerfMul < 1)
//   - StatSheet modifier removal on resolve (workPerfMul == 1)
//   - condition Effect list empty after resolve

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const COLD_LIFECYCLE_MAX_DAYS = 18
const COLD_SYMPTOM_SEVERITY_THRESHOLD = 20
const BASELINE_WORK_PERF_MUL = 1

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
    && typeof window.__uclife__?.physiologyTickDay === 'function'
    && typeof window.__uclife__?.getPlayerStatValue === 'function'
    && typeof window.__uclife__?.getConditions === 'function'
    && typeof window.__uclife__?.getEffectsList === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

const onset = await page.evaluate(() =>
  window.__uclife__.physiologyForceOnset('cold_common', '测试'),
)
assert.ok(onset, 'forceOnset returned null — cold_common template missing or trait absent')
assert.equal(onset.phase, 'incubating',
  `expected initial phase incubating, got ${onset.phase}`)

const phasesSeen = new Set()
let workPerfDuringSymptoms = null
let resolved = false
for (let day = 1; day <= COLD_LIFECYCLE_MAX_DAYS; day++) {
  const list = await page.evaluate(() => window.__uclife__.physiologyTickDay(1))
  assert.ok(Array.isArray(list),
    `physiologyTickDay should return an array, got ${typeof list} on day ${day}`)
  if (list.length === 0) {
    phasesSeen.add('resolved')
    resolved = true
    break
  }
  const inst = list[0]
  phasesSeen.add(inst.phase)
  if (inst.phase === 'rising' || inst.phase === 'peak') {
    const wpm = await page.evaluate(() => window.__uclife__.getPlayerStatValue('workPerfMul'))
    if (typeof wpm === 'number') {
      if (inst.severity >= COLD_SYMPTOM_SEVERITY_THRESHOLD && wpm >= BASELINE_WORK_PERF_MUL) {
        assert.fail(
          `workPerfMul should be reduced when cold band is active; got ${wpm} ` +
          `at severity ${inst.severity} day ${day}`,
        )
      }
      workPerfDuringSymptoms = wpm
    }
  }
}

assert.ok(phasesSeen.has('rising'), 'phase machine never reached rising')
assert.ok(phasesSeen.has('peak'), 'phase machine never reached peak')
assert.ok(phasesSeen.has('recovering'), 'phase machine never reached recovering')
assert.ok(resolved, `cold did not resolve within ${COLD_LIFECYCLE_MAX_DAYS} game-days`)
assert.ok(workPerfDuringSymptoms !== null,
  'did not sample workPerfMul during symptomatic phases')

const wpmAfter = await page.evaluate(() => window.__uclife__.getPlayerStatValue('workPerfMul'))
assert.equal(wpmAfter, BASELINE_WORK_PERF_MUL,
  `workPerfMul should return to ${BASELINE_WORK_PERF_MUL} after resolve, got ${wpmAfter}`)

const finalList = await page.evaluate(() => window.__uclife__.getConditions())
assert.ok(Array.isArray(finalList) && finalList.length === 0,
  `expected empty conditions list after resolve, got ${JSON.stringify(finalList)}`)

const effList = await page.evaluate(() => window.__uclife__.getEffectsList())
const condEffects = (effList ?? []).filter((e) => e.family === 'condition')
assert.equal(condEffects.length, 0,
  `expected zero condition Effects after resolve, got ${condEffects.length}: ${JSON.stringify(condEffects)}`)

assert.equal(errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`)

console.log('OK — check-physiology-cold:')
console.log(`  phases seen: ${[...phasesSeen].join(',')}`)
console.log(`  workPerfMul during symptoms: ${workPerfDuringSymptoms}`)
console.log(`  workPerfMul after resolve : ${wpmAfter}`)
console.log(`  conditions after resolve  : ${finalList.length}`)

await browser.close()
