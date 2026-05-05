import { chromium } from 'playwright'

const url = 'http://localhost:5173/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}\n${e.stack ?? ''}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text())
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)

const dbgReady = await page.evaluate(() => !!globalThis.__uclife__)
if (!dbgReady) {
  console.error('FAIL: window.__uclife__ debug handle missing.')
  process.exit(1)
}

await page.click('text=4×').catch(() => {})

async function snapshotNPCs() {
  return await page.evaluate(() => {
    const w = globalThis.__uclife__.world
    const clock = globalThis.__uclife__.useClock.getState().gameDate
    const out = []
    const dbg = globalThis.__uclife__
    if (!dbg.snapshotNPCs) return { clock: clock.toISOString(), npcs: [] }
    return { clock: clock.toISOString(), npcs: dbg.snapshotNPCs(w) }
  })
}

await page.evaluate(async () => {
  const { world } = globalThis.__uclife__
  const npcMod = await import('/src/ecs/traits/index.ts')
  const { NPCInfo, Position, Action, Vitals } = npcMod
  globalThis.__uclife__.snapshotNPCs = (w) => {
    const arr = []
    for (const e of w.query(NPCInfo, Position, Action, Vitals)) {
      const info = e.get(NPCInfo)
      const pos = e.get(Position)
      const act = e.get(Action)
      const vit = e.get(Vitals)
      arr.push({
        name: info.name,
        role: info.title ?? '',
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        kind: act.kind,
        fatigue: Math.round(vit.fatigue),
      })
    }
    return arr
  }
  void world
})

// 90 real-sec at 4× = 360 game-min = 6 game-hours. Engineer fatigue 20→~57,
// laborer 50→~88 (>70 → should be heading home/sleeping by the end).
const samples = []
for (let i = 0; i < 7; i++) {
  await page.waitForTimeout(15_000)
  samples.push(await snapshotNPCs())
}

const last = samples[samples.length - 1]
console.log('Final clock:', last.clock)
console.log('Final NPC state:')
for (const n of last.npcs) {
  console.log(`  ${n.name.padEnd(8)} role=${n.role.padEnd(9)} kind=${n.kind.padEnd(8)} fatigue=${String(n.fatigue).padStart(3)} pos=(${n.x},${n.y})`)
}

const failures = []

const sawExhausted = samples.some((s) => s.npcs.some((n) => n.fatigue >= 70))
if (!sawExhausted) failures.push('No NPC ever became exhausted (fatigue ≥ 70) during soak.')

const sawSleeping = samples.some((s) => s.npcs.some((n) => n.kind === 'sleeping'))
if (!sawSleeping) failures.push('No NPC ever entered the sleeping action during soak.')

const sawWorking = samples.some((s) => s.npcs.some((n) => n.kind === 'working'))
if (!sawWorking) failures.push('No NPC ever entered the working action during soak.')

if (errors.length) {
  console.log('--- RUNTIME ERRORS ---')
  errors.forEach((e) => console.log(e))
  failures.push(`${errors.length} runtime error(s)`)
}

if (failures.length) {
  console.log('\nFAIL:')
  failures.forEach((f) => console.log('  - ' + f))
  process.exitCode = 1
} else {
  console.log('\nPASS — utility AI + BT firing as expected.')
}

await browser.close()
