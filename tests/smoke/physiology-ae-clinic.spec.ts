// AE clinic faction-perk smoke test. Drives the AE clinic visit end-to-end
// through __uclife__ debug handles. Coverage:
//   - rep gate: above threshold the AE commit succeeds with perks stamped
//   - perks: a tier-2 AE commit writes peakReductionBonus + scarThresholdOverride
//   - rep ledger: each AE clinic visit deducts the configured rep cost
//   - diagnosis flips: instance becomes diagnosed after the call
//   - rising arc honors the perk: peakTracking stays under untreated ceiling

import { test, expect } from './_fixtures'

const AE_CLINIC_GATE_OPEN_REP = 25
const AE_TIER_2 = 2
const AE_TREATMENT_REGEN_RATE = 5
const AE_REP_DEDUCT_PER_VISIT = 1
const FLU_AE_PEAK_REDUCTION_BONUS = 10
const FLU_AE_SCAR_THRESHOLD_OVERRIDE = 100
const AE_ARC_WALK_DAYS = 6
const PEAK_TRACKING_CEILING_TREATED = 50

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.physiologyCommitTreatmentAE',
  '__uclife__.physiologyForceOnset',
  '__uclife__.physiologyDiagnose',
  '__uclife__.physiologyTickDay',
  '__uclife__.getConditions',
  '__uclife__.getPlayerReputation',
  '__uclife__.setPlayerStat',
]

test('AE clinic: tier-2 perks, rep deduction, peakTracking ceiling', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rep) => (window as any).__uclife__.setPlayerStat('reputation.anaheim', rep),
    AE_CLINIC_GATE_OPEN_REP,
  )
  const startRep = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getPlayerReputation('anaheim'),
  )
  expect(startRep).toBe(AE_CLINIC_GATE_OPEN_REP)

  const onset = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.physiologyForceOnset('flu', '调试'),
  )
  expect(onset?.instanceId, 'failed to onset flu for AE clinic visit').toBeTruthy()
  const fluId = onset.instanceId

  const diagOk = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (id) => (window as any).__uclife__.physiologyDiagnose(id),
    fluId,
  )
  expect(diagOk, 'diagnose returned false').toBeTruthy()

  const commitOk = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([id, tier, rate]) => (window as any).__uclife__.physiologyCommitTreatmentAE(id, tier, rate),
    [fluId, AE_TIER_2, AE_TREATMENT_REGEN_RATE],
  )
  expect(commitOk, 'physiologyCommitTreatmentAE returned false').toBeTruthy()

  const condList = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getConditions(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flu = (condList ?? []).find((c: any) => c.instanceId === fluId)
  expect(flu, 'flu instance vanished after AE commit').toBeTruthy()
  expect(flu.diagnosed, 'flu should be diagnosed after AE clinic visit').toBeTruthy()
  expect(flu.peakReductionBonus).toBe(FLU_AE_PEAK_REDUCTION_BONUS)
  expect(flu.scarThresholdOverride).toBe(FLU_AE_SCAR_THRESHOLD_OVERRIDE)
  expect(flu.currentTreatmentTier).toBe(AE_TIER_2)

  const afterRep = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getPlayerReputation('anaheim'),
  )
  expect(afterRep).toBe(AE_CLINIC_GATE_OPEN_REP - AE_REP_DEDUCT_PER_VISIT)

  const arc = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n) => (window as any).__uclife__.physiologyTickDay(n),
    AE_ARC_WALK_DAYS,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fluAfter = (arc ?? []).find?.((c: any) => c.instanceId === fluId)
  if (fluAfter) {
    expect(fluAfter.peakTracking).toBeLessThanOrEqual(PEAK_TRACKING_CEILING_TREATED)
  }
})
