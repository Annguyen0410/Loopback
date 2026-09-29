/* Smoke test for the floating message menu (right-click / ⋯):
 *   1. menu opens beside the message and stays fully inside the window
 *   2. nothing is ever cut off at the bottom edge (last item clickable)
 *   3. items adapt (Save File only when the message has files)
 *   4. right-click opens it at the cursor, on a tiny (PiP-sized) window too
 *   5. keyboard: ArrowDown/ArrowUp move the highlight, Enter runs the item
 *   6. Esc and scrolling the message list close it
 *   7. it paints above the side panels + recording HUD (z-index)
 *   8. the sidebar ⋯ menu is clamped the same way
 *
 * Run (close the app first — it holds the single-instance lock):
 *   npx electron menutest.js
 */
const path = require("path");
const fs = require("fs");
const { app, BrowserWindow } = require("electron");

// MENUTEST_USERDATA=<dir> runs the whole test against a throwaway profile so
// the real notes/settings are never touched (and it doesn't fight the
// single-instance lock of a running app).
if (process.env.MENUTEST_USERDATA) {
  fs.mkdirSync(process.env.MENUTEST_USERDATA, { recursive: true });
  app.setPath("userData", process.env.MENUTEST_USERDATA);
}
const USER_DATA = app.getPath("userData");
const F = {
  data: path.join(USER_DATA, "messages.json"),
  settings: path.join(USER_DATA, "settings.json")
};
const backups = {};
for (const k of Object.keys(F)) backups[k] = fs.existsSync(F[k]) ? fs.readFileSync(F[k], "utf8") : null;

const CHAT_A = "chat-notes";
const CHAT_B = "chat-ideas";

function seed() {
  const msgs = [];
  for (let i = 0; i < 26; i++) {
    msgs.push({
      id: "m" + i, chatId: CHAT_A, text: "Tin nhắn số " + i, files: [],
      createdAt: Date.now() - (26 - i) * 60000, reactions: {}, read: true
    });
  }
  msgs.push({
    id: "m-file", chatId: CHAT_A, text: "Kèm file", reactions: {}, read: true,
    createdAt: Date.now(),
    files: [{ id: "f1", name: "note.txt", storedName: "stored-note.txt", size: 12, type: "text/plain" }]
  });
  msgs.push({ id: "m2", chatId: CHAT_B, text: "Ý tưởng", files: [], createdAt: Date.now() - 1000, reactions: {}, read: true });
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.writeFileSync(F.data, JSON.stringify({
    chats: [
      { id: CHAT_A, name: "Notes to Self", pinned: true, createdAt: 1 },
      { id: CHAT_B, name: "Ideas", pinned: false, createdAt: 2 }
    ],
    activeChatId: CHAT_A,
    messages: msgs
  }), "utf8");
}
seed();

// Boot the real app (registers every IPC handler + the real windows).
require("./main.js");

const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
function check(name, cond, extra) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));
  if (!cond) failed = true;
}

const guard = setTimeout(() => {
  console.log("FAIL  timed out — if the app is already running, close it and re-run");
  restore();
  app.exit(1);
}, 120000);

function restore() {
  for (const k of Object.keys(F)) {
    try {
      if (backups[k] === null) { if (fs.existsSync(F[k])) fs.unlinkSync(F[k]); }
      else fs.writeFileSync(F[k], backups[k], "utf8");
    } catch {}
  }
}

const HELPERS = `
  function rectOf(el){ const r = el.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; }
  /* Layout box, measured with the pop-in animation off: a hidden Electron
     window freezes CSS animations mid-scale, which would shrink rectOf(). */
  function layoutRect(el){
    const prev = el.style.animation;
    el.style.animation = 'none';
    const r = el.getBoundingClientRect();
    el.style.animation = prev;
    return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
  }
  function inView(r, margin){ return r.left >= margin - 1 && r.top >= margin - 1 && r.right <= window.innerWidth - margin + 1 && r.bottom <= window.innerHeight - margin + 1; }
  function settle(){
    const list = document.getElementById('messages');
    list.style.scrollBehavior = 'auto';
    list.scrollTop = list.scrollHeight;
    return new Promise(res => setTimeout(res, 600));
  }
  const menu = document.getElementById('ctxMenu');
  const chatMenu = document.getElementById('chatMenu');
  const rows = [...document.querySelectorAll('.msg-row')];
  const lastRow = rows[rows.length - 1];       // the message with an attachment
  const textRow = rows[rows.length - 2];       // a plain text message
`;

app.whenReady().then(async () => {
  try {
    await wait(1500);
    const wins = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w.getTitle() !== "Quick note");
    const win = wins.find(w => w.getSize()[0] >= 800);
    check("main window booted", !!win);
    if (!win) return;
    const winErrors = [];
    win.webContents.on("console-message", (e, level, message) => { if (level >= 3) winErrors.push(String(message).slice(0, 200)); });
    const run = js => win.webContents.executeJavaScript("(function(){\n" + HELPERS + js + "})()");
    const runRaw = js => win.webContents.executeJavaScript(js);

    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      ready = await runRaw(`document.body.classList.contains('app-ready')`);
      if (!ready) await wait(250);
    }
    check("renderer finished initializing", ready === true);

    // Let the boot-time smooth scroll to the bottom finish first, so the
    // measurements below are of a settled conversation.
    await run(`return settle().then(() => true);`);

    /* --- 1: open from the ⋯ button of the last message ------------------- */
    const open = await run(`
      window.__ev = [];
      window.addEventListener('blur', () => window.__ev.push('blur'));
      window.addEventListener('resize', () => window.__ev.push('resize'));
      document.addEventListener('keydown', e => window.__ev.push('key:' + e.key), true);
      document.getElementById('messages').addEventListener('scroll', () => window.__ev.push('scroll'), true);
      const btn = textRow.querySelector('[data-act="more"]');
      btn.click();
      const opened = !menu.hidden;
      return new Promise(res => setTimeout(() => {
        const r = layoutRect(menu);
        const del = menu.querySelector('[data-action="delete"]');
        const save = menu.querySelector('[data-action="save"]');
        res({
          openedAtClick: opened,
          ev: window.__ev,
          hidden: menu.hidden,
          rect: r,
          inside: inView(r, 10),
          deleteVisible: !!(del && del.style.display !== 'none'),
          deleteBottom: del ? Math.round(del.getBoundingClientRect().bottom) : -1,
          vh: window.innerHeight,
          saveHidden: !!(save && save.style.display === 'none'),
          rowActions: textRow.classList.contains('actions-visible'),
          z: parseInt(getComputedStyle(menu).zIndex, 10),
          hudZ: parseInt(getComputedStyle(document.getElementById('recHud')).zIndex, 10),
          panelZ: parseInt(getComputedStyle(document.getElementById('settingsPanel')).zIndex, 10),
          icons: menu.querySelectorAll('li svg').length,
          danger: getComputedStyle(menu.querySelector('[data-action="delete"]')).color,
          normal: getComputedStyle(menu.querySelector('[data-action="react"]')).color,
          sepH: Math.round(menu.querySelector('.ctx-sep').getBoundingClientRect().height * 10) / 10
        });
      }, 350));
    `);
    check("menu opens from the ⋯ button", open.hidden === false && open.openedAtClick === true, open);
    check("menu stays fully inside the window", open.inside === true, open.rect);
    check("last item (Delete) is not cut off", open.deleteVisible && open.deleteBottom <= open.vh, { bottom: open.deleteBottom, vh: open.vh });
    check("Save File hidden for a text-only message", open.saveHidden === true);
    check("source row keeps its tools visible", open.rowActions === true);
    check("menu paints above side panels + rec HUD", open.z > open.panelZ && open.z > open.hudZ, { menu: open.z, panel: open.panelZ, hud: open.hudZ });
    check("menu has icons, a divider and a red Delete",
      open.icons >= 6 && open.sepH > 0.5 && open.sepH <= 2 && open.danger !== open.normal,
      { icons: open.icons, sepH: open.sepH, danger: open.danger, normal: open.normal });

    /* --- 2: keyboard navigation ------------------------------------------ */
    const keys = await run(`
      const press = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      press('ArrowDown');
      const first = menu.querySelector('li.focused');
      press('ArrowDown');
      const second = menu.querySelector('li.focused');
      press('ArrowUp');
      const back = menu.querySelector('li.focused');
      press('Enter');
      return new Promise(res => setTimeout(() => res({
        first: first ? first.dataset.action : null,
        second: second ? second.dataset.action : null,
        back: back ? back.dataset.action : null,
        moved: !!first && !!second && first !== second,
        pickerOpen: document.getElementById('reactionPicker').hidden === false,
        menuClosed: menu.hidden === true
      }), 350));
    `);
    check("ArrowDown highlights the first item", keys.first === "react", keys);
    check("ArrowDown again moves the highlight", keys.moved === true, keys);
    check("ArrowUp walks back up the list", keys.back === "react", keys);
    check("Enter runs the highlighted item (React → picker)", keys.pickerOpen === true && keys.menuClosed === true);

    const esc = await run(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return new Promise(res => setTimeout(() => res({
        picker: document.getElementById('reactionPicker').hidden,
        again: menu.hidden
      }), 200));
    `);
    check("Esc closes the picker/menu", esc.picker === true && esc.again === true);

    /* --- 3: right-click at the window's bottom-right corner -------------- */
    const rc = await run(`
      const cx = window.innerWidth - 14, cy = window.innerHeight - 16;
      lastRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
      return new Promise(res => setTimeout(() => {
        const r = layoutRect(menu);
        res({
          hidden: menu.hidden,
          rect: r,
          inside: inView(r, 9),
          flippedX: r.right <= cx,
          flippedY: r.bottom <= cy,
          saveVisible: menu.querySelector('[data-action="save"]').style.display !== 'none'
        });
      }, 350));
    `);
    check("right-click opens the menu", rc.hidden === false, rc.rect);
    check("menu flips away from the corner and stays inside", rc.inside && rc.flippedX && rc.flippedY, rc);
    check("Save File shown for a message with files", rc.saveVisible === true);

    /* --- 4: the menu follows its message, then closes once it is gone ----- */
    /* Scrolling a live list is racy: while the app runs its own smooth
       auto-scroll, a programmatic scrollTop write can settle on the target
       WITHOUT the browser delivering a scroll event, which made these two
       checks flap. __scrollTo scrolls, waits for the event, and nudges the
       list once if none arrived — what is asserted below is still the real
       behaviour (menu follows the message / closes when it leaves the view). */
    await runRaw(`
      window.__scrollTo = (list, target, done) => {
        const start = window.__ev ? window.__ev.length : 0;
        const apply = (v, tries) => {
          list.scrollTop = v;
          setTimeout(() => {
            const got = (window.__ev ? window.__ev.length : 0) > start;
            const settled = Math.abs(list.scrollTop - target) <= 1;
            if (got) return done({ settled: settled, events: (window.__ev || []).length - start, tries: tries });
            if (tries >= 4) return done({ settled: settled, events: 0, tries: tries });
            apply(target + (tries % 2 ? -8 : 8), tries + 1);
          }, 260);
        };
        apply(target, 0);
      };
      void 0; // keep the completion value cloneable (executeJavaScript)
    `);
    const follow = await run(`
      const list = document.getElementById('messages');
      window.__ev = [];
      // Capture-phase listener on document: scroll events do not bubble, but a
      // capturing listener sees them on the way down. Comparing this with the
      // element listener tells a stale-node problem apart from a missing event.
      if (!window.__docScroll) {
        window.__docScroll = true;
        document.addEventListener('scroll', e => window.__ev.push('doc:' + (e.target && e.target.id)), true);
      }
      window.__listSame = list === document.getElementById('messages');
      const before = layoutRect(menu);
      const rowBefore = lastRow.getBoundingClientRect().top;
      const maxScroll = list.scrollHeight - list.clientHeight;
      const target = Math.max(0, maxScroll - 200);
      // The app may still be smooth-scrolling to the bottom; retry until the
      // position sticks.
      return new Promise(res => {
        window.__scrollTo(list, target, info => {
          const after = layoutRect(menu);
          res({
            stillOpen: menu.hidden === false,
            moved: after.top !== before.top,
            inside: inView(after, 10),
            beforeTop: before.top,
            afterTop: after.top,
            target: target,
            scrolled: list.scrollTop,
            maxScroll: maxScroll,
            rowMoved: Math.round(lastRow.getBoundingClientRect().top - rowBefore),
            listSame: window.__listSame,
            follow: info,
            ev: window.__ev
          });
        });
      });
    `);
    check("menu stays open and follows the message while scrolling", follow.stillOpen === true && follow.moved === true && follow.inside === true, follow);

    const gone = await run(`
      const list = document.getElementById('messages');
      return new Promise(res => {
        window.__scrollTo(list, 0, info => res({ closed: menu.hidden, scrolled: list.scrollTop, follow: info }));
      });
    `);
    check("menu closes when its message scrolls out of view", gone.closed === true, gone);

    /* --- 5: sidebar chat menu is clamped too ----------------------------- */
    const chat = await run(`
      const btn = document.querySelector('.conv-menu-btn');
      btn.click();
      return new Promise(res => setTimeout(() => {
        const r = layoutRect(chatMenu);
        const pin = chatMenu.querySelector('[data-action="pin"] .ctx-label').textContent.trim();
        const icon = chatMenu.querySelector('[data-action="pin"] svg');
        res({ hidden: chatMenu.hidden, rect: r, inside: inView(r, 10), pin: pin, iconKept: !!icon, codes: Array.from(pin).map(c => c.charCodeAt(0)) });
      }, 300));
    `);
    check("chat ⋯ menu opens beside the row", chat.hidden === false, chat.rect);
    check("chat ⋯ menu stays inside the window", chat.inside === true, chat.rect);
    check("chat menu keeps its icon, caption flips to Unpin", /^(Un)?[Pp]in$/.test(chat.pin) && chat.iconKept === true, { pin: chat.pin, iconKept: chat.iconKept });
    await runRaw(`document.getElementById('chatMenu').hidden = true`);

    /* --- 6: tiny PiP-sized window ---------------------------------------- */
    const tiny = new BrowserWindow({
      width: 380, height: 300, show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true, nodeIntegration: false
      }
    });
    const tinyErrors = [];
    tiny.webContents.on("console-message", (e, level, message) => { if (level >= 3) tinyErrors.push(String(message).slice(0, 200)); });
    await tiny.loadFile(path.join(__dirname, "index.html"));
    const runTiny = js => tiny.webContents.executeJavaScript("(function(){\n" + HELPERS + js + "})()");
    let tReady = false;
    for (let i = 0; i < 40 && !tReady; i++) {
      tReady = await tiny.webContents.executeJavaScript(`document.body.classList.contains('app-ready')`);
      if (!tReady) await wait(250);
    }
    check("tiny window renderer finished initializing", tReady === true, { errors: tinyErrors });
    await tiny.webContents.executeJavaScript("document.getElementById('messages').style.scrollBehavior = 'auto'; document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight; true");
    await wait(600);

    const small = await runTiny(`
      window.__ev = [];
      window.addEventListener('blur', () => window.__ev.push('blur'));
      document.getElementById('messages').addEventListener('scroll', () => window.__ev.push('scroll'), true);
      const row = rows[rows.length - 1];
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: window.innerWidth - 12, clientY: window.innerHeight - 12 }));
      const opened = !menu.hidden;
      return new Promise(res => setTimeout(() => {
        const r = layoutRect(menu);
        const del = menu.querySelector('[data-action="delete"]');
        menu.scrollTop = menu.scrollHeight;
        const menuBox = menu.getBoundingClientRect();
        const dr = del.getBoundingClientRect();
        res({
          openedAtClick: opened,
          ev: window.__ev,
          hidden: menu.hidden,
          rect: r,
          inside: inView(r, 10),
          scrolls: menu.scrollHeight > menu.clientHeight + 1,
          deleteReachable: dr.height > 8 && dr.bottom <= menuBox.bottom + 1 && dr.top >= menuBox.top - 1,
          vw: window.innerWidth, vh: window.innerHeight,
          menuTop: menu.style.top, menuLeft: menu.style.left
        });
      }, 400));
    `);
    check("tiny window: menu opens", small.hidden === false, small.rect);
    check("tiny window: menu stays inside the viewport", small.inside === true, small.rect);
    check("tiny window: Delete stays reachable (menu scrolls)", small.scrolls === true && small.deleteReachable === true, small);

    /* --- 7: side panels stay aligned + readable when compressed ----------
       The Settings / Recording / Media panels are opened inside narrow windows
       (the floating bubble can be squeezed to a few hundred pixels). At every
       size they must stay inside the window, keep their two columns — labels
       left, controls right, nothing overlapping — keep every segment label
       readable inside its button, and keep the hints legible. */
    const PANEL_PROBE = `
      function panelReport(id){
        const p = document.getElementById(id);
        if (!p) return { id: id, missing: true };
        p.hidden = false;
        const pw = Math.round(window.innerWidth), ph = Math.round(window.innerHeight);
        const pr = p.getBoundingClientRect();
        const bodyEl = p.querySelector('.settings-body');
        const br = bodyEl.getBoundingClientRect();
        const rows = [...p.querySelectorAll('.settings-row')].filter(r => !r.classList.contains('btns'));
        const gaps = rows.map(r => {
          const kids = [...r.children];
          if (kids.length < 2) return 99;
          const a = kids[0].getBoundingClientRect(), b = kids[kids.length - 1].getBoundingClientRect();
          return Math.round(b.left - a.right);
        });
        const rightEdge = [...p.querySelectorAll('.toggle')].map(t => Math.round(t.getBoundingClientRect().right));
        const leftEdge = [...p.querySelectorAll('.settings-row > span:first-child')].map(s => Math.round(s.getBoundingClientRect().left));
        const ctrlEdge = rows.map(r => {
          const kids = [...r.children];
          return kids.length ? Math.round(kids[kids.length - 1].getBoundingClientRect().right) : -1;
        });
        const segs = [...p.querySelectorAll('.seg-btn')].map(b => ({
          text: (b.textContent || '').trim(),
          clipped: b.scrollWidth > b.clientWidth + 1,
          h: Math.round(b.getBoundingClientRect().height)
        }));
        const hints = [...p.querySelectorAll('.settings-hint')].map(h => ({
          fs: parseFloat(getComputedStyle(h).fontSize),
          over: h.scrollWidth > h.clientWidth + 1,
          color: getComputedStyle(h).color
        }));
        const close = p.querySelector('.settings-header .icon-btn');
        const cr = close ? close.getBoundingClientRect() : null;
        const spread = arr => (arr.length ? Math.max.apply(null, arr) - Math.min.apply(null, arr) : 0);
        /* Readability is a number: WCAG contrast of the text against its own
           panel surface (AA small text = 4.5:1). */
        /* Chromium serializes a color-mix() result as color(srgb 0..1), so
           normalize before doing the arithmetic. */
        const rgbOf = c => {
          const s = String(c || '');
          const v = s.split(/[^0-9.-]+/).filter(Boolean).map(Number);
          if (s.indexOf('color(') === 0) return v.slice(0, 3).map(x => x * 255);
          return v.length >= 3 ? v.slice(0, 3) : [0, 0, 0];
        };
        const lum = c => {
          const v = rgbOf(c);
          const f = x => { x = x / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2]);
        };
        const contrast = (a, b) => {
          const l1 = lum(a), l2 = lum(b);
          return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
        };
        const panelBg = getComputedStyle(p).backgroundColor;
        const labelEl = p.querySelector('.settings-row > span:first-child');
        return {
          id: id,
          inside: pr.left >= -0.5 && pr.right <= pw + 0.5 && pr.top >= -0.5 && pr.bottom <= ph + 0.5,
          bodyInside: br.left >= -0.5 && br.right <= pw + 0.5,
          closeInside: !!cr && cr.right <= pw + 0.5 && cr.top >= -0.5 && cr.width > 8,
          panelW: Math.round(pr.width), vw: pw, vh: ph,
          minGap: Math.min.apply(null, gaps), gaps: gaps,
          rightSpread: spread(rightEdge), rightEdge: rightEdge,
          leftSpread: spread(leftEdge), leftEdge: leftEdge,
          ctrlSpread: spread(ctrlEdge), ctrlEdge: ctrlEdge,
          clipped: segs.filter(s => s.clipped).map(s => s.text),
          segH: segs.length ? Math.min.apply(null, segs.map(s => s.h)) : 99,
          smallHints: hints.filter(h => h.fs < 12).length,
          overHints: hints.filter(h => h.over).length,
          hintFs: hints.map(h => h.fs),
          hintContrast: hints.length ? Math.min.apply(null, hints.map(h => contrast(h.color, panelBg))) : 99,
          labelContrast: labelEl ? contrast(getComputedStyle(labelEl).color, panelBg) : 99,
          panelBg: panelBg,
          hintColor: hints.length ? hints[0].color : null,
          labelColor: labelEl ? getComputedStyle(labelEl).color : null
        };
      }
      const freeze = document.createElement('style');
      freeze.textContent = '*{animation:none!important;transition:none!important}';
      document.head.append(freeze);
      /* Measure in the setup the user actually runs: dark + forest. */
      document.body.classList.add('dark', 'theme-forest');
      return { settings: panelReport('settingsPanel'), mini: panelReport('miniPanel'), media: panelReport('mediaPanel') };
    `;
    for (const dims of [[380, 300], [320, 420]]) {
      tiny.setSize(dims[0], dims[1]);
      await wait(500);
      const probe = await runTiny(PANEL_PROBE);
      for (const key of ["settings", "mini", "media"]) {
        const rep = probe[key];
        const where = key + " panel at " + dims[0] + "×" + dims[1];
        check(where + ": stays fully inside the window",
          rep.missing !== true && rep.inside === true && rep.bodyInside === true && rep.closeInside === true, rep);
        check(where + ": rows keep the label/control columns (nothing overlaps)",
          rep.minGap >= 6, rep.gaps);
        check(where + ": controls and labels line up on one edge",
          rep.rightSpread <= 2 && rep.leftSpread <= 2 && rep.ctrlSpread <= 2,
          { toggles: rep.rightEdge, labels: rep.leftEdge, controls: rep.ctrlEdge });
        check(where + ": no clipped segment label, hints legible and inside",
          rep.clipped.length === 0 && rep.smallHints === 0 && rep.overHints === 0 && rep.segH >= 22,
          { clipped: rep.clipped, hintFs: rep.hintFs, segH: rep.segH });
        check(where + ": text keeps AA contrast on the panel surface",
          rep.hintContrast >= 4.5 && rep.labelContrast >= 4.5,
          { hints: rep.hintContrast, labels: rep.labelContrast, bg: rep.panelBg, hintColor: rep.hintColor, labelColor: rep.labelColor });
      }
    }

    /* --- 8: the tone-down pass -------------------------------------------
       Every theme keeps its hue (--accent-key) but the accents the UI paints
       with are mixed toward a neutral slate, so they arrive at a real
       saturation drop — "trầm màu" — and the floating bar uses a soft
       gradient instead of a flat neon fill. */
    const palette = await runTiny(`
      const probe = document.createElement('div');
      document.body.append(probe);
      const rgb = c => {
        const s = String(c || '');
        const v = s.split(/[^0-9.-]+/).filter(Boolean).map(Number);
        if (s.indexOf('color(') === 0) return v.slice(0, 3).map(x => x * 255);
        return v.length >= 3 ? v.slice(0, 3) : null;
      };
      const sat = c => {
        const v = rgb(c);
        if (!v) return -1;
        const max = Math.max.apply(null, v), min = Math.min.apply(null, v);
        const d = max - min, l = (max + min) / 510;
        return d === 0 || l === 0 || l === 1 ? 0 : Math.round((d / (255 * (1 - Math.abs(2 * l - 1)))) * 1000) / 1000;
      };
      const out = {};
      for (const theme of ['blue', 'forest', 'purple']) {
        document.body.classList.remove('theme-forest', 'theme-purple');
        if (theme !== 'blue') document.body.classList.add('theme-' + theme);
        probe.style.color = 'var(--accent-key)';
        const key = getComputedStyle(probe).color;
        probe.style.color = 'var(--accent)';
        const accent = getComputedStyle(probe).color;
        out[theme] = { key: key, keySat: sat(key), accent: accent, accentSat: sat(accent) };
      }
      const pill = getComputedStyle(document.querySelector('.pip-bubble-pill'));
      out.pillGradient = pill.backgroundImage.indexOf('linear-gradient') === 0;
      probe.remove();
      return out;
    `);
    check("the muted accent token resolves from its theme hue",
      palette.blue.accentSat >= 0 && palette.forest.accentSat >= 0 && palette.pillGradient === true,
      palette);
    check("every theme accent is toned down from its raw hue",
      ['blue', 'forest', 'purple'].every(t => palette[t].accentSat >= 0 && palette[t].accentSat <= 0.75 &&
        palette[t].accentSat <= palette[t].keySat - 0.08),
      { blue: palette.blue, forest: palette.forest, purple: palette.purple });
    tiny.destroy();

    check("no renderer console errors", winErrors.length === 0 && tinyErrors.length === 0, { main: winErrors, tiny: tinyErrors });
  } catch (e) {
    console.log("EXC " + ((e && e.stack) || e));
    failed = true;
  } finally {
    clearTimeout(guard);
    restore();
    await wait(200);
    app.exit(failed ? 1 : 0);
  }
});
