const { app, BrowserWindow, ipcMain, dialog, shell, protocol, Notification, nativeTheme, net, nativeImage, session, screen, globalShortcut, desktopCapturer, powerSaveBlocker, powerMonitor, Tray, Menu, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const os = require("os");
const { Readable } = require("stream");
const portableJanitor = require("./src/main/portable-janitor.js");
const atomic = require("./src/main/atomic-write.js");
const store = require("./src/main/store.js");
const storeMigrations = require("./src/main/store-migrations.js");
const { installIpcGuard, pageRole, roleForUrl, permissionAllowed } = require("./src/main/ipc-policy.js");
const { externalUrl, isAppPage } = require("./src/main/security.js");
const { createMonitorProxy } = require("./src/main/monitor-proxy.js");
const { createMonitorScheduler } = require("./src/main/monitor-scheduler.js");

protocol.registerSchemesAsPrivileged([
  { scheme: "local-file", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
]);

/* Chromium brings up background services this app never asks for — the Cast media router, the global media
   controls, the translate and autofill-infrastructure clients, the reading-mode model. Each one is a helper
   process, a thread or a background download, and they start before any of Loopback's own code runs, so the
   switch has to be set here, before `app.whenReady()`. `CalculateNativeWinOcclusion` is in the list on
   purpose: it exists to tell Chromium when a window is covered, which costs a per-window timer, and this app
   keeps an always-on-top bubble that is overlapped by definition. Nothing Loopback does depends on any of
   them — the windows that need to keep running set `backgroundThrottling` themselves. */
app.commandLine.appendSwitch('disable-features', [
  'MediaRouter',
  'GlobalMediaControls',
  'HardwareMediaKeyHandling',
  'CalculateNativeWinOcclusion',
  'Translate',
  'AutofillServerCommunication',
  'OptimizationGuideModelDownloading',
  'InterestFeedContentSuggestions',
  'ReadAnything',
  'SpareRendererForSitePerProcess'
].join(','));

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
let reviewWin = null;   // the screenshot review that opens right after a shot
let reviewName = null;  // capture being reviewed (captures/<name>)
let reviewNote = "";    // the note typed on the review card — printed into the image
let reviewBase = null;  // pristine bytes of that capture, so a note can be undone

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
let tray = null;           // system-tray icon — the app's life in the background
let isQuitting = false;    // true only when the user really asked to quit
let trayBalloonShown = false; // "still running" tip: once per session
let trayMenu = [];         // the live tray menu template (already built into Tray)
/* Windows launches the login item with this flag (see setLoginItem). A boot
   launch is meant to come up already running — tray + floating bar — without
   throwing the full chat window in the user's face. */
const AUTOSTART_FLAG = "--autostart";
const STARTED_HIDDEN = process.argv.includes(AUTOSTART_FLAG);
/* Smoke tests boot this module with `require("./main.js")`. The desktop-only
   startup extras (login item, floating bar on launch) are skipped for them so
   the tests' own windows stay undisturbed. */
const IS_TEST_BOOT = !!(require.main && require.main.filename && require.main.filename !== __filename);
/* Smoke tests stay window-only by default; traytest.js sets this to exercise
   the real background path (tray icon + keep-alive) in the same process. */
const TRAY_IN_TEST = process.env.LOOPBACK_TRAY_TEST === "1";
const PIP_BUBBLE_H = { w: 280, h: 52 }; // horizontal pill (fits shot/rec/media tools)
const PIP_BUBBLE_V = { w: 56, h: 248 }; // vertical bookmark tab (fits stacked tools)
const PIP_CHAT = { w: 430, h: 700 };
const PIP_CFG = () => path.join(app.getPath("userData"), "pip.json");

function loadPipCfg() {
  // Same atomic reader as the store: a torn pip.json is recovered from its .bak instead of silently resetting
  // the bar's saved position/orientation.
  const value = atomic.readJsonSync(PIP_CFG(), {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function savePipCfg(patch) {
  try {
    const cur = loadPipCfg();
    Object.assign(cur, patch || {});
    atomic.writeFileAtomicSync(PIP_CFG(), JSON.stringify(cur));
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

/* Every payload that crosses the bridge has a ceiling. Without one, a bug in a renderer (or a page that got
   in) could ask the main process to allocate and write an unbounded buffer. The numbers are generous for the
   feature they belong to: a pasted image, a voice note and a screen recording all fit comfortably. */
const MAX_NOTE_CHARS = 100 * 1000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VOICE_BYTES = 25 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
const CAPTURE_EXT = /\.(png|jpg|jpeg|webp|webm|mp4|mov)$/i;

/** Decodes a base64 data URL with a hard byte cap. Returns `{ buf, mime }` or `{ error }`. */
function bufferFromDataUrl(raw, maxBytes) {
  if (typeof raw !== "string" || !/^data:/i.test(raw)) return { error: "bad-data" };
  const comma = raw.indexOf(",");
  if (comma < 0) return { error: "bad-data" };
  const meta = raw.slice(5, comma);
  if (!/;base64/i.test(meta)) return { error: "bad-data" };
  const b64 = raw.slice(comma + 1);
  if (b64.length > Math.ceil(maxBytes / 3) * 4 + 16) return { error: "too-large" };
  let buf;
  try { buf = Buffer.from(b64, "base64"); } catch { return { error: "bad-data" }; }
  if (!buf.length) return { error: "empty" };
  if (buf.length > maxBytes) return { error: "too-large" };
  const mime = (meta.match(/^([a-z0-9.+-]+\/[a-z0-9.+-]+)/i) || [])[1] || "application/octet-stream";
  return { buf, mime };
}

function ensure() {
  fs.mkdirSync(FDIR(), { recursive: true });
  fs.mkdirSync(VDIR(), { recursive: true });
  fs.mkdirSync(CAPDIR(), { recursive: true });
}

/* The chat and the settings are the two files worth protecting: both go through src/main/atomic-write.js,
   which writes a temporary file, keeps the previous version as .bak and then renames it over the target. A
   save interrupted by a crash or a full disk can no longer leave half a JSON document behind — and if one is
   ever found, the reader takes the backup and puts it back rather than the app starting with an empty chat. */
/* The chat has exactly one owner in this process now (src/main/store.js): it keeps the current document, the
   revision, and the only writer. `loadJSON()` keeps its old meaning for the code here that reads the live
   document; writes go through the store so a quick note and a window save can no longer overwrite each
   other, and a large history is written off the main thread. */
let chatStore = null;
function loadJSON() {
  return chatStore ? chatStore.read() : { messages: [] };
}
/* What a window receives: the document plus the revision it must send back with its next save. */
function storeSnapshot() {
  return chatStore ? { ...chatStore.read(), __rev: chatStore.rev() } : { messages: [], __rev: 0 };
}
function loadCfg() {
  return atomic.readJsonSync(SETTINGS(), { darkMode: false, theme: "blue" });
}
function saveCfg(d) {
  atomic.writeFileAtomicSync(SETTINGS(), JSON.stringify(d));
}

function safeFile(name, dirFn) {
  if (!name || typeof name !== "string" || /[\/\\]/.test(name) || name.includes("..")) return null;
  const base = path.normalize(dirFn() + path.sep);
  const full = path.normalize(path.join(dirFn(), name));
  return full.startsWith(base) ? full : null;
}
/* A capture name from any window (media library, review window) must resolve
   inside captures/ and nowhere else. */
function safeCap(name) { return safeFile(name, CAPDIR); }

/* ===== Screenshot review ==================================================
 * A region screenshot used to end as a toast + a file in captures/, so saving
 * the picture meant: open the bubble → media library → find it → download. Now
 * the shot ENDS in front of the user: a small always-on-top card with the image
 * and a Download button that writes straight into the Downloads folder. The
 * capture still lands in captures/ (the library and the message attachments
 * keep working exactly as before); this window is just the last step made
 * obvious.
 */
function reviewFile() {
  if (!reviewName) return null;
  const f = safeCap(reviewName);
  return f && fs.existsSync(f) ? f : null;
}

/** A free path for `name` inside `dir` (never overwrites what is already there). */
function uniqueInDir(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let full = path.join(dir, name);
  for (let i = 1; fs.existsSync(full) && i < 1000; i++) full = path.join(dir, `${base} (${i})${ext}`);
  return full;
}

/* Save a copy into the Downloads folder — no dialog, which is the whole point
   of "download it right away". */
function copyCaptureToDownloads() {
  const src = reviewFile();
  if (!src) return { ok: false, error: "missing" };
  try {
    const dir = app.getPath("downloads");
    fs.mkdirSync(dir, { recursive: true });
    const dest = uniqueInDir(dir, path.basename(src));
    fs.copyFileSync(src, dest);
    return { ok: true, path: dest };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

/* Copy is what makes a shot pasteable anywhere. writeImage() puts the picture
   on the clipboard as image/png — the format browsers, documents and chat
   boxes paste — and nothing else may be written afterwards: an extra
   writeBuffer() (for "just one more format") replaces the whole clipboard and
   leaves it empty. Verified on Windows, see reviewtest. */
function copyCaptureToClipboard() {
  const src = reviewFile();
  if (!src) return { ok: false, error: "missing" };
  try {
    const img = nativeImage.createFromPath(src);
    if (img.isEmpty()) return { ok: false, error: "unreadable" };
    clipboard.writeImage(img);
    return { ok: true, size: img.getSize(), formats: clipboard.availableFormats() };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

/* "Save as…" — the file picker. Shared with the media library's download
   button so both paths behave identically. */
async function saveCaptureAs(name) {
  const src = safeCap(name);
  if (!src || !fs.existsSync(src)) return { ok: false, error: "missing" };
  try {
    const ext = path.extname(name).toLowerCase();
    const r = await askSave({
      title: "Save capture",
      defaultPath: path.join(app.getPath("downloads"), path.basename(name)),
      filters: ext === ".png"
        ? [{ name: "PNG", extensions: ["png"] }]
        : ext === ".webm"
          ? [{ name: "WebM", extensions: ["webm"] }]
          : [{ name: "File", extensions: [ext.slice(1) || "*"] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.copyFileSync(src, r.filePath);
    return { ok: true, path: r.filePath };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

function closeShotReview() {
  if (!reviewWin || reviewWin.isDestroyed()) return false;
  try { reviewWin.close(); } catch {}
  return true;
}

/**
 * Show a just-taken screenshot. Sized from the image's own aspect ratio, centred
 * on the display the shot came from, always on top (like every snipping tool),
 * out of the taskbar, and replaced — never multiplied — by a newer shot.
 * Returns false when the file is not there, so the caller can still fall back
 * to a toast.
 */
function openShotReview(name) {
  const src = safeCap(name);
  if (!src || !fs.existsSync(src)) return false;
  let size = { width: 0, height: 0 };
  try { size = nativeImage.createFromPath(src).getSize(); } catch {}
  try {
    if (reviewWin && !reviewWin.isDestroyed()) reviewWin.close();
  } catch {}
  reviewName = name;
  reviewNote = "";
  try { reviewBase = fs.readFileSync(src); } catch { reviewBase = null; }
  let wa = screen.getPrimaryDisplay().workArea;
  try { wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; } catch {}
  const CHROME_H = 128;                       // header + footer + padding
  const iw = Math.max(1, size.width || 800), ih = Math.max(1, size.height || 600);
  const maxW = Math.round(wa.width * 0.7), maxH = Math.round(wa.height * 0.7);
  const scale = Math.min(1, maxW / iw, Math.max(0.1, (maxH - CHROME_H) / ih));
  const cw = Math.max(380, Math.round(iw * scale));
  const ch = Math.max(240, Math.round(ih * scale) + CHROME_H);
  try {
    reviewWin = new BrowserWindow({
      width: cw, height: ch,
      x: Math.round(wa.x + (wa.width - cw) / 2),
      y: Math.round(wa.y + (wa.height - ch) / 2),
      /* The card keeps a taskbar button on purpose: its minimize button really
         minimizes the window, and the taskbar button is what brings it back. */
      frame: false, transparent: true, resizable: false, minimizable: true,
      maximizable: false, fullscreenable: false, alwaysOnTop: true, skipTaskbar: false,
      show: false, title: "Screenshot", icon: APP_ICON, backgroundColor: "#00000000",
      webPreferences: {
        preload: path.join(__dirname, "review-preload.js"),
        contextIsolation: true, nodeIntegration: false, sandbox: true
      }
    });
    /* Deliberately NOT content-protected: on Windows a protected transparent
       window renders as an opaque black rectangle, which is exactly what the
       floating bubble suffered from. A review that always comes up black would
       be worse than one that shows up inside a recording. */
    reviewWin.setAlwaysOnTop(true, "floating");
    reviewWin.loadFile(path.join(__dirname, "review.html"), {
      query: {
        name,
        w: String(size.width || ""),
        h: String(size.height || ""),
        bytes: String((() => { try { return fs.statSync(src).size; } catch { return 0; } })())
      }
    });
    reviewWin.once("ready-to-show", () => {
      if (reviewWin && !reviewWin.isDestroyed()) {
        /* Re-assert the topmost flag right before showing: on Windows the flag
           set at creation time can be lost while the native window is still
           being put together, and a snipping card that stays under an editor
           window is useless. (Measured: isAlwaysOnTop() came back false on
           some runs until this was re-applied here.) */
        try { reviewWin.setAlwaysOnTop(true, "floating"); } catch {}
        reviewWin.show();
        reviewWin.focus();
      }
    });
    reviewWin.on("closed", () => { reviewWin = null; });
    return true;
  } catch (err) {
    console.warn("[Main] review window failed:", (err && err.message) || err);
    reviewWin = null;
    return false;
  }
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

async function appendQuickNote(text, chatId) {
  const clean = String(text || "").trim();
  if (!clean) return { ok: false, error: "empty" };
  if (clean.length > MAX_NOTE_CHARS) return { ok: false, error: "too-long" };
  if (!chatStore) return { ok: false, error: "not-ready" };
  const data = loadJSON();
  let seededChat = null;
  if (!data.chats.length) {
    seededChat = { id: crypto.randomUUID(), name: "Notes to Self", pinned: true, createdAt: Date.now() - 3000 };
  }
  const cfg = loadQuickCfg();
  const chat = data.chats.find(c => c.id === chatId)
    || data.chats.find(c => c.id === cfg.lastChatId)
    || data.chats.find(c => c.id === data.activeChatId)
    || data.chats[0]
    || seededChat;
  if (!chat) return { ok: false, error: "no-chat" };
  const msg = {
    id: crypto.randomUUID(), chatId: chat.id, text: clean, files: [], createdAt: Date.now(),
    read: true, reactions: {}, pinned: false, edited: false
  };
  const saved = await chatStore.appendMessage(msg, { chat: seededChat });
  if (!saved.ok) return saved;
  saveQuickCfg({ lastChatId: chat.id });
  const snapshot = storeSnapshot();
  BrowserWindow.getAllWindows().forEach(w => {
    if (w !== quickWin && !w.isDestroyed()) w.webContents.send("state:changed", snapshot);
  });
  return { ok: true, chatId: chat.id, chatName: chat.name, message: msg, rev: saved.rev };
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
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false
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
  /* Every handler registered below is now sender-checked: only the main frame of one of the app's own pages
     may call it, and only the roles listed for that channel in src/main/ipc-policy.js. The check is installed
     BEFORE the registrations so no channel can be added later and forget it. */
  installIpcGuard(ipcMain, wc => pageRole(wc, __dirname), (channel, role, url) => {
    console.warn("[Main] IPC denied:", channel, "from", role || "untrusted", (url || "").slice(0, 120));
  });

  ipcMain.handle("store:load", () => { try { return storeSnapshot(); } catch { return { messages: [], __rev: 0 }; } });
  ipcMain.handle("store:save", async (e, d) => {
    if (!chatStore) return { ok: false, error: "not-ready" };
    const result = await chatStore.saveFromRenderer(d);
    /* The authoritative revision goes back to the saver, and every other window gets the same document so
       their next save cannot be based on a revision that no longer exists. The sender is skipped: it just
       wrote this state and does not need a full re-render (and a lost scroll position) as an answer. */
    if (result.ok) {
      const snapshot = storeSnapshot();
      BrowserWindow.getAllWindows().forEach(w => {
        if (w.isDestroyed() || w.webContents === e.sender) return;
        try { w.webContents.send("state:changed", snapshot); } catch {}
      });
    }
    return result;
  });
  ipcMain.handle("settings:load", () => { try { return loadCfg(); } catch { return { darkMode: false, theme: "blue" }; } });
  ipcMain.handle("settings:save", (_, d) => {
    try {
      // Persist sidebar collapse independently if the payload omitted it.
      const cur = loadCfg();
      const next = Object.assign({}, cur, d || {});
      if (d && typeof d.sidebarCollapsed === "boolean") next.sidebarCollapsed = d.sidebarCollapsed;
      saveCfg(next);
      /* The stored document is the truth, and every other window gets exactly that — not the sender's copy.
         Without this, a stale window could keep showing a toggle that was never written. */
      const saved = loadCfg();
      BrowserWindow.getAllWindows().forEach(w => {
        if (w.isDestroyed() || w.webContents === e.sender) return;
        try { w.webContents.send("settings:changed", saved); } catch {}
      });
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

  ipcMain.handle("file:savePasted", (_, { name, dataUrl } = {}) => {
    try {
      ensure();
      const decoded = bufferFromDataUrl(dataUrl, MAX_IMAGE_BYTES);
      if (decoded.error) return { error: decoded.error };
      const buf = decoded.buf;
      const ext = ({ "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" })[decoded.mime] || ".png";
      const sn = crypto.randomUUID() + ext;
      fs.writeFileSync(path.join(FDIR(), sn), buf);
      const mime = "image/" + ext.slice(1);
      return { name: String(name || "pasted-image") + ext, storedName: sn, size: buf.length, mime, category: "image" };
    } catch (e) { return { error: String((e && e.message) || e) }; }
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

  // Opens Facebook's Messenger site. The address is fixed here, never taken from the page, so a renderer
  // cannot use this channel to open any other link.
  ipcMain.handle("app:openMessenger", () => {
    try { shell.openExternal("https://www.messenger.com/"); return { ok: true }; }
    catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
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
      const decoded = bufferFromDataUrl(dataUrl, MAX_IMAGE_BYTES);
      if (decoded.error) return { error: decoded.error };
      const buf = decoded.buf;
      const sn = `${crypto.randomUUID()}.png`;
      fs.writeFileSync(path.join(FDIR(), sn), buf);
      return { name: `whiteboard-${Date.now()}.png`, storedName: sn, size: buf.length, mime: "image/png", category: "image" };
    } catch (e) { return { error: String((e && e.message) || e) }; }
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
      const decoded = bufferFromDataUrl(b64data, MAX_VOICE_BYTES);
      if (decoded.error) return { error: decoded.error };
      const buf = decoded.buf;
      const sn = `${crypto.randomUUID()}.webm`;
      fs.writeFileSync(path.join(VDIR(), sn), buf);
      return { name: `voice-${Date.now()}.webm`, storedName: sn, size: buf.length, mime: "audio/webm", category: "audio" };
    } catch (e) { return { error: String((e && e.message) || e) }; }
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

  ipcMain.handle("image:resize", (_, { dataUrl, maxWidth } = {}) => {
    try {
      const decoded = bufferFromDataUrl(dataUrl, MAX_IMAGE_BYTES);
      if (decoded.error) return { error: decoded.error };
      const img = nativeImage.createFromBuffer(decoded.buf);
      const sz = img.getSize();
      if (!maxWidth || sz.width <= maxWidth) return { dataUrl, width: sz.width, height: sz.height, resized: false };
      const scaled = img.resize({ quality: "good" });
      return { dataUrl: "data:image/png;base64," + scaled.toPNG().toString("base64"), width: scaled.getSize().width, height: scaled.getSize().height, resized: true };
    } catch { return null; }
  });

  ipcMain.handle("theme:set", (_, mode) => { nativeTheme.themeSource = mode; });

  /* ---- Screenshots / screen recordings (rail tools + media library) ---- */
  function captureStamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  /* A screenshot is named like a date: day-month-year, then hour-minute-second,
     then the word "shot" — 14-10-2026_18-05-09-shot.png. */
  function shotStamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, "0");
    return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
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
      if (buf && buf.length > MAX_CAPTURE_BYTES) return { ok: false, error: "too-large" };
      if (!buf || !buf.length) return { ok: false, error: "empty" };
      const clean = String(name || "").replace(/[\/\\]/g, "_").replace(/\.\./g, "_") || `cap-${captureStamp()}.webm`;
      // A capture is an image or a recording, and its name must say which: the media library, the player and
      // mimeOf() all decide by extension.
      if (!CAPTURE_EXT.test(clean)) return { ok: false, error: "bad-extension" };
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

  ipcMain.handle("capture:download", (_, name) => saveCaptureAs(name));

  /* ===== The screenshot review window =====
     Download writes straight into Downloads (no dialog — that is the one-click
     path), Save as… opens the picker, Copy goes to the clipboard, Delete
     discards the capture and tells every window so an open media library drops
     the card instead of showing a file that is gone. */
  ipcMain.handle("review:download", () => copyCaptureToDownloads());
  ipcMain.handle("review:saveAs", () => saveCaptureAs(reviewName));
  ipcMain.handle("review:copy", () => copyCaptureToClipboard());
  ipcMain.handle("review:reveal", () => {
    const f = reviewFile();
    if (!f) return { ok: false, error: "missing" };
    try { shell.showItemInFolder(f); return { ok: true, path: f }; }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });
  ipcMain.handle("review:remove", () => {
    const f = reviewFile();
    const name = reviewName;
    if (!f) return { ok: false, error: "missing" };
    try { fs.unlinkSync(f); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) { try { w.webContents.send("capture:removed", { name }); } catch {} }
    });
    closeShotReview();
    return { ok: true, name };
  });
  ipcMain.on("review:close", () => closeShotReview());
  ipcMain.handle("review:getpos", () => {
    if (!reviewWin || reviewWin.isDestroyed()) return null;
    const [x, y] = reviewWin.getPosition();
    return { x, y };
  });
  ipcMain.on("review:dragto", (_, pos) => {
    if (!reviewWin || reviewWin.isDestroyed()) return;
    if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return;
    // Never let the card be dragged somewhere it cannot be grabbed back from.
    try {
      const b = reviewWin.getBounds();
      const wa = screen.getDisplayNearestPoint({ x: Math.round(pos.x), y: Math.round(pos.y) }).workArea;
      const minVis = 60;
      const x = Math.min(Math.max(Math.round(pos.x), wa.x - b.width + minVis), wa.x + wa.width - minVis);
      const y = Math.min(Math.max(Math.round(pos.y), wa.y - b.height + minVis), wa.y + wa.height - minVis);
      reviewWin.setPosition(x, y);
    } catch { /* multi-monitor edge → use the raw position */
      try { reviewWin.setPosition(Math.round(pos.x), Math.round(pos.y)); } catch {}
    }
  });

  /* Minimize the card — a real one: the window drops down to the taskbar and
     the taskbar button (which the card keeps, skipTaskbar: false) brings it
     back at the same size and place. Hiding it would have been silent, and
     "disappeared" is exactly what a minimized window is supposed to look like
     on the taskbar. */
  ipcMain.on("review:minimize", () => {
    if (!reviewWin || reviewWin.isDestroyed()) return;
    try { reviewWin.minimize(); } catch (e) { console.warn("[Main] review minimize failed:", (e && e.message) || e); }
  });

  /* The pristine capture as bytes. The card draws its note canvas from a
     same-origin blob built out of these, because drawing the local-file://
     image directly taints that canvas and toDataURL() then throws. The bytes
     kept at open time are used, so the answer stays pristine even after a note
     has replaced the file. */
  ipcMain.handle("review:bytes", () => {
    if (reviewBase && reviewBase.length) return new Uint8Array(reviewBase);
    const f = reviewFile();
    if (!f) return null;
    try { return new Uint8Array(fs.readFileSync(f)); } catch { return null; }
  });

  /* The note is printed INTO the picture: the card bakes it with a canvas and
     hands over the finished PNG, which replaces the stored capture — so the
     file on disk, the card and the media library never disagree. Clearing the
     note puts the pristine shot back (its bytes were kept when the card
     opened), and an unchanged note is not written twice. */
  ipcMain.handle("review:annotate", (_, payload) => {
    const f = reviewFile();
    if (!f) return { ok: false, error: "missing" };
    const note = String((payload && payload.note) || "").trim();
    let bytes = null;
    if (payload && payload.buffer) { try { bytes = Buffer.from(payload.buffer); } catch { bytes = null; } }
    if (bytes && bytes.length > MAX_CAPTURE_BYTES) return { ok: false, error: "too-large" };
    if (note && (!bytes || !bytes.length)) return { ok: false, error: "empty" };
    if (!note && !reviewBase) return { ok: false, error: "no original" };
    try {
      if (note !== reviewNote) {
        fs.writeFileSync(f, note ? bytes : reviewBase);
        reviewNote = note;
        BrowserWindow.getAllWindows().forEach(w => {
          if (w.isDestroyed() || w === reviewWin) return;
          try { w.webContents.send("capture:updated", { name: reviewName }); } catch {}
        });
      }
      return { ok: true, note, size: fs.statSync(f).size };
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
  let shotOpening = null; // the picker currently being built (getSources takes 1–2 s)

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
    /* A review window from an earlier shot is always-on-top, so it would be
       baked straight into the new picture. It is about to be replaced anyway. */
    closeShotReview();
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

  /* A picker window, judged by the page it renders. `shot:done` / `shot:cancel`
     must only ever close a window that really is one — these handlers are
     reachable from any renderer, and closing the chat window because it sent a
     stray message would be a disaster. */
  function isShotPicker(w) {
    if (!w || w.isDestroyed()) return false;
    if (w === shotWin) return true;
    try { return w.webContents.getURL().includes("shot-overlay.html"); } catch { return false; }
  }
  function closeShotPicker(w) {
    if (!w || w.isDestroyed()) return;
    try { w.close(); } catch {}
  }
  /* The window a shot answer came from. The suites drive these channels through
     ipcMain directly, so an event without a sender is normal and must not throw. */
  function shotSender(e) {
    try { return e && e.sender ? BrowserWindow.fromWebContents(e.sender) : null; } catch { return null; }
  }
  /* Bring the picker in front of the user — focus as well, because Esc is the
     way out and it only works on the focused window. */
  function showShotPicker(w) {
    if (!w || w.isDestroyed() || w.isVisible()) return;
    try { w.show(); } catch {}
    try { w.focus(); } catch {}
  }
  /* Close every picker involved in a finished or aborted shot: the window main
     tracks and the window that actually sent the answer (the same one unless
     something went wrong earlier). Closing only `shotWin` is what left an older
     picker on screen forever — see openScreenshotOverlay(). */
  function closeShotPickers(sender) {
    closeShotPicker(shotWin);
    if (isShotPicker(sender) && sender !== shotWin && !sender.isDestroyed()) closeShotPicker(sender);
  }

  async function openScreenshotOverlay() {
    // Already picking a region: focus it instead of reporting a fake failure.
    if (shotWin && !shotWin.isDestroyed()) { shotWin.focus(); return { ok: true, already: true }; }
    /* getSources + the page load take a second or two and the Screenshot button
       stays clickable for all of it — an impatient second press is normal. It
       used to race the first one into a SECOND fullscreen picker: `shotWin`
       tracked only the newest, so the older window's Esc, its Cancel button and
       even a finished selection all asked main to close the window it no longer
       tracked. The orphan stayed on top of the desktop as a black screen with
       nothing left to close it. One picker at a time — a second press joins the
       one already being built. */
    if (shotOpening) {
      await shotOpening.catch(() => null);
      if (shotWin && !shotWin.isDestroyed()) { shotWin.focus(); return { ok: true, already: true }; }
      return { ok: false, canceled: true };
    }
    shotOpening = createScreenshotPicker();
    try { return await shotOpening; } finally { shotOpening = null; }
  }

  async function createScreenshotPicker() {
    /* A picker window that is not the one main tracks must never be left
       standing: two fullscreen always-on-top windows are one too many, and the
       extra one is unclosable from the UI. */
    for (const w of BrowserWindow.getAllWindows()) {
      if (w !== shotWin && isShotPicker(w)) closeShotPicker(w);
    }
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
        /* Shown only once its page really holds the frozen screen (see
           `shot:painted`): the window used to come up first, so for a second or
           two the desktop was covered by a black page that ignored both clicks
           and Esc — pressing Screenshot looked like hanging the machine. */
        show: false,
        backgroundColor: "#000000",
        webPreferences: {
          preload: path.join(__dirname, "shot-preload.js"),
          contextIsolation: true, nodeIntegration: false, sandbox: true
        }
      });
      overlayUp = true;
      /* A picker whose renderer dies is a black fullscreen window with no page
         left to close it — close the window instead. */
      const thisPicker = shotWin;
      thisPicker.webContents.on("render-process-gone", () => closeShotPicker(thisPicker));
      /* A page that never reports back must not leave the user with no picker at
         all (the bubble is parked off-screen meanwhile): show it anyway. */
      const pickerShown = setTimeout(() => showShotPicker(thisPicker), 2500);
      thisPicker.on("closed", () => clearTimeout(pickerShown));
      // Windows clamps a new window to the WORK area (taskbar excluded), so the
      // picker came out 48px short of the screen it had just grabbed: the bottom
      // strip could not be selected, and the overlay no longer matched the
      // screenshot's pixels. Re-asserting the display bounds afterwards sticks.
      try { shotWin.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height }); } catch {}
      shotWin.setAlwaysOnTop(true, "screen-saver");
      // Registered before anything async: the bubble comes back whether the
      // user crops, cancels, hits Esc or the overlay dies on its own.
      shotWin.on("closed", () => {
        /* Only the tracked window may clear the shot state: a stray picker being
           cleaned up must not pull the gun from under the live one. */
        if (thisPicker !== shotWin) return;
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
      /* A window that never finished loading would stay on top of the desktop as
         a black screen with no page left to close it. */
      if (!cancelled) closeShotPicker(shotWin);
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
        contextIsolation: true, nodeIntegration: false, sandbox: true,
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
    const sender = shotSender(e);
    try {
      if (!shotImage || !sel || typeof sel.x !== "number") {
        console.error("[shot] invalid selection", !!shotImage, sel);
        closeShotPickers(sender);
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
        closeShotPickers(sender);
        shotFailed("Selection too small — drag a region", "Too small");
        return;
      }
      const cropped = shotImage.crop({ x: sx, y: sy, width: sw, height: sh });
      ensure();
      const name = `${shotStamp()}-shot.png`;
      fs.writeFileSync(path.join(CAPDIR(), name), cropped.toPNG());
      closeShotPickers(sender);
      /* The review window IS the feedback for a screenshot: preview + Download
         in the face of the user, instead of "Screenshot saved ✓" and a hunt
         through the media library. Everything else is told a capture landed so
         an open gallery refreshes. */
      const reviewed = openShotReview(name);
      BrowserWindow.getAllWindows().forEach(w => {
        if (w.isDestroyed() || w === reviewWin) return;
        try { w.webContents.send("capture:saved", { name, kind: "image", review: reviewed }); } catch {}
      });
    } catch (err) {
      console.error("[shot] save failed", err);
      closeShotPickers(sender);
      shotFailed("Screenshot failed: " + ((err && err.message) || err), "Shot failed");
    }
  });

  ipcMain.on("shot:cancel", e => {
    shotCancelled = true;
    closeShotPickers(shotSender(e));
  });

  /* The frozen screen is on the picker's page: only now is it worth showing. */
  ipcMain.on("shot:painted", e => {
    const w = shotSender(e);
    if (isShotPicker(w)) showShotPicker(w);
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
        proxyRxBytes: monitorProxy.rxBytes(),
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

  /* --- The monitor's only outbound path -----------------------------------
   * Renderer fetch() to these hosts is blocked by CORS, so main fetches for it. The allowlist and every
   * other rule (redirects, deadline, body cap, concurrency, cooldowns) live in one reviewed module rather
   * than inline: src/main/monitor-proxy.js. `proxyRxBytes` for the NETWORK I/O panel comes from there. */
  const monitorProxy = createMonitorProxy({ fetchImpl: (url, opts) => net.fetch(url, opts) });

  ipcMain.handle("monitor:proxy", (_, url) => monitorProxy.fetch(url));

  /* Yahoo Finance v8 chart — fetched in PARALLEL (no artificial delay). */
  function yahooQuote(sym, signal) {
    return new Promise((resolve) => {
      if (signal && signal.aborted) return resolve(null);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
      let settled = false;
      let onAbort = null;
      const done = (value) => {
        if (settled) return;
        settled = true;
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            const meta = data && data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
            if (!meta) return done(null);
            const prev = meta.previousClose != null ? meta.previousClose : meta.chartPreviousClose;
            const price = meta.regularMarketPrice != null ? meta.regularMarketPrice : prev;
            if (price == null || prev == null) return done(null);
            done({
              symbol: sym,
              regularMarketPrice: price,
              regularMarketChangePercent: prev ? ((price - prev) / prev * 100) : 0,
              marketState: meta.marketState || "CLOSED"
            });
          } catch { done(null); }
        });
      });
      // A stopped scheduler must not leave 28 sockets waiting for a quote nobody will render.
      onAbort = () => { try { req.destroy(); } catch {} done(null); };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      req.on("error", () => done(null));
      req.setTimeout(9000, () => { try { req.destroy(); } catch {} done(null); });
    });
  }

  /* ---- Live push hub: ONE owner per feed → monitor:live → the page renders.
   *
   * Main owns news / quakes / indices. The page owns weather, air quality, space weather, GDACS, GDELT, IODA
   * and everything that only one panel asks for. Before this split, both sides polled the same three feeds
   * and main also sent `refresh` messages that made the page re-fetch its own feeds — the same data fetched
   * by two owners, at 20-30 second intervals for sources that change every few minutes. The cadences and the
   * backoff/abort rules now live in src/main/monitor-scheduler.js, where they are unit-tested. */
  const liveSigs = new Map();
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

  async function liveFetchText(url, signal) {
    const resp = await net.fetch(url, { signal, headers: { "User-Agent": "Mozilla/5.0 (WorldMonitor)" } });
    if (!resp.ok) throw new Error("http-" + resp.status);
    return await resp.text();
  }

  async function liveFetchJson(url, signal) {
    const resp = await net.fetch(url, { signal, headers: { "User-Agent": "Mozilla/5.0 (WorldMonitor)" } });
    if (!resp.ok) throw new Error("http-" + resp.status);
    return await resp.json();
  }

  /* News: one cycle fetches every source at once (bounded to 6 in flight). A source that fails contributes
     nothing but does not fail the cycle — only a cycle where every source failed is reported as an outage. */
  async function loadNews({ signal }) {
    const parts = await mapLimit(LIVE_NEWS, 6, async s => {
      if (signal && signal.aborted) return null;
      try {
        const text = await liveFetchText(s.url, signal);
        return text ? { name: s.name, url: s.url, text } : null;
      } catch { return null; }
    });
    const ok = parts.filter(Boolean);
    if (!ok.length) throw new Error("no-news-source");
    return ok;
  }

  async function loadQuakes({ signal }) {
    const data = await liveFetchJson("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson", signal);
    if (!data || !Array.isArray(data.features) || !data.features.length) throw new Error("empty-feed");
    return data;
  }

  async function loadIndices({ signal }) {
    const settled = await Promise.all(LIVE_SYMBOLS.map(sym => yahooQuote(sym, signal)));
    const results = settled.filter(Boolean);
    if (!results.length) throw new Error("no-quote");
    return { quoteResponse: { result: results, error: null } };
  }

  /* Push only when the payload really changed. The signature map is cleared on stop so a reopened monitor
     receives the current snapshot immediately even when nothing changed while it was closed. */
  function sendLive(type, data) {
    let sig;
    if (type === "news") {
      sig = hashStr(data.map(p => p.name + ":" + (p.text.match(/<title[^>]*>[\s\S]*?<\/title>/i) || [""])[0]).join("|"));
    } else if (type === "quakes") {
      sig = data.features.length + "|" + data.features.slice(0, 8).map(f => f.id).join(",");
    } else {
      sig = data.quoteResponse.result.map(r => r.symbol + ":" + (r.regularMarketPrice || 0).toFixed(4)).join("|");
    }
    pushIfChanged(type, data, sig);
  }

  const monitorScheduler = createMonitorScheduler({
    loaders: { news: loadNews, quakes: loadQuakes, indices: loadIndices },
    send: sendLive,
    status: update => pushMonitor("feed-status", update)
  });

  function startLiveHub() {
    liveSigs.clear();
    monitorScheduler.start();
  }

  function stopLiveHub() {
    monitorScheduler.stop();
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
      refreshTrayMenu(); // the tray menu's bubble row follows the bar
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

  /* Every button except close leaves the floating bar on screen. If the window
     is gone (closed earlier, or never opened in this session) it is rebuilt
     rather than ignored, so "minimize" is never a dead click; only the close
     button is allowed to take the bar away. Returns true when the caller
     should stop, because the bar is only just being created. */
  function reopenBarIfMissing(expand) {
    if (alive(pipWin)) return false;
    openPip(expand ? {} : { expand: false });
    return true;
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
    refreshTrayMenu();
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
    hideChatWindow();
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
    if (!alive(pipWin)) {
      // Rebuild the popup, then maximise it once it has loaded.
      const w = openPip();
      if (alive(w)) w.webContents.once("did-finish-load", () => { if (alive(pipWin)) ipcMain.emit("pip:maximize"); });
      return;
    }
    if (pipCollapsed) return;
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
    // Docking with no bar open builds one on that edge directly.
    if (!alive(pipWin)) { openPip({ expand: false, dock: s }); return; }
    if (!pipCollapsed) return;
    const t = dockPipBounds(s);
    animatePipBounds(t, 160);
    savePipCfg({ x: t.x, y: t.y });
  });
  /* "Start with Windows" toggle — returns what the OS really reports back. */
  ipcMain.handle("app:startAtLogin", (e, on) => {
    const state = setLoginItem(on);
    refreshTrayMenu();
    return state;
  });
  ipcMain.on("pip:close", () => {
    if (!alive(pipWin)) return;
    pipWin.close();
    /* Closing the bar must never leave the app with nothing on screen: if the
       chat window was tucked away into the bar, bring it back. When there is
       no chat window at all (a boot start, or after the chat was closed) the
       app is allowed to live in the tray — but say so, once, instead of
       looking like it just died. */
    if (alive(win) && !win.isVisible()) { try { win.show(); win.focus(); } catch {} }
    else if (!alive(win)) trayBalloon("Loopback is still running", "It is in the tray, next to the clock — click the icon to open the chat.");
    refreshTrayMenu();
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
    if (reopenBarIfMissing(false)) return;
    if (!pipCollapsed) return;
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
    // Flipping with no bar open just brings the bar back (in the orientation
    // pip.json remembers) instead of flipping something that isn't there.
    if (reopenBarIfMissing(false)) return;
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
    // "Open the chat" must open it even if the window was closed meanwhile.
    if (reopenBarIfMissing(true)) return;
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
    /* Minimize lands on the floating bar even when there is no window to shrink
       — the bar is rebuilt rather than silently doing nothing. */
    if (reopenBarIfMissing(false)) return;
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
          // The monitor renders untrusted headlines and has no filesystem or webUtils use: it gets the
          // strongest sandbox in the app. The chat preload needs webUtils.getPathForFile for drag-and-drop,
          // so those two windows stay unsandboxed until that path has its own sandboxed bridge.
          sandbox: true
        }
      });
      monitorWin.loadFile(path.join(__dirname, "monitor.html"));
      monitorWin.webContents.on("did-finish-load", () => startLiveHub());
      monitorWin.on("closed", () => { monitorWin = null; stopLiveHub(); });
      /* The live feeds only earn their keep while somebody is looking at them: three polling loops, each one
         a network round trip that parses JSON in the main process, for a window that is hidden behind another
         app are pure cost on a laptop. A hidden window stops them; bringing it back starts them again, and the
         first cycle is immediate, so the page is never left showing stale numbers. */
      monitorWin.on("hide", stopLiveHub);
      monitorWin.on("minimize", stopLiveHub);
      monitorWin.on("show", () => { if (alive(monitorWin)) startLiveHub(); });
      monitorWin.on("restore", () => { if (alive(monitorWin)) startLiveHub(); });
    } catch (err) {
      console.error("[Main] monitor creation failed:", err);
    }
  });

  ipcMain.on("monitor:close", () => { stopLiveHub(); if (alive(monitorWin)) monitorWin.close(); });

  /* A sleeping machine does not run timers, so every feed that was due fires in one burst the moment the
     lid opens — three requests and three JSON parses before the user's first click. Stopping them on
     suspend and restarting them on resume turns that burst back into "the page is current again". */
  powerMonitor.on("suspend", stopLiveHub);
  powerMonitor.on("resume", () => { if (alive(monitorWin) && monitorWin.isVisible()) startLiveHub(); });
}

/* ===== System tray (the app runs in the background) ===================
 * The tray icon is what makes "runs in the background" real instead of a
 * promise: with it up, the process outlives every window (window-all-closed
 * below, `python`-style background app), the way back in is one click away
 * rather than hunting for the bubble, and a PC that boots is never greeted by
 * a full window it did not ask for — the chat renderer is created the moment
 * somebody wants it, which is also the single biggest memory saving available
 * to an Electron app that nobody is looking at.
 */
const TRAY_TOOLTIP = "Loopback — notes to self";

function trayIcon() {
  try {
    const img = nativeImage.createFromPath(APP_ICON);
    if (img.isEmpty()) return img;
    // The tray wants 16px on Windows: letting it rescale the 256px app icon
    // gives a blurred smudge next to the crisp system icons.
    return img.resize({ width: 16, height: 16, quality: "best" });
  } catch { return nativeImage.createEmpty(); }
}

/* Hiding the chat to the tray keeps its renderer (~120 MB) alive for nothing when the composer is empty.
   Then the window is closed instead, and showChatWindow() builds it again from disk. A message still being
   typed keeps the window hidden, so nothing written is lost. Closing is only chosen while the tray keeps the
   app running: otherwise closing the last window would quit it. */
async function hideChatWindow() {
  if (!alive(win)) return;
  let typing = true;
  try {
    typing = await win.webContents.executeJavaScript(
      "(() => { const el = document.getElementById('messageInput'); return !el || el.value.trim() !== ''; })()", true);
  } catch { typing = true; }
  if (!alive(win)) return;
  let keepRunning = false;
  try { keepRunning = !!tray && !tray.isDestroyed() && loadCfg().runInBackground !== false; } catch {}
  if (typing || !keepRunning) { try { win.hide(); } catch {} return; }
  try { win.close(); } catch {}
}

/* Bring the chat window up (building it when it is gone) — the tray menu, the
   tray click and second-instance all end up here. */
function showChatWindow() {
  try {
    const w = createWindow();
    if (!alive(w)) return;
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  } catch (err) { console.warn("[Main] open from tray failed:", (err && err.message) || err); }
}

/* A one-off Windows balloon so "I closed the bubble and the app vanished" has
   an answer on screen. Never nags twice in a session. */
function trayBalloon(title, body) {
  if (trayBalloonShown || !tray || tray.isDestroyed()) return;
  trayBalloonShown = true;
  try { tray.displayBalloon({ title, content: body, iconType: "info" }); } catch {}
}

/* Push the saved settings into every window — same channel Settings itself
   uses, so a toggle flipped from the tray menu shows up in the panel too. */
function broadcastSettings() {
  let cfg = {};
  try { cfg = loadCfg(); } catch {}
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) { try { w.webContents.send("settings:changed", cfg); } catch {} }
  });
}

/* Rebuilt on every change so the checkmarks and the two labels always describe
   what is true right now (the menu is the app's only UI when nothing is open). */
function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  let cfg = {};
  try { cfg = loadCfg(); } catch {}
  const startAtLogin = loginItemRegistered();
  const barOpen = alive(pipWin);
  const chatVisible = alive(win) && win.isVisible();
  const save = patch => {
    try { saveCfg(Object.assign(loadCfg(), patch)); } catch {}
    broadcastSettings();
    refreshTrayMenu();
  };

  trayMenu = [
    { label: chatVisible ? "Focus Loopback" : "Open Loopback", click: () => { showChatWindow(); setTimeout(refreshTrayMenu, 400); } },
    {
      label: barOpen ? "Hide chat bubble" : "Show chat bubble",
      click: () => {
        if (alive(pipWin)) ipcMain.emit("pip:close");
        else ipcMain.emit("pip:openbar", {}, pipDockSide());
        setTimeout(refreshTrayMenu, 400);
      }
    },
    { type: "separator" },
    {
      label: "Start with Windows", type: "checkbox", checked: startAtLogin,
      click: mi => save({ startAtLogin: setLoginItem(mi.checked) })
    },
    {
      label: "Keep running in the tray", type: "checkbox",
      checked: cfg.runInBackground !== false,
      click: mi => save({ runInBackground: !!mi.checked })
    },
    { type: "separator" },
    { label: "Quit Loopback", click: () => { isQuitting = true; app.quit(); } }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(trayMenu));
}

/* Test seam for traytest.js — the tray handle and the menu template it was
   built from, so "the app lives in the tray" can be asserted without a screen.
   Nothing in the app itself reads this. */
function exposeTrayForTests() {
  global.__loopbackTray = {
    tray: () => tray,
    menu: () => trayMenu,
    startedHidden: STARTED_HIDDEN,
    alive: () => !isQuitting
  };
}

function createTray() {
  if (tray && !tray.isDestroyed()) return tray;
  try { tray = new Tray(trayIcon()); }
  catch (err) {
    console.warn("[Main] tray unavailable:", (err && err.message) || err);
    tray = null;
    return null;
  }
  tray.setToolTip(TRAY_TOOLTIP);
  refreshTrayMenu();
  /* Left click: the chat, or away with it when it is already on screen. Right
     click brings the menu by itself (refreshed first so it is never stale). */
  tray.on("click", () => {
    if (alive(win) && win.isVisible() && !win.isMinimized()) hideChatWindow();
    else showChatWindow();
    setTimeout(refreshTrayMenu, 400);
  });
  tray.on("right-click", () => refreshTrayMenu());
  exposeTrayForTests();
  return tray;
}

/* "Start with Windows" — re-applied on every launch so a reinstall (which
   moves the exe) can never leave a stale login entry behind. The login item
   carries `--autostart`, so a boot launch comes up hidden (tray + floating bar)
   instead of a window nobody asked for. Default: ON — the app is meant to be
   already there, with its chat bubble, when the PC comes up. The OS stays the
   source of truth for what is actually registered. */
/* Which executable a login entry should point at.
   The portable build is a wrapper: `process.execPath` is the copy it unpacked
   into %TEMP%, so registering that would leave an entry aimed at a folder
   Windows may wipe at any time (and which is gone after a reboot). the
   wrapper tells us where the real portable exe lives — that is the file to
   start. The installed build has no such variable and starts its own exe. */
function loginItemTarget() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}
function loginItemOpts() {
  return { path: loginItemTarget(), args: [AUTOSTART_FLAG] };
}

/* What the OS really reports for our login entry (the tray menu and Settings
   show this, never what we merely wrote). */
function loginItemRegistered() {
  try { return !!(app.getLoginItemSettings(loginItemOpts()) || {}).openAtLogin; }
  catch { return false; }
}

function setLoginItem(on) {
  /* Registered only by the installed/portable build: in a dev run
     process.execPath is electron.exe, and a login entry pointing at that —
     with no app path — would just break at the next boot. */
  if (!app.isPackaged) return false;
  try {
    app.setLoginItemSettings(Object.assign({ openAtLogin: !!on }, loginItemOpts()));
    return loginItemRegistered();
  } catch (err) {
    console.warn("[Main] login item failed:", (err && err.message) || err);
    return false;
  }
}

function applyLoginItem(cfg) {
  setLoginItem(((cfg || {}).startAtLogin) !== false);
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

/* Sweeps the copies earlier portable launches left in %TEMP% (see src/main/portable-janitor.js).
   Twice, because both are needed: at launch, and then every few hours — Loopback is normally started with
   Windows and left running for days, so a copy another launch abandons hours later would otherwise wait for
   the next sign-in. The timer is unref'd so a janitor can never keep the process alive after the user quit. */
const JANITOR_SWEEP_MS = 4 * 60 * 60 * 1000;
function startPortableJanitor() {
  if (!process.env.PORTABLE_EXECUTABLE_FILE) return;
  const sweep = () => portableJanitor
    .sweepStaleCopies({ tempDir: app.getPath("temp"), exePath: process.execPath })
    .catch(() => {});
  sweep();
  const timer = setInterval(sweep, JANITOR_SWEEP_MS);
  if (typeof timer.unref === "function") timer.unref();
}

/* Every page this app creates goes through these four rules before it can load anything: no child windows,
   no navigation away from the app's own files, no <webview>, and no unvalidated external link. Registered
   process-wide (instead of in each window) so a window added later cannot forget them. */
app.on("web-contents-created", (_event, contents) => {
  try {
    contents.setWindowOpenHandler(({ url }) => {
      const safe = externalUrl(url);
      if (safe) shell.openExternal(safe).catch(() => {});
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (isAppPage(url, __dirname)) return;
      event.preventDefault();
      // A markdown link in a note is a real link: open it in the user's browser, never inside Loopback.
      const safe = externalUrl(url);
      if (safe) shell.openExternal(safe).catch(() => {});
    });
    contents.on("will-attach-webview", event => event.preventDefault());
  } catch (err) {
    console.warn("[Main] web-contents hardening failed:", (err && err.message) || err);
  }
});

app.whenReady().then(() => {
  startPortableJanitor();

  /* Before anything reads the data folder: a schema marker, a verified backup of what was there, and a
     normalised file. A folder from an older version is migrated once and left alone after that; a folder
     that cannot be read is NOT replaced (atomic-write's recovery from .bak is the only thing allowed to
     decide that). */
  try {
    const result = storeMigrations.migrate(app.getPath("userData"), { appVersion: app.getVersion() });
    if (result.migrated) {
      console.log("[Main] data folder migrated to schema", result.schema,
        result.backupDir ? "— backup: " + result.backupDir : "— no previous files");
    }
  } catch (err) {
    logMainError("store-migration", err);
  }

  ensure();
  chatStore = store.createStore({ file: DATA() });
  registerHandlers();
  registerQuickShortcut();

  /* Least privilege, per role (src/main/ipc-policy.js): the chat windows may use the microphone, the camera,
     display capture, fullscreen and the clipboard; the monitor only fullscreen + clipboard; the review card
     only the clipboard; the picker, the quick note and the camera bubble nothing at all. A request from any
     page that is not one of ours — or from an iframe inside one — is refused. */
  const roleOf = wc => pageRole(wc, __dirname);
  /* A permission belongs to the role AND to the main frame of one of our pages. The second half matters: an
     iframe (there are none today) must not inherit the chat window's camera, and a page that navigated to an
     external origin is refused even if its WebContents is still one of ours. */
  const frameAllowed = details => {
    if (!details) return true;
    if (details.isMainFrame === false) return false;
    if (!details.requestingUrl) return true;
    return isAppPage(details.requestingUrl, __dirname);
  };
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const role = roleOf(webContents);
    const ok = permissionAllowed(role, permission) && frameAllowed(details);
    if (!ok) console.warn("[Main] permission denied:", permission, "from", role || "untrusted");
    callback(ok);
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) =>
    permissionAllowed(webContents ? roleOf(webContents) : null, permission) && frameAllowed(details));

  // getDisplayMedia() for screen recording — auto-pick the display under
  // the cursor so the user isn't stuck in a Chromium picker. Only the chat window/bar may ask, and only
  // from a user gesture; the monitor cannot start a recording.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const role = request && request.frame ? roleForUrl(request.frame.url, __dirname) : null;
      const gesture = !request || request.userGesture !== false;
      const topFrame = !request || !request.frame || request.frame.parent == null;
      if (!gesture || !topFrame || (role !== "chat" && role !== "pip")) {
        console.warn("[Main] display capture denied for", role || "untrusted", gesture ? "" : "(no user gesture)");
        return callback({ video: undefined });
      }
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

  /* A boot-time launch (the login item's --autostart) comes up in the
     background: the tray and the floating bar, and the chat window only once
     it is asked for. That is what "already running when the PC starts" should
     feel like, and it keeps a hidden chat renderer — the largest single chunk
     of the app's memory — off a machine nobody is looking at it on. */
  if (!STARTED_HIDDEN) createWindow();
  if (!IS_TEST_BOOT) { createTray(); startupExtras(); }
  else if (TRAY_IN_TEST) {
    createTray();
    if (STARTED_HIDDEN) startupExtras();
  }
});

/* Launching the app again (shortcut, taskbar, second click on the exe) must
   always end with the chat window in front — even when only the floating bar
   survived, and never by poking a destroyed window. */
app.on("second-instance", () => {
  try { createWindow(); }
  catch (err) { console.warn("[Main] second-instance failed:", (err && err.message) || err); }
});
app.on("before-quit", () => { isQuitting = true; });
app.on("will-quit", () => { try { globalShortcut.unregisterAll(); } catch {} });
app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  /* The tray keeps the app alive with nothing on screen — that IS the
     background mode. Turning it off (or quitting from the tray menu) restores
     the old "closing the last window quits" behaviour. */
  if (tray && !tray.isDestroyed() && !isQuitting) {
    let keep = true;
    try { keep = loadCfg().runInBackground !== false; } catch {}
    if (keep) return;
  }
  app.quit();
});
app.on("activate", () => {
  try { createWindow(); }
  catch (err) { console.warn("[Main] activate failed:", (err && err.message) || err); }
});
