/* Combination test — "does the app survive being USED as a whole?"
 *
 * The other suites each prove ONE feature works on its own. Real use is never
 * that tidy: the floating bar is open while a recording runs, the monitor and
 * the media library are up, the theme changes, a screenshot picker pops over
 * everything and the app gets tucked into the bubble halfway through. Bugs
 * live in exactly those overlaps — a control that only works from the chat
 * window, a window that is closed by an unrelated action, a position that gets
 * overwritten while another feature has it parked somewhere.
 *
 * What this suite piles on top of each other:
 *   A. chat + floating popup + 3 side panels + quick note + monitor, all up
 *   B. a message typed in the POPUP reaching the chat window, and vice-versa
 *   C. a theme switch made in one window landing in the other one (and the
 *      popup still readable after it)
 *   D. expand/collapse/maximise/restore/flip/dock hammered while everything
 *      else is open — nothing may end up destroyed, half-sized or out of sync
 *   E. a REAL recording (fake devices) started from the collapsed bubble while
 *      the app is tucked away, the monitor is open, the theme changes, the
 *      popup is expanded and a screenshot picker is opened + cancelled
 *   F. the screenshot picker parking BOTH floating bubbles out of the frame
 *      while a recording runs, and putting them back — without touching pip.json
 *   G. media library + in-app search + a capture deleted while previewed
 *   H. the app tucked into the bar with other windows open, relaunched, closed
 *
 * Run (close the app first — it owns the single-instance lock + the hotkey):
 *   npx electron combotest.js
 * COMBOTEST_USERDATA=<dir> runs it against a throwaway profile.
 */
const path = require("path");
const fs = require("fs");
const { app, ipcMain, BrowserWindow, screen } = require("electron");

if (process.env.COMBOTEST_USERDATA) {
  fs.mkdirSync(process.env.COMBOTEST_USERDATA, { recursive: true });
  app.setPath("userData", process.env.COMBOTEST_USERDATA);
}
const USER_DATA = app.getPath("userData");
const ERROR_LOG = path.join(USER_DATA, "error.log");
const PIP_FILE = () => path.join(USER_DATA, "pip.json");
try { if (fs.existsSync(ERROR_LOG)) fs.unlinkSync(ERROR_LOG); } catch {}

/* Every renderer error, from every window — a window that is only alive while
   a recording runs is exactly where they hide. */
const rendererErrors = [];
app.on("browser-window-created", (e, w) => {
  try {
    w.webContents.on("console-message", (ev, level, message) => {
      const lv = ev && typeof ev.level !== "undefined" ? ev.level : level;
      const msg = ev && typeof ev.message === "string" ? ev.message : message;
      const isError = lv === "error" || (typeof lv === "number" && lv >= 3);
      if (!isError) return;
      let page = "?";
      try { page = w.webContents.getURL().split("/").pop() || "?"; } catch {}
      rendererErrors.push({ page: page.slice(0, 40), message: String(msg).slice(0, 200) });
    });
  } catch {}
});

require("./main.js");

const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
function check(name, cond, extra) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));
  if (!cond) failed = true;
}

const guard = setTimeout(() => {
  console.log("FAIL  timed out — if the app is already running, close it and re-run");
  app.exit(1);
}, 420000);

const byUrl = part => BrowserWindow.getAllWindows().find(w => {
  if (w.isDestroyed()) return false;
  try { return String(w.webContents.getURL()).includes(part); } catch { return false; }
});
const findMain = () => BrowserWindow.getAllWindows().find(w => {
  if (w.isDestroyed()) return false;
  try { const u = String(w.webContents.getURL()); return u.includes("index.html") && !u.includes("pip=1") && !u.includes("shot"); } catch { return false; }
});
const findPip = () => byUrl("pip=1");
const findQuick = () => byUrl("quick.html");
const findMonitor = () => byUrl("monitor.html");
const findShot = () => byUrl("shot-overlay.html");
const findCam = () => byUrl("cam.html");
async function waitFor(fn, tries, ms) {
  for (let i = 0; i < tries; i++) { const v = fn(); if (v) return v; await wait(ms || 150); }
  return fn() || null;
}
async function poll(fn, tries, ms) {          // for boolean conditions
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await wait(ms || 150); }
  return false;
}
const ready = async w => {
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    ok = await w.webContents.executeJavaScript("document.body.classList.contains('app-ready')").catch(() => false);
    if (!ok) await wait(200);
  }
  return ok;
};
const js = (w, code) => w.webContents.executeJavaScript(code);
const clickId = (w, id) => js(w, `(function(){ const b=document.getElementById(${JSON.stringify(id)}); if(!b) return false; b.click(); return true; })()`);

/* ---------------------------------------------------------------- fake devices
   Same idea as rectest/camtest: canvas-backed "screen" + "camera" and a spy on
   MediaRecorder, so a REAL recording runs without touching hardware. */
const SETUP = `
  (function(){
    window.__fake = {};
    const origCapture = HTMLCanvasElement.prototype.captureStream;
    window.__capFps = [];
    HTMLCanvasElement.prototype.captureStream = function(fps){
      if (!this.dataset || !this.dataset.fake) window.__recCanvas = this;
      window.__capFps.push(fps);
      return origCapture.apply(this, arguments);
    };
    function fakeCanvas(fake, w, h, paint){
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.dataset.fake = fake;
      c.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.append(c);
      const ctx = c.getContext('2d');
      let n = 0;
      c.__timer = setInterval(() => { n++; paint(ctx, w, h, n); }, 60);
      paint(ctx, w, h, 0);
      window.__fake[fake] = c;
      return c;
    }
    const screen = fakeCanvas('screen', 1280, 720, (ctx, w, h, n) => {
      ctx.fillStyle = '#101828'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect((n * 13) % (w - 60), 20, 60, h - 40);
    });
    const cam = fakeCanvas('cam', 320, 240, (ctx, w, h) => { ctx.fillStyle = '#00dc00'; ctx.fillRect(0, 0, w, h); });

    window.__mrOptions = null;
    window.__mrEvents = [];
    window.__mrState = [];
    const OrigMR = window.MediaRecorder;
    window.MediaRecorder = function(stream, opts){
      window.__mrOptions = opts || null;
      const mr = new OrigMR(stream, opts);
      mr.addEventListener('dataavailable', e => window.__mrEvents.push(e.data ? e.data.size : -1));
      mr.addEventListener('pause', () => window.__mrState.push('pause'));
      mr.addEventListener('resume', () => window.__mrState.push('resume'));
      mr.addEventListener('stop', () => window.__mrState.push('stop'));
      return mr;
    };
    window.MediaRecorder.prototype = OrigMR.prototype;
    window.MediaRecorder.isTypeSupported = OrigMR.isTypeSupported.bind(OrigMR);

    window.__gdm = null;
    navigator.mediaDevices.getDisplayMedia = async c => {
      window.__gdm = c || null;
      return new MediaStream(screen.captureStream(30).getVideoTracks());
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const s = cam.captureStream(15);
      return new MediaStream(s.getVideoTracks());
    };
    return true;
  })()
`;
/* Hashtag of the recording canvas' middle row: it changes as the pump draws. */
const FRAME_SIG = `
  (function(){
    const c = window.__recCanvas;
    if (!c) return null;
    const d = c.getContext('2d').getImageData(0, Math.floor(c.height / 2), c.width, 1).data;
    let sig = 0;
    for (let i = 0; i < d.length; i += 4) sig = (sig * 31 + d[i] + d[i+1] + d[i+2]) % 2147483647;
    return { w: c.width, h: c.height, sig: sig };
  })()
`;

app.whenReady().then(async () => {
  try {
    await wait(1700);
    const main = await waitFor(findMain, 40, 250);
    check("the app boots with a real chat window", !!main, { windows: BrowserWindow.getAllWindows().length });
    if (!main) throw new Error("no main window");
    const run = code => js(main, code);
    check("the chat window finishes loading its UI", (await ready(main)) === true);

    /* ================================================================ A. all up
       Half a dozen surfaces live at the same time. */
    ipcMain.emit("pip:open");
    const pip = await waitFor(findPip, 40, 250);
    check("A: the floating popup opens beside the chat window", !!pip);
    if (!pip) throw new Error("no pip window");
    const prun = code => js(pip, code);
    check("A: the popup finishes loading", (await ready(pip)) === true);

    const panels = await run(`(async function(){
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const click = id => { const el = document.getElementById(id); if (el) { el.click(); return true; } return false; };
      const shown = id => { const el = document.getElementById(id); return el ? el.hidden === false : null; };
      const out = {};
      out.s = click('btnSettings'); out.m = click('btnMedia'); out.r = click('btnPipSettings');
      await wait(500);
      out.settings = shown('settingsPanel'); out.media = shown('mediaPanel'); out.mini = shown('miniPanel');
      return out;
    })()`).catch(e => ({ error: String(e) }));
    check("A: Settings + Media + Recording panels are open AT THE SAME TIME",
      panels.settings === true && panels.media === true && panels.mini === true, panels);

    ipcMain.emit("quick:open");
    const quick = await waitFor(findQuick, 30);
    check("A: the quick-note popup opens while the panels are up", !!quick, { quick: !!quick });

    ipcMain.emit("monitor:open");
    const mon = await waitFor(findMonitor, 40);
    check("A: the monitor window opens while all of that is up", !!mon);

    const ctxA = await run(`(function(){
      return {
        panelsOpen: ['settingsPanel','mediaPanel','miniPanel'].map(id => { const e = document.getElementById(id); return e ? e.hidden === false : null; }),
        otherWindows: 0
      };
    })()`);
    check("A: opening the monitor/quick note did NOT close the side panels",
      ctxA.panelsOpen.every(v => v === true), ctxA);
    const popupNow = { collapsed: await prun(`document.body.classList.contains('pip-collapsed')`), bounds: findPip().getBounds() };
    check("A: the popup is a real expanded chat while 3 panels + 2 windows are up",
      popupNow.collapsed === false && popupNow.bounds.width > 400 && popupNow.bounds.height > 350, popupNow);

    /* ========================================================== B. cross-window
       What is typed in the popup has to land in the chat window (and back). */
    const tagFromPip = "combo-from-popup-" + Date.now();
    const sentPip = await prun(`(async function(){
      const i = document.getElementById('messageInput');
      i.value = ${JSON.stringify(tagFromPip)};
      document.getElementById('btnSend').click();
      await new Promise(r => setTimeout(r, 50));
      return true;
    })()`);
    const inChat = await poll(() => run(`document.getElementById('messages').textContent.includes(${JSON.stringify(tagFromPip)})`), 30, 200);
    const inPopup = await poll(() => prun(`document.getElementById('messages').textContent.includes(${JSON.stringify(tagFromPip)})`), 30, 200);
    check("B: a message sent from the POPUP shows up in the chat window", sentPip === true && inChat === true);
    check("B: …and in the popup itself", inPopup === true);

    const tagFromMain = "combo-from-chat-" + Date.now();
    await run(`(async function(){
      const i = document.getElementById('messageInput');
      i.value = ${JSON.stringify(tagFromMain)};
      document.getElementById('btnSend').click();
      await new Promise(r => setTimeout(r, 50));
      return true;
    })()`);
    const backInPip = await poll(() => prun(`document.getElementById('messages').textContent.includes(${JSON.stringify(tagFromMain)})`), 30, 200);
    check("B: a message sent from the chat window shows up in the POPUP", backInPip === true);

    const bothSame = await run(`(async function(){
      const s = await window.api.load();
      const chat = s.chats.find(c => c.id === s.activeChatId) || s.chats[0];
      return { active: s.activeChatId, chats: s.chats.length, msgs: s.messages.filter(m => m.chatId === chat.id).length };
    })()`);
    check("B: both windows agree on the active chat and its messages",
      !!bothSame && bothSame.chats >= 1 && bothSame.msgs >= 2, bothSame);

    /* Sending a burst while every window and panel is up: nothing may be
       swallowed, doubled, or lost between two windows writing the same store. */
    const spamTag = "combo-spam-" + Date.now();
    await run(`(async function(){
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const i = document.getElementById('messageInput');
      const b = document.getElementById('btnSend');
      for (let k = 0; k < 10; k++) { i.value = ${JSON.stringify(spamTag)} + '-' + k; b.click(); await wait(50); }
      return true;
    })()`);
    await wait(1500);
    const spamSeen = await run(`(async function(){
      const s = await window.api.load();
      const chat = s.chats.find(c => c.id === s.activeChatId) || s.chats[0];
      const list = s.messages.filter(m => m.chatId === chat.id && m.text.indexOf(${JSON.stringify(spamTag)}) === 0).map(m => m.text);
      return { count: list.length, uniq: new Set(list).size, rendered: document.getElementById('messages').textContent.indexOf(${JSON.stringify(spamTag)}) !== -1 };
    })()`);
    const spamInPip = await prun(`document.getElementById('messages').textContent.indexOf(${JSON.stringify(spamTag)}) !== -1`);
    check("B: 10 messages sent back-to-back all land exactly once and render",
      spamSeen.count === 10 && spamSeen.uniq === 10 && spamSeen.rendered === true, spamSeen);
    check("B: the popup shows the burst too (no swallowed sync)", spamInPip === true);

    /* ============================================================== C. themes
       A theme picked in one window must reach the other one — and the popup's
       own bubble text has to stay readable after the switch. */
    await run(`document.querySelector('.theme-dot[data-theme="ocean"]').click()`);
    const themed = await poll(() => prun(`document.body.classList.contains('theme-ocean')`), 20, 150);
    const themedMain = await poll(() => run(`document.body.classList.contains('theme-ocean')`), 20, 150);
    check("C: a theme chosen in the chat window reaches the popup", themed === true);
    check("C: …and the chat window itself is on the new theme", themedMain === true);

    const popupReadable = await prun(`(function(){
      // Custom properties live on :root, so read them there (and never assume
      // one resolves — an empty value used to blow up this whole probe).
      const cs = getComputedStyle(document.documentElement);
      // Let the DOM normalise whatever shape the token is in (#hex, rgb(), …)
      // before doing any colour maths on it.
      const probe = document.createElement('span');
      probe.style.cssText = 'position:fixed;left:-9999px';
      document.body.append(probe);
      const norm = c => { probe.style.color = ''; probe.style.color = String(c || ''); return getComputedStyle(probe).color; };
      const nums = c => { const m = String(c || '').match(/[0-9.]+/g); return m && m.length >= 3 ? m.slice(0, 3).map(Number) : null; };
      const lum = c => {
        const m = nums(c);
        if (!m) return null;
        const v = m.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      };
      const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); if (l1 === null || l2 === null) return null; const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
      const bg = norm(cs.getPropertyValue('--bg-primary').trim());
      const fg = norm(cs.getPropertyValue('--text-primary').trim());
      const pill = document.querySelector('.pip-bubble-pill');
      const pillCs = pill ? getComputedStyle(pill) : null;
      const out = {
        text: ratio(fg, bg),
        pillText: pillCs ? ratio(pillCs.color, pillCs.backgroundColor === 'rgba(0, 0, 0, 0)' ? bg : pillCs.backgroundColor) : null,
        bg: bg, fg: fg, theme: document.body.className
      };
      probe.remove();
      return out;
    })()`).catch(e => ({ error: String(e) }));
    check("C: the popup stays readable after the theme switch (AA 4.5:1)",
      !!popupReadable && popupReadable.text >= 4.5, popupReadable);

    /* Esc in the expanded popup collapses it to the bubble — it must never be
       the shortcut that closes the floating window (or the app). */
    const escRes = await prun(`(async function(){
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(700);
      return document.body.classList.contains('pip-collapsed');
    })()`);
    const escBounds = pip.getBounds();
    check("C: Esc in the expanded popup collapses it to the bubble (window survives)",
      escRes === true && pip.isDestroyed() === false && escBounds.width < 320, { collapsed: escRes, bounds: escBounds });
    ipcMain.emit("pip:expand");
    await wait(1200);

    /* =========================================== D. hammering the bar controls
       Everything else is still open. Nothing may die or drift out of sync. */
    for (let i = 0; i < 6; i++) {
      ipcMain.emit("pip:collapse");
      await wait(220);
      ipcMain.emit("pip:expand");
      await wait(320);
    }
    await wait(500);
    const afterHammer = await prun(`(function(){ return { collapsed: document.body.classList.contains('pip-collapsed'), max: document.body.classList.contains('pip-max') }; })()`);
    const hammerBounds = pip.getBounds();
    check("D: 6× collapse/expand under load leaves a sane expanded popup",
      pip.isDestroyed() === false && afterHammer.collapsed === false && hammerBounds.width > 400 && hammerBounds.height > 350,
      { bounds: hammerBounds, afterHammer });

    const orient0 = await prun(`window.api.pip.getOrient()`);
    ipcMain.emit("pip:flip");
    await wait(500);
    const orient1 = await prun(`window.api.pip.getOrient()`);
    ipcMain.emit("pip:flip");
    await wait(500);
    const orient2 = await prun(`window.api.pip.getOrient()`);
    check("D: flipping the bubble orientation twice lands back where it started",
      orient1 !== orient0 && orient2 === orient0, { orient0, orient1, orient2 });

    ipcMain.emit("pip:maximize");
    await wait(900);
    const maxed = pip.getBounds();
    const wa = screen.getDisplayMatching(maxed).workArea;
    ipcMain.emit("pip:maximize");
    await wait(900);
    const restored = pip.getBounds();
    check("D: maximise fills the work area and restoring shrinks back",
      Math.abs(maxed.width - wa.width) <= 4 && Math.abs(maxed.height - wa.height) <= 4 && restored.width < maxed.width,
      { maxed, restored, wa });

    ipcMain.emit("pip:collapse");
    await wait(500);
    const miniBounds = pip.getBounds();
    const miniState = await prun(`document.body.classList.contains('pip-collapsed')`);
    check("D: collapsing lands back on the small pill in one step",
      miniBounds.width < 320 && miniBounds.height < 300 && miniState === true, { bounds: miniBounds, miniState });
    check("D: the chat window survived all of the above",
      main.isDestroyed() === false && (await run(`document.body.classList.contains('app-ready')`)) === true);

    /* =============================================== E. recording + everything
       A real recording from the collapsed bubble while the rest of the app is
       being used: tucked away, monitor open, theme switched, popup expanded,
       screenshot picker opened and cancelled. Then it has to still stop and
       save a real file. */
    await prun(SETUP);
    await wait(400);
    await clickId(pip, "btnBubbleRec");
    const recOn = await poll(() => prun(`!document.getElementById('recHud').hidden`), 40, 250);
    check("E: a recording starts from the collapsed bubble", recOn === true);
    const cam = await waitFor(findCam, 30);
    check("E: the floating camera bubble opens with it", !!cam);
    await wait(1500);

    const hudFits = await prun(`(function(){
      const vw = window.innerWidth, vh = window.innerHeight;
      const btns = [...document.querySelectorAll('#recHud .rec-hud-btn')];
      return {
        vw: vw, vh: vh, n: btns.length,
        outside: btns.filter(b => { const r = b.getBoundingClientRect(); return r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5; })
                    .map(b => (b.id || b.className) + ':' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height)),
        stop: !!document.getElementById('recHudStop')
      };
    })()`);
    check("E: every recording control fits inside the tiny bubble window (REC is stoppable)",
      hudFits.n >= 2 && hudFits.stop === true && hudFits.outside.length === 0, hudFits);

    const sig1 = await prun(FRAME_SIG);
    await wait(700);
    const sig2 = await prun(FRAME_SIG);
    check("E: the frame pump is alive while the whole app is open",
      !!sig1 && !!sig2 && sig1.sig !== sig2.sig, { a: sig1 && sig1.sig, b: sig2 && sig2.sig });

    /* Tuck the app away mid-recording (the bubble is what stays on screen). */
    await clickId(main, "btnPip");
    const tucked = await poll(() => main.isVisible() === false, 30, 120);
    check("E: the app tucks into the bar while recording, and the bar stays",
      tucked === true && !!findPip() && findPip().getBounds().width < 320, { tucked, bounds: findPip() && findPip().getBounds() });

    /* Screenshot picker over a running recording: the overlay must not camera-
       freeze or kill the recording, and cancelling must leave it running. */
    const shotCall = pip.webContents.executeJavaScript("window.api.capture.startShot()");
    // Wait until it is actually showing (not merely created) before cancelling:
    // an instant cancel is the documented "canceled" path, not a settled one.
    const overlay = await waitFor(() => {
      const w = findShot();
      return w && !w.webContents.isLoading() ? w : null;
    }, 60, 200);
    check("E: the screenshot picker opens on top of a running recording", !!overlay);
    const covered = overlay ? overlay.getBounds() : null;
    const disp = screen.getDisplayMatching(covered || { x: 0, y: 0, width: 1, height: 1 });
    check("E: it covers the whole display it was taken on",
      !!covered && covered.width >= disp.bounds.width - 2 && covered.height >= disp.bounds.height - 2,
      { covered, display: disp.bounds });
    ipcMain.emit("shot:cancel");
    const shotGone = await poll(() => !findShot(), 30, 150);
    const shotRes = await shotCall.catch(e => ({ error: String(e) }));
    check("E: cancelling it closes the picker without a fake failure",
      shotGone === true && !!shotRes && shotRes.ok === true, { shotGone, shotRes });
    const stillRec = await prun(`(function(){ return { hud: !document.getElementById('recHud').hidden, state: (window.__mrState||[]).slice(-4) }; })()`);
    check("E: the recording survived the screenshot picker", stillRec.hud === true, stillRec);

    /* Theme switch + monitor already open + popup expanded, recording running. */
    await prun(`document.querySelector('.theme-dot[data-theme="forest"]').click()`);
    await wait(600);
    ipcMain.emit("pip:expand");
    await wait(1200);
    const mid = await prun(`(function(){ return { hud: !document.getElementById('recHud').hidden, collapsed: document.body.classList.contains('pip-collapsed'), theme: document.body.className.includes('theme-forest') }; })()`);
    const sig3 = await prun(FRAME_SIG);
    await wait(700);
    const sig4 = await prun(FRAME_SIG);
    check("E: expanding the popup mid-recording keeps the HUD and the pump",
      mid.hud === true && mid.theme === true && !!sig3 && !!sig4 && sig3.sig !== sig4.sig, { mid, a: sig3 && sig3.sig, b: sig4 && sig4.sig });
    check("E: the monitor window is still alive through all of that", !!findMonitor());
    check("E: the floating camera bubble is still alive through all of that", !!findCam());

    /* Stop it and make sure a real file landed. */
    await clickId(pip, "recHudStop");
    await wait(2500);
    const recAfter = await prun(`(async function(){
      const l = await window.api.capture.list();
      return {
        names: l.map(i => i.name),
        events: (window.__mrEvents || []).filter(n => n > 0).length,
        states: (window.__mrState || []).slice(-4),
        hud: !document.getElementById('recHud').hidden
      };
    })()`);
    check("E: the recording made from the bubble saved a real file",
      recAfter.hud === false && recAfter.events > 0 && recAfter.names.some(n => /^rec-.*\.webm$/.test(n)), recAfter);
    check("E: stopping it closed the floating camera bubble",
      await poll(() => !findCam(), 30, 200) === true);

    /* ============================ F. picker parking both bubbles (no recording)
       The pill AND the camera bubble are always-on-top, so a region drag over
       them used to bake them into the picture. They get parked out of frame and
       put straight back — and pip.json must not be rewritten meanwhile. */
    ipcMain.emit("pip:collapse");
    await wait(500);
    if (main.isVisible() === false) { try { main.show(); } catch {} }
    const pipBefore = findPip().getBounds();
    const cfgBefore = fs.readFileSync(PIP_FILE(), "utf8");
    const shot2 = pip.webContents.executeJavaScript("window.api.capture.startShot()");
    const overlay2 = await waitFor(findShot, 40, 200);
    await wait(600);
    const parked = { pip: findPip() ? findPip().getBounds() : null };
    const offscreen = b => !!b && (b.x + b.width < screen.getAllDisplays().reduce((m, d) => Math.min(m, d.bounds.x), Infinity) ||
                                   b.y + b.height < screen.getAllDisplays().reduce((m, d) => Math.min(m, d.bounds.y), Infinity));
    check("F: the pill is parked OUT of the frame while the picker is open",
      !!overlay2 && offscreen(parked.pip), { parked, before: pipBefore });
    ipcMain.emit("shot:cancel");
    await poll(() => !findShot(), 30, 150);
    await shot2.catch(() => {});
    await wait(400);
    const pipBack = findPip() ? findPip().getBounds() : null;
    const cfgAfter = fs.readFileSync(PIP_FILE(), "utf8");
    check("F: …and it comes back to exactly where it was parked",
      !!pipBack && Math.abs(pipBack.x - pipBefore.x) <= 2 && Math.abs(pipBack.y - pipBefore.y) <= 2,
      { before: pipBefore, after: pipBack });
    check("F: parking it for the shot did NOT rewrite pip.json", cfgAfter === cfgBefore, { cfgBefore, cfgAfter });

    /* ============================================== G. library + search + delete
       Open the media library, search the chat while it is open, delete the
       capture the preview is showing. */
    const lib = await run(`(async function(){
      const wait = ms => new Promise(r => setTimeout(r, ms));
      // btnMedia is a toggle — and the panel was opened back in phase A.
      const panel = document.getElementById('mediaPanel');
      if (panel.hidden) document.getElementById('btnMedia').click();
      await wait(700);
      const cards = [...document.querySelectorAll('#mediaGrid .media-card')];
      const first = cards[0];
      const name = first ? first.dataset.name : null;
      if (first) { first.click(); }
      // Let the preview's <video> pull in the bytes it just wrote to disk.
      let v = null;
      for (let i = 0; i < 30; i++) {
        v = document.querySelector('#mediaPreviewBody video');
        if (v && (v.readyState >= 1 || v.error)) break;
        await wait(200);
      }
      return {
        shown: document.getElementById('mediaPanel').hidden === false,
        cards: cards.length, name: name,
        preview: document.getElementById('mediaPreview').hidden === false,
        video: v ? { src: String(v.currentSrc || v.src).slice(0, 30), readyState: v.readyState, err: v.error ? (v.error.code || true) : null, duration: Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null } : null
      };
    })()`).catch(e => ({ error: String(e) }));
    check("G: the media library lists the recording made while everything was open",
      lib.shown === true && lib.cards >= 1, lib);
    check("G: its preview opens and the video really loads (metadata, no error)",
      !!lib.video && lib.video.err === null && lib.video.readyState >= 1 && String(lib.video.src).startsWith("local-file://"), lib.video);

    const searchCombo = await run(`(async function(){
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const inp = document.getElementById('messageInput');
      inp.value = 'draft still here';
      document.getElementById('btnSearchMsgs').click();
      await wait(300);
      const sb = document.getElementById('msgSearchInput');
      sb.value = 'combo';
      sb.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(500);
      return {
        barOpen: document.getElementById('searchBar').hidden === false,
        count: (document.getElementById('searchCount') || {}).textContent || '',
        draftKept: inp.value === 'draft still here',
        libStill: document.getElementById('mediaPanel').hidden === false
      };
    })()`).catch(e => ({ error: String(e) }));
    check("G: search runs while the media library is open, without eating the draft",
      searchCombo.barOpen === true && searchCombo.draftKept === true && searchCombo.libStill === true, searchCombo);
    check("G: the search reports hits for the messages just sent", /\d/.test(String(searchCombo.count)), searchCombo.count);

    const cleaned = await run(`(async function(){
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const inp = document.getElementById('messageInput');
      inp.value = '';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('btnCloseSearch').click();
      await wait(250);
      // Close the preview first (the real flow), then delete from the grid.
      document.getElementById('mediaPreviewClose').click();
      await wait(300);
      const before = [...document.querySelectorAll('#mediaGrid .media-card')];
      const first = before[0];
      let name = null, dialogOpened = false;
      if (first) {
        name = first.dataset.name;
        const del = first.querySelector('.media-actions button.danger');
        if (del) { del.click(); await wait(500); }
        dialogOpened = !!document.querySelector('#dialogOverlay:not([hidden]) .dialog-ok');
        const ok = document.querySelector('#dialogOverlay .dialog-ok');
        if (ok) { ok.click(); await wait(1000); }
      }
      const after = [...document.querySelectorAll('#mediaGrid .media-card')].map(c => c.dataset.name);
      const l = await window.api.capture.list();
      const empty = document.getElementById('mediaEmpty');
      return { deleted: name, dialogOpened: dialogOpened, cards: after.length, listed: l.length,
               gone: name ? after.indexOf(name) === -1 : null,
               emptyShown: empty ? empty.hidden === false : null,
               panel: document.getElementById('mediaPanel').hidden === false };
    })()`).catch(e => ({ error: String(e) }));
    check("G: deleting a capture from the library asks first and then really removes it",
      cleaned.dialogOpened === true && cleaned.gone === true && cleaned.listed === cleaned.cards, cleaned);
    const libAlive = await poll(() => run(`document.getElementById('mediaPanel').hidden === false`), 20, 200);
    check("G: the library is still usable after the delete (grid + empty state agree)",
      libAlive === true && cleaned.panel === true &&
      (cleaned.cards > 0 || cleaned.emptyShown === true), cleaned);

    /* ================================================= H. tuck / relaunch / close
       Everything is closed except the bar, then the app is tucked, relaunched
       (second-instance) and the bar closed. */
    await run(`(function(){
      ['btnCloseSettings','btnCloseMedia','btnCloseMini'].forEach(id => { const b = document.getElementById(id); if (b) b.click(); });
    })()`).catch(() => {});
    ipcMain.emit("monitor:close");
    await poll(() => !findMonitor(), 30, 200);
    try { ipcMain.emit("quick:hide"); } catch {}

    ipcMain.emit("pip:collapse");
    await wait(500);
    await clickId(main, "btnPip");
    const tucked2 = await poll(() => main.isVisible() === false, 30, 120);
    check("H: with the other windows closed the app still tucks into the bar",
      tucked2 === true && !!findPip(), { tucked2 });

    try { app.emit("second-instance", {}, [], process.cwd(), {}); } catch {}
    const back = await poll(() => main.isVisible() === true, 30, 150);
    check("H: launching the app again brings the hidden chat window back", back === true);

    await clickId(main, "btnPip");
    await wait(300);
    ipcMain.emit("pip:toggle");     // rail toggle on an existing bar → expand
    await wait(1200);
    const toggled = findPip() ? findPip().getBounds() : null;
    check("H: the rail button flips the open bar into the popup",
      !!toggled && toggled.width > 400, { bounds: toggled });

    ipcMain.emit("pip:close");
    const barGone = await poll(() => !findPip(), 30, 200);
    check("H: closing the bar leaves the chat window on screen (never nothing)",
      barGone === true && main.isVisible() === true && main.isDestroyed() === false,
      { barGone, visible: main.isVisible() });

    /* ================================================== I. cleanliness under load */
    check("I: no renderer window logged an error during the whole combination run",
      rendererErrors.length === 0, { count: rendererErrors.length, errors: rendererErrors.slice(0, 8) });
    check("I: nothing was written to error.log",
      !fs.existsSync(ERROR_LOG),
      fs.existsSync(ERROR_LOG) ? fs.readFileSync(ERROR_LOG, "utf8").slice(0, 400) : null);
    const leftovers = BrowserWindow.getAllWindows().filter(w => {
      if (w.isDestroyed()) return false;
      try { return w.isVisible() && !String(w.webContents.getURL()).includes("index.html"); } catch { return false; }
    }).map(w => { try { return String(w.webContents.getURL()).split("/").pop(); } catch { return "?"; } });
    check("I: no stray window is left on screen", leftovers.length === 0, leftovers);
  } catch (e) {
    console.log("EXC " + ((e && e.stack) || e));
    failed = true;
  } finally {
    clearTimeout(guard);
    console.log("RESULT " + (failed ? "FAIL" : "PASS"));
    await wait(400);
    app.exit(failed ? 1 : 0);
  }
});
