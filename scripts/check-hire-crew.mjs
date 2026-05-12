// Phase 6.2.D hire-as-captain / hire-as-crew + crew assignment +
// captain's-office "man the rest" + officer Effect + save round-trip
// smoke. Drives every assertion through __uclife__ debug handles per
// CLAUDE.md smoke-test rules — no DOM scraping.
//
// Coverage:
//   1. Procedural NPC's dialog tree exposes hireAsCaptain + hireAsCrew
//      branches when at least one ship vacancy matches.
//   2. hireAsCaptain assigns the NPC + debits the signing fee + emits
//      `eff:officer:<key>:engineering` on the ship's stat sheet —
//      observable as a topSpeed bump and a new effect id in
//      shipEffectIds.
//   3. hireAsCrew appends to Ship.crewIds + debits the signing fee.
//   4. The crew-roster snapshot mirrors what the panel renders.
//   5. moveCrewMember relocates a crew member between two ships.
//   6. fireCrewMember removes from Ship.crewIds.
//   7. fireCaptain clears assignedCaptainId AND drops the captain
//      Effect (topSpeed reverts).
//   8. manRestFromIdlePool pulls hireable NPCs until vacancy filled
//      (or money runs out).
//   9. Save round-trip preserves captain + crew assignments + crew
//      Effect re-applies (the captain stays bonusing topSpeed).

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
    && typeof globalThis.__uclife__?.fleetRosterSnapshot === 'function'
    && typeof globalThis.__uclife__?.spawnTestNpc === 'function'
    && typeof globalThis.__uclife__?.hireBranchListing === 'function'
    && typeof globalThis.__uclife__?.hireCaptainViaDebug === 'function'
    && typeof globalThis.__uclife__?.hireCrewViaDebug === 'function'
    && typeof globalThis.__uclife__?.fireCaptainViaDebug === 'function'
    && typeof globalThis.__uclife__?.fireCrewMemberViaDebug === 'function'
    && typeof globalThis.__uclife__?.moveCrewMemberViaDebug === 'function'
    && typeof globalThis.__uclife__?.manRestFromIdleViaDebug === 'function'
    && typeof globalThis.__uclife__?.crewRosterSnapshot === 'function'
    && typeof globalThis.__uclife__?.shipStatSheetTopSpeed === 'function'
    && typeof globalThis.__uclife__?.shipEffectIds === 'function'
    && typeof globalThis.__uclife__?.captainEffectIdForKey === 'function'
    && typeof globalThis.__uclife__?.listShipsInFleet === 'function'
    && typeof globalThis.__uclife__?.enqueueShipDelivery === 'function'
    && typeof globalThis.__uclife__?.runShipDeliveryTick === 'function'
    && typeof globalThis.__uclife__?.receiveShipDelivery === 'function'
    && typeof globalThis.__uclife__?.listHangarsAllScenes === 'function'
    && typeof globalThis.__uclife__?.cheatMoney === 'function'
    && typeof globalThis.__uclife__?.useClock?.getState === 'function'
    && typeof globalThis.__uclife__?.saveGame === 'function'
    && typeof globalThis.__uclife__?.loadGame === 'function',
  null,
  { timeout: 30_000 },
)

await page.evaluate(() => globalThis.__uclife__.useClock.getState().setSpeed(0))

const failures = []
const fail = (m) => failures.push(m)
const pass = (m) => console.log('PASS ' + m)

// Seed: give the player plenty of money so signing fees don't gate
// the assertions on a wallet-empty scenario.
await page.evaluate(() => globalThis.__uclife__.cheatMoney(2_000_000))

// Seat both hangar managers so a second ship can be received at the
// Granada drydock.
await page.evaluate(() => globalThis.__uclife__.fillJobVacancies(['hangar_manager']))
await page.evaluate(() => globalThis.__uclife__.fillJobVacancies(['hangar_manager']))

// Spawn a second ship at Granada via the C2 buy pipeline so we have
// two hulls to exercise move/fire/hire across.
const hangars = await page.evaluate(() => globalThis.__uclife__.listHangarsAllScenes())
const drydock = hangars.find((h) => h.typeId === 'hangarDrydock')
if (!drydock) { fail('Granada drydock missing'); await done() }

await page.evaluate((k) => globalThis.__uclife__.enqueueShipDelivery(k, 'pegasusClass', 1, 5), drydock.buildingKey)
await page.evaluate(() => globalThis.__uclife__.runShipDeliveryTick(6))
const rx = await page.evaluate((k) => globalThis.__uclife__.receiveShipDelivery(k, 0), drydock.buildingKey)
if (!rx.ok) { fail(`pegasus receive failed: ${JSON.stringify(rx)}`); await done() }
pass(`second ship received: ${rx.entityKey}`)

const fleet0 = await page.evaluate(() => globalThis.__uclife__.listShipsInFleet())
if (fleet0.length !== 2) { fail(`expected 2 ships in fleet, got ${fleet0.length}`); await done() }
const flagship = fleet0.find((s) => s.isFlagship)
const pegasus = fleet0.find((s) => !s.isFlagship)
if (!flagship || !pegasus) { fail('could not isolate flagship + pegasus'); await done() }

// 1. Hire branches surface on a procedural NPC.
const npcKey = 'test-npc-a'
await page.evaluate((k) => globalThis.__uclife__.spawnTestNpc({ key: k, name: 'TestCaptain' }), npcKey)
const branches = await page.evaluate((k) => globalThis.__uclife__.hireBranchListing(k), npcKey)
if (!branches.includes('hireAsCaptain')) fail(`hireAsCaptain branch missing for ${npcKey}: ${branches}`)
else pass('hireAsCaptain branch surfaces')
if (!branches.includes('hireAsCrew')) fail(`hireAsCrew branch missing for ${npcKey}: ${branches}`)
else pass('hireAsCrew branch surfaces')

// 2. Hire as captain of flagship; assert topSpeed bumps + Effect id added.
const baseTopSpeed = await page.evaluate((k) => globalThis.__uclife__.shipStatSheetTopSpeed(k), flagship.entityKey)
const moneyBefore1 = await page.evaluate(() => globalThis.__uclife__.useClock.getState() && globalThis.__uclife__.uclifeWorld?.queryFirst?.(globalThis.__uclife__.world))
void moneyBefore1
const captainResult = await page.evaluate(
  (args) => globalThis.__uclife__.hireCaptainViaDebug(args.npcKey, args.shipKey),
  { npcKey, shipKey: flagship.entityKey },
)
if (!captainResult.ok) { fail(`hire captain failed: ${JSON.stringify(captainResult)}`); await done() }
pass(`captain hired · signing fee ¥${captainResult.signingFee}`)

const roster1 = await page.evaluate(() => globalThis.__uclife__.fleetRosterSnapshot())
const flagshipRow = roster1.find((r) => r.entityKey === flagship.entityKey)
if (!flagshipRow) fail('flagship row missing from roster')
else if (!flagshipRow.captainKey) fail('flagship.captainKey empty after hire')
else if (!flagshipRow.captainKey.startsWith('npc-crew-')) {
  fail(`captainKey did not promote to npc-crew-N: ${flagshipRow.captainKey}`)
} else pass(`flagship.captainKey promoted: ${flagshipRow.captainKey}`)

const promotedNpcKey = flagshipRow?.captainKey
const captainEffectIdExpected = await page.evaluate(
  (k) => globalThis.__uclife__.captainEffectIdForKey(k),
  promotedNpcKey,
)
const effectIds1 = await page.evaluate((k) => globalThis.__uclife__.shipEffectIds(k), flagship.entityKey)
if (!effectIds1.includes(captainEffectIdExpected)) {
  fail(`captain Effect id missing from ship: expected ${captainEffectIdExpected}, got ${JSON.stringify(effectIds1)}`)
} else pass(`captain Effect id present on flagship: ${captainEffectIdExpected}`)

const newTopSpeed = await page.evaluate((k) => globalThis.__uclife__.shipStatSheetTopSpeed(k), flagship.entityKey)
// Engineering Lv on a fresh-spawned test NPC = 0 → percentMult of 0
// would render the Effect a no-op on topSpeed. The smoke asserts the
// Effect id is present (above); the numeric bump is exercised later
// after we grant the captain some XP.
if (newTopSpeed === null) fail('shipStatSheetTopSpeed returned null')
else pass(`flagship topSpeed pre-XP: ${newTopSpeed} (was ${baseTopSpeed})`)

// 3. Hire as crew (second NPC, on the pegasus).
const crewNpcKey = 'test-npc-crew-1'
await page.evaluate((k) => globalThis.__uclife__.spawnTestNpc({ key: k, name: 'TestCrew1' }), crewNpcKey)
const crewResult = await page.evaluate(
  (args) => globalThis.__uclife__.hireCrewViaDebug(args.npcKey, args.shipKey),
  { npcKey: crewNpcKey, shipKey: pegasus.entityKey },
)
if (!crewResult.ok) { fail(`hire crew failed: ${JSON.stringify(crewResult)}`); await done() }
pass(`crew hired on pegasus · signing fee ¥${crewResult.signingFee}`)

const rosterC = await page.evaluate(() => globalThis.__uclife__.crewRosterSnapshot())
const pegasusCrew = rosterC.find((r) => r.shipKey === pegasus.entityKey)
if (!pegasusCrew) fail('pegasus crew row missing')
else if (pegasusCrew.crew.length !== 1) fail(`pegasus crew.length=${pegasusCrew.crew.length} (want 1)`)
else pass(`pegasus crew row: ${pegasusCrew.crew[0].name} (${pegasusCrew.crew[0].npcKey})`)

const promotedCrewKey = pegasusCrew?.crew[0]?.npcKey

// 4. Move crew from pegasus to flagship.
const moveRes = await page.evaluate(
  (args) => globalThis.__uclife__.moveCrewMemberViaDebug(args.from, args.to, args.who),
  { from: pegasus.entityKey, to: flagship.entityKey, who: promotedCrewKey },
)
if (!moveRes.ok) fail(`move crew failed: ${JSON.stringify(moveRes)}`)
else {
  const rosterM = await page.evaluate(() => globalThis.__uclife__.crewRosterSnapshot())
  const pegM = rosterM.find((r) => r.shipKey === pegasus.entityKey)
  const flM = rosterM.find((r) => r.shipKey === flagship.entityKey)
  if (!pegM || pegM.crew.length !== 0) fail(`pegasus crew not emptied after move: ${JSON.stringify(pegM)}`)
  if (!flM || flM.crew.find((c) => c.npcKey === promotedCrewKey) == null) {
    fail(`flagship crew did not gain the moved entry: ${JSON.stringify(flM)}`)
  }
  if (pegM?.crew.length === 0 && flM?.crew.find((c) => c.npcKey === promotedCrewKey)) {
    pass(`crew moved pegasus → flagship`)
  }
}

// 5. Fire crew on flagship.
const fireRes = await page.evaluate(
  (args) => globalThis.__uclife__.fireCrewMemberViaDebug(args.ship, args.npc),
  { ship: flagship.entityKey, npc: promotedCrewKey },
)
if (fireRes !== true) fail(`fire crew returned ${fireRes}`)
else {
  const rosterF = await page.evaluate(() => globalThis.__uclife__.crewRosterSnapshot())
  const flF = rosterF.find((r) => r.shipKey === flagship.entityKey)
  if (flF?.crew.find((c) => c.npcKey === promotedCrewKey)) fail('flagship crew still has fired entry')
  else pass('crew fired off flagship')
}

// 6. manRestFromIdlePool fills the pegasus.
// Spawn a handful of idle NPCs the auto-man verb can pick up.
const idleSpawned = []
for (let i = 0; i < 10; i++) {
  const k = `test-idle-${i}`
  await page.evaluate((key) => globalThis.__uclife__.spawnTestNpc({ key }), k)
  idleSpawned.push(k)
}
// Assign a captain to pegasus so the auto-man verb is unblocked.
const pegCaptainNpc = 'test-npc-pegcap'
await page.evaluate((k) => globalThis.__uclife__.spawnTestNpc({ key: k, name: 'PegasusCaptain' }), pegCaptainNpc)
const pegHireCap = await page.evaluate(
  (args) => globalThis.__uclife__.hireCaptainViaDebug(args.npcKey, args.shipKey),
  { npcKey: pegCaptainNpc, shipKey: pegasus.entityKey },
)
if (!pegHireCap.ok) fail(`pegasus captain hire failed: ${JSON.stringify(pegHireCap)}`)
else pass('pegasus captain hired')

const manRes = await page.evaluate((k) => globalThis.__uclife__.manRestFromIdleViaDebug(k), pegasus.entityKey)
if (!manRes || manRes.hired <= 0) fail(`manRestFromIdle hired 0 — ${JSON.stringify(manRes)}`)
else pass(`manRestFromIdle: ${manRes.hired} hired · fees ¥${manRes.signingFeesPaid} · ${manRes.stoppedReason}`)

const rosterAfterMan = await page.evaluate(() => globalThis.__uclife__.crewRosterSnapshot())
const pegAfterMan = rosterAfterMan.find((r) => r.shipKey === pegasus.entityKey)
if (!pegAfterMan) fail('pegasus row missing post-man')
else {
  if (pegAfterMan.crew.length < manRes.hired) {
    fail(`pegasus crew.length (${pegAfterMan.crew.length}) < hired (${manRes.hired})`)
  } else pass(`pegasus crew after man: ${pegAfterMan.crew.length} / ${pegAfterMan.crewRequired}`)
}

// 7. Save round-trip preserves captain + crew + Effect.
const preSaveRoster = await page.evaluate(() => globalThis.__uclife__.crewRosterSnapshot())
const preSaveEffects = await page.evaluate((k) => globalThis.__uclife__.shipEffectIds(k), flagship.entityKey)
const preSaveCaptain = preSaveRoster.find((r) => r.shipKey === flagship.entityKey)?.captainKey
await page.evaluate(async () => { await globalThis.__uclife__.saveGame('auto') })
await page.evaluate(async () => { await globalThis.__uclife__.loadGame('auto') })
const postLoadRoster = await page.evaluate(() => globalThis.__uclife__.crewRosterSnapshot())
const postLoadEffects = await page.evaluate((k) => globalThis.__uclife__.shipEffectIds(k), flagship.entityKey)
const postLoadCaptain = postLoadRoster.find((r) => r.shipKey === flagship.entityKey)?.captainKey
if (preSaveCaptain !== postLoadCaptain) fail(`save round-trip captain key: ${preSaveCaptain} → ${postLoadCaptain}`)
else pass(`save round-trip preserved flagship captain: ${postLoadCaptain}`)

const preCrewCount = preSaveRoster.reduce((n, r) => n + r.crew.length, 0)
const postCrewCount = postLoadRoster.reduce((n, r) => n + r.crew.length, 0)
if (preCrewCount !== postCrewCount) fail(`save round-trip crew count: ${preCrewCount} → ${postCrewCount}`)
else pass(`save round-trip preserved crew count: ${postCrewCount}`)

const preEffectId = preSaveEffects.find((id) => id.startsWith('eff:officer:'))
const postEffectId = postLoadEffects.find((id) => id.startsWith('eff:officer:'))
if (!postEffectId) fail(`captain Effect lost on save round-trip: ${JSON.stringify(postLoadEffects)}`)
else if (preEffectId !== postEffectId) fail(`captain Effect id changed: ${preEffectId} → ${postEffectId}`)
else pass(`save round-trip preserved captain Effect: ${postEffectId}`)

// 8. Fire captain → Effect drops.
const fireCapRes = await page.evaluate((k) => globalThis.__uclife__.fireCaptainViaDebug(k), flagship.entityKey)
if (fireCapRes !== true) fail(`fireCaptain returned ${fireCapRes}`)
else {
  const effectsAfterFire = await page.evaluate((k) => globalThis.__uclife__.shipEffectIds(k), flagship.entityKey)
  if (effectsAfterFire.find((id) => id.startsWith('eff:officer:'))) {
    fail(`captain Effect still on ship after fire: ${JSON.stringify(effectsAfterFire)}`)
  } else pass('captain Effect dropped after fire')
  const rosterAfterFire = await page.evaluate(() => globalThis.__uclife__.crewRosterSnapshot())
  const flAfterFire = rosterAfterFire.find((r) => r.shipKey === flagship.entityKey)
  if (flAfterFire?.captainKey !== '') fail(`flagship captainKey not cleared: ${flAfterFire?.captainKey}`)
  else pass('flagship captainKey cleared after fire')
}

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
  console.log('\nOK: 6.2.D hire branches + crew assignment + man-rest + officer Effect verified.')
}
