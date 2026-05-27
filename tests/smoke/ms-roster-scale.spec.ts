// Phase 6.2.5.B smoke — multi-MS roster end-to-end.
//
// Scenario, mirroring the issue's acceptance criteria:
//
//   1. Boot fixture with starter MS (from A) + ¥1M cash + a hireable NPC
//      at VB + a Pegasus parked at vonBraunDrydock.
//   2. Hire the NPC via the pilot debug handle (the real `hireAsPilot`
//      branch is also wired; the smoke uses the debug shortcut for
//      determinism, the same pattern the 6.2.5.A retrofit smoke uses).
//   3. Assert pilot trait + idle in the pilot roster.
//   4. Buy a fighter at the AE broker → delivery row appears.
//   5. Tick msDeliverySystem past arrival → row flips to 'arrived'.
//   6. Receive-MS-delivery → Ms entity at dockedAtPoiId='vonBraun',
//      pilot auto-assigned, depot sprite + terminal spawned.
//   7. Transfer the MS to vonBraunDrydock.
//   8. Tick msTransitSystem past arrival → MS lands aboard the Pegasus
//      (storedOnShipKey === 'ship-pegasus-1').
//
// Determinism rules: every wait is a direct `run*Tick(day)` call; no
// sim-time stepping over multiple days (which is slow under headless).
// Same shape as the existing fleet-launch / light-hull-buy / pegasus-buy
// smokes from Phase 6.2.C+.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getMsRoster',
  '__uclife__.getMs',
  '__uclife__.getPendingMsDeliveries',
  '__uclife__.buyMsAtAeViaDebug',
  '__uclife__.receiveMsDeliveryViaDebug',
  '__uclife__.hirePilotViaDebug',
  '__uclife__.getPilotRoster',
  '__uclife__.transferMsViaDebug',
  '__uclife__.listHangarsForMs',
  '__uclife__.getGameDay',
  '__uclife__.runMsDeliveryTick',
  '__uclife__.runMsTransitTick',
]

const PILOT_NPC_KEY = 'npc-pilot-candidate'
const PEGASUS_KEY = 'ship-pegasus-1'
const VEHICLE_CLASS = 'civFighter'

test('ms-roster: hire pilot → buy MS → receive → auto-assign → transfer onto Pegasus', async ({ sim }) => {
  await sim.boot({ fixture: 'ms-roster', requireHandles: REQUIRED_HANDLES })

  // ── Step 1 + 2: hire the pilot ──────────────────────────────────────
  const hired = await sim.page.evaluate(
    (npcKey: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.hirePilotViaDebug(npcKey) as boolean,
    PILOT_NPC_KEY,
  )
  expect(hired, 'hirePilotViaDebug should succeed').toBe(true)

  const rosterAfterHire = await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.getPilotRoster() as Array<{ npcKey: string; msKey: string }>,
  )
  expect(rosterAfterHire.length, 'pilot roster should have exactly one entry').toBe(1)
  expect(rosterAfterHire[0].npcKey).toBe(PILOT_NPC_KEY)
  expect(rosterAfterHire[0].msKey, 'pilot is idle (no MS yet)').toBe('')

  // ── Step 3: pick the VB hangar to deliver into ──────────────────────
  const hangars = await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.listHangarsForMs() as Array<{
      buildingKey: string; sceneId: string; poiId: string | null
      slotCapacity: Record<string, number>
    }>,
  )
  const vbHangar = hangars.find((h) => h.poiId === 'vonBraun')
  expect(vbHangar, 'VB hangar should exist in the bootstrap world').toBeTruthy()
  const drydockHangar = hangars.find((h) => h.poiId === 'vonBraunDrydock')
  expect(drydockHangar, 'drydock hangar should exist').toBeTruthy()

  const gameDayBefore = await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.getGameDay() as number,
  )

  // ── Step 4: enqueue a fighter delivery to the VB hangar ─────────────
  const buyOk = await sim.page.evaluate(
    ({ msClassId, hangarKey, orderDay }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.buyMsAtAeViaDebug(msClassId, hangarKey, orderDay) as boolean,
    {
      msClassId: VEHICLE_CLASS,
      hangarKey: vbHangar!.buildingKey,
      orderDay: gameDayBefore,
    },
  )
  expect(buyOk, 'buyMsAtAeViaDebug should succeed').toBe(true)

  const pendingBefore = await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.getPendingMsDeliveries() as Array<{
      buildingKey: string
      rows: Array<{ msClassId: string; status: string; arrivalDay: number }>
    }>,
  )
  const vbPending = pendingBefore.find((p) => p.buildingKey === vbHangar!.buildingKey)
  expect(vbPending, 'VB hangar should have a pending row').toBeTruthy()
  expect(vbPending!.rows.length).toBe(1)
  expect(vbPending!.rows[0].msClassId).toBe(VEHICLE_CLASS)
  expect(vbPending!.rows[0].status).toBe('in_transit')

  const arrivalDay = vbPending!.rows[0].arrivalDay

  // ── Step 5: tick the delivery system past the arrival day ───────────
  const tickResult = await sim.page.evaluate(
    (day: number) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.runMsDeliveryTick(day) as { rowsArrived: number },
    arrivalDay,
  )
  expect(tickResult && tickResult.rowsArrived === 1, 'msDelivery tick should flip exactly one row').toBeTruthy()

  const pendingAfter = await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.getPendingMsDeliveries() as Array<{
      buildingKey: string
      rows: Array<{ msClassId: string; status: string }>
    }>,
  )
  const vbAfter = pendingAfter.find((p) => p.buildingKey === vbHangar!.buildingKey)
  expect(vbAfter, 'VB hangar still has the row pending receive').toBeTruthy()
  expect(vbAfter!.rows[0].status, 'row should have flipped to arrived').toBe('arrived')

  // ── Step 6: receive the delivery + auto-assign pilot ────────────────
  const receiveRes = await sim.page.evaluate(
    ({ hangarKey, rowIndex }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.receiveMsDeliveryViaDebug(hangarKey, rowIndex) as {
        ok: boolean; entityKey?: string; reason?: string
      },
    { hangarKey: vbHangar!.buildingKey, rowIndex: 0 },
  )
  expect(receiveRes.ok, `receive should succeed (reason: ${receiveRes.reason ?? ''})`).toBe(true)
  const newMsKey = receiveRes.entityKey!

  const rosterAfterReceive = await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.getMsRoster() as Array<{
      key: string; templateId: string; dockedAtPoiId: string; storedOnShipKey: string; pilotId: string
    }>,
  )
  const newMs = rosterAfterReceive.find((m) => m.key === newMsKey)
  expect(newMs, 'newly-received MS should appear in the roster').toBeTruthy()
  expect(newMs!.templateId, 'MS should be civFighter').toBe(VEHICLE_CLASS)
  expect(newMs!.dockedAtPoiId, 'MS should be docked at vonBraun (depot storage)').toBe('vonBraun')
  expect(newMs!.storedOnShipKey, 'MS should NOT be aboard a ship at depot').toBe('')
  expect(newMs!.pilotId, 'pilot should auto-assign onto the new MS').toBe(PILOT_NPC_KEY)

  const pilotsAfterReceive = await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.getPilotRoster() as Array<{ npcKey: string; msKey: string }>,
  )
  const assignedPilot = pilotsAfterReceive.find((p) => p.npcKey === PILOT_NPC_KEY)
  expect(assignedPilot, 'pilot record still exists').toBeTruthy()
  expect(assignedPilot!.msKey, 'pilot.msKey should reference the new MS').toBe(newMsKey)

  // ── Step 7: transfer the MS to the drydock ──────────────────────────
  const gameDayBeforeTransfer = await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.getGameDay() as number,
  )
  const transferRes = await sim.page.evaluate(
    ({ msKey, dest, day }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.transferMsViaDebug(msKey, dest, day) as {
        ok: boolean; arrivalDay?: number; reason?: string
      },
    { msKey: newMsKey, dest: 'vonBraunDrydock', day: gameDayBeforeTransfer },
  )
  expect(transferRes.ok, `transfer should succeed (reason: ${transferRes.reason ?? ''})`).toBe(true)
  const transferArrivalDay = transferRes.arrivalDay!

  // Immediately after enqueue, the MS is in-transit (no dockedAtPoiId,
  // no storedOnShipKey, transitDestinationId set).
  const inFlight = await sim.page.evaluate(
    (msKey: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getMs(msKey) as { dockedAtPoiId: string; storedOnShipKey: string },
    newMsKey,
  )
  expect(inFlight.dockedAtPoiId, 'in-transit MS has no dockedAtPoiId').toBe('')
  expect(inFlight.storedOnShipKey, 'in-transit MS not yet aboard the Pegasus').toBe('')

  // ── Step 8: tick the transit system past the arrival day ────────────
  await sim.page.evaluate(
    (day: number) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.runMsTransitTick(day),
    transferArrivalDay,
  )

  const rosterFinal = await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.getMsRoster() as Array<{
      key: string; dockedAtPoiId: string; storedOnShipKey: string
    }>,
  )
  const landed = rosterFinal.find((m) => m.key === newMsKey)
  expect(landed, 'MS still in the roster after transit').toBeTruthy()
  // The lander prefers a docked carrier with spare hangarCapacity over
  // the destination depot. The Pegasus is at vonBraunDrydock with
  // hangarCapacity > 0, so the MS should land aboard.
  expect(
    landed!.storedOnShipKey,
    `MS should be stored aboard the Pegasus (got dockedAtPoiId="${landed!.dockedAtPoiId}", storedOnShipKey="${landed!.storedOnShipKey}")`,
  ).toBe(PEGASUS_KEY)
})
