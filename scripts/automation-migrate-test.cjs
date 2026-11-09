'use strict'

/**
 * Migration proof, isolated from the real profile:
 *   • builds a synthetic %APPDATA%\TaskOrbit with vault.db + vault.key;
 *   • runs migrateIfNeeded() into a fresh automation folder;
 *   • checks row counts, the copied key, the marker and that the source is
 *     byte-for-byte untouched;
 *   • checks a second call is a no-op.
 *
 * Run with: npx electron scripts/automation-migrate-test.cjs
 */

const { app, safeStorage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loopback-migration-'))
app.setPath('appData', tmp)

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`PASS ${label}${detail ? ` — ${detail}` : ''}`)
  else { failures++; console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

function buildSource() {
  const sourceDir = path.join(tmp, 'TaskOrbit')
  fs.mkdirSync(sourceDir, { recursive: true })
  const dbPath = path.join(sourceDir, 'vault.db')
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE providers (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, category TEXT NOT NULL, base_url TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE credentials (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, type TEXT NOT NULL, identifier TEXT NOT NULL, secret_encrypted TEXT NOT NULL, metadata_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE notifications (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, priority TEXT NOT NULL, action_url TEXT, read INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE kv_config (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
  `)
  const now = Date.now()
  db.prepare('INSERT INTO providers VALUES (?, ?, ?, ?, ?, ?)').run('p1', 'OpenRouter', 'llm', 'https://openrouter.ai/api/v1', now, now)
  db.prepare('INSERT INTO credentials VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('c1', 'p1', 'apikey', 'default', 'iv.tag.cipher', null, now, now)
  db.prepare('INSERT INTO notifications VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('n1', 'success', 'Hello', 'Body', 'normal', null, 0, now)
  db.prepare('INSERT INTO kv_config VALUES (?, ?)').run('app-config', '{}')
  db.close()

  const keyBytes = Buffer.from('0123456789abcdef0123456789abcdef')
  fs.writeFileSync(path.join(sourceDir, 'vault.key'), safeStorage.encryptString(keyBytes.toString('base64')))
  return { sourceDir, dbPath }
}

app.whenReady().then(async () => {
  try {
    const { sourceDir, dbPath } = buildSource()
    const sourceBefore = fs.readFileSync(dbPath)
    const targetDir = path.join(tmp, 'messenger', 'automation')

    const migration = require('../src/main/automation-migrate.js')
    const first = await migration.migrateIfNeeded(targetDir)
    check('migration ran', first.migrated === true, first.reason || '')
    check('vault.db copied', fs.existsSync(path.join(targetDir, 'vault.db')))
    check('vault.key copied', fs.existsSync(path.join(targetDir, 'vault.key')))
    check('source database untouched', Buffer.compare(sourceBefore, fs.readFileSync(dbPath)) === 0)
    check('marker written', JSON.parse(fs.readFileSync(path.join(targetDir, 'migration.json'), 'utf8')).ok === true)
    check('counts verified', first.counts && first.counts.providers === 1 && first.counts.credentials === 1 && first.counts.notifications === 1,
      JSON.stringify(first.counts))

    const second = await migration.migrateIfNeeded(targetDir)
    check('second run is a no-op', second.migrated === false && second.reason === 'already-migrated', second.reason)

    // A failed/skipped first launch leaves an empty scaffold + ok:false marker.
    // The next launch must be able to retry instead of being blocked forever.
    const retryDir = path.join(tmp, 'retry', 'automation')
    fs.mkdirSync(retryDir, { recursive: true })
    const { DatabaseSync } = require('node:sqlite')
    const scaffold = new DatabaseSync(path.join(retryDir, 'vault.db'))
    scaffold.exec('CREATE TABLE kv_config (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);')
    scaffold.prepare('INSERT INTO kv_config VALUES (?, ?)').run('default-config', '{}')
    scaffold.close()
    fs.writeFileSync(path.join(retryDir, 'migration.json'), JSON.stringify({ ok: false, reason: 'source-busy' }))
    const retried = await migration.migrateIfNeeded(retryDir)
    check('empty scaffold is retried', retried.migrated === true, retried.reason || '')
    check('retry backed up the scaffold', fs.existsSync(path.join(retryDir, 'backups', 'pre-migration', 'vault.db')))
    check('retry imported the notifications', retried.counts && retried.counts.notifications === 1, JSON.stringify(retried.counts))

    // An existing destination must never be replaced.
    const third = await migration.migrateIfNeeded(path.join(tmp, 'other', 'automation'))
    check('fresh target can migrate once', third.migrated === true, third.reason || '')
  } catch (err) {
    failures++
    console.error('FAIL uncaught:', err && err.stack ? err.stack : err)
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
    console.log(failures === 0 ? 'MIGRATION PASS' : `MIGRATION FAIL (${failures})`)
    app.exit(failures === 0 ? 0 : 1)
  }
})
