// Two-leg flight smoke. Drives through __uclife__ + uclifeUI:
// open flight modal → click 购票 → wait on transition.inProgress flipping
// false → assert active scene + player landed at the registered arrival
// pixel for the destination hub. No dynamic /src imports, no fixed sleeps.

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
await mkdir('scripts/out', { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await ctx.newPage()

const errors = []
const failures = []
page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof globalThis.__uclife__?.cheatMoney === 'function'
    && typeof globalThis.__uclife__?.listAirports === 'function'
    && typeof globalThis.__uclife__?.playerSnapshot === 'function'
    && typeof globalThis.__uclife__?.useScene?.getState === 'function'
    && typeof globalThis.__uclife__?.useTransition?.getState === 'function'
    && typeof globalThis.uclifeUI?.getState === 'function',
  null,
  { timeout: 30_000 },
)

const initialScene = await page.evaluate(() => globalThis.__uclife__.useScene.getState().activeId)
console.log('Initial active scene:', initialScene)

const airports = await page.evaluate(() => globalThis.__uclife__.listAirports())
const expectedArrival = Object.fromEntries(
  airports.filter((a) => a.placement).map((a) => [a.hubId, a.placement.arrivalPx]),
)
const zumArrival = expectedArrival.zumCityAirport
const startArrival = expectedArrival.vonBraunCityAirport
if (!zumArrival || !startArrival) {
  console.log('FAIL · missing airport placement(s):', expectedArrival)
  await browser.close()
  process.exit(1)
}

await page.evaluate(() => globalThis.__uclife__.cheatMoney(2000))

async function flyVia(fromHubId, expectedSceneId, expectedArrivalPx, label) {
  await page.evaluate((hubId) => globalThis.uclifeUI.getState().openFlight(hubId), fromHubId)
  await page.waitForSelector('.transit-terminal-go', { state: 'visible' })

  const btnText = await page.locator('.transit-terminal-go').first().textContent()
  console.log(`${label} buy button:`, btnText)
  if (btnText !== '购票') {
    failures.push(`${label}: expected buy button '购票', got '${btnText}'`)
    return
  }

  await page.click('.transit-terminal-go')

  // The transition animates over ~560ms real time, but instead of waiting on
  // the wall clock we wait on the actual signal: useTransition.inProgress
  // flips false once the in-fade finishes, and useScene.activeId already
  // flipped at midpoint.
  await page.waitForFunction(
    (sceneId) => {
      const u = globalThis.__uclife__
      return u.useTransition.getState().inProgress === false
        && u.useScene.getState().activeId === sceneId
    },
    expectedSceneId,
    { timeout: 5000 },
  )

  const after = await page.evaluate(() => ({
    activeId: globalThis.__uclife__.useScene.getState().activeId,
    player: globalThis.__uclife__.playerSnapshot(),
  }))
  console.log(`${label}:`, after, 'expected arrival:', expectedArrivalPx)
  const ok = after.activeId === expectedSceneId
    && after.player?.pos.x === expectedArrivalPx.x
    && after.player?.pos.y === expectedArrivalPx.y
  if (ok) console.log(`PASS · ${label}`)
  else failures.push(`${label}: scene=${after.activeId}, pos=${JSON.stringify(after.player?.pos)}`)

  await page.screenshot({ path: `scripts/out/scene-swap-${expectedSceneId}.png`, fullPage: false })
}

await flyVia('vonBraunCityAirport', 'zumCity', zumArrival, 'leg 1 (vonBraunCity → zumCity)')
await flyVia('zumCityAirport', 'vonBraunCity', startArrival, 'leg 2 (zumCity → vonBraunCity)')

if (errors.length) {
  console.log('PAGE ERRORS:')
  for (const e of errors) console.log(`  ${e}`)
}

await browser.close()

if (failures.length || errors.length) {
  console.log(`\nFAILED · ${failures.length} assertion(s), ${errors.length} page error(s)`)
  process.exit(1)
}
console.log('\nOK · scene-swap round-trip passed')
