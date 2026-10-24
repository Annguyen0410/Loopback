'use strict';

/**
 * The rules that decide which page may say what, and which URL may be opened.
 *
 * Every window in Loopback is served from the app folder with `file://`, and each one gets a small preload
 * bridge instead of Node access. That part was already right. What was missing is the other half: the main
 * process accepted every IPC message from every window, and the session answered "yes" to every permission
 * request. A renderer that is fed hostile data (the monitor renders headlines from the open internet) could
 * therefore reach channels that only belong to the chat window, and any page that managed to get loaded could
 * ask for a camera.
 *
 * This module owns the two policies as plain data + pure functions:
 *
 *   ROLE_CHANNELS — channel → the window roles allowed to call it.
 *   permissionAllowed(role, permission) — which permissions each of those windows may use.
 *
 * `pageRole()` turns a WebContents into one of the roles by its URL, so a window cannot claim a role; the URL
 * it actually loaded decides. No Electron import here, which is what lets `tests/ipc-policy.test.js` exercise
 * the whole table without a display.
 */

const path = require('node:path');
const { fileURLToPath } = require('node:url');

const CHAT = ['chat', 'pip'];

/**
 * Channel → roles. Anything not listed falls back to `DEFAULT_ROLES` (the two chat windows), so a new channel
 * is least-privileged by default: the monitor, the picker, the review card, the quick note and the camera
 * bubble cannot call it at all.
 */
const ROLE_CHANNELS = {
  /* Data and files — the chat windows are the only ones that own the store. */
  'store:load': CHAT,
  'store:save': CHAT,
  'store:export': CHAT,
  'settings:load': CHAT,
  'settings:save': CHAT,
  'file:pick': CHAT,
  'file:open': CHAT,
  'file:reveal': CHAT,
  'file:delete': CHAT,
  'file:saveCanvas': CHAT,
  'file:savePasted': CHAT,
  'file:storePaths': CHAT,
  'voice:save': CHAT,
  'image:resize': CHAT,
  'notify:show': CHAT,
  'theme:set': CHAT,
  'app:openDataFolder': CHAT,
  'app:openMessenger': CHAT,
  'app:startAtLogin': CHAT,
  'app:tuckIntoBar': CHAT,

  /* Floating bubble controls. The chat window builds the bar, the bar uses them on itself. */
  'pip:open': CHAT,
  'pip:openbar': CHAT,
  'pip:toggle': CHAT,
  'pip:expand': CHAT,
  'pip:collapse': CHAT,
  'pip:close': CHAT,
  'pip:flip': CHAT,
  'pip:resize': CHAT,
  'pip:resizeto': CHAT,
  'pip:dock': CHAT,
  'pip:maximize': CHAT,
  'pip:dragto': CHAT,
  'pip:getpos': CHAT,
  'pip:getorient': CHAT,
  'pip:getstate': CHAT,

  /* Screenshots. Only the full-screen picker reports a selection. */
  'capture:startShot': CHAT,
  'capture:list': CHAT,
  'capture:save': CHAT,
  'capture:delete': CHAT,
  'capture:download': CHAT,
  'capture:reveal': CHAT,
  'capture:openFolder': CHAT,
  'capture:setContentProtection': CHAT,
  'capture:recordingActive': CHAT,
  'capture:broadcast': CHAT,
  'shot:done': ['shot'],
  'shot:cancel': ['shot'],
  'shot:painted': ['shot'],

  /* The review card owns its own five buttons and nothing else. */
  'review:bytes': ['review'],
  'review:download': ['review'],
  'review:saveAs': ['review'],
  'review:copy': ['review'],
  'review:reveal': ['review'],
  'review:remove': ['review'],
  'review:annotate': ['review'],
  'review:minimize': ['review'],
  'review:close': ['review'],
  'review:getpos': ['review'],
  'review:dragto': ['review'],

  /* Quick note: the popup writes, the chat window and rail may open it. */
  // Both chat windows have the ⚡ rail button; only the popup may hide itself.
  'quick:open': CHAT,
  'quick:hide': ['quick'],
  'quick:chats': ['quick'],
  'quick:append': ['quick'],

  /* Camera bubble. The recording window feeds it frames; the bubble only moves itself. */
  'cam:open': CHAT,
  // The recording window closes the bubble when the camera is turned off or the recording stops.
  'cam:close': [...CHAT, 'cam'],
  'cam:frame': CHAT,
  'cam:state': CHAT,
  'cam:dragStart': ['cam'],
  'cam:dragTo': ['cam'],
  'cam:dragEnd': ['cam'],
  'cam:cycleSize': ['cam'],

  /* Cross-window sync is a chat-window concern. */
  'state:broadcast': CHAT,
  'settings:broadcast': CHAT,

  /* World Monitor. The proxy and the machine panels are monitor-only: the chat window has no business
     reading system information or fetching arbitrary (allowlisted) URLs on a page's behalf. */
  'monitor:open': CHAT,
  'monitor:close': ['monitor'],
  'monitor:proxy': ['monitor'],
  'monitor:sys': ['monitor']
};

const DEFAULT_ROLES = CHAT;

/** Which page names map to which role. `index.html` is shared by the chat window and the floating bar. */
const PAGE_ROLES = {
  'index.html': 'chat',
  'monitor.html': 'monitor',
  'quick.html': 'quick',
  'shot-overlay.html': 'shot',
  'review.html': 'review',
  'cam.html': 'cam'
};

/** Permissions each role may use. Everything else is denied. */
const ROLE_PERMISSIONS = {
  chat: new Set([
    'media',                 // getUserMedia is only called when voice/recording starts
    'camera',
    'microphone',
    'display-capture',       // getDisplayMedia, behind the recording button
    'fullscreen',
    'clipboard-sanitized-write',
    'notifications'
  ]),
  pip: new Set([
    'media',
    'camera',
    'microphone',
    'display-capture',       // the bar records too; that is a user click on the bar
    'fullscreen',
    'clipboard-sanitized-write'
  ]),
  // The watchlist may request a desktop notification, but only after the user
  // enables it for a rule. It still cannot use media capture or geolocation.
  monitor: new Set(['fullscreen', 'clipboard-sanitized-write', 'notifications']),
  review: new Set(['clipboard-sanitized-write']),
  quick: new Set(),
  shot: new Set(),
  cam: new Set()
};

function channelAllowed(channel, role) {
  const allowed = Object.prototype.hasOwnProperty.call(ROLE_CHANNELS, channel)
    ? ROLE_CHANNELS[channel]
    : DEFAULT_ROLES;
  return allowed.includes(role);
}

function permissionAllowed(role, permission) {
  const set = role && ROLE_PERMISSIONS[role];
  return !!(set && set.has(permission));
}

/**
 * The role of the page a WebContents actually loaded, or null. Only a `file://` page that lives directly in
 * the app folder can have a role — a page that navigated anywhere else (or to a subfolder of the app) is
 * anonymous and every guarded channel refuses it.
 */
function roleForUrl(rawUrl, appDir) {
  let u;
  try { u = new URL(String(rawUrl || '')); } catch { return null; }
  if (u.protocol !== 'file:') return null;
  let file;
  try { file = fileURLToPath(u); } catch { return null; }
  const dir = path.dirname(file);
  if (path.normalize(dir).toLowerCase() !== path.normalize(appDir).toLowerCase()) return null;
  const base = path.basename(file).toLowerCase();
  const role = PAGE_ROLES[base];
  if (!role) return null;
  // The floating bar is the same page as the chat window: its `?pip=1` query is what distinguishes them.
  if (role === 'chat' && u.searchParams.get('pip') === '1') return 'pip';
  return role;
}

function pageRole(webContents, appDir) {
  try { return roleForUrl(webContents.getURL(), appDir); } catch { return null; }
}

/** True only for the main frame of the window: a sub-frame never gets a role. */
function frameIsMain(event) {
  try {
    const sender = event.sender;
    const frame = event.senderFrame;
    if (!sender || !frame) return false;
    return frame === sender.mainFrame;
  } catch {
    return false;
  }
}

/**
 * Wraps ipcMain.handle / ipcMain.on so every registration made afterwards is sender-checked. A denied
 * `handle` throws (the renderer gets a rejected promise instead of data); a denied `on` is dropped. The one
 * `on` channel the app emits to itself (`pip:openbar`) is invoked with `ipcMain.emit`, which does not pass
 * through the wrapper.
 */
function installIpcGuard(ipcMain, roleOf, onDeny) {
  const handle = ipcMain.handle.bind(ipcMain);
  const on = ipcMain.on.bind(ipcMain);
  const check = (event, channel) => {
    // `ipcMain.emit(channel, {}, …)` is the main process talking to itself (opening the floating bar at
    // startup, collapsing it when the chat is minimized). It has no sender at all, and a renderer cannot
    // produce such an event: Electron always attaches the real WebContents. Only those internal emits skip
    // the role check; everything that arrived over IPC carries a sender and is checked.
    if (!event || !event.sender) return true;
    const role = (() => { try { return roleOf(event.sender); } catch { return null; } })();
    const ok = !!role && frameIsMain(event) && channelAllowed(channel, role);
    if (!ok && typeof onDeny === 'function') {
      try { onDeny(channel, role, event && event.senderFrame && event.senderFrame.url); } catch { /* logging */ }
    }
    return ok;
  };
  ipcMain.handle = (channel, fn) => handle(channel, (event, ...args) => {
    if (!check(event, channel)) return { ok: false, error: 'ipc-denied' };
    return fn(event, ...args);
  });
  ipcMain.on = (channel, fn) => on(channel, (event, ...args) => {
    if (!check(event, channel)) return undefined;
    return fn(event, ...args);
  });
}

module.exports = {
  CHAT,
  DEFAULT_ROLES,
  ROLE_CHANNELS,
  ROLE_PERMISSIONS,
  PAGE_ROLES,
  channelAllowed,
  permissionAllowed,
  pageRole,
  roleForUrl,
  frameIsMain,
  installIpcGuard
};
