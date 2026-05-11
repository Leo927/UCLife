// Phase 6.2.A.2 orbital-lift smoke. Verifies:
//  1. The VB orbital-lift kiosk spawns at the spaceport with the right
//     liftId + fare + duration from orbital-lifts.json5.
//  2. The Granada drydock scene spawns its paired lift kiosk and a
//     state-owned `hangarDrydock` facility with tier='drydock' and
//     slotCapacity matching facility-types.json5.
//  3. The cross-scene transit runs: charges fare, advances the clock by
//     durationMin, and migrates the player to Granada — listHangars on
//     the new active scene returns the drydock.
//  4. Opening NPCDialog on the drydock manager surfaces the hangarManager
//     branch with the authored drydock-tier capacity readout.

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
  () => typeof globalThis.__uclife__?.listOrbitalLifts === 'function'
    && typeof globalThis.__uclife__?.runOrbitalLift === 'function'
    && typeof globalThis.__uclife__?.orbitalLiftCatalog === 'function'
    && typeof globalThis.__uclife__?.listHangars === 'function'
    && typeof globalThis.__uclife__?.hangarManagerEntity === 'function'
    && typeof globalThis.__uclife__?.fillJobVacancies === 'function'
    && typeof globalThis.__uclife__?.cheatMoney === 'function'
    && typeof globalThis.__uclife__?.playerSnapshot === 'function',
  null,
  { timeout: 30_000 },
)

// Pause sim so shift transitions can't race the smoke.
await page.evaluate(() => globalThis.__uclife__.useClock.getState().setSpeed(0))

const failures = []

// 1. Catalog defines exactly the VB ↔ Granada lift; kiosk lands in VB.
const catalog = await page.evaluate(() => globalThis.__uclife__.orbitalLiftCatalog())
if (catalog.length !== 1) failures.push(`expected 1 orbital lift at 6.2.A.2, found ${catalog.length}`)
const vbLift = catalog.find((l) => l.id === 'vonBraunGranadaLift')
if (!vbLift) {
  failures.push('vonBraunGranadaLift missing from orbitalLiftCatalog')
} else {
  if (vbLift.sceneIdA !== 'vonBraunCity' || vbLift.sceneIdB !== 'granadaDrydock') {
    failures.push(`vbLift endpoints A=${vbLift.sceneIdA} B=${vbLift.sceneIdB}`)
  }
  if (vbLift.durationMin !== 90) failures.push(`vbLift.durationMin=${vbLift.durationMin} (want 90)`)
  if (vbLift.fare !== 500) failures.push(`vbLift.fare=${vbLift.fare} (want 500)`)
}

const vbKiosks = await page.evaluate(() => globalThis.__uclife__.listOrbitalLifts('vonBraunCity'))
if (vbKiosks.length !== 1) failures.push(`VB scene expected 1 lift kiosk, found ${vbKiosks.length}`)
const vbKiosk = vbKiosks.find((k) => k.liftId === 'vonBraunGranadaLift')
if (!vbKiosk) {
  failures.push('VB kiosk for vonBraunGranadaLift missing')
} else {
  if (vbKiosk.destSceneId !== 'granadaDrydock') {
    failures.push(`VB kiosk destSceneId=${vbKiosk.destSceneId} (want granadaDrydock)`)
  }
  console.log(`VB lift kiosk @(${vbKiosk.posTile.x},${vbKiosk.posTile.y}) → ${vbKiosk.destSceneId}`)
}

const granadaKiosks = await page.evaluate(() => globalThis.__uclife__.listOrbitalLifts('granadaDrydock'))
if (granadaKiosks.length !== 1) {
  failures.push(`Granada scene expected 1 lift kiosk, found ${granadaKiosks.length}`)
}
const granadaKiosk = granadaKiosks.find((k) => k.liftId === 'vonBraunGranadaLift')
if (!granadaKiosk) {
  failures.push('Granada kiosk for vonBraunGranadaLift missing')
} else {
  if (granadaKiosk.destSceneId !== 'vonBraunCity') {
    failures.push(`Granada kiosk destSceneId=${granadaKiosk.destSceneId} (want vonBraunCity)`)
  }
  console.log(`Granada lift kiosk @(${granadaKiosk.posTile.x},${granadaKiosk.posTile.y}) → ${granadaKiosk.destSceneId}`)
}

if (failures.length) await dumpAndExit()

// 2. Set up enough money to pay the fare; capture pre-transit money + clock.
await page.evaluate(() => globalThis.__uclife__.cheatMoney(2000))

const pre = await page.evaluate(() => ({
  money: globalThis.__uclife__.playerSnapshot()?.money ?? null,
  ms: globalThis.__uclife__.useClock.getState().gameDate.getTime(),
  sceneId: globalThis.__uclife__.useScene.getState().activeId,
}))
console.log(`pre-transit: money=${pre.money} sceneId=${pre.sceneId}`)

const arrivedSceneId = await page.evaluate(() => globalThis.__uclife__.runOrbitalLift('vonBraunGranadaLift'))
if (arrivedSceneId !== 'granadaDrydock') {
  failures.push(`runOrbitalLift returned ${arrivedSceneId} (want granadaDrydock)`)
  await dumpAndExit()
}
console.log(`transit → ${arrivedSceneId}`)

const post = await page.evaluate(() => ({
  money: globalThis.__uclife__.playerSnapshot()?.money ?? null,
  ms: globalThis.__uclife__.useClock.getState().gameDate.getTime(),
  sceneId: globalThis.__uclife__.useScene.getState().activeId,
}))
console.log(`post-transit: money=${post.money} sceneId=${post.sceneId}`)

if (post.sceneId !== 'granadaDrydock') failures.push(`post.sceneId=${post.sceneId} (want granadaDrydock)`)
if (pre.money !== null && post.money !== null) {
  const delta = pre.money - post.money
  if (delta !== 500) failures.push(`fare delta=${delta} (want 500)`)
}
const minutesDelta = Math.round((post.ms - pre.ms) / 60_000)
if (minutesDelta !== 90) failures.push(`clock delta=${minutesDelta}min (want 90)`)

// 3. listHangars on the Granada active scene returns the drydock.
const hangars = await page.evaluate(() => globalThis.__uclife__.listHangars())
if (hangars.length !== 1) failures.push(`Granada scene expected 1 hangar, found ${hangars.length}`)
const drydock = hangars.find((h) => h.typeId === 'hangarDrydock')
if (!drydock) {
  failures.push('hangarDrydock missing from listHangars in Granada')
} else {
  if (drydock.tier !== 'drydock') failures.push(`drydock.tier=${drydock.tier} (want drydock)`)
  if (drydock.slotCapacity.capital !== 4) failures.push(`drydock.slotCapacity.capital=${drydock.slotCapacity.capital} (want 4)`)
  if (drydock.slotCapacity.smallCraft !== 12) failures.push(`drydock.slotCapacity.smallCraft=${drydock.slotCapacity.smallCraft} (want 12)`)
  if (drydock.ownerKind !== 'state') failures.push(`drydock.ownerKind=${drydock.ownerKind} (want state)`)
  if (drydock.workerCount < 1) failures.push(`drydock workerCount=${drydock.workerCount} (want >= 1)`)
  console.log(`drydock: ${drydock.buildingKey} tier=${drydock.tier} capital=${drydock.slotCapacity.capital} small=${drydock.slotCapacity.smallCraft} workers=${drydock.workerCount}`)
}

if (!drydock) await dumpAndExit()

// 4. Seat the manager + workers, then verify the manager dialog renders the
//    drydock-tier readout (capital + smallCraft slot counts).
const filled = await page.evaluate(() => globalThis.__uclife__.fillJobVacancies(['hangar_manager', 'hangar_worker']))
console.log(`fillJobVacancies: ${JSON.stringify(filled)}`)

const after = await page.evaluate(() => globalThis.__uclife__.listHangars())
const drydockAfter = after.find((h) => h.buildingKey === drydock.buildingKey)
if (!drydockAfter?.manager) {
  failures.push('drydock manager seat still empty after fillJobVacancies')
} else if (!drydockAfter.manager.occupantName) {
  failures.push('drydock manager occupant has no Character name')
} else {
  console.log(`manager seated: ${drydockAfter.manager.occupantName} @(${drydockAfter.manager.posTile?.x},${drydockAfter.manager.posTile?.y})`)
}

const opened = await page.evaluate((buildingKey) => {
  const manager = globalThis.__uclife__.hangarManagerEntity(buildingKey)
  if (!manager) return false
  const ui = globalThis.uclifeUI
  if (!ui?.getState) return false
  ui.getState().setDialogNPC(manager)
  return true
}, drydock.buildingKey)
if (!opened) {
  failures.push('could not open NPCDialog for drydock manager')
} else {
  await page.waitForTimeout(200)
  const branchButton = await page.$('button.dialog-option:has-text("机库状况")')
  if (!branchButton) {
    failures.push('hangarManager branch button missing from NPCDialog')
  } else {
    await branchButton.click()
    await page.waitForTimeout(150)
    const text = await page.evaluate(() => {
      const node = document.querySelector('section[data-dialogue-node="hangarManager"]')
      return node?.textContent ?? ''
    })
    if (!text.includes('0 / 4')) failures.push('manager panel missing 0/4 capital readout')
    if (!text.includes('0 / 12')) failures.push('manager panel missing 0/12 smallCraft readout')
    if (!text.includes('船坞') && !text.includes('轨道')) failures.push('manager panel missing drydock tier label')
    console.log(`manager dialog readout: ${text.replace(/\s+/g, ' ').slice(0, 200)}`)
  }
}

await browser.close()

if (errors.length) {
  console.log('\nERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}
if (failures.length) {
  console.log('\nFAILURES:')
  failures.forEach((f) => console.log('  ' + f))
}
if (errors.length || failures.length) process.exit(1)

console.log('\nOK: orbital lift + Granada drydock + facility shape + manager talk-verb verified.')

async function dumpAndExit() {
  console.log('\ncatalog dump:')
  console.log(JSON.stringify(catalog, null, 2))
  console.log('\nVB kiosks dump:')
  console.log(JSON.stringify(vbKiosks, null, 2))
  console.log('\nGranada kiosks dump:')
  console.log(JSON.stringify(granadaKiosks, null, 2))
  await browser.close()
  process.exit(1)
}
