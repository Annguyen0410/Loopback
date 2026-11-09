'use strict';

/**
 * Architecture guardrails.
 *
 * These are intentionally static: they catch a broken split or a packaging
 * regression without starting Electron. Runtime behaviour is covered by the
 * unit suites and the E2E runner.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const exists = rel => fs.existsSync(path.join(ROOT, rel));
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the automation source lives under src/automation and has clear layers', () => {
  for (const rel of [
    'src/automation/main/bootstrap.ts',
    'src/automation/main/ipc.ts',
    'src/automation/preload/index.ts',
    'src/automation/renderer/src/App.tsx',
    'src/automation/shared/ipc-channels.ts',
    'src/automation/shared/types.ts'
  ]) {
    assert.equal(exists(rel), true, rel);
  }
});

test('the host only loads the built automation bundle, not a second app', () => {
  const host = read('src/main/automation-host.js');
  assert.match(host, /automation-main['", ]+bootstrap\.cjs/);
  assert.doesNotMatch(host, /TaskOrbit\/main\.js|opencode-automation-hub\/main\.js/);
  assert.match(read('automation.html'), /automation-ui\/assets\//);
  assert.doesNotMatch(read('automation.html'), /https?:\/\//);
});

test('the shared pure helpers are importable without a DOM', () => {
  assert.equal(exists('src/shared/text.mjs'), true);
  const utils = read('src/renderer/utils.js');
  assert.match(utils, /from "\.\.\/shared\/text\.mjs"/);
  assert.doesNotMatch(utils, /export function (fold|foldMap|plainText|bytes)\b/);
});

test('unit and E2E commands are separate and the combined command is explicit', () => {
  assert.match(pkg.scripts.test, /test:unit/);
  assert.match(pkg.scripts['test:unit'], /node --test/);
  assert.equal(pkg.scripts['test:e2e'], 'node scripts/run-e2e.mjs');
  assert.match(pkg.scripts['test:all'], /test:unit/);
  assert.match(pkg.scripts['test:all'], /typecheck:automation/);
  assert.match(pkg.scripts['test:all'], /test:e2e/);
});

test('the packaged app contains runtime automation bundles but not build-only source', () => {
  const files = pkg.build.files;
  assert.ok(files.includes('automation-main/**/*'));
  assert.ok(files.includes('automation-ui/**/*'));
  assert.ok(files.includes('!src/automation/**/*'));
  assert.ok(!files.some(entry => entry.startsWith('.backup')));
});

test('the final Windows artifact is the installer, not the self-extracting portable', () => {
  assert.deepEqual(pkg.build.win.target, ['nsis']);
  assert.equal('portable' in pkg.build, false);
});

test('the test documentation and architecture map are part of the repository', () => {
  assert.equal(exists('tests/README.md'), true);
  assert.equal(exists('docs/ARCHITECTURE.md'), true);
});

test('the test runner declares every root E2E suite exactly once', () => {
  const runner = read('scripts/run-e2e.mjs');
  for (const file of ['audittest.js', 'piptest.js', 'captest.js', 'reviewtest.js', 'combotest.js', 'automation-app-smoke.cjs']) {
    assert.equal((runner.match(new RegExp(file.replace(/[.]/g, '\\.'), 'g')) || []).length, 1, file);
  }
});
