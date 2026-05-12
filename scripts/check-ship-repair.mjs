// Phase 6.2.B ship-repair smoke. Verifies:
//  1. The flagship spawns with a ShipStatSheet whose bases match the
//     lightFreighter template (hullPoints, armorPoints, topSpeed,
//     brigCapacity, crewRequired, fuelStorage, supplyStorage).
//  2. Damage applied via damageFlagship persists across the dock state —
//     no auto-restore at the next tick / next-frame loop.
//  3. The VB state hangar produces non-zero daily throughput once its
//     manager + workers are seated, and that throughput credits the
//     flagship while it's docked at vonBraun.
//  4. The repair-priority verb focuses throughput on a single ship and
//     auto-clears the focus key when that ship is fully repaired.
//  5. Save round-trip (saveGame → resetWorld via loadGame) preserves
//     ShipStatSheet base values, hull/armor damage, and the hangar's
//     repairPriorityShipKey.

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
    && typeof globalThis.__uclife__?.flagshipStatSheet === 'function'
    && typeof globalThis.__uclife__?.flagshipDamage === 'function'
    && typeof globalThis.__uclife__?.damageFlagship === 'function'
    && typeof globalThis.__uclife__?.setHangarRepairPriority === 'function'
    && typeof globalThis.__uclife__?.hangarRepairDescribe === 'function'
    && typeof globalThis.__uclife__?.runHangarRepairTick === 'function'
    && typeof globalThis.__uclife__?.fillJobVacancies === 'function'
    && typeof globalThis.__uclife__?.saveGame === 'function'
    && typeof globalThis.__uclife__?.loadGame === 'function',
  null,
  { timeout: 30_000 },
)

await page.evaluate(() => globalThis.__uclife__.useClock.getState().setSpeed(0))

const failures = []
const fail = (m) => failures.push(m)
const pass = (m) => console.log('PASS ' + m)

// 1. ShipStatSheet bases match the lightFreighter template.
const sheet = await page.evaluate(() => globalThis.__uclife__.flagshipStatSheet())
if (!sheet) fail('flagshipStatSheet() returned null at boot — sheet not attached')
else {
  if (sheet.hullPoints !== 800) fail(`hullPoints base ${sheet.hullPoints} (want 800 from lightFreighter)`)
  if (sheet.armorPoints !== 200) fail(`armorPoints base ${sheet.armorPoints} (want 200)`)
  if (sheet.topSpeed !== 60) fail(`topSpeed base ${sheet.topSpeed} (want 60)`)
  if (sheet.brigCapacity !== 2) fail(`brigCapacity base ${sheet.brigCapacity} (want 2)`)
  if (sheet.crewRequired !== 4) fail(`crewRequired base ${sheet.crewRequired} (want 4 = crewMax)`)
  if (sheet.fuelStorage !== 16) fail(`fuelStorage base ${sheet.fuelStorage} (want 16)`)
  if (sheet.supplyStorage !== 40) fail(`supplyStorage base ${sheet.supplyStorage} (want 40)`)
  pass(`statSheet bases: hull=${sheet.hullPoints} armor=${sheet.armorPoints} speed=${sheet.topSpeed} brig=${sheet.brigCapacity}`)
}

// Locate the state hangar.
const hangars = await page.evaluate(() => globalThis.__uclife__.listHangars())
const vb = hangars.find((h) => h.typeId === 'hangarSurface')
if (!vb) { fail('VB state hangar missing — 6.2.A regression'); await done() }

// Seat the manager + workers so throughput math is non-zero.
await page.evaluate(() => globalThis.__uclife__.fillJobVacancies(['hangar_manager', 'hangar_worker']))
const seated = await page.evaluate(() => globalThis.__uclife__.listHangars())
const vbSeated = seated.find((h) => h.buildingKey === vb.buildingKey)
if (!vbSeated?.manager) fail('manager seat empty after fillJobVacancies')
if (vbSeated.workersSeated < 1) fail(`workersSeated=${vbSeated.workersSeated} (want >= 1)`)

const initialDesc = await page.evaluate((k) => globalThis.__uclife__.hangarRepairDescribe(k), vb.buildingKey)
if (!initialDesc) fail('hangarRepairDescribe returned null at boot')
else if (initialDesc.throughput <= 0) fail(`throughput=${initialDesc.throughput} at boot (want > 0 with seated crew)`)
else pass(`throughput at boot: ${initialDesc.throughput.toFixed(1)} pts/day`)

// 2. Persistent damage.
const before = await page.evaluate(() => globalThis.__uclife__.flagshipDamage())
if (!before) fail('flagshipDamage() returned null at boot')
const hullLoss = 600
const armorLoss = 150
const damaged = await page.evaluate((p) => globalThis.__uclife__.damageFlagship(p.hull, p.armor), { hull: hullLoss, armor: armorLoss })
if (!damaged) fail('damageFlagship() returned null')
else {
  if (damaged.hullCurrent !== before.hullCurrent - hullLoss) {
    fail(`hullCurrent after damage = ${damaged.hullCurrent} (want ${before.hullCurrent - hullLoss})`)
  }
  if (damaged.armorCurrent !== before.armorCurrent - armorLoss) {
    fail(`armorCurrent after damage = ${damaged.armorCurrent} (want ${before.armorCurrent - armorLoss})`)
  }
  pass(`damage applied: hull ${damaged.hullCurrent}/${damaged.hullMax} armor ${damaged.armorCurrent}/${damaged.armorMax}`)
}

// 3. One repair tick — credits should land on the docked-at-vonBraun flagship.
const beforeTick = await page.evaluate(() => globalThis.__uclife__.flagshipDamage())
const tickResult = await page.evaluate(() => globalThis.__uclife__.runHangarRepairTick(1))
if (!tickResult) fail('runHangarRepairTick(1) returned null')
else if (tickResult.hangarsTicked !== 1) fail(`hangarsTicked=${tickResult.hangarsTicked} (want 1)`)
else if (tickResult.pointsApplied <= 0) fail(`pointsApplied=${tickResult.pointsApplied} on first tick (want > 0)`)
else pass(`tick1: hangarsTicked=${tickResult.hangarsTicked} pointsApplied=${tickResult.pointsApplied.toFixed(1)}`)

const afterTick = await page.evaluate(() => globalThis.__uclife__.flagshipDamage())
const totalRestored = (afterTick.armorCurrent - beforeTick.armorCurrent) + (afterTick.hullCurrent - beforeTick.hullCurrent)
if (totalRestored <= 0) fail(`no repair progress on tick1: hull ${beforeTick.hullCurrent}→${afterTick.hullCurrent} armor ${beforeTick.armorCurrent}→${afterTick.armorCurrent}`)
else pass(`restored ${totalRestored} points on tick1 — hull ${beforeTick.hullCurrent}→${afterTick.hullCurrent} armor ${beforeTick.armorCurrent}→${afterTick.armorCurrent}`)

// Verify armor-first ordering: armor restored first because the deficit
// is smaller than the per-tick throughput at baseline staffing.
if (afterTick.armorCurrent <= beforeTick.armorCurrent && afterTick.hullCurrent > beforeTick.hullCurrent) {
  fail('hull repaired before armor — should be armor-first per Starsector repair model')
}

// 4. Repair-priority focus: set focus on the flagship; run ticks until restored.
const setRes = await page.evaluate((k) => globalThis.__uclife__.setHangarRepairPriority(k, 'ship'), vb.buildingKey)
if (setRes !== 'ship') fail(`setHangarRepairPriority returned ${setRes} (want 'ship')`)

const focusedDesc = await page.evaluate((k) => globalThis.__uclife__.hangarRepairDescribe(k), vb.buildingKey)
if (focusedDesc.priorityShipKey !== 'ship') fail(`priorityShipKey=${focusedDesc.priorityShipKey} after set (want 'ship')`)
else pass(`priority focus set: ${focusedDesc.priorityShipKey}`)

// Run up to 20 ticks (well above the ~5 needed at baseline 200 pts/day vs.
// ~750 deficit) to finish the demo. Stop early once fully repaired.
let ticks = 0
let final = afterTick
while (ticks < 20) {
  ticks += 1
  await page.evaluate((d) => globalThis.__uclife__.runHangarRepairTick(d), ticks + 1)
  final = await page.evaluate(() => globalThis.__uclife__.flagshipDamage())
  if (final.hullCurrent >= final.hullMax && final.armorCurrent >= final.armorMax) break
}
if (final.hullCurrent < final.hullMax || final.armorCurrent < final.armorMax) {
  fail(`flagship not fully repaired after ${ticks} ticks: hull ${final.hullCurrent}/${final.hullMax} armor ${final.armorCurrent}/${final.armorMax}`)
} else {
  pass(`flagship fully repaired in ${ticks} ticks → hull ${final.hullCurrent}/${final.hullMax} armor ${final.armorCurrent}/${final.armorMax}`)
}

const clearedDesc = await page.evaluate((k) => globalThis.__uclife__.hangarRepairDescribe(k), vb.buildingKey)
if (clearedDesc.priorityShipKey !== '') {
  fail(`priorityShipKey=${clearedDesc.priorityShipKey} after full repair (want '' — auto-clear)`)
} else {
  pass('priority focus auto-cleared after ship reached full health')
}

// 5. Save round-trip.
await page.evaluate(() => globalThis.__uclife__.damageFlagship(300, 80))
const setBack = await page.evaluate((k) => globalThis.__uclife__.setHangarRepairPriority(k, 'ship'), vb.buildingKey)
if (setBack !== 'ship') fail(`re-set priority returned ${setBack}`)

const preSave = await page.evaluate((k) => ({
  damage: globalThis.__uclife__.flagshipDamage(),
  sheet: globalThis.__uclife__.flagshipStatSheet(),
  desc: globalThis.__uclife__.hangarRepairDescribe(k),
}), vb.buildingKey)
const saveOk = await page.evaluate(async () => {
  await globalThis.__uclife__.saveGame('auto')
  return true
})
if (!saveOk) fail('saveGame returned falsy')

await page.evaluate(async () => {
  await globalThis.__uclife__.loadGame('auto')
})

const postLoad = await page.evaluate((k) => ({
  damage: globalThis.__uclife__.flagshipDamage(),
  sheet: globalThis.__uclife__.flagshipStatSheet(),
  desc: globalThis.__uclife__.hangarRepairDescribe(k),
}), vb.buildingKey)

if (postLoad.damage.hullCurrent !== preSave.damage.hullCurrent) {
  fail(`hull lost across save: ${preSave.damage.hullCurrent} → ${postLoad.damage.hullCurrent}`)
}
if (postLoad.damage.armorCurrent !== preSave.damage.armorCurrent) {
  fail(`armor lost across save: ${preSave.damage.armorCurrent} → ${postLoad.damage.armorCurrent}`)
}
if (postLoad.sheet.hullPoints !== preSave.sheet.hullPoints) {
  fail(`sheet.hullPoints lost across save: ${preSave.sheet.hullPoints} → ${postLoad.sheet.hullPoints}`)
}
if (postLoad.desc.priorityShipKey !== 'ship') {
  fail(`priorityShipKey lost across save: 'ship' → '${postLoad.desc.priorityShipKey}'`)
} else {
  pass(`save round-trip preserved damage + statSheet + repair priority`)
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
  console.log('\nOK: ShipStatSheet + persistent damage + hangar repair throughput + repair-priority verb verified.')
}
