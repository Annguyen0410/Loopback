/* Audit — "is the whole app healthy and ready to use?"
 *
 * The other suites each prove one feature works. This one sweeps the whole
 * build for the things that make a shipped app feel broken:
 *   1. every window opens AND closes — side panels, floating bar (every state),
 *      monitor, quick note, capture overlay — with nothing left on screen
 *   2. no renderer console error anywhere during that tour
 *   3. every `api.*` path the renderer code uses really exists on the bridge
 *      (a typo there is a button that silently does nothing)
 *   4. every DOM id the renderer looks up exists in the document
 *      (a renamed id after a refactor is a dead control)
 *   5. the theme picker and styles.css agree, and all 16 themes stay readable
 *      (WCAG AA) in light AND dark mode
 *   6. nothing was written to error.log (the main-process safety net)
 *
 * Run (close the app first — it owns the single-instance lock and the global
 * hotkey):
 *   npx electron audittest.js
 * AUDITTEST_USERDATA=<dir> runs it against a throwaway profile.
 */
const path = require("path");
const fs = require("fs");
const { app, ipcMain, BrowserWindow, screen } = require("electron");

if (process.env.AUDITTEST_USERDATA) {
  fs.mkdirSync(process.env.AUDITTEST_USERDATA, { recursive: true });
  app.setPath("userData", process.env.AUDITTEST_USERDATA);
}
const USER_DATA = app.getPath("userData");
const ERROR_LOG = path.join(USER_DATA, "error.log");
try { if (fs.existsSync(ERROR_LOG)) fs.unlinkSync(ERROR_LOG); } catch {}

/* Collect renderer errors from EVERY window — including the ones created while
   the app boots, before this test gets a chance to look. */
const rendererErrors = [];
app.on("browser-window-created", (e, w) => {
  try {
    // Newer Electron hands the whole event over as one object; older builds pass
    // (event, level, message). Accept both so this keeps working either way.
    w.webContents.on("console-message", (ev, level, message) => {
      const lv = ev && typeof ev.level !== "undefined" ? ev.level : level;
      const msg = ev && typeof ev.message === "string" ? ev.message : message;
      const isError = lv === "error" || (typeof lv === "number" && lv >= 3);
      if (!isError) return;
      let page = "?";
      try { page = w.webContents.getURL().split("/").pop() || "?"; } catch {}
      rendererErrors.push({ page: page.slice(0, 40), message: String(msg).slice(0, 220) });
    });
  } catch {}
});

// Boot the real app so every window/IPC handler exists.
require("./main.js");

/* ---------------------------------------------------------------- static part
   What the renderer *thinks* exists (read from source) is compared against what
   actually exists (the live bridge + the live DOM). */
const SRC = path.join(__dirname, "src", "renderer");
const RENDERER_SRC = fs.readdirSync(SRC).filter(f => f.endsWith(".js"))
  .map(f => fs.readFileSync(path.join(SRC, f), "utf8")).join("\n");

const API_PATHS = [...new Set(RENDERER_SRC.match(/\bapi(\.[A-Za-z_$][A-Za-z0-9_$]*)+/g) || [])].sort();
/* `$("id")` is the app's own helper and takes a plain id (src/renderer/dom.js). */
const DOM_IDS = [...new Set([
  ...[...RENDERER_SRC.matchAll(/\$\("#?([A-Za-z0-9_-]+)"\)/g)],
  ...[...RENDERER_SRC.matchAll(/getElementById\("([A-Za-z0-9_-]+)"\)/g)]
].map(m => m[1]))].sort();

const INDEX_HTML = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const THEME_DOTS = [...new Set([...INDEX_HTML.matchAll(/class="theme-dot" data-theme="([a-z0-9-]+)"/g)].map(m => m[1]))].sort();
const THEME_CLASSES = [...new Set([...fs.readFileSync(path.join(__dirname, "styles.css"), "utf8").matchAll(/body\.theme-([a-z0-9-]+)/g)].map(m => m[1]))].sort();

const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
function check(name, cond, extra) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? " :: " + JSON.stringify(extra) : ""));
  if (!cond) failed = true;
}
function byUrl(part) {
  return BrowserWindow.getAllWindows().find(w => {
    if (w.isDestroyed()) return false;
    try { return w.webContents.getURL().includes(part); } catch { return false; }
  });
}
const findMain = () => BrowserWindow.getAllWindows().find(w => {
  if (w.isDestroyed()) return false;
  try { const u = w.webContents.getURL(); return u.includes("index.html") && !u.includes("pip=1"); } catch { return false; }
});
const windowUrls = () => BrowserWindow.getAllWindows().map(w => {
  if (w.isDestroyed()) return "destroyed";
  try { return w.webContents.getURL().split("/").slice(-1)[0] || "(empty)"; } catch { return "?"; }
});
const findPip = () => byUrl("pip=1");
const findQuick = () => byUrl("quick.html");
const findMonitor = () => byUrl("monitor.html");
const findShot = () => byUrl("shot-overlay.html");
async function waitFor(fn, tries, ms) {
  let v = null;
  for (let i = 0; i < tries && !v; i++) { await wait(ms || 150); v = fn(); }
  return v || null;
}

app.whenReady().then(async () => {
  try {
    const main = await waitFor(findMain, 40, 250);
    check("the app boots with a real chat window", !!main, { windows: windowUrls() });
    if (!main) throw new Error("no main window");

    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      ready = await main.webContents.executeJavaScript("document.body.classList.contains('app-ready')").catch(() => false);
      if (!ready) await wait(200);
    }
    check("the chat window finishes loading its UI", ready === true);

    /* ---- 1. side panels open and close through their real buttons ------- */
    const panels = await main.webContents.executeJavaScript(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const click = id => { const el = document.getElementById(id); if (el) { el.click(); return true; } return false; };
      const shown = id => { const el = document.getElementById(id); return el ? !el.hidden : null; };
      const out = {};
      out.settingsBtn = click("btnSettings"); await wait(150); out.settingsShown = shown("settingsPanel");
      click("btnCloseSettings"); await wait(150); out.settingsClosed = shown("settingsPanel") === false;
      out.mediaBtn = click("btnMedia"); await wait(300); out.mediaShown = shown("mediaPanel");
      click("btnCloseMedia"); await wait(300); out.mediaClosed = shown("mediaPanel") === false;
      out.miniBtn = click("btnPipSettings"); await wait(250); out.miniShown = shown("miniPanel");
      click("btnCloseMini"); await wait(250); out.miniClosed = shown("miniPanel") === false;
      return out;
    })()`).catch(e => ({ error: String(e) }));
    check("the Settings panel opens and closes", panels.settingsBtn && panels.settingsShown === true && panels.settingsClosed === true, panels);
    check("the Media library opens and closes", panels.mediaBtn && panels.mediaShown === true && panels.mediaClosed === true, panels);
    check("the recording settings panel opens and closes", panels.miniBtn && panels.miniShown === true && panels.miniClosed === true, panels);

    /* ---- 2. no dead API: every api.* path the renderer uses exists ------ */
    const missingApi = await main.webContents.executeJavaScript(
      `(() => {
        const paths = ${JSON.stringify(API_PATHS)};
        const alive = p => {
          let o = window;
          const parts = p.split(".");
          for (let i = 0; i < parts.length; i++) {
            if (o === null || o === undefined) return false;
            o = o[parts[i]];
          }
          return typeof o === "function" || (o !== null && typeof o === "object");
        };
        return paths.filter(p => !alive(p));
      })()`
    ).catch(e => [String(e)]);
    check("every api.* path the renderer calls exists on the live bridge (" + API_PATHS.length + " checked)",
      missingApi.length === 0, { missing: missingApi });

    /* ---- 3. no dead selector: every id the renderer looks up is there ---- */
    const missingIds = await main.webContents.executeJavaScript(
      `(() => {
        const ids = ${JSON.stringify(DOM_IDS)};
        return ids.filter(id => !document.getElementById(id));
      })()`
    ).catch(e => [String(e)]);
    check("every DOM id the renderer looks up exists in the document (" + DOM_IDS.length + " checked)",
      missingIds.length === 0, { missing: missingIds });

    /* ---- 4. the theme picker and the stylesheet agree ------------------- */
    const pickerThemes = THEME_DOTS.filter(t => t !== "blue").sort();
    const sameThemes = JSON.stringify(pickerThemes) === JSON.stringify(THEME_CLASSES);
    check("all " + (THEME_DOTS.length) + " picker themes have styles (and nothing is orphaned)",
      sameThemes, { onlyPicker: pickerThemes.filter(t => !THEME_CLASSES.includes(t)), onlyCss: THEME_CLASSES.filter(t => !pickerThemes.includes(t)) });

    /* ---- 5. every theme stays readable, light AND dark ------------------ */
    const readability = await main.webContents.executeJavaScript(`(() => {
      const themes = ["", ...${JSON.stringify(THEME_CLASSES)}];
      const probe = document.createElement("div");
      probe.style.position = "fixed";
      probe.style.left = "-9999px";
      document.body.appendChild(probe);
      /* Paint the value as a background and read it back: that hands us the
         RESOLVED colour (a color-mix()/hex/var lands here as rgb/color(srgb)). */
      const resolve = css => { probe.style.backgroundColor = ""; probe.style.backgroundColor = css; return getComputedStyle(probe).backgroundColor; };
      const rgbOf = s => {
        const str = String(s || "");
        const v = str.split(/[^0-9.-]+/).filter(Boolean).map(Number);
        /* color(srgb 0..1) — scale it up before measuring. */
        if (str.indexOf("color(") === 0) return v.slice(0, 3).map(x => x * 255);
        return v.slice(0, 3);
      };
      const lum = s => {
        const c = rgbOf(s);
        const f = x => { x = x / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
      };
      const contrast = (a, b) => {
        const l1 = lum(a), l2 = lum(b);
        return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
      };
      /* Read a gradient back as its individual stop colours — this is how the
         real message bubble and the floating bar are measured instead of a
         guess at what the CSS probably renders. */
      const gradStops = css => {
        probe.style.backgroundImage = "";
        probe.style.backgroundImage = css;
        const bg = getComputedStyle(probe).backgroundImage || "";
        return bg.match(/(?:rgba?|color)\([^)]*\)/g) || [];
      };
      const keep = document.body.className.split(/\\s+/).filter(c => c && c !== "dark" && c.indexOf("theme-") !== 0);
      const rows = [];
      for (const theme of themes) {
        for (const dark of [false, true]) {
          document.body.className = [...keep, ...(dark ? ["dark"] : []), ...(theme ? ["theme-" + theme] : [])].join(" ");
          document.body.offsetHeight; // force the new theme to resolve
          const cs = getComputedStyle(document.body);
          const v = n => cs.getPropertyValue(n).trim();
          const bg = resolve(v("--bg-primary"));
          const onAccent = resolve(v("--on-accent"));
          const solid = resolve(v("--accent-solid")) || resolve(v("--accent"));
          const bubble = gradStops(v("--bubble-me"));
          /* The floating bar is real markup in the page, so measure the element
             itself: its text colour and both ends of its gradient. */
          const pill = document.querySelector(".pip-bubble-pill");
          const pillStops = pill ? gradStops(getComputedStyle(pill).backgroundImage) : [];
          const pillText = pill ? getComputedStyle(pill).color : null;
          const row = {
            theme: theme || "blue", dark: dark,
            accentKey: v("--accent-key"), accent: v("--accent") || null, onAccent: v("--on-accent"),
            onBg: contrast(resolve(v("--text-primary")), bg),
            onBgSub: contrast(resolve(v("--text-secondary")), bg),
            onSolid: Math.min(contrast(onAccent, solid), 99),
            pill: pillStops.length && pillText ? Math.min.apply(null, pillStops.map(c => contrast(pillText, c))) : 0,
            bubble: bubble.length ? Math.min.apply(null, bubble.map(c => contrast("rgb(255,255,255)", c))) : 0
          };
          rows.push(row);
        }
      }
      document.body.className = keep.join(" ");
      probe.remove();
      return rows;
    })()`).catch(e => ({ error: String(e) }));

    let rows = [];
    if (Array.isArray(readability)) {
      rows = readability;
      const worstText = rows.reduce((a, b) => (b.onBg < a.onBg ? b : a));
      const worstSub = rows.reduce((a, b) => (b.onBgSub < a.onBgSub ? b : a));
      const emptyAccent = rows.filter(r => !r.accent || r.accent === "rgba(0, 0, 0, 0)");
      check("all " + rows.length + " theme/mode combinations keep body text readable (AA 4.5:1)",
        worstText.onBg >= 4.5, { worst: worstText });
      check("secondary text stays readable too (3:1)", worstSub.onBgSub >= 3, { worst: worstSub });
      const where = r => r.theme + (r.dark ? "/dark" : "/light");
      const lowest = (key, n) => rows.slice().sort((a, b) => a[key] - b[key]).slice(0, n || 3).map(r => where(r) + "=" + r[key]);
      const worstSolid = rows.reduce((a, b) => (b.onSolid < a.onSolid ? b : a));
      const worstPill = rows.reduce((a, b) => (b.pill < a.pill ? b : a));
      const worstBubble = rows.reduce((a, b) => (b.bubble < a.bubble ? b : a));
      check("label on an accent button is readable in every theme (AA 4.5:1)",
        worstSolid.onSolid >= 4.5, { worst: worstSolid, lowestThree: lowest("onSolid") });
      check("the floating bar's label clears AA at both ends of its gradient",
        worstPill.pill >= 4.5, { worst: worstPill, lowestThree: lowest("pill") });
      check("your own message text is readable inside the bubble in every theme",
        worstBubble.bubble >= 4.5, { worst: worstBubble, lowestThree: lowest("bubble") });
      check("every theme resolves an accent colour", emptyAccent.length === 0, { empty: emptyAccent });
      check("the accent is always a toned-down version of the theme hue (colour-mix works everywhere)",
        rows.every(r => r.accentKey && r.accent), { sample: rows[0] });
    } else {
      check("theme readability could not be measured", false, readability);
    }

    /* ---- 6. the floating bar: every state reachable, then closed -------- */
    ipcMain.emit("pip:close");
    await wait(400);
    ipcMain.emit("pip:openbar", {}, "right");
    const bar = await waitFor(findPip, 25);
    check("the floating bar opens", !!bar);
    if (bar) {
      const docked = bar.getBounds();
      const wa = screen.getDisplayMatching(docked).workArea;
      check("the bar docks to the side of the work area", docked.x + docked.width > wa.x + wa.width - 20, { docked, wa });

      ipcMain.emit("pip:expand");
      await wait(1200);
      const expanded = bar.getBounds();
      check("the bar expands into the chat popup", expanded.width > 500 && expanded.height > 400, expanded);

      ipcMain.emit("pip:maximize");
      await wait(900);
      const maxed = bar.getBounds();
      const wa2 = screen.getDisplayMatching(maxed).workArea;
      check("the popup maximises to the whole work area",
        Math.abs(maxed.width - wa2.width) <= 4 && Math.abs(maxed.height - wa2.height) <= 4, { maxed, wa2 });

      ipcMain.emit("pip:maximize");
      await wait(900);
      check("maximising again restores the previous size", bar.getBounds().width <= expanded.width + 4, { now: bar.getBounds(), expanded });

      ipcMain.emit("pip:collapse");
      await wait(600);
      const collapsed = bar.getBounds();
      check("the popup collapses straight back to a small bar", collapsed.width <= 300 && collapsed.height <= 260, collapsed);

      ipcMain.emit("pip:close");
      const gone = await (async () => { for (let i = 0; i < 20 && findPip(); i++) await wait(150); return !findPip(); })();
      check("the floating bar closes again", gone === true);
    }

    /* ---- 6b. "Minimize into the floating bar" --------------------------- */
    /* With a bar already open the rail button used to flip the bubble
       open/closed, so there was no way back down to just the bubble. It has to
       hide the chat WINDOW (taskbar entry included) and leave the bar. */
    const clickRailPip = () => main.webContents.executeJavaScript("document.getElementById('btnPip').click()");
    await clickRailPip();
    const tuckedBar = await waitFor(findPip, 25);
    const windowHidden = await (async () => {
      for (let i = 0; i < 25 && main.isVisible(); i++) await wait(100);
      return !main.isVisible();
    })();
    let tuckedCollapsed = null;
    if (tuckedBar) {
      let barReady = false;
      for (let i = 0; i < 40 && !barReady; i++) {
        barReady = await tuckedBar.webContents.executeJavaScript("document.body.classList.contains('app-ready')").catch(() => false);
        if (!barReady) await wait(200);
      }
      tuckedCollapsed = await tuckedBar.webContents.executeJavaScript("document.body.classList.contains('pip-collapsed')").catch(() => null);
    }
    check("the rail button puts the app away: chat window hidden, bar left on screen",
      !!tuckedBar && windowHidden === true, { bar: !!tuckedBar, windowHidden: windowHidden });
    check("what stays on screen is the collapsed bar (a bubble, not a popup)",
      tuckedCollapsed === true, { collapsed: tuckedCollapsed });

    /* Launched again while tucked away → the chat window comes back. */
    try { app.emit("second-instance", {}, [], process.cwd(), {}); } catch {}
    const windowBack = await (async () => { for (let i = 0; i < 30 && !main.isVisible(); i++) await wait(150); return main.isVisible(); })();
    check("launching the app again brings the hidden chat window back", windowBack === true);
    ipcMain.emit("pip:close");
    for (let i = 0; i < 20 && findPip(); i++) await wait(150);

    /* Tucking it while the chat POPUP is open must leave the bar, not the popup. */
    ipcMain.emit("pip:openbar", {}, "right");
    const popupBar = await waitFor(findPip, 25);
    if (popupBar) {
      ipcMain.emit("pip:expand");
      await wait(1200);
      await clickRailPip();
      let backToBar = false;
      for (let i = 0; i < 30 && !backToBar; i++) {
        await wait(150);
        const w = findPip();
        backToBar = !!w && !main.isVisible() && w.getBounds().width <= 300;
      }
      check("tucking the app while the chat popup is open leaves the bar again",
        backToBar === true, { bounds: findPip() ? findPip().getBounds() : null, windowHidden: !main.isVisible() });
      try { app.emit("second-instance", {}, [], process.cwd(), {}); } catch {}
      for (let i = 0; i < 25 && !main.isVisible(); i++) await wait(150);
      ipcMain.emit("pip:close");
      for (let i = 0; i < 20 && findPip(); i++) await wait(150);
    }

    /* ---- 7. the other windows open and close --------------------------- */
    ipcMain.emit("monitor:open");
    const mon = await waitFor(findMonitor, 30);
    check("the fullscreen monitor window opens", !!mon);
    if (mon) {
      ipcMain.emit("monitor:close");
      let monGone = false;
      for (let i = 0; i < 25 && !monGone; i++) { await wait(150); monGone = !findMonitor(); }
      check("the monitor window closes again", monGone === true);
    }

    ipcMain.emit("quick:open");
    const quick = await waitFor(findQuick, 30);
    check("the quick-note popup opens", !!quick);
    if (quick) {
      ipcMain.emit("quick:hide");
      let hidden = false;
      for (let i = 0; i < 20 && !hidden; i++) { await wait(150); hidden = quick.isDestroyed() || !quick.isVisible(); }
      check("the quick-note popup hides again", hidden === true);
    }

    const shotCall = main.webContents.executeJavaScript("window.api.capture.startShot()");
    // The window exists before its page has loaded — cancelling that early once
    // aborted the load and looked like a failure, so wait for it to settle.
    const overlay = await waitFor(() => {
      const w = findShot();
      return w && !w.webContents.isLoading() ? w : null;
    }, 40);
    check("the screenshot region picker opens", !!overlay);
    ipcMain.emit("shot:cancel");
    let overlayGone = false;
    for (let i = 0; i < 25 && !overlayGone; i++) { await wait(150); overlayGone = !findShot(); }
    const shotRes = await shotCall.catch(e => ({ error: String(e) }));
    check("cancelling the picker closes it and returns a result",
      overlayGone === true && !!shotRes && shotRes.ok === true, { overlayGone, shotRes });

    /* Cancelling in the split second the picker is still loading used to come
       back as "ERR_FAILED (-2) loading file:///…" and pop a "Screenshot
       failed" toast for what was really a cancel. */
    const fastCall = main.webContents.executeJavaScript("window.api.capture.startShot()");
    const early = await waitFor(findShot, 60, 20);
    ipcMain.emit("shot:cancel");
    const fastRes = await fastCall.catch(e => ({ error: String(e) }));
    for (let i = 0; i < 25 && findShot(); i++) await wait(150);
    check("closing the picker while it is still opening counts as a cancel, not a failure",
      !!early && !!fastRes && (fastRes.canceled === true || fastRes.ok === true), { earlyPick: !!early, fastRes });

    /* ---- 8. cleanliness: no renderer errors, no crash log, no leftovers - */
    check("no renderer window logged an error during the whole tour",
      rendererErrors.length === 0, { count: rendererErrors.length, errors: rendererErrors.slice(0, 6) });

    check("nothing was written to error.log", !fs.existsSync(ERROR_LOG),
      fs.existsSync(ERROR_LOG) ? fs.readFileSync(ERROR_LOG, "utf8").slice(0, 400) : null);

    const leftovers = BrowserWindow.getAllWindows().filter(w => {
      if (w.isDestroyed()) return false;
      try { return w.isVisible() && w.webContents.getURL().includes("index.html") === false; } catch { return false; }
    }).map(w => { try { return w.webContents.getURL().split("/").pop(); } catch { return "?"; } });
    check("no visible window is left behind", leftovers.length === 0, leftovers);
  } catch (e) {
    console.log("EXC " + ((e && e.stack) || e));
    failed = true;
  } finally {
    console.log("RESULT " + (failed ? "FAIL" : "PASS"));
    app.exit(failed ? 1 : 0);
  }
});
