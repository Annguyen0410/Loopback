/* Screenshot review test — "a screenshot ends with the picture and a Download
 * button" is a promise, so it gets a suite like every other feature:
 *   1. a completed region shot opens the review window — visible, in front,
 *      sized to the image, off the taskbar, with the image really decoded
 *   2. Download writes a real PNG into the Downloads folder with ONE click and
 *      says where it went (no dialog, no trip through the media library)
 *   3. Copy puts the same image on the clipboard
 *   4. a second shot replaces the review window instead of stacking them, and
 *      the earlier card never ends up inside the new screenshot
 *   5. Delete throws the capture away, drops it from an open media library and
 *      closes the card — and nothing is left behind on screen
 *   6. the note typed on the card is printed INTO the picture: the stored
 *      capture becomes the annotated PNG (so Download hands that out), and
 *      clearing the note puts the pristine shot back byte for byte
 *   7. the minimize button collapses the card to its title bar and restores it
 *      exactly where it was (it has no taskbar button to come back from)
 *   8. the name on disk reads day-month-year_hour-minute-second-shot.png, and
 *      Copy really leaves an image/png on the clipboard — the format a browser,
 *      a document or a chat box pastes
 *
 * Run (close the app first — it owns the single-instance lock):
 *   npx electron reviewtest.js
 * REVIEWTEST_USERDATA=<dir> runs it against a throwaway profile. Downloads are
 * always written into a temporary folder, never into your real Downloads.
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { app, ipcMain, BrowserWindow, clipboard, nativeImage, screen } = require("electron");

if (process.env.REVIEWTEST_USERDATA) {
  fs.mkdirSync(process.env.REVIEWTEST_USERDATA, { recursive: true });
  app.setPath("userData", process.env.REVIEWTEST_USERDATA);
}
/* The whole point of the review window is one-click downloading, so this suite
   has to click it — into a scratch folder, never the user's own. */
const DOWNLOADS = path.join(os.tmpdir(), "loopback-reviewtest-downloads-" + process.pid);
fs.mkdirSync(DOWNLOADS, { recursive: true });
app.setPath("downloads", DOWNLOADS);

require("./main.js");

const USER_DATA = app.getPath("userData");
const CAPTURES = path.join(USER_DATA, "captures");
const caps = () => (fs.existsSync(CAPTURES) ? fs.readdirSync(CAPTURES).filter(f => f.endsWith(".png")) : []);
const downloads = () => fs.readdirSync(DOWNLOADS);

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
const findMain = () => windows().find(w => {
  try {
    const u = w.webContents.getURL();
    return u.includes("index.html") && !u.includes("pip=1");
  } catch { return false; }
});
/* Only a card that is actually ON SCREEN counts: it is created hidden and shown
   on ready-to-show, and every check below is about what the user sees. */
const findReview = () => windows().find(w => {
  try { return w.webContents.getURL().includes("review.html") && w.isVisible(); } catch { return false; }
});
const findShot = () => byUrl("shot-overlay.html");

async function waitFor(fn, tries, ms) {
  let v = null;
  for (let i = 0; i < (tries || 25); i++) { v = fn(); if (v) return v; await wait(ms || 150); }
  return null;
}

/* Type into the note field the way a person does: real char events into the
   focused input, so the card's own input handler is what runs. (insertText()
   only reaches a focused *window*, which a test cannot rely on.) */
async function typeNote(w, text) {
  try { w.focus(); w.webContents.focus(); } catch {}
  await w.webContents.executeJavaScript("document.getElementById('note').focus()");
  for (const ch of String(text)) {
    w.webContents.sendInputEvent({ type: "char", keyCode: ch });
  }
  /* Char events land one by one, and the card bakes the note on a debounce — so
     wait until the whole thing is typed AND the bake has settled, or the
     checks below would read a half-typed picture. */
  for (let i = 0; i < 40; i++) {
    const v = await w.webContents.executeJavaScript("document.getElementById('note').value");
    if (v === String(text)) break;
    await wait(150);
  }
  await wait(1200);
}

/* How much near-white text ink sits BELOW the shot itself — that region only
   exists once a note has been printed, so it can never be confused with
   whatever the screenshot happened to contain. */
function captionInk(file, shotHeight) {
  try {
    const im = nativeImage.createFromPath(file);
    const size = im.getSize();
    const bmp = im.getBitmap();
    let ink = 0;
    for (let y = Math.max(0, Math.floor(shotHeight)); y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        const i = (y * size.width + x) * 4;
        if (bmp[i] > 190 && bmp[i + 1] > 190 && bmp[i + 2] > 190) ink++;
      }
    }
    return ink;
  } catch { return -1; }
}

/* A completed region shot, driven exactly like the picker does: start the
   overlay through the renderer bridge, then hand main a selection. */
async function shoot(main) {
  const call = main.webContents.executeJavaScript("window.api.capture.startShot()").catch(e => ({ error: String(e) }));
  const overlay = await waitFor(findShot, 60, 200);
  if (!overlay) return { overlay: null };
  await wait(400); // the grab needs a moment to settle before the crop
  ipcMain.emit("shot:done", {}, { x: 12, y: 12, w: 160, h: 120 });
  await call;
  const review = await waitFor(findReview, 40, 200);
  return { overlay, review };
}

const guard = setTimeout(() => {
  console.log("FAIL  timed out — if the app is already running, close it and re-run");
  app.exit(1);
}, 90000);

app.whenReady().then(async () => {
  const before = caps();
  let madeCaptures = [];
  try {
    const main = await waitFor(findMain, 30, 200);
    check("the chat window is up (main.js booted the app)", !!main);

    /* ---- 1. a shot ends in the review window ---------------------------- */
    const first = await shoot(main);
    check("a completed region shot opens the review window", !!first.review,
      { reviewWindows: windows().filter(w => { try { return w.webContents.getURL().includes("review.html"); } catch { return false; } }).length });
    const review = first.review;
    if (!review) throw new Error("no review window — nothing else can be checked");

    const newly = caps().filter(n => !before.includes(n));
    madeCaptures = newly.slice();
    check("the capture is still stored in captures/ (the media library keeps working)",
      newly.length === 1, { captures: newly });

    const px = await review.webContents.executeJavaScript(`(function(){
      const img = document.getElementById('shot');
      return {
        src: img ? img.getAttribute('src') : null,
        w: img ? img.naturalWidth : 0,
        h: img ? img.naturalHeight : 0,
        meta: (document.getElementById('meta') || {}).textContent || '',
        download: !!document.getElementById('btnDownload')
      };
    })()`);
    check("the review really decoded the screenshot (160×120), not a broken image",
      px.w === 160 && px.h === 120, px);
    check("the image comes from the app's own local-file store",
      String(px.src || "").startsWith("local-file://"), { src: px.src });
    check("the card names the file and its size",
      /160×120/.test(px.meta) && /shot\.png/.test(px.meta), { meta: px.meta });
    check("the file is named day-month-year_hour-minute-second-shot.png",
      /^\d{2}-\d{2}-\d{4}_\d{2}-\d{2}-\d{2}-shot\.png$/.test(newly[0] || ""), { name: newly[0] });
    check("the Download button exists on the card", px.download === true);

    const toastShown = await main.webContents.executeJavaScript(
      "(function(){ const t = document.getElementById('toast'); return t ? t.classList.contains('show') : null; })()"
    ).catch(() => null);
    check("no redundant \"Screenshot saved\" toast — the card is the feedback",
      toastShown === false, { toastShown });

    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const rb = review.getBounds();
    check("the card is on top, out of the taskbar, and fits the screen",
      review.isAlwaysOnTop() === true && review.isVisible() === true &&
      rb.width <= wa.width + 1 && rb.height <= wa.height + 1 &&
      rb.x >= wa.x - 2 && rb.y >= wa.y - 2,
      {
        bounds: rb, workArea: { x: wa.x, y: wa.y, w: wa.width, h: wa.height },
        alwaysOnTop: review.isAlwaysOnTop(), visible: review.isVisible()
      });

    /* ---- 1b. minimize collapses the card to its title bar --------------- */
    const full = review.getBounds();
    const clickMin = () => review.webContents.executeJavaScript("document.getElementById('btnMin').click()");
    await clickMin();
    const collapsed = await waitFor(() => {
      const b = review.getBounds();
      return b.height < full.height - 40 ? b : null;
    }, 20, 150);
    const miniDom = await review.webContents.executeJavaScript(`(function(){
      const stage = document.querySelector('.stage'), foot = document.querySelector('footer');
      const card = document.querySelector('.card');
      const bar = document.getElementById('bar');
      return {
        card: card ? Math.round(card.getBoundingClientRect().height) : -1,
        stage: stage ? getComputedStyle(stage).display : '?',
        footer: foot ? getComputedStyle(foot).display : '?',
        bar: bar ? Math.round(bar.getBoundingClientRect().height) : -1
      };
    })()`);
    check("the minimize button collapses the card down to its title bar",
      !!collapsed && collapsed.width === full.width &&
      miniDom.stage === "none" && miniDom.footer === "none" && miniDom.bar > 10 &&
      miniDom.card <= collapsed.height + 1,
      { collapsed, miniDom });
    await clickMin();
    const back = await waitFor(() => {
      const b = review.getBounds();
      return b.height === full.height ? b : null;
    }, 20, 150);
    check("pressing it again brings the whole card back exactly where it was",
      !!back && back.x === full.x && back.y === full.y &&
      back.width === full.width && back.height === full.height,
      { full, back });

    /* ---- 2. one click → a real file in Downloads ------------------------ */
    const t0 = downloads();
    await review.webContents.executeJavaScript("document.getElementById('btnDownload').click()");
    const saved = await waitFor(() => {
      const now = downloads().filter(n => !t0.includes(n));
      return now.length ? now[0] : null;
    }, 25, 200);
    const savedPath = saved ? path.join(DOWNLOADS, saved) : null;
    const bytes = savedPath && fs.existsSync(savedPath) ? fs.readFileSync(savedPath) : null;
    check("Download writes the PNG straight into the Downloads folder (one click, no dialog)",
      !!bytes && bytes.length > 1000 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
      { saved, bytes: bytes ? bytes.length : 0 });
    const src = CAPTURES && newly.length ? path.join(CAPTURES, newly[0]) : null;
    check("the downloaded copy is byte-identical to the stored capture",
      !!bytes && !!src && fs.existsSync(src) && Buffer.compare(bytes, fs.readFileSync(src)) === 0,
      { saved, src: src && path.basename(src) });
    const afterDl = await review.webContents.executeJavaScript("document.getElementById('status').textContent");
    check("the card says where the file went", /Saved to .+\.png$/i.test(afterDl), { status: afterDl });

    /* ---- 3. Copy → clipboard ------------------------------------------- */
    await review.webContents.executeJavaScript("document.getElementById('btnCopy').click()");
    await wait(600);
    const clip = clipboard.readImage();
    const cs = clip.getSize();
    check("Copy puts the image on the clipboard", !clip.isEmpty() && cs.width === 160 && cs.height === 120,
      { size: cs, empty: clip.isEmpty() });
    const clipFormats = clipboard.availableFormats();
    check("the clipboard really carries image/png — what a page, a document or a chat box pastes",
      clipFormats.includes("image/png"), { formats: clipFormats });

    /* ---- 3b. the note is printed into the picture ----------------------- */
    const pristine = fs.existsSync(src) ? fs.readFileSync(src) : null;
    await typeNote(review, "Check the header with An - from the review card");
    const grown = await waitFor(() => {
      try {
        const b = fs.readFileSync(src);
        return pristine && b.length > pristine.length ? b : null;
      } catch { return null; }
    }, 30, 200);
    check("typing a note prints it into the stored capture (the picture grows by the caption strip)",
      !!grown && grown.length > (pristine ? pristine.length : 0),
      { before: pristine ? pristine.length : 0, after: grown ? grown.length : 0 });
    const ink = captionInk(src, 120);
    check("the note's letters are really in the pixels (text ink below the shot)",
      ink > 150, { inkPixels: ink });
    const noteCard = await review.webContents.executeJavaScript(`(function(){
      const im = document.getElementById('shot');
      return {
        src: im ? im.getAttribute('src') : '',
        h: im ? im.naturalHeight : 0,
        meta: (document.getElementById('meta') || {}).textContent || '',
        status: (document.getElementById('status') || {}).textContent || ''
      };
    })()`);
    check("the card shows the annotated picture itself, not an overlay on top of it",
      String(noteCard.src || "").startsWith("data:image/png") && noteCard.h > 120, noteCard);
    check("the card says the note is on the picture and reports the new size",
      /Note printed/.test(noteCard.status) && /160×/.test(noteCard.meta), noteCard);

    const t1 = downloads();
    await review.webContents.executeJavaScript("document.getElementById('btnDownload').click()");
    const saved2 = await waitFor(() => {
      const now = downloads().filter(n => !t1.includes(n));
      return now.length ? now[0] : null;
    }, 25, 200);
    check("Download afterwards hands out the annotated picture (byte for byte what is stored)",
      !!saved2 && Buffer.compare(fs.readFileSync(path.join(DOWNLOADS, saved2)), fs.readFileSync(src)) === 0,
      { saved2 });

    await review.webContents.executeJavaScript(`(function(){
      const n = document.getElementById('note');
      if (n) { n.value = ''; n.dispatchEvent(new Event('input')); }
    })()`);
    const restored = await waitFor(() => {
      try {
        const b = fs.readFileSync(src);
        return pristine && Buffer.compare(b, pristine) === 0 ? b : null;
      } catch { return null; }
    }, 30, 200);
    check("clearing the note puts the pristine shot back on disk, byte for byte",
      !!restored, { restoredBytes: restored ? restored.length : 0 });

    /* ---- 4. a second shot replaces the card, never stacks it ----------- */
    const second = await shoot(main);
    check("a new shot closes the previous review card first (it can never be inside the new picture)",
      !!second.review && review.isDestroyed() === true,
      { destroyed: review.isDestroyed(), reviews: windows().filter(w => { try { return w.webContents.getURL().includes("review.html"); } catch { return false; } }).length });
    const review2 = second.review;
    madeCaptures = caps().filter(n => !before.includes(n));
    check("the new capture is on disk and the card points at it", madeCaptures.length === 2, { captures: madeCaptures });

    /* ---- 5. Delete throws the capture away ----------------------------- */
    const doomed = madeCaptures[1];
    const galleryOpen = await main.webContents.executeJavaScript(`(function(){
      const p = document.getElementById('mediaPanel');
      if (!p) return false;
      p.hidden = false;
      return true;
    })()`);
    check("the media library can be opened while the review card is up", galleryOpen === true);
    await review2.webContents.executeJavaScript("document.getElementById('btnDelete').click()");
    const gone = await waitFor(() => (fs.existsSync(path.join(CAPTURES, doomed)) ? null : true), 25, 200);
    check("Delete removes the capture from disk", gone === true, { deleted: doomed });
    const closed = await waitFor(() => (findReview() ? null : true), 25, 200);
    check("Delete closes the review card", closed === true);
    await wait(500); // let the gallery refresh + teardown settle
    const stray = windows().filter(w => w !== findMain()).map(w => { try { return w.webContents.getURL().split("/").pop(); } catch { return "?"; } });
    check("nothing is left behind on screen afterwards", stray.length === 0, stray);
  } catch (e) {
    console.log("EXC " + ((e && e.stack) || e));
    failed = true;
  } finally {
    clearTimeout(guard);
    /* Leave no test artifacts: the captures this run made and the scratch
       Downloads folder. */
    try {
      const left = caps().filter(n => !(before || []).includes(n));
      left.forEach(n => { try { fs.unlinkSync(path.join(CAPTURES, n)); } catch {} });
      fs.rmSync(DOWNLOADS, { recursive: true, force: true });
    } catch {}
    console.log("RESULT " + (failed ? "FAIL" : "PASS"));
    await wait(400);
    app.exit(failed ? 1 : 0);
  }
});
