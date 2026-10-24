'use strict';

// The rule that keeps a crash from emptying the chat or the settings — see src/main/atomic-write.js.
// Run: npm test

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const atomic = require('../src/main/atomic-write.js');

const scratchDirs = [];

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopback-atomic-'));
  scratchDirs.push(dir);
  return dir;
}

// The suite does not leave its scratch folders behind: a test that fills %TEMP% with directories is the
// same kind of mess the portable janitor exists to clean out of the app itself.
after(() => {
  for (const dir of scratchDirs) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
});

test('a save replaces the file and keeps the previous version beside it', () => {
  const dir = scratch();
  const file = path.join(dir, 'messages.json');
  assert.equal(atomic.writeFileAtomicSync(file, JSON.stringify({ messages: [{ id: 1 }] })), true);
  assert.equal(atomic.writeFileAtomicSync(file, JSON.stringify({ messages: [{ id: 1 }, { id: 2 }] })), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).messages.length, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')).messages.length, 1);
});

test('no temporary file is left behind by a save', () => {
  const dir = scratch();
  const file = path.join(dir, 'settings.json');
  atomic.writeFileAtomicSync(file, '{"darkMode":true}');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['settings.json']);
});

test('a torn file is recovered from the backup, and the torn file is replaced', () => {
  const dir = scratch();
  const file = path.join(dir, 'messages.json');
  atomic.writeFileAtomicSync(file, JSON.stringify({ messages: ['first'] }));
  atomic.writeFileAtomicSync(file, JSON.stringify({ messages: ['first', 'second'] }));
  // The interrupted save: the live file ends up as half a JSON document.
  fs.writeFileSync(file, '{"messages":["first","sec');
  const value = atomic.readJsonSync(file, { messages: [] });
  assert.deepEqual(value, { messages: ['first'] });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { messages: ['first'] });
});

test('a first run reads the fallback rather than throwing on a missing file', () => {
  const dir = scratch();
  const file = path.join(dir, 'nothing-here.json');
  assert.deepEqual(atomic.readJsonSync(file, { messages: [] }), { messages: [] });
});

test('a file and its backup both unreadable still answers the fallback instead of throwing', () => {
  const dir = scratch();
  const file = path.join(dir, 'messages.json');
  fs.writeFileSync(file, 'not json at all');
  fs.writeFileSync(`${file}.bak`, '');
  assert.deepEqual(atomic.readJsonSync(file, { messages: [] }), { messages: [] });
});
