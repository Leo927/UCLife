// Issue #65 smoke — pilot roster panel + two-row AE vehicle catalog.
//
// Scenario, mirroring the issue's acceptance criteria:
//
//   1. Boot fixture: 2 hireable pilots + a flagship at vonBraun.
//   2. Assert the AE vehicle broker catalog is two rows (civFighter +
//      mobileWorker).
//   3. Hire pilot A, then buy + receive a civFighter → it auto-assigns to
//      pilot A and routes to the vonBraun hangar slot.
//   4. Buy + receive a mobileWorker while no pilot is idle → it stays
//      unpiloted (and exercises the second catalog row's delivery path).
//   5. Hire pilot B (now idle).
//   6. Open the captain's-office pilot roster; assert it lists both pilots
//      with correct idle / assigned state.
//   7. Reassign the idle pilot B onto the unpiloted MS via the panel (real
//      clicks); assert Ms.pilotId updated and the roster reflects it.
//   8. Confirm the same state is readable from getMs (one source of truth).
//
// Determinism: MS provisioning routes through the broker debug handles +
// direct run*Tick(day) calls (no sim-time stepping over days); the reassign
// is driven by real player clicks on the panel's data-* hooks.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getVehicleCatalogRows',
  '__uclife__.hirePilotViaDebug',
  '__uclife__.buyMsAtAeViaDebug',
  '__uclife__.getPendingMsDeliveries',
  '__uclife__.runMsDeliveryTick',
  '__uclife__.receiveMsDeliveryViaDebug',
  '__uclife__.getMs',
  '__uclife__.getPilotRoster',
  '__uclife__.listHangarsForMs',
  '__uclife__.getGameDay',
  '__uclife__.openPilotRoster',
]

const PILOT_A = 'npc-pilot-a'
const PILOT_B = 'npc-pilot-b'

interface PendingDeliveries {
  buildingKey: string
  rows: Array<{ msClassId: string; status: string; arrivalDay: number }>
}

test('pilot-roster: two-row catalog → buy MW → roster lists pilots → one-click reassign', async ({ sim }) => {
  await sim.boot({ fixture: 'pilot-roster', requireHandles: REQUIRED_HANDLES })

  // ── Step 2: the AE vehicle broker catalog is two rows ────────────────
  const catalog = await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.getVehicleCatalogRows() as string[],
  )
  expect(catalog.length, 'broker catalog should have two rows').toBe(2)
  expect(catalog).toContain('civFighter')
  expect(catalog).toContain('mobileWorker')

  // Locate the VB hangar to deliver into.
  const hangars = await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.listHangarsForMs() as Array<{ buildingKey: string; poiId: string | null }>,
  )
  const vbHangar = hangars.find((h) => h.poiId === 'vonBraun')
  expect(vbHangar, 'VB hangar should exist in the bootstrap world').toBeTruthy()
  const hangarKey = vbHangar!.buildingKey

  // Buy + receive one MS of the given class. Returns the new MS entity key.
  // Each call is processed fully before the next, so the arrived row is the
  // only pending row for the hangar.
  const buyAndReceive = async (msClassId: string): Promise<string> => {
    const orderDay = await sim.page.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getGameDay() as number,
    )
    const buyOk = await sim.page.evaluate(
      ({ id, key, day }) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__uclife__.buyMsAtAeViaDebug(id, key, day) as boolean,
      { id: msClassId, key: hangarKey, day: orderDay },
    )
    expect(buyOk, `buy ${msClassId} should succeed`).toBe(true)

    const pending = await sim.page.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getPendingMsDeliveries() as PendingDeliveries[],
    )
    const hangarPending = pending.find((p) => p.buildingKey === hangarKey)
    expect(hangarPending, `hangar should have a pending ${msClassId} row`).toBeTruthy()
    const rowIndex = hangarPending!.rows.findIndex((r) => r.msClassId === msClassId)
    expect(rowIndex, `pending row for ${msClassId}`).toBeGreaterThanOrEqual(0)
    const arrivalDay = hangarPending!.rows[rowIndex].arrivalDay

    await sim.page.evaluate(
      (day: number) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__uclife__.runMsDeliveryTick(day),
      arrivalDay,
    )

    const arrived = await sim.page.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getPendingMsDeliveries() as PendingDeliveries[],
    )
    const arrivedRowIndex = (arrived.find((p) => p.buildingKey === hangarKey)?.rows ?? [])
      .findIndex((r) => r.status === 'arrived')
    expect(arrivedRowIndex, `arrived row for ${msClassId}`).toBeGreaterThanOrEqual(0)

    const receive = await sim.page.evaluate(
      ({ key, idx }) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__uclife__.receiveMsDeliveryViaDebug(key, idx) as {
          ok: boolean; entityKey?: string; reason?: string
        },
      { key: hangarKey, idx: arrivedRowIndex },
    )
    expect(receive.ok, `receive ${msClassId} should succeed (${receive.reason ?? ''})`).toBe(true)
    return receive.entityKey!
  }

  // ── Step 3: hire pilot A, then deliver MS1 (civFighter) → auto-assign A
  const hiredA = await sim.page.evaluate(
    (k: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.hirePilotViaDebug(k) as boolean,
    PILOT_A,
  )
  expect(hiredA, 'hire pilot A').toBe(true)

  const ms1Key = await buyAndReceive('civFighter')
  const ms1 = await sim.page.evaluate(
    (k: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getMs(k) as { templateId: string; dockedAtPoiId: string; pilotId: string },
    ms1Key,
  )
  expect(ms1.dockedAtPoiId, 'MS1 routes to the vonBraun hangar slot').toBe('vonBraun')
  expect(ms1.pilotId, 'MS1 auto-assigns to the lone idle pilot A').toBe(PILOT_A)

  // ── Step 4: deliver MS2 (mobileWorker) while no pilot is idle ─────────
  const ms2Key = await buyAndReceive('mobileWorker')
  const ms2 = await sim.page.evaluate(
    (k: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getMs(k) as { templateId: string; dockedAtPoiId: string; pilotId: string },
    ms2Key,
  )
  expect(ms2.templateId, 'MS2 is a mobileWorker (second catalog row)').toBe('mobileWorker')
  expect(ms2.dockedAtPoiId, 'MS2 routes to the vonBraun hangar slot').toBe('vonBraun')
  expect(ms2.pilotId, 'MS2 has no pilot (none idle at receive)').toBe('')

  // ── Step 5: hire pilot B (now idle) ──────────────────────────────────
  const hiredB = await sim.page.evaluate(
    (k: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.hirePilotViaDebug(k) as boolean,
    PILOT_B,
  )
  expect(hiredB, 'hire pilot B').toBe(true)

  // ── Step 6: open the pilot roster, assert both pilots + states ───────
  await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.openPilotRoster(),
  )
  await sim.page.waitForSelector('[data-pilot-roster]')
  await sim.page.waitForSelector(`[data-pilot-row="${PILOT_A}"]`)
  await sim.page.waitForSelector(`[data-pilot-row="${PILOT_B}"]`)

  const stateA = await sim.page.getAttribute(`[data-pilot-row="${PILOT_A}"]`, 'data-pilot-state')
  const stateB = await sim.page.getAttribute(`[data-pilot-row="${PILOT_B}"]`, 'data-pilot-state')
  expect(stateA, 'pilot A is assigned').toBe('assigned')
  expect(stateB, 'pilot B is idle').toBe('idle')

  // ── Step 7: reassign pilot B onto the unpiloted MS2 via the panel ────
  await sim.page.click(`[data-pilot-reassign="${PILOT_B}"]`)
  await sim.page.click(`[data-pilot-reassign-pick="${PILOT_B}->${ms2Key}"]`)

  const ms2After = await sim.page.evaluate(
    (k: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getMs(k) as { pilotId: string },
    ms2Key,
  )
  expect(ms2After.pilotId, 'MS2.pilotId updated to pilot B via the panel').toBe(PILOT_B)

  const roster = await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.getPilotRoster() as Array<{ npcKey: string; msKey: string }>,
  )
  const rowB = roster.find((r) => r.npcKey === PILOT_B)
  expect(rowB?.msKey, 'roster reflects pilot B on MS2').toBe(ms2Key)
  const rowA = roster.find((r) => r.npcKey === PILOT_A)
  expect(rowA?.msKey, 'pilot A still on MS1 (untouched)').toBe(ms1Key)

  // ── Step 8: one source of truth — getMs matches the panel write ──────
  const ms1Final = await sim.page.evaluate(
    (k: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getMs(k) as { pilotId: string },
    ms1Key,
  )
  expect(ms1Final.pilotId, 'MS1 still piloted by A — single source of truth').toBe(PILOT_A)
})
