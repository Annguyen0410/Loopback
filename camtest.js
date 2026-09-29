/* Smoke test for the camera in a screen recording (the reported asks):
 *   1. the camera really shows up in the saved video, where the on-screen
 *      preview says it is
 *   2. dragging the preview moves the burned-in bubble (viewer sees it move)
 *   3. turning the camera off releases the device — the hardware light goes
 *      out — and turning it back on re-opens it mid-recording
 *   4. a camera that disappears on its own (unplugged / switched off in the
 *      OS) flips the app to camera-off instead of showing a frozen frame
 *   5. pause/resume really holds the recording, and stopping releases
 *      everything
 *
 * No hardware is touched: getDisplayMedia/getUserMedia are stubbed with canvas
 * streams, and the recording canvas is picked up through captureStream() so
 * real pixels can be inspected. The app's own pipeline (startRec, HUD buttons,
 * preview drag, MediaRecorder, IPC save) runs unchanged.
 *
 * Run (close the app first — it holds the single-instance lock):
 *   npx electron camtest.js
 * Set CAMTEST_USERDATA=<dir> to use a throwaway profile.
 */
const path = require("path");
const fs = require("fs");
const { app, BrowserWindow } = require("electron");

if (process.env.CAMTEST_USERDATA) {
  fs.mkdirSync(process.env.CAMTEST_USERDATA, { recursive: true });
  app.setPath("userData", process.env.CAMTEST_USERDATA);
}

require("./main.js"); // real IPC handlers (captures, settings, content protection)

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

/* Pick up the canvas the recorder streams from: every other canvas in the app
   is tagged by the stubs, so only the real recording canvas is kept. */
const SETUP = `
  (function(){
    window.__fake = {};
    const origCapture = HTMLCanvasElement.prototype.captureStream;
    window.__origCapture = origCapture;
    HTMLCanvasElement.prototype.captureStream = function(...a){
      if (!this.dataset || !this.dataset.fake) window.__recCanvas = this;
      return origCapture.apply(this, a);
    };

    function fakeCanvas(fake, w, h, paint){
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.dataset.fake = fake;
      c.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.append(c);
      const ctx = c.getContext('2d');
      const draw = () => { paint(ctx, w, h); };
      draw();
      c.__timer = setInterval(draw, 100);   // captureStream only emits on paint
      window.__fake[fake] = c;
      return c;
    }
    const screen = fakeCanvas('screen', 640, 360, (ctx,w,h) => {
      ctx.fillStyle = '#1e3a8a'; ctx.fillRect(0,0,w,h);
      ctx.fillStyle = '#93c5fd'; ctx.fillRect(8, 8, 60, 20);
    });
    // Solid green: easy to find in the recorded frames.
    const cam = fakeCanvas('cam', 320, 240, (ctx,w,h) => { ctx.fillStyle = '#00dc00'; ctx.fillRect(0,0,w,h); });

    // Watch what the real MediaRecorder does with the stubbed streams.
    const OrigMR = window.MediaRecorder;
    window.__mrEvents = [];
    window.MediaRecorder = function(...a){
      const mr = new OrigMR(...a);
      window.__mr = mr;
      mr.addEventListener('start', () => window.__mrEvents.push('start'));
      mr.addEventListener('pause', () => window.__mrEvents.push('pause'));
      mr.addEventListener('resume', () => window.__mrEvents.push('resume'));
      mr.addEventListener('error', e => window.__mrEvents.push('error:' + (e.error && e.error.name)));
      mr.addEventListener('dataavailable', e => window.__mrEvents.push(e.data ? e.data.size : -1));
      return mr;
    };
    window.MediaRecorder.prototype = OrigMR.prototype;
    window.MediaRecorder.isTypeSupported = OrigMR.isTypeSupported.bind(OrigMR);

    window.__camOpen = 0;
    navigator.mediaDevices.getDisplayMedia = async () => new MediaStream(screen.captureStream(20).getVideoTracks());
    navigator.mediaDevices.getUserMedia = async () => {
      window.__camOpen++;
      const s = cam.captureStream(15);
      window.__camTrack = s.getVideoTracks()[0];
      return new MediaStream(s.getVideoTracks());
    };
    return { ok: true, hasCanvasHook: !!window.__recCanvas || true };
  })()
`;

/* The recorded frame + where the green camera bubble landed in it. */
const SCAN = `
  (function(){
    const c = window.__recCanvas;
    if (!c) return { err: 'no recording canvas' };
    const w = c.width, h = c.height;
    const d = c.getContext('2d').getImageData(0, 0, w, h).data;
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i+1] > 150 && d[i] < 90 && d[i+2] < 90) {
          count++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    const px = (x, y) => {
      const i = ((y|0) * w + (x|0)) * 4;
      return [d[i], d[i+1], d[i+2]];
    };
    const prev = document.getElementById('camPreview');
    const pr = prev && !prev.hidden ? prev.getBoundingClientRect() : null;
    return {
      frame: { w: w, h: h },
      bubble: count ? { count: count, minX: minX, minY: minY, maxX: maxX, maxY: maxY,
        cx: (minX+maxX)/2, cy: (minY+maxY)/2, w: maxX-minX+1, h: maxY-minY+1 } : null,
      corner: px(w - 6, 6),
      preview: pr ? { cx: pr.left + pr.width/2, cy: pr.top + pr.height/2, w: pr.width, h: pr.height, hidden: false } : null,
      hud: !document.getElementById('recHud').hidden,
      paused: document.getElementById('recHud').classList.contains('paused'),
      camBtnOff: document.getElementById('recHudCam').classList.contains('off'),
      trackState: window.__camTrack ? window.__camTrack.readyState : null,
      opened: window.__camOpen
    };
  })()
`;

app.whenReady().then(async () => {
  const saved = [];
  try {
    await wait(1500);
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getTitle() !== "Quick note");
    check("main window booted", !!win);
    if (!win) return;
    try { win.show(); win.focus(); win.webContents.setBackgroundThrottling(false); } catch {}
    const run = js => win.webContents.executeJavaScript(js);
    const errors = [];
    win.webContents.on("console-message", (e, level, message) => { if (level >= 3) errors.push(String(message).slice(0, 200)); });

    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      ready = await run(`document.body.classList.contains('app-ready')`);
      if (!ready) await wait(250);
    }
    check("renderer finished initializing", ready === true);

    /* The camera module has to load from the page (it is what capture.js uses). */
    const mod = await run(`(async()=>{
      try {
        const m = await import('./src/renderer/camera.js');
        return { ok: true, keys: Object.keys(m).length, scales: m.CAM_SCALES.length, labels: m.CAM_SIZE_LABELS };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    check("camera module loads in the renderer", mod.ok === true && mod.keys > 10 && mod.scales === 3 && mod.labels.join("") === "SML", mod);
    if (!mod.ok) throw new Error("camera module unavailable");

    /* Geometry: sane defaults, aspect kept, always inside the frame. */
    const geo = await run(`(async()=>{
      const c = await import('./src/renderer/camera.js');
      const r = c.camRect(1920, 1080, 640, 480, { x: 0.9, y: 0.82 }, 1);
      const left = c.camRect(1920, 1080, 640, 480, { x: 0, y: 0 }, 1);
      const tl = c.camRect(1920, 1080, 640, 480, { x: 1, y: 1 }, 1);
      const big = c.camRect(1920, 1080, 640, 480, { x: 0.5, y: 0.5 }, 2);
      const small = c.camRect(640, 360, 320, 240, { x: 0.9, y: 0.8 }, 0);
      const nan = c.camRect(800, 600, 0, 0, null, undefined);
      const clamp = c.clampNorm({ x: 5, y: -3 }, 400, 300, 160, 120, 8);
      const inside = r => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1920 && r.y + r.h <= 1080;
      return { r, left, tl, big, small, nan, clamp, inside: [inside(r), inside(left), inside(tl), inside(big)] };
    })()`);
    check("bubble default sits in the bottom-right with the camera aspect kept",
      geo.r.w === Math.round(1920 * 0.22) && Math.abs(geo.r.h - Math.round(geo.r.w * 0.75)) <= 1 &&
      geo.r.x + geo.r.w <= 1920 && geo.r.y + geo.r.h <= 1080,
      geo.r);
    check("bubble sticks to the frame edges instead of hanging off",
      geo.left.x >= 20 && geo.tl.x + geo.tl.w <= 1920 && geo.tl.y + geo.tl.h <= 1080 && geo.inside.every(Boolean),
      { left: geo.left, topLeft: geo.tl });
    check("size steps scale the bubble (S < M < L)",
      geo.small.w < geo.r.w && geo.big.w > geo.r.w && geo.big.w / geo.r.w > 1.3,
      { small: geo.small.w, medium: geo.r.w, large: geo.big.w });
    check("missing camera size/position data falls back safely",
      geo.nan.w > 0 && geo.nan.h > 0 && geo.nan.x >= 0 && geo.nan.y >= 0, geo.nan);
    check("preview centre stays inside a small window", geo.clamp.x <= 1 && geo.clamp.y <= 1 && geo.clamp.x > 0 && geo.clamp.y > 0, geo.clamp);

    /* Settings wiring for the new toggle + preview badge. */
    const ui = await run(`(async()=>{
      const cb = document.getElementById('settingHideInRec');
      const badge = document.getElementById('camPreviewSize');
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('btnSettings').click();
      const panelOpen = !document.getElementById('settingsPanel').hidden;
      const labels = [...document.querySelectorAll('#settingsPanel .settings-label')].map(e => e.textContent);
      const hint = [...document.querySelectorAll('#settingsPanel .settings-hint')].map(e => e.textContent).join(' | ');
      cb.checked = false;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(400);
      const off = (await window.api.loadSettings()).hideInRecording;
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(400);
      const on = (await window.api.loadSettings()).hideInRecording;
      document.getElementById('btnCloseSettings').click();
      return { panelOpen: panelOpen, labels: labels, camHint: /Drag the (live )?camera preview/.test(hint), off: off, on: on, badge: badge ? badge.textContent : null };
    })()`);
    check("Settings gained the recording group and the toggle persists",
      ui.panelOpen === true && ui.labels.includes("Screen Recording") && ui.off === false && ui.on === true && ui.camHint === true,
      ui);
    check("the preview shows its current size step (M by default)", ui.badge === "M", ui.badge);

    /* --- the recording itself, on stubbed devices ---------------------- */
    await run(SETUP);
    const hidden = await run(`(async()=>{
      const r = await window.api.capture.setContentProtection(true);
      const off = await window.api.capture.setContentProtection(false);
      return { on: r, off: off, checked: document.getElementById('settingHideInRec') ? document.getElementById('settingHideInRec').checked : null };
    })()`);
    check("'hide this window from recordings' is on by default and its IPC works",
      hidden.checked === true && hidden.on && hidden.on.ok === true && hidden.on.windows >= 1 && hidden.off.ok === true, hidden);

    await run(`document.getElementById('btnScreenRec').click()`);
    for (let i = 0; i < 40; i++) {
      const hud = await run(`!document.getElementById('recHud').hidden`);
      if (hud) break;
      await wait(250);
    }
    await wait(1600);
    const on = await run(SCAN);
    check("recording started with the camera open", on.hud === true && on.opened === 1 && on.trackState === "live", { opened: on.opened, track: on.trackState });
    check("recorded frame is the full screen capture size", on.frame.w === 640 && on.frame.h === 360, on.frame);
    check("the camera really shows up in the recording", !!on.bubble && on.bubble.count > 4000, on.bubble && { count: on.bubble.count, w: on.bubble.w, h: on.bubble.h });
    check("the burned-in bubble matches its expected size",
      !!on.bubble && Math.abs(on.bubble.w - Math.round(640 * 0.22)) <= 4 && Math.abs(on.bubble.h - Math.round(Math.round(640 * 0.22) * 0.75)) <= 4,
      on.bubble && { w: on.bubble.w, h: on.bubble.h });
    check("the live preview is on screen at the same spot as the bubble",
      !!on.preview && !!on.bubble &&
      Math.abs((on.bubble.cx / on.frame.w) - (on.preview.cx / Math.max(1, win.getContentSize()[0]))) < 0.05,
      on.preview && { preview: on.preview, bubbleCx: on.bubble.cx, bubbleCy: on.bubble.cy });
    check("the rest of the frame is untouched screen", on.corner[0] < 90 && on.corner[2] > 120, on.corner);

    /* Drag the preview → the burned-in bubble follows. */
    const before = on.bubble;
    const dragged = await run(`(function(){
      const prev = document.getElementById('camPreview');
      const r = prev.getBoundingClientRect();
      const from = { x: r.left + r.width/2, y: r.top + r.height/2 };
      const to = { x: from.x - 220, y: from.y - 130 };
      const mk = (type, x, y) => new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'mouse',
        isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y
      });
      prev.dispatchEvent(mk('pointerdown', from.x, from.y));
      prev.dispatchEvent(mk('pointermove', to.x, to.y));
      prev.dispatchEvent(mk('pointerup', to.x, to.y));
      const after = document.getElementById('camPreview');
      return { left: after.style.left, top: after.style.top, w: after.style.width, h: after.style.height, dragging: after.classList.contains('dragging') };
    })()`);
    await wait(900);
    const moved = await run(SCAN);
    check("dragging moved the preview and it is not stuck in drag state",
      parseFloat(dragged.left) < 90 && parseFloat(dragged.top) < 80 && dragged.dragging === false, dragged);
    check("the recorded bubble moved with the drag (viewers see the new spot)",
      !!moved.bubble && moved.bubble.cx < before.cx - 60 && moved.bubble.cy < before.cy - 40,
      { before: { cx: before.cx, cy: before.cy }, after: moved.bubble && { cx: moved.bubble.cx, cy: moved.bubble.cy } });
    const savedCfg = await run(`(async()=>{ const c = await window.api.loadSettings(); return { camPos: c.camPos, camScale: c.camScale }; })()`);
    check("camera position is remembered for the next recording",
      !!savedCfg.camPos && savedCfg.camPos.x > 0 && savedCfg.camPos.x < 1 && savedCfg.camPos.y > 0 && savedCfg.camPos.y < 1,
      savedCfg);

    /* Resize: double-click cycles S/M/L and the bubble changes size. */
    await run(`(function(){
      const p = document.getElementById('camPreview');
      p.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    })()`);
    await wait(700);
    const bigger = await run(SCAN);
    check("double-clicking the preview resizes the burned-in bubble",
      !!bigger.bubble && bigger.bubble.w > moved.bubble.w + 10,
      { before: moved.bubble.w, after: bigger.bubble && bigger.bubble.w });

    /* --- camera off must release the device ---------------------------- */
    await run(`document.getElementById('recHudCam').click()`);
    await wait(900);
    const off = await run(SCAN);
    check("turning the camera off stops the track (hardware light out)",
      off.trackState === "ended" && off.camBtnOff === true, { track: off.trackState, buttonOff: off.camBtnOff });
    check("the preview disappears when the camera is off", off.preview === null, off.preview);
    check("no camera is burned into the frames while it is off", off.bubble === null, off.bubble);
    check("the recording keeps running with the camera off", off.hud === true && off.paused === false, { hud: off.hud });

    /* --- back on: re-opens the device mid-recording ---------------------- */
    await run(`document.getElementById('recHudCam').click()`);
    await wait(1400);
    const again = await run(SCAN);
    check("turning the camera back on re-opens the device", again.opened === 2 && again.trackState === "live", { opened: again.opened, track: again.trackState });
    check("the camera is burned in again at the remembered spot",
      !!again.bubble && Math.abs(again.bubble.cx - bigger.bubble.cx) < 12 && Math.abs(again.bubble.h - bigger.bubble.h) <= 4,
      { cx: again.bubble && again.bubble.cx, expected: bigger.bubble.cx });

    /* --- the OS switches the camera off under us ------------------------- */
    await run(`window.__camTrack.dispatchEvent(new Event('ended'))`);
    await wait(900);
    const lost = await run(SCAN);
    check("a camera that disappears on its own flips to camera-off",
      lost.camBtnOff === true && lost.preview === null && lost.bubble === null, { buttonOff: lost.camBtnOff, preview: lost.preview });
    check("recording survives the camera going away", lost.hud === true, lost.hud);

    /* --- pause / resume ------------------------------------------------- */
    await run(`document.getElementById('recHudPause').click()`);
    const t1 = await run(`document.getElementById('recHudTime').textContent`);
    await wait(1500);
    const p1 = await run(SCAN);
    const t2 = await run(`document.getElementById('recHudTime').textContent`);
    check("pause stops the timer and marks the HUD",
      p1.paused === true && t1 === t2 && p1.hud === true, { t1: t1, t2: t2, paused: p1.paused });
    await run(`document.getElementById('recHudPause').click()`);
    await wait(1600);
    const t3 = await run(`document.getElementById('recHudTime').textContent`);
    const p2 = await run(SCAN);
    check("resume starts the timer again", p2.paused === false && t3 !== t2, { t2: t2, t3: t3 });

    /* --- stop: everything is released ----------------------------------- */
    const mrDiag = await run(`({
      events: (window.__mrEvents || []).slice(-14),
      state: window.__mr ? window.__mr.state : null,
      mime: window.__mr ? window.__mr.mimeType : null,
      tracks: window.__mr ? window.__mr.stream.getTracks().map(t => t.kind + ':' + t.readyState) : null
    })`);
    check("no dataless audio track is mixed in (it would save an empty file)",
      !!mrDiag.tracks && mrDiag.tracks.length === 1 && mrDiag.tracks[0] === "video:live",
      mrDiag.tracks);
    check("the recorder produced real data while recording",
      (mrDiag.events || []).some(v => typeof v === "number" && v > 0),
      mrDiag.events);
    await run(`document.getElementById('recHudStop').click()`);
    for (let i = 0; i < 40; i++) {
      const done = await run(`document.getElementById('recHud').hidden`);
      if (done) break;
      await wait(250);
    }
    await wait(800);
    const after = await run(`(async()=>{
      const c = await import('./src/renderer/camera.js');
      const list = await window.api.capture.list();
      return {
        hud: !document.getElementById('recHud').hidden,
        preview: !document.getElementById('camPreview').hidden,
        live: c.isLive(),
        track: window.__camTrack ? window.__camTrack.readyState : null,
        recording: !!document.querySelector('[data-cap="rec"].recording'),
        toast: (document.getElementById('toast') || {}).textContent || '',
        list: (list && list.concat ? list : []).map(x => x && x.name).filter(Boolean)
      };
    })()`);
    check("stopping the recording releases the camera (light out)",
      after.live === false && after.track === "ended", { live: after.live, track: after.track });
    check("the HUD and preview are gone and the button is idle",
      after.hud === false && after.preview === false && after.recording === false, after);
    const rec = after.list.filter(n => /^rec-.*\.webm$/.test(n));
    check("the recording was saved to the captures folder", rec.length >= 1, after);
    saved.push(...rec);

    /* --- and it is viewable (the old local-file:// bug) ------------------ */
    const url = "local-file:///" + rec[rec.length - 1];
    const { net } = require("electron");
    const res = await net.fetch(url);
    check("the saved recording is served by local-file://", res.status === 200 && (res.headers.get("content-type") || "").includes("video"), { status: res.status, type: res.headers.get("content-type") });

    /* --- recording from the floating bar (the way it is really used) -----
       The collapsed bubble is a 56×248 window: no room for the in-app
       preview, so a floating camera window must appear instead and drag
       around the desktop. */
    const pipErr = [];
    const pip = new BrowserWindow({
      width: 56, height: 248, x: 40, y: 40, frame: false, transparent: true, resizable: false,
      alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: true, backgroundColor: "#00000000",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
      }
    });
    pip.webContents.on("console-message", (e, level, message) => { if (level >= 3) pipErr.push(String(message).slice(0, 200)); });
    await pip.loadFile(path.join(__dirname, "index.html"), { query: { pip: "1" } });
    const prun = js => pip.webContents.executeJavaScript(js);
    let pipReady = false;
    for (let i = 0; i < 40 && !pipReady; i++) {
      pipReady = await prun(`document.body.classList.contains('app-ready')`);
      if (!pipReady) await wait(250);
    }
    check("floating bubble window booted in bubble mode",
      pipReady === true && (await prun(`document.body.classList.contains('pip-mode') && document.body.classList.contains('pip-collapsed')`)) === true);

    await prun(SETUP);
    await prun(`document.getElementById('btnBubbleRec').click()`);
    for (let i = 0; i < 40; i++) {
      if (await prun(`!document.getElementById('recHud').hidden`)) break;
      await wait(250);
    }
    await wait(1800);

    const camWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && String(w.webContents.getURL()).includes("cam.html"));
    check("a floating camera bubble window opens while recording from the bubble", !!camWin,
      BrowserWindow.getAllWindows().map(w => w.webContents.getURL()).filter(u => u && !u.startsWith("file:///D:/Code%20folder/Messenger/index.html")));
    if (camWin) {
      let frameSrc = "";
      for (let i = 0; i < 30 && !frameSrc.startsWith("data:image"); i++) {
        await wait(300);
        frameSrc = await camWin.webContents.executeJavaScript(`(document.getElementById('frame') || {}).src || ''`);
      }
      check("the floating camera window shows the live camera", frameSrc.startsWith("data:image/jpeg"), frameSrc.slice(0, 24));
      const cs = camWin.getBounds();
      check("it is a small always-on-top bubble, not a normal window",
        cs.width <= 260 && cs.height <= 200 && camWin.isAlwaysOnTop() === true, cs);
    }

    const pipOn = await prun(SCAN);
    check("the camera is burned into a recording started from the bubble",
      pipOn.hud === true && !!pipOn.bubble && pipOn.bubble.count > 3000, pipOn.bubble && { count: pipOn.bubble.count, w: pipOn.bubble.w });
    if (camWin && pipOn.bubble) {
      const cb = camWin.getBounds();
      const { screen } = require("electron");
      const d = screen.getDisplayMatching(cb).bounds;
      const nx = (cb.x + cb.width / 2 - d.x) / d.width;
      const ny = (cb.y + cb.height / 2 - d.y) / d.height;
      check("the burned bubble sits exactly where the floating bubble is",
        Math.abs(pipOn.bubble.cx - nx * pipOn.frame.w) <= 6 && Math.abs(pipOn.bubble.cy - ny * pipOn.frame.h) <= 6,
        { bubble: { cx: pipOn.bubble.cx, cy: pipOn.bubble.cy }, expected: { cx: nx * pipOn.frame.w, cy: ny * pipOn.frame.h } });
    }

    /* Drag the floating camera bubble → the recorded one follows, and the new
       spot is remembered. */
    const before2 = pipOn.bubble;
    if (camWin) {
      await camWin.webContents.executeJavaScript(`(function(){
        const wrap = document.getElementById('wrap');
        const mk = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 3, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, screenX: x, screenY: y });
        wrap.dispatchEvent(mk('pointerdown', 30, 30));
        wrap.dispatchEvent(mk('pointermove', 30, 30));
        return true;
      })()`);
      await wait(150);
      const base = await camWin.webContents.executeJavaScript(`window.camApi.dragStart()`);
      await camWin.webContents.executeJavaScript(`(function(){
        const wrap = document.getElementById('wrap');
        const mk = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 3, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, screenX: x, screenY: y });
        wrap.dispatchEvent(mk('pointermove', 90, 60));
        wrap.dispatchEvent(mk('pointerup', 90, 60));
        return true;
      })()`);
      await wait(900);
      const moved2 = await prun(SCAN);
      const cb2 = camWin.getBounds();
      check("dragging the floating bubble moves it on the desktop",
        Math.abs(cb2.x - base.x) > 30 && Math.abs(cb2.y - base.y) > 10, { from: base, to: cb2 });
      const { screen: scr2 } = require("electron");
      const d2 = scr2.getDisplayMatching(cb2).bounds;
      const wantX = ((cb2.x + cb2.width / 2 - d2.x) / d2.width) * moved2.frame.w;
      const wantY = ((cb2.y + cb2.height / 2 - d2.y) / d2.height) * moved2.frame.h;
      check("the recording follows the floating bubble (viewers see the new spot)",
        !!moved2.bubble && Math.abs(moved2.bubble.cx - wantX) <= 6 && Math.abs(moved2.bubble.cy - wantY) <= 6 && Math.abs(moved2.bubble.cx - before2.cx) > 10,
        { before: before2.cx, after: moved2.bubble && moved2.bubble.cx, expected: wantX });
      const saved2 = await run(`(async()=>{ const c = await window.api.loadSettings(); return c.camPos; })()`);
      check("the new camera spot is saved for the next recording",
        !!saved2 && Math.abs(saved2.x - (cb2.x + cb2.width / 2) / 1920) < 0.2, saved2);

      /* S/M/L from the floating bubble resizes the burned one too. */
      await camWin.webContents.executeJavaScript(`document.getElementById('size').click()`);
      await wait(900);
      const grown = await prun(SCAN);
      const cb3 = camWin.getBounds();
      const frac = { 144: 0.16, 176: 0.22, 232: 0.3 }[cb3.width];
      check("resizing from the floating bubble resizes the burned camera",
        !!grown.bubble && !!frac && cb3.width !== cb2.width &&
        Math.abs(grown.bubble.w - Math.round(grown.frame.w * frac)) <= 6 &&
        grown.bubble.w !== moved2.bubble.w,
        { before: moved2.bubble.w, after: grown.bubble && grown.bubble.w, winBefore: cb2.width, winAfter: cb3.width, expected: frac && Math.round(grown.frame.w * frac) });
    }

    /* Camera off from the bubble: LED out, bubble says so, no camera in frames. */
    await prun(`document.getElementById('recHudCam').click()`);
    await wait(900);
    const pipOff = await prun(SCAN);
    const chip = camWin ? await camWin.webContents.executeJavaScript(`!document.getElementById('off').hidden`) : null;
    check("camera off from the bubble releases the device and clears the frames",
      pipOff.trackState === "ended" && pipOff.bubble === null && pipOff.hud === true, pipOff);
    check("the floating bubble says the camera is off instead of freezing", chip === true, chip);

    await prun(`document.getElementById('recHudStop').click()`);
    for (let i = 0; i < 40; i++) {
      if (await prun(`document.getElementById('recHud').hidden`)) break;
      await wait(250);
    }
    await wait(700);
    check("stopping the bubble recording closes the floating camera window",
      !BrowserWindow.getAllWindows().some(w => !w.isDestroyed() && String(w.webContents.getURL()).includes("cam.html")));
    const pipFiles = await prun(`(async()=>{ const l = await window.api.capture.list(); return l.map(x => x.name).filter(n => /^rec-.*\.webm$/.test(n)); })()`);
    saved.push(...pipFiles);
    check("a recording made from the bubble is saved", pipFiles.length >= 1, pipFiles);
    check("no renderer errors while recording from the bubble", pipErr.length === 0, pipErr);

    /* Expanded floating bar: same floating camera window, and the in-app
       preview stays out of the way. */
    await prun(`document.body.classList.remove('pip-collapsed')`);
    pip.setBounds({ x: 60, y: 60, width: 430, height: 700 });
    await wait(400);
    await prun(`document.getElementById('btnPipRec').click()`);
    for (let i = 0; i < 40; i++) {
      if (await prun(`!document.getElementById('recHud').hidden`)) break;
      await wait(250);
    }
    await wait(1500);
    const camWin2 = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && String(w.webContents.getURL()).includes("cam.html"));
    const expanded = await prun(`(function(){
      const p = document.getElementById('camPreview');
      return {
        hud: !document.getElementById('recHud').hidden,
        inAppPreview: p ? getComputedStyle(p).display : 'missing',
        hadAttribute: p ? p.hidden : true
      };
    })()`);
    check("recording from the expanded floating bar also gets the floating camera bubble",
      !!camWin2 && expanded.hud === true, { camWindow: !!camWin2, hud: expanded.hud });
    check("the in-app preview stays hidden while the floating bubble is used",
      expanded.inAppPreview === "none", expanded);
    await prun(`document.getElementById('recHudDiscard').click()`);
    for (let i = 0; i < 40; i++) {
      if (await prun(`document.getElementById('recHud').hidden`)) break;
      await wait(250);
    }
    await wait(500);
    try { pip.destroy(); } catch {}

    check("no renderer console errors", errors.length === 0, errors);
  } catch (e) {
    console.log("EXC " + ((e && e.stack) || e));
    failed = true;
  } finally {
    clearTimeout(guard);
    for (const n of saved) {
      try {
        const f = path.join(app.getPath("userData"), "captures", n);
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {}
    }
    await wait(200);
    app.exit(failed ? 1 : 0);
  }
});
