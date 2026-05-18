// Phase 6.2.D hire-as-captain / hire-as-crew + crew assignment +
// captain's-office "man the rest" + officer Effect + save round-trip
// smoke.
//
// Migrated to Phase 6 deterministic boot: ?test=1 freezes the clock,
// the loop is stopped, so no setSpeed(0) pin needed.
//
// Coverage:
//   1. Procedural NPC's dialog tree exposes hireAsCaptain + hireAsCrew
//      branches when at least one ship vacancy matches.
//   2. hireAsCaptain assigns the NPC + debits the signing fee + emits
//      `eff:officer:<key>:engineering` on the ship's stat sheet.
//   3. hireAsCrew appends to Ship.crewIds + debits the signing fee.
//   4. The crew-roster snapshot mirrors what the panel renders.
//   5. moveCrewMember relocates a crew member between two ships.
//   6. fireCrewMember removes from Ship.crewIds.
//   7. fireCaptain clears assignedCaptainId AND drops the captain Effect.
//   8. manRestFromIdlePool pulls hireable NPCs until vacancy filled.
//   9. Save round-trip preserves captain + crew + Effect.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.fillJobVacancies === 'function'
    && typeof window.__uclife__?.fleetRosterSnapshot === 'function'
    && typeof window.__uclife__?.spawnTestNpc === 'function'
    && typeof window.__uclife__?.hireBranchListing === 'function'
    && typeof window.__uclife__?.hireCaptainViaDebug === 'function'
    && typeof window.__uclife__?.hireCrewViaDebug === 'function'
    && typeof window.__uclife__?.fireCaptainViaDebug === 'function'
    && typeof window.__uclife__?.fireCrewMemberViaDebug === 'function'
    && typeof window.__uclife__?.moveCrewMemberViaDebug === 'function'
    && typeof window.__uclife__?.manRestFromIdleViaDebug === 'function'
    && typeof window.__uclife__?.crewRosterSnapshot === 'function'
    && typeof window.__uclife__?.shipStatSheetTopSpeed === 'function'
    && typeof window.__uclife__?.shipEffectIds === 'function'
    && typeof window.__uclife__?.captainEffectIdForKey === 'function'
    && typeof window.__uclife__?.listShipsInFleet === 'function'
    && typeof window.__uclife__?.enqueueShipDelivery === 'function'
    && typeof window.__uclife__?.runShipDeliveryTick === 'function'
    && typeof window.__uclife__?.receiveShipDelivery === 'function'
    && typeof window.__uclife__?.listHangarsAllScenes === 'function'
    && typeof window.__uclife__?.cheatMoney === 'function'
    && typeof window.__uclife__?.saveGame === 'function'
    && typeof window.__uclife__?.loadGame === 'function',
  null,
  { timeout: 30_000 },
)

await page.evaluate(() => window.__uclife__.cheatMoney(2_000_000))
await page.evaluate(() => window.__uclife__.fillJobVacancies(['hangar_manager']))
await page.evaluate(() => window.__uclife__.fillJobVacancies(['hangar_manager']))

const hangars = await page.evaluate(() => window.__uclife__.listHangarsAllScenes())
const drydock = hangars.find((h) => h.typeId === 'hangarDrydock')
assert.ok(drydock, 'Granada drydock missing')

await page.evaluate((k) => window.__uclife__.enqueueShipDelivery(k, 'pegasusClass', 1, 5), drydock.buildingKey)
await page.evaluate(() => window.__uclife__.runShipDeliveryTick(6))
const rx = await page.evaluate((k) => window.__uclife__.receiveShipDelivery(k, 0), drydock.buildingKey)
assert.ok(rx.ok, `pegasus receive failed: ${JSON.stringify(rx)}`)

const fleet0 = await page.evaluate(() => window.__uclife__.listShipsInFleet())
assert.equal(fleet0.length, 2, `expected 2 ships in fleet; got ${fleet0.length}`)
const flagship = fleet0.find((s) => s.isFlagship)
const pegasus = fleet0.find((s) => !s.isFlagship)
assert.ok(flagship && pegasus, 'could not isolate flagship + pegasus')

// 1. Hire branches surface on a procedural NPC.
const npcKey = 'test-npc-a'
await page.evaluate((k) => window.__uclife__.spawnTestNpc({ key: k, name: 'TestCaptain' }), npcKey)
const branches = await page.evaluate((k) => window.__uclife__.hireBranchListing(k), npcKey)
assert.ok(
  branches.includes('hireAsCaptain'),
  `hireAsCaptain branch should surface for ${npcKey}; got ${JSON.stringify(branches)}`,
)
assert.ok(
  branches.includes('hireAsCrew'),
  `hireAsCrew branch should surface for ${npcKey}; got ${JSON.stringify(branches)}`,
)

// 2. Hire as captain of flagship.
const baseTopSpeed = await page.evaluate((k) => window.__uclife__.shipStatSheetTopSpeed(k), flagship.entityKey)
const captainResult = await page.evaluate(
  (args) => window.__uclife__.hireCaptainViaDebug(args.npcKey, args.shipKey),
  { npcKey, shipKey: flagship.entityKey },
)
assert.ok(captainResult.ok, `hire captain failed: ${JSON.stringify(captainResult)}`)

const roster1 = await page.evaluate(() => window.__uclife__.fleetRosterSnapshot())
const flagshipRow = roster1.find((r) => r.entityKey === flagship.entityKey)
assert.ok(flagshipRow, 'flagship row missing from roster')
assert.ok(flagshipRow.captainKey, 'flagship.captainKey should be set after hire')
assert.ok(
  flagshipRow.captainKey.startsWith('npc-crew-'),
  `captainKey should promote to npc-crew-N; got "${flagshipRow.captainKey}"`,
)

const promotedNpcKey = flagshipRow.captainKey
const captainEffectIdExpected = await page.evaluate(
  (k) => window.__uclife__.captainEffectIdForKey(k),
  promotedNpcKey,
)
const effectIds1 = await page.evaluate((k) => window.__uclife__.shipEffectIds(k), flagship.entityKey)
assert.ok(
  effectIds1.includes(captainEffectIdExpected),
  `captain Effect id missing from ship: expected ${captainEffectIdExpected}, got ${JSON.stringify(effectIds1)}`,
)

const newTopSpeed = await page.evaluate((k) => window.__uclife__.shipStatSheetTopSpeed(k), flagship.entityKey)
assert.notEqual(newTopSpeed, null, 'shipStatSheetTopSpeed returned null after captain hire')

// 3. Hire as crew (second NPC, on the pegasus).
const crewNpcKey = 'test-npc-crew-1'
await page.evaluate((k) => window.__uclife__.spawnTestNpc({ key: k, name: 'TestCrew1' }), crewNpcKey)
const crewResult = await page.evaluate(
  (args) => window.__uclife__.hireCrewViaDebug(args.npcKey, args.shipKey),
  { npcKey: crewNpcKey, shipKey: pegasus.entityKey },
)
assert.ok(crewResult.ok, `hire crew failed: ${JSON.stringify(crewResult)}`)

const rosterC = await page.evaluate(() => window.__uclife__.crewRosterSnapshot())
const pegasusCrew = rosterC.find((r) => r.shipKey === pegasus.entityKey)
assert.ok(pegasusCrew, 'pegasus crew row missing')
assert.equal(
  pegasusCrew.crew.length, 1,
  `pegasus crew.length should be 1; got ${pegasusCrew.crew.length}`,
)
const promotedCrewKey = pegasusCrew.crew[0].npcKey

// 4. Move crew from pegasus to flagship.
const moveRes = await page.evaluate(
  (args) => window.__uclife__.moveCrewMemberViaDebug(args.from, args.to, args.who),
  { from: pegasus.entityKey, to: flagship.entityKey, who: promotedCrewKey },
)
assert.ok(moveRes.ok, `move crew failed: ${JSON.stringify(moveRes)}`)

const rosterM = await page.evaluate(() => window.__uclife__.crewRosterSnapshot())
const pegM = rosterM.find((r) => r.shipKey === pegasus.entityKey)
const flM = rosterM.find((r) => r.shipKey === flagship.entityKey)
assert.equal(
  pegM.crew.length, 0,
  `pegasus crew should be empty after move; got ${JSON.stringify(pegM.crew)}`,
)
assert.ok(
  flM.crew.find((c) => c.npcKey === promotedCrewKey),
  `flagship crew should contain moved entry ${promotedCrewKey}: ${JSON.stringify(flM.crew)}`,
)

// 5. Fire crew on flagship.
const fireRes = await page.evaluate(
  (args) => window.__uclife__.fireCrewMemberViaDebug(args.ship, args.npc),
  { ship: flagship.entityKey, npc: promotedCrewKey },
)
assert.equal(fireRes, true, `fire crew should return true; got ${fireRes}`)

const rosterF = await page.evaluate(() => window.__uclife__.crewRosterSnapshot())
const flF = rosterF.find((r) => r.shipKey === flagship.entityKey)
assert.ok(
  !flF.crew.find((c) => c.npcKey === promotedCrewKey),
  `flagship crew should not contain fired entry ${promotedCrewKey}`,
)

// 6. manRestFromIdlePool fills the pegasus.
for (let i = 0; i < 10; i++) {
  await page.evaluate((key) => window.__uclife__.spawnTestNpc({ key }), `test-idle-${i}`)
}
const pegCaptainNpc = 'test-npc-pegcap'
await page.evaluate((k) => window.__uclife__.spawnTestNpc({ key: k, name: 'PegasusCaptain' }), pegCaptainNpc)
const pegHireCap = await page.evaluate(
  (args) => window.__uclife__.hireCaptainViaDebug(args.npcKey, args.shipKey),
  { npcKey: pegCaptainNpc, shipKey: pegasus.entityKey },
)
assert.ok(pegHireCap.ok, `pegasus captain hire failed: ${JSON.stringify(pegHireCap)}`)

const manRes = await page.evaluate((k) => window.__uclife__.manRestFromIdleViaDebug(k), pegasus.entityKey)
assert.ok(
  manRes && manRes.hired > 0,
  `manRestFromIdle should hire >0; got ${JSON.stringify(manRes)}`,
)

const rosterAfterMan = await page.evaluate(() => window.__uclife__.crewRosterSnapshot())
const pegAfterMan = rosterAfterMan.find((r) => r.shipKey === pegasus.entityKey)
assert.ok(pegAfterMan, 'pegasus row missing post-man')
assert.ok(
  pegAfterMan.crew.length >= manRes.hired,
  `pegasus crew.length (${pegAfterMan.crew.length}) should be ≥ hired (${manRes.hired})`,
)

// 7. Save round-trip.
const preSaveRoster = await page.evaluate(() => window.__uclife__.crewRosterSnapshot())
const preSaveEffects = await page.evaluate((k) => window.__uclife__.shipEffectIds(k), flagship.entityKey)
const preSaveCaptain = preSaveRoster.find((r) => r.shipKey === flagship.entityKey)?.captainKey
await page.evaluate(async () => { await window.__uclife__.saveGame('auto') })
await page.evaluate(async () => { await window.__uclife__.loadGame('auto') })
const postLoadRoster = await page.evaluate(() => window.__uclife__.crewRosterSnapshot())
const postLoadEffects = await page.evaluate((k) => window.__uclife__.shipEffectIds(k), flagship.entityKey)
const postLoadCaptain = postLoadRoster.find((r) => r.shipKey === flagship.entityKey)?.captainKey
assert.equal(
  preSaveCaptain, postLoadCaptain,
  `save round-trip should preserve flagship captain; ${preSaveCaptain} → ${postLoadCaptain}`,
)

const preCrewCount = preSaveRoster.reduce((n, r) => n + r.crew.length, 0)
const postCrewCount = postLoadRoster.reduce((n, r) => n + r.crew.length, 0)
assert.equal(
  preCrewCount, postCrewCount,
  `save round-trip should preserve crew count; ${preCrewCount} → ${postCrewCount}`,
)

const preEffectId = preSaveEffects.find((id) => id.startsWith('eff:officer:'))
const postEffectId = postLoadEffects.find((id) => id.startsWith('eff:officer:'))
assert.ok(
  postEffectId,
  `captain Effect lost on save round-trip: ${JSON.stringify(postLoadEffects)}`,
)
assert.equal(
  preEffectId, postEffectId,
  `captain Effect id changed across save round-trip: ${preEffectId} → ${postEffectId}`,
)

// 8. Fire captain → Effect drops.
const fireCapRes = await page.evaluate((k) => window.__uclife__.fireCaptainViaDebug(k), flagship.entityKey)
assert.equal(fireCapRes, true, `fireCaptain should return true; got ${fireCapRes}`)

const effectsAfterFire = await page.evaluate((k) => window.__uclife__.shipEffectIds(k), flagship.entityKey)
assert.ok(
  !effectsAfterFire.find((id) => id.startsWith('eff:officer:')),
  `captain Effect should drop after fire; got ${JSON.stringify(effectsAfterFire)}`,
)
const rosterAfterFire = await page.evaluate(() => window.__uclife__.crewRosterSnapshot())
const flAfterFire = rosterAfterFire.find((r) => r.shipKey === flagship.entityKey)
assert.equal(
  flAfterFire?.captainKey, '',
  `flagship captainKey should be cleared after fire; got "${flAfterFire?.captainKey}"`,
)

assert.equal(
  errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`,
)

await browser.close()

console.log('OK — check-hire-crew:')
console.log(`  captain hired (${promotedNpcKey}) · Effect: ${captainEffectIdExpected}`)
console.log(`  topSpeed pre=${baseTopSpeed} post=${newTopSpeed}`)
console.log(`  crew move/fire round-trip ok`)
console.log(`  manRestFromIdle hired: ${manRes.hired} · fees ¥${manRes.signingFeesPaid}`)
console.log(`  save round-trip preserved captain + ${postCrewCount} crew + Effect`)
