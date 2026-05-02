#!/usr/bin/env node
// Run the same smoke-test commands CI runs, locally.
//
// Source of truth: .github/workflows/ci.yml — we parse the `test` job's `run:`
// steps and execute each one, mirroring CI's `if: always()` (every step runs
// even if a previous step failed). A final summary lists pass/fail per step.
//
// Requires the dev server on http://localhost:5173 (run `npm run dev` in
// another terminal) — same constraint the individual scripts have.

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const ciPath = join(repoRoot, '.github/workflows/ci.yml');
const devServerUrl = 'http://localhost:5173';

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

async function isServerUp(url) {
  try {
    await fetch(url, { method: 'GET' });
    return true;
  } catch {
    return false;
  }
}

function run(cmd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
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

  if (!(await isServerUp(devServerUrl))) {
    console.error(
      `[ci-local] dev server is not running at ${devServerUrl}.\n` +
        `           start it in another terminal: npm run dev`,
    );
    process.exit(1);
  }

  console.log(`[ci-local] running ${commands.length} smoke-test step(s) from ci.yml\n`);

  const results = [];
  for (const cmd of commands) {
    console.log(`\n=== ${cmd} ===`);
    const code = await run(cmd);
    results.push({ cmd, code });
  }

  console.log('\n=== Summary ===');
  for (const r of results) console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.cmd}`);
  const failed = results.filter((r) => r.code !== 0).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
