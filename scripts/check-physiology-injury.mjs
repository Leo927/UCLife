import { chromium } from 'playwright'

// Phase 4.1 injury demo smoke test: "I sprained my ankle and limp until
// I get it splinted."
//
// All sim interactions go through __uclife__ debug handles per CLAUDE.md
// smoke-test rules — no DOM scraping, no real-time waits, deterministic
// per (entity, day, purpose) RNG.
//
// Coverage:
//   - body-part-scoped onset on a specific limb
//   - phase machine reaches rising/peak with walkingSpeed reduced
//   - untreated tier-1 injury stalls at peak (sprain requires pharmacy)
//   - commitTreatment(tier=1) flips stalled → recovering
//   - resolve clears the instance and restores walkingSpeed to 1

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
await page.waitForFunction(() => globalThis.__uclife__?.physiologyForceOnset !== undefined)

// Pause the game so day rollover can't fire from RAF.
await page.evaluate(() => { globalThis.__uclife__.useClock?.getState?.()?.setSpeed?.(0) })

// 1. Onset sprain on left-ankle.
const onset = await page.evaluate(() =>
  globalThis.__uclife__.physiologyForceOnset('sprain', '滑倒', 'left-ankle'),
)
if (!onset) fail('forceOnset returned null — sprain template missing or trait absent')
if (onset?.bodyPart !== 'left-ankle') fail(`expected bodyPart left-ankle, got ${onset?.bodyPart}`)
if (onset?.phase !== 'incubating') fail(`expected initial phase incubating, got ${onset?.phase}`)
const instanceId = onset?.instanceId

const baselineSpeed = await page.evaluate(() => globalThis.__uclife__.getPlayerStatValue('walkingSpeed'))
if (baselineSpeed !== 1) fail(`baseline walkingSpeed should be 1, got ${baselineSpeed}`)

// 2. Walk the symptomatic arc — sprain has incub [0,0], rise [1,1],
// peak [2,4]. Without treatment it should hit stalled by ~day 5.
let stalledSeen = false
let speedReducedAtPeak = null
for (let day = 1; day <= 8; day++) {
  const list = await page.evaluate(() => globalThis.__uclife__.physiologyTickDay(1))
  if (!Array.isArray(list)) { fail('physiologyTickDay did not return an array'); break }
  const inst = list.find((c) => c.instanceId === instanceId)
  if (!inst) { fail(`sprain instance vanished prematurely on day ${day}`); break }
  if (inst.phase === 'peak') {
    const wspeed = await page.evaluate(() => globalThis.__uclife__.getPlayerStatValue('walkingSpeed'))
    if (typeof wspeed === 'number' && wspeed >= 1) {
      fail(`walkingSpeed should be reduced at peak; got ${wspeed} at severity ${inst.severity}`)
    } else if (typeof wspeed === 'number') {
      speedReducedAtPeak = wspeed
    }
  }
  if (inst.phase === 'stalled') { stalledSeen = true; break }
}
if (!stalledSeen) fail('untreated sprain did not stall within 8 game-days')
if (speedReducedAtPeak === null) fail('did not observe reduced walkingSpeed during peak')

// 3. Treat it. Pharmacy tier — same level a First Aid splint would commit.
const treated = await page.evaluate((id) =>
  globalThis.__uclife__.physiologyCommitTreatment(id, 1, null),
  instanceId,
)
if (!treated) fail('commitTreatment(tier=1) did not land')

// 4. Walk the recovery arc. Resolution should land within ~20 days.
let resolved = false
for (let day = 1; day <= 30; day++) {
  const list = await page.evaluate(() => globalThis.__uclife__.physiologyTickDay(1))
  if (list.length === 0 || !list.some((c) => c.instanceId === instanceId)) {
    resolved = true
    break
  }
}
if (!resolved) fail('sprain did not resolve within 30 game-days post-treatment')

// 5. walkingSpeed back to baseline.
const speedAfter = await page.evaluate(() => globalThis.__uclife__.getPlayerStatValue('walkingSpeed'))
if (speedAfter !== 1) fail(`walkingSpeed should be 1 after resolve, got ${speedAfter}`)

// 6. No leftover condition Effects.
const effList = await page.evaluate(() => globalThis.__uclife__.getEffectsList())
const condEffects = (effList ?? []).filter((e) => e.family === 'condition' && e.id.includes(instanceId))
if (condEffects.length !== 0) {
  fail(`expected zero condition Effects for resolved sprain, got ${condEffects.length}: ${JSON.stringify(condEffects)}`)
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
console.log(ok ? '\nOK: sprain → limp → splint passed.' : '\nFAIL: sprain demo checks failed.')
if (!ok) process.exitCode = 1

await browser.close()
