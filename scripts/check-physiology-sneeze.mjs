import { chromium } from 'playwright'

// Phase 4.2 sneeze-emote smoke test.
//
// Drives the worldspace cough/sneeze glyph through __uclife__ debug
// handles. No DOM clicks, no real-time waits, no canvas-pixel reads —
// the renderer mirrors its active-emote set into a deterministic
// `sneezeEmoteEntities()` readback that the smoke asserts against.
//
// Coverage:
//   - spawn an infectious NPC next to the player (already symptomatic)
//   - confirm the renderer picked them up (one entry in the glyph
//     layer's registry)
//   - confirm a non-symptomatic NPC does NOT appear in the registry

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
await page.waitForFunction(() => globalThis.__uclife__?.sneezeEmoteEntities !== undefined)
await page.waitForFunction(() => globalThis.__uclife__?.physiologySpawnInfectedNPC !== undefined)

// Pause the game so the active-zone RAF tick doesn't interleave with
// our setup. The render RAF still runs (rebuilds the snapshot), which
// is what we want — only the sim-time side is frozen.
await page.evaluate(() => { globalThis.__uclife__.useClock?.getState?.()?.setSpeed?.(0) })

// 1. Baseline: registry empty before any carrier exists.
const before = await page.evaluate(() => globalThis.__uclife__.sneezeEmoteEntities())
if (!Array.isArray(before)) fail('sneezeEmoteEntities did not return an array')
if (Array.isArray(before) && before.length !== 0) {
  fail(`expected empty registry pre-spawn, got ${before.length}: ${JSON.stringify(before)}`)
}

// 2. Spawn an infectious NPC. physiologySpawnInfectedNPC seats them in
// 'rising' phase (symptomatic), so the renderer should register them
// for the cough pulse on the next frame.
const carrier = await page.evaluate(() =>
  globalThis.__uclife__.physiologySpawnInfectedNPC('flu', '咳嗽李明', 0.5, 0),
)
if (!carrier?.key) fail('failed to spawn infectious carrier NPC')

// 3. Wait for the renderer to pick up the symptomatic NPC. The RAF
// loop rebuilds the snapshot ~60Hz; this resolves within a frame or
// two. No fixed-time sleep — we wait on the deterministic readback.
try {
  await page.waitForFunction(
    (k) => {
      const arr = globalThis.__uclife__?.sneezeEmoteEntities?.()
      return Array.isArray(arr) && arr.includes(k)
    },
    carrier.key,
    { timeout: 5000 },
  )
} catch {
  const seen = await page.evaluate(() => globalThis.__uclife__.sneezeEmoteEntities())
  fail(`renderer never registered carrier ${carrier?.key} for sneeze emote — saw: ${JSON.stringify(seen)}`)
}

// 4. The carrier must be the only entry (no spurious matches from
// background NPCs without a flu instance).
const after = await page.evaluate(() => globalThis.__uclife__.sneezeEmoteEntities())
if (Array.isArray(after) && after.length !== 1) {
  fail(`expected exactly one registered carrier, got ${after.length}: ${JSON.stringify(after)}`)
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
console.log(ok ? '\nOK: sneeze-emote smoke passed.' : '\nFAIL: sneeze-emote smoke failed.')
if (!ok) process.exitCode = 1

await browser.close()
