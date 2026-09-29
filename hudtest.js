/* Smoke test for the floating bubble's in-window UI (the reported bug: while
 * the bubble is collapsed, the recording HUD / toast were wider than the
 * window and got sliced off — only the middle button stayed visible).
 *
 * The collapsed bubble is a real 56×248 (vertical, and 42×186 at pipScale
 * 0.75) or 280×52 (horizontal) window, so all three shapes are exercised:
 *   1. the recording HUD fits fully inside, with every control reachable
 *   2. each HUD button keeps a real hit target + a title (labels are hidden)
 *   3. a toast fits fully inside as well and never covers the HUD
 *   4. the five pill buttons (chat / shot / rec / media / ⚙) stay inside and
 *      sit in ONE straight column — a wrapped second column lands outside the
 *      window, which is how the tools used to disappear entirely
 *
 * Run (close the app first — it holds the single-instance lock):
 *   npx electron hudtest.js
 * Set HUDTEST_USERDATA=<dir> to use a throwaway profile.
 */
const path = require("path");
const fs = require("fs");
const { app, BrowserWindow } = require("electron");

if (process.env.HUDTEST_USERDATA) {
  fs.mkdirSync(process.env.HUDTEST_USERDATA, { recursive: true });
  app.setPath("userData", process.env.HUDTEST_USERDATA);
}

require("./main.js"); // real IPC handlers (state, settings, captures)

const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
function check(name, cond, extra) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));
  if (!cond) failed = true;
}

const guard = setTimeout(() => {
  console.log("FAIL  timed out — if the app is already running, close it and re-run");
  app.exit(1);
}, 120000);

/* Measured inside the page. Animations are killed first: a hidden Electron
   window freezes CSS animations mid-scale, which would skew the rects. */
const PROBE = `
  (function(){
    const st = document.createElement('style');
    st.textContent = '*{animation:none!important;transition:none!important}';
    document.head.append(st);

    const hud = document.getElementById('recHud');
    const toastEl = document.getElementById('toast');
    document.getElementById('recHudTime').textContent = '01:23';
    hud.hidden = false;
    toastEl.textContent = 'Screenshot saved';
    toastEl.classList.add('show');

    const box = el => {
      const r = el.getBoundingClientRect();
      return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const inside = b => b.l >= 0 && b.t >= 0 && b.r <= window.innerWidth + 0.5 && b.b <= window.innerHeight + 0.5;
    const pill = document.querySelector('.pip-bubble-pill');
    const tools = [...document.querySelectorAll('.pip-tool')];
    // The open-chat circle is deliberately NOT a .pip-tool (its gestures must
    // bubble up to the pill so a drag still drags), but it is the 5th button.
    const chat = document.getElementById('btnBubbleChat');
    const parts = [...hud.children].filter(el => getComputedStyle(el).display !== 'none').map(el => ({
      id: el.id || el.className,
      box: box(el),
      inside: inside(box(el))
    }));
    const buttons = [...hud.querySelectorAll('.rec-hud-btn')].map(el => ({
      id: el.id,
      box: box(el),
      inside: inside(box(el)),
      title: el.getAttribute('title') || ''
    }));
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      pill: pill ? box(pill) : null,
      pillInside: pill ? inside(box(pill)) : null,
      tools: tools.map(el => ({ id: el.id, box: box(el), inside: inside(box(el)), title: el.getAttribute('title') || '' })),
      column: [chat, ...tools].filter(Boolean).map(el => ({
        id: el.id || el.className,
        box: box(el),
        inside: inside(box(el)),
        title: el.getAttribute('title') || ''
      })),
      hud: box(hud),
      hudInside: inside(box(hud)),
      hudScrollW: hud.scrollWidth,
      parts,
      buttons,
      toast: box(toastEl),
      toastInside: inside(box(toastEl)),
      toastShown: getComputedStyle(toastEl).display !== 'none',
      gap: Math.round(box(toastEl).t - box(hud).b)
    };
  })()
`;

async function probePipWindow(vertical, scale) {
  const s = scale || 1;
  const base = vertical ? { w: 56, h: 248 } : { w: 280, h: 52 };
  const size = { w: Math.round(base.w * s), h: Math.round(base.h * s) };
  const win = new BrowserWindow({
    width: size.w, height: size.h, frame: false, transparent: true,
    resizable: false, show: false, hasShadow: false, backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false
    }
  });
  const errors = [];
  win.webContents.on("console-message", (e, level, message) => { if (level >= 3) errors.push(String(message).slice(0, 200)); });
  await win.loadFile(path.join(__dirname, "index.html"), { query: { pip: "1" } });

  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    ready = await win.webContents.executeJavaScript(`document.body.classList.contains('app-ready')`);
    if (!ready) await wait(250);
  }
  const shape = vertical ? "pip-vertical" : "pip-horizontal";
  // initPipMode already added pip-vertical; the horizontal case has to drop it
  // or both orientation rules apply and the measurement is meaningless. The
  // renderer flips pip-xs on whenever pipScale < 1, so mirror that here.
  const classes = `'pip-mode','pip-collapsed','${shape}'` + (s < 1 ? ",'pip-xs'" : "");
  const res = await win.webContents.executeJavaScript(`
    document.body.classList.remove('pip-vertical','pip-horizontal');
    document.body.classList.add(${classes});
    ${PROBE}
  `);
  win.destroy();
  return Object.assign(res, {
    ready: ready, errors: errors, size: size,
    label: (vertical ? "vertical" : "horizontal") + " " + size.w + "×" + size.h +
      (s === 1 ? "" : " (pipScale " + s + ")")
  });
}

app.whenReady().then(async () => {
  try {
    await wait(1500);
    check("app booted", BrowserWindow.getAllWindows().some(w => !w.isDestroyed()));

    // 0.75 is a real user setting: it shrinks the window but not CSS pixels.
    for (const [vertical, scale] of [[true, 1], [false, 1], [true, 0.75]]) {
      const r = await probePipWindow(vertical, scale);
      const label = r.label;
      check(label + ": renderer ready", r.ready === true, { errors: r.errors });
      check(label + ": window size is the bubble size", r.vw === r.size.w && r.vh === r.size.h, { vw: r.vw, vh: r.vh });
      check(label + ": recording HUD fits inside the window", r.hudInside === true, r.hud);
      check(label + ": every HUD part fits (nothing sliced off)",
        r.parts.every(p => p.inside) && r.hudScrollW <= r.vw + 1,
        { parts: r.parts, scrollW: r.hudScrollW, vw: r.vw });
      check(label + ": every HUD button is clickable and labelled",
        r.buttons.length === 5 && r.buttons.every(b => b.inside && b.box.w >= 16 && b.box.h >= 16 && b.title),
        r.buttons);
      check(label + ": toast fits inside the window", r.toastShown === false || r.toastInside === true, r.toast);
      // Either the toast clears the HUD or it is suppressed: in the short
      // bookmark bubble there is no room for both and it must never be drawn
      // over the pause/discard/stop buttons.
      check(label + ": toast never covers the HUD", r.toastShown === false || r.gap >= -1,
        { shown: r.toastShown, gap: r.gap, hudBottom: r.hud.b, toastTop: r.toast.t });
      // The pill carries four tool buttons (shot / rec / media / ⚙ settings)
      // plus the open-chat circle, and is clipped if they are one pixel too
      // tall. In the vertical tab all FIVE are round buttons stacked in one
      // straight column — a wrapped second column lands outside the window,
      // which is how the tools used to disappear. Horizontal keeps its
      // icon + label + row of tools.
      const one = arr => new Set(arr).size === 1;
      const straight = vertical
        ? one(r.column.map(c => c.box.l)) && r.column.every((c, i, a) => i === 0 || c.box.t > a[i - 1].box.t)
        : one(r.tools.map(t => t.box.t)) && r.tools.every((t, i, a) => i === 0 || t.box.l > a[i - 1].box.l);
      check(label + ": the pill and its 4 tool buttons fit inside the window",
        r.pillInside === true && r.tools.length === 4 &&
        r.tools.every(t => t.inside && t.box.w >= 22 && t.box.h >= 22 && t.title),
        { pill: r.pill, tools: r.tools.map(t => t.id) });
      check(label + ": " + (vertical ? "5 round buttons stack in one straight column" : "the 4 tools sit in one straight row"),
        straight && (vertical
          ? r.column.length === 5 && r.column.every(c => c.inside && c.box.w >= 22 && c.box.h >= 22 && c.title)
          : true),
        vertical ? r.column : r.tools);
      check(label + ": no renderer errors", r.errors.length === 0, r.errors);
    }
  } catch (e) {
    console.log("EXC " + ((e && e.stack) || e));
    failed = true;
  } finally {
    clearTimeout(guard);
    await wait(200);
    app.exit(failed ? 1 : 0);
  }
});
