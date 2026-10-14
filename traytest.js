/* Background / tray test — "the app keeps running in the tray" is a promise, so
 * it gets a suite like everything else. What it proves:
 *   1. the tray icon is really created — that icon is the app's only home once
 *      every window is closed
 *   2. the tray menu is wired: its chat-bubble row opens AND closes the floating
 *      bubble, and both checkboxes write exactly the setting they claim to
 *      (and the login-item checkbox matches what the OS reports back)
 *   3. closing EVERY window does not quit — the process is still there, and
 *      launching the app again brings the chat window back out of the tray
 *   4. started with --autostart (what the Windows login item does) the app comes
 *      up with NO chat window at all: tray + floating chat bubble only, so a
 *      boot start costs no window to dismiss and no hidden chat renderer
 *
 * Run (close the app first — it owns the single-instance lock):
 *   npx electron traytest.js
 *   npx electron traytest.js --autostart
 *   TRAYTEST_USERDATA=<dir> npx electron traytest.js --background-off
 * TRAYTEST_USERDATA=<dir> runs it against a throwaway profile; the checks that
 * write settings.json are skipped without one (so your own settings are safe).
 * --background-off is the one case the app is supposed to DIE in: with *Keep
 * running in the tray* off, closing the last window quits — so that run prints
 * "QUIT-EXPECTED" and never reaches a RESULT. The shell command, not this file,
 * is what asserts it: `echo $?` must be 0 with no RESULT line printed.
 */
const path = require("path");
const fs = require("fs");
const { app, ipcMain, BrowserWindow } = require("electron");

/* main.js reads this at require-time to switch the tray on in a test boot. */
process.env.LOOPBACK_TRAY_TEST = "1";
const THROWAWAY = !!process.env.TRAYTEST_USERDATA;
if (THROWAWAY) {
  fs.mkdirSync(process.env.TRAYTEST_USERDATA, { recursive: true });
  app.setPath("userData", process.env.TRAYTEST_USERDATA);
}

const USER_DATA = app.getPath("userData");
const SETTINGS = path.join(USER_DATA, "settings.json");
const AUTOSTART = process.argv.includes("--autostart");
const BACKGROUND_OFF = process.argv.includes("--background-off");

/* "Keep running in the tray" off must mean the app really quits when its last
   window closes — the only way to see that from inside is to have main.js boot
   with the setting already written. */
if (BACKGROUND_OFF) {
  if (!THROWAWAY) {
    console.log("FAIL  --background-off writes settings.json — run it with TRAYTEST_USERDATA=<dir>");
    process.exit(1);
  }
  fs.writeFileSync(SETTINGS, JSON.stringify({ darkMode: false, theme: "blue", runInBackground: false }), "utf8");
}

require("./main.js");

const readCfg = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, "utf8")); } catch { return {}; } };

const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
function check(name, cond, extra) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? " :: " + JSON.stringify(extra) : ""));
  if (!cond) failed = true;
}

const windows = () => BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
const byUrl = part => windows().find(w => {
  try { return w.webContents.getURL().includes(part); } catch { return false; }
});
/* The CHAT window: index.html without the pip flag. */
const findMain = () => windows().find(w => {
  try {
    const u = w.webContents.getURL();
    return u.includes("index.html") && !u.includes("pip=1");
  } catch { return false; }
});
const findPip = () => byUrl("pip=1");
const tray = () => (global.__loopbackTray ? global.__loopbackTray.tray() : null);
const menu = () => (global.__loopbackTray ? global.__loopbackTray.menu() : []);
const menuItem = label => menu().find(i => i.label === label || (i.label && i.label.startsWith(label))) || null;

async function waitFor(fn, tries, ms) {
  let v = null;
  for (let i = 0; i < (tries || 25); i++) { v = fn(); if (v) return v; await wait(ms || 150); }
  return null;
}

const guard = setTimeout(() => {
  console.log("FAIL  timed out — if the app is already running, close it and re-run");
  app.exit(1);
}, 90000);

app.whenReady().then(async () => {
  try {
    /* ---- 4. a boot start is tray + bubble, never a chat window ---------- */
    if (AUTOSTART) {
      check("--autostart is what main.js saw", global.__loopbackTray && global.__loopbackTray.startedHidden === true);
      check("the tray icon is up before anything else", !!tray());
      const bar = await waitFor(findPip, 30, 200);
      check("a boot start drops the floating chat bubble on its dock", !!bar);
      await wait(2500);
      const url = w => { try { return w.webContents.getURL().split("/").pop(); } catch { return "?"; } };
      const open = windows().map(url);
      check("a boot start opens NO chat window (nothing to dismiss, no hidden renderer)",
        !findMain(),
        { windows: open, bubbleIsTheOnlyOne: windows().every(w => w === bar) });
      const collapsed = bar
        ? await bar.webContents.executeJavaScript("document.body.classList.contains('pip-collapsed')").catch(() => null)
        : null;
      check("the bubble that comes up is the collapsed bar", collapsed === true, { collapsed });

      /* Closing the bubble with no chat window behind it leaves the app in the
         tray — and it says so instead of looking dead. */
      ipcMain.emit("pip:close");
      await waitFor(() => !findPip(), 25, 200);
      await wait(1200);
      check("closing the bubble leaves the process alive in the tray",
        !!tray() && windows().length === 0 && global.__loopbackTray.alive() === true,
        { windows: windows().length });
      app.emit("second-instance", {}, [], process.cwd(), {});
      const back = await waitFor(findMain, 30, 200);
      check("the tray is the way back in: launching the app opens the chat", !!back);
      return; // fall through to the shared RESULT/exit tail below
    }

    /* ---- 0. background OFF: the last window closing is a real quit -------- */
    if (BACKGROUND_OFF) {
      const w = await waitFor(findMain, 30, 200);
      check("the chat window is up with the background toggle off", !!w);
      check("the tray is still there while a window is open", !!tray());
      console.log("QUIT-EXPECTED  closing the last window now — the process must end on its own");
      if (w) w.close();
      await wait(8000);
      /* Reaching here means window-all-closed did NOT quit: main.js ignored the
         setting, which is exactly the bug this run exists to catch. */
      check("closing the last window quits when the tray keep-alive is off",
        false, { windows: windows().length, stillAlive: global.__loopbackTray.alive() });
      return;
    }

    /* ---- 1. the tray exists at all -------------------------------------- */
    const chat = await waitFor(findMain, 30, 200);
    check("the chat window is up (normal, non-autostart launch)", !!chat);
    const t = tray();
    check("the tray icon is created, with its tooltip", !!t && typeof t.setToolTip === "function");
    check("the tray menu is built from real items", menu().filter(i => i.label).length >= 5,
      { labels: menu().map(i => i.label || i.type) });

    /* ---- 2. the tray menu actually drives the app ------------------------ */
    if (chat) {
      ipcMain.emit("pip:close");
      await waitFor(() => !findPip(), 25, 200);
      const showBubble = menuItem("Show chat bubble");
      check("the menu offers to show the bubble while none is open", !!showBubble);
      if (showBubble) {
        showBubble.click();
        const bubble = await waitFor(findPip, 30, 200);
        check("the tray's bubble row opens the floating bar", !!bubble);
        const hideItem = await waitFor(() => menuItem("Hide chat bubble"), 10, 200);
        check("the row relabels itself once the bar is open", !!hideItem);
        if (hideItem) {
          hideItem.click();
          const gone = await waitFor(() => !findPip(), 30, 200);
          check("the tray's bubble row closes the floating bar too",
            gone === true && !!findMain() && findMain().isVisible() === true);
        }
      }
      /* Opening the chat from the tray: hide the window, right-click the tray
         (that is what rebuilds the template) and click the row. */
      const hiddenWin = findMain();
      if (hiddenWin) hiddenWin.hide();
      const staleLabel = menuItem("Focus Loopback") && menuItem("Focus Loopback").label;
      tray().emit("right-click"); // exactly what a real right-click does
      const open = menuItem("Open Loopback");
      check("right-clicking with the chat hidden relabels the row to Open Loopback",
        staleLabel === "Focus Loopback" && !!open, { before: staleLabel, after: open && open.label });
      if (open) {
        open.click();
        const shown = await waitFor(() => {
          const w = findMain();
          return w && w.isVisible() ? w : null;
        }, 30, 200);
        check("the tray reopens a hidden chat window", !!shown);
      }
    }

    /* The two settings rows — only against a throwaway profile, they write. */
    if (THROWAWAY) {
      const before = readCfg();
      const bgItem = menuItem("Keep running in the tray");
      check("the menu carries the background toggle, checked by default", !!bgItem && bgItem.checked === true);
      if (bgItem) {
        bgItem.click({ checked: false });
        const off = await waitFor(() => (readCfg().runInBackground === false ? readCfg() : null), 15, 150);
        check("switching the background toggle off is saved to settings.json", !!off, { cfg: off });
        const rebuilt = await waitFor(() => menuItem("Keep running in the tray"), 10, 150);
        check("the menu is rebuilt so its checkmark matches the new state",
          !!rebuilt && rebuilt.checked === false, { checked: rebuilt && rebuilt.checked });
        if (rebuilt) rebuilt.click({ checked: true });
        await waitFor(() => (readCfg().runInBackground === true ? true : null), 15, 150);
      }
      const loginItem = menuItem("Start with Windows");
      check("the menu carries the login-item toggle", !!loginItem);
      if (loginItem) {
        loginItem.click({ checked: !loginItem.checked });
        await wait(400);
        const os = !!(app.getLoginItemSettings() || {}).openAtLogin;
        const shownNow = menuItem("Start with Windows");
        check("the login-item checkmark reports what the OS actually accepted",
          !!shownNow && shownNow.checked === os, { os, checked: shownNow && shownNow.checked });
      }
      /* Leave the throwaway profile as it was found. */
      try { fs.writeFileSync(SETTINGS, JSON.stringify(before), "utf8"); } catch {}
    } else {
      console.log("SKIP  the two settings rows that write (run with TRAYTEST_USERDATA=<dir> to include them)");
    }

    /* ---- 3. nothing open does not mean quit ----------------------------- */
    ipcMain.emit("pip:close");
    await waitFor(() => !findPip(), 25, 200);
    const w = findMain();
    if (w) w.close();
    const none = await waitFor(() => (windows().length === 0 ? true : null), 40, 150);
    check("closing every window really closes them", none === true, { windows: windows().length });
    await wait(1800);
    check("...and the app is STILL RUNNING, in the tray, instead of quitting",
      !!tray() && global.__loopbackTray.alive() === true && windows().length === 0,
      { windows: windows().length, tray: !!tray() });

    app.emit("second-instance", {}, [], process.cwd(), {});
    const revived = await waitFor(findMain, 30, 200);
    check("launching the app again brings the chat window back out of the tray", !!revived);
    if (revived) {
      let readyUp = false;
      for (let i = 0; i < 40 && !readyUp; i++) {
        readyUp = await revived.webContents.executeJavaScript("document.body.classList.contains('app-ready')").catch(() => false);
        if (!readyUp) await wait(200);
      }
      check("the window that comes back is fully loaded and usable", readyUp === true);
    }
    const leftovers = windows().filter(x => x !== findMain()).map(x => { try { return x.webContents.getURL().split("/").pop(); } catch { return "?"; } });
    check("no stray window was left behind by any of that", leftovers.length === 0, leftovers);
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
