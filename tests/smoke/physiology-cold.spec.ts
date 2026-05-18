// Cold lifecycle smoke. Coverage:
//   - force-onset cold_common
//   - day-by-day phase advance: incubating → rising → peak → recovering →
//     resolved-clean
//   - StatSheet modifier presence during rising/peak (workPerfMul < 1)
//   - StatSheet modifier removal on resolve (workPerfMul == 1)
//   - condition Effect list empty after resolve

import { test, expect } from './_fixtures'

const COLD_LIFECYCLE_MAX_DAYS = 18
const COLD_SYMPTOM_SEVERITY_THRESHOLD = 20
const BASELINE_WORK_PERF_MUL = 1

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.physiologyForceOnset',
  '__uclife__.physiologyTickDay',
  '__uclife__.getPlayerStatValue',
  '__uclife__.getConditions',
  '__uclife__.getEffectsList',
]

test('cold lifecycle: phase advance, modifier presence, clean resolve', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  const onset = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.physiologyForceOnset('cold_common', '测试'),
  )
  expect(onset, 'forceOnset returned null — cold_common template missing or trait absent').toBeTruthy()
  expect(onset.phase, `expected initial phase incubating, got ${onset.phase}`).toBe('incubating')

  const phasesSeen = new Set<string>()
  let workPerfDuringSymptoms: number | null = null
  let resolved = false
  for (let day = 1; day <= COLD_LIFECYCLE_MAX_DAYS; day++) {
    const list = await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__uclife__.physiologyTickDay(1),
    )
    expect(Array.isArray(list), `physiologyTickDay should return an array on day ${day}`).toBeTruthy()
    if (list.length === 0) {
      phasesSeen.add('resolved')
      resolved = true
      break
    }
    const inst = list[0]
    phasesSeen.add(inst.phase)
    if (inst.phase === 'rising' || inst.phase === 'peak') {
      const wpm = await sim.page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__uclife__.getPlayerStatValue('workPerfMul'),
      )
      if (typeof wpm === 'number') {
        if (inst.severity >= COLD_SYMPTOM_SEVERITY_THRESHOLD && wpm >= BASELINE_WORK_PERF_MUL) {
          throw new Error(
            `workPerfMul should be reduced when cold band is active; got ${wpm} `
            + `at severity ${inst.severity} day ${day}`,
          )
        }
        workPerfDuringSymptoms = wpm
      }
    }
  }

  expect(phasesSeen.has('rising'), 'phase machine never reached rising').toBeTruthy()
  expect(phasesSeen.has('peak'), 'phase machine never reached peak').toBeTruthy()
  expect(phasesSeen.has('recovering'), 'phase machine never reached recovering').toBeTruthy()
  expect(resolved, `cold did not resolve within ${COLD_LIFECYCLE_MAX_DAYS} game-days`).toBeTruthy()
  expect(workPerfDuringSymptoms !== null, 'did not sample workPerfMul during symptomatic phases').toBeTruthy()

  const wpmAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getPlayerStatValue('workPerfMul'),
  )
  expect(wpmAfter).toBe(BASELINE_WORK_PERF_MUL)

  const finalList = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getConditions(),
  )
  expect(
    Array.isArray(finalList) && finalList.length === 0,
    `expected empty conditions list after resolve, got ${JSON.stringify(finalList)}`,
  ).toBeTruthy()

  const effList = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getEffectsList(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const condEffects = (effList ?? []).filter((e: any) => e.family === 'condition')
  expect(condEffects.length, `expected zero condition Effects after resolve`).toBe(0)
})
