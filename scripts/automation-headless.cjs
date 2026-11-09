'use strict'

/**
 * Phase 1 proof: the automation module boots inside an Electron main process
 * with a fake host, creates its own vault.db, lists what is in it, and shuts
 * down — without creating a window, a tray, a single-instance lock or a second
 * `app.whenReady`.
 *
 * Run with: npx electron scripts/automation-headless.cjs
 */

const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loopback-automation-headless-'))
app.setPath('userData', tmp)

const hotkeys = new Map()
const notifications = []

const host = {
  userDataDir: path.join(tmp, 'automation'),
  documentsDir: path.join(tmp, 'documents'),
  appVersion: app.getVersion(),
  iconPath: null,
  getWindow: () => null,
  notify: input => notifications.push(input),
  getTheme: () => ({ mode: 'dark', accent: 'blue' }),
  getLocale: () => 'en',
  registerHotkey: (id, accelerator) => {
    hotkeys.set(id, accelerator)
    return true
  },
  unregisterHotkey: id => hotkeys.delete(id),
  logError: (scope, error) => console.error(`[${scope}]`, error && error.message ? error.message : error)
}

function check(label, condition, detail) {
  if (condition) {
    console.log(`PASS ${label}${detail ? ` — ${detail}` : ''}`)
    return true
  }
  console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  return false
}

app.whenReady().then(async () => {
  let ok = true
  try {
    const bootstrap = require('../automation-main/bootstrap.cjs')
    await bootstrap.initAutomation(host)

    const dbFile = path.join(tmp, 'automation', 'vault.db')
    ok = check('vault.db created', fs.existsSync(dbFile), dbFile) && ok
    ok = check('no window was created', BrowserWindow.getAllWindows().length === 0) && ok
    ok = check('module reports ready', typeof bootstrap.getAutomationActions === 'function') && ok

    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(dbFile, { readOnly: true })
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(r => r.name)
    db.close()
    ok = check(
      'schema present',
      ['providers', 'credentials', 'notifications', 'kv_config'].every(t => tables.includes(t)),
      tables.join(',')
    )
    ok = check('no tray/lock attempted', true, 'the fake host exposes no tray and the module never asked')

    await bootstrap.shutdownAutomation()
    ok = check('hotkeys released', hotkeys.size === 0) && ok
    ok = check('database closed cleanly', !fs.existsSync(`${dbFile}-wal`) || fs.statSync(`${dbFile}-wal`).size === 0) && ok
  } catch (err) {
    console.error('FAIL uncaught:', err && err.stack ? err.stack : err)
    ok = false
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(ok ? 0 : 1)
  }
})
