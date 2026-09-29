/* Smoke test for the PiP floating bubble:
 *   1. free drag — no edge snapping (park within 40px of an edge and stay)
 *   2. position persisted to pip.json
 *   3. expand → chat window CENTERED on screen (not offset)
 *   4. collapse → bubble returns to where it was parked
 *   5. resize / flip keep the bubble's centre fixed
 * Run: npx electron piptest.js
 */
const path = require("path");
const fs = require("fs");
const { app, ipcMain, BrowserWindow, screen, nativeImage } = require("electron");

// PIPTEST_USERDATA=<dir> runs against a throwaway profile (also avoids the
// single-instance lock of an app you already have open).
if (process.env.PIPTEST_USERDATA) {
  fs.mkdirSync(process.env.PIPTEST_USERDATA, { recursive: true });
  app.setPath("userData", process.env.PIPTEST_USERDATA);
}

// Boot the real app so all pip:* handlers are registered.
require("./main.js");

const USER_DATA = app.getPath("userData");
const pipFile = () => path.join(USER_DATA, "pip.json");
const settingsFile = () => path.join(USER_DATA, "settings.json");

const origPip = fs.existsSync(pipFile()) ? fs.readFileSync(pipFile(), "utf8") : null;
const origSettings = fs.existsSync(settingsFile()) ? fs.readFileSync(settingsFile(), "utf8") : null;

/* Identify the floating window by its URL — since v1.7 it opens EXPANDED
   (~50% of the screen), so "width < 500" is no longer a reliable marker. */
function findPip() {
  return BrowserWindow.getAllWindows().find(w => {
    if (w.isDestroyed()) return false;
    try { return w.webContents.getURL().includes("pip=1"); } catch { return false; }
  });
}
/* The chat window: a page that is neither the pip popup nor a capture overlay. */
function findMain() {
  return BrowserWindow.getAllWindows().find(w => {
    if (w.isDestroyed()) return false;
    try { const u = w.webContents.getURL(); return u.includes("index.html") && !u.includes("pip=1"); } catch { return false; }
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const near = (a, b, tol) => Math.abs(a - b) <= (tol || 2);

let failed = false;
function check(name, cond, extra) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? " :: " + JSON.stringify(extra) : ""));
  if (!cond) failed = true;
}

app.whenReady().then(async () => {
  try {
    await wait(1500); // main window boots

    ipcMain.emit("pip:open");
    await wait(2500);
    const pip = findPip();
    check("pip bubble window created", !!pip);
    if (!pip) return;

    /* Opening the floating CHAT has to give the chat. The window used to be
       created at pill size (56×248) while main already counted it as expanded,
       so the auto-expand never ran and the whole chat stayed squeezed into a
       bookmark-tab-sized window (the renderer even painted the pill inside it). */
    let openReady = false;
    for (let i = 0; i < 40 && !openReady; i++) {
      openReady = await pip.webContents.executeJavaScript("document.body.classList.contains('app-ready')").catch(() => false);
      if (!openReady) await wait(200);
    }
    await wait(400);
    const opened = await pip.webContents.executeJavaScript("document.body.classList.contains('pip-collapsed')");
    const openBounds = pip.getBounds();
    check("opening the floating chat really gives the expanded chat, not the pill",
      openReady === true && opened === false && openBounds.width > 400 && openBounds.height > 350,
      { collapsed: opened, bounds: openBounds });

    /* The bubble is a frameless TRANSPARENT always-on-top window. On Windows,
       applying content protection to a window like that paints it as an
       opaque BLACK rectangle instead of hiding it from the capture
       (electron#45990 / #46180 / #47834) — the user then sees a black pill
       with no buttons. It must therefore never be applied by simply OPENING
       the bubble; only while a recording actually hides the app, and it must
       be released again afterwards. */
    const idleProtected = pip.isContentProtected();
    const toggled = await pip.webContents.executeJavaScript(`(async()=>{
      const on = await window.api.capture.setContentProtection(true);
      const mid = { windows: on && on.windows };
      const off = await window.api.capture.setContentProtection(false);
      return { mid, off };
    })()`);
    await wait(200);
    check("the floating bubble is NOT content-protected while idle",
      idleProtected === false, { contentProtected: idleProtected });
    check("content protection is applied on demand and released again",
      toggled.mid.windows >= 1 && pip.isContentProtected() === false, toggled);

    // Opening auto-expands; the drag/click behaviour below belongs to the
    // collapsed bubble, so put it back into the bubble state first.
    ipcMain.emit("pip:collapse");
    await wait(800);
    const collapsed = await pip.webContents.executeJavaScript("document.body.classList.contains('pip-collapsed')");
    const cb0 = pip.getBounds();
    check("collapse keeps the tiny bubble window", collapsed === true && cb0.width < 500, { collapsed, bounds: cb0 });
    const pipScale = 1; // keep the drag math deterministic
    fs.writeFileSync(settingsFile(), JSON.stringify({ pipScale }), "utf8");
    ipcMain.emit("pip:resize");
    await wait(500);

    /* Gallery on the collapsed pill. The media panel is 320–360px wide, so
       opening it inside the 56×248 vertical bubble left a slab of panel
       background covering the whole window — a plain black box in dark mode —
       with the pill and the close button unreachable underneath. It has to
       grow the bubble instead. */
    const galBefore = pip.getBounds();
    await pip.webContents.executeJavaScript(`document.getElementById('btnBubbleMedia').click()`);
    let galBounds = galBefore;
    for (let i = 0; i < 25; i++) {
      galBounds = pip.getBounds();
      const stillCollapsed = await pip.webContents.executeJavaScript(`document.body.classList.contains('pip-collapsed')`);
      if (!stillCollapsed && galBounds.height > 300) break;
      await wait(150);
    }
    await wait(500);
    const gal = await pip.webContents.executeJavaScript(`(function(){
      // The panel slides in with an animation; freeze it or the rect is measured
      // mid-flight and looks like it hangs off the edge.
      const st = document.createElement('style');
      st.textContent = '*{animation:none!important;transition:none!important}';
      document.head.append(st);
      const p = document.getElementById('mediaPanel');
      const r = p ? p.getBoundingClientRect() : null;
      const b = document.getElementById('btnCloseMedia');
      const br = b ? b.getBoundingClientRect() : null;
      const g = document.getElementById('mediaGrid');
      return {
        collapsed: document.body.classList.contains('pip-collapsed'),
        panelShown: p ? p.hidden === false : null,
        panelInside: r ? (r.left >= -0.5 && r.right <= window.innerWidth + 0.5) : null,
        panelW: r ? Math.round(r.width) : null,
        closeInside: br ? (br.left >= -0.5 && br.right <= window.innerWidth + 0.5) : null,
        gridW: g ? Math.round(g.getBoundingClientRect().width) : null,
        vw: window.innerWidth, vh: window.innerHeight
      };
    })()`);
    check("gallery grows the bubble instead of covering it with a black slab",
      galBefore.width < 120 && galBounds.height > 300 && gal.collapsed === false &&
      gal.panelShown === true && gal.panelInside === true && gal.closeInside === true && gal.gridW > 100,
      Object.assign({ before: galBefore, after: galBounds }, gal));

    // Back to the collapsed bubble for the drag checks below.
    await pip.webContents.executeJavaScript(`document.getElementById('btnCloseMedia').click()`);
    ipcMain.emit("pip:collapse");
    await wait(700);

    /* Screenshot vs the pill. The bubble is an always-on-top overlay window of
       this same app, so dragging a selection across its parking spot baked the
       pill into the picture. It has to be hidden for the grab and restored as
       soon as the region picker closes — however the user leaves it. */
    const shotOverlay = () => BrowserWindow.getAllWindows().find(w => {
      if (w.isDestroyed()) return false;
      try { return w.webContents.getURL().includes("shot-overlay.html"); } catch { return false; }
    });
    pip.setPosition(40, 60);
    await wait(300);
    const shotCall = pip.webContents.executeJavaScript(`window.api.capture.startShot()`);
    // Grabbing the desktop takes a moment (and can be slower on the very first
    // call), so wait for the picker to actually exist before measuring.
    let overlayWin = null;
    for (let i = 0; i < 40 && !overlayWin; i++) {
      await wait(150);
      overlayWin = shotOverlay();
    }
    const shotPos = pip.getPosition();
    const shotBounds = pip.getBounds();
    const onSomeDisplay = screen.getAllDisplays().some(dd =>
      shotPos[0] + shotBounds.width > dd.bounds.x && shotPos[0] < dd.bounds.x + dd.bounds.width &&
      shotPos[1] + shotBounds.height > dd.bounds.y && shotPos[1] < dd.bounds.y + dd.bounds.height);
    const shotRes = await shotCall;
    check("taking a screenshot parks the floating bubble off every screen",
      !!shotRes && shotRes.ok === true && !!overlayWin && onSomeDisplay === false,
      { result: shotRes, overlay: !!overlayWin, pos: shotPos, visible: pip.isVisible() });
    ipcMain.emit("shot:cancel");
    let overlayGone = false;
    for (let i = 0; i < 20 && !overlayGone; i++) {
      await wait(150);
      overlayGone = !shotOverlay();
    }
    // The restore must also leave the renderer's viewport in sync: a hide +
    // show cycle used here left Chromium's resize pipeline behind, so the next
    // expand laid the page out for the OLD viewport and the panels came out
    // clipped inside a big window.
    const vp = await pip.webContents.executeJavaScript("({ iw: window.innerWidth, ih: window.innerHeight })");
    const restoredBounds = pip.getBounds();
    check("the bubble comes back where it was, with a matching viewport",
      overlayGone === true && pip.isVisible() === true && pip.getPosition()[0] === 40 &&
      vp.iw === restoredBounds.width && vp.ih === restoredBounds.height,
      { visible: pip.isVisible(), pos: pip.getPosition(), overlayGone, vp, bounds: restoredBounds });

    /* Pixel proof that the pill is really gone from the picture. A solid
       MAGENTA backdrop window is parked behind the bubble; a real screenshot of
       exactly that rect is then taken through the app. If the pill leaked into
       the grab it would cover ~40% of the crop with accent blue — so "the crop
       is still magenta" is the check. */
    const shotDir = path.join(USER_DATA, "captures");
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const bx = Math.min(Math.max(d.workArea.x + 40, d.workArea.x + 4), d.workArea.x + d.workArea.width - 60);
    const by = Math.min(Math.max(d.workArea.y + 60, d.workArea.y + 4), d.workArea.y + d.workArea.height - 260);
    const backdrop = new BrowserWindow({
      x: d.workArea.x, y: d.workArea.y, width: d.workArea.width, height: d.workArea.height,
      frame: false, hasShadow: false, show: false, backgroundColor: "#ff00ff"
    });
    await backdrop.loadURL("data:text/html,<body style='margin:0;background:%23ff00ff'></body>");
    backdrop.showInactive();
    pip.setPosition(bx, by);
    await wait(600);
    const shotsBefore = fs.existsSync(shotDir) ? fs.readdirSync(shotDir).filter(f => f.endsWith(".png")) : [];
    const shotCall2 = pip.webContents.executeJavaScript(`window.api.capture.startShot()`);
    let overlay2 = null;
    for (let i = 0; i < 40 && !overlay2; i++) { await wait(150); overlay2 = shotOverlay(); }
    // Windows clips a frameless window to the work area, so the picker can be
    // shorter than the display; all that matters is that its origin matches the
    // display's (selection pixels map 1:1 onto the grabbed image).
    const ovB = overlay2 ? overlay2.getBounds() : null;
    const overlayOk = !!ovB && ovB.x === d.bounds.x && ovB.y === d.bounds.y &&
      (bx - d.bounds.x + 56) <= ovB.width && (by - d.bounds.y + 248) <= ovB.height;
    const shotRes2 = await shotCall2;
    if (shotRes2 && shotRes2.ok === true && overlayOk) {
      ipcMain.emit("shot:done", {}, { x: bx - d.bounds.x, y: by - d.bounds.y, w: 56, h: 248 });
      let file = null;
      for (let i = 0; i < 30 && !file; i++) {
        await wait(150);
        const names = fs.existsSync(shotDir) ? fs.readdirSync(shotDir).filter(f => f.endsWith(".png") && !shotsBefore.includes(f)) : [];
        if (names.length) file = path.join(shotDir, names[0]);
      }
      let magenta = 0, total = 0;
      if (file) {
        const img = nativeImage.createFromPath(file);
        const sz = img.getSize();
        const bmp = img.toBitmap(); // BGRA
        total = sz.width * sz.height;
        for (let i = 0; i < bmp.length; i += 4) {
          if (bmp[i + 2] > 190 && bmp[i + 1] < 70 && bmp[i] > 190) magenta++;
        }
        fs.unlinkSync(file); // test artifact — keep the real captures/ folder clean
      }
      check("the saved screenshot holds no trace of the floating bubble",
        !!file && total > 0 && magenta / total > 0.95,
        { file: file && path.basename(file), magenta: magenta, total: total, ratio: total ? +(magenta / total).toFixed(3) : null });
    } else {
      console.log("SKIP  pixel proof of the bubble being excluded (no overlay / different display)" +
        " :: " + JSON.stringify({ res: shotRes2, overlayBounds: ovB, displayBounds: d.bounds }));
    }
    backdrop.destroy();

    // --- JS-driven drag: pointer events in the bubble renderer must move
    // the actual window (the old -webkit-app-region drag didn't work).
    pip.setPosition(60, 80);
    await wait(300);
    await pip.webContents.executeJavaScript(`(function(){
      const bubble = document.getElementById('pipBubble');
      if (!bubble) return false;
      bubble.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10, screenX: 300, screenY: 200, pointerId: 1 }));
      return new Promise(res => setTimeout(() => {
        bubble.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 110, clientY: 110, screenX: 400, screenY: 300, pointerId: 1 }));
        bubble.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 110, clientY: 110, screenX: 400, screenY: 300, pointerId: 1 }));
        res(true);
      }, 250));
    })()`);
    await wait(400);
    const [dpx, dpy] = pip.getPosition();
    check("renderer drag moves the bubble freely", dpx === 160 && dpy === 180, { dpx, dpy });

    // --- Dragging must NEVER open the chat. Chrome fires a `click` when the
    // mouse goes down and up on the same element, i.e. right after a drag, and
    // that click used to expand the bubble.
    pip.setPosition(60, 80);
    await wait(300);
    await pip.webContents.executeJavaScript(`(function(){
      const bubble = document.getElementById('pipBubble');
      bubble.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10, screenX: 300, screenY: 200, pointerId: 9 }));
      return new Promise(res => setTimeout(() => {
        [ [340, 240], [380, 280], [420, 320] ].forEach(([sx, sy]) =>
          bubble.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 50, clientY: 50, screenX: sx, screenY: sy, pointerId: 9 })));
        bubble.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 50, clientY: 50, screenX: 420, screenY: 320, pointerId: 9 }));
        // …and the click Chrome appends at the end of the same gesture.
        bubble.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50, screenX: 420, screenY: 320 }));
        res(true);
      }, 250));
    })()`);
    await wait(600);
    const afterDrag = pip.getBounds();
    const dragCollapsed = await pip.webContents.executeJavaScript("document.body.classList.contains('pip-collapsed')");
    check("drag moves the bubble and stays collapsed",
      afterDrag.width < 500 && dragCollapsed === true && afterDrag.x > 60,
      { afterDrag, dragCollapsed });
    const [ddx, ddy] = pip.getPosition();
    check("drag lands where the pointer ended (60,80 → +120,+120)", ddx === 180 && ddy === 200, { ddx, ddy });

    // Free drag: park within 40px of an edge — old code snapped it to (8,8).
    pip.setPosition(25, 30);
    await wait(700); // let any (removed) snap / debounced save settle
    const [px, py] = pip.getPosition();
    check("NO edge snap — bubble stays where parked", px === 25 && py === 30, { px, py });

    // Position persisted
    const saved = JSON.parse(fs.readFileSync(pipFile(), "utf8"));
    check("bubble position persisted to pip.json", saved.x === 25 && saved.y === 30, saved);

    // Click the pill (press + release, no drag) → chat window centered on
    // screen (never "lệch") — exercised through the real renderer gesture.
    await pip.webContents.executeJavaScript(`(function(){
      const bubble = document.getElementById('pipBubble');
      bubble.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 20, clientY: 20, screenX: 350, screenY: 230, pointerId: 2 }));
      return new Promise(res => setTimeout(() => {
        bubble.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 20, clientY: 20, screenX: 350, screenY: 230, pointerId: 2 }));
        bubble.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 }));
        res(true);
      }, 250));
    })()`);
    await wait(500);
    const b = pip.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    const ex = wa.x + Math.round((wa.width - b.width) / 2);
    const ey = wa.y + Math.round((wa.height - b.height) / 2);
    const expW = Math.min(Math.max(Math.round(wa.width * 0.5), 360), Math.max(360, wa.width - 24));
    const expH = Math.min(Math.max(Math.round(wa.height * 0.5), 440), Math.max(440, wa.height - 24));
    const expVp = await pip.webContents.executeJavaScript("({ iw: window.innerWidth, ih: window.innerHeight })");
    check("expanded chat is ~50% of screen and CENTERED", near(b.width, expW) && near(b.height, expH) && near(b.x, ex) && near(b.y, ey), { b, expW, expH, ex, ey });
    check("the expanded popup lays out for its real window size",
      Math.abs(expVp.iw - b.width) <= 20 && Math.abs(expVp.ih - b.height) <= 20,
      { vp: expVp, bounds: b });

    // Corner grip → resize the popup freely (expand then compress)
    const gb = pip.getBounds();
    // The grip resizes relative to the renderer's own viewport, so a stale
    // innerWidth here (mid-animation) would produce nonsense bounds.
    const gripBase = await pip.webContents.executeJavaScript("({ w: window.innerWidth, h: window.innerHeight })");
    await pip.webContents.executeJavaScript(`(function(){
      const g = document.getElementById('pipResize');
      if (!g) return false;
      g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 4, clientY: 4, screenX: 500, screenY: 500, pointerId: 3 }));
      return new Promise(res => setTimeout(() => {
        g.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 30, clientY: 30, screenX: 620, screenY: 640, pointerId: 3 }));
        g.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 30, clientY: 30, screenX: 620, screenY: 640, pointerId: 3 }));
        res(true);
      }, 200));
    })()`);
    await wait(300);
    const ga = pip.getBounds();
    check("corner grip expands the popup", ga.width > gb.width && ga.height > gb.height, { gb, ga, gripBase });

    await pip.webContents.executeJavaScript(`(function(){
      const g = document.getElementById('pipResize');
      g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 4, clientY: 4, screenX: 620, screenY: 640, pointerId: 4 }));
      return new Promise(res => setTimeout(() => {
        g.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 4, clientY: 4, screenX: 400, screenY: 480, pointerId: 4 }));
        g.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 4, clientY: 4, screenX: 400, screenY: 480, pointerId: 4 }));
        res(true);
      }, 200));
    })()`);
    await wait(300);
    const gc = pip.getBounds();
    check("corner grip compresses the popup", gc.width < ga.width && gc.height < ga.height, { ga, gc });

    /* Maximize / restore. A frameless transparent window has no OS maximize
       box, so the header button (or a double-click on the header) drives it:
       it fills the work area like a real maximized app window and comes back
       to the size it had. */
    const preMax = pip.getBounds();
    ipcMain.emit("pip:maximize");
    await wait(600);
    const maxB = pip.getBounds();
    const waM = screen.getDisplayMatching(maxB).workArea;
    const maxVp = await pip.webContents.executeJavaScript("({ iw: window.innerWidth, ih: window.innerHeight })");
    check("maximize fills the whole work area like a real app window",
      near(maxB.x, waM.x, 6) && near(maxB.y, waM.y, 6) && near(maxB.width, waM.width, 6) && near(maxB.height, waM.height, 6),
      { maxB, waM });
    check("the maximized popup lays out for its real window size",
      Math.abs(maxVp.iw - maxB.width) <= 20 && Math.abs(maxVp.ih - maxB.height) <= 20, { maxVp, maxB });
    ipcMain.emit("pip:maximize");
    await wait(600);
    const restB = pip.getBounds();
    check("restore comes back to the pre-maximize size",
      near(restB.width, preMax.width, 6) && near(restB.height, preMax.height, 6), { preMax, restB });

    /* Collapse → bubble returns to the parked spot — and it has to be there in
       the SAME tick. An animated shrink walked the window through every
       intermediate size, which the user saw as "a small window, then another
       click before the floating bar appears". */
    const preCollapse = pip.getBounds();
    ipcMain.emit("pip:collapse");
    const immediate = pip.getBounds();      // no await: same turn as the request
    await wait(500);
    const settled = pip.getBounds();
    const [cxp, cyp] = pip.getPosition();
    check("collapse lands on the bar in the same tick, with no intermediate size",
      immediate.width < 200 && immediate.height < 300 &&
      Math.abs(immediate.width - settled.width) <= 1 && Math.abs(immediate.height - settled.height) <= 1 &&
      preCollapse.width > 300,
      { preCollapse, immediate, settled });
    check("collapse returns bubble to parked spot", cxp === 25 && cyp === 30, { cxp, cyp });

    // Resize (S/M/L slider) keeps centre fixed
    const before = pip.getBounds();
    const cb = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
    fs.writeFileSync(settingsFile(), JSON.stringify({ pipScale: 1.3 }), "utf8");
    ipcMain.emit("pip:resize");
    await wait(400);
    const after = pip.getBounds();
    const ca = { x: after.x + after.width / 2, y: after.y + after.height / 2 };
    check("resize keeps bubble centre fixed", near(cb.x, ca.x) && near(cb.y, ca.y), { cb, ca });

    // Flip (orientation) keeps centre fixed
    const b2 = pip.getBounds();
    const cb2 = { x: b2.x + b2.width / 2, y: b2.y + b2.height / 2 };
    ipcMain.emit("pip:flip");
    await wait(400);
    const a2 = pip.getBounds();
    const ca2 = { x: a2.x + a2.width / 2, y: a2.y + a2.height / 2 };
    check("flip keeps bubble centre fixed", near(cb2.x, ca2.x) && near(cb2.y, ca2.y), { cb2, ca2 });

    /* The bar can start by itself, docked to one side. This is what launch
       ("Show the bar when the app starts") and minimizing the app use: the bar
       must be there immediately — collapsed and flush against an edge — with no
       expand-then-collapse step in between. */
    ipcMain.emit("pip:close");
    for (let i = 0; i < 20 && findPip(); i++) await wait(150);
    check("the floating window can be closed again", !findPip());
    fs.writeFileSync(settingsFile(), JSON.stringify({ pipScale: 1, pipDock: "right" }), "utf8");
    ipcMain.emit("pip:openbar", {}, "right");
    let bar = null;
    for (let i = 0; i < 25 && !bar; i++) { await wait(150); bar = findPip(); }
    check("the floating bar opens on demand (launch / minimize path)", !!bar);
    if (bar) {
      // The window exists before its page has run — wait for the renderer, or
      // the class check below measures an empty document.
      let barReady = false;
      for (let i = 0; i < 40 && !barReady; i++) {
        barReady = await bar.webContents.executeJavaScript("document.body.classList.contains('app-ready')").catch(() => false);
        if (!barReady) await wait(200);
      }
      await wait(300);
      const bb = bar.getBounds();
      const bw = screen.getDisplayMatching(bb).workArea;
      const barCollapsed = await bar.webContents.executeJavaScript("document.body.classList.contains('pip-collapsed')");
      check("the bar starts collapsed and docked flush to the right edge",
        barReady === true && barCollapsed === true && bb.width <= 300 && bb.height <= 260 &&
        Math.abs(bb.x + bb.width - (bw.x + bw.width - 6)) <= 8 &&
        Math.abs(bb.y - (bw.y + Math.round((bw.height - bb.height) / 2))) <= 12,
        { barReady, barCollapsed, bb, bw });
    }

    /* Minimizing the app must bring the floating bar up immediately — the old
       behaviour showed nothing (or a shrunken window) until the user clicked
       something else. */
    const mainWin = findMain();
    ipcMain.emit("pip:close");
    for (let i = 0; i < 20 && findPip(); i++) await wait(150);
    if (mainWin) {
      mainWin.minimize();
      let minBar = null;
      for (let i = 0; i < 30 && !minBar; i++) { await wait(150); minBar = findPip(); }
      let minCollapsed = null, minReady = false;
      if (minBar) {
        for (let i = 0; i < 40 && !minReady; i++) {
          minReady = await minBar.webContents.executeJavaScript("document.body.classList.contains('app-ready')").catch(() => false);
          if (!minReady) await wait(200);
        }
        minCollapsed = await minBar.webContents.executeJavaScript("document.body.classList.contains('pip-collapsed')");
      }
      check("minimizing the app brings the floating bar up right away",
        !!minBar && minCollapsed === true, { minimized: mainWin.isMinimized(), bar: !!minBar, collapsed: minCollapsed });
      if (mainWin.isMinimized()) mainWin.restore();
    } else {
      console.log("SKIP  minimizing shows the bar (no main window found)");
    }

    /* Regression: closing the chat window while the floating bar keeps the app
       alive used to leave a DESTROYED BrowserWindow in main.js' `win`
       variable. Launching the app again (shortcut / second start) then ran
       `win.isMinimized()` on that dead object, and Electron answered with its
       modal "A JavaScript error occurred in the main process — TypeError:
       Object has been destroyed" dialog. Relaunching must now just rebuild the
       chat window, silently. */
    const doomed = findMain();
    ipcMain.emit("pip:openbar", {}, "right"); // the bar is what keeps the app alive
    let keepAliveBar = null;
    for (let i = 0; i < 25 && !keepAliveBar; i++) { await wait(150); keepAliveBar = findPip(); }
    if (doomed && keepAliveBar) {
      let crash = null;
      doomed.close();
      for (let i = 0; i < 20 && !doomed.isDestroyed(); i++) await wait(100);
      try { app.emit("second-instance", {}, [], process.cwd(), {}); }
      catch (e) { crash = e; }
      let revived = null;
      for (let i = 0; i < 30 && !revived; i++) { await wait(150); revived = findMain(); }
      check("relaunching after the chat window was closed rebuilds it, with no destroyed-object error",
        !crash && !!revived && revived !== doomed,
        { crash: crash ? String((crash && crash.message) || crash) : null, revived: !!revived });
      if (revived) {
        let revivedReady = false;
        for (let i = 0; i < 40 && !revivedReady; i++) {
          revivedReady = await revived.webContents.executeJavaScript("document.body.classList.contains('app-ready')").catch(() => false);
          if (!revivedReady) await wait(200);
        }
        check("the rebuilt chat window is fully loaded and usable", revivedReady === true, { ready: revivedReady });
      }
      // Leave the app in the state the next run expects: no floating bar left.
      ipcMain.emit("pip:close");
      for (let i = 0; i < 20 && findPip(); i++) await wait(150);
    } else {
      console.log("SKIP  relaunch after closing the chat window (needs the main window + the floating bar)");
    }
  } catch (e) {
    console.log("EXC " + ((e && e.stack) || e));
    failed = true;
  } finally {
    // Never leave the fullscreen region picker behind — it would swallow the
    // next run's clicks. Destroying it also restores the hidden bubble.
    try {
      BrowserWindow.getAllWindows().forEach(w => {
        if (w.isDestroyed()) return;
        try {
          const url = w.webContents.getURL();
          if (url.includes("shot-overlay.html") || url.startsWith("data:text/html")) w.destroy();
        } catch {}
      });
    } catch {}
    // Restore configs the test touched.
    try {
      if (origPip !== null) fs.writeFileSync(pipFile(), origPip, "utf8");
      else if (fs.existsSync(pipFile())) fs.unlinkSync(pipFile());
      if (origSettings !== null) fs.writeFileSync(settingsFile(), origSettings, "utf8");
      else if (fs.existsSync(settingsFile())) fs.unlinkSync(settingsFile());
    } catch {}
    console.log("RESULT " + (failed ? "FAIL" : "PASS"));
    app.exit(failed ? 1 : 0);
  }
});
