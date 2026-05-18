// Phase 4 smoke. Verifies the ?test=1 boot path lands a working
// runtime + debug-handle surface and the sim clock is frozen.
//
//   1. __uclife_test__.step is a function — the sole wait primitive.
//   2. __uclife__.getGameState is a function — Phase 5 stub still wires it.
//   3. __uclife__.getEntityScreenCoords is a function — world→screen bridge.
//   4. __uclife__.pendingAssetJobs() === 0 — asset pipelines never started.
//   5. step({ gameMinutes: 1 }) advances simNow by exactly 60_000 ms.

import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })

// Boot-existence one-shot — allowed by CLAUDE.md smoke rules
// ("for the boot-readiness check, wait for __uclife_test__ to exist via
// a one-shot waitForFunction"). Sim state is NOT polled this way; that
// would loop forever under the frozen clock.
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.getGameState === 'function'
    && typeof window.__uclife__?.getEntityScreenCoords === 'function'
    && typeof window.__uclife__?.pendingAssetJobs === 'function',
  null,
  { timeout: 30_000 },
)

const failures = []

// 1. Asset pipelines never started — skipAssets default-on.
const pendingJobs = await page.evaluate(() => window.__uclife__.pendingAssetJobs())
if (pendingJobs !== 0) {
  failures.push(`__uclife__.pendingAssetJobs() = ${pendingJobs}, want 0 (asset pipelines started in test mode)`)
}

// 2. Surface diagnostics for the runtime namespace.
const surface = await page.evaluate(() => ({
  hasStep: typeof window.__uclife_test__?.step === 'function',
  hasGetGameState: typeof window.__uclife__?.getGameState === 'function',
  hasGetEntityScreenCoords: typeof window.__uclife__?.getEntityScreenCoords === 'function',
  hasAwaitAssetsReady: typeof window.__uclife__?.awaitAssetsReady === 'function',
}))
if (!surface.hasStep) failures.push('__uclife_test__.step missing')
if (!surface.hasGetGameState) failures.push('__uclife__.getGameState missing')
if (!surface.hasGetEntityScreenCoords) failures.push('__uclife__.getEntityScreenCoords missing')
if (!surface.hasAwaitAssetsReady) failures.push('__uclife__.awaitAssetsReady missing')

// 3. step({ gameMinutes: 1 }) advances simNow by exactly 60_000 ms.
//    Drives the sole wait primitive end-to-end through the Playwright
//    bridge — if the step() Promise never resolves, page.evaluate
//    rejects, and we fail loud.
const advanceResult = await page.evaluate(async () => {
  // Read simNow before via the shim. The handle doesn't expose it
  // directly today, so reach through the prod sim/time export via the
  // global koota world's tracked clock — useClock.gameDate.getTime().
  // The relationship simNow ↔ useClock isn't 1:1, but stepping advances
  // BOTH in lockstep (advanceSimByGameMs in src/test/clock.ts). The
  // useClock side is the one observable through __uclife__.
  const clockBefore = window.__uclife__.useClock.getState().gameDate.getTime()
  await window.__uclife_test__.step({ gameMinutes: 1 })
  const clockAfter = window.__uclife__.useClock.getState().gameDate.getTime()
  return { before: clockBefore, after: clockAfter, delta: clockAfter - clockBefore }
})

const MS_PER_MINUTE = 60_000
if (advanceResult.delta !== MS_PER_MINUTE) {
  failures.push(
    `step({ gameMinutes: 1 }) advanced clock by ${advanceResult.delta} ms, want exactly ${MS_PER_MINUTE} ` +
    `(before=${advanceResult.before}, after=${advanceResult.after})`,
  )
}

if (failures.length || errors.length) {
  console.log('\nFAIL — check-test-boot:')
  for (const f of failures) console.log('  -', f)
  if (errors.length) {
    console.log('\npage errors / console.error:')
    for (const e of errors) console.log('  -', e)
  }
  console.log('\nsurface =', JSON.stringify(surface, null, 2))
  console.log('advanceResult =', JSON.stringify(advanceResult, null, 2))
  process.exitCode = 1
} else {
  console.log('OK — check-test-boot:')
  console.log(`  __uclife_test__.step          : present`)
  console.log(`  __uclife__.getGameState        : present`)
  console.log(`  __uclife__.getEntityScreenCoords: present`)
  console.log(`  __uclife__.pendingAssetJobs()  : 0`)
  console.log(`  step({ gameMinutes: 1 }) Δclock : ${advanceResult.delta} ms`)
}

await browser.close()
