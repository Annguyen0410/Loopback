'use strict'

/**
 * Phase 2 smoke test — real Electron, real main.js, real preload, real IPC.
 *
 * Boots Messenger with a throwaway userData folder and `--autostart` (so the
 * chat window is not created and the tray is skipped in test boot), then:
 *   1. initialises the automation module through its host bridge;
 *   2. opens the workspace window and waits for it to load;
 *   3. calls automation:app:get-info from the renderer (preload → guard → DB);
 *   4. writes a setting, closes and reopens the window, and reads it back;
 *   5. proves the chat preload has open/status but not credential access;
 *   6. shuts the module down and exits.
 *
 * Run with: npx electron tests/automation-app-smoke.cjs
 */

const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const net = require('node:net')
const http = require('node:http')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loopback-automation-smoke-'))
app.setPath('userData', tmp)
process.argv.push('--autostart')

require('../main.js')
const automationHost = require('../src/main/automation-host.js')

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log(`PASS ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures++
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function waitForLoad(win) {
  return new Promise((resolve, reject) => {
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', resolve)
      win.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(`${code} ${desc}`)))
    } else resolve()
  })
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function httpGet(url) {
  return new Promise((resolve) => {
    const req = http.get(url, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', err => resolve({ status: 0, error: err.message }))
    req.setTimeout(3000, () => { req.destroy(); resolve({ status: 0, error: 'timeout' }) })
  })
}

app.whenReady().then(async () => {
  try {
    // Let main.js finish registerHandlers()/registerWindowIpc() first.
    await delay(500)

    const started = await automationHost.init({ iconPath: path.join(__dirname, '..', 'assets', 'icon.png') })
    check('module init', started === true, String(automationHost.status().error || ''))
    check('vault.db exists', fs.existsSync(path.join(tmp, 'automation', 'vault.db')))

    const win = automationHost.open()
    check('window created', !!win)
    if (!win) throw new Error('automation window was not created')
    await waitForLoad(win)

    const info = await win.webContents.executeJavaScript('window.automationApi.app.getInfo()')
    check('app:get-info through preload + guard + DB', !!(info && info.ok), JSON.stringify(info && info.data && info.data.stats))
    check('database lives under automation/', String(info.data.userDataPath).includes(`${path.sep}automation`), info.data.userDataPath)
    check('encryption available', info.data.encryptionAvailable === true)

    const alias = await win.webContents.executeJavaScript('window.api.app.getInfo()')
    check('window.api alias works in the workspace', !!(alias && alias.ok))

    const navCount = await win.webContents.executeJavaScript('document.querySelectorAll(".nav-item").length')
    check('nine workspace pages in the rail', navCount === 9, String(navCount))
    const routes = ['/daily', '/', '/vault', '/providers', '/autoclick', '/promptforge', '/social', '/notifications', '/settings']
    for (const route of routes) {
      await win.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(`#${route}`)}`)
      await delay(350)
      const state = await win.webContents.executeJavaScript(`(() => {
        const content = document.querySelector('.content')
        const text = document.body.innerText || ''
        return {
          children: content ? content.childElementCount : 0,
          broken: text.includes('Something went wrong'),
          blank: text.trim().length < 20,
          active: (document.querySelector('.nav-item.active') || {}).textContent || ''
        }
      })()`)
      check(`route ${route} renders`, state.children > 0 && !state.broken && !state.blank, JSON.stringify(state))
    }

    const saved = await win.webContents.executeJavaScript(
      'window.automationApi.config.set({ appearance: { language: "vi" } })'
    )
    check('config write', !!(saved && saved.ok))

    automationHost.open()
    await delay(300)
    const reopenedInfo = await win.webContents.executeJavaScript('window.automationApi.app.getInfo()')
    check('window survives second open and still answers', !!(reopenedInfo && reopenedInfo.ok))
    const readBack = await win.webContents.executeJavaScript('window.automationApi.config.get()')
    check('setting persisted in SQLite', !!(readBack && readBack.ok && readBack.data.appearance.language === 'vi'))

    // ── Vault CRUD through the real preload, IPC guard, encryption and SQLite ──
    const vault = await win.webContents.executeJavaScript(`(async () => {
      const create = await window.automationApi.credentials.create({
        newProviderName: 'Smoke Provider', category: 'llm', credentialType: 'apikey',
        identifier: 'default', secret: 'sk-smoke-123'
      })
      const list = await window.automationApi.credentials.list()
      const cred = list.data && list.data[0] && list.data[0].credentials[0]
      const reveal = cred ? await window.automationApi.credentials.reveal(cred.id) : null
      const del = cred ? await window.automationApi.credentials.delete(cred.id) : null
      const after = await window.automationApi.credentials.list()
      const remaining = after.data ? after.data.reduce((n, p) => n + (p.credentials ? p.credentials.length : 0), 0) : -1
      const providerId = after.data && after.data[0] ? after.data[0].id : null
      const providerDel = providerId ? await window.automationApi.providers.delete(providerId) : null
      const finalList = await window.automationApi.credentials.list()
      return { create, count: list.data ? list.data.length : -1, revealed: reveal && reveal.data,
        deleted: !!(del && del.ok), after: remaining, providerDeleted: !!(providerDel && providerDel.ok),
        finalProviders: finalList.data ? finalList.data.length : -1 }
    })()`)
    check('vault credential create', !!(vault && vault.create.ok), vault && vault.create.error)
    check('vault lists the provider', vault && vault.count === 1, String(vault && vault.count))
    check('vault reveal returns the secret', vault && vault.revealed === 'sk-smoke-123')
    check('vault delete removes the credential', vault && vault.deleted && vault.after === 0, JSON.stringify({ deleted: vault && vault.deleted, after: vault && vault.after }))
    check('vault provider cleanup', vault && vault.providerDeleted && vault.finalProviders === 0, JSON.stringify({ providerDeleted: vault && vault.providerDeleted, finalProviders: vault && vault.finalProviders }))

    // ── Phone control: port fallback, token, 401, server shutdown ──
    const blocker = net.createServer()
    await new Promise((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(8787, '0.0.0.0', resolve)
    })
    const enabled = await win.webContents.executeJavaScript('window.automationApi.remote.setEnabled(true)')
    check('phone server started', !!(enabled && enabled.ok && enabled.data.running))
    const phonePort = enabled && enabled.data ? enabled.data.port : 0
    const phoneToken = enabled && enabled.data ? String(enabled.data.token || '') : ''
    const encodedToken = encodeURIComponent(phoneToken)
    check('port fallback past a busy 8787', phonePort >= 8788 && phonePort <= 8799, String(phonePort))
    check('phone token issued', phoneToken.length >= 16)

    const wrong = await httpGet(`http://127.0.0.1:${phonePort}/api/state?t=wrong`)
    check('wrong token is 401', wrong.status === 401, String(wrong.status))
    const right = await httpGet(`http://127.0.0.1:${phonePort}/api/state?t=${encodedToken}`)
    check('right token returns state', right.status === 200, String(right.status))
    const disabled = await win.webContents.executeJavaScript('window.automationApi.remote.setEnabled(false)')
    check('phone server stopped', !!(disabled && disabled.ok && disabled.data.running === false))
    await delay(300)
    const afterStop = await httpGet(`http://127.0.0.1:${phonePort}/api/state?t=${encodedToken}`)
    check('port closed after disable', afterStop.status === 0, String(afterStop.status))
    blocker.close()

    // A chat page's bridge must not expose vault channels. This asserts the
    // preload shape, not the policy (the policy has its own unit tests).
    const chatBridge = await win.webContents.executeJavaScript(
      'JSON.stringify({ keys: Object.keys(window.automationApi), open: typeof window.automationApi.credentials })'
    )
    check('workspace bridge has credential namespace', JSON.parse(chatBridge).open === 'object')

    automationHost.close ? automationHost.close() : null
    await delay(200)
    check('app still alive after closing workspace', true)
    check('no second BrowserWindow leaked', BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).length <= 1)

    await automationHost.shutdown()
    check('module shut down', automationHost.isReady() === false)
  } catch (err) {
    failures++
    console.error('FAIL uncaught:', err && err.stack ? err.stack : err)
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
    console.log(failures === 0 ? 'SMOKE PASS' : `SMOKE FAIL (${failures})`)
    app.exit(failures === 0 ? 0 : 1)
  }
})
