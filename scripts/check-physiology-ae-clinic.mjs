import { chromium } from 'playwright'

// Phase 4.2 AE clinic faction-perk smoke test.
//
// Drives the AE clinic visit end-to-end through __uclife__ debug
// handles. No DOM clicks, no real-time waits — every step is a
// deterministic call into the sim layer.
//
// Coverage:
//   - rep gate: below threshold the AE commit refuses; above it
//     succeeds with perks stamped on the instance
//   - perks: a tier-2 AE commit writes peakReductionBonus +
//     scarThresholdOverride onto the live condition instance
//   - rep ledger: each AE clinic visit deducts the configured rep cost
//     from the player's Anaheim ledger
//   - diagnosis flips: the instance becomes diagnosed after the
//     diagnose call, so the AE panel could show its canonical name

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
await page.waitForFunction(() => globalThis.__uclife__?.physiologyCommitTreatmentAE !== undefined)
await page.waitForFunction(() => globalThis.__uclife__?.getPlayerReputation !== undefined)

// Pause the game so the active-zone RAF tick doesn't interleave.
await page.evaluate(() => { globalThis.__uclife__.useClock?.getState?.()?.setSpeed?.(0) })

// 1. Set Anaheim rep above the clinic gate. setPlayerStat takes an
// absolute value so this also resets any pre-existing rep.
const gateOpenRep = 25  // physiology.json5 aeClinicMinRep = 20
await page.evaluate((rep) => globalThis.__uclife__.setPlayerStat('reputation.anaheim', rep), gateOpenRep)
const startRep = await page.evaluate(() => globalThis.__uclife__.getPlayerReputation('anaheim'))
if (startRep !== gateOpenRep) fail(`failed to seed Anaheim rep to ${gateOpenRep}; got ${startRep}`)

// 2. Force-onset flu so we have a live instance to treat.
const onset = await page.evaluate(() => globalThis.__uclife__.physiologyForceOnset('flu', '调试'))
if (!onset?.instanceId) fail('failed to onset flu for AE clinic visit')
const fluId = onset?.instanceId

// 3. Diagnose first (mirrors the AE panel's two-step flow).
if (fluId) {
  const diagOk = await page.evaluate((id) => globalThis.__uclife__.physiologyDiagnose(id), fluId)
  if (!diagOk) fail('diagnose returned false')
}

// 4. Commit AE tier-2 treatment. Should stamp perks + deduct rep.
if (fluId) {
  const commitOk = await page.evaluate(
    ([id]) => globalThis.__uclife__.physiologyCommitTreatmentAE(id, 2, 5),
    [fluId],
  )
  if (!commitOk) fail('physiologyCommitTreatmentAE returned false')
}

// 5. Verify the instance carries the perks and the diagnosis flag.
const condList = await page.evaluate(() => globalThis.__uclife__.getConditions())
const flu = (condList ?? []).find((c) => c.instanceId === fluId)
if (!flu) {
  fail('flu instance vanished after AE commit')
} else {
  if (!flu.diagnosed) fail('flu should be diagnosed after AE clinic visit')
  if (flu.peakReductionBonus !== 10) {
    fail(`expected peakReductionBonus 10 (AE perk), got ${flu.peakReductionBonus}`)
  }
  // Flu's authored scarThreshold is 90; AE override raises by 10 → 100.
  if (flu.scarThresholdOverride !== 100) {
    fail(`expected scarThresholdOverride 100 (90 + 10 raise), got ${flu.scarThresholdOverride}`)
  }
  if (flu.currentTreatmentTier !== 2) {
    fail(`expected currentTreatmentTier 2, got ${flu.currentTreatmentTier}`)
  }
}

// 6. Verify the rep ledger was deducted by exactly the configured cost.
const afterRep = await page.evaluate(() => globalThis.__uclife__.getPlayerReputation('anaheim'))
if (afterRep !== gateOpenRep - 1) {
  fail(`expected Anaheim rep ${gateOpenRep - 1} after one AE clinic visit, got ${afterRep}`)
}

// 7. Verify the rising arc honors the bonus by walking a few days and
// reading peakTracking. The bonus + the tier-2 base together should
// hold peakTracking below the untreated peak ceiling (75) by ≥ 25.
const arc = await page.evaluate(() => globalThis.__uclife__.physiologyTickDay(6))
const fluAfter = (arc ?? []).find?.((c) => c.instanceId === fluId)
if (fluAfter && fluAfter.peakTracking > 50) {
  fail(`AE tier-2 + bonus should hold peakTracking ≤ 50, got ${fluAfter.peakTracking}`)
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
console.log(ok ? '\nOK: AE clinic faction-perk smoke passed.' : '\nFAIL: AE clinic faction-perk smoke failed.')
if (!ok) process.exitCode = 1

await browser.close()
