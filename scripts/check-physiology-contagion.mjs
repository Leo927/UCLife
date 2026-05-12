import { chromium } from 'playwright'

// Phase 4.2 flu contagion smoke test.
//
// Drives an SIR transmission end-to-end through __uclife__ debug
// handles. No DOM clicks, no real-time waits — every step is a
// deterministic call into the sim layer.
//
// Coverage:
//   - spawn an infectious NPC half a tile from the player (inside flu's
//     1.5-tile contactRadius)
//   - advance Active set + contagion ticks
//   - verify player catches flu (source string names the carrier)
//   - verify flu's symptomatic-rising band emits a workPerfMul drop
//
// Reliability bar (CLAUDE.md): no setTimeout polls, no DOM-text
// assertions on sprite content. Deterministic seeded contact rolls
// reproduce a hit well inside 200 ticks at 0.05 per-tick.

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

const failures = []
const fail = (msg) => failures.push(msg)

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => globalThis.__uclife__?.physiologySpawnInfectedNPC !== undefined)

// Pause the game so the active-zone RAF tick doesn't interleave.
await page.evaluate(() => { globalThis.__uclife__.useClock?.getState?.()?.setSpeed?.(0) })

// 1. Spawn an infectious NPC adjacent to the player.
const carrier = await page.evaluate(() =>
  globalThis.__uclife__.physiologySpawnInfectedNPC('flu', '李明', 0.5, 0),
)
if (!carrier?.key) fail('failed to spawn infected carrier NPC')
if (carrier?.templateId !== 'flu') fail(`spawned carrier had wrong templateId: ${carrier?.templateId}`)

// 2. Drive 200 contagion ticks. At transmissionRate 0.05, ~99.4% chance
//    of at least one transmission roll landing within 100 ticks; 200 is
//    well past that headroom under the deterministic seed.
const playerCond = await page.evaluate(() =>
  globalThis.__uclife__.physiologyContagionStep(200),
)
if (!Array.isArray(playerCond)) {
  fail('physiologyContagionStep did not return a conditions array')
} else {
  const flu = playerCond.find((c) => c.templateId === 'flu')
  if (!flu) fail('player did not catch flu after 200 contagion ticks')
  else {
    if (typeof flu.source !== 'string' || !flu.source.includes('李明')) {
      fail(`flu.source should name the carrier 李明, got: ${flu.source}`)
    }
    if (!flu.source.includes('流感')) {
      fail(`flu.source should name the condition 流感, got: ${flu.source}`)
    }
  }
}

// 3. Carrier's instance still exists and is symptomatic.
const carrierCond = await page.evaluate(
  (k) => globalThis.__uclife__.getNpcConditionsByKey(k),
  carrier?.key,
)
if (!Array.isArray(carrierCond)) {
  fail('failed to fetch carrier conditions by key')
} else {
  const carrierFlu = carrierCond.find((c) => c.templateId === 'flu')
  if (!carrierFlu) fail('carrier no longer carries flu')
  else if (carrierFlu.phase === 'incubating') {
    fail('carrier still in incubating after force-advance to rising')
  }
}

// 4. Advance the player's phase machine a couple of days so flu reaches
//    rising/peak and the [20,100] band emits its modifiers.
const afterDays = await page.evaluate(() => globalThis.__uclife__.physiologyTickDay(3))
if (!Array.isArray(afterDays)) fail('physiologyTickDay did not return an array')
else {
  const flu = afterDays.find((c) => c.templateId === 'flu')
  if (!flu) {
    // Could have resolved if the seed happens to roll a 1-day incubation
    // + fast recovery — but that's vanishingly unlikely with flu's
    // [55,75] peak. Treat as a failure to keep the signal loud.
    fail('player flu disappeared after 3 days — expected to still be in arc')
  } else if (flu.phase === 'incubating' || flu.phase === 'rising' || flu.phase === 'peak' || flu.phase === 'recovering' || flu.phase === 'stalled') {
    const wpm = await page.evaluate(() => globalThis.__uclife__.getPlayerStatValue('workPerfMul'))
    if (flu.severity >= 20 && typeof wpm === 'number' && wpm >= 1) {
      fail(`workPerfMul should be reduced by flu band at severity ${flu.severity}, got ${wpm}`)
    }
  }
}

if (errors.length) {
  console.log('\nERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}
if (failures.length) {
  console.log('\nFAILURES:')
  failures.forEach((f) => console.log('  ' + f))
}

const ok = failures.length === 0 && errors.length === 0
console.log(ok ? '\nOK: flu contagion passed.' : '\nFAIL: flu contagion checks failed.')
if (!ok) process.exitCode = 1

await browser.close()
