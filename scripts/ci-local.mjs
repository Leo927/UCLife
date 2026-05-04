#!/usr/bin/env node
// Standalone CI runner — spawns its own Vite dev server on an ephemeral port,
// runs the smoke-test commands listed in .github/workflows/ci.yml against it,
// and tears the server down on exit. No external dev server required.
//
// Source of truth for the suite is .github/workflows/ci.yml — we parse the
// `test` job's `run:` steps and execute each one, mirroring CI's
// `if: always()` (every step runs even if a previous step failed). The bound
// URL is forwarded to each child via UCLIFE_BASE_URL.
//
// Flags:
//   --workers N        run up to N steps concurrently against the same server
//                      (default 1). All steps share one Vite server; Playwright
//                      contexts are isolated per-launch so cross-step state
//                      doesn't leak.
//
// Concurrency note: each `ci:local` invocation binds its own ephemeral port,
// so multiple invocations (e.g. parallel subagent runs) coexist fine.

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer as createViteServer } from 'vite';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const ciPath = join(repoRoot, '.github/workflows/ci.yml');

function parseArgs(argv) {
  const out = { workers: 1 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--workers') {
      out.workers = Math.max(1, parseInt(argv[++i] ?? '1', 10) || 1);
    } else if (a.startsWith('--workers=')) {
      out.workers = Math.max(1, parseInt(a.slice('--workers='.length), 10) || 1);
    }
  }
  return out;
}

function extractTestCommands() {
  const text = readFileSync(ciPath, 'utf8');
  const cmds = [];
  let inTestJob = false;
  for (const line of text.split(/\r?\n/)) {
    const jobMatch = line.match(/^ {2}([A-Za-z_][\w-]*):\s*$/);
    if (jobMatch) {
      inTestJob = jobMatch[1] === 'test';
      continue;
    }
    if (!inTestJob) continue;
    const runMatch = line.match(/^\s+(?:-\s+)?run:\s+(.+?)\s*$/);
    if (!runMatch) continue;
    const cmd = runMatch[1];
    // Match `node ... scripts/foo.mjs` or `npx tsx ... scripts/foo.ts`,
    // tolerating intervening flags like `--import ./scripts/loader.mjs`.
    if (/^(?:node|npx tsx)\b.*\bscripts\/[\w.-]+\.(?:mjs|ts|js)\b/.test(cmd)) cmds.push(cmd);
  }
  return cmds;
}

function findDuplicates(cmds) {
  const seen = new Map();
  const dupes = [];
  for (const c of cmds) seen.set(c, (seen.get(c) ?? 0) + 1);
  for (const [c, n] of seen) if (n > 1) dupes.push({ cmd: c, count: n });
  return dupes;
}

function run(cmd, env, label) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true, env });
    child.on('close', (code) => {
      if (label) console.log(`[ci-local] ${label} exited ${code ?? 1}`);
      resolve(code ?? 1);
    });
  });
}

// Vite's config-merge collapses `port: 0` to undefined (probably a `||` on the
// numeric port somewhere), letting the user-config `port: 5173` win. Work
// around it by pre-binding a kernel-assigned ephemeral port ourselves and
// passing the explicit number into Vite. strictPort: false provides a backup
// if the OS reassigns the port between close() and Vite's bind.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      probe.close(() => (port ? resolve(port) : reject(new Error('no port'))));
    });
  });
}

async function startVite() {
  const port = await findFreePort();
  const server = await createViteServer({
    root: repoRoot,
    configFile: join(repoRoot, 'vite.config.ts'),
    server: { port, strictPort: false, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await server.listen();
  const addr = server.httpServer?.address();
  if (!addr || typeof addr !== 'object') {
    await server.close();
    throw new Error('failed to determine bound port');
  }
  return { server, port: addr.port };
}

async function main() {
  const args = parseArgs(process.argv);
  const commands = extractTestCommands();
  if (commands.length === 0) {
    console.error('[ci-local] no smoke-test commands found in ci.yml — did the workflow change?');
    process.exit(1);
  }
  const dupes = findDuplicates(commands);
  if (dupes.length > 0) {
    console.error('[ci-local] duplicate smoke-test step(s) in ci.yml:');
    for (const d of dupes) console.error(`           ${d.count}× ${d.cmd}`);
    console.error('           remove the duplicates from .github/workflows/ci.yml.');
    process.exit(1);
  }

  console.log('[ci-local] starting Vite dev server on ephemeral port…');
  const { server, port } = await startVite();
  const baseUrl = `http://127.0.0.1:${port}/`;
  console.log(`[ci-local] dev server ready at ${baseUrl}`);

  let signalCleanup = false;
  const onSignal = async (sig) => {
    if (signalCleanup) return;
    signalCleanup = true;
    console.log(`\n[ci-local] received ${sig}, shutting down…`);
    try { await server.close(); } catch {}
    process.exit(sig === 'SIGINT' ? 130 : 143);
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  const childEnv = { ...process.env, UCLIFE_BASE_URL: baseUrl };
  let exitCode = 1;

  try {
    console.log(`[ci-local] running ${commands.length} smoke-test step(s) (workers=${args.workers})`);
    const results = new Array(commands.length);

    if (args.workers === 1) {
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        console.log(`\n=== ${cmd} ===`);
        const code = await run(cmd, childEnv);
        results[i] = { cmd, code };
      }
    } else {
      // Pull-based worker pool: each worker grabs the next index until exhausted.
      let next = 0;
      const worker = async (wid) => {
        while (true) {
          const i = next++;
          if (i >= commands.length) return;
          const cmd = commands[i];
          console.log(`[ci-local] [w${wid}] start: ${cmd}`);
          const code = await run(cmd, childEnv, `[w${wid}] ${cmd}`);
          results[i] = { cmd, code };
        }
      };
      const n = Math.min(args.workers, commands.length);
      await Promise.all(Array.from({ length: n }, (_, k) => worker(k + 1)));
    }

    console.log('\n=== Summary ===');
    for (const r of results) console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.cmd}`);
    const failed = results.filter((r) => r.code !== 0).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    exitCode = failed === 0 ? 0 : 1;
  } finally {
    try { await server.close(); } catch {}
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
