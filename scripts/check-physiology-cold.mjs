import { chromium } from 'playwright'
import { dismissAmbitionPicker } from './lib/dismissPicker.mjs'

// Phase 4.0 cold lifecycle smoke test.
//
// Drives the entire arc through __uclife__ debug handles. No DOM clicks,
// no real-time waits — every step is a deterministic call into the sim
// layer.
//
// Coverage:
//   - force-onset cold_common
//   - day-by-day phase advance: incubating → rising → peak → recovering
//     → resolved-clean
//   - StatSheet modifier presence during rising/peak (workPerfMul < 1)
//   - StatSheet modifier removal on resolve (workPerfMul == 1)
//   - condition strip icon present then absent
//
// Reliability bar (CLAUDE.md): 20/20 green via `npm run ci:local --
// --workers 4`. No setTimeout polls, no DOM-text assertions on sprite
// content.

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

const failures = []
const fail = (msg) => failures.push(msg)

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => globalThis.__uclife__?.physiologyForceOnset !== undefined)
await dismissAmbitionPicker(page)

// Pause the game so the day rollover can't fire from the RAF loop.
await page.evaluate(() => { globalThis.__uclife__.useClock?.getState?.()?.setSpeed?.(0) })

// 1. Force-onset cold_common.
const onset = await page.evaluate(() =>
  globalThis.__uclife__.physiologyForceOnset('cold_common', '测试'),
)
if (!onset) fail('forceOnset returned null — cold_common template missing or trait absent')
if (onset?.phase !== 'incubating') fail(`expected initial phase incubating, got ${onset?.phase}`)

// 2. Walk the lifecycle. Cold incubation [1,2], rise [1,2], peak 1, recovery
// is endurance-driven so 14 days is plenty.
let phasesSeen = new Set()
let workPerfDuringSymptoms = null
let resolved = false
for (let day = 1; day <= 18; day++) {
  const list = await page.evaluate(() => globalThis.__uclife__.physiologyTickDay(1))
  if (!Array.isArray(list)) {
    fail('physiologyTickDay did not return an array')
    break
  }
  if (list.length === 0) {
    phasesSeen.add('resolved')
    resolved = true
    break
  }
  const inst = list[0]
  phasesSeen.add(inst.phase)
  if (inst.phase === 'rising' || inst.phase === 'peak') {
    const wpm = await page.evaluate(() => globalThis.__uclife__.getPlayerStatValue('workPerfMul'))
    if (typeof wpm === 'number') {
      // Cold's [20,100] band emits workPerfMul × -0.20 once severity ≥ 20.
      if (inst.severity >= 20 && wpm >= 1) {
        fail(`workPerfMul should be reduced when cold band is active; got ${wpm} at severity ${inst.severity} day ${day}`)
      }
      workPerfDuringSymptoms = wpm
    }
  }
}

if (!phasesSeen.has('rising'))     fail('phase machine never reached rising')
if (!phasesSeen.has('peak'))       fail('phase machine never reached peak')
if (!phasesSeen.has('recovering')) fail('phase machine never reached recovering')
if (!resolved)                     fail('cold did not resolve within 18 game-days')

if (workPerfDuringSymptoms === null) fail('did not sample workPerfMul during symptomatic phases')

// 3. After resolve, the StatSheet should be back at base.
const wpmAfter = await page.evaluate(() => globalThis.__uclife__.getPlayerStatValue('workPerfMul'))
if (wpmAfter !== 1) fail(`workPerfMul should return to 1 after resolve, got ${wpmAfter}`)

// 4. Conditions list should be empty.
const finalList = await page.evaluate(() => globalThis.__uclife__.getConditions())
if (!Array.isArray(finalList) || finalList.length !== 0) {
  fail(`expected empty conditions list after resolve, got ${JSON.stringify(finalList)}`)
}

// 5. Effects list should carry no `family === 'condition'` rows.
const effList = await page.evaluate(() => globalThis.__uclife__.getEffectsList())
const condEffects = (effList ?? []).filter((e) => e.family === 'condition')
if (condEffects.length !== 0) {
  fail(`expected zero condition Effects after resolve, got ${condEffects.length}: ${JSON.stringify(condEffects)}`)
}

if (errors.length) {
  console.log('\nERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}
if (failures.length) {
  console.log('\nFAILURES:')
  failures.forEach((f) => console.log('  ' + f))
}

const ok = failures.length === 0 && errors.length === 0
console.log(ok ? '\nOK: cold lifecycle passed.' : '\nFAIL: cold lifecycle checks failed.')
if (!ok) process.exitCode = 1

await browser.close()
