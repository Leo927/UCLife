// Phase 6.2.A hangar smoke. Verifies:
//  1. The Von Braun state hangar spawns with the Hangar trait carrying
//     tier='surface' and slotCapacity matching facility-types.json5.
//  2. The hangar is state-owned (ownerKind='state'), and the realtor
//     never lists it (stateLocked: true in building-types.json5).
//  3. The hangar manager seat is BT-claimable: after fillJobVacancies
//     forces the seat, it has an occupant Character.
//  4. Opening NPCDialog on the manager surfaces the hangarManager branch
//     with the authored capacity readout.

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
  () => typeof globalThis.__uclife__?.listHangars === 'function'
    && typeof globalThis.__uclife__?.hangarManagerEntity === 'function'
    && typeof globalThis.__uclife__?.fillJobVacancies === 'function'
    && typeof globalThis.__uclife__?.realtorListings === 'function',
  null,
  { timeout: 30_000 },
)

// Pause sim — no need for shift transitions to race the smoke.
await page.evaluate(() => globalThis.__uclife__.useClock.getState().setSpeed(0))

const failures = []

// 1. Hangar spawned with the right facility shape.
const hangars = await page.evaluate(() => globalThis.__uclife__.listHangars())
if (hangars.length !== 1) {
  failures.push(`expected 1 hangar at 6.2.A, found ${hangars.length}`)
}
const vb = hangars.find((h) => h.typeId === 'hangarSurface')
if (!vb) {
  failures.push('hangarSurface missing from listHangars — fixedBuilding regression')
} else {
  if (vb.tier !== 'surface') failures.push(`hangar.tier=${vb.tier} (want surface)`)
  if (vb.slotCapacity.ms !== 4) failures.push(`hangar.slotCapacity.ms=${vb.slotCapacity.ms} (want 4)`)
  if (vb.slotCapacity.smallCraft !== 4) {
    failures.push(`hangar.slotCapacity.smallCraft=${vb.slotCapacity.smallCraft} (want 4)`)
  }
  if (vb.ownerKind !== 'state') failures.push(`hangar.ownerKind=${vb.ownerKind} (want state)`)
  if (vb.workerCount < 1) failures.push(`hangar workerCount=${vb.workerCount} (want >= 1)`)
  console.log(`hangar: ${vb.buildingKey} tier=${vb.tier} ms=${vb.slotCapacity.ms} small=${vb.slotCapacity.smallCraft}`)
  console.log(`  rect tile=(${vb.rectTile.x},${vb.rectTile.y}) ${vb.rectTile.w}x${vb.rectTile.h} workers=${vb.workerCount}`)
}

if (!vb) await dumpAndExit()

// 2. Realtor never lists it — stateLocked filter is honored.
const listings = await page.evaluate(() => globalThis.__uclife__.realtorListings())
const hangarListed = listings.find((l) => l.typeId === 'hangarSurface')
if (hangarListed) failures.push('hangarSurface appeared on realtor — stateLocked filter regression')

// 3. fillJobVacancies seats the manager (and workers) deterministically.
const filled = await page.evaluate(() => globalThis.__uclife__.fillJobVacancies(['hangar_manager', 'hangar_worker']))
if (!Array.isArray(filled)) failures.push('fillJobVacancies did not return an array')
console.log(`fillJobVacancies: ${JSON.stringify(filled)}`)

const after = await page.evaluate(() => globalThis.__uclife__.listHangars())
const vbAfter = after.find((h) => h.buildingKey === vb.buildingKey)
if (!vbAfter?.manager) {
  failures.push('hangar manager seat still empty after fillJobVacancies')
} else if (!vbAfter.manager.occupantName) {
  failures.push('hangar manager occupant has no Character name')
} else {
  console.log(`manager seated: ${vbAfter.manager.occupantName} @(${vbAfter.manager.posTile?.x},${vbAfter.manager.posTile?.y})`)
}

// 4. Open NPCDialog on the manager and assert the hangarManager branch
//    renders the authored capacity readout.
const opened = await page.evaluate((buildingKey) => {
  const manager = globalThis.__uclife__.hangarManagerEntity(buildingKey)
  if (!manager) return false
  const ui = globalThis.uclifeUI
  if (!ui?.getState) return false
  ui.getState().setDialogNPC(manager)
  return true
}, vb.buildingKey)
if (!opened) {
  failures.push('could not open NPCDialog for hangar manager')
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
    if (!text.includes('MS 泊位')) failures.push('manager panel missing MS slot label')
    if (!text.includes('小艇泊位')) failures.push('manager panel missing smallCraft slot label')
    if (!text.includes('0 / 4')) failures.push('manager panel missing 0/4 capacity readout')
    if (!text.includes('地面机库')) failures.push('manager panel missing surface tier label')
    console.log(`manager dialog readout: ${text.replace(/\s+/g, ' ').slice(0, 160)}`)
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

console.log('\nOK: VB state hangar + facility shape + manager talk-verb verified.')

async function dumpAndExit() {
  console.log('\nhangars dump:')
  console.log(JSON.stringify(hangars, null, 2))
  await browser.close()
  process.exit(1)
}
