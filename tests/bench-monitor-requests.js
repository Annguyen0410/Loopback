'use strict';

/* World Monitor request counter — the measurement behind the polling change.
 *
 *   npx electron tests/bench-monitor-requests.js [seconds]
 *
 * Boots the real app (throwaway profile), opens the World Monitor, and counts every network request it
 * causes, split by where it came from:
 *
 *   main     — a request made by the main process (net.fetch / https.get)
 *   renderer — a request made by the monitor page itself (direct fetch())
 *
 * The monitor window is moved off every display right after it opens, but it is NOT hidden: hiding it is
 * exactly what the app treats as "nobody is looking", so a hidden window would measure nothing. Everything
 * else (chat window, feeds, scheduler) is exactly what a user gets.
 *
 * Prints one JSON line prefixed with BENCH. Run it before and after a change and compare the totals.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SECONDS = Math.max(10, Number(process.argv[2]) || 60);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'loopback-bench-'));
const electron = require('electron');
const { app, BrowserWindow, session } = electron;
app.setPath('userData', profile);

const mainCounts = new Map();
const rendererCounts = new Map();

function bump(map, url) {
  let host = '';
  try { host = new URL(url).hostname || String(url); } catch { host = String(url).slice(0, 40); }
  map.set(host, (map.get(host) || 0) + 1);
}

/* main-process requests: net.fetch (feeds, proxy) and https.get (Yahoo quotes) */
const origFetch = electron.net.fetch.bind(electron.net);
electron.net.fetch = function (input) {
  bump(mainCounts, typeof input === 'string' ? input : (input && input.url) || String(input));
  return origFetch.apply(null, arguments);
};
const https = require('node:https');
const origGet = https.get;
https.get = function (input) {
  bump(mainCounts, typeof input === 'string' ? input : (input.href || String(input)));
  return origGet.apply(this, arguments);
};

/* renderer requests: only those that carry a webContentsId (main's net.fetch has none) */
app.whenReady().then(() => {
  try {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (details, cb) => {
      if (details.webContentsId != null && details.webContentsId >= 0) bump(rendererCounts, details.url);
      cb({});
    });
  } catch { /* counting is best effort */ }
});

require(path.join(__dirname, '..', 'main.js'));

function findByUrl(part) {
  return BrowserWindow.getAllWindows().find(w => {
    try { return String(w.webContents.getURL()).includes(part); } catch { return false; }
  }) || null;
}

app.whenReady().then(async () => {
  const { ipcMain } = electron;
  ipcMain.emit('monitor:open');
  // Wait for the page, then move it out of the user's way without hiding it.
  const t0 = Date.now();
  while (Date.now() - t0 < 8000 && !findByUrl('monitor.html')) await new Promise(r => setTimeout(r, 100));
  const mon = findByUrl('monitor.html');
  if (mon) {
    try { mon.setFullScreen(false); } catch { /* not fullscreen yet */ }
    try { mon.setBounds({ x: -4000, y: -4000, width: 900, height: 620 }); } catch { /* best effort */ }
    try { mon.setSkipTaskbar(true); } catch { /* best effort */ }
  }
  await new Promise(r => setTimeout(r, SECONDS * 1000));

  const summarize = map => Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]));
  const main = summarize(mainCounts);
  const renderer = summarize(rendererCounts);
  const total = values => Object.values(values).reduce((a, b) => a + b, 0);
  const news = Object.keys(main).filter(h => !/usgs|yahoo|finance/.test(h)).reduce((a, h) => a + main[h], 0);
  console.log('BENCH ' + JSON.stringify({
    seconds: SECONDS,
    monitorOpen: !!mon,
    mainTotal: total(main),
    rendererTotal: total(renderer),
    grandTotal: total(main) + total(renderer),
    mainPerMinute: Math.round(total(main) * 60 / SECONDS),
    rendererPerMinute: Math.round(total(renderer) * 60 / SECONDS),
    mainNewsish: news,
    main,
    renderer
  }, null, 2));

  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* leave it */ }
  app.exit(0);
});
