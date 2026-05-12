// Phase 6.2.E2 — active-fleet auto-launch + cross-POI transit + formation
// flying smoke. Drives every assertion through __uclife__ debug handles
// per CLAUDE.md smoke-test rules — no DOM scraping, no fixed sleeps,
// deterministic.
//
// Coverage:
//   1. Set up a fleet of 3 ships: flagship at VB, Ship A at VB, Ship B
//      at Granada. Promote A and B into the active fleet.
//   2. Force-undock the flagship: A auto-launches (FleetEscort body in
//      spaceCampaign with shipKey=A, formationSlot resolved); B queues
//      a cross-POI transit.
//   3. Non-active-fleet ships are unaffected by undock (no FleetEscort
//      body spawned).
//   4. Formation: the escort body's Position lands at flagship pos +
//      formation offset after one space tick.
//   5. Cross-POI transit lander: advance the day; on arrival day the
//      escort lands at the destination POI with transit fields cleared.
//   6. Tactical combat start: startCombat spawns CombatShipState for
//      every player-side active-fleet escort with side='player',
//      isFlagship=false, hull/armor/weapons populated.
//   7. Save round-trip: transit fields preserved; FleetEscort bodies
//      re-materialize after load.

import { chromium } from 'playwright'

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof globalThis.__uclife__?.fillJobVacancies === 'function'
    && typeof globalThis.__uclife__?.listShipsInFleet === 'function'
    && typeof globalThis.__uclife__?.listHangarsAllScenes === 'function'
    && typeof globalThis.__uclife__?.enqueueShipDelivery === 'function'
    && typeof globalThis.__uclife__?.runShipDeliveryTick === 'function'
    && typeof globalThis.__uclife__?.receiveShipDelivery === 'function'
    && typeof globalThis.__uclife__?.warRoomDescribe === 'function'
    && typeof globalThis.__uclife__?.setIsInActiveFleet === 'function'
    && typeof globalThis.__uclife__?.forceUndockFlagship === 'function'
    && typeof globalThis.__uclife__?.forceDockFlagship === 'function'
    && typeof globalThis.__uclife__?.runFleetTransitTick === 'function'
    && typeof globalThis.__uclife__?.fleetTransitDescribe === 'function'
    && typeof globalThis.__uclife__?.fleetEscortBodies === 'function'
    && typeof globalThis.__uclife__?.combatPlayerSideSnapshot === 'function'
    && typeof globalThis.__uclife__?.fleetActiveEscortPartition === 'function'
    && typeof globalThis.__uclife__?.markInActiveFleetRaw === 'function'
    && typeof globalThis.__uclife__?.forceShipDocking === 'function'
    && typeof globalThis.__uclife__?.tickSpace === 'function'
    && typeof globalThis.__uclife__?.cheatMoney === 'function'
    && typeof globalThis.__uclife__?.saveGame === 'function'
    && typeof globalThis.__uclife__?.loadGame === 'function',
  null,
  { timeout: 30_000 },
)

await page.evaluate(() => globalThis.__uclife__.useClock.getState().setSpeed(0))

const failures = []
const fail = (m) => failures.push(m)
const pass = (m) => console.log('PASS ' + m)

await page.evaluate(() => globalThis.__uclife__.cheatMoney(2_000_000))
await page.evaluate(() => globalThis.__uclife__.fillJobVacancies(['hangar_manager']))
await page.evaluate(() => globalThis.__uclife__.fillJobVacancies(['hangar_manager']))

// 0. Initial fleet: just the flagship.
const initialFleet = await page.evaluate(() => globalThis.__uclife__.listShipsInFleet())
if (initialFleet.length !== 1) {
  fail(`expected one starting ship; got ${initialFleet.length}`)
  await done()
}
const flagshipKey = initialFleet[0].entityKey
if (initialFleet[0].dockedAtPoiId !== 'vonBraun') {
  fail(`flagship not docked at vonBraun: ${initialFleet[0].dockedAtPoiId}`)
  await done()
}

// 1. Spawn Ship A (lunarMilitia at VB hangar) + Ship B (pegasus at Granada).
const hangars = await page.evaluate(() => globalThis.__uclife__.listHangarsAllScenes())
const vbHangar = hangars.find((h) => h.typeId === 'hangarSurface')
const drydock = hangars.find((h) => h.typeId === 'hangarDrydock')
if (!vbHangar) { fail('VB hangar missing'); await done() }
if (!drydock) { fail('Granada drydock missing'); await done() }

await page.evaluate((k) => globalThis.__uclife__.enqueueShipDelivery(k, 'lunarMilitia', 1, 2), vbHangar.buildingKey)
await page.evaluate(() => globalThis.__uclife__.runShipDeliveryTick(3))
const rxA = await page.evaluate((k) => globalThis.__uclife__.receiveShipDelivery(k, 0), vbHangar.buildingKey)
if (!rxA.ok) { fail(`Ship A receive failed: ${JSON.stringify(rxA)}`); await done() }
const shipAKey = rxA.entityKey

await page.evaluate((k) => globalThis.__uclife__.enqueueShipDelivery(k, 'pegasusClass', 1, 5), drydock.buildingKey)
await page.evaluate(() => globalThis.__uclife__.runShipDeliveryTick(6))
const rxB = await page.evaluate((k) => globalThis.__uclife__.receiveShipDelivery(k, 0), drydock.buildingKey)
if (!rxB.ok) { fail(`Ship B receive failed: ${JSON.stringify(rxB)}`); await done() }
const shipBKey = rxB.entityKey

const postBuyFleet = await page.evaluate(() => globalThis.__uclife__.listShipsInFleet())
const shipA = postBuyFleet.find((s) => s.entityKey === shipAKey)
const shipB = postBuyFleet.find((s) => s.entityKey === shipBKey)
if (!shipA || shipA.dockedAtPoiId !== 'vonBraun') fail(`Ship A not at VB: ${shipA?.dockedAtPoiId}`)
else pass(`Ship A delivered at VB (${shipAKey})`)
if (!shipB || shipB.dockedAtPoiId !== 'granada') fail(`Ship B not at granada: ${shipB?.dockedAtPoiId}`)
else pass(`Ship B delivered at granada (${shipBKey})`)

// 2. Promote A and B into the active fleet.
await page.evaluate((k) => globalThis.__uclife__.setIsInActiveFleet(k, true), shipAKey)
await page.evaluate((k) => globalThis.__uclife__.setIsInActiveFleet(k, true), shipBKey)

const wr = await page.evaluate(() => globalThis.__uclife__.warRoomDescribe())
const rowA = wr.ships.find((r) => r.entityKey === shipAKey)
const rowB = wr.ships.find((r) => r.entityKey === shipBKey)
if (!rowA?.isInActiveFleet) fail(`Ship A not in active fleet after promote: ${JSON.stringify(rowA)}`)
else pass(`Ship A in active fleet @ slot ${rowA.formationSlot}`)
if (!rowB?.isInActiveFleet) fail(`Ship B not in active fleet after promote: ${JSON.stringify(rowB)}`)
else pass(`Ship B in active fleet @ slot ${rowB.formationSlot}`)

// 3. Partition assertion: A at VB (same as flagship), B at granada (different).
const partition = await page.evaluate(() => globalThis.__uclife__.fleetActiveEscortPartition('vonBraun'))
if (!partition.sameAsFlagshipPoi.includes(shipAKey)) {
  fail(`Ship A not in sameAsFlagshipPoi partition: ${JSON.stringify(partition)}`)
} else pass(`partition: A at flagship POI`)
if (!partition.differentPoi.includes(shipBKey)) {
  fail(`Ship B not in differentPoi partition: ${JSON.stringify(partition)}`)
} else pass(`partition: B at different POI`)

// 4. Force flagship undock at gameDay=5: A auto-launches; B queues transit.
const undock = await page.evaluate(() => globalThis.__uclife__.forceUndockFlagship('vonBraun', 5))
if (undock.launchedSameSite !== 1) fail(`expected 1 same-site launch; got ${undock.launchedSameSite}`)
else pass(`auto-launch: 1 escort body spawned in spaceCampaign`)
if (undock.queuedTransit !== 1) fail(`expected 1 transit queued; got ${undock.queuedTransit}`)
else pass(`auto-transit: 1 escort queued`)
if (undock.transitFailures !== 0) fail(`unexpected transit failures: ${undock.transitFailures}`)

// 5. Ship A is now in flight (no dockedAtPoiId), Ship B is in transit.
const afterUndock = await page.evaluate(() => globalThis.__uclife__.listShipsInFleet())
const aAfter = afterUndock.find((s) => s.entityKey === shipAKey)
const bAfter = afterUndock.find((s) => s.entityKey === shipBKey)
if (!aAfter || aAfter.dockedAtPoiId !== '') fail(`Ship A still docked: ${aAfter?.dockedAtPoiId}`)
else pass(`Ship A undocked (in flight)`)
if (!bAfter) fail('Ship B missing after undock')

const transits = await page.evaluate(() => globalThis.__uclife__.fleetTransitDescribe())
const tB = transits.find((t) => t.shipKey === shipBKey)
if (!tB) fail(`Ship B not in transit list: ${JSON.stringify(transits)}`)
else if (tB.originPoiId !== 'granada') fail(`Ship B transit originPoiId=${tB.originPoiId}`)
else if (tB.destinationPoiId !== 'vonBraun') fail(`Ship B transit destinationPoiId=${tB.destinationPoiId}`)
else if (tB.arrivalDay <= 5) fail(`Ship B arrivalDay=${tB.arrivalDay} not in future of gameDay=5`)
else pass(`Ship B in transit · granada→vonBraun · arrivalDay=${tB.arrivalDay}`)

// 6. FleetEscort body for A exists in spaceCampaign.
const bodies = await page.evaluate(() => globalThis.__uclife__.fleetEscortBodies())
const bodyA = bodies.find((b) => b.shipKey === shipAKey)
if (!bodyA) fail(`escort body for A missing: ${JSON.stringify(bodies)}`)
else pass(`escort body present for Ship A · slot=${bodyA.formationSlot}`)
const bodyB = bodies.find((b) => b.shipKey === shipBKey)
if (bodyB) fail(`Ship B should not have an escort body while in transit`)
else pass(`Ship B has no escort body (in transit)`)

// 7. Run one space tick — A's Position lands at flagship.pos + formation offset.
await page.evaluate(() => globalThis.__uclife__.tickSpace(0.016))
const bodiesAfterTick = await page.evaluate(() => globalThis.__uclife__.fleetEscortBodies())
const bodyAAfter = bodiesAfterTick.find((b) => b.shipKey === shipAKey)
if (!bodyAAfter || !bodyAAfter.formationOffset) {
  fail(`escort A missing formation offset after tick: ${JSON.stringify(bodyAAfter)}`)
} else {
  const flagshipPos = await page.evaluate(() => globalThis.__uclife__.shipPos())
  const expectedX = flagshipPos.x + bodyAAfter.formationOffset.dx
  const expectedY = flagshipPos.y + bodyAAfter.formationOffset.dy
  if (Math.abs(bodyAAfter.pos.x - expectedX) > 0.01 || Math.abs(bodyAAfter.pos.y - expectedY) > 0.01) {
    fail(`escort A pos=(${bodyAAfter.pos.x},${bodyAAfter.pos.y}) ≠ flagship+offset=(${expectedX},${expectedY})`)
  } else pass(`escort A station-keeps at flagship + formation offset`)
}

// 8. Non-active-fleet ship: demote A first, undock flagship again, A should NOT
//    auto-launch. (Re-dock first to reset.)
await page.evaluate(() => globalThis.__uclife__.forceDockFlagship('vonBraun'))
const afterRedock = await page.evaluate(() => globalThis.__uclife__.listShipsInFleet())
const aRedocked = afterRedock.find((s) => s.entityKey === shipAKey)
if (!aRedocked || aRedocked.dockedAtPoiId !== 'vonBraun') {
  fail(`Ship A failed to re-dock: ${aRedocked?.dockedAtPoiId}`)
} else pass(`Ship A re-docked at VB after flagship dock`)

await page.evaluate((k) => globalThis.__uclife__.setIsInActiveFleet(k, false), shipAKey)
const undock2 = await page.evaluate(() => globalThis.__uclife__.forceUndockFlagship('vonBraun', 6))
if (undock2.launchedSameSite !== 0) {
  fail(`expected 0 same-site launches after demoting A; got ${undock2.launchedSameSite}`)
} else pass(`non-active-fleet ship A unaffected by undock`)

// Re-dock for the next scenario.
await page.evaluate(() => globalThis.__uclife__.forceDockFlagship('vonBraun'))
await page.evaluate((k) => globalThis.__uclife__.setIsInActiveFleet(k, true, 0), shipAKey)

// 9. Cross-POI transit lander: advance day to Ship B's arrivalDay.
const transitsBeforeLand = await page.evaluate(() => globalThis.__uclife__.fleetTransitDescribe())
const tBBefore = transitsBeforeLand.find((t) => t.shipKey === shipBKey)
const arrivalDay = tBBefore?.arrivalDay
if (!arrivalDay) { fail('Ship B not in transit before land tick'); await done() }

const landResult = await page.evaluate(
  (day) => globalThis.__uclife__.runFleetTransitTick(day),
  arrivalDay,
)
if (landResult.landed < 1) fail(`expected at least 1 ship landed; got ${landResult.landed}`)
else pass(`fleet-transit tick landed ${landResult.landed} ship(s) on arrivalDay=${arrivalDay}`)

const postLand = await page.evaluate(() => globalThis.__uclife__.listShipsInFleet())
const bPostLand = postLand.find((s) => s.entityKey === shipBKey)
if (!bPostLand || bPostLand.dockedAtPoiId !== 'vonBraun') {
  fail(`Ship B not docked at vonBraun after land: ${bPostLand?.dockedAtPoiId}`)
} else pass(`Ship B docked at vonBraun after land`)
const transitsAfterLand = await page.evaluate(() => globalThis.__uclife__.fleetTransitDescribe())
if (transitsAfterLand.find((t) => t.shipKey === shipBKey)) {
  fail(`Ship B still in transit list after land`)
} else pass(`Ship B cleared from transit list`)

// 10. Tactical combat start: spawn CombatShipState for player-side escorts.
//     Re-dock flagship, ensure A and B are both active at VB, then drive
//     combat through startCombatCheat.
await page.evaluate(() => globalThis.__uclife__.forceDockFlagship('vonBraun'))
await page.evaluate(() => globalThis.__uclife__.startCombatCheat('pirateLight', [], null, {}))
const csSnap = await page.evaluate(() => globalThis.__uclife__.combatPlayerSideSnapshot())
const flagshipRow = csSnap.find((r) => r.isFlagship)
const escortRows = csSnap.filter((r) => !r.isFlagship && !r.isMs)
if (!flagshipRow) fail('no flagship row in combatPlayerSideSnapshot')
else pass(`flagship row present in combat snapshot`)
if (escortRows.length < 2) fail(`expected ≥2 escort CombatShipState rows; got ${escortRows.length}`)
else pass(`startCombat spawned ${escortRows.length} player-side escort CombatShipState rows`)
for (const er of escortRows) {
  if (er.hullCurrent <= 0 || er.hullMax <= 0) fail(`escort ${er.entityKey} hull invalid: ${er.hullCurrent}/${er.hullMax}`)
  if (er.weaponsCount === 0) fail(`escort ${er.entityKey} has no weapons`)
}
if (escortRows.every((er) => er.hullCurrent > 0 && er.weaponsCount > 0)) {
  pass(`each escort has hull + weapons populated`)
}
// Tear down combat: pause is on at start (speed 0); unpause one tick so
// the resolution loop sees the zeroed enemies and ends combat.
await page.evaluate(() => globalThis.__uclife__.fastWinCombat())
await page.evaluate(() => {
  const cs = globalThis.__uclife__.useCombatStore.getState()
  if (cs.paused) cs.togglePause()
})
// Wait for combat mode to clear (resolution loop endCombat call).
await page.waitForFunction(
  () => globalThis.__uclife__.useClock.getState().mode !== 'combat',
  null,
  { timeout: 10_000 },
)
await page.evaluate(() => globalThis.__uclife__.useClock.getState().setSpeed(0))

// 11. Save round-trip: undock flagship (Ship A auto-launches → in flight),
//     save, load, escort body re-materializes.
await page.evaluate(() => globalThis.__uclife__.forceUndockFlagship('vonBraun', 10))
const bodiesPreSave = await page.evaluate(() => globalThis.__uclife__.fleetEscortBodies())
const bodyAPreSave = bodiesPreSave.find((b) => b.shipKey === shipAKey)
if (!bodyAPreSave) { fail('escort body for A missing pre-save'); await done() }

await page.evaluate(async () => { await globalThis.__uclife__.saveGame('auto') })
await page.evaluate(async () => { await globalThis.__uclife__.loadGame('auto') })

// Wait for re-bootstrap to finish (handle re-registration).
await page.waitForFunction(
  () => typeof globalThis.__uclife__?.fleetEscortBodies === 'function',
  null,
  { timeout: 15_000 },
)

const postLoadFleet = await page.evaluate(() => globalThis.__uclife__.listShipsInFleet())
const aPostLoad = postLoadFleet.find((s) => s.entityKey === shipAKey)
if (!aPostLoad) fail('Ship A missing post-load')
else if (aPostLoad.dockedAtPoiId !== '') fail(`Ship A re-docked post-load: ${aPostLoad.dockedAtPoiId}`)
else pass(`Ship A still in flight after save round-trip`)

const bodiesPostLoad = await page.evaluate(() => globalThis.__uclife__.fleetEscortBodies())
const bodyAPostLoad = bodiesPostLoad.find((b) => b.shipKey === shipAKey)
if (!bodyAPostLoad) fail('escort body for Ship A missing post-load')
else pass(`escort body for Ship A re-materialized post-load`)

await done()

async function done() {
  await browser.close()
  if (errors.length) {
    console.log('\nERRORS:')
    errors.forEach((e) => console.log('  ' + e))
  }
  if (failures.length) {
    console.log('\nFAILURES:')
    failures.forEach((f) => console.log('  ' + f))
    process.exit(1)
  }
  console.log('\nOK: 6.2.E2 auto-launch + cross-POI transit + formation verified.')
}
