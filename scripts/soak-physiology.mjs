// One-off soak harness for the two physiology smoke tests. Reuses the
// ci-local warmup pattern (in-process Vite transformRequest) so the
// dev server is fully pre-bundled before the first navigation, then
// runs check-physiology-cold + check-physiology-multi N times in
// sequence against the same warm server.
//
// Usage:  node scripts/soak-physiology.mjs [N=20]

import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer as createNetServer } from 'node:net'
import { createServer as createViteServer } from 'vite'

void readFileSync  // satisfy used-but-unused if linted
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const N = parseInt(process.argv[2] ?? '20', 10) || 20

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

function run(cmd, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd: repoRoot, stdio: 'pipe', shell: true, env })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('close', (code) => resolve({ code: code ?? 1, out }))
  })
}

const port = await findFreePort()
const cacheDir = mkdtempSync(join(tmpdir(), 'uclife-vite-soak-'))
const server = await createViteServer({
  root: repoRoot,
  configFile: join(repoRoot, 'vite.config.ts'),
  cacheDir,
  server: { port, strictPort: false, host: '127.0.0.1' },
  logLevel: 'error',
})
await server.listen()
const addr = server.httpServer?.address()
const realPort = typeof addr === 'object' && addr ? addr.port : port
const url = `http://127.0.0.1:${realPort}/`
console.log(`[soak] dev server up at ${url}, warming pre-bundle…`)
try { await server.transformRequest('/src/main.tsx') } catch { /* best-effort */ }
console.log('[soak] dev server ready')

const env = { ...process.env, UCLIFE_BASE_URL: url }
let pass = 0, fail = 0, failIters = []
for (let i = 1; i <= N; i++) {
  const r1 = await run('node scripts/check-physiology-cold.mjs', env)
  const r2 = await run('node scripts/check-physiology-multi.mjs', env)
  if (r1.code === 0 && r2.code === 0) {
    pass++
    console.log(`iter ${i}: PASS`)
  } else {
    fail++
    failIters.push(i)
    console.log(`iter ${i}: FAIL (cold=${r1.code}, multi=${r2.code})`)
    if (r1.code !== 0) console.log(`  cold tail:  ${r1.out.split('\n').slice(-6).join('\n  ')}`)
    if (r2.code !== 0) console.log(`  multi tail: ${r2.out.split('\n').slice(-6).join('\n  ')}`)
  }
}

await server.close()
rmSync(cacheDir, { recursive: true, force: true })
console.log(`\n=== summary: ${pass}/${N} pass, ${fail} fail (failed iters: ${failIters.join(',') || 'none'}) ===`)
process.exit(fail === 0 ? 0 : 1)
