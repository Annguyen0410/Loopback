'use strict';

// The rule that stops two windows (and a quick note) from overwriting each other.
// Run: npm test

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../src/main/store.js');

const scratchDirs = [];
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopback-store-'));
  scratchDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratchDirs) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
});

const doc = (messages = []) => ({
  chats: [{ id: 'c1', name: 'Notes to Self', pinned: true }],
  messages,
  activeChatId: 'c1'
});
const message = (id, text) => ({ id, chatId: 'c1', text, files: [], createdAt: 1 });

test('a save lands on disk, bumps the revision and never writes __rev into the file', async () => {
  const file = path.join(scratch(), 'messages.json');
  const store = createStore({ file });
  const loaded = store.load();
  assert.equal(loaded.__rev, 0);
  assert.deepEqual(loaded.messages, []);

  const result = await store.saveFromRenderer({ ...doc([message('m1', 'hello')]), __rev: 0 });
  assert.deepEqual(result, { ok: true, rev: 1 });
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.messages.length, 1);
  assert.equal('__rev' in onDisk, false);
  assert.equal(store.load().__rev, 1);
});

test('a stale window cannot drop a quick note captured while it was hidden', async () => {
  const file = path.join(scratch(), 'messages.json');
  const store = createStore({ file });
  await store.saveFromRenderer({ ...doc([message('m1', 'first')]), __rev: 0 }); // rev 1

  // The quick note is captured in main while the chat window still holds rev 1.
  const note = message('quick1', 'captured while hidden');
  await store.appendMessage(note); // rev 2
  assert.equal(store.read().messages.length, 2);

  // A stale full-state save arrives from that window: it has never seen quick1.
  const stale = await store.saveFromRenderer({ ...doc([message('m1', 'first')]), __rev: 1 });
  assert.equal(stale.ok, true);
  const ids = store.read().messages.map(m => m.id);
  assert.deepEqual(ids.sort(), ['m1', 'quick1'], 'the quick note survives a stale save');

  // The same save from an up-to-date window (note present) must not duplicate it.
  await store.saveFromRenderer({ ...doc([message('m1', 'first'), note]), __rev: store.rev() });
  assert.equal(store.read().messages.filter(m => m.id === 'quick1').length, 1);
});

test('a quick note can seed the first chat on a brand-new profile', async () => {
  const file = path.join(scratch(), 'messages.json');
  const store = createStore({ file });
  const chat = { id: 'seed', name: 'Notes to Self', pinned: true };
  await store.appendMessage({ ...message('n1', 'one'), chatId: 'seed' }, { chat });
  assert.equal(store.read().chats[0].id, 'seed');
  assert.equal(store.read().messages[0].id, 'n1');
});

test('a document past the size cap is refused and the old file is left alone', async () => {
  const file = path.join(scratch(), 'messages.json');
  const store = createStore({ file, maxBytes: 400 });
  await store.saveFromRenderer({ ...doc([message('m1', 'x')]), __rev: 0 });
  const before = fs.readFileSync(file, 'utf8');
  const huge = await store.saveFromRenderer({ ...doc([message('m2', 'y'.repeat(2000))]), __rev: store.rev() });
  assert.deepEqual(huge, { ok: false, error: 'too-large' });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(store.read().messages.length, 1, 'the in-memory document did not grow either');
});

test('two rapid saves are serialised and the last document wins', async () => {
  const file = path.join(scratch(), 'messages.json');
  const store = createStore({ file });
  const a = store.saveFromRenderer({ ...doc([message('a', 'A')]), __rev: 0 });
  const b = store.saveFromRenderer({ ...doc([message('b', 'B')]), __rev: 1 });
  await Promise.all([a, b]);
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(onDisk.messages.map(m => m.id), ['b']);
});

test('a failed disk write reaches the caller instead of looking like a save', async () => {
  const file = path.join(scratch(), 'messages.json');
  const store = createStore({ file, write: async () => { throw new Error('disk full'); } });
  const saved = await store.saveFromRenderer({ ...doc([message('m1', 'x')]), __rev: 0 });
  assert.equal(saved.ok, false);
  assert.equal(saved.error, 'write-failed');

  const note = await store.appendMessage(message('q1', 'quick'));
  assert.equal(note.ok, false);
  assert.equal(store.read().messages.some(m => m.id === 'q1'), false,
    'a note that could not be written is not left half-added in memory');
});

test('an unreadable file is copied aside instead of being replaced by an empty chat', () => {
  const dir = scratch();
  const file = path.join(dir, 'messages.json');
  fs.writeFileSync(file, '{ torn beyond the backup too');
  const store = createStore({ file });
  assert.deepEqual(store.read().messages, []);
  const kept = fs.readdirSync(dir).filter(n => n.startsWith('messages.unreadable-'));
  assert.equal(kept.length, 1, 'the unreadable bytes were kept for recovery');
  assert.match(fs.readFileSync(path.join(dir, kept[0]), 'utf8'), /torn beyond/);
});

test('a legacy message without an id is kept and repaired, not dropped', async () => {
  const file = path.join(scratch(), 'messages.json');
  fs.writeFileSync(file, JSON.stringify({ messages: [{ text: 'old note', chatId: 'c1' }], chats: [{ name: 'old' }] }));
  const store = createStore({ file });
  assert.equal(store.read().messages.length, 1);
  assert.equal(store.read().messages[0].text, 'old note');
  assert.equal(typeof store.read().messages[0].id, 'string');
  assert.equal(store.read().chats.length, 1);
  assert.equal(typeof store.read().chats[0].id, 'string');
});

test('a nonsense payload is refused rather than written', async () => {
  const file = path.join(scratch(), 'messages.json');
  const store = createStore({ file });
  assert.deepEqual(await store.saveFromRenderer(null), { ok: false, error: 'bad-document' });
  assert.deepEqual(await store.saveFromRenderer('text'), { ok: false, error: 'bad-document' });
  assert.deepEqual(await store.saveFromRenderer([1, 2]), { ok: false, error: 'bad-document' });
});

test('the reader recovers a torn file from the previous version instead of starting empty', async () => {
  const dir = scratch();
  const file = path.join(dir, 'messages.json');
  const store = createStore({ file });
  await store.saveFromRenderer({ ...doc([message('m1', 'kept')]), __rev: 0 });
  await store.saveFromRenderer({ ...doc([message('m1', 'kept'), message('m2', 'newer')]), __rev: 1 });
  assert.equal(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')).messages.length, 1);

  // The crash the atomic writer is meant to prevent: the live file is torn.
  fs.writeFileSync(file, '{ broken');
  const recovered = createStore({ file });
  assert.deepEqual(recovered.read().messages.map(m => m.id), ['m1']);
  // …and the good version is put back, so the next read needs no recovery.
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).messages[0].id, 'm1');
});
