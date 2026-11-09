'use strict';

/**
 * The Automation Workspace window.
 *
 * A separate BrowserWindow, modelled on the Monitor window: its own preload,
 * `contextIsolation`, no Node in the renderer, no `parent`, no modal. It is an
 * auxiliary window — closing it destroys the renderer but leaves the module
 * (scheduler, watchers, clicker, phone server) running, exactly like TaskOrbit
 * did when its main window was hidden.
 */

const { BrowserWindow, screen, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { externalUrl, isAppPage } = require('./security.js');

const APP_ROOT = path.join(__dirname, '..', '..');
const PAGE = path.join(APP_ROOT, 'automation.html');
const PRELOAD = path.join(APP_ROOT, 'automation-preload.cjs');

let automationWin = null;
let boundsTimer = null;
let automationError = null;
let closedHandler = null;
let closedAt = 0;

function alive(win) {
  return !!win && !win.isDestroyed();
}

/* Showing a window is not enough on Windows: a window created while the
   process is carrying a minimized startup state can stay minimized, and a
   window whose renderer never paints can stay invisible behind show:false.
   Restore, show and raise it in one place so every open path behaves alike. */
function reveal(win) {
  if (!alive(win)) return;
  try { if (win.isMinimized()) win.restore(); } catch { /* already gone */ }
  try { win.show(); } catch { /* already gone */ }
  try { win.focus(); } catch { /* focus may be denied by the OS */ }
  try { if (typeof win.moveTop === 'function') win.moveTop(); } catch { /* already gone */ }
}

function stateFile() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'automation', 'window.json');
}

function readBounds() {
  try {
    const raw = fs.readFileSync(stateFile(), 'utf8');
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const width = Number(value.width);
    const height = Number(value.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    const out = {
      width: Math.max(1100, Math.round(width)),
      height: Math.max(700, Math.round(height))
    };
    if (Number.isFinite(value.x) && Number.isFinite(value.y)) {
      out.x = Math.round(value.x);
      out.y = Math.round(value.y);
    }
    // A saved position on a monitor that is no longer attached would open the
    // window off-screen. Centre it on the primary display instead.
    if (Number.isFinite(out.x) && Number.isFinite(out.y)) {
      const visible = screen.getAllDisplays().some(display => {
        const area = display.workArea;
        return out.x < area.x + area.width - 40 && out.x + out.width > area.x + 40 &&
          out.y < area.y + area.height - 40 && out.y + out.height > area.y + 40;
      });
      if (!visible) { delete out.x; delete out.y; }
    }
    return out;
  } catch {
    return null;
  }
}

function saveBounds() {
  if (!alive(automationWin)) return;
  try {
    if (automationWin.isMaximized() || automationWin.isMinimized()) return;
    const bounds = automationWin.getBounds();
    const dir = path.dirname(stateFile());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(bounds, null, 2), 'utf8');
  } catch { /* best effort */ }
}

function scheduleBoundsSave() {
  if (boundsTimer) clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => { boundsTimer = null; saveBounds(); }, 400);
}

function navigate(route) {
  if (!alive(automationWin) || !route) return;
  const raw = String(route);
  const hash = raw.startsWith('#') ? raw : `#${raw.startsWith('/') ? '' : '/'}${raw}`;
  automationWin.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(hash)}`, true)
    .catch(() => {});
}

/**
 * Open (or focus) the workspace. `options.route` is a hash route such as
 * `#/notifications`; `options.reason` is only for diagnostics.
 */
function show(options = {}) {
  const route = typeof options === 'string' ? options : options.route;
  if (alive(automationWin)) {
    reveal(automationWin);
    navigate(route);
    return automationWin;
  }

  if (!fs.existsSync(PAGE)) {
    automationError = 'automation.html is missing — run npm run build:automation';
    console.warn('[Automation]', automationError);
    return null;
  }

  const { app, nativeTheme } = require('electron');
  const dark = nativeTheme.shouldUseDarkColors;
  const saved = readBounds();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    ...(saved || {}),
    show: false,
    title: 'Automation — Loopback',
    autoHideMenuBar: true,
    backgroundColor: dark ? '#0f1117' : '#f6f7f9',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  automationWin = win;
  automationError = null;

  try {
    win.setMenuBarVisibility(false);
    win.loadFile(PAGE, route ? { hash: String(route).replace(/^#/, '') } : undefined);
  } catch (err) {
    automationError = String((err && err.message) || err);
    console.warn('[Automation] load failed:', automationError);
  }

  win.once('ready-to-show', () => {
    reveal(win);
  });

  /* If the page never reaches ready-to-show, or Windows minimizes it just
     after it is shown, the click must still produce a visible window. */
  const revealTimer = setTimeout(() => {
    if (alive(win) && (!win.isVisible() || win.isMinimized())) reveal(win);
  }, 900);

  win.webContents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
    if (isMainFrame === false) return;
    automationError = `${description} (${code})`;
    console.warn('[Automation] page load failed:', automationError, failedUrl);
    reveal(win);
  });

  /* The workspace has no business opening child windows or navigating away.
     The process-wide handler in main.js also enforces this; these are the
     window-local rules so a future change to the global one cannot weaken it. */
  win.webContents.setWindowOpenHandler(({ url }) => {
    const safe = externalUrl(url);
    if (safe) shell.openExternal(safe).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://') && isAppPage(url, APP_ROOT)) {
      try {
        const { fileURLToPath } = require('node:url');
        if (path.basename(fileURLToPath(url)) === 'automation.html') return;
      } catch { /* fall through to deny */ }
    }
    event.preventDefault();
    const safe = externalUrl(url);
    if (safe) shell.openExternal(safe).catch(() => {});
  });

  win.on('resize', scheduleBoundsSave);
  win.on('move', scheduleBoundsSave);
  win.on('close', saveBounds);
  win.on('closed', () => {
    clearTimeout(revealTimer);
    closedAt = Date.now();
    if (automationWin === win) automationWin = null;
    if (typeof closedHandler === 'function') {
      try { closedHandler(); } catch { /* a closed hook must not throw */ }
    }
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.warn('[Automation] renderer gone:', details && details.reason);
  });

  void app; // app is only used for the userData path above
  return win;
}

function getWindow() {
  return alive(automationWin) ? automationWin : null;
}

function close() {
  if (alive(automationWin)) {
    try { automationWin.close(); } catch { /* already gone */ }
  }
  automationWin = null;
}

function isOpen() {
  return !!getWindow();
}

function lastError() {
  return automationError;
}

/** The host uses this to cancel PromptForge streams when the window closes. */
function setOnClosed(fn) {
  closedHandler = typeof fn === 'function' ? fn : null;
}

/** True only for the window-all-closed event caused by closing this workspace. */
function closedRecently(ms = 3000) {
  return closedAt > 0 && Date.now() - closedAt <= ms;
}

/**
 * Host-owned channels. Registered after installIpcGuard so the role rules in
 * src/main/ipc-policy.js apply: chat may call open/status, automation may call
 * close, everyone else is refused.
 */
function registerWindowIpc(ipcMain, isReady) {
  ipcMain.handle('automation:open', (_event, route) => {
    try {
      const win = show({ route: typeof route === 'string' ? route : undefined });
      return win ? { ok: true } : { ok: false, error: automationError || 'automation-unavailable' };
    } catch (err) {
      automationError = String((err && err.message) || err);
      console.warn('[Automation] open failed:', automationError);
      return { ok: false, error: automationError };
    }
  });
  ipcMain.handle('automation:status', () => ({
    ok: true,
    data: {
      open: isOpen(),
      ready: typeof isReady === 'function' ? !!isReady() : false,
      error: automationError || null
    }
  }));
  ipcMain.handle('automation:close', () => {
    close();
    return { ok: true };
  });
}

module.exports = {
  show,
  close,
  getWindow,
  isOpen,
  lastError,
  setOnClosed,
  closedRecently,
  registerWindowIpc,
  PAGE
};
