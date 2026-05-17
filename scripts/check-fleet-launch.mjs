// Phase 6.2.E2 — active-fleet auto-launch + cross-POI transit + formation
// flying smoke.
//
// Coverage:
//   1. Set up a fleet of 3 ships: flagship at VB, Ship A at VB, Ship B
//      at Granada. Promote A and B into the active fleet.
//   2. Force-undock the flagship: A auto-launches (FleetEscort body in
//      spaceCampaign with shipKey=A, formationSlot resolved); B queues
//      a cross-POI transit.
//   3. Non-active-fleet ships are unaffected by undock.
//   4. Formation: escort body's Position = flagship pos + formation offset
//      after one space tick.
//   5. Cross-POI transit lander: advance the day; on arrival day the
//      escort lands at the destination POI with transit fields cleared.
//   6. Tactical combat start: startCombat spawns CombatShipState for
//      every player-side active-fleet escort.
//   7. Save round-trip: transit fields preserved; FleetEscort bodies
//      re-materialize after load.
//
// Migrated to Phase 6 deterministic boot: ?test=1 freezes the clock,
// sim-state waits go through step({ until }).

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
const knownErrors = []
const PIXI_CANVAS_KNOWN = /Cannot read properties of (null \(reading 'clear'\)|undefined \(reading 'push'\))/
page.on('pageerror', (e) => {
  const msg = `${e.name}: ${e.message}`
  if (PIXI_CANVAS_KNOWN.test(e.message)) { knownErrors.push(msg); return }
  errors.push(msg)
})
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const text = m.text()
  if (text.includes('The above error occurred in the <PixiCanvas>')) { knownErrors.push(`console.error: ${text}`); return }
  errors.push(`console.error: ${text}`)
})

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.fillJobVacancies === 'function'
    && typeof window.__uclife__?.listShipsInFleet === 'function'
    && typeof window.__uclife__?.listHangarsAllScenes === 'function'
    && typeof window.__uclife__?.enqueueShipDelivery === 'function'
    && typeof window.__uclife__?.runShipDeliveryTick === 'function'
    && typeof window.__uclife__?.receiveShipDelivery === 'function'
    && typeof window.__uclife__?.warRoomDescribe === 'function'
    && typeof window.__uclife__?.setIsInActiveFleet === 'function'
    && typeof window.__uclife__?.forceUndockFlagship === 'function'
    && typeof window.__uclife__?.forceDockFlagship === 'function'
    && typeof window.__uclife__?.runFleetTransitTick === 'function'
    && typeof window.__uclife__?.fleetTransitDescribe === 'function'
    && typeof window.__uclife__?.fleetEscortBodies === 'function'
    && typeof window.__uclife__?.combatPlayerSideSnapshot === 'function'
    && typeof window.__uclife__?.fleetActiveEscortPartition === 'function'
    && typeof window.__uclife__?.tickSpace === 'function'
    && typeof window.__uclife__?.cheatMoney === 'function'
    && typeof window.__uclife__?.saveGame === 'function'
    && typeof window.__uclife__?.loadGame === 'function',
  null,
  { timeout: 30_000 },
)

const STEP_BUDGET_MIN = 60

await page.evaluate(() => window.__uclife__.cheatMoney(2_000_000))
await page.evaluate(() => window.__uclife__.fillJobVacancies(['hangar_manager']))
await page.evaluate(() => window.__uclife__.fillJobVacancies(['hangar_manager']))

// 0. Initial fleet: just the flagship.
const initialFleet = await page.evaluate(() => window.__uclife__.listShipsInFleet())
assert.equal(
  initialFleet.length, 1,
  `expected one starting ship; got ${initialFleet.length}`,
)
assert.equal(
  initialFleet[0].dockedAtPoiId, 'vonBraun',
  `flagship should start docked at vonBraun; got "${initialFleet[0].dockedAtPoiId}"`,
)

// 1. Spawn Ship A at VB hangar + Ship B at Granada drydock.
const hangars = await page.evaluate(() => window.__uclife__.listHangarsAllScenes())
const vbHangar = hangars.find((h) => h.typeId === 'hangarSurface')
const drydock = hangars.find((h) => h.typeId === 'hangarDrydock')
assert.ok(vbHangar, 'VB surface hangar missing')
assert.ok(drydock, 'Granada drydock missing')

await page.evaluate((k) => window.__uclife__.enqueueShipDelivery(k, 'lunarMilitia', 1, 2), vbHangar.buildingKey)
await page.evaluate(() => window.__uclife__.runShipDeliveryTick(3))
const rxA = await page.evaluate((k) => window.__uclife__.receiveShipDelivery(k, 0), vbHangar.buildingKey)
assert.ok(rxA.ok, `Ship A receive failed: ${JSON.stringify(rxA)}`)
const shipAKey = rxA.entityKey

await page.evaluate((k) => window.__uclife__.enqueueShipDelivery(k, 'pegasusClass', 1, 5), drydock.buildingKey)
await page.evaluate(() => window.__uclife__.runShipDeliveryTick(6))
const rxB = await page.evaluate((k) => window.__uclife__.receiveShipDelivery(k, 0), drydock.buildingKey)
assert.ok(rxB.ok, `Ship B receive failed: ${JSON.stringify(rxB)}`)
const shipBKey = rxB.entityKey

const postBuyFleet = await page.evaluate(() => window.__uclife__.listShipsInFleet())
const shipA = postBuyFleet.find((s) => s.entityKey === shipAKey)
const shipB = postBuyFleet.find((s) => s.entityKey === shipBKey)
assert.equal(
  shipA?.dockedAtPoiId, 'vonBraun',
  `Ship A should dock at vonBraun; got "${shipA?.dockedAtPoiId}"`,
)
assert.equal(
  shipB?.dockedAtPoiId, 'granada',
  `Ship B should dock at granada; got "${shipB?.dockedAtPoiId}"`,
)

// 2. Promote A and B into the active fleet.
await page.evaluate((k) => window.__uclife__.setIsInActiveFleet(k, true), shipAKey)
await page.evaluate((k) => window.__uclife__.setIsInActiveFleet(k, true), shipBKey)

const wr = await page.evaluate(() => window.__uclife__.warRoomDescribe())
const rowA = wr.ships.find((r) => r.entityKey === shipAKey)
const rowB = wr.ships.find((r) => r.entityKey === shipBKey)
assert.ok(rowA?.isInActiveFleet, `Ship A not in active fleet after promote: ${JSON.stringify(rowA)}`)
assert.ok(rowB?.isInActiveFleet, `Ship B not in active fleet after promote: ${JSON.stringify(rowB)}`)

// 3. Partition assertion.
const partition = await page.evaluate(() => window.__uclife__.fleetActiveEscortPartition('vonBraun'))
assert.ok(
  partition.sameAsFlagshipPoi.includes(shipAKey),
  `Ship A should be in sameAsFlagshipPoi partition: ${JSON.stringify(partition)}`,
)
assert.ok(
  partition.differentPoi.includes(shipBKey),
  `Ship B should be in differentPoi partition: ${JSON.stringify(partition)}`,
)

// 4. Force flagship undock at gameDay=5: A auto-launches; B queues transit.
const undock = await page.evaluate(() => window.__uclife__.forceUndockFlagship('vonBraun', 5))
assert.equal(
  undock.launchedSameSite, 1,
  `expected 1 same-site launch; got ${undock.launchedSameSite}`,
)
assert.equal(
  undock.queuedTransit, 1,
  `expected 1 transit queued; got ${undock.queuedTransit}`,
)
assert.equal(
  undock.transitFailures, 0,
  `unexpected transit failures: ${undock.transitFailures}`,
)

// 5. Ship A in flight, Ship B in transit.
const afterUndock = await page.evaluate(() => window.__uclife__.listShipsInFleet())
const aAfter = afterUndock.find((s) => s.entityKey === shipAKey)
assert.equal(
  aAfter?.dockedAtPoiId, '',
  `Ship A should be undocked (in flight); got "${aAfter?.dockedAtPoiId}"`,
)

const transits = await page.evaluate(() => window.__uclife__.fleetTransitDescribe())
const tB = transits.find((t) => t.shipKey === shipBKey)
assert.ok(tB, `Ship B not in transit list: ${JSON.stringify(transits)}`)
assert.equal(
  tB.originPoiId, 'granada',
  `Ship B transit originPoiId should be "granada"; got "${tB.originPoiId}"`,
)
assert.equal(
  tB.destinationPoiId, 'vonBraun',
  `Ship B transit destinationPoiId should be "vonBraun"; got "${tB.destinationPoiId}"`,
)
assert.ok(
  tB.arrivalDay > 5,
  `Ship B arrivalDay (${tB.arrivalDay}) should be in future of gameDay=5`,
)

// 6. FleetEscort body for A exists in spaceCampaign; B has none (in transit).
const bodies = await page.evaluate(() => window.__uclife__.fleetEscortBodies())
const bodyA = bodies.find((b) => b.shipKey === shipAKey)
assert.ok(bodyA, `escort body for A missing: ${JSON.stringify(bodies)}`)
const bodyB = bodies.find((b) => b.shipKey === shipBKey)
assert.ok(!bodyB, 'Ship B should not have an escort body while in transit')

// 7. Run one space tick — A's Position lands at flagship.pos + formation offset.
await page.evaluate(() => window.__uclife__.tickSpace(0.016))
const bodiesAfterTick = await page.evaluate(() => window.__uclife__.fleetEscortBodies())
const bodyAAfter = bodiesAfterTick.find((b) => b.shipKey === shipAKey)
assert.ok(
  bodyAAfter?.formationOffset,
  `escort A missing formation offset after tick: ${JSON.stringify(bodyAAfter)}`,
)
const flagshipPos = await page.evaluate(() => window.__uclife__.shipPos())
const expectedX = flagshipPos.x + bodyAAfter.formationOffset.dx
const expectedY = flagshipPos.y + bodyAAfter.formationOffset.dy
assert.ok(
  Math.abs(bodyAAfter.pos.x - expectedX) < 0.01 && Math.abs(bodyAAfter.pos.y - expectedY) < 0.01,
  `escort A pos=(${bodyAAfter.pos.x},${bodyAAfter.pos.y}) ≠ flagship+offset=(${expectedX},${expectedY})`,
)

// 8. Demote A, undock flagship again — A should NOT auto-launch.
await page.evaluate(() => window.__uclife__.forceDockFlagship('vonBraun'))
const afterRedock = await page.evaluate(() => window.__uclife__.listShipsInFleet())
const aRedocked = afterRedock.find((s) => s.entityKey === shipAKey)
assert.equal(
  aRedocked?.dockedAtPoiId, 'vonBraun',
  `Ship A should re-dock at vonBraun after flagship dock; got "${aRedocked?.dockedAtPoiId}"`,
)

await page.evaluate((k) => window.__uclife__.setIsInActiveFleet(k, false), shipAKey)
const undock2 = await page.evaluate(() => window.__uclife__.forceUndockFlagship('vonBraun', 6))
assert.equal(
  undock2.launchedSameSite, 0,
  `expected 0 same-site launches after demoting A; got ${undock2.launchedSameSite}`,
)

await page.evaluate(() => window.__uclife__.forceDockFlagship('vonBraun'))
await page.evaluate((k) => window.__uclife__.setIsInActiveFleet(k, true, 0), shipAKey)

// 9. Cross-POI transit lander.
const transitsBeforeLand = await page.evaluate(() => window.__uclife__.fleetTransitDescribe())
const tBBefore = transitsBeforeLand.find((t) => t.shipKey === shipBKey)
const arrivalDay = tBBefore?.arrivalDay
assert.ok(arrivalDay, 'Ship B not in transit before land tick')

const landResult = await page.evaluate(
  (day) => window.__uclife__.runFleetTransitTick(day),
  arrivalDay,
)
assert.ok(
  landResult.landed >= 1,
  `expected at least 1 ship landed; got ${landResult.landed}`,
)

const postLand = await page.evaluate(() => window.__uclife__.listShipsInFleet())
const bPostLand = postLand.find((s) => s.entityKey === shipBKey)
assert.equal(
  bPostLand?.dockedAtPoiId, 'vonBraun',
  `Ship B should dock at vonBraun after land; got "${bPostLand?.dockedAtPoiId}"`,
)
const transitsAfterLand = await page.evaluate(() => window.__uclife__.fleetTransitDescribe())
assert.ok(
  !transitsAfterLand.find((t) => t.shipKey === shipBKey),
  'Ship B should be cleared from transit list after land',
)

// 10. Tactical combat start: spawn CombatShipState for player-side escorts.
await page.evaluate(() => window.__uclife__.forceDockFlagship('vonBraun'))
await page.evaluate(() => window.__uclife__.startCombatCheat('pirateLight', [], null, {}))
const csSnap = await page.evaluate(() => window.__uclife__.combatPlayerSideSnapshot())
const flagshipRow = csSnap.find((r) => r.isFlagship)
const escortRows = csSnap.filter((r) => !r.isFlagship && !r.isMs)
assert.ok(flagshipRow, 'no flagship row in combatPlayerSideSnapshot')
assert.ok(
  escortRows.length >= 2,
  `expected ≥2 escort CombatShipState rows; got ${escortRows.length}`,
)
for (const er of escortRows) {
  assert.ok(
    er.hullCurrent > 0 && er.hullMax > 0,
    `escort ${er.entityKey} hull invalid: ${er.hullCurrent}/${er.hullMax}`,
  )
  assert.ok(
    er.weaponsCount > 0,
    `escort ${er.entityKey} has no weapons (${er.weaponsCount})`,
  )
}

await page.evaluate(() => window.__uclife__.fastWinCombat())
await page.evaluate(() => {
  const cs = window.__uclife__.useCombatStore.getState()
  if (cs.paused) cs.togglePause()
})
await page.evaluate(async (mins) => {
  await window.__uclife_test__.step({
    until: () => window.__uclife__.useClock.getState().mode !== 'combat',
    maxGameMinutes: mins,
  })
}, STEP_BUDGET_MIN)

// 11. Save round-trip.
await page.evaluate(() => window.__uclife__.forceUndockFlagship('vonBraun', 10))
const bodiesPreSave = await page.evaluate(() => window.__uclife__.fleetEscortBodies())
const bodyAPreSave = bodiesPreSave.find((b) => b.shipKey === shipAKey)
assert.ok(bodyAPreSave, 'escort body for A missing pre-save')

await page.evaluate(async () => { await window.__uclife__.saveGame('auto') })
await page.evaluate(async () => { await window.__uclife__.loadGame('auto') })

await page.waitForFunction(
  () => typeof window.__uclife__?.fleetEscortBodies === 'function',
  null,
  { timeout: 15_000 },
)

const postLoadFleet = await page.evaluate(() => window.__uclife__.listShipsInFleet())
const aPostLoad = postLoadFleet.find((s) => s.entityKey === shipAKey)
assert.ok(aPostLoad, 'Ship A missing post-load')
assert.equal(
  aPostLoad.dockedAtPoiId, '',
  `Ship A should still be in flight after save round-trip; got "${aPostLoad.dockedAtPoiId}"`,
)

const bodiesPostLoad = await page.evaluate(() => window.__uclife__.fleetEscortBodies())
const bodyAPostLoad = bodiesPostLoad.find((b) => b.shipKey === shipAKey)
assert.ok(
  bodyAPostLoad,
  `escort body for Ship A missing post-load: ${JSON.stringify(bodiesPostLoad)}`,
)

assert.equal(
  errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`,
)

await browser.close()

if (knownErrors.length > 0) {
  console.log(`(filtered ${knownErrors.length} known Pixi v8 startup errors)`)
}

console.log('OK — check-fleet-launch:')
console.log(`  fleet size post-grant: 3 (flagship + ${shipAKey} + ${shipBKey})`)
console.log(`  Ship A auto-launched in spaceCampaign on flagship undock`)
console.log(`  Ship B cross-POI transit landed on arrivalDay=${arrivalDay}`)
console.log(`  escort body re-materialized after save round-trip`)
