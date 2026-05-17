import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { BOOT_READY_TIMEOUT_MS, VIEWPORT } from './_test-constants.mjs'

// Phase 4.2 AE clinic faction-perk smoke test — migrated to the
// deterministic API (Phase 6, Category A). Drives the AE clinic visit
// end-to-end through __uclife__ debug handles. The sim clock is frozen
// by ?test=1.
//
// Coverage:
//   - rep gate: above threshold the AE commit succeeds with perks stamped
//   - perks: a tier-2 AE commit writes peakReductionBonus +
//     scarThresholdOverride onto the live condition instance
//   - rep ledger: each AE clinic visit deducts the configured rep cost
//   - diagnosis flips: the instance becomes diagnosed after the call
//   - rising arc honors the perk: peakTracking stays under the untreated
//     ceiling

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const AE_CLINIC_GATE_OPEN_REP = 25
const AE_TIER_2 = 2
const AE_TREATMENT_REGEN_RATE = 5
const AE_REP_DEDUCT_PER_VISIT = 1
const FLU_AE_PEAK_REDUCTION_BONUS = 10
const FLU_AE_SCAR_THRESHOLD_OVERRIDE = 100
const AE_ARC_WALK_DAYS = 6
const PEAK_TRACKING_CEILING_TREATED = 50

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
    && typeof window.__uclife__?.physiologyCommitTreatmentAE === 'function'
    && typeof window.__uclife__?.physiologyForceOnset === 'function'
    && typeof window.__uclife__?.physiologyDiagnose === 'function'
    && typeof window.__uclife__?.physiologyTickDay === 'function'
    && typeof window.__uclife__?.getConditions === 'function'
    && typeof window.__uclife__?.getPlayerReputation === 'function'
    && typeof window.__uclife__?.setPlayerStat === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

await page.evaluate((rep) =>
  window.__uclife__.setPlayerStat('reputation.anaheim', rep), AE_CLINIC_GATE_OPEN_REP)
const startRep = await page.evaluate(() => window.__uclife__.getPlayerReputation('anaheim'))
assert.equal(startRep, AE_CLINIC_GATE_OPEN_REP,
  `failed to seed Anaheim rep to ${AE_CLINIC_GATE_OPEN_REP}; got ${startRep}`)

const onset = await page.evaluate(() => window.__uclife__.physiologyForceOnset('flu', '调试'))
assert.ok(onset?.instanceId, 'failed to onset flu for AE clinic visit')
const fluId = onset.instanceId

const diagOk = await page.evaluate((id) => window.__uclife__.physiologyDiagnose(id), fluId)
assert.ok(diagOk, 'diagnose returned false')

const commitOk = await page.evaluate(([id, tier, rate]) =>
  window.__uclife__.physiologyCommitTreatmentAE(id, tier, rate),
  [fluId, AE_TIER_2, AE_TREATMENT_REGEN_RATE],
)
assert.ok(commitOk, 'physiologyCommitTreatmentAE returned false')

const condList = await page.evaluate(() => window.__uclife__.getConditions())
const flu = (condList ?? []).find((c) => c.instanceId === fluId)
assert.ok(flu, 'flu instance vanished after AE commit')
assert.ok(flu.diagnosed, 'flu should be diagnosed after AE clinic visit')
assert.equal(flu.peakReductionBonus, FLU_AE_PEAK_REDUCTION_BONUS,
  `expected peakReductionBonus ${FLU_AE_PEAK_REDUCTION_BONUS} (AE perk), got ${flu.peakReductionBonus}`)
assert.equal(flu.scarThresholdOverride, FLU_AE_SCAR_THRESHOLD_OVERRIDE,
  `expected scarThresholdOverride ${FLU_AE_SCAR_THRESHOLD_OVERRIDE}, got ${flu.scarThresholdOverride}`)
assert.equal(flu.currentTreatmentTier, AE_TIER_2,
  `expected currentTreatmentTier ${AE_TIER_2}, got ${flu.currentTreatmentTier}`)

const afterRep = await page.evaluate(() => window.__uclife__.getPlayerReputation('anaheim'))
assert.equal(afterRep, AE_CLINIC_GATE_OPEN_REP - AE_REP_DEDUCT_PER_VISIT,
  `expected Anaheim rep ${AE_CLINIC_GATE_OPEN_REP - AE_REP_DEDUCT_PER_VISIT} after one AE clinic visit, got ${afterRep}`)

const arc = await page.evaluate((n) =>
  window.__uclife__.physiologyTickDay(n), AE_ARC_WALK_DAYS)
const fluAfter = (arc ?? []).find?.((c) => c.instanceId === fluId)
if (fluAfter) {
  assert.ok(fluAfter.peakTracking <= PEAK_TRACKING_CEILING_TREATED,
    `AE tier-${AE_TIER_2} + bonus should hold peakTracking ≤ ${PEAK_TRACKING_CEILING_TREATED}, got ${fluAfter.peakTracking}`)
}

assert.equal(errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`)

console.log('OK — check-physiology-ae-clinic:')
console.log(`  AE rep deducted: ${AE_CLINIC_GATE_OPEN_REP} → ${afterRep}`)
console.log(`  flu perks: peakReductionBonus=${flu.peakReductionBonus} scarThresholdOverride=${flu.scarThresholdOverride}`)
console.log(`  peakTracking after ${AE_ARC_WALK_DAYS} days: ${fluAfter?.peakTracking ?? '(resolved)'}`)

await browser.close()
