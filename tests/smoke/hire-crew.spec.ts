// hire-as-captain / hire-as-crew + crew assignment + captain's-office
// "man the rest" + officer Effect + save round-trip smoke.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.fillJobVacancies',
  '__uclife__.fleetRosterSnapshot',
  '__uclife__.spawnTestNpc',
  '__uclife__.hireBranchListing',
  '__uclife__.hireCaptainViaDebug',
  '__uclife__.hireCrewViaDebug',
  '__uclife__.fireCaptainViaDebug',
  '__uclife__.fireCrewMemberViaDebug',
  '__uclife__.moveCrewMemberViaDebug',
  '__uclife__.manRestFromIdleViaDebug',
  '__uclife__.crewRosterSnapshot',
  '__uclife__.shipStatSheetTopSpeed',
  '__uclife__.shipEffectIds',
  '__uclife__.captainEffectIdForKey',
  '__uclife__.listShipsInFleet',
  '__uclife__.enqueueShipDelivery',
  '__uclife__.runShipDeliveryTick',
  '__uclife__.receiveShipDelivery',
  '__uclife__.listHangarsAllScenes',
  '__uclife__.cheatMoney',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]

test('hire-crew end-to-end: captain Effect, crew move/fire, manRest, save round-trip', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.cheatMoney(2_000_000))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.fillJobVacancies(['hangar_manager']))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.fillJobVacancies(['hangar_manager']))

  const hangars = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listHangarsAllScenes(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drydock = hangars.find((h: any) => h.typeId === 'hangarDrydock')
  expect(drydock, 'Von Braun drydock missing').toBeTruthy()

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.enqueueShipDelivery(k, 'pegasusClass', 1, 5),
    drydock.buildingKey,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.runShipDeliveryTick(6))
  const rx = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.receiveShipDelivery(k, 0),
    drydock.buildingKey,
  )
  expect(rx.ok, `pegasus receive failed: ${JSON.stringify(rx)}`).toBeTruthy()

  const fleet0 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  expect(fleet0.length).toBe(2)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flagship = fleet0.find((s: any) => s.isFlagship)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pegasus = fleet0.find((s: any) => !s.isFlagship)
  expect(flagship && pegasus, 'could not isolate flagship + pegasus').toBeTruthy()

  // 1. Unified hire flow: only the talkHire branch surfaces on a
  //    procedural NPC's dialog tree; the legacy hireAsCaptain /
  //    hireAsCrew branches have been removed in favor of position
  //    assignment via the fleet roster.
  const npcKey = 'test-npc-a'
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.spawnTestNpc({ key: k, name: 'TestCaptain' }),
    npcKey,
  )
  const branches = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hireBranchListing(k),
    npcKey,
  )
  expect(branches.includes('talkHire'), `talkHire branch missing`).toBeTruthy()
  expect(!branches.includes('hireAsCaptain'), `hireAsCaptain branch should be retired`).toBeTruthy()
  expect(!branches.includes('hireAsCrew'), `hireAsCrew branch should be retired`).toBeTruthy()

  // 2. Hire as captain of flagship.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.shipStatSheetTopSpeed(k),
    flagship.entityKey,
  )
  const captainResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (args) => (window as any).__uclife__.hireCaptainViaDebug(args.npcKey, args.shipKey),
    { npcKey, shipKey: flagship.entityKey },
  )
  expect(captainResult.ok, `hire captain failed: ${JSON.stringify(captainResult)}`).toBeTruthy()

  const roster1 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetRosterSnapshot(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flagshipRow = roster1.find((r: any) => r.entityKey === flagship.entityKey)
  expect(flagshipRow, 'flagship row missing from roster').toBeTruthy()
  expect(flagshipRow.captainKey, 'flagship.captainKey should be set').toBeTruthy()
  expect(
    flagshipRow.captainKey.startsWith('npc-crew-'),
    `captainKey should promote to npc-crew-N; got "${flagshipRow.captainKey}"`,
  ).toBeTruthy()

  const promotedNpcKey = flagshipRow.captainKey
  const captainEffectIdExpected = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.captainEffectIdForKey(k),
    promotedNpcKey,
  )
  const effectIds1 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.shipEffectIds(k),
    flagship.entityKey,
  )
  expect(
    effectIds1.includes(captainEffectIdExpected),
    `captain Effect id missing: expected ${captainEffectIdExpected}, got ${JSON.stringify(effectIds1)}`,
  ).toBeTruthy()

  const newTopSpeed = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.shipStatSheetTopSpeed(k),
    flagship.entityKey,
  )
  expect(newTopSpeed, 'shipStatSheetTopSpeed returned null after captain hire').not.toBeNull()

  // 3. Hire as crew (second NPC, on the pegasus).
  const crewNpcKey = 'test-npc-crew-1'
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.spawnTestNpc({ key: k, name: 'TestCrew1' }),
    crewNpcKey,
  )
  const crewResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (args) => (window as any).__uclife__.hireCrewViaDebug(args.npcKey, args.shipKey),
    { npcKey: crewNpcKey, shipKey: pegasus.entityKey },
  )
  expect(crewResult.ok, `hire crew failed: ${JSON.stringify(crewResult)}`).toBeTruthy()

  const rosterC = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.crewRosterSnapshot(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pegasusCrew = rosterC.find((r: any) => r.shipKey === pegasus.entityKey)
  expect(pegasusCrew, 'pegasus crew row missing').toBeTruthy()
  expect(pegasusCrew.crew.length).toBe(1)
  const promotedCrewKey = pegasusCrew.crew[0].npcKey

  // 4. Move crew from pegasus to flagship.
  const moveRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (args) => (window as any).__uclife__.moveCrewMemberViaDebug(args.from, args.to, args.who),
    { from: pegasus.entityKey, to: flagship.entityKey, who: promotedCrewKey },
  )
  expect(moveRes.ok, `move crew failed: ${JSON.stringify(moveRes)}`).toBeTruthy()

  const rosterM = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.crewRosterSnapshot(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pegM = rosterM.find((r: any) => r.shipKey === pegasus.entityKey)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flM = rosterM.find((r: any) => r.shipKey === flagship.entityKey)
  expect(pegM.crew.length, `pegasus crew should be empty after move`).toBe(0)
  expect(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    flM.crew.find((c: any) => c.npcKey === promotedCrewKey),
    `flagship crew should contain moved entry ${promotedCrewKey}`,
  ).toBeTruthy()

  // 5. Fire crew on flagship.
  const fireRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (args) => (window as any).__uclife__.fireCrewMemberViaDebug(args.ship, args.npc),
    { ship: flagship.entityKey, npc: promotedCrewKey },
  )
  expect(fireRes, `fire crew should return true; got ${fireRes}`).toBe(true)

  const rosterF = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.crewRosterSnapshot(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flF = rosterF.find((r: any) => r.shipKey === flagship.entityKey)
  expect(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !flF.crew.find((c: any) => c.npcKey === promotedCrewKey),
    `flagship crew should not contain fired entry ${promotedCrewKey}`,
  ).toBeTruthy()

  // 6. manRestFromIdlePool fills the pegasus.
  for (let i = 0; i < 10; i++) {
    await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (key) => (window as any).__uclife__.spawnTestNpc({ key }),
      `test-idle-${i}`,
    )
  }
  const pegCaptainNpc = 'test-npc-pegcap'
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.spawnTestNpc({ key: k, name: 'PegasusCaptain' }),
    pegCaptainNpc,
  )
  const pegHireCap = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (args) => (window as any).__uclife__.hireCaptainViaDebug(args.npcKey, args.shipKey),
    { npcKey: pegCaptainNpc, shipKey: pegasus.entityKey },
  )
  expect(pegHireCap.ok, `pegasus captain hire failed: ${JSON.stringify(pegHireCap)}`).toBeTruthy()

  const manRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.manRestFromIdleViaDebug(k),
    pegasus.entityKey,
  )
  expect(manRes && manRes.hired > 0, `manRestFromIdle should hire >0; got ${JSON.stringify(manRes)}`).toBeTruthy()

  const rosterAfterMan = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.crewRosterSnapshot(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pegAfterMan = rosterAfterMan.find((r: any) => r.shipKey === pegasus.entityKey)
  expect(pegAfterMan, 'pegasus row missing post-man').toBeTruthy()
  expect(pegAfterMan.crew.length).toBeGreaterThanOrEqual(manRes.hired)

  // 7. Save round-trip.
  const preSaveRoster = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.crewRosterSnapshot(),
  )
  const preSaveEffects = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.shipEffectIds(k),
    flagship.entityKey,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const preSaveCaptain = preSaveRoster.find((r: any) => r.shipKey === flagship.entityKey)?.captainKey
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame('auto') })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.loadGame('auto') })
  const postLoadRoster = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.crewRosterSnapshot(),
  )
  const postLoadEffects = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.shipEffectIds(k),
    flagship.entityKey,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postLoadCaptain = postLoadRoster.find((r: any) => r.shipKey === flagship.entityKey)?.captainKey
  expect(postLoadCaptain, `flagship captain not preserved`).toBe(preSaveCaptain)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const preCrewCount = preSaveRoster.reduce((n: number, r: any) => n + r.crew.length, 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postCrewCount = postLoadRoster.reduce((n: number, r: any) => n + r.crew.length, 0)
  expect(postCrewCount).toBe(preCrewCount)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const preEffectId = preSaveEffects.find((id: string) => id.startsWith('eff:officer:'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postEffectId = postLoadEffects.find((id: string) => id.startsWith('eff:officer:'))
  expect(postEffectId, `captain Effect lost on save round-trip`).toBeTruthy()
  expect(postEffectId).toBe(preEffectId)

  // 8. Fire captain → Effect drops.
  const fireCapRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.fireCaptainViaDebug(k),
    flagship.entityKey,
  )
  expect(fireCapRes, `fireCaptain should return true`).toBe(true)

  const effectsAfterFire = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.shipEffectIds(k),
    flagship.entityKey,
  )
  expect(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !effectsAfterFire.find((id: string) => id.startsWith('eff:officer:')),
    `captain Effect should drop after fire`,
  ).toBeTruthy()
  const rosterAfterFire = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.crewRosterSnapshot(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flAfterFire = rosterAfterFire.find((r: any) => r.shipKey === flagship.entityKey)
  expect(flAfterFire?.captainKey, `flagship captainKey should be cleared after fire`).toBe('')
})
