#!/usr/bin/env node
// Local smoke / e2e runner. Spawns an ephemeral Vite dev server, points
// Playwright Test at it, then runs the headless survive sim against the
// same Vite. Designed to mirror what `.github/workflows/ci.yml` runs.
//
// Test discovery is owned by Playwright Test (`tests/smoke/*.spec.ts`).
// This script intentionally has no knowledge of which tests exist — adding
// a new test is `tests/smoke/<name>.spec.ts`, no edit here, no edit in ci.yml.
//
// Flags:
//   --workers N        Playwright Test worker count (default: Playwright's auto).
//   --skip-survive     Skip the long-running `scripts/survive.ts` post-step.
//   <playwright-args>  Anything after `--` is forwarded to `playwright test`.
//
// Concurrency: each `ci:local` invocation binds its own ephemeral port,
// so parallel runs (e.g. sibling worktrees) coexist fine.

import { mkdtempSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer as createViteServer } from 'vite'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const out = { workers: null, skipSurvive: false, passthrough: [] }
  let inPassthrough = false
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (inPassthrough) { out.passthrough.push(a); continue }
    if (a === '--') { inPassthrough = true; continue }
    if (a === '--workers') {
      out.workers = Math.max(1, parseInt(argv[++i] ?? '1', 10) || 1)
    } else if (a.startsWith('--workers=')) {
      out.workers = Math.max(1, parseInt(a.slice('--workers='.length), 10) || 1)
    } else if (a === '--skip-survive') {
      out.skipSurvive = true
    } else {
      // Unknown flags become playwright passthrough so callers can do
      //   npm run ci:local -- --grep portrait
      out.passthrough.push(a)
    }
  }
  return out
}

function run(cmd, args, env) {
  return new Promise((resolve) => {
    // shell:true joins args by spaces, which breaks regex metacharacters
    // (|, ?, *, parens). Quote each arg defensively so shell parses it as
    // one token. Cross-platform: POSIX shells respect single quotes;
    // Windows cmd.exe needs double quotes.
    const quote = process.platform === 'win32'
      ? (s) => `"${String(s).replace(/"/g, '\\"')}"`
      : (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
    const cmdline = [cmd, ...args.map(quote)].join(' ')
    const child = spawn(cmdline, { cwd: repoRoot, stdio: 'inherit', shell: true, env })
    child.on('close', (code) => resolve(code ?? 1))
  })
}

// Vite's config-merge collapses `port: 0` to undefined, so we pre-bind the
// kernel-assigned ephemeral port ourselves and pass the explicit number.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.unref()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address()
      const port = typeof addr === 'object' && addr ? addr.port : null
      probe.close(() => (port ? resolve(port) : reject(new Error('no port'))))
    })
  })
}

// Force Vite to finish pre-bundling deps before the first child check runs.
// Each ci:local invocation gets its own (empty) cacheDir, so Vite would
// otherwise pre-bundle on the first request — which Playwright's default
// 30s navigation timeout often beats under multi-Vite CPU load (manifests
// as `page.goto: Timeout 30000ms exceeded` on the first 1-3 tests).
//
// We use Vite's in-process transformRequest() instead of spawning a warmup
// browser: it walks the same transform pipeline (which discovers deps and
// triggers the optimizer) without adding a chromium to the process count.
async function warmup(server) {
  for (const id of ['/src/main.tsx', '/src/bootProd.tsx', '/src/test/bootTestMode.ts']) {
    try {
      await server.transformRequest(id)
    } catch {
      // Pre-bundle errors here are non-fatal — child tests will surface
      // them with proper context. Warmup is best-effort.
    }
  }
}

async function startVite() {
  const port = await findFreePort()
  // Per-invocation cacheDir so concurrent Vite servers (e.g. an active
  // `npm run dev`, or a parallel ci:local from a sibling worktree) don't
  // thrash the shared `node_modules/.vite/deps/` pre-bundle.
  const cacheDir = mkdtempSync(join(tmpdir(), 'uclife-vite-'))
  const server = await createViteServer({
    root: repoRoot,
    configFile: join(repoRoot, 'vite.config.ts'),
    cacheDir,
    server: { port, strictPort: false, host: '127.0.0.1' },
    logLevel: 'warn',
  })
  await server.listen()
  const addr = server.httpServer?.address()
  if (!addr || typeof addr !== 'object') {
    await server.close()
    rmSync(cacheDir, { recursive: true, force: true })
    throw new Error('failed to determine bound port')
  }
  return { server, port: addr.port, cacheDir }
}

async function main() {
  const args = parseArgs(process.argv)

  console.log('[ci-local] starting Vite dev server on ephemeral port…')
  const { server, port, cacheDir } = await startVite()
  const baseUrl = `http://127.0.0.1:${port}/`
  console.log(`[ci-local] dev server up at ${baseUrl}, warming pre-bundle…`)
  await warmup(server)
  console.log('[ci-local] dev server ready')

  let signalCleanup = false
  const onSignal = async (sig) => {
    if (signalCleanup) return
    signalCleanup = true
    console.log(`\n[ci-local] received ${sig}, shutting down…`)
    try { await server.close() } catch {}
    rmSync(cacheDir, { recursive: true, force: true })
    process.exit(sig === 'SIGINT' ? 130 : 143)
  }
  process.on('SIGINT', () => onSignal('SIGINT'))
  process.on('SIGTERM', () => onSignal('SIGTERM'))

  const childEnv = { ...process.env, UCLIFE_BASE_URL: baseUrl }
  let exitCode = 1

  try {
    // 1. Playwright Test discovers + runs everything under tests/smoke/.
    // Two-pass split: known CPU/IO-heavy specs thrash when run concurrently
    // with other tests on a CI runner's limited (2-core) budget, so they get
    // a dedicated workers=1 pass with nothing else competing for the CPU.
    // Two distinct causes land in the same bucket because the mitigation
    // (drop worker parallelism to 1) is identical:
    //   - renderer-pixel tests (portrait*, sprite*): the shared Vite dev
    //     server serializes SVG/sprite reads, and concurrent chromium
    //     contexts racing for the same sprites starve composeSheet.
    //   - combat-withdraw / journey-first-sortie: sustained Pixi tactical-
    //     canvas rendering + live spaceSim ticking are CPU-bound; under
    //     2-worker parallel contention on a 2-core runner a real DOM click
    //     can starve past its actionability/actionTimeout window even
    //     though the target element already resolved as visible and stable
    //     (observed: CI run 28754499193 — both failures timed out inside
    //     Playwright's own post-actionability click/navigation-settle step,
    //     never in "waiting for element", so no app-side wait was missing).
    // Pass 1: everything EXCEPT the heavy bucket, in parallel.
    // Pass 2: the heavy bucket, workers=1.
    //
    // If --grep was passed in passthrough, the split is skipped and the
    // user's filter applies to a single pass.
    const HEAVY_SERIAL_FILTER = '(portrait|sprite|combat-withdraw|journey-first-sortie).*\\.spec\\.ts'
    const hasGrep = args.passthrough.some((a) => a === '--grep' || a.startsWith('--grep='))

    let pwCode = 0
    if (hasGrep) {
      const pwArgs = ['playwright', 'test']
      if (args.workers != null) pwArgs.push(`--workers=${args.workers}`)
      pwArgs.push(...args.passthrough)
      console.log(`\n[ci-local] running: npx ${pwArgs.join(' ')}`)
      pwCode = await run('npx', pwArgs, childEnv)
    } else {
      const dataWorkers = args.workers ?? (process.env.CI ? '2' : undefined)
      const dataArgs = ['playwright', 'test', `--grep-invert=${HEAVY_SERIAL_FILTER}`]
      if (dataWorkers != null) dataArgs.push(`--workers=${dataWorkers}`)
      dataArgs.push(...args.passthrough)
      console.log(`\n[ci-local] pass 1/2 (parallel, data): npx ${dataArgs.join(' ')}`)
      const dataCode = await run('npx', dataArgs, childEnv)

      const renderArgs = ['playwright', 'test', `--grep=${HEAVY_SERIAL_FILTER}`, '--workers=1']
      renderArgs.push(...args.passthrough)
      console.log(`\n[ci-local] pass 2/2 (serial, heavy): npx ${renderArgs.join(' ')}`)
      const renderCode = await run('npx', renderArgs, childEnv)

      pwCode = dataCode === 0 && renderCode === 0 ? 0 : 1
    }

    // 2. Headless survive sim — not a Playwright test (imports src/* directly).
    //    Run regardless of playwright outcome so we report both signals.
    let surviveCode = 0
    if (!args.skipSurvive) {
      console.log('\n[ci-local] running: npx tsx scripts/survive.ts')
      surviveCode = await run(
        'npx',
        ['tsx', '--import', './scripts/register-raw-loader.mjs', 'scripts/survive.ts'],
        childEnv,
      )
    } else {
      console.log('\n[ci-local] skipping survive.ts (--skip-survive)')
    }

    console.log('\n=== ci-local summary ===')
    console.log(`  playwright test : ${pwCode === 0 ? 'PASS' : 'FAIL'}`)
    if (!args.skipSurvive) console.log(`  survive.ts      : ${surviveCode === 0 ? 'PASS' : 'FAIL'}`)
    exitCode = pwCode === 0 && surviveCode === 0 ? 0 : 1
  } finally {
    try { await server.close() } catch {}
    rmSync(cacheDir, { recursive: true, force: true })
  }
  process.exit(exitCode)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
