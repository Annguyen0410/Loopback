/* UI feel test — the rough edges this suite was written for:
 *   1. hover tooltips: every control explains itself before it is clicked, and
 *      the native `title` is handed back untouched once the pointer leaves
 *   2. minimizing (or any button except close) never loses the floating bar —
 *      an open side panel used to sit on top of the 56×248 bubble
 *   3. the round "Show chats" button is hidden while the chat list is on screen
 *   4. the chat list and every side panel can be dragged wider / narrower, and
 *      the size is remembered in settings.json
 *   5. close is the only button that takes the bar away; the others rebuild it
 *
 * Run (close the app first — it owns the single-instance lock):
 *   npx electron uitest.js
 * UITEST_USERDATA=<dir> runs it against a throwaway profile.
 */
const path = require("path");
const fs = require("fs");
const { app, ipcMain, BrowserWindow } = require("electron");

if (process.env.UITEST_USERDATA) {
  fs.mkdirSync(process.env.UITEST_USERDATA, { recursive: true });
  app.setPath("userData", process.env.UITEST_USERDATA);
}

require("./main.js");

const USER_DATA = app.getPath("userData");
const SETTINGS = path.join(USER_DATA, "settings.json");

const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
function check(name, cond, extra) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? " :: " + JSON.stringify(extra) : ""));
  if (!cond) failed = true;
}

const byUrl = part => BrowserWindow.getAllWindows().find(w => {
  if (w.isDestroyed()) return false;
  try { return w.webContents.getURL().includes(part); } catch { return false; }
});
const findMain = () => BrowserWindow.getAllWindows().find(w => {
  if (w.isDestroyed()) return false;
  try { const u = w.webContents.getURL(); return u.includes("index.html") && !u.includes("pip=1"); } catch { return false; }
});
const findPip = () => byUrl("pip=1");

async function waitFor(fn, tries, ms) {
  let v = null;
  for (let i = 0; i < (tries || 25); i++) { v = fn(); if (v) return v; await wait(ms || 150); }
  return null;
}
async function ready(win) {
  for (let i = 0; i < 40; i++) {
    const ok = await win.webContents.executeJavaScript("document.body.classList.contains('app-ready')").catch(() => false);
    if (ok) return true;
    await wait(200);
  }
  return false;
}
/* Push a full press-move-release at a resize grip, exactly the pointer stream a
   real drag produces (the module reads e.screenX). */
function dragGrip(win, gripId, dx) {
  return win.webContents.executeJavaScript(`(() => {
    const grip = document.getElementById(${JSON.stringify(gripId)});
    if (!grip) return { error: "no grip" };
    const r = grip.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const mk = (type, sx) => new PointerEvent(type, {
      button: 0, buttons: 1, pointerId: 7, pointerType: "mouse",
      bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: sx, screenY: y
    });
    grip.dispatchEvent(mk("pointerdown", x));
    grip.dispatchEvent(mk("pointermove", x + ${Math.round(dx)}));
    grip.dispatchEvent(mk("pointerup", x + ${Math.round(dx)}));
    return { x, y };
  })()`).catch(e => ({ error: String(e) }));
}
const readSettings = () => {
  try { return JSON.parse(fs.readFileSync(SETTINGS, "utf8")); } catch { return {}; }
};

app.whenReady().then(async () => {
  try {
    const main = await waitFor(findMain, 40, 250);
    check("the app boots with a chat window", !!main);
    if (!main) throw new Error("no main window");
    check("the chat window finishes loading", await ready(main) === true);

    /* ---- 1. "Show chats" is hidden whenever the list is on screen -------- */
    const listState = () => main.webContents.executeJavaScript(`(() => {
      const btn = document.getElementById('btnSidebarOpen');
      const sb = document.getElementById('sidebar');
      return {
        open: document.body.classList.contains('sidebar-open'),
        collapsed: document.body.classList.contains('sidebar-collapsed'),
        btnShown: btn ? getComputedStyle(btn).display !== 'none' : null,
        listW: Math.round(sb.getBoundingClientRect().width)
      };
    })()`);

    await main.webContents.executeJavaScript("document.getElementById('btnSidebarCollapse').click()");
    await wait(500);
    const collapsed = await listState();
    check("collapsing the list brings the round \"Show chats\" button back",
      collapsed.open === false && collapsed.btnShown === true && collapsed.listW <= 4, collapsed);

    await main.webContents.executeJavaScript("document.getElementById('btnSidebarOpen').click()");
    await wait(500);
    const reopened = await listState();
    check("with the list open the \"Show chats\" button is gone (it used to sit on top of the list)",
      reopened.open === true && reopened.btnShown === false && reopened.listW > 100, reopened);

    /* ---- 2. the chat list can be dragged wider / narrower ---------------- */
    const beforeList = await listState();
    await dragGrip(main, "sbResize", 90);
    await wait(350);
    const afterList = await listState();
    const savedList = readSettings().sidebarWidth;
    check("dragging the chat list's edge resizes it",
      afterList.listW > beforeList.listW + 60, { before: beforeList.listW, after: afterList.listW });
    check("and the new width is remembered in settings.json",
      Number.isFinite(savedList) && Math.abs(savedList - afterList.listW) <= 2, { savedList, listW: afterList.listW });

    /* ---- 3. side panels drag too (media library) ------------------------- */
    await main.webContents.executeJavaScript("document.querySelector('#btnMedia').click()");
    await wait(600);
    const panelBefore = await main.webContents.executeJavaScript(
      "Math.round(document.getElementById('mediaPanel').getBoundingClientRect().width)");
    await dragGrip(main, "mediaResize", -80);
    await wait(350);
    const panelAfter = await main.webContents.executeJavaScript(
      "Math.round(document.getElementById('mediaPanel').getBoundingClientRect().width)");
    const savedPanel = readSettings().mediaPanelWidth;
    check("the media library can be dragged wider for bigger thumbnails",
      panelAfter > panelBefore + 50, { before: panelBefore, after: panelAfter });
    check("the media library width is remembered too",
      Number.isFinite(savedPanel) && Math.abs(savedPanel - panelAfter) <= 2, { savedPanel, panelAfter });
    await main.webContents.executeJavaScript("document.getElementById('btnCloseMedia').click()");

    /* ---- 4. tooltips: what the button does, before clicking it ----------- */
    const tipProbe = await main.webContents.executeJavaScript(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const btn = document.getElementById('btnPip');
      const titleBefore = btn.getAttribute('title');
      const r = btn.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      btn.dispatchEvent(new PointerEvent('pointerover', at));
      await wait(500);
      const tip = document.querySelector('.tip');
      const shown = tip && tip.classList.contains('show') && getComputedStyle(tip).visibility !== 'hidden';
      const box = tip ? tip.getBoundingClientRect() : null;
      const inside = box ? (box.left >= -1 && box.right <= window.innerWidth + 1 && box.top >= -1 && box.bottom <= window.innerHeight + 1) : null;
      const text = tip ? tip.textContent : '';
      const titleHidden = btn.hasAttribute('title');
      btn.dispatchEvent(new PointerEvent('pointerout', at));
      await wait(200);
      return {
        shown, inside, text: text.slice(0, 60), nativeSuppressed: titleHidden === false,
        restored: btn.getAttribute('title') === titleBefore,
        hiddenAfter: !tip.classList.contains('show')
      };
    })()`);
    check("hovering a control shows a description of what it does",
      tipProbe.shown === true && tipProbe.text.length > 20, tipProbe);
    check("the tooltip stays inside the window", tipProbe.inside === true, tipProbe);
    check("the native title is suppressed while the tooltip is up, then handed back",
      tipProbe.nativeSuppressed === true && tipProbe.restored === true && tipProbe.hiddenAfter === true, tipProbe);

    /* ---- 5. every theme really paints (this is the "make it prettier" pass) - */
    const walls = await main.webContents.executeJavaScript(`(() => {
      const themes = ["", "purple", "pink", "green", "orange", "red", "teal", "gradient", "sunset", "ocean", "forest", "candy", "mono", "galaxy", "aurora", "coffee"];
      const keep = document.body.className.split(/\\s+/).filter(c => c && c !== "dark" && c.indexOf("theme-") !== 0);
      const chat = document.querySelector(".chat");
      const msgs = document.querySelector(".messages");
      const out = [];
      for (const t of themes) {
        for (const dark of [false, true]) {
          document.body.className = [...keep, ...(dark ? ["dark"] : []), ...(t ? ["theme-" + t] : [])].join(" ");
          document.body.offsetHeight; // let the new theme resolve
          const bg = getComputedStyle(chat).backgroundImage || "";
          out.push({
            theme: t || "blue", dark,
            layers: (bg.match(/gradient\\(/g) || []).length,
            wallpaper: bg !== "none",
            msgTransparent: getComputedStyle(msgs).backgroundColor === "rgba(0, 0, 0, 0)"
          });
        }
      }
      document.body.className = keep.join(" ");
      return out;
    })()`);
    const thinWall = walls.filter(w => !w.wallpaper || w.layers < 2);
    check("all " + walls.length + " theme/mode combinations paint a wallpaper (theme glow over a gradient)",
      thinWall.length === 0, { thin: thinWall });
    const paintedMsgs = walls.filter(w => !w.msgTransparent);
    check("the message column stays transparent, so the wallpaper runs edge to edge",
      paintedMsgs.length === 0, { painted: paintedMsgs.slice(0, 3) });

    /* ---- 6. keyboard focus is visible ---------------------------------- */
    const focusRing = await main.webContents.executeJavaScript(`(() => {
      const el = document.getElementById('btnPip');
      el.focus();
      const out = {
        ring: getComputedStyle(document.body).getPropertyValue('--focus-ring').trim(),
        shadow: getComputedStyle(el).boxShadow,
        focused: el.matches(':focus-visible')
      };
      el.blur();
      return out;
    })()`);
    check("a focused control still paints its focus ring",
      focusRing.ring.length > 0 && focusRing.focused === true && focusRing.shadow !== "none", focusRing);

    /* ---- 7. minimizing must never lose the floating bar ------------------ */
    ipcMain.emit("pip:open");
    const popup = await waitFor(findPip, 30, 200);
    check("the floating chat popup opens", !!popup);
    if (popup) {
      check("the popup finishes loading", await ready(popup) === true);
      // Open the media library in the popup, then minimize: the panel used to be
      // painted straight over the bubble, which read as "the bar is gone".
      await popup.webContents.executeJavaScript("document.getElementById('btnPipMedia').click()");
      await wait(900);
      const panelOverBubble = await popup.webContents.executeJavaScript(`(() => {
        const p = document.getElementById('mediaPanel');
        return { open: p ? !p.hidden : null, collapsed: document.body.classList.contains('pip-collapsed') };
      })()`);
      await popup.webContents.executeJavaScript("document.getElementById('btnPipCollapse').click()");
      await wait(900);
      const afterMinimize = await popup.webContents.executeJavaScript(`(() => {
        const p = document.getElementById('mediaPanel');
        const b = document.getElementById('pipBubble');
        const r = b.getBoundingClientRect();
        const pr = p ? p.getBoundingClientRect() : null;
        return {
          collapsed: document.body.classList.contains('pip-collapsed'),
          panelHidden: p ? p.hidden : null,
          panelPainted: pr ? (getComputedStyle(p).display !== 'none' && pr.width > 0) : false,
          bubbleInView: r.width > 20 && r.height > 20,
          bubbleVisible: getComputedStyle(b).display !== 'none'
        };
      })()`);
      const bounds = popup.getBounds();
      check("minimize lands on the floating bar in a bar-sized window",
        afterMinimize.collapsed === true && bounds.width <= 300 && bounds.height <= 280, { bounds, afterMinimize });
      check("the open side panel is put away, so the bubble is what you see",
        panelOverBubble.open === true && afterMinimize.panelHidden === true && afterMinimize.panelPainted === false &&
        afterMinimize.bubbleVisible === true && afterMinimize.bubbleInView === true,
        { panelOverBubble, afterMinimize });

      /* Expand again from the bubble, then close the popup from its own header. */
      await popup.webContents.executeJavaScript("document.getElementById('btnBubbleChat').click()");
      await wait(1200);
      const reExpanded = await popup.webContents.executeJavaScript("!document.body.classList.contains('pip-collapsed')");
      check("tapping the bubble reopens the chat", reExpanded === true);
      await popup.webContents.executeJavaScript("document.getElementById('btnPipClose').click()");
      const gone = await (async () => { for (let i = 0; i < 20 && findPip(); i++) await wait(150); return !findPip(); })();
      check("close is the one button that removes the bar", gone === true);

      /* The chat window is back — and the bar can be rebuilt without a restart. */
      const windowBack = await (async () => { for (let i = 0; i < 25 && !(findMain() && findMain().isVisible()); i++) await wait(150); return !!(findMain() && findMain().isVisible()); })();
      check("closing the bar leaves the app on screen (nothing to dig the window out of)", windowBack === true);
      ipcMain.emit("pip:collapse");
      const rebuilt = await waitFor(findPip, 25, 200);
      const rebuiltCollapsed = rebuilt
        ? await (async () => { for (let i = 0; i < 20; i++) { const c = await rebuilt.webContents.executeJavaScript("document.body.classList.contains('pip-collapsed')").catch(() => null); if (c) return c; await wait(200); } return null; })()
        : null;
      check("minimize rebuilds the floating bar even after it was closed",
        !!rebuilt && rebuiltCollapsed === true, { rebuilt: !!rebuilt, collapsed: rebuiltCollapsed, bounds: rebuilt ? rebuilt.getBounds() : null });
      ipcMain.emit("pip:close");
      for (let i = 0; i < 20 && findPip(); i++) await wait(150);
    }
  } catch (err) {
    check("the tour ran without throwing", false, { error: String(err && err.message || err) });
  }

  /* Closing the bar brings the chat window back — that one is the app, and it
     is allowed to still be there. Anything ELSE on screen is a leak. */
  const chatWindow = findMain();
  const leftovers = BrowserWindow.getAllWindows()
    .filter(w => !w.isDestroyed() && w !== chatWindow)
    .map(w => { try { return w.webContents.getURL().split("/").pop(); } catch { return "?"; } });
  check("only the chat window is left — no floating bar, panel or overlay survives",
    leftovers.length === 0, { leftovers, chatWindow: !!chatWindow });
  console.log(failed ? "RESULT FAIL" : "RESULT PASS");
  app.exit(failed ? 1 : 0);
});
