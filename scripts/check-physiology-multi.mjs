import { chromium } from 'playwright'
import { dismissAmbitionPicker } from './lib/dismissPicker.mjs'

// Phase 4.0 multi-condition smoke test.
//
// Verifies that simultaneous cold + food_poisoning round-trip through
// the phase machine and the StatSheet without modifier collision:
//
//   - both onset
//   - both progress through phases independently
//   - workPerfMul stacks multiplicatively (cold mild × food_poisoning band-a)
//   - food_poisoning stalls at requiredTier 1 untreated
//   - clinic flow (diagnose + commitTreatment to tier 1) flips it back
//     to recovering on the next tick
//
// All driven through __uclife__ debug handles for determinism.

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
await page.evaluate(() => { globalThis.__uclife__.useClock?.getState?.()?.setSpeed?.(0) })

// 1. Onset both.
const cold = await page.evaluate(() => globalThis.__uclife__.physiologyForceOnset('cold_common', 'A'))
const fp = await page.evaluate(() => globalThis.__uclife__.physiologyForceOnset('food_poisoning', 'B'))
if (!cold) fail('cold_common onset failed')
if (!fp) fail('food_poisoning onset failed')

// 2. Step a few days. Both should clear incubation and emit modifiers.
let bothActiveOnce = false
let stalledFp = null
for (let day = 1; day <= 8; day++) {
  const list = await page.evaluate(() => globalThis.__uclife__.physiologyTickDay(1))
  if (!Array.isArray(list)) { fail('tickDay did not return an array'); break }
  const c = list.find((x) => x.templateId === 'cold_common')
  const f = list.find((x) => x.templateId === 'food_poisoning')
  if (c && f && c.phase !== 'incubating' && f.phase !== 'incubating') {
    const wpm = await page.evaluate(() => globalThis.__uclife__.getPlayerStatValue('workPerfMul'))
    // cold band [20,100] is -0.20; food_poisoning band [20,100] is -0.30.
    // Stack: 0.8 * 0.7 = 0.56 (when both bands are active).
    if (typeof wpm === 'number' && wpm < 0.7 && wpm > 0) {
      bothActiveOnce = true
    }
  }
  if (f && f.phase === 'stalled') stalledFp = f
}

if (!bothActiveOnce) fail('expected workPerfMul < 0.7 with cold + food_poisoning bands stacking')
if (!stalledFp) {
  // Hard fail before downstream cascades — the diagnose / commit / band
  // hidden=false checks below all read the instance id from this object.
  fail('food_poisoning did not stall (requiredTier 1 untreated) — aborting downstream checks')
} else {

// 3. Diagnose + commit pharmacy treatment on the food poisoning instance.
const diagOk = await page.evaluate((id) =>
  globalThis.__uclife__.physiologyDiagnose(id), stalledFp.instanceId,
)
if (!diagOk) fail('diagnose returned false')

const commitOk = await page.evaluate(([id]) =>
  globalThis.__uclife__.physiologyCommitTreatment(id, 1, 5),
[stalledFp.instanceId])
if (!commitOk) fail('commitTreatment returned false')

// 4. After one more tick, food poisoning should NOT be stalled.
const afterCommit = await page.evaluate(() => globalThis.__uclife__.physiologyTickDay(1))
const fpAfter = afterCommit?.find?.((x) => x.templateId === 'food_poisoning')
if (fpAfter && fpAfter.phase === 'stalled') {
  fail(`food_poisoning still stalled after pharmacy commit: ${JSON.stringify(fpAfter)}`)
}

// 5. After diagnosis the per-band Effects should have hidden=false.
const eff = await page.evaluate(() => globalThis.__uclife__.getEffectsList())
const fpEffects = (eff ?? []).filter((e) =>
  e.family === 'condition' && (e.id ?? '').includes(stalledFp.instanceId),
)
if (fpEffects.length === 0) fail('expected food_poisoning band Effects to be present after diagnosis')
if (fpEffects.some((e) => e.hidden === true)) fail('expected hidden=false on every band after diagnosis')

}  // end of `else` guarding null stalledFp

if (errors.length) {
  console.log('\nERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}
if (failures.length) {
  console.log('\nFAILURES:')
  failures.forEach((f) => console.log('  ' + f))
}

const ok = failures.length === 0 && errors.length === 0
console.log(ok ? '\nOK: multi-condition + clinic flow passed.' : '\nFAIL: multi-condition checks failed.')
if (!ok) process.exitCode = 1

await browser.close()
