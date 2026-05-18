// Injury demo smoke. "I sprained my ankle and limp until I get it splinted."
// Coverage:
//   - body-part-scoped onset on a specific limb
//   - phase machine reaches peak with walkingSpeed reduced
//   - untreated tier-1 injury stalls at peak (sprain requires pharmacy)
//   - commitTreatment(tier=1) flips stalled → recovering
//   - resolve clears the instance and restores walkingSpeed to 1

import { test, expect } from './_fixtures'

const PEAK_PHASE_MAX_DAYS = 8
const RECOVERY_MAX_DAYS = 30
const BASELINE_WALKING_SPEED = 1
const SPRAIN_TREATMENT_TIER = 1

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.physiologyForceOnset',
  '__uclife__.physiologyCommitTreatment',
  '__uclife__.physiologyTickDay',
  '__uclife__.getPlayerStatValue',
  '__uclife__.getEffectsList',
]

test('sprain: peak with reduced speed, stalls untreated, recovers post-treatment', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  const onset = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.physiologyForceOnset('sprain', '滑倒', 'left-ankle'),
  )
  expect(onset, 'forceOnset returned null').toBeTruthy()
  expect(onset.bodyPart).toBe('left-ankle')
  expect(onset.phase).toBe('incubating')
  const instanceId = onset.instanceId

  const baselineSpeed = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getPlayerStatValue('walkingSpeed'),
  )
  expect(baselineSpeed).toBe(BASELINE_WALKING_SPEED)

  let stalledSeen = false
  let speedReducedAtPeak: number | null = null
  for (let day = 1; day <= PEAK_PHASE_MAX_DAYS; day++) {
    const list = await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__uclife__.physiologyTickDay(1),
    )
    expect(Array.isArray(list), `physiologyTickDay should return an array on day ${day}`).toBeTruthy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inst = list.find((c: any) => c.instanceId === instanceId)
    expect(inst, `sprain instance vanished prematurely on day ${day}`).toBeTruthy()
    if (inst.phase === 'peak') {
      const wspeed = await sim.page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__uclife__.getPlayerStatValue('walkingSpeed'),
      )
      expect(
        typeof wspeed === 'number' && wspeed < BASELINE_WALKING_SPEED,
        `walkingSpeed should be reduced at peak; got ${wspeed}`,
      ).toBeTruthy()
      speedReducedAtPeak = wspeed
    }
    if (inst.phase === 'stalled') { stalledSeen = true; break }
  }
  expect(stalledSeen, `untreated sprain did not stall within ${PEAK_PHASE_MAX_DAYS} game-days`).toBeTruthy()
  expect(speedReducedAtPeak, 'did not observe reduced walkingSpeed during peak').not.toBeNull()

  const treated = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (id) => (window as any).__uclife__.physiologyCommitTreatment(id, 1, null),
    instanceId,
  )
  expect(treated, `commitTreatment(tier=${SPRAIN_TREATMENT_TIER}) did not land`).toBeTruthy()

  let resolved = false
  for (let day = 1; day <= RECOVERY_MAX_DAYS; day++) {
    const list = await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__uclife__.physiologyTickDay(1),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (list.length === 0 || !list.some((c: any) => c.instanceId === instanceId)) {
      resolved = true
      break
    }
  }
  expect(resolved, `sprain did not resolve within ${RECOVERY_MAX_DAYS} game-days post-treatment`).toBeTruthy()

  const speedAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getPlayerStatValue('walkingSpeed'),
  )
  expect(speedAfter).toBe(BASELINE_WALKING_SPEED)

  const effList = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getEffectsList(),
  )
  const condEffects = (effList ?? []).filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => e.family === 'condition' && e.id.includes(instanceId),
  )
  expect(condEffects.length, `expected zero condition Effects for resolved sprain`).toBe(0)
})
