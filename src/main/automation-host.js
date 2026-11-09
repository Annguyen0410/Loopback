'use strict';

/**
 * The bridge between Messenger (host) and the automation module.
 *
 * Messenger keeps everything that makes this one application: `app.whenReady`,
 * the single-instance lock, the tray, `Ctrl+Alt+N`, the JSON store and the IPC
 * guard. This file only:
 *
 *   • computes the module's private folder (`<userData>/automation`);
 *   • migrates old TaskOrbit data once, before the DB opens;
 *   • lazily requires the built `automation-main/bootstrap.cjs` after ready;
 *   • hands the module an AutomationHost implementation;
 *   • shuts the module down on `will-quit`.
 *
 * No tray, no lock, no `app.quit`, no second `window-all-closed`.
 */

const { app, Notification, nativeTheme, globalShortcut } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const automationWindow = require('./automation-window.js');

const APP_ROOT = path.join(__dirname, '..', '..');
const BOOTSTRAP = path.join(APP_ROOT, 'automation-main', 'bootstrap.cjs');

let moduleExports = null;
let ready = false;
let initialising = null;
let initError = null;
let options = {};
let shuttingDown = false;

const hotkeys = new Map(); // id -> accelerator

function moduleDir() {
  return path.join(app.getPath('userData'), 'automation');
}

function logError(scope, error) {
  const message = `[${new Date().toISOString()}] ${scope}: ${(error && error.stack) || error}\n`;
  try { console.error(message.trim()); } catch { /* ignore */ }
  try {
    const dir = path.join(moduleDir(), 'logs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'host-error.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 512 * 1024) fs.writeFileSync(file, '');
    fs.appendFileSync(file, message);
  } catch { /* logging must never break the host */ }
}

function hostObject() {
  return {
    userDataDir: moduleDir(),
    documentsDir: safePath('documents'),
    appVersion: app.getVersion(),
    iconPath: options.iconPath || null,
    getWindow: () => automationWindow.getWindow(),
    notify: input => {
      try {
        const win = automationWindow.getWindow();
        if (input.silentIfFocused && win && win.isFocused()) return; // in-app toast is enough
        if (!Notification.isSupported()) return;
        const toast = new Notification({
          title: input.title || '',
          body: input.body || '',
          ...(input.priority === 'high' ? { urgency: 'critical' } : {})
        });
        toast.on('click', () => automationWindow.show({ route: input.route }));
        toast.show();
      } catch (err) {
        logError('automation:notify', err);
      }
    },
    getTheme: () => ({
      mode: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      accent: typeof options.getAccent === 'function' ? options.getAccent() : 'blue'
    }),
    getLocale: () => (typeof options.getLocale === 'function' ? options.getLocale() : 'en'),
    registerHotkey: (id, accelerator, handler) => {
      try {
        if (!accelerator || typeof handler !== 'function') return false;
        const existing = hotkeys.get(id);
        if (existing === accelerator && globalShortcut.isRegistered(accelerator)) return true;
        if (globalShortcut.isRegistered(accelerator)) return false; // another app (or Ctrl+Alt+N) owns it
        if (existing) {
          try { globalShortcut.unregister(existing); } catch { /* ignore */ }
          hotkeys.delete(id);
        }
        const ok = globalShortcut.register(accelerator, handler);
        if (ok) hotkeys.set(id, accelerator);
        return ok;
      } catch (err) {
        logError('automation:hotkey', err);
        return false;
      }
    },
    unregisterHotkey: id => {
      const accelerator = hotkeys.get(id);
      if (!accelerator) return;
      try { globalShortcut.unregister(accelerator); } catch { /* ignore */ }
      hotkeys.delete(id);
    },
    logError
  };
}

function safePath(name) {
  try { return app.getPath(name); } catch { return ''; }
}

/**
 * Initialise the module. Safe to call more than once; concurrent callers share
 * the same promise. A failure here is logged and leaves chat fully working.
 */
function init(initOptions = {}) {
  options = initOptions;
  if (ready) return Promise.resolve(true);
  if (initialising) return initialising;

  initialising = (async () => {
    if (!fs.existsSync(BOOTSTRAP)) {
      initError = 'automation-main/bootstrap.cjs is missing — run npm run build:automation';
      logError('automation:init', initError);
      return false;
    }

    // Migration must run before the module opens its own (empty) database.
    try {
      const migration = require('./automation-migrate.js');
      const result = await migration.migrateIfNeeded(moduleDir());
      if (result && result.migrated) {
        console.log('[Automation] migrated data from', result.source);
      }
    } catch (err) {
      logError('automation:migration', err);
    }

    try {
      moduleExports = require(BOOTSTRAP);
      await moduleExports.initAutomation(hostObject());
      automationWindow.setOnClosed(() => {
        try { moduleExports.cancelAutomationStreams?.(); } catch { /* best effort */ }
      });
      ready = true;
      initError = null;
      console.log('[Automation] module ready');
      return true;
    } catch (err) {
      initError = String((err && err.message) || err);
      logError('automation:init', err);
      return false;
    } finally {
      initialising = null;
    }
  })();

  return initialising;
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (moduleExports && ready && typeof moduleExports.shutdownAutomation === 'function') {
      await moduleExports.shutdownAutomation();
    }
  } catch (err) {
    logError('automation:shutdown', err);
  }
  // Only this module's hotkeys — never globalShortcut.unregisterAll(), which
  // would take Ctrl+Alt+N with it.
  for (const [id, accelerator] of hotkeys) {
    try { globalShortcut.unregister(accelerator); } catch { /* ignore */ }
    hotkeys.delete(id);
  }
  automationWindow.close();
  ready = false;
}

function isReady() {
  return ready;
}

function status() {
  return {
    ready,
    open: automationWindow.isOpen(),
    error: initError || automationWindow.lastError() || null,
    windowError: automationWindow.lastError() || null
  };
}

/**
 * Tray/menu actions. They are intentionally thin: the services own the state,
 * the host only asks. All calls are guarded so a tray click cannot throw into
 * the main process.
 */
function actions() {
  if (!moduleExports || !ready) return null;
  try {
    return moduleExports.getAutomationActions ? moduleExports.getAutomationActions() : null;
  } catch (err) {
    logError('automation:actions', err);
    return null;
  }
}

module.exports = {
  init,
  shutdown,
  isReady,
  status,
  actions,
  logError,
  moduleDir,
  open: route => automationWindow.show({ route }),
  close: () => automationWindow.close(),
  closedRecently: () => automationWindow.closedRecently(),
  registerWindowIpc: ipcMain => automationWindow.registerWindowIpc(ipcMain, isReady)
};
