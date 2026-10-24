'use strict';

// The rule that makes an upgrade safe: a verified copy exists before the only copy of the notes is touched.
// Run: npm test

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrate, backupDataFiles, isCurrentShape, CURRENT_SCHEMA } = require('../src/main/store-migrations.js');

const scratchDirs = [];
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopback-migrate-'));
  scratchDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratchDirs) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
});

const WHEN = new Date(2026, 9, 23, 15, 4, 5);

test('a legacy folder is copied first, verified, then migrated and marked', () => {
  const dir = scratch();
  const legacy = JSON.stringify({ messages: [{ id: 'm1', text: 'years of notes' }] });
  fs.writeFileSync(path.join(dir, 'messages.json'), legacy);
  fs.writeFileSync(path.join(dir, 'settings.json'), '{"darkMode":true}');

  const result = migrate(dir, { appVersion: '1.5.8', now: WHEN });
  assert.equal(result.migrated, true);
  assert.equal(result.schema, CURRENT_SCHEMA);
  assert.ok(fs.existsSync(result.backupDir), 'a backup folder exists');

  // The original bytes are still there in the backup — that is what makes this reversible.
  assert.equal(fs.readFileSync(path.join(result.backupDir, 'messages.json'), 'utf8'), legacy);
  assert.equal(fs.readFileSync(path.join(result.backupDir, 'settings.json'), 'utf8'), '{"darkMode":true}');

  const migrated = JSON.parse(fs.readFileSync(path.join(dir, 'messages.json'), 'utf8'));
  assert.equal(migrated.messages[0].id, 'm1');
  assert.deepEqual(migrated.chats, []);
  assert.equal(isCurrentShape(migrated), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).schema, CURRENT_SCHEMA);
});

test('running it again changes nothing and makes no second backup', () => {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, 'messages.json'), JSON.stringify({ messages: [] }));
  migrate(dir, { appVersion: 'a', now: WHEN });
  const backupsAfterFirst = fs.readdirSync(path.join(dir, 'backups')).length;
  const before = fs.readFileSync(path.join(dir, 'messages.json'), 'utf8');
  const second = migrate(dir, { appVersion: 'a', now: new Date(WHEN.getTime() + 3600000) });
  assert.equal(second.migrated, false);
  assert.equal(fs.readFileSync(path.join(dir, 'messages.json'), 'utf8'), before);
  assert.equal(fs.readdirSync(path.join(dir, 'backups')).length, backupsAfterFirst);
});

test('an unreadable file is left for the store\'s .bak recovery, not replaced with an empty chat', () => {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, 'messages.json'), '{ torn');
  assert.throws(() => migrate(dir, { appVersion: 'a', now: WHEN }), /store-unreadable/);
  assert.equal(fs.readFileSync(path.join(dir, 'messages.json'), 'utf8'), '{ torn');
});

test('a backup that cannot be verified aborts the migration with the original untouched', () => {
  const dir = scratch();
  const original = JSON.stringify({ messages: [{ id: 'm1' }] });
  fs.writeFileSync(path.join(dir, 'messages.json'), original);

  assert.throws(() => backupDataFiles(dir, {
    stamp: 'test',
    copy: () => { /* pretend the disk filled: nothing was written */ }
  }));
  assert.equal(fs.readFileSync(path.join(dir, 'messages.json'), 'utf8'), original);

  assert.throws(() => backupDataFiles(dir, {
    stamp: 'test2',
    copy: (src, dest) => fs.writeFileSync(dest, '{"cut":')
  }), /backup-verify/);
  assert.equal(fs.readFileSync(path.join(dir, 'messages.json'), 'utf8'), original);
});

test('a folder with no data file is simply initialised', () => {
  const dir = scratch();
  const result = migrate(dir, { appVersion: 'a', now: WHEN });
  assert.equal(result.migrated, true);
  assert.equal(result.backupDir, null);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'messages.json'), 'utf8')), { chats: [], messages: [] });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).schema, CURRENT_SCHEMA);
});
