'use strict'

/**
 * Read-only proof against the real %APPDATA%\TaskOrbit source.
 * Copies into a temporary target, so the live automation vault is untouched.
 * Run: npx electron scripts/real-migration-probe.cjs
 */

const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

app.whenReady().then(async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'loopback-real-migration-'))
  let failures = 0
  try {
    const migration = require('../src/main/automation-migrate.js')
    const result = await migration.migrateIfNeeded(target)
    console.log('RESULT', JSON.stringify(result))
    if (result.migrated) {
      console.log('COUNTS', JSON.stringify(migration.countRows(path.join(target, 'vault.db'))))
      console.log('KEY_COPIED', fs.existsSync(path.join(target, 'vault.key')))
      const marker = JSON.parse(fs.readFileSync(path.join(target, 'migration.json'), 'utf8'))
      console.log('MARKER_OK', marker.ok, 'WARNING', marker.warning || 'none')
    } else {
      console.log('SKIPPED', result.reason)
    }
  } catch (err) {
    failures++
    console.error('FAIL', err && err.stack ? err.stack : err)
  } finally {
    try { fs.rmSync(target, { recursive: true, force: true }) } catch { /* ignore */ }
    console.log(failures === 0 ? 'REAL_MIGRATION_PROBE_DONE' : 'REAL_MIGRATION_PROBE_FAIL')
    app.exit(failures === 0 ? 0 : 1)
  }
})
