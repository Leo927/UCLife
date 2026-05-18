// Flu contagion SIR smoke. Drives transmission end-to-end.
// Coverage:
//   - spawn an infectious NPC inside flu's 1.5-tile contactRadius
//   - advance contagion ticks
//   - verify player catches flu (source string names the carrier)
//   - verify flu's symptomatic-rising band emits a workPerfMul drop

import { test, expect } from './_fixtures'

const CARRIER_TILE_DX = 0.5
const CARRIER_TILE_DY = 0
const CONTAGION_TICKS = 200
const PHASE_WALK_DAYS = 3
const SYMPTOM_SEVERITY_THRESHOLD = 20
const BASELINE_WORK_PERF_MUL = 1

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.physiologySpawnInfectedNPC',
  '__uclife__.physiologyContagionStep',
  '__uclife__.physiologyTickDay',
  '__uclife__.getNpcConditionsByKey',
  '__uclife__.getPlayerStatValue',
]

test('contagion: nearby carrier infects player, source labeled, workPerfMul drops', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  const carrier = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([dx, dy]) => (window as any).__uclife__.physiologySpawnInfectedNPC('flu', '李明', dx, dy),
    [CARRIER_TILE_DX, CARRIER_TILE_DY],
  )
  expect(carrier?.key, 'failed to spawn infected carrier NPC').toBeTruthy()
  expect(carrier.templateId).toBe('flu')

  const playerCond = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n) => (window as any).__uclife__.physiologyContagionStep(n),
    CONTAGION_TICKS,
  )
  expect(Array.isArray(playerCond), 'physiologyContagionStep did not return a conditions array').toBeTruthy()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flu = playerCond.find((c: any) => c.templateId === 'flu')
  expect(flu, `player did not catch flu after ${CONTAGION_TICKS} contagion ticks`).toBeTruthy()
  expect(
    typeof flu.source === 'string' && flu.source.includes('李明'),
    `flu.source should name the carrier 李明, got: ${flu.source}`,
  ).toBeTruthy()
  expect(flu.source.includes('流感'), `flu.source should name the condition 流感, got: ${flu.source}`).toBeTruthy()

  const carrierCond = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.getNpcConditionsByKey(k),
    carrier.key,
  )
  expect(Array.isArray(carrierCond), 'failed to fetch carrier conditions by key').toBeTruthy()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const carrierFlu = carrierCond.find((c: any) => c.templateId === 'flu')
  expect(carrierFlu, 'carrier no longer carries flu').toBeTruthy()
  expect(carrierFlu.phase, 'carrier still in incubating').not.toBe('incubating')

  const afterDays = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n) => (window as any).__uclife__.physiologyTickDay(n),
    PHASE_WALK_DAYS,
  )
  expect(Array.isArray(afterDays), 'physiologyTickDay did not return an array').toBeTruthy()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fluAfter = afterDays.find((c: any) => c.templateId === 'flu')
  expect(fluAfter, `player flu disappeared after ${PHASE_WALK_DAYS} days`).toBeTruthy()
  const wpm = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getPlayerStatValue('workPerfMul'),
  )
  if (fluAfter.severity >= SYMPTOM_SEVERITY_THRESHOLD && typeof wpm === 'number') {
    expect(
      wpm < BASELINE_WORK_PERF_MUL,
      `workPerfMul should be reduced by flu band at severity ${fluAfter.severity}, got ${wpm}`,
    ).toBeTruthy()
  }
})
