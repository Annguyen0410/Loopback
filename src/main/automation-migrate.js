'use strict';

/**
 * One-time copy of TaskOrbit data into `<userData>/automation`.
 *
 * Rules that matter more than the copy itself:
 *   • the source is opened read-only and copied with SQLite's `.backup()`
 *     (WAL included) — never by copying three files by hand;
 *   • `vault.key` and `vault.db` travel together, or not at all;
 *   • an existing destination is never overwritten;
 *   • the source is never deleted or modified;
 *   • the result is recorded in `migration.json` so a retry cannot silently
 *     replace a vault the user has since been using.
 */

const path = require('node:path');
const fs = require('node:fs');

const SOURCE_CANDIDATES = ['TaskOrbit', 'opencode-automation-hub'];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
  } catch { /* best effort */ }
}

function findSource(appData) {
  for (const name of SOURCE_CANDIDATES) {
    const dir = path.join(appData, name);
    const db = path.join(dir, 'vault.db');
    if (fs.existsSync(db)) return { name, dir, db, key: path.join(dir, 'vault.key') };
  }
  return null;
}

function countRows(dbPath) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { return null; }
  let db = null;
  const counts = {};
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    for (const table of ['providers', 'credentials', 'notifications', 'kv_config', 'post_history']) {
      try {
        counts[table] = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
      } catch { /* table absent in that schema */ }
    }
    return counts;
  } catch {
    return null;
  } finally {
    try { if (db) db.close(); } catch { /* ignore */ }
  }
}

/**
 * Verify that the copied master key can still be decrypted by this Windows
 * user. DPAPI keys do not survive a different user/machine; failing here is
 * better than handing the user a vault that silently cannot decrypt.
 */
function keyDecryptable(keyPath) {
  try {
    if (!fs.existsSync(keyPath)) return { ok: true, present: false };
    const { safeStorage } = require('electron');
    if (!safeStorage.isEncryptionAvailable()) return { ok: true, present: true, warning: 'safeStorage-unavailable' };
    const stored = fs.readFileSync(keyPath);
    safeStorage.decryptString(stored);
    return { ok: true, present: true };
  } catch (err) {
    return { ok: false, present: true, error: String((err && err.message) || err) };
  }
}

async function migrateIfNeeded(targetDir) {
  const marker = path.join(targetDir, 'migration.json');
  const targetDb = path.join(targetDir, 'vault.db');
  const targetKey = path.join(targetDir, 'vault.key');

  const previous = readJson(marker);
  if (previous && previous.ok) return { migrated: false, reason: 'already-migrated', marker: previous };

  if (fs.existsSync(targetDb)) {
    // An existing vault with real content is the user's current data. Never
    // replace it. An empty scaffold, however, is what bootstrap creates when
    // an earlier attempt was skipped (source busy, or unusable key) — keep it
    // out of the way so the import can retry on a later launch.
    const existing = countRows(targetDb);
    const userRows = existing
      ? (existing.providers || 0) + (existing.credentials || 0) + (existing.notifications || 0) + (existing.post_history || 0)
      : null;
    if (userRows === null || userRows > 0) return { migrated: false, reason: 'target-exists' };

    const backupDir = path.join(targetDir, 'backups', 'pre-migration');
    try {
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(targetDb, path.join(backupDir, 'vault.db'));
      if (fs.existsSync(targetKey)) fs.copyFileSync(targetKey, path.join(backupDir, 'vault.key'));
    } catch (err) {
      return { migrated: false, reason: 'backup-failed', error: String((err && err.message) || err) };
    }
    for (const file of [targetDb, `${targetDb}-wal`, `${targetDb}-shm`, targetKey]) {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* retryable next launch */ }
    }
  }

  const appData = path.join(require('electron').app.getPath('appData'));
  const source = findSource(appData);
  if (!source) return { migrated: false, reason: 'no-source' };

  // WAL files growing under us would mean the old app is actively writing.
  const wal = `${source.db}-wal`;
  if (fs.existsSync(wal)) {
    try {
      const ageMs = Date.now() - fs.statSync(wal).mtimeMs;
      if (ageMs < 30_000) {
        writeJson(marker, {
          ok: false,
          reason: 'source-busy',
          source: source.dir,
          at: new Date().toISOString(),
          note: 'TaskOrbit looked like it was still writing. Quit it and restart Loopback to migrate; nothing was copied.'
        });
        return { migrated: false, reason: 'source-busy' };
      }
    } catch { /* ignore */ }
  }

  const sourceCounts = countRows(source.db);
  const keyCheck = keyDecryptable(source.key);
  // A key we cannot read only blocks the copy when there are secrets that
  // depend on it. With zero credentials the DB is still useful (notifications,
  // settings), and the new vault will generate its own key on first use.
  const noCredentials = !!sourceCounts && (sourceCounts.credentials || 0) === 0;
  if (!keyCheck.ok && !noCredentials) {
    writeJson(marker, {
      ok: false,
      reason: 'key-undecryptable',
      source: source.dir,
      at: new Date().toISOString(),
      error: keyCheck.error,
      note: 'vault.key cannot be decrypted by this Windows user. Nothing was copied. Export the vault with a passphrase in TaskOrbit, then import it in Automation → Vault.'
    });
    return { migrated: false, reason: 'key-undecryptable' };
  }

  fs.mkdirSync(targetDir, { recursive: true });
  let DatabaseSync;
  let backupSqlite;
  try {
    ({ DatabaseSync, backup: backupSqlite } = require('node:sqlite'));
  } catch (err) {
    writeJson(marker, { ok: false, reason: 'sqlite-unavailable', at: new Date().toISOString(), error: String(err) });
    return { migrated: false, reason: 'sqlite-unavailable' };
  }

  let db = null;
  try {
    db = new DatabaseSync(source.db, { readOnly: true });
    await backupSqlite(db, targetDb);
    db.close();
    db = null;

    if (keyCheck.ok && keyCheck.present && fs.existsSync(source.key)) {
      fs.copyFileSync(source.key, targetKey);
    }

    const targetCounts = countRows(targetDb);
    const matches = !!sourceCounts && !!targetCounts &&
      Object.keys(sourceCounts).every(table => sourceCounts[table] === targetCounts[table]);

    const markerValue = {
      ok: matches,
      source: source.dir,
      sourceName: source.name,
      at: new Date().toISOString(),
      counts: targetCounts,
      sourceCounts,
      keyCopied: keyCheck.ok && keyCheck.present,
      ...(keyCheck.warning ? { warning: keyCheck.warning } : {}),
      ...(!keyCheck.ok ? { warning: 'key-undecryptable-but-no-credentials', newKeyGenerated: true } : {}),
      note: 'Source left untouched. Browser profiles were not copied (large, opt-in); point check-ins at a new profile or copy them manually.'
    };
    writeJson(marker, markerValue);
    if (matches) return { migrated: true, source: source.dir, counts: targetCounts };
    return { migrated: false, reason: 'count-mismatch', marker: markerValue };
  } catch (err) {
    try { if (db) db.close(); } catch { /* ignore */ }
    // A half-written destination would block the next attempt forever. It is
    // our own file (the target did not exist before this call), so removing it
    // is safe; the source is untouched.
    for (const file of [targetDb, `${targetDb}-wal`, `${targetDb}-shm`]) {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* ignore */ }
    }
    writeJson(marker, {
      ok: false,
      reason: 'copy-failed',
      source: source.dir,
      at: new Date().toISOString(),
      error: String((err && err.message) || err)
    });
    return { migrated: false, reason: 'copy-failed', error: String((err && err.message) || err) };
  }
}

module.exports = { migrateIfNeeded, findSource, countRows, keyDecryptable };
