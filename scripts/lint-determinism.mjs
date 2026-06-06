// Determinism gate: forbids Math.random() in the seeded sim layers.
//
// "Same seed + fixture -> same world" is a hard contract (CLAUDE.md). The
// layer-boundary lint (dependency-cruiser) catches bad *imports* but cannot
// see API calls, so a stray Math.random() inside the tick/spawn path slips
// through silently and only surfaces as a flaky smoke test. This script
// converts that failure mode from "discovered via flake" to "fails at PR".
//
// Sim layers must route randomness through the seeded RNGs instead:
//   - src/sim/rng.ts  getSimRng()        (runtime sim singleton)
//   - src/procgen/rng.ts  SeededRng       (per-pass procgen / spawn)
// Math.random() is allowed only in src/render/ (cosmetic, non-sim) and tests.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const GUARDED_DIRS = ['src/sim', 'src/ai', 'src/systems', 'src/ecs']
const FORBIDDEN = /Math\.random\s*\(/
const IS_TS = /\.tsx?$/
const IS_TEST = /\.test\.tsx?$/

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (IS_TS.test(entry) && !IS_TEST.test(entry)) yield full
  }
}

const offenders = []
for (const guarded of GUARDED_DIRS) {
  for (const file of walk(join(repoRoot, guarded))) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (FORBIDDEN.test(line)) {
        offenders.push(`${relative(repoRoot, file).replace(/\\/g, '/')}:${i + 1}: ${line.trim()}`)
      }
    })
  }
}

if (offenders.length > 0) {
  console.error(
    `\nDeterminism gate failed: Math.random() found in seeded sim layers.\n` +
    `Route randomness through getSimRng() (src/sim/rng.ts) or a threaded ` +
    `SeededRng (src/procgen/rng.ts) instead.\n`,
  )
  for (const o of offenders) console.error(`  ${o}`)
  console.error('')
  process.exit(1)
}

console.log(`Determinism gate passed: no Math.random() in ${GUARDED_DIRS.join(', ')}.`)
