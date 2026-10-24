'use strict';

/**
 * Versioned, backed-up migration of the data folder.
 *
 * `messages.json` has been written by five app versions with three different shapes (a flat array, a single
 * chat with no `chats`, and the current multi-chat shape). Until now nothing recorded which shape a folder was
 * in, and nothing was backed up before the app read it. A migration that goes wrong on the only copy of years
 * of notes is unrecoverable, so this module follows one rule above all others:
 *
 *   the copy is made and verified BEFORE the original is touched, and only then is a normalised file written.
 *
 * A second run is a no-op (the schema marker matches and the files validate), so a crash halfway through a
 * migration is safe to retry. The original is never deleted; the backup stays in `backups/<stamp>/`.
 */

const fs = require('node:fs');
const path = require('node:path');
const atomic = require('./atomic-write.js');
const { normalize } = require('./store.js');

/** Bumped only when the shape of something on disk changes in a way a reader has to know about. */
const CURRENT_SCHEMA = 2;

const FILES = ['messages.json', 'settings.json', 'quick.json', 'pip.json'];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}

/** True when the store file is already the current shape and needs no rewrite. */
function isCurrentShape(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
  if (!Array.isArray(doc.messages) || !Array.isArray(doc.chats)) return false;
  if (!doc.messages.every(m => m && typeof m === 'object' && typeof m.id === 'string')) return false;
  if (!doc.chats.every(c => c && typeof c === 'object' && typeof c.id === 'string')) return false;
  return true;
}

/**
 * Copies the data files into `backups/<stamp>/` and proves every copy is readable and the same size as its
 * source. Returns the backup folder. Throws — and therefore leaves the originals untouched — when a copy
 * cannot be verified.
 */
function backupDataFiles(userDataDir, { stamp, copy = fs.copyFileSync } = {}) {
  const dest = path.join(userDataDir, 'backups', stamp);
  fs.mkdirSync(dest, { recursive: true });
  for (const name of FILES) {
    const src = path.join(userDataDir, name);
    if (!fs.existsSync(src)) continue;
    const out = path.join(dest, name);
    copy(src, out);
    const a = fs.statSync(src);
    const b = fs.statSync(out);
    if (!b || b.size !== a.size) throw new Error('backup-verify-size:' + name);
    if (name.endsWith('.json') && readJson(out) === undefined && fs.statSync(src).size > 0) {
      throw new Error('backup-verify-json:' + name);
    }
  }
  return dest;
}

/**
 * Reads the data folder, backs it up when it needs work, and writes back the current shape plus a schema
 * marker. Returns `{ migrated, backupDir, schema, messages }`.
 */
function migrate(userDataDir, { appVersion = '', now = new Date() } = {}) {
  const metaFile = path.join(userDataDir, 'meta.json');
  const dataFile = path.join(userDataDir, 'messages.json');
  const meta = readJson(metaFile);
  const before = fs.existsSync(dataFile) ? readJson(dataFile) : { messages: [] };
  const shapeOk = isCurrentShape(before);
  const schemaOk = meta && Number(meta.schema) >= CURRENT_SCHEMA;
  if (shapeOk && schemaOk) {
    return { migrated: false, backupDir: null, schema: Number(meta.schema), messages: before.messages.length };
  }
  if (fs.existsSync(dataFile) && before === undefined) {
    // Unreadable JSON: atomic.readJsonSync in the store already knows how to recover from `.bak`. A migration
    // must not "fix" a corrupt file by replacing it with an empty one, so it refuses and leaves recovery to
    // the reader, which is the only code that has a verified backup to fall back to.
    throw new Error('store-unreadable');
  }

  let backupDir = null;
  if (fs.existsSync(dataFile) || FILES.some(name => fs.existsSync(path.join(userDataDir, name)))) {
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    backupDir = backupDataFiles(userDataDir, { stamp });
  }

  const normalized = normalize(before || { messages: [] });
  atomic.writeFileAtomicSync(dataFile, JSON.stringify(normalized));
  atomic.writeFileAtomicSync(metaFile, JSON.stringify({
    schema: CURRENT_SCHEMA,
    appVersion: String(appVersion || ''),
    migratedAt: now.toISOString()
  }, null, 2));
  return { migrated: true, backupDir, schema: CURRENT_SCHEMA, messages: normalized.messages.length };
}

module.exports = { CURRENT_SCHEMA, migrate, backupDataFiles, isCurrentShape, FILES };
