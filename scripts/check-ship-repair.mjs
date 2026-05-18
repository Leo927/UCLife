// Phase 6.2.B ship-repair smoke. Verifies:
//  1. The flagship spawns with a ShipStatSheet whose bases match the
//     lightFreighter template.
//  2. Damage via damageFlagship persists.
//  3. The VB state hangar produces non-zero daily throughput once staffed.
//  4. Repair-priority focuses throughput; auto-clears when ship fully repaired.
//  5. Save round-trip preserves ShipStatSheet bases, hull/armor damage,
//     and the hangar's repairPriorityShipKey.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { BOOT_READY_TIMEOUT_MS } from './_test-constants.mjs'

const EXPECTED_HULL_BASE = 800
const EXPECTED_ARMOR_BASE = 200
const EXPECTED_TOP_SPEED = 60
const EXPECTED_BRIG = 2
const EXPECTED_CREW_REQUIRED = 4
const EXPECTED_FUEL_STORAGE = 16
const EXPECTED_SUPPLY_STORAGE = 40

const FIRST_DAMAGE_HULL = 600
const FIRST_DAMAGE_ARMOR = 150
const FIRST_TICK_DAY = 1
const SECOND_DAMAGE_HULL = 300
const SECOND_DAMAGE_ARMOR = 80
const MAX_REPAIR_TICKS = 20

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`) })

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.listHangars === 'function'
    && typeof window.__uclife__?.flagshipStatSheet === 'function'
    && typeof window.__uclife__?.flagshipDamage === 'function'
    && typeof window.__uclife__?.damageFlagship === 'function'
    && typeof window.__uclife__?.setHangarRepairPriority === 'function'
    && typeof window.__uclife__?.hangarRepairDescribe === 'function'
    && typeof window.__uclife__?.runHangarRepairTick === 'function'
    && typeof window.__uclife__?.fillJobVacancies === 'function'
    && typeof window.__uclife__?.saveGame === 'function'
    && typeof window.__uclife__?.loadGame === 'function',
  null, { timeout: BOOT_READY_TIMEOUT_MS },
)

const sheet = await page.evaluate(() => window.__uclife__.flagshipStatSheet())
assert.ok(sheet, 'flagshipStatSheet() returned null at boot — sheet not attached')
assert.equal(sheet.hullPoints, EXPECTED_HULL_BASE, `hullPoints base ${sheet.hullPoints} (want ${EXPECTED_HULL_BASE})`)
assert.equal(sheet.armorPoints, EXPECTED_ARMOR_BASE, `armorPoints base ${sheet.armorPoints}`)
assert.equal(sheet.topSpeed, EXPECTED_TOP_SPEED, `topSpeed base ${sheet.topSpeed}`)
assert.equal(sheet.brigCapacity, EXPECTED_BRIG, `brigCapacity base ${sheet.brigCapacity}`)
assert.equal(sheet.crewRequired, EXPECTED_CREW_REQUIRED, `crewRequired base ${sheet.crewRequired}`)
assert.equal(sheet.fuelStorage, EXPECTED_FUEL_STORAGE, `fuelStorage base ${sheet.fuelStorage}`)
assert.equal(sheet.supplyStorage, EXPECTED_SUPPLY_STORAGE, `supplyStorage base ${sheet.supplyStorage}`)
console.log(`statSheet bases: hull=${sheet.hullPoints} armor=${sheet.armorPoints} speed=${sheet.topSpeed} brig=${sheet.brigCapacity}`)

const hangars = await page.evaluate(() => window.__uclife__.listHangars())
const vb = hangars.find((h) => h.typeId === 'hangarSurface')
assert.ok(vb, 'VB state hangar missing — 6.2.A regression')

await page.evaluate(() => window.__uclife__.fillJobVacancies(['hangar_manager', 'hangar_worker']))
const seated = await page.evaluate(() => window.__uclife__.listHangars())
const vbSeated = seated.find((h) => h.buildingKey === vb.buildingKey)
assert.ok(vbSeated?.manager, 'manager seat empty after fillJobVacancies')
assert.ok(vbSeated.workersSeated >= 1, `workersSeated=${vbSeated.workersSeated} (want >= 1)`)

const initialDesc = await page.evaluate(
  (k) => window.__uclife__.hangarRepairDescribe(k),
  vb.buildingKey,
)
assert.ok(initialDesc, 'hangarRepairDescribe returned null at boot')
assert.ok(initialDesc.throughput > 0,
  `throughput=${initialDesc.throughput} at boot (want > 0 with seated crew)`)
console.log(`throughput at boot: ${initialDesc.throughput.toFixed(1)} pts/day`)

const before = await page.evaluate(() => window.__uclife__.flagshipDamage())
assert.ok(before, 'flagshipDamage() returned null at boot')

const damaged = await page.evaluate(
  (p) => window.__uclife__.damageFlagship(p.hull, p.armor),
  { hull: FIRST_DAMAGE_HULL, armor: FIRST_DAMAGE_ARMOR },
)
assert.ok(damaged, 'damageFlagship() returned null')
assert.equal(damaged.hullCurrent, before.hullCurrent - FIRST_DAMAGE_HULL,
  `hullCurrent after damage = ${damaged.hullCurrent}`)
assert.equal(damaged.armorCurrent, before.armorCurrent - FIRST_DAMAGE_ARMOR,
  `armorCurrent after damage = ${damaged.armorCurrent}`)
console.log(`damage applied: hull ${damaged.hullCurrent}/${damaged.hullMax} armor ${damaged.armorCurrent}/${damaged.armorMax}`)

const beforeTick = await page.evaluate(() => window.__uclife__.flagshipDamage())
const tickResult = await page.evaluate(
  (d) => window.__uclife__.runHangarRepairTick(d),
  FIRST_TICK_DAY,
)
assert.ok(tickResult, 'runHangarRepairTick returned null')
assert.equal(tickResult.hangarsTicked, 1, `hangarsTicked=${tickResult.hangarsTicked} (want 1)`)
assert.ok(tickResult.pointsApplied > 0, `pointsApplied=${tickResult.pointsApplied}`)
console.log(`tick1: hangarsTicked=${tickResult.hangarsTicked} pointsApplied=${tickResult.pointsApplied.toFixed(1)}`)

const afterTick = await page.evaluate(() => window.__uclife__.flagshipDamage())
const totalRestored =
  (afterTick.armorCurrent - beforeTick.armorCurrent) +
  (afterTick.hullCurrent - beforeTick.hullCurrent)
assert.ok(totalRestored > 0, `no repair progress on tick1: hull ${beforeTick.hullCurrent}→${afterTick.hullCurrent}`)
if (afterTick.armorCurrent <= beforeTick.armorCurrent && afterTick.hullCurrent > beforeTick.hullCurrent) {
  throw new Error('hull repaired before armor — should be armor-first per Starsector repair model')
}

const setRes = await page.evaluate(
  (k) => window.__uclife__.setHangarRepairPriority(k, 'ship'),
  vb.buildingKey,
)
assert.equal(setRes, 'ship', `setHangarRepairPriority returned ${setRes}`)

const focusedDesc = await page.evaluate(
  (k) => window.__uclife__.hangarRepairDescribe(k),
  vb.buildingKey,
)
assert.equal(focusedDesc.priorityShipKey, 'ship', `priorityShipKey=${focusedDesc.priorityShipKey}`)

let ticks = 0
let final = afterTick
while (ticks < MAX_REPAIR_TICKS) {
  ticks += 1
  await page.evaluate(
    (d) => window.__uclife__.runHangarRepairTick(d),
    ticks + 1,
  )
  final = await page.evaluate(() => window.__uclife__.flagshipDamage())
  if (final.hullCurrent >= final.hullMax && final.armorCurrent >= final.armorMax) break
}
assert.ok(final.hullCurrent >= final.hullMax && final.armorCurrent >= final.armorMax,
  `flagship not fully repaired after ${ticks} ticks: hull ${final.hullCurrent}/${final.hullMax}`)
console.log(`flagship fully repaired in ${ticks} ticks → hull ${final.hullCurrent}/${final.hullMax} armor ${final.armorCurrent}/${final.armorMax}`)

const clearedDesc = await page.evaluate(
  (k) => window.__uclife__.hangarRepairDescribe(k),
  vb.buildingKey,
)
assert.equal(clearedDesc.priorityShipKey, '',
  `priorityShipKey=${clearedDesc.priorityShipKey} after full repair (want '' — auto-clear)`)

await page.evaluate(
  (p) => window.__uclife__.damageFlagship(p.hull, p.armor),
  { hull: SECOND_DAMAGE_HULL, armor: SECOND_DAMAGE_ARMOR },
)
const setBack = await page.evaluate(
  (k) => window.__uclife__.setHangarRepairPriority(k, 'ship'),
  vb.buildingKey,
)
assert.equal(setBack, 'ship', `re-set priority returned ${setBack}`)

const preSave = await page.evaluate(
  (k) => ({
    damage: window.__uclife__.flagshipDamage(),
    sheet: window.__uclife__.flagshipStatSheet(),
    desc: window.__uclife__.hangarRepairDescribe(k),
  }),
  vb.buildingKey,
)
await page.evaluate(async () => { await window.__uclife__.saveGame('auto') })
const loadOk = await page.evaluate(async () => window.__uclife__.loadGame('auto'))
assert.equal(loadOk.ok, true, `loadGame failed: ${JSON.stringify(loadOk)}`)

const postLoad = await page.evaluate(
  (k) => ({
    damage: window.__uclife__.flagshipDamage(),
    sheet: window.__uclife__.flagshipStatSheet(),
    desc: window.__uclife__.hangarRepairDescribe(k),
  }),
  vb.buildingKey,
)
assert.equal(postLoad.damage.hullCurrent, preSave.damage.hullCurrent,
  `hull lost across save: ${preSave.damage.hullCurrent} → ${postLoad.damage.hullCurrent}`)
assert.equal(postLoad.damage.armorCurrent, preSave.damage.armorCurrent,
  `armor lost across save: ${preSave.damage.armorCurrent} → ${postLoad.damage.armorCurrent}`)
assert.equal(postLoad.sheet.hullPoints, preSave.sheet.hullPoints,
  `sheet.hullPoints lost across save: ${preSave.sheet.hullPoints} → ${postLoad.sheet.hullPoints}`)
assert.equal(postLoad.desc.priorityShipKey, 'ship',
  `priorityShipKey lost across save: 'ship' → '${postLoad.desc.priorityShipKey}'`)
console.log('save round-trip preserved damage + statSheet + repair priority')

assert.equal(pageErrors.length, 0,
  `page error(s) during test:\n${pageErrors.map((e) => '  ' + e).join('\n')}`)

await browser.close()

console.log('\nOK: ShipStatSheet + persistent damage + hangar repair throughput + repair-priority verb verified.')
