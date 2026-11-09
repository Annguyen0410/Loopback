#!/usr/bin/env node
/**
 * E2E runner for the Electron suites.
 *
 * Each suite gets its own temporary profile so it cannot touch the real chat,
 * and runs sequentially because the apps compete for the same display, tray and
 * global hotkey. Logs are kept under .test-runs/ until the next run.
 *
 *   npm run test:e2e                 # all suites
 *   npm run test:e2e -- --only=audit,ui
 *   npm run test:e2e -- --list
 */

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON = require('electron');
const RUN_DIR = path.join(ROOT, '.test-runs');
const DEFAULT_TIMEOUT = 150_000;

/**
 * Keep this list explicit. A suite with no isolated profile is intentionally
 * marked `env: null`; those files create their own scratch profile.
 */
const SUITES = [
  { key: 'audit', file: 'audittest.js', env: 'AUDITTEST_USERDATA', timeout: 150_000 },
  { key: 'ui', file: 'uitest.js', env: 'UITEST_USERDATA', timeout: 120_000 },
  { key: 'pip', file: 'piptest.js', env: 'PIPTEST_USERDATA', timeout: 120_000 },
  { key: 'hud', file: 'hudtest.js', env: 'HUDTEST_USERDATA', timeout: 90_000 },
  { key: 'menu', file: 'menutest.js', env: 'MENUTEST_USERDATA', timeout: 120_000 },
  { key: 'capture', file: 'captest.js', env: 'CAPTEST_USERDATA', timeout: 120_000 },
  { key: 'record', file: 'rectest.js', env: 'RECTEST_USERDATA', timeout: 150_000 },
  { key: 'review', file: 'reviewtest.js', env: 'REVIEWTEST_USERDATA', timeout: 150_000 },
  { key: 'camera', file: 'camtest.js', env: 'CAMTEST_USERDATA', timeout: 180_000 },
  { key: 'combo', file: 'combotest.js', env: 'COMBOTEST_USERDATA', timeout: 180_000 },
  { key: 'search', file: 'searchtest.js', env: 'SEARCHTEST_USERDATA', timeout: 120_000 },
  { key: 'tray', file: 'traytest.js', env: 'TRAYTEST_USERDATA', timeout: 120_000 },
  { key: 'automation', file: 'tests/automation-app-smoke.cjs', env: null, timeout: 150_000 },
  { key: 'monitor', file: 'monitortest.js', env: null, timeout: 180_000 },
  { key: 'monitor-model', file: 'monitor-test.js', env: null, timeout: 120_000 },
  { key: 'layerbar', file: 'layerbar-test.js', env: null, timeout: 60_000 }
];

function usage() {
  console.log('Usage: npm run test:e2e -- [--only=key,key] [--list] [--timeout=ms]');
  console.log('Suites: ' + SUITES.map(s => s.key).join(', '));
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) { usage(); process.exit(0); }
if (args.includes('--list')) {
  for (const suite of SUITES) console.log(`${suite.key.padEnd(14)} ${suite.file}${suite.env ? '  [' + suite.env + ']' : ''}`);
  process.exit(0);
}

const onlyArg = args.find(arg => arg.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').map(s => s.trim()).filter(Boolean)) : null;
const timeoutArg = args.find(arg => arg.startsWith('--timeout='));
const timeoutOverride = timeoutArg ? Number(timeoutArg.slice('--timeout='.length)) : 0;
const selected = only ? SUITES.filter(suite => only.has(suite.key)) : SUITES;

if (!selected.length) {
  console.error('No suites selected. Use --list to see the keys.');
  process.exit(2);
}
if (!ELECTRON || !fs.existsSync(ELECTRON)) {
  console.error('Electron executable was not found. Run npm install first.');
  process.exit(2);
}

fs.mkdirSync(RUN_DIR, { recursive: true });
const started = Date.now();
const results = [];

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch { /* process already gone */ }
}

function runSuite(suite) {
  return new Promise(resolve => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), `loopback-e2e-${suite.key}-`));
    const logFile = path.join(RUN_DIR, `${suite.key}.log`);
    const log = fs.createWriteStream(logFile, { flags: 'w' });
    const env = { ...process.env };
    if (suite.env) env[suite.env] = profile;
    const timeout = timeoutOverride || suite.timeout || DEFAULT_TIMEOUT;

    log.write(`# ${suite.key}\n# command: ${ELECTRON} ${suite.file}\n# profile: ${suite.env ? profile : '(suite-owned)'}\n\n`);
    const child = spawn(ELECTRON, [suite.file], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false
    });
    const timer = setTimeout(() => {
      log.write(`\n# TIMEOUT after ${timeout}ms\n`);
      killTree(child.pid);
    }, timeout);

    child.stdout.on('data', chunk => log.write(chunk));
    child.stderr.on('data', chunk => log.write(chunk));
    child.on('error', error => {
      log.write(`\n# SPAWN ERROR: ${error.message}\n`);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      log.end(() => {
        let text = '';
        try { text = fs.readFileSync(logFile, 'utf8'); } catch { /* ignore */ }
        const passLines = (text.match(/^\s*PASS\b/gm) || []).length;
        const failLines = (text.match(/^\s*FAIL\b/gm) || []).length;
        const resultLine = (text.match(/^RESULT .*$/m) || [])[0] || '';
        const timedOut = /# TIMEOUT after/.test(text);
        const ok = !timedOut && code === 0 && !/RESULT FAIL/.test(resultLine) && failLines === 0;
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* suite may still hold files */ }
        resolve({ suite, ok, code, signal, timedOut, passLines, failLines, resultLine, logFile });
      });
    });
  });
}

for (const suite of selected) {
  console.log(`\n=== ${suite.key} (${suite.file}) ===`);
  const result = await runSuite(suite);
  results.push(result);
  const counts = `${result.passLines} PASS / ${result.failLines} FAIL`;
  if (result.ok) console.log(`PASS  ${suite.key}  ${counts}${result.resultLine ? '  ' + result.resultLine : ''}`);
  else console.log(`FAIL  ${suite.key}  ${counts}${result.resultLine ? '  ' + result.resultLine : ''}  exit=${result.code} signal=${result.signal || '-'}${result.timedOut ? ' timeout' : ''}\n      ${result.logFile}`);
}

const failed = results.filter(result => !result.ok);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${results.length - failed.length}/${results.length} E2E suites passed in ${elapsed}s.`);
if (failed.length) {
  console.log('Logs: ' + failed.map(result => result.logFile).join(', '));
  process.exit(1);
}
