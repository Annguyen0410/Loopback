const { app, BrowserWindow, ipcMain, dialog, shell, protocol, Notification, nativeTheme, net, nativeImage, session, screen, globalShortcut, desktopCapturer, powerSaveBlocker } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const os = require("os");
const { Readable } = require("stream");

protocol.registerSchemesAsPrivileged([
  { scheme: "local-file", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
]);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

/* A stray error in the main process must never turn into the modal "A
   JavaScript error occurred in the main process" dialog: it is written to
   userData/error.log instead and the app carries on. The log is trimmed once it
   gets big so a repeating error cannot fill the disk. */
function logMainError(kind, err) {
  const msg = `[${new Date().toISOString()}] ${kind}: ${(err && err.stack) || err}\n`;
  try { console.error(msg.trim()); } catch {}
  try {
    const f = path.join(app.getPath("userData"), "error.log");
    if (fs.existsSync(f) && fs.statSync(f).size > 256 * 1024) fs.writeFileSync(f, "");
    fs.appendFileSync(f, msg);
  } catch {}
}
process.on("uncaughtException", err => logMainError("uncaughtException", err));
process.on("unhandledRejection", err => logMainError("unhandledRejection", err));

let win = null;
let monitorWin = null;
let pipWin = null;
let camWin = null;      // floating camera bubble (while recording from the bubble)

/* A destroyed BrowserWindow is NOT `null`: touching one (isMinimized(),
   focus(), close(), webContents…) throws "Object has been destroyed", which
   Electron then reports as the fatal main-process crash dialog. Window
   references are therefore validated right before use. This matters most for
   `win`: closing the chat window while the floating bar keeps the app alive
   leaves the variable pointing at a dead window. */
function alive(w) { return !!w && !w.isDestroyed(); }

/* Dialogs take an optional parent window; a dead parent must be dropped, but
   "no parent" still means calling the one-argument form (passing null would
   make Electron read the parent as the options object). */
function askOpen(opts) { return alive(win) ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts); }
function askSave(opts) { return alive(win) ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts); }
let camOwner = null;    // webContents of the window that owns the camera bubble
let camScaleIdx = 1;    // S / M / L for that bubble
let pipCollapsed = true;
let pipVertical = true; // collapsed bubble orientation (persisted)
let pipMaximized = false;      // expanded popup filling the work area
let pipPreMaxBounds = null;    // bounds to come back to when it is restored
let pipAutoExpand = true;      // openPip() opens the chat popup (false = the bar)
let recHideActive = false; // true while a recording keeps the app out of the video
/* Smoke tests boot this module with `require("./main.js")`. The desktop-only
   startup extras (login item, floating bar on launch) are skipped for them so
   the tests' own windows stay undisturbed. */
const IS_TEST_BOOT = !!(require.main && require.main.filename && require.main.filename !== __filename);
const PIP_BUBBLE_H = { w: 280, h: 52 }; // horizontal pill (fits shot/rec/media tools)
const PIP_BUBBLE_V = { w: 56, h: 248 }; // vertical bookmark tab (fits stacked tools)
const PIP_CHAT = { w: 430, h: 700 };
const PIP_CFG = () => path.join(app.getPath("userData"), "pip.json");

function loadPipCfg() {
  try { return JSON.parse(fs.readFileSync(PIP_CFG(), "utf8")); } catch { return {}; }
}
function savePipCfg(patch) {
  try {
    const cur = loadPipCfg();
    Object.assign(cur, patch || {});
    fs.mkdirSync(path.dirname(PIP_CFG()), { recursive: true });
    fs.writeFileSync(PIP_CFG(), JSON.stringify(cur), "utf8");
  } catch {}
}
function pipScale() {
  try {
    const s = Number(loadCfg().pipScale) || 1;
    return Math.min(1.6, Math.max(0.6, s));
  } catch { return 1; }
}
function pipBubbleSize() {
  const s = pipScale();
  return pipVertical
    ? { w: Math.round(PIP_BUBBLE_V.w * s), h: Math.round(PIP_BUBBLE_V.h * s) }
    : { w: Math.round(PIP_BUBBLE_H.w * s), h: Math.round(PIP_BUBBLE_H.h * s) };
}
/* Which screen edge the collapsed bar parks against. */
function pipDockSide() {
  try { return loadCfg().pipDock === "left" ? "left" : "right"; } catch { return "right"; }
}
/* Work area of the display the floating window currently lives on. */
function pipWorkArea() {
  try {
    if (pipWin && !pipWin.isDestroyed()) return screen.getDisplayMatching(pipWin.getBounds()).workArea;
  } catch {}
  return screen.getPrimaryDisplay().workArea;
}
/* Where the collapsed bar sits when it is docked: flush against one edge,
   vertically centred — "hiển thị một bên liền" instead of a bar that has to be
   hunted for somewhere on the desktop. */
function dockPipBounds(side) {
  const s = pipBubbleSize();
  const wa = pipWorkArea();
  const gap = 6;
  return {
    x: (side || pipDockSide()) === "left" ? wa.x + gap : wa.x + wa.width - s.w - gap,
    y: wa.y + Math.max(gap, Math.round((wa.height - s.h) / 2)),
    width: s.w, height: s.h
  };
}
const DATA = () => path.join(app.getPath("userData"), "messages.json");
const SETTINGS = () => path.join(app.getPath("userData"), "settings.json");
const FDIR = () => path.join(app.getPath("userData"), "files");
const VDIR = () => path.join(app.getPath("userData"), "voice");
const CAPDIR = () => path.join(app.getPath("userData"), "captures");
const QUICK_CFG = () => path.join(app.getPath("userData"), "quick.json");
const QUICK_ACCEL = "CommandOrControl+Alt+N"; // global "new note" hotkey
const QUICK_SIZE = { w: 580, h: 212 };
const APP_ICON = path.join(__dirname, "assets", "icon.png");

function ensure() {
  fs.mkdirSync(FDIR(), { recursive: true });
  fs.mkdirSync(VDIR(), { recursive: true });
  fs.mkdirSync(CAPDIR(), { recursive: true });
}

function loadJSON() {
  try { return JSON.parse(fs.readFileSync(DATA(), "utf8")); } catch { return { messages: [] }; }
}
function saveJSON(d) {
  fs.mkdirSync(path.dirname(DATA()), { recursive: true });
  fs.writeFileSync(DATA(), JSON.stringify(d || { messages: [] }), "utf8");
}
function loadCfg() {
  try { return JSON.parse(fs.readFileSync(SETTINGS(), "utf8")); } catch { return { darkMode: false, theme: "blue" }; }
}
function saveCfg(d) {
  fs.mkdirSync(path.dirname(SETTINGS()), { recursive: true });
  fs.writeFileSync(SETTINGS(), JSON.stringify(d), "utf8");
}

function safeFile(name, dirFn) {
  if (!name || typeof name !== "string" || /[\/\\]/.test(name) || name.includes("..")) return null;
  const base = path.normalize(dirFn() + path.sep);
  const full = path.normalize(path.join(dirFn(), name));
  return full.startsWith(base) ? full : null;
}

const MIME = { ".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".gif":"image/gif",".webp":"image/webp",
  ".mp4":"video/mp4",".webm":"video/webm",".mov":"video/quicktime",
  ".mp3":"audio/mpeg",".wav":"audio/wav",".ogg":"audio/ogg",
  ".pdf":"application/pdf",".txt":"text/plain",".json":"application/json",".zip":"application/zip" };
function mimeOf(n) { return MIME[path.extname(n).toLowerCase()] || "application/octet-stream"; }
function catOf(m) { return m.startsWith("image/") ? "image" : m.startsWith("video/") ? "video" : m.startsWith("audio/") ? "audio" : "file"; }

function loadQuickCfg() {
  try { return JSON.parse(fs.readFileSync(QUICK_CFG(), "utf8")); } catch { return {}; }
}
function saveQuickCfg(patch) {
  try {
    const cur = loadQuickCfg();
    Object.assign(cur, patch || {});
    fs.mkdirSync(path.dirname(QUICK_CFG()), { recursive: true });
    fs.writeFileSync(QUICK_CFG(), JSON.stringify(cur), "utf8");
  } catch {}
}

function storeFile(fp) {
  const st = fs.statSync(fp);
  const ext = path.extname(fp);
  const sn = `${crypto.randomUUID()}${ext}`;
  const m = mimeOf(fp);
  fs.copyFileSync(fp, path.join(FDIR(), sn));
  return { name: path.basename(fp), storedName: sn, size: st.size, mime: m, category: catOf(m) };
}

function deleteStored(storedName) {
  const f = safeFile(storedName, FDIR) || safeFile(storedName, VDIR);
  if (f && fs.existsSync(f)) { try { fs.unlinkSync(f); } catch {} }
}

/* ===== Quick note =====================================================
 * A small always-on-top capture popup (global Ctrl+Alt+N) for jotting a
 * thought without opening the main window. It writes straight to the store
 * from the main process, then replays the fresh state into every other
 * window so a stale renderer can never overwrite the new note.
 */
let quickWin = null;

function appendQuickNote(text, chatId) {
  const clean = String(text || "").trim();
  if (!clean) return { ok: false, error: "empty" };
  const data = loadJSON();
  if (!Array.isArray(data.messages)) data.messages = [];
  if (!Array.isArray(data.chats) || !data.chats.length) {
    data.chats = [{ id: crypto.randomUUID(), name: "Notes to Self", pinned: true, createdAt: Date.now() - 3000 }];
    for (const m of data.messages) if (!m.chatId) m.chatId = data.chats[0].id;
  }
  const cfg = loadQuickCfg();
  const chat = data.chats.find(c => c.id === chatId)
    || data.chats.find(c => c.id === cfg.lastChatId)
    || data.chats.find(c => c.id === data.activeChatId)
    || data.chats[0];
  const msg = {
    id: crypto.randomUUID(), chatId: chat.id, text: clean, files: [], createdAt: Date.now(),
    read: true, reactions: {}, pinned: false, edited: false
  };
  data.messages.push(msg);
  saveJSON(data);
  saveQuickCfg({ lastChatId: chat.id });
  BrowserWindow.getAllWindows().forEach(w => {
    if (w !== quickWin && !w.isDestroyed()) w.webContents.send("state:changed", data);
  });
  return { ok: true, chatId: chat.id, chatName: chat.name, message: msg };
}

function openQuickNote() {
  if (quickWin && !quickWin.isDestroyed()) {
    quickWin.show();
    quickWin.focus();
    quickWin.webContents.send("quick:focus");
    return;
  }
  let wa = screen.getPrimaryDisplay().workArea;
  try { wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; } catch {}
  quickWin = new BrowserWindow({
    width: QUICK_SIZE.w, height: QUICK_SIZE.h,
    x: wa.x + Math.round((wa.width - QUICK_SIZE.w) / 2),
    y: wa.y + Math.round(Math.max(0, wa.height * 0.22)),
    frame: false, resizable: false, minimizable: false, maximizable: false,
    fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
    title: "Quick note", icon: APP_ICON,
    backgroundColor: loadCfg().darkMode ? "#1c1e21" : "#f0f2f5",
    webPreferences: {
      preload: path.join(__dirname, "quick-preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false
    }
  });
  quickWin.setAlwaysOnTop(true, "floating");
  quickWin.loadFile(path.join(__dirname, "quick.html"));
  quickWin.once("ready-to-show", () => {
    if (quickWin && !quickWin.isDestroyed()) { quickWin.show(); quickWin.focus(); }
  });
  // Spotlight-style: click away → hide (kept alive, so reopening is instant).
  quickWin.on("blur", () => {
    setTimeout(() => {
      if (quickWin && !quickWin.isDestroyed() && !quickWin.isFocused() && !quickWin.webContents.isDevToolsOpened()) {
        quickWin.hide();
      }
    }, 200);
  });
  quickWin.on("closed", () => { quickWin = null; });
}

function toggleQuickNote() {
  if (quickWin && !quickWin.isDestroyed() && quickWin.isVisible()) { quickWin.hide(); return; }
  openQuickNote();
}

function registerQuickShortcut() {
  try {
    if (globalShortcut.isRegistered(QUICK_ACCEL)) return true;
    const ok = globalShortcut.register(QUICK_ACCEL, toggleQuickNote);
    if (!ok) console.warn("[Main] Quick-note hotkey unavailable (already taken):", QUICK_ACCEL);
    return ok;
  } catch (err) {
    console.warn("[Main] Quick-note hotkey failed:", (err && err.message) || err);
    return false;
  }
}

function registerHandlers() {
  ipcMain.handle("store:load", () => { try { return loadJSON(); } catch { return { messages: [] }; } });
  ipcMain.handle("store:save", (_, d) => { try { saveJSON(d); return { ok: true }; } catch { return { ok: false }; } });
  ipcMain.handle("settings:load", () => { try { return loadCfg(); } catch { return { darkMode: false, theme: "blue" }; } });
  ipcMain.handle("settings:save", (_, d) => {
    try {
      // Persist sidebar collapse independently if the payload omitted it.
      const cur = loadCfg();
      const next = Object.assign({}, cur, d || {});
      if (d && typeof d.sidebarCollapsed === "boolean") next.sidebarCollapsed = d.sidebarCollapsed;
      saveCfg(next);
      return { ok: true };
    } catch { return { ok: false }; }
  });

  ipcMain.handle("file:pick", async (_, filters) => {
    try {
      const opts = { properties: ["openFile", "multiSelections"] };
      if (Array.isArray(filters) && filters.length) opts.filters = filters;
      const r = await askOpen(opts);
      if (r.canceled) return [];
      ensure();
      return r.filePaths.map(storeFile);
    } catch { return []; }
  });

  ipcMain.handle("file:savePasted", (_, { name, dataUrl }) => {
    try {
      ensure();
      const b64 = String(dataUrl || "").split(",")[1];
      if (!b64) return null;
      const buf = Buffer.from(b64, "base64");
      const ext = ({ "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" })[(dataUrl.match(/^data:([^;,]+)/) || [])[1]] || ".png";
      const sn = crypto.randomUUID() + ext;
      fs.writeFileSync(path.join(FDIR(), sn), buf);
      const mime = "image/" + ext.slice(1);
      return { name: String(name || "pasted-image") + ext, storedName: sn, size: buf.length, mime, category: "image" };
    } catch { return null; }
  });

  ipcMain.handle("store:export", async () => {
    try {
      const r = await askSave({
        title: "Export notes backup",
        defaultPath: "messenger-backup-" + new Date().toISOString().slice(0, 10) + ".json",
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
      if (r.canceled || !r.filePath) return { ok: false };
      const data = loadJSON();
      fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2), "utf8");
      return { ok: true, path: r.filePath };
    } catch (e) { return { ok: false, error: String(e.which || e) }; }
  });

  ipcMain.handle("app:openDataFolder", () => {
    try { shell.openPath(app.getPath("userData")); } catch {}
  });

  // Drag-and-drop: renderer sends absolute paths obtained via webUtils.getPathForFile
  ipcMain.handle("file:storePaths", (_, paths) => {
    try {
      if (!Array.isArray(paths)) return [];
      ensure();
      return paths
        .filter(p => typeof p === "string" && fs.existsSync(p))
        .map(storeFile);
    } catch { return []; }
  });

  ipcMain.handle("file:delete", (_, storedNames) => {
    try {
      const list = Array.isArray(storedNames) ? storedNames : [storedNames];
      list.forEach(deleteStored);
      return { ok: true };
    } catch { return { ok: false }; }
  });

  ipcMain.handle("file:saveCanvas", (_, dataUrl) => {
    try {
      ensure();
      const b64 = String(dataUrl || "").split(",")[1];
      if (!b64) return null;
      const buf = Buffer.from(b64, "base64");
      const sn = `${crypto.randomUUID()}.png`;
      fs.writeFileSync(path.join(FDIR(), sn), buf);
      return { name: `whiteboard-${Date.now()}.png`, storedName: sn, size: buf.length, mime: "image/png", category: "image" };
    } catch { return null; }
  });

  ipcMain.handle("file:open", (_, n) => {
    const f = safeFile(n, FDIR) || safeFile(n, VDIR);
    if (f) shell.openPath(f);
  });
  ipcMain.handle("file:reveal", (_, n) => {
    const f = safeFile(n, FDIR) || safeFile(n, VDIR);
    if (f) shell.showItemInFolder(f);
  });

  ipcMain.handle("voice:save", (_, b64data) => {
    try {
      ensure();
      const b64 = String(b64data || "").split(",")[1];
      if (!b64) return null;
      const buf = Buffer.from(b64, "base64");
      const sn = `${crypto.randomUUID()}.webm`;
      fs.writeFileSync(path.join(VDIR(), sn), buf);
      return { name: `voice-${Date.now()}.webm`, storedName: sn, size: buf.length, mime: "audio/webm", category: "audio" };
    } catch { return null; }
  });

  /* ---- Quick note popup ---- */
  ipcMain.on("quick:open", () => openQuickNote());
  ipcMain.on("quick:hide", () => { if (quickWin && !quickWin.isDestroyed()) quickWin.hide(); });
  ipcMain.handle("quick:chats", () => {
    const data = loadJSON();
    const cfg = loadQuickCfg();
    const chats = Array.isArray(data.chats)
      ? data.chats.map(c => ({ id: c.id, name: c.name, pinned: !!c.pinned }))
      : [];
    return {
      chats,
      lastChatId: cfg.lastChatId || null,
      activeChatId: data.activeChatId || null,
      dark: !!loadCfg().darkMode
    };
  });
  ipcMain.handle("quick:append", (_, payload) => appendQuickNote(payload && payload.text, payload && payload.chatId));

  ipcMain.handle("notify:show", (_, opts) => {
    try { if (Notification.isSupported()) new Notification({ title: opts.title || "", body: opts.body || "" }).show(); } catch {}
  });

  ipcMain.handle("image:resize", (_, { dataUrl, maxWidth }) => {
    try {
      const b64 = String(dataUrl || "").split(",")[1];
      if (!b64) return null;
      const img = nativeImage.createFromBuffer(Buffer.from(b64, "base64"));
      const sz = img.getSize();
      if (!maxWidth || sz.width <= maxWidth) return { dataUrl, width: sz.width, height: sz.height, resized: false };
      const scaled = img.resize({ quality: "good" });
      return { dataUrl: "data:image/png;base64," + scaled.toPNG().toString("base64"), width: scaled.getSize().width, height: scaled.getSize().height, resized: true };
    } catch { return null; }
  });

  ipcMain.handle("theme:set", (_, mode) => { nativeTheme.themeSource = mode; });

  /* ---- Screenshots / screen recordings (rail tools + media library) ---- */
  function safeCap(name) {
    if (!name || typeof name !== "string" || /[\/\\]/.test(name) || name.includes("..")) return null;
    const base = path.normalize(CAPDIR() + path.sep);
    const full = path.normalize(path.join(CAPDIR(), name));
    return full.startsWith(base) ? full : null;
  }

  function captureStamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  ipcMain.handle("capture:list", () => {
    try {
      ensure();
      return fs.readdirSync(CAPDIR())
        .filter(n => /\.(png|jpg|jpeg|webp|webm|mp4|mov)$/i.test(n))
        .map(n => {
          const st = fs.statSync(path.join(CAPDIR(), n));
          const ext = path.extname(n).toLowerCase();
          return {
            name: n,
            kind: [".png", ".jpg", ".jpeg", ".webp"].includes(ext) ? "image" : "video",
            size: st.size,
            mtime: st.mtimeMs
          };
        })
        .sort((a, b) => b.mtime - a.mtime);
    } catch { return []; }
  });

  ipcMain.handle("capture:save", (_, payload) => {
    try {
      ensure();
      const name = payload && payload.name;
      let buf = null;
      if (payload && payload.buffer) {
        buf = Buffer.from(payload.buffer);
      } else if (payload && typeof payload.dataUrl === "string") {
        const m = payload.dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
        if (m) buf = Buffer.from(m[2], "base64");
      }
      if (!buf || !buf.length) return { ok: false, error: "empty" };
      const clean = String(name || "").replace(/[\/\\]/g, "_").replace(/\.\./g, "_") || `cap-${captureStamp()}`;
      fs.writeFileSync(path.join(CAPDIR(), clean), buf);
      return { ok: true, name: clean };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle("capture:delete", (_, names) => {
    try {
      const list = Array.isArray(names) ? names : [names];
      list.forEach(n => { const f = safeCap(n); if (f && fs.existsSync(f)) fs.unlinkSync(f); });
      return { ok: true };
    } catch { return { ok: false }; }
  });

  ipcMain.handle("capture:download", async (_, name) => {
    const src = safeCap(name);
    if (!src || !fs.existsSync(src)) return { ok: false, error: "missing" };
    try {
      const saveOpts = {
        title: "Save capture",
        defaultPath: path.join(app.getPath("downloads"), path.basename(name)),
        filters: path.extname(name).toLowerCase() === ".png"
          ? [{ name: "PNG", extensions: ["png"] }]
          : path.extname(name).toLowerCase() === ".webm"
            ? [{ name: "WebM", extensions: ["webm"] }]
            : [{ name: "File", extensions: [path.extname(name).slice(1) || "*"] }]
      };
      const r = await askSave(saveOpts);
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      fs.copyFileSync(src, r.filePath);
      return { ok: true, path: r.filePath };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle("capture:reveal", (_, name) => {
    const f = safeCap(name);
    if (f && fs.existsSync(f)) shell.showItemInFolder(f);
  });

  ipcMain.handle("capture:openFolder", () => {
    try { ensure(); shell.openPath(CAPDIR()); } catch {}
  });

  /* Screenshot: freeze the screen into a fullscreen overlay, user drags a
     region, main crops the original NativeImage and stores it in captures/. */
  let shotWin = null;
  let shotImage = null; // NativeImage of the full screen
  let shotStowing = false; // overlay windows are parked off-screen for a grab
  let shotCancelled = false; // the user closed the picker while it was still opening

  /* The floating bubble and the camera bubble are always-on-top overlay
     windows owned by the app, so anything of them over the selected region got
     baked into the screenshot — drag a selection across where the pill was
     parked and the pill ended up in the picture. They are parked just outside
     every display for the grab and put straight back when the overlay closes.
     Parking (moving) is used instead of hide()/showInactive() on purpose: a
     hide + show cycle leaves Chromium's resize pipeline for that window behind
     — the next expand/resize then lays the page out for the OLD viewport,
     which is how panels end up clipped inside a big window. */
  let shotParkedWins = [];
  function parkOverlaysForShot() {
    restoreShotOverlays();
    for (const w of [pipWin, camWin]) {
      if (!w || w.isDestroyed() || !w.isVisible()) continue;
      const b = w.getBounds();
      let x = Infinity, y = Infinity;
      for (const d of screen.getAllDisplays()) {
        x = Math.min(x, d.bounds.x);
        y = Math.min(y, d.bounds.y);
      }
      try {
        w.setPosition(Math.round(x - b.width - 40), Math.round(y - b.height - 40));
        shotParkedWins.push({ w, x: b.x, y: b.y });
      } catch {}
    }
    shotStowing = shotParkedWins.length > 0;
  }
  function restoreShotOverlays() {
    const parked = shotParkedWins;
    shotParkedWins = [];
    for (const p of parked) {
      if (p.w && !p.w.isDestroyed()) { try { p.w.setPosition(p.x, p.y); } catch {} }
    }
    shotStowing = false;
  }

  async function openScreenshotOverlay() {
    // Already picking a region: focus it instead of reporting a fake failure.
    if (shotWin && !shotWin.isDestroyed()) { shotWin.focus(); return { ok: true, already: true }; }
    // Declared OUT here: a `let` inside the try block is not visible from catch.
    let overlayUp = false;
    shotCancelled = false;
    try {
      parkOverlaysForShot();
      if (shotParkedWins.length) await new Promise(r => setTimeout(r, 80));
      const pt = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const dpr = pt.scaleFactor || 1;
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: {
          width: Math.round(pt.size.width * dpr),
          height: Math.round(pt.size.height * dpr)
        }
      });
      const src = sources.find(s => String(s.display_id) === String(pt.id)) || sources[0];
      if (!src || !src.thumbnail || src.thumbnail.isEmpty()) {
        restoreShotOverlays(); // nothing will show a region picker — don't leave the bubble hidden
        return { ok: false, error: "no-source" };
      }
      shotImage = src.thumbnail;
      // Overlay must match the captured display bounds (not just workArea),
      // so selection coordinates map 1:1 onto the screenshot pixels.
      const b = pt.bounds;
      shotWin = new BrowserWindow({
        x: b.x, y: b.y, width: b.width, height: b.height,
        frame: false, transparent: false, resizable: false, movable: false,
        fullscreen: false, simpleFullscreen: false,
        alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
        backgroundColor: "#000000",
        webPreferences: {
          preload: path.join(__dirname, "shot-preload.js"),
          contextIsolation: true, nodeIntegration: false, sandbox: false
        }
      });
      overlayUp = true;
      // Windows clamps a new window to the WORK area (taskbar excluded), so the
      // picker came out 48px short of the screen it had just grabbed: the bottom
      // strip could not be selected, and the overlay no longer matched the
      // screenshot's pixels. Re-asserting the display bounds afterwards sticks.
      try { shotWin.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height }); } catch {}
      shotWin.setAlwaysOnTop(true, "screen-saver");
      // Registered before anything async: the bubble comes back whether the
      // user crops, cancels, hits Esc or the overlay dies on its own.
      shotWin.on("closed", () => {
        shotWin = null; shotImage = null;
        restoreShotOverlays();
      });
      const dataUrl = "data:image/png;base64," + shotImage.toPNG().toString("base64");
      await shotWin.loadFile(path.join(__dirname, "shot-overlay.html"), {
        query: {
          w: String(b.width),
          h: String(b.height),
          imgW: String(shotImage.getSize().width),
          imgH: String(shotImage.getSize().height)
        }
      });
      // Page scripts have registered shot:ready by now (did-finish-load).
      if (shotWin && !shotWin.isDestroyed()) {
        shotWin.webContents.send("shot:ready", { dataUrl });
      }
      return { ok: true };
    } catch (e) {
      /* A picker whose window disappeared while its page was still loading was
         closed on purpose (an impatient Esc / a quick second press). loadFile
         rejects with ERR_FAILED then — that is a CANCEL, and reporting it as a
         screenshot failure put "Screenshot failed: ERR_FAILED (-2) loading
         file:///…" in front of the user. */
      // A window being closed is not reported as destroyed yet, so the explicit
      // cancel flag is what makes this reliable.
      const cancelled = overlayUp && (shotCancelled || !shotWin || shotWin.isDestroyed());
      if (!shotWin || shotWin.isDestroyed()) restoreShotOverlays();
      if (cancelled) return { ok: false, canceled: true };
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  ipcMain.handle("capture:startShot", () => openScreenshotOverlay());

  /* ===== Floating camera bubble =====
   * The collapsed floating bar (56×248 / 280×52) has no room for a live camera
   * preview, so when a recording starts there the recording window asks for
   * this small always-on-top camera window instead. It is excluded from capture
   * like the bubble itself, so it never shows up in the video — wherever the
   * user drags it on the desktop is exactly where the camera bubble lands in
   * the recording. Frames are pushed in from the recording window (it already
   * holds the camera stream). */
  const camLabels = ["S", "M", "L"];
  const CAM_OVERLAY_SIZES = [{ w: 144, h: 108 }, { w: 176, h: 132 }, { w: 232, h: 174 }];

  function camOverlaySize() {
    return CAM_OVERLAY_SIZES[Math.min(CAM_OVERLAY_SIZES.length - 1, Math.max(0, camScaleIdx))];
  }

  function camOverlayNorm() {
    if (!camWin || camWin.isDestroyed()) return null;
    const b = camWin.getBounds();
    const d = screen.getDisplayMatching(b);
    const clamp01 = v => Math.min(1, Math.max(0, v));
    return {
      x: clamp01((b.x + b.width / 2 - d.bounds.x) / Math.max(1, d.bounds.width)),
      y: clamp01((b.y + b.height / 2 - d.bounds.y) / Math.max(1, d.bounds.height))
    };
  }

  function camOverlayNotify(extra) {
    if (!camOwner || camOwner.isDestroyed()) return;
    try { camOwner.send("cam:moved", Object.assign({ pos: camOverlayNorm() }, extra || {})); } catch {}
  }

  function closeCamOverlay() {
    if (camWin && !camWin.isDestroyed()) {
      const owner = camOwner;
      try { camWin.close(); } catch {}
      if (owner && !owner.isDestroyed()) { try { owner.send("cam:closed"); } catch {} }
    }
    camWin = null;
  }

  function openCamOverlay(scale) {
    if (typeof scale === "number" && isFinite(scale)) {
      camScaleIdx = Math.min(CAM_OVERLAY_SIZES.length - 1, Math.max(0, Math.round(scale)));
    }
    const size = camOverlaySize();
    if (camWin && !camWin.isDestroyed()) {
      // Re-open (e.g. camera toggled back on) — keep where the user put it.
      const b = camWin.getBounds();
      camWin.setBounds({
        x: Math.round(b.x + b.width / 2 - size.w / 2), y: Math.round(b.y + b.height / 2 - size.h / 2),
        width: size.w, height: size.h
      });
      camWin.showInactive();
      try { camWin.webContents.send("cam:size", camLabels[camScaleIdx]); } catch {}
      return { ok: true, pos: camOverlayNorm(), size: camLabels[camScaleIdx] };
    }

    let wa = screen.getPrimaryDisplay().workArea;
    try {
      const owner = camOwner ? BrowserWindow.fromWebContents(camOwner) : win;
      if (owner && !owner.isDestroyed()) wa = screen.getDisplayMatching(owner.getBounds()).workArea;
    } catch {}
    const cfg = loadCfg();
    const p = (cfg && cfg.camPos) || { x: 0.9, y: 0.82 };
    const x = Math.min(Math.max(Math.round(wa.x + p.x * wa.width - size.w / 2), wa.x), wa.x + wa.width - size.w);
    const y = Math.min(Math.max(Math.round(wa.y + p.y * wa.height - size.h / 2), wa.y), wa.y + wa.height - size.h);

    camWin = new BrowserWindow({
      width: size.w, height: size.h, x, y,
      frame: false, transparent: true, resizable: false, minimizable: false,
      maximizable: false, fullscreenable: false, alwaysOnTop: true, skipTaskbar: true,
      hasShadow: false, backgroundColor: "#00000000", icon: APP_ICON,
      webPreferences: {
        preload: path.join(__dirname, "cam-preload.js"),
        contextIsolation: true, nodeIntegration: false, sandbox: false,
        spellcheck: false, backgroundThrottling: false
      }
    });
    camWin.loadFile(path.join(__dirname, "cam.html"));
    // Never recorded: the video gets the camera bubble burned in by the
    // recording window, this window is just the control you drag around.
    try { camWin.setContentProtection(true); } catch {}
    try { camWin.setAlwaysOnTop(true, "screen-saver"); } catch {}
    camWin.on("move", () => { if (!shotStowing) camOverlayNotify({ final: false }); });
    camWin.on("closed", () => { camWin = null; });
    camWin.once("ready-to-show", () => {
      if (!camWin || camWin.isDestroyed()) return;
      camWin.showInactive();
      try { camWin.webContents.send("cam:size", camLabels[camScaleIdx]); } catch {}
    });
    return { ok: true, pos: camOverlayNorm(), size: camLabels[camScaleIdx] };
  }

  ipcMain.handle("cam:open", (e, opts) => {
    camOwner = e.sender;
    try {
      camOwner.once("destroyed", () => {
        if (camWin && !camWin.isDestroyed()) camWin.close();
        camWin = null;
        // A recording window that dies mid-recording would otherwise leave
        // every other window content-protected (i.e. a black rectangle on
        // Windows) until the next recording toggles it off.
        if (recHideActive) releaseContentProtection();
      });
    } catch {}
    return openCamOverlay(opts && opts.scale);
  });
  ipcMain.on("cam:close", () => closeCamOverlay());
  ipcMain.handle("cam:dragStart", () => {
    if (!camWin || camWin.isDestroyed()) return null;
    const b = camWin.getBounds();
    return { x: b.x, y: b.y };
  });
  ipcMain.on("cam:dragTo", (e, pos) => {
    if (!camWin || camWin.isDestroyed() || !pos || typeof pos.x !== "number" || typeof pos.y !== "number") return;
    const size = camOverlaySize();
    let x = pos.x, y = pos.y;
    try {
      const wa = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
      const minVis = 20;
      x = Math.min(Math.max(x, wa.x - size.w + minVis), wa.x + wa.width - minVis);
      y = Math.min(Math.max(y, wa.y - size.h + minVis), wa.y + wa.height - minVis);
    } catch {}
    camWin.setPosition(Math.round(x), Math.round(y));
  });
  ipcMain.on("cam:dragEnd", () => camOverlayNotify({ final: true }));
  ipcMain.on("cam:cycleSize", () => {
    camScaleIdx = (camScaleIdx + 1) % CAM_OVERLAY_SIZES.length;
    if (camWin && !camWin.isDestroyed()) {
      const b = camWin.getBounds();
      const size = camOverlaySize();
      camWin.setBounds({
        x: Math.round(b.x + b.width / 2 - size.w / 2), y: Math.round(b.y + b.height / 2 - size.h / 2),
        width: size.w, height: size.h
      });
      try { camWin.webContents.send("cam:size", camLabels[camScaleIdx]); } catch {}
    }
    camOverlayNotify({ final: true, scale: camScaleIdx });
    if (camOwner && !camOwner.isDestroyed()) {
      try { camOwner.send("cam:resized", { scale: camScaleIdx, label: camLabels[camScaleIdx] }); } catch {}
    }
  });
  ipcMain.on("cam:frame", (e, dataUrl) => {
    if (!camWin || camWin.isDestroyed() || typeof dataUrl !== "string") return;
    try { camWin.webContents.send("cam:frame", dataUrl); } catch {}
  });
  ipcMain.on("cam:state", (e, state) => {
    if (!camWin || camWin.isDestroyed()) return;
    try { camWin.webContents.send("cam:state", state); } catch {}
  });

  /* Drop content protection everywhere. Used when a recording ends and as a
     safety net if the recording window disappears mid-recording. */
  function releaseContentProtection() {
    recHideActive = false;
    for (const w of [win, pipWin, camWin]) {
      if (!w || w.isDestroyed()) continue;
      try { w.setContentProtection(false); } catch {}
    }
  }

  /* Keep the app's own windows out of a running screen recording
     (Windows: WDA_EXCLUDEFROMCAPTURE, macOS: NSWindowSharingNone) so the video
     shows the screen plus the camera bubble — never the floating bar, HUD or
     live preview. Only the chat windows are touched: a quick note or the
     monitor dashboard on screen should still be recorded. */
  ipcMain.handle("capture:setContentProtection", (_, on) => {
    const hide = !!on;
    if (!hide) { releaseContentProtection(); return { ok: true, windows: 0 }; }
    recHideActive = true;
    let windows = 0;
    for (const w of [win, pipWin, camWin]) {
      if (!w || w.isDestroyed()) continue;
      try { w.setContentProtection(true); windows++; } catch {}
    }
    return { ok: true, windows: windows };
  });

  /* A screen recording must not be starved of frames: Chromium throttles timers
     in occluded/background windows and a sleeping display stops producing
     frames at all. The window doing the recording asks for this while it runs
     (and lets go when it stops, on discard and on error). */
  let recThrottleOff = new Set();
  let sleepBlockerId = null;
  ipcMain.handle("capture:recordingActive", (e, on) => {
    const active = !!on;
    try { e.sender.setBackgroundThrottling(!active); } catch {}
    if (active) recThrottleOff.add(e.sender);
    else recThrottleOff.delete(e.sender);
    if (recThrottleOff.size && sleepBlockerId === null) {
      try { sleepBlockerId = powerSaveBlocker.start("prevent-display-sleep"); } catch { sleepBlockerId = null; }
    } else if (!recThrottleOff.size && sleepBlockerId !== null) {
      try { powerSaveBlocker.stop(sleepBlockerId); } catch {}
      sleepBlockerId = null;
    }
    return { ok: true, active: active, holders: recThrottleOff.size };
  });

  /* Tell every window why a screenshot produced nothing, so the overlay can
     never close without the user seeing a reason. */
  function shotFailed(reason, short) {
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) { try { w.webContents.send("shot:failed", { reason, short }); } catch {} }
    });
  }

  ipcMain.on("shot:done", (e, sel) => {
    try {
      if (!shotImage || !sel || typeof sel.x !== "number") {
        console.error("[shot] invalid selection", !!shotImage, sel);
        if (shotWin && !shotWin.isDestroyed()) shotWin.close();
        shotFailed("Screenshot failed — nothing was selected", "Shot failed");
        return;
      }
      const imgSz = shotImage.getSize();
      const sx = Math.max(0, Math.round(sel.x));
      const sy = Math.max(0, Math.round(sel.y));
      const sw = Math.min(imgSz.width - sx, Math.round(sel.w));
      const sh = Math.min(imgSz.height - sy, Math.round(sel.h));
      if (sw < 2 || sh < 2) {
        console.error("[shot] selection too small", { sx, sy, sw, sh, imgSz });
        if (shotWin && !shotWin.isDestroyed()) shotWin.close();
        shotFailed("Selection too small — drag a region", "Too small");
        return;
      }
      const cropped = shotImage.crop({ x: sx, y: sy, width: sw, height: sh });
      ensure();
      const name = `shot-${captureStamp()}.png`;
      fs.writeFileSync(path.join(CAPDIR(), name), cropped.toPNG());
      if (shotWin && !shotWin.isDestroyed()) shotWin.close();
      // Let every open window know a new capture landed (refresh gallery).
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) w.webContents.send("capture:saved", { name, kind: "image" });
      });
    } catch (err) {
      console.error("[shot] save failed", err);
      if (shotWin && !shotWin.isDestroyed()) shotWin.close();
      shotFailed("Screenshot failed: " + ((err && err.message) || err), "Shot failed");
    }
  });

  ipcMain.on("shot:cancel", () => {
    shotCancelled = true;
    if (shotWin && !shotWin.isDestroyed()) shotWin.close();
  });

  /* World Monitor IPC */
  ipcMain.handle("monitor:quakes", async () => {
    try {
      const resp = await net.fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson");
      if (!resp.ok) return null;
      return await resp.json();
    } catch { return null; }
  });

  /* Real host metrics for SYSTEM STATUS / CONNECTED NODES panels.
   * Cached ~1s: sys-status (2s) + net-io (1s) both call this. */
  let prevCpuTimes = null;
  let sysCache = null;
  let sysCacheAt = 0;
  function sampleCpuTimes() {
    const cpus = os.cpus();
    let idle = 0, total = 0;
    for (const c of cpus) {
      for (const type in c.times) total += c.times[type];
      idle += c.times.idle;
    }
    return { idle, total };
  }
  async function readCpuPercent() {
    if (!prevCpuTimes) {
      prevCpuTimes = sampleCpuTimes();
      await new Promise(r => setTimeout(r, 80));
    }
    const next = sampleCpuTimes();
    const dIdle = next.idle - prevCpuTimes.idle;
    const dTotal = next.total - prevCpuTimes.total;
    prevCpuTimes = next;
    if (dTotal <= 0) return null;
    const pct = 100 - (dIdle / dTotal) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }

  ipcMain.handle("monitor:sys", async () => {
    const now = Date.now();
    if (sysCache && now - sysCacheAt < 1000) return sysCache;
    try {
      const cpu = await readCpuPercent();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const mem = totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : null;
      let disk = null;
      try {
        const st = fs.statfsSync(os.homedir());
        if (st && st.blocks > 0) disk = Math.round((1 - st.bfree / st.blocks) * 100);
      } catch { /* statfs unavailable → leave OFFLINE */ }
      const interfaces = [];
      const byName = os.networkInterfaces();
      for (const [name, addrs] of Object.entries(byName || {})) {
        for (const a of addrs || []) {
          if (a.internal) continue;
          if (a.family === "IPv4" || a.family === 4) {
            interfaces.push({ name, address: a.address, mac: a.mac || "" });
          }
        }
      }
      sysCache = {
        ok: true, cpu, mem, disk, interfaces,
        proxyRxBytes,
        hostname: os.hostname(),
        platform: process.platform,
        uptime: os.uptime()
      };
      sysCacheAt = now;
      return sysCache;
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  /* --- Generic proxied fetch for no-key public APIs -----------------------
   * Renderer fetch() to many of these hosts is blocked by CORS. Going
   * through the main process bypasses CORS entirely. Host allowlist keeps
   * the proxy from becoming an open relay. */
  const PROXY_HOSTS = new Set([
    "earthquake.usgs.gov",
    "eonet.gsfc.nasa.gov",
    "opensky-network.org",
    "api.wheretheiss.at",
    "celestrak.org", "celestrak.com",
    "api.coingecko.com",
    "open.er-api.com",
    "api.alternative.me",
    "api.open-meteo.com",
    "air-quality-api.open-meteo.com",
    "api.openaq.org",
    "api.openaq.com",
    "www.gdacs.org", "gdacs.org",
    "api.gdeltproject.org",
    "feeds.bbci.co.uk",
    "services.swpc.noaa.gov",
    "api.openaq.org",
    "api.ioda.inetintel.cc.gatech.edu",
    "min-api.cryptocompare.com",
    "query1.finance.yahoo.com", "query2.finance.yahoo.com",
    "stooq.com", "www.stooq.com",
    "himawari8.nict.go.jp",
    "www.aljazeera.com",
    "www.france24.com",
    "www.theguardian.com",
    "www.dw.com",
    "www.youtube.com",
    "db.satnogs.org",
    "feeds.skynews.com",
    "feeds.npr.org",
    "feeds.nbcnews.com",
    "www.cbsnews.com",
    "www.cbc.ca",
    "www.abc.net.au",
    "rss.dw.com",
    "www.euronews.com",
    "www.lemonde.fr",
    "www.haaretz.com",
    "www.channelnewsasia.com",
    "www.japantimes.co.jp",
    "thediplomat.com",
    "foreignpolicy.com",
    "www.defensenews.com",
    "time.com",
    "vnexpress.net",
    "tuoitre.vn",
    "thanhnien.vn",
    "news.un.org",
    "www.who.int",
    "www.submarinecablemap.com",
    "api.worldbank.org",
    "marine-api.open-meteo.com",
    "gamma-api.polymarket.com"
  ]);

  /* Cumulative response bytes through the proxy (NETWORK I/O panel).
     Declared before monitor:sys uses it. */
  let proxyRxBytes = 0;

  ipcMain.handle("monitor:proxy", async (_, url) => {
    try {
      if (typeof url !== "string" || !url.startsWith("https://")) return { ok: false, error: "bad-url" };
      const host = new URL(url).hostname.toLowerCase();
      if (!PROXY_HOSTS.has(host)) return { ok: false, error: "host-not-allowed" };
      const resp = await net.fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (WorldMonitor)" } });
      if (!resp.ok) return { ok: false, error: "http-" + resp.status };
      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("json")) {
        const json = await resp.json();
        try { proxyRxBytes += Buffer.byteLength(JSON.stringify(json)); } catch {}
        return { ok: true, json };
      }
      const text = await resp.text();
      proxyRxBytes += Buffer.byteLength(text);
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  /* Yahoo Finance v8 chart — fetched in PARALLEL (no artificial delay). */
  function yahooQuote(sym) {
    return new Promise((resolve) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
      const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            const meta = data && data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
            if (!meta) return resolve(null);
            const prev = meta.previousClose != null ? meta.previousClose : meta.chartPreviousClose;
            const price = meta.regularMarketPrice != null ? meta.regularMarketPrice : prev;
            if (price == null || prev == null) return resolve(null);
            resolve({
              symbol: sym,
              regularMarketPrice: price,
              regularMarketChangePercent: prev ? ((price - prev) / prev * 100) : 0,
              marketState: meta.marketState || "CLOSED"
            });
          } catch { resolve(null); }
        });
      });
      req.on("error", () => resolve(null));
      req.setTimeout(9000, () => { req.destroy(); resolve(null); });
    });
  }

  ipcMain.handle("monitor:indices", async () => {
    const symbols = [
      // Indices
      "^GSPC", "^IXIC", "^DJI", "^FTSE", "^GDAXI", "^N225", "^HSI", "000001.SS", "^STOXX50E",
      // Volatility + rates
      "^VIX", "^TNX", "2YY=F",
      // Commodities (futures)
      "GC=F", "SI=F", "HG=F", "CL=F", "BZ=F", "NG=F", "ZW=F", "ZC=F",
      // FX majors
      "EURUSD=X", "GBPUSD=X", "EURGBP=X", "CHFUSD=X", "JPY=X", "CNY=X", "INR=X", "BRL=X", "TRY=X"
    ];
    const settled = await Promise.all(symbols.map(yahooQuote));
    const results = settled.filter(Boolean);
    return { quoteResponse: { result: results, error: null } };
  });

  ipcMain.handle("monitor:2y-yield", async () => {
    const q = await yahooQuote("2YY=F");
    if (!q) return null;
    return {
      chart: { result: [{ meta: q }] }
    };
  });

  /* ---- Live push hub: poll in main → monitor:live → renderer re-renders.
   * Only runs while the monitor window is open. Pushes only on change.
   * Overlapping ticks are skipped (no stacked fetches). */
  let liveTimers = [];
  const liveSigs = new Map();
  const liveBusy = new Set();
  const LIVE_SYMBOLS = [
    "^GSPC", "^IXIC", "^DJI", "^FTSE", "^GDAXI", "^N225", "^HSI", "000001.SS", "^STOXX50E",
    "^VIX", "^TNX", "2YY=F",
    "GC=F", "SI=F", "HG=F", "CL=F", "BZ=F", "NG=F", "ZW=F", "ZC=F",
    "EURUSD=X", "GBPUSD=X", "EURGBP=X", "CHFUSD=X", "JPY=X", "CNY=X", "INR=X", "BRL=X", "TRY=X"
  ];
  /* Real newsroom feeds only — each entry is a broadcaster's own RSS feed or
     its official YouTube upload feed (Atom), so every headline resolves to a
     real article or video. The list lives in src/monitor/news-sources.json so
     the renderer's fallback fetcher and this hub cannot drift apart. */
  let LIVE_NEWS = [];
  try {
    LIVE_NEWS = JSON.parse(fs.readFileSync(path.join(__dirname, "src", "monitor", "news-sources.json"), "utf8"));
  } catch (e) {
    console.warn("[monitor] news-sources.json unreadable:", e.message);
  }

  /** Fetch many feeds with a bounded number of in-flight requests. */
  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(new Array(Math.min(limit, items.length)).fill(0).map(async () => {
      while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
    }));
    return out;
  }
  const LIVE_REFRESH = [
    { feed: "gdacs",  ms: 60 * 1000 },
    { feed: "gdelt",  ms: 60 * 1000 },
    { feed: "weather", ms: 2 * 60 * 1000 },
    { feed: "space",  ms: 5 * 60 * 1000 },
    { feed: "airq",   ms: 5 * 60 * 1000 }
  ];

  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function pushMonitor(type, data) {
    if (!monitorWin || monitorWin.isDestroyed()) return;
    try { monitorWin.webContents.send("monitor:live", { type, data, t: Date.now() }); } catch {}
  }

  function pushIfChanged(type, data, sig) {
    if (liveSigs.get(type) === sig) return;
    liveSigs.set(type, sig);
    pushMonitor(type, data);
  }

  async function liveFetchText(url) {
    try {
      const resp = await net.fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (WorldMonitor)" } });
      if (!resp.ok) return null;
      return await resp.text();
    } catch { return null; }
  }

  async function liveFetchJson(url) {
    try {
      const resp = await net.fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (WorldMonitor)" } });
      if (!resp.ok) return null;
      return await resp.json();
    } catch { return null; }
  }

  async function pollLiveNews() {
    const parts = await mapLimit(LIVE_NEWS, 8, async s => {
      const text = await liveFetchText(s.url);
      return text ? { name: s.name, url: s.url, text } : null;
    });
    const ok = parts.filter(Boolean);
    if (!ok.length) return;
    const titles = ok.flatMap(p => (p.text.match(/<title[^>]*>[\s\S]*?<\/title>/gi) || []).slice(0, 16));
    pushIfChanged("news", ok, hashStr(titles.join("|")));
  }

  async function pollLiveQuakes() {
    const data = await liveFetchJson("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson");
    if (!data || !data.features || !data.features.length) return;
    const ids = data.features.slice(0, 8).map(f => f.id).join(",");
    pushIfChanged("quakes", data, data.features.length + "|" + ids);
  }

  async function pollLiveIndices() {
    const settled = await Promise.all(LIVE_SYMBOLS.map(yahooQuote));
    const results = settled.filter(Boolean);
    if (!results.length) return;
    const sig = results.map(r => r.symbol + ":" + (r.regularMarketPrice || 0).toFixed(4)).join("|");
    pushIfChanged("indices", { quoteResponse: { result: results, error: null } }, sig);
  }

  function startLiveHub() {
    stopLiveHub();
    const tick = (name, fn, ms, immediate) => {
      const run = async () => {
        if (liveBusy.has(name)) return;
        liveBusy.add(name);
        try { await fn(); } catch { /* feed error → skip cycle */ }
        finally { liveBusy.delete(name); }
      };
      if (immediate) run();
      liveTimers.push(setInterval(run, ms));
    };
    tick("news", pollLiveNews, 30 * 1000, true);
    tick("quakes", pollLiveQuakes, 20 * 1000, true);
    tick("indices", pollLiveIndices, 30 * 1000, true);
    for (const r of LIVE_REFRESH) {
      tick(r.feed, () => pushMonitor("refresh", { feed: r.feed }), r.ms, false);
    }
  }

  function stopLiveHub() {
    for (const t of liveTimers) clearInterval(t);
    liveTimers = [];
  }

  /* ---- Floating PiP chat bubble ------------------------------------------
   * A tiny always-on-top window that expands into a full mini-chat.
   * Same index.html, pip=1 hides the nav rail and shows a bubble pill.
   */
  /* Free-drag the collapsed bubble: NO edge snapping, and the position is
     persisted so it can be parked anywhere on the screen. Clicking it
     expands the chat CENTERED on the screen (not offset where the bubble
     was); collapsing returns the bubble to where you left it. */
  let lastBubblePos = null; // bubble position remembered at expand time

  /* Recentre the pip window on a point (keeps current size). */
  function recenterPipOn(cx, cy) {
    if (!pipWin || pipWin.isDestroyed()) return;
    const [w, h] = pipWin.getSize();
    pipWin.setPosition(Math.round(cx - w / 2), Math.round(cy - h / 2));
  }

  /* Smoothly tween the pip window to a target bounds box (expand / collapse /
     resize feel animated instead of snapping). Cancels any in-flight tween. */
  let pipAnimTimer = null;
  function animatePipBounds(target, duration = 150) {
    if (pipAnimTimer) { clearInterval(pipAnimTimer); pipAnimTimer = null; }
    if (!pipWin || pipWin.isDestroyed()) return;
    const from = pipWin.getBounds();
    if (from.x === target.x && from.y === target.y &&
        from.width === target.width && from.height === target.height) return;
    const t0 = Date.now();
    pipAnimTimer = setInterval(() => {
      if (!pipWin || pipWin.isDestroyed()) {
        clearInterval(pipAnimTimer); pipAnimTimer = null; return;
      }
      const p = Math.min(1, (Date.now() - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
      pipWin.setBounds({
        x: Math.round(from.x + (target.x - from.x) * e),
        y: Math.round(from.y + (target.y - from.y) * e),
        width: Math.round(from.width + (target.width - from.width) * e),
        height: Math.round(from.height + (target.height - from.height) * e)
      });
      if (p >= 1) { clearInterval(pipAnimTimer); pipAnimTimer = null; }
    }, 16);
  }

  /* Centre the expanded chat on the screen it currently sits on. */
  function centerPipOnScreen() {
    if (!pipWin || pipWin.isDestroyed()) return;
    const b = pipWin.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    pipWin.setPosition(
      wa.x + Math.round((wa.width - b.width) / 2),
      wa.y + Math.round((wa.height - b.height) / 2)
    );
  }

  /* Target bounds for the expanded chat, centred on its current display. */
  function expandedPipBounds() {
    const b = pipWin.getBounds();
    return expandedBoundsOn(screen.getDisplayMatching(b).workArea);
  }

  /* The expanded chat centred on a given work area — used when a popup is
     CREATED (it is born already expanded) and when a bar grows into one. */
  function expandedBoundsOn(wa) {
    const cs = pipChatSize(wa);
    return {
      x: wa.x + Math.round((wa.width - cs.w) / 2),
      y: wa.y + Math.round((wa.height - cs.h) / 2),
      width: cs.w, height: cs.h
    };
  }

  /* Expanded popup size: ~50% of the work area (floored so the chat never
     gets so small its text becomes unreadable). Takes an explicit work area so
     a window can be created at the right size before it exists. */
  function pipChatSize(ofWa) {
    const fallback = { w: PIP_CHAT.w, h: PIP_CHAT.h };
    try {
      const wa = ofWa || (!pipWin || pipWin.isDestroyed()
        ? screen.getPrimaryDisplay().workArea
        : screen.getDisplayMatching(pipWin.getBounds()).workArea);
      const minW = 360, minH = 440;
      const w = Math.min(Math.max(Math.round(wa.width * 0.5), minW), Math.max(minW, wa.width - 24));
      const h = Math.min(Math.max(Math.round(wa.height * 0.5), minH), Math.max(minH, wa.height - 24));
      return { w, h };
    } catch { return fallback; }
  }

  /* Debounced persistence of the bubble position (drags fire many 'moved'). */
  let pipPosTimer = null;
  function persistBubblePos() {
    // While a screenshot parks the bubble off-screen its position must not be
    // written back to pip.json (the bubble would reopen somewhere unreachable).
    if (shotStowing) return;
    if (!pipWin || pipWin.isDestroyed() || !pipCollapsed) return;
    clearTimeout(pipPosTimer);
    pipPosTimer = setTimeout(() => {
      if (!pipWin || pipWin.isDestroyed()) return;
      const [x, y] = pipWin.getPosition();
      savePipCfg({ x, y });
    }, 250);
  }

  /* Open the floating window.
   *   openPip()                     → the chat, at its remembered spot (rail)
   *   openPip({expand:false, dock}) → the BAR, collapsed, docked to an edge
   * The second form is what launch / "minimize the app" use: the floating bar
   * has to be there immediately, on one side, with nothing in between. */
  function openPip(opts) {
    const o = opts || {};
    const expand = o.expand !== false;
    if (pipWin && !pipWin.isDestroyed()) {
      if (expand) {
        pipWin.show();
        // Showing the chat means showing the CHAT, not the pill it was left as.
        if (pipCollapsed) ipcMain.emit("pip:expand");
        pipWin.focus();
      }
      // Asked for the bar while the chat is open → collapse it right now.
      else if (!pipCollapsed) ipcMain.emit("pip:collapse");
      return pipWin;
    }
    const cfg = loadPipCfg();
    pipVertical = cfg.vertical !== false;
    const s = pipBubbleSize();
    const docked = expand ? null : dockPipBounds(o.dock);
    // Reuse the saved bubble position when there is one (clamped inside the
    // work area so the bubble can never be lost off-screen).
    const hasSaved = !docked && typeof cfg.x === "number" && typeof cfg.y === "number";
    const wa = hasSaved
      ? screen.getDisplayNearestPoint({ x: cfg.x, y: cfg.y }).workArea
      : screen.getPrimaryDisplay().workArea;
    /* A popup is BORN at its expanded size, centred. Creating it pill-sized
       and only telling the renderer "expanded" afterwards left the whole chat
       squeezed into a 56×248 window (and, because `pipCollapsed` was already
       false, the auto-expand that was supposed to fix it never ran). */
    const chat = expand ? expandedBoundsOn(wa) : null;
    const x = chat ? chat.x : docked ? docked.x : hasSaved
      ? Math.min(Math.max(cfg.x, wa.x), wa.x + wa.width - s.w)
      : wa.x + wa.width - s.w - 8;
    const y = chat ? chat.y : docked ? docked.y : hasSaved
      ? Math.min(Math.max(cfg.y, wa.y), wa.y + wa.height - s.h)
      : wa.y + Math.round(wa.height * 0.3);
    pipWin = new BrowserWindow({
      width: chat ? chat.width : s.w, height: chat ? chat.height : s.h,
      x, y,
      frame: false, transparent: true, resizable: false,
      alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
      backgroundColor: "#00000000",
      icon: APP_ICON,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true, nodeIntegration: false, sandbox: false,
        spellcheck: false, backgroundThrottling: true
      }
    });
    // `pipCollapsed` is what the rest of the pip:* handlers read, so it is set
    // before the window exists (it decides what state the renderer is told).
    pipCollapsed = !expand;
    pipMaximized = false;
    pipAutoExpand = expand;
    if (docked) savePipCfg({ x: docked.x, y: docked.y });
    pipWin.loadFile(path.join(__dirname, "index.html"), { query: { pip: "1" } });
    // Content protection is applied ONLY while a recording actually hides the
    // app (see capture:setContentProtection) — never permanently at creation.
    // On Windows, keeping a *transparent* window content-protected makes it
    // render as an opaque black rectangle (electron#45990 / #46180 / #47834),
    // which is exactly a floating bubble that "turned black". It also ignored
    // the user's "Hide this window from recordings" setting.
    try { pipWin.setContentProtection(recHideActive); } catch {}
    // Free dragging — no snap-to-edge; just remember where you park it.
    // 'move' fires on every platform while dragging; 'moved' fires once on
    // some platforms. Both just debounce-save the position.
    pipWin.on("move", persistBubblePos);
    pipWin.on("moved", persistBubblePos);
    pipWin.on("closed", () => {
      if (pipAnimTimer) { clearInterval(pipAnimTimer); pipAnimTimer = null; }
      pipMaximized = false;
      pipPreMaxBounds = null;
      pipWin = null;
    });
    pipWin.webContents.on("did-finish-load", () => {
      if (!pipWin || pipWin.isDestroyed()) return;
      pipWin.webContents.send("pip:orient", pipVertical ? "vertical" : "horizontal");
      /* Tell the renderer which of the two states this window is in. The
         window was created at the matching size already, so there is nothing
         left to resize here — this is purely "you are the bar" / "you are the
         chat", and it is the ONLY place that says so on open. */
      try { pipWin.webContents.send("pip:state", pipCollapsed ? "collapsed" : "expanded"); } catch {}
    });
  }

  ipcMain.on("pip:open", () => openPip());
  /* The floating BAR, docked to one side, right now. Used on launch and when
     the main window is minimized — the user gets the bar immediately instead
     of having to collapse a window first. */
  ipcMain.on("pip:openbar", (e, side) => {
    const w = openPip({ expand: false, dock: side });
    if (!w || w.isDestroyed()) return;
    try { w.setAlwaysOnTop(true); w.setSkipTaskbar(true); } catch {}
    try { w.showInactive(); } catch {}
    try { w.webContents.send("pip:state", "collapsed"); } catch {}
  });
  /* Rail toggle: never kill the floating window by accident.
     closed → the BAR, docked (so the floating bar really "starts" on one side)
     expanded → collapse · collapsed → expand */
  ipcMain.on("pip:toggle", () => {
    if (!pipWin || pipWin.isDestroyed()) { openPip({ expand: false }); return; }
    try { pipWin.show(); } catch {}
    if (pipCollapsed) {
      ipcMain.emit("pip:expand");
    } else {
      ipcMain.emit("pip:collapse");
    }
  });
  /* "Minimize the app into the floating bar": put the chat WINDOW away (hidden,
     so it leaves the taskbar too) and leave the bar docked + collapsed on the
     side. The bar is how the app is meant to be used at this size, so with a
     bar already open there was no way back down to just the bubble — the rail
     button flipped the bubble open/closed instead. The way back is the bubble
     itself (tap it to open the chat popup), launching the app again, or closing
     the bar (see pip:close below). */
  ipcMain.on("app:tuckIntoBar", () => {
    if (!alive(win)) return;
    let cfg = {};
    try { cfg = loadCfg(); } catch {}
    if (!alive(pipWin)) ipcMain.emit("pip:openbar", {}, cfg.pipDock);
    else if (!pipCollapsed) ipcMain.emit("pip:collapse");
    try { win.hide(); } catch {}
    // Teach the way back once, in the window that is still on screen.
    setTimeout(() => {
      if (alive(pipWin)) { try { pipWin.webContents.send("pip:hint", { text: "Tap the bubble to chat — reopen the app from its shortcut" }); } catch {} }
    }, 500);
  });
  /* Maximize / restore. A frameless transparent window has no OS maximize box,
     so the header button (or a double-click on the header) drives this.
     Maximized is a real app-window state: full work-area bounds, no always-on-
     top so other windows can come forward, plus a taskbar entry. */
  ipcMain.on("pip:maximize", () => {
    if (!pipWin || pipWin.isDestroyed() || pipCollapsed) return;
    if (pipMaximized) {
      pipMaximized = false;
      const back = pipPreMaxBounds || expandedPipBounds();
      pipPreMaxBounds = null;
      animatePipBounds(back, 150);
      try { pipWin.setAlwaysOnTop(true); pipWin.setSkipTaskbar(true); } catch {}
    } else {
      pipPreMaxBounds = pipWin.getBounds();
      pipMaximized = true;
      const wa = pipWorkArea();
      animatePipBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height }, 170);
      try { pipWin.setAlwaysOnTop(false); pipWin.setSkipTaskbar(false); } catch {}
    }
    try { pipWin.webContents.send("pip:maximized", pipMaximized); } catch {}
  });
  /* Dock the collapsed bar to a screen edge (Settings → Dock to). */
  ipcMain.on("pip:dock", (e, side) => {
    const s = side === "left" ? "left" : "right";
    if (!pipWin || pipWin.isDestroyed() || !pipCollapsed) return;
    const t = dockPipBounds(s);
    animatePipBounds(t, 160);
    savePipCfg({ x: t.x, y: t.y });
  });
  /* "Start with Windows" toggle — returns what the OS really reports back. */
  ipcMain.handle("app:startAtLogin", (e, on) => {
    try {
      app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: [] });
      return !!(app.getLoginItemSettings() || {}).openAtLogin;
    } catch (err) {
      console.warn("[Main] start-at-login failed:", (err && err.message) || err);
      return false;
    }
  });
  ipcMain.on("pip:close", () => {
    if (!alive(pipWin)) return;
    pipWin.close();
    /* Closing the bar must never leave the app with nothing on screen: if the
       chat window was tucked away into the bar, bring it back. */
    if (alive(win) && !win.isVisible()) { try { win.show(); win.focus(); } catch {} }
  });
  // Renderer may miss the push on did-finish-load (race with initPipMode);
  // it pulls the current orientation once its listener is registered.
  ipcMain.handle("pip:getorient", () =>
    pipVertical ? "vertical" : "horizontal"
  );
  /* The renderer pulls this once on startup: the pip:state push above can beat
     its listener (main sends it on did-finish-load, which may run before the
     async renderer init), and a popup born expanded would then paint the pill
     forever. Same reason as pip:getorient. */
  ipcMain.handle("pip:getstate", () =>
    pipCollapsed ? "collapsed" : "expanded"
  );

  /* JS-driven drag: the renderer asks for the window position on pointerdown
     and sends absolute targets as the pointer moves (native -webkit-app-region
     drag doesn't work on frameless transparent windows). */
  ipcMain.handle("pip:getpos", () => {
    if (!pipWin || pipWin.isDestroyed()) return null;
    const [x, y] = pipWin.getPosition();
    return { x, y };
  });
  ipcMain.on("pip:dragto", (e, pos) => {
    if (!pipWin || pipWin.isDestroyed() || !pipCollapsed) return;
    if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return;
    // Keep at least a sliver of the bubble on-screen so it can't be lost.
    const s = pipBubbleSize();
    const minVis = 24;
    let x = pos.x, y = pos.y;
    try {
      const wa = screen.getDisplayNearestPoint({ x, y }).workArea;
      x = Math.min(Math.max(x, wa.x - s.w + minVis), wa.x + wa.width - minVis);
      y = Math.min(Math.max(y, wa.y - s.h + minVis), wa.y + wa.height - minVis);
    } catch { /* multi-monitor edge → use raw coords */ }
    pipWin.setPosition(Math.round(x), Math.round(y));
  });

  ipcMain.on("pip:resize", () => {
    // Bubble-size slider changed in Settings — resize the pill in place,
    // keeping its centre fixed so it doesn't jump around.
    if (!pipWin || pipWin.isDestroyed() || !pipCollapsed) return;
    const b = pipWin.getBounds();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const s = pipBubbleSize();
    pipWin.setMinimumSize(0, 0);
    pipWin.setResizable(false);
    animatePipBounds({
      x: Math.round(cx - s.w / 2), y: Math.round(cy - s.h / 2),
      width: s.w, height: s.h
    }, 130);
  });

  ipcMain.on("pip:flip", () => {
    pipVertical = !pipVertical;
    savePipCfg({ vertical: pipVertical });
    if (pipWin && !pipWin.isDestroyed()) {
      if (pipCollapsed) {
        const b = pipWin.getBounds();
        const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
        const s = pipBubbleSize();
        pipWin.setMinimumSize(0, 0);
        pipWin.setResizable(false);
        animatePipBounds({
          x: Math.round(cx - s.w / 2), y: Math.round(cy - s.h / 2),
          width: s.w, height: s.h
        }, 130);
      }
      pipWin.webContents.send("pip:orient", pipVertical ? "vertical" : "horizontal");
    }
  });

  ipcMain.on("pip:expand", () => {
    if (!pipWin || pipWin.isDestroyed()) return;
    if (pipCollapsed) {
      lastBubblePos = pipWin.getPosition();
      pipCollapsed = false;
      pipWin.setResizable(true);
      pipWin.setMinimumSize(0, 0);
      animatePipBounds(expandedPipBounds(), 170); // centred, smooth grow
      pipWin.setAlwaysOnTop(true);
      pipWin.setSkipTaskbar(true);
    }
    // Re-assert even when we were already expanded: a renderer that drifted out
    // of sync must never be left showing the pill inside a big window.
    try { pipWin.webContents.send("pip:state", "expanded"); } catch {}
  });

  ipcMain.on("pip:resizeto", (e, size) => {
    // Resize the expanded popup freely (compress/expand) via the corner grip.
    if (!pipWin || pipWin.isDestroyed() || pipCollapsed) return;
    if (!size || typeof size.w !== "number" || typeof size.h !== "number") return;
    try {
      const wa = screen.getDisplayMatching(pipWin.getBounds()).workArea;
      const minW = 360, minH = 440;
      const w = Math.min(Math.max(Math.round(size.w), minW), Math.max(minW, wa.width - 24));
      const h = Math.min(Math.max(Math.round(size.h), minH), Math.max(minH, wa.height - 24));
      pipWin.setMinimumSize(0, 0);
      pipWin.setSize(w, h);
      pipWin.setResizable(true);
    } catch {}
  });

  ipcMain.on("pip:collapse", () => {
    if (!pipWin || pipWin.isDestroyed()) return;
    if (pipMaximized) {
      pipMaximized = false;
      pipPreMaxBounds = null;
      try { pipWin.setAlwaysOnTop(true); pipWin.setSkipTaskbar(true); } catch {}
      try { pipWin.webContents.send("pip:maximized", false); } catch {}
    }
    pipCollapsed = true;
    const s = pipBubbleSize();
    // Minimizing lands on the floating bar in the SAME tick: an animated shrink
    // walked the window through every intermediate size, so the user saw a
    // half-sized window instead of the bar (and sometimes had to click again).
    if (pipAnimTimer) { clearInterval(pipAnimTimer); pipAnimTimer = null; }
    pipWin.setMinimumSize(0, 0);
    pipWin.setResizable(false);
    // Send the bubble back to where it was parked before expanding.
    const cfg = loadPipCfg();
    const bx = typeof cfg.x === "number" ? cfg.x : null;
    const by = typeof cfg.y === "number" ? cfg.y : null;
    let target;
    if (bx != null && by != null) {
      target = { x: bx, y: by, width: s.w, height: s.h };
    } else if (lastBubblePos) {
      target = { x: lastBubblePos[0], y: lastBubblePos[1], width: s.w, height: s.h };
    } else {
      const b = pipWin.getBounds();
      target = {
        x: b.x + Math.round((b.width - s.w) / 2),
        y: b.y + Math.round((b.height - s.h) / 2),
        width: s.w, height: s.h
      };
    }
    lastBubblePos = null;
    try { pipWin.setBounds(target); } catch {}
    pipWin.setAlwaysOnTop(true);
    pipWin.setSkipTaskbar(true);
    // Windows can drop a resize that happens in the same turn as the
    // resizable-style change, so the target is re-asserted once afterwards.
    setTimeout(() => {
      if (pipWin && !pipWin.isDestroyed() && pipCollapsed) {
        try { pipWin.setBounds(target); } catch {}
      }
    }, 60);
    try { pipWin.webContents.send("pip:state", "collapsed"); } catch {}
  });

  /* Realtime sync: a change saved in one window is replayed into the others. */
  ipcMain.on("state:broadcast", (e, data) => {
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed() && w.webContents !== e.sender) {
        w.webContents.send("state:changed", data);
      }
    });
  });
  ipcMain.on("settings:broadcast", (e, data) => {
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed() && w.webContents !== e.sender) {
        w.webContents.send("settings:changed", data);
      }
    });
  });

  /* Recording finished → replay into every window so the gallery refreshes. */
  ipcMain.on("capture:broadcast", (_, info) => {
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send("capture:saved", info || {});
    });
  });

  ipcMain.on("monitor:open", () => {
    if (alive(monitorWin)) { monitorWin.focus(); startLiveHub(); return; }
    try {
      monitorWin = new BrowserWindow({
        frame: false, fullscreen: true,
        backgroundColor: "#0a0a0a",
        webPreferences: {
          preload: path.join(__dirname, "monitor-preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false
        }
      });
      monitorWin.loadFile(path.join(__dirname, "monitor.html"));
      monitorWin.webContents.on("did-finish-load", () => startLiveHub());
      monitorWin.on("closed", () => { monitorWin = null; stopLiveHub(); });
    } catch (err) {
      console.error("[Main] monitor creation failed:", err);
    }
  });

  ipcMain.on("monitor:close", () => { stopLiveHub(); if (alive(monitorWin)) monitorWin.close(); });
}

/* "Start with Windows" — re-applied on every launch so a reinstall (which
   moves the exe) can never leave a stale login entry behind. */
function applyLoginItem(cfg) {
  try { app.setLoginItemSettings({ openAtLogin: !!cfg.startAtLogin, path: process.execPath, args: [] }); }
  catch (err) { console.warn("[Main] login item failed:", (err && err.message) || err); }
}

/* Desktop-only startup extras (skipped when a smoke test boots this file):
   register the login item and put the floating bar on its dock right away, so
   the bar is there — on one side — the moment the app (or the PC) comes up. */
function startupExtras() {
  let cfg = {};
  try { cfg = loadCfg(); } catch {}
  applyLoginItem(cfg);
  if (cfg.pipOnStartup === false) return;
  setTimeout(() => {
    try {
      if (pipWin && !pipWin.isDestroyed()) return;
      ipcMain.emit("pip:openbar", {}, cfg.pipDock);
    } catch (err) { console.warn("[Main] startup bar failed:", (err && err.message) || err); }
  }, 900);
}

/* Idempotent: brings the chat window up if it is already there, builds it when
   it is gone. Closing the chat window with the floating bar still open keeps
   the app running, so "the window is gone" is a normal state — never assume the
   variable still points at something alive. */
function createWindow() {
  if (alive(win)) {
    try {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } catch {}
    return win;
  }

  const cfg = loadCfg();
  nativeTheme.themeSource = cfg.darkMode ? "dark" : "light";
  const w = new BrowserWindow({
    width: 1200, height: 800, minWidth: 800, minHeight: 560,
    autoHideMenuBar: true,
    icon: APP_ICON,
    backgroundColor: cfg.darkMode ? "#18191a" : "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win = w; // reference the local window everywhere below: a late event from an
           // old window must never touch the new one
  w.loadFile(path.join(__dirname, "index.html"));

  /* Minimizing the app reveals the floating bar immediately instead of just
     dropping into the taskbar — one click, no intermediate window. */
  w.on("minimize", () => {
    let mcfg = {};
    try { mcfg = loadCfg(); } catch {}
    if (mcfg.pipOnMinimize === false) return;
    if (alive(pipWin)) {
      if (!pipCollapsed) ipcMain.emit("pip:collapse"); // expanded → the bar
      return;
    }
    ipcMain.emit("pip:openbar", {}, mcfg.pipDock);
  });

  /* Forget the window instead of keeping a destroyed object around — that
     dangling reference is what made Electron throw "Object has been destroyed". */
  w.on("closed", () => { if (win === w) win = null; });
  return w;
}

app.whenReady().then(() => {
  ensure();
  registerHandlers();
  registerQuickShortcut();

  // Voice + screen/camera capture: allow mic/cam/screen without native prompts.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const ok = permission === "media" ||
      permission === "display-capture" ||
      permission === "camera" ||
      permission === "microphone" ||
      permission === "fullscreen";
    callback(ok);
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

  // getDisplayMedia() for screen recording — auto-pick the display under
  // the cursor so the user isn't stuck in a Chromium picker.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const pt = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 }
      });
      const match = sources.find(s => String(s.display_id) === String(pt.id)) || sources[0];
      if (match) callback({ video: match });
      else callback({ video: undefined });
    } catch (err) {
      console.error("[display-media]", err);
      callback({ video: undefined });
    }
  });

  /* Serve stored bytes back to the renderer. Captures (screenshots + screen
     recordings) live in their own folder, so they have to be resolved here
     too or the media library/preview 404s. Media elements also ask for byte
     ranges — without 206 + accept-ranges Chromium refuses to seek, and a
     webm straight out of MediaRecorder (no duration in its header) then
     looks like a dead player. */
  protocol.handle("local-file", async req => {
    // Accept both shapes of the URL: "local-file:///name" (renderer src) and
    // "local-file://name/" (how net.fetch canonicalizes a standard scheme).
    const u = new URL(req.url);
    const sn = decodeURIComponent(u.pathname.replace(/^\/+/, "") || u.hostname);
    // Resolve the name in whichever store actually holds it — a plain `||`
    // chain would stop at files/<name> (resolve-able but missing) and never
    // reach voice/ or captures/, which is why recordings 404'd.
    const f = [FDIR, VDIR, CAPDIR]
      .map(dir => safeFile(sn, dir))
      .find(p => p && fs.existsSync(p));
    if (!f) return new Response("Not found", { status: 404 });
    const st = fs.statSync(f);
    const type = mimeOf(f);
    const common = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-cache" };

    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
    if (m) {
      const size = st.size;
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (!m[1] && m[2]) { // suffix range: last N bytes
        start = Math.max(0, size - parseInt(m[2], 10));
        end = size - 1;
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
        return new Response(null, { status: 416, headers: { ...common, "content-range": `bytes */${size}` } });
      }
      end = Math.min(end, size - 1);
      return new Response(Readable.toWeb(fs.createReadStream(f, { start, end })), {
        status: 206,
        headers: {
          ...common,
          "content-length": String(end - start + 1),
          "content-range": `bytes ${start}-${end}/${size}`
        }
      });
    }

    return new Response(Readable.toWeb(fs.createReadStream(f)), {
      headers: { ...common, "content-length": String(st.size) }
    });
  });

  createWindow();
  if (!IS_TEST_BOOT) startupExtras();
});

/* Launching the app again (shortcut, taskbar, second click on the exe) must
   always end with the chat window in front — even when only the floating bar
   survived, and never by poking a destroyed window. */
app.on("second-instance", () => {
  try { createWindow(); }
  catch (err) { console.warn("[Main] second-instance failed:", (err && err.message) || err); }
});
app.on("will-quit", () => { try { globalShortcut.unregisterAll(); } catch {} });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => {
  try { createWindow(); }
  catch (err) { console.warn("[Main] activate failed:", (err && err.message) || err); }
});
