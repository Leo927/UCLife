import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
await mkdir('scripts/out', { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

await page.evaluate(() => {
  // eslint-disable-next-line no-undef
  const u = window.__uclife__
  for (const e of u.world.query()) { void e } // warm
})

const initial = await page.evaluate(() => {
  // eslint-disable-next-line no-undef
  const u = window.__uclife__
  const pe = u.world.queryFirst()
  void pe
  return {
    activeId: u.useScene.getState().activeId,
  }
})
console.log('Initial active scene:', initial.activeId)

// Airport arrival tiles are procgen-randomized, so ask the running app
// where each hub actually placed its arrival pixel rather than hardcoding.
const airports = await page.evaluate(() => window.__uclife__.listAirports())
const expectedArrival = Object.fromEntries(
  airports
    .filter((a) => a.placement)
    .map((a) => [a.hubId, a.placement.arrivalPx]),
)
const zumArrival = expectedArrival.zumCityAirport
const startArrival = expectedArrival.vonBraunCityAirport
if (!zumArrival || !startArrival) {
  console.log('FAIL · missing airport placement(s):', expectedArrival)
  await browser.close()
  process.exit(1)
}

await page.evaluate(async () => {
  const traitsMod = await import('/src/ecs/traits/index.ts')
  // eslint-disable-next-line no-undef
  const u = window.__uclife__
  const player = u.world.queryFirst(traitsMod.IsPlayer)
  if (!player) throw new Error('no player')
  player.set(traitsMod.Money, { amount: 2000 })
})

await page.evaluate(() => window.uclifeUI.getState().openFlight('vonBraunCityAirport'))
await page.waitForTimeout(300)

const startBtnText = await page.evaluate(() => {
  return document.querySelector('.transit-terminal-go')?.textContent ?? null
})
console.log('Von Braun buy button:', startBtnText)
if (startBtnText !== '购票') {
  console.log('FAIL · expected buy button to read 购票 after money top-up')
  await browser.close()
  process.exit(1)
}

await page.click('.transit-terminal-go')
// Transition is ~280ms out + midpoint + 280ms in. Wait generously.
await page.waitForTimeout(1500)

const afterFly1 = await page.evaluate(async () => {
  const traitsMod = await import('/src/ecs/traits/index.ts')
  // eslint-disable-next-line no-undef
  const u = window.__uclife__
  const player = u.world.queryFirst(traitsMod.IsPlayer)
  const pos = player?.get(traitsMod.Position)
  return {
    activeId: u.useScene.getState().activeId,
    playerPos: pos ? { x: pos.x, y: pos.y } : null,
  }
})
console.log('After leg 1 (vonBraunCity → zumCity):', afterFly1, 'expected arrival:', zumArrival)
const leg1Ok =
  afterFly1.activeId === 'zumCity' &&
  afterFly1.playerPos?.x === zumArrival.x &&
  afterFly1.playerPos?.y === zumArrival.y
console.log(leg1Ok ? 'PASS · scene swapped to zumCity at zumCityAirport arrival tile' : 'FAIL · leg 1 mismatch')

await page.screenshot({ path: 'scripts/out/scene-swap-zumcity.png', fullPage: false })

const moneyAfterLeg1 = await page.evaluate(async () => {
  const traitsMod = await import('/src/ecs/traits/index.ts')
  const u = window.__uclife__
  const player = u.world.queryFirst(traitsMod.IsPlayer)
  return player?.get(traitsMod.Money)?.amount ?? null
})
console.log('Player money after leg 1:', moneyAfterLeg1)

await page.evaluate(() => window.uclifeUI.getState().openFlight('zumCityAirport'))
await page.waitForTimeout(500)

const returnDebug = await page.evaluate(async () => {
  const traitsMod = await import('/src/ecs/traits/index.ts')
  const u = window.__uclife__
  const players = []
  for (const e of u.world.query(traitsMod.IsPlayer)) {
    const m = e.get(traitsMod.Money)
    players.push({ ent: String(e), money: m?.amount ?? null })
  }
  return {
    activeScene: u.useScene.getState().activeId,
    playersInActive: players,
    btn: document.querySelector('.transit-terminal-go')?.textContent ?? null,
    btnDisabled: document.querySelector('.transit-terminal-go')?.disabled ?? null,
    metaText: document.querySelector('.status-meta')?.textContent ?? null,
  }
})
console.log('Zum City modal debug:', JSON.stringify(returnDebug))
const returnBtnText = returnDebug.btn
if (returnBtnText !== '购票') {
  console.log('FAIL · expected return buy button to read 购票')
  await browser.close()
  process.exit(1)
}

await page.click('.transit-terminal-go')
await page.waitForTimeout(1500)

const afterFly2 = await page.evaluate(async () => {
  const traitsMod = await import('/src/ecs/traits/index.ts')
  // eslint-disable-next-line no-undef
  const u = window.__uclife__
  const player = u.world.queryFirst(traitsMod.IsPlayer)
  const pos = player?.get(traitsMod.Position)
  return {
    activeId: u.useScene.getState().activeId,
    playerPos: pos ? { x: pos.x, y: pos.y } : null,
  }
})
console.log('After leg 2 (zumCity → vonBraunCity):', afterFly2, 'expected arrival:', startArrival)
const leg2Ok =
  afterFly2.activeId === 'vonBraunCity' &&
  afterFly2.playerPos?.x === startArrival.x &&
  afterFly2.playerPos?.y === startArrival.y
console.log(leg2Ok ? 'PASS · scene swapped back to vonBraunCity at vonBraunCityAirport arrival tile' : 'FAIL · leg 2 mismatch')

await page.screenshot({ path: 'scripts/out/scene-swap-starttown.png', fullPage: false })

if (errors.length) {
  console.log('PAGE ERRORS:')
  for (const e of errors) console.log(`  ${e}`)
} else {
  console.log('No page errors.')
}

await browser.close()

if (!leg1Ok || !leg2Ok || errors.length) process.exit(1)
