// Multi-condition smoke. Verifies cold + food_poisoning round-trip through
// the phase machine and the StatSheet without modifier collision.

import { test, expect } from './_fixtures'

const PHASE_WALK_MAX_DAYS = 8
const STACKED_WORK_PERF_MUL_CEILING = 0.7
const FP_TREATMENT_TIER = 1
const FP_REGEN_RATE = 5

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.physiologyForceOnset',
  '__uclife__.physiologyDiagnose',
  '__uclife__.physiologyCommitTreatment',
  '__uclife__.physiologyTickDay',
  '__uclife__.getPlayerStatValue',
  '__uclife__.getEffectsList',
]

test('multi-condition: cold + food_poisoning stack, FP stalls then resumes', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  const cold = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.physiologyForceOnset('cold_common', 'A'),
  )
  const fp = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.physiologyForceOnset('food_poisoning', 'B'),
  )
  expect(cold, 'cold_common onset failed').toBeTruthy()
  expect(fp, 'food_poisoning onset failed').toBeTruthy()

  let bothActiveOnce = false
  let stalledFp: { instanceId: string } | null = null
  for (let day = 1; day <= PHASE_WALK_MAX_DAYS; day++) {
    const list = await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__uclife__.physiologyTickDay(1),
    )
    expect(Array.isArray(list), `physiologyTickDay should return an array on day ${day}`).toBeTruthy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = list.find((x: any) => x.templateId === 'cold_common')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = list.find((x: any) => x.templateId === 'food_poisoning')
    if (c && f && c.phase !== 'incubating' && f.phase !== 'incubating') {
      const wpm = await sim.page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__uclife__.getPlayerStatValue('workPerfMul'),
      )
      if (typeof wpm === 'number' && wpm < STACKED_WORK_PERF_MUL_CEILING && wpm > 0) {
        bothActiveOnce = true
      }
    }
    if (f && f.phase === 'stalled') stalledFp = f
  }

  expect(
    bothActiveOnce,
    `expected workPerfMul < ${STACKED_WORK_PERF_MUL_CEILING} with bands stacking`,
  ).toBeTruthy()
  expect(stalledFp, 'food_poisoning did not stall').toBeTruthy()

  const diagOk = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (id) => (window as any).__uclife__.physiologyDiagnose(id),
    stalledFp!.instanceId,
  )
  expect(diagOk, 'diagnose returned false').toBeTruthy()

  const commitOk = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([id, tier, rate]) => (window as any).__uclife__.physiologyCommitTreatment(id, tier, rate),
    [stalledFp!.instanceId, FP_TREATMENT_TIER, FP_REGEN_RATE],
  )
  expect(commitOk, 'commitTreatment returned false').toBeTruthy()

  const afterCommit = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.physiologyTickDay(1),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fpAfter = afterCommit?.find?.((x: any) => x.templateId === 'food_poisoning')
  if (fpAfter) {
    expect(fpAfter.phase, `food_poisoning still stalled after pharmacy commit`).not.toBe('stalled')
  }

  const eff = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getEffectsList(),
  )
  const fpEffects = (eff ?? []).filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => e.family === 'condition' && (e.id ?? '').includes(stalledFp!.instanceId),
  )
  expect(fpEffects.length, 'expected food_poisoning band Effects to be present').toBeGreaterThan(0)
  expect(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !fpEffects.some((e: any) => e.hidden === true),
    `expected hidden=false on every band after diagnosis`,
  ).toBeTruthy()
})
