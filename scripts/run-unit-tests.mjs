#!/usr/bin/env node
// Thin wrapper that spawns `vitest run`. Exists because ci-local.mjs's parser
// (scripts/ci-local.mjs:59) matches steps of the form
// `node|npx tsx ... scripts/*.{mjs,ts}` — naming this script makes the unit-
// test step discoverable to the regression runner without modifying the
// parser. Forwards extra argv to vitest so per-file runs work locally.

import { spawn } from 'node:child_process';

// Match scripts/ci-local.mjs:74 — single-string command with shell:true
// avoids node 22's DEP0190 (array-args + shell:true) and works cross-platform
// (npx is a .cmd shim on Windows).
const extra = process.argv.slice(2).map((a) => JSON.stringify(a)).join(' ');
const cmd = `npx vitest run${extra ? ' ' + extra : ''}`;
const child = spawn(cmd, { stdio: 'inherit', shell: true });
child.on('close', (code) => process.exit(code ?? 1));
