/* Smoke test for the mini recording panel (⚙ in the floating menu) and for the
 * frame pump that makes recordings smooth:
 *
 *   1. the panel opens from the collapsed pill without covering it
 *   2. quality / fps / cursor / device choices persist to settings.json and are
 *      broadcast to the other windows
 *   3. the recording honours them: frame size, captureStream fps, encoder
 *      bitrate, getDisplayMedia frameRate + cursor
 *   4. the frame pump keeps producing frames with requestAnimationFrame dead —
 *      which is what a throttled/occluded window looks like (the old rAF loop
 *      stalled there and the video stuttered)
 *   5. the recording window is unthrottled while recording, and released after
 *
 * Run: npx electron rectest.js
 * Set RECTEST_USERDATA=<dir> to use a throwaway profile (recommended).
 */
const path = require("path");
const fs = require("fs");
const { app, ipcMain, BrowserWindow } = require("electron");

if (process.env.RECTEST_USERDATA) {
  fs.mkdirSync(process.env.RECTEST_USERDATA, { recursive: true });
  app.setPath("userData", process.env.RECTEST_USERDATA);
}

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
}, 180000);

/* Fake devices with a 1280×720 screen whose content moves, so consecutive
   frames differ and a stalled frame pump is detectable. Also spies on every
   knob the smoothness work touches. */
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
    const OrigMR = window.MediaRecorder;
    window.MediaRecorder = function(stream, opts){
      window.__mrOptions = opts || null;
      window.__mrStream = stream;
      const mr = new OrigMR(stream, opts);
      mr.addEventListener('dataavailable', e => window.__mrEvents.push(e.data ? e.data.size : -1));
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
      window.__camTrack = s.getVideoTracks()[0];
      return new MediaStream(s.getVideoTracks());
    };

    // A throttled/occluded window looks exactly like this to the renderer.
    window.__realRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 0;
    return true;
  })()
`;

/* Two reads of the recording canvas' middle row: if the content moved, the
   frame pump is alive. */
const FRAME_SIG = `
  (function(){
    const c = window.__recCanvas;
    if (!c) return null;
    const d = c.getContext('2d').getImageData(0, Math.floor(c.height / 2), c.width, 1).data;
    let sum = 0, sig = 0;
    for (let i = 0; i < d.length; i += 4) { sum += d[i] + d[i + 1] + d[i + 2]; sig = (sig * 31 + d[i] + d[i + 1] + d[i + 2]) % 2147483647; }
    return { w: c.width, h: c.height, sum: sum, sig: sig };
  })()
`;

app.whenReady().then(async () => {
  try {
    await wait(1600);

    /* ---- 1. the panel opens from the collapsed pill ---------------------- */
    ipcMain.emit("pip:open");
    await wait(2500);
    const pip = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && String(w.webContents.getURL()).includes("pip=1"));
    check("floating bubble window created", !!pip);
    if (!pip) return;
    ipcMain.emit("pip:collapse");
    await wait(900);
    const pipRun = js => pip.webContents.executeJavaScript(js);
    await pipRun(`document.body.classList.add('pip-collapsed')`);
    await wait(300);
    const beforePill = pip.getBounds();
    check("bubble starts collapsed (56×248)", beforePill.width < 120, beforePill);

    await pipRun(`document.getElementById('btnBubbleSettings').click()`);
    await wait(900);
    const panel = await pipRun(`(function(){
      const st = document.createElement('style');
      st.textContent = '*{animation:none!important;transition:none!important}';
      document.head.append(st);
      const p = document.getElementById('miniPanel');
      const r = p ? p.getBoundingClientRect() : null;
      const close = document.getElementById('btnCloseMini');
      const cr = close ? close.getBoundingClientRect() : null;
      return {
        collapsed: document.body.classList.contains('pip-collapsed'),
        shown: p ? p.hidden === false : null,
        inside: r ? (r.left >= -0.5 && r.right <= window.innerWidth + 0.5) : null,
        w: r ? Math.round(r.width) : null,
        closeInside: cr ? (cr.left >= -0.5 && cr.right <= window.innerWidth + 0.5) : null,
        vw: window.innerWidth, vh: window.innerHeight,
        title: (p && p.querySelector('.settings-header h3')) ? p.querySelector('.settings-header h3').textContent : null
      };
    })()`);
    const afterPill = pip.getBounds();
    check("⚙ in the floating menu grows the bubble and shows the panel inside it",
      afterPill.width > beforePill.width + 100 && panel.shown === true && panel.collapsed === false &&
      panel.inside === true && panel.closeInside === true && panel.title === "Recording",
      { before: beforePill, after: afterPill, panel });

    /* ---- 2. the choices persist and reach the other windows -------------- */
    const wired = await pipRun(`(function(){
      const q = document.getElementById('miniQuality');
      const f = document.getElementById('miniFps');
      const c = document.getElementById('miniCursor');
      const cam = document.getElementById('miniCam');
      const mic = document.getElementById('miniMic');
      const before = {
        quality: (q.querySelector('.seg-btn.active') || {}).dataset ? q.querySelector('.seg-btn.active').dataset.q : null,
        fps: (f.querySelector('.seg-btn.active') || {}).dataset ? Number(f.querySelector('.seg-btn.active').dataset.fps) : null,
        cursor: c.checked,
        camOptions: cam ? cam.options.length : 0,
        micOptions: mic ? mic.options.length : 0,
        camValue: cam ? cam.value : null
      };
      q.querySelector('[data-q="sd"]').click();
      f.querySelector('[data-fps="60"]').click();
      c.checked = false;
      c.dispatchEvent(new Event('change', { bubbles: true }));
      return before;
    })()`);
    await wait(600);
    const saved = await pipRun(`window.api.loadSettings()`);
    check("panel controls default to HD / 30 fps / cursor on",
      wired.quality === "hd" && wired.fps === 30 && wired.cursor === true &&
      wired.camOptions >= 1 && wired.micOptions >= 1, wired);
    check("quality / fps / cursor are saved and broadcast",
      saved.recQuality === "sd" && saved.recFps === 60 && saved.recCursor === false, saved);

    /* ---- 3+4. the recording honours them and keeps pumping frames -------- */
    const main = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && !String(w.webContents.getURL()).includes("pip=1"));
    check("main window still there", !!main);
    if (!main) return;
    // A hidden window throttles its timers, which would starve the fake screen.
    try { main.show(); main.focus(); main.webContents.setBackgroundThrottling(false); } catch {}
    const run = js => main.webContents.executeJavaScript(js);
    await wait(400);
    await run(SETUP);

    await run(`document.getElementById('btnScreenRec').click()`);
    let hudOn = false;
    for (let i = 0; i < 40 && !hudOn; i++) {
      hudOn = await run(`!document.getElementById('recHud').hidden`);
      if (!hudOn) await wait(250);
    }
    check("recording started", hudOn === true);

    const first = await run(FRAME_SIG);
    await wait(600);
    const second = await run(FRAME_SIG);
    check("the frame pump keeps drawing with requestAnimationFrame dead",
      !!first && !!second && first.sig !== second.sig,
      { first: first && first.sum, second: second && second.sum });

    const opts = await run(`(function(){
      return {
        capFps: window.__capFps || [],
        mr: window.__mrOptions,
        gdm: window.__gdm,
        canvas: window.__recCanvas ? { w: window.__recCanvas.width, h: window.__recCanvas.height } : null
      };
    })()`);

    // SD on a 720p screen = 480p tall, 16:9 kept, even dimensions.
    check("SD preset records a 480p frame (scaled, aspect kept)",
      !!opts.canvas && opts.canvas.h === 480 && Math.abs(opts.canvas.w / opts.canvas.h - 16 / 9) < 0.02,
      opts.canvas);
    check("60 fps reaches the capture stream", opts.capFps.includes(60), opts.capFps);
    check("the encoder bitrate follows preset × frame rate",
      !!opts.mr && opts.mr.videoBitsPerSecond === 5000000, opts.mr && opts.mr.videoBitsPerSecond);
    check("getDisplayMedia gets the frame rate and the cursor choice",
      !!opts.gdm && opts.gdm.video && opts.gdm.video.frameRate.ideal === 60 && opts.gdm.video.cursor === "never",
      opts.gdm && opts.gdm.video);

    /* ---- 5. the recording window is unthrottled, then released ---------- */
    const holders = await run(`(async()=>{
      const on = await window.api.capture.recordingActive(true);
      const off = await window.api.capture.recordingActive(false);
      return { on: on, off: off };
    })()`);
    check("recording holds (and releases) the unthrottled/non-sleeping state",
      holders.on.holders >= 1 && holders.off.holders === 0, holders);

    await wait(1200);
    await run(`document.getElementById('recHudStop').click()`);
    await wait(2500);
    const after = await run(`(async()=>{
      const l = await window.api.capture.list();
      return {
        names: l.map(i => i.name),
        events: (window.__mrEvents || []).slice(-10),
        toast: (document.getElementById('toast') || {}).textContent,
        hud: !document.getElementById('recHud').hidden
      };
    })()`);
    check("the recording saved a real file",
      after.names.some(n => /^rec-.*\.webm$/.test(n)) && after.hud === false,
      after);

    for (const id of ["recHudDiscard", "btnCloseMedia", "btnCloseMini"]) {
      await run(`(function(){ const b = document.getElementById('${id}'); if (b) b.click(); })()`).catch(() => {});
    }
  } catch (e) {
    console.log("EXC " + ((e && e.stack) || e));
    failed = true;
  } finally {
    clearTimeout(guard);
    await wait(300);
    app.exit(failed ? 1 : 0);
  }
});
