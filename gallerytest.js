/* The way OUT of the media library.
 *
 * Reported: take a screenshot, open the media library, click the capture — and
 * the ✕ will not take you out. The ✕ a hand goes to is the library's own close
 * button in the window's top-right corner, and it used to be painted UNDER the
 * preview overlay by `z-index`, so that click landed on the overlay: a dead
 * button (and a second click was needed even for the path that did work).
 *
 * This suite measures it the way a user meets it:
 *
 *   1. the library lists the capture and clicking it opens the preview
 *   2. the element under the pointer at the library ✕ corner IS the preview ✕
 *   3. one real mouse click there closes the preview (the library stays open)
 *   4. the library's own ✕ still closes the library afterwards
 *   5. Esc leaves the preview even when the pointer is elsewhere
 *   6. the preview ✕ never leaves the window, at every size the app allows
 *
 * Run (close the app first — it holds the single-instance lock):
 *   npx electron gallerytest.js
 * Set GALLERYTEST_USERDATA=<dir> to use a throwaway profile.
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { app, BrowserWindow } = require("electron");

const UD = process.env.GALLERYTEST_USERDATA || path.join(os.tmpdir(), "loopback-gallerytest-" + Date.now());
fs.mkdirSync(path.join(UD, "captures"), { recursive: true });
app.setPath("userData", UD);
require("./main.js");

const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
function check(name, cond, extra) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));
  if (!cond) failed = true;
}

/* 4×3 green PNG, written straight into captures/ before the window exists. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFUlEQVR4nGP8z4AATAxEcQxEcgwAtQkB/0mS3N0AAAAASUVORK5CYII=",
  "base64"
);
fs.writeFileSync(path.join(UD, "captures", "gallerytest-shot.png"), PNG);

const guard = setTimeout(() => { console.log("FAIL  timed out — if the app is already running, close it and re-run"); app.exit(1); }, 150000);

/* Opens the library, clicks the first capture, and reports both ✕ buttons plus
   what is really under the pointer at the library's corner while the preview is
   open. */
const PROBE = `(async function(){
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const panel = document.getElementById('mediaPanel');
  if (panel.hidden) document.getElementById('btnMedia').click();
  await wait(700);
  const cards = [...document.querySelectorAll('#mediaGrid .media-card')];
  if (!cards.length) return { cards: 0 };
  cards[0].click();
  await wait(450);
  const box = el => { const r = el.getBoundingClientRect();
    return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2),
             x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const libClose = document.getElementById('btnCloseMedia');
  const pvClose = document.getElementById('mediaPreviewClose');
  const lp = box(libClose), vp = box(pvClose);
  const hit = document.elementFromPoint(lp.cx, lp.cy);
  const who = el => el ? { id: el.id, tag: el.tagName,
    cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').slice(0, 40) } : null;
  return {
    cards: cards.length,
    previewOpen: document.getElementById('mediaPreview').hidden === false,
    vw: innerWidth, vh: innerHeight,
    libraryClose: lp, previewClose: vp,
    hitAtLibraryClose: who(hit),
    previewCloseIsAtLibraryCorner: !!(hit && (hit === pvClose || (hit.closest && hit.closest('#mediaPreviewClose') === pvClose))),
    previewCloseInsideWindow: vp.x >= 0 && vp.y >= 0 && vp.x + vp.w <= innerWidth && vp.y + vp.h <= innerHeight
  };
})()`;

async function clickAt(win, at) {
  win.webContents.sendInputEvent({ type: "mouseDown", x: at.cx, y: at.cy, button: "left", clickCount: 1 });
  win.webContents.sendInputEvent({ type: "mouseUp", x: at.cx, y: at.cy, button: "left", clickCount: 1 });
  await wait(450);
}

app.whenReady().then(async () => {
  try {
    await wait(1800);
    const main = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && !String(w.webContents.getURL()).includes("pip=1"));
    check("main window booted", !!main);
    if (!main) return;
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      ready = await main.webContents.executeJavaScript("document.body.classList.contains('app-ready')");
      if (!ready) await wait(250);
    }
    check("renderer initialized", ready === true);
    const run = js => main.webContents.executeJavaScript(js);

    const sizes = [[1184, 761], [1000, 700], [900, 620], [800, 560]];
    for (const [w, h] of sizes) {
      main.setSize(w, h);
      await wait(600);
      const p = await run(PROBE);
      const at = `${w}x${h}`;
      check(`${at}: clicking a capture opens the preview`, p.cards > 0 && p.previewOpen === true, p);
      check(`${at}: the preview ✕ sits where the library ✕ is (window corner)`, p.previewCloseIsAtLibraryCorner === true, p);
      check(`${at}: the preview ✕ is inside the window`, p.previewCloseInsideWindow === true, p);
      if (p.libraryClose) {
        await clickAt(main, p.libraryClose);
        const after = await run(`({ open: document.getElementById('mediaPreview').hidden === false,
          body: document.getElementById('mediaPreviewBody').children.length,
          library: document.getElementById('mediaPanel').hidden === false })`);
        check(`${at}: ONE click on the ✕ leaves the preview`, after.open === false && after.body === 0, after);
        check(`${at}: the library is still there to look at`, after.library === true, after);
      }
      // Clear the overlay for the next size.
      await run(`(async () => {
        document.getElementById('mediaPreview').hidden = true;
        document.getElementById('mediaPreviewBody').innerHTML = '';
        document.getElementById('mediaPanel').hidden = false;
        await new Promise(r => setTimeout(r, 80));
      })()`);
    }

    /* The library's own ✕ still closes the library once the preview is gone. */
    main.setSize(1000, 700);
    await wait(500);
    await run(`document.getElementById('mediaPanel').hidden ? document.getElementById('btnMedia').click() : 0`);
    await wait(500);
    const open = await run(`document.getElementById('mediaPanel').hidden === false`);
    const libBox = await run(`(() => { const b = document.getElementById('btnCloseMedia').getBoundingClientRect();
      return { cx: Math.round(b.x + b.width / 2), cy: Math.round(b.y + b.height / 2) }; })()`);
    await clickAt(main, libBox);
    const libClosed = await run(`document.getElementById('mediaPanel').hidden === true`);
    check("the library ✕ closes the library when no preview is up", open === true && libClosed === true, { open, libClosed });

    /* Esc is the other way out of the preview. */
    await run(`(async () => {
      document.getElementById('btnMedia').click();
      await new Promise(r => setTimeout(r, 600));
      const c = document.querySelector('#mediaGrid .media-card');
      if (c) c.click();
      await new Promise(r => setTimeout(r, 400));
    })()`);
    const prevOpen = await run(`document.getElementById('mediaPreview').hidden === false`);
    main.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    await wait(400);
    const escClosed = await run(`document.getElementById('mediaPreview').hidden === true`);
    check("Esc leaves the preview too", prevOpen === true && escClosed === true, { prevOpen, escClosed });
  } catch (e) {
    console.log("FAIL  threw :: " + (e && e.message ? e.message : String(e)));
    failed = true;
  } finally {
    clearTimeout(guard);
    console.log(failed ? "RESULT FAIL" : "RESULT PASS");
    try { fs.rmSync(UD, { recursive: true, force: true }); } catch {}
    app.exit(failed ? 1 : 0);
  }
});
