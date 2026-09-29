/* Smoke test for captures (screenshots + screen recordings) being viewable:
 * the reported bug was that saved recordings "didn't play" — the local-file://
 * protocol only resolved files/ and voice/, never captures/, so every capture
 * 404'd in the media library.
 *
 *   1. a real MediaRecorder clip saved through the app's own IPC
 *   2. local-file:// serves it (200 + video/webm + accept-ranges)
 *   3. byte ranges answer 206 (Chromium needs this to seek/start playback)
 *   4. the media library lists it and the preview video really loads
 *
 * Run (close the app first — it holds the single-instance lock):
 *   npx electron captest.js
 * Set CAPTEST_USERDATA=<dir> to use a throwaway profile.
 */
const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, net } = require("electron");

if (process.env.CAPTEST_USERDATA) {
  fs.mkdirSync(process.env.CAPTEST_USERDATA, { recursive: true });
  app.setPath("userData", process.env.CAPTEST_USERDATA);
}

require("./main.js"); // real IPC handlers + the local-file protocol

const NAME = "captest-rec.webm";
const SHOT = "captest-shot.png";
const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
function check(name, cond, extra) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));
  if (!cond) failed = true;
}

const guard = setTimeout(() => {
  console.log("FAIL  timed out — if the app is already running, close it and re-run");
  cleanup();
  app.exit(1);
}, 150000);

function cleanup() {
  for (const n of [NAME, SHOT]) {
    try {
      const f = path.join(app.getPath("userData"), "captures", n);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {}
  }
}

app.whenReady().then(async () => {
  try {
    await wait(1500);
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getTitle() !== "Quick note");
    check("main window booted", !!win);
    if (!win) return;
    // A throttled/occluded window stops delivering animation frames, and the
    // canvas capture stream needs real paints.
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

    /* --- 1: record a real clip + a real screenshot through the app -------- */
    const rec = await run(`(async function(){
      const c = document.createElement('canvas');
      c.width = 160; c.height = 120;
      c.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.append(c);
      const ctx = c.getContext('2d');
      const stream = c.captureStream(25);
      const mime = ['video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 500000 } : undefined);
      const chunks = [];
      mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise(r => { mr.onstop = r; });
      mr.start();
      // Paint on animation frames — a canvas capture stream needs real paints.
      // The 250ms fallback keeps the test from hanging if frames are throttled.
      const frame = () => new Promise(r => {
        let done = false;
        const fin = () => { if (!done) { done = true; r(); } };
        requestAnimationFrame(() => setTimeout(fin, 40));
        setTimeout(fin, 250);
      });
      for (let i = 0; i < 20; i++) {
        await frame();
        ctx.fillStyle = i % 2 ? '#ff0044' : '#0044ff';
        ctx.fillRect(0, 0, 160, 120);
        ctx.fillStyle = '#fff';
        ctx.font = '16px sans-serif';
        ctx.fillText('frame ' + i, 10, 24);
      }
      await new Promise(r => setTimeout(r, 300));
      if (mr.state === 'recording') mr.requestData();
      mr.stop();
      await stopped;
      for (const t of stream.getTracks()) { try { t.stop(); } catch {} }
      const blob = new Blob(chunks, { type: 'video/webm' });
      const buf = await blob.arrayBuffer();
      const video = await window.api.capture.save(${JSON.stringify(NAME)}, buf);

      // …and a real PNG, so an image path is covered too.
      const shot = document.createElement('canvas');
      shot.width = 40; shot.height = 30;
      const sctx = shot.getContext('2d');
      sctx.fillStyle = '#00aa66'; sctx.fillRect(0, 0, 40, 30);
      const shotBlob = await new Promise(r => shot.toBlob(r, 'image/png'));
      const shotBuf = await shotBlob.arrayBuffer();
      const image = await window.api.capture.save(${JSON.stringify(SHOT)}, shotBuf);
      c.remove();
      return { video: video, videoSize: blob.size, chunks: chunks.length, image: image, imageSize: shotBlob.size, mime: mime };
    })()`);
    check("a real recording saves through the app",
      !!(rec.video && rec.video.ok) && rec.videoSize > 1000, rec);
    check("a real screenshot saves through the app",
      !!(rec.image && rec.image.ok) && rec.imageSize > 100, rec);

    /* --- 2 + 3: the protocol serves captures (renderer-side, like the UI) - */
    const url = "local-file:///" + SHOT;
    const full = await net.fetch(url);
    const fullBody = Buffer.from(await full.arrayBuffer());
    const ranged = await net.fetch(url, { headers: { Range: "bytes=0-99" } });
    const rangedBody = Buffer.from(await ranged.arrayBuffer());
    const missing = await net.fetch("local-file:///nope-does-not-exist.png");
    check("local-file serves a capture from captures/ (200 + image/png + accept-ranges)",
      full.status === 200 && full.headers.get("content-type") === "image/png" &&
      fullBody.length === rec.imageSize && full.headers.get("accept-ranges") === "bytes",
      { status: full.status, type: full.headers.get("content-type"), len: fullBody.length, size: rec.imageSize, acceptRanges: full.headers.get("accept-ranges") });
    check("byte ranges answer 206 with the right slice",
      ranged.status === 206 && rangedBody.length === 100 && rangedBody.equals(fullBody.subarray(0, 100)) &&
      new RegExp("^bytes 0-99/" + fullBody.length + "$").test(ranged.headers.get("content-range") || ""),
      { status: ranged.status, len: rangedBody.length, contentRange: ranged.headers.get("content-range") });
    check("unknown names still 404", missing.status === 404, { status: missing.status });

    const imgLoad = await run(`(async function(){
      const img = new Image();
      const ok = await new Promise(res => {
        img.onload = () => res(true);
        img.onerror = () => res(false);
        img.src = window.api.fileUrl(${JSON.stringify(SHOT)});
        setTimeout(() => res(false), 4000);
      });
      return { ok: ok, w: img.naturalWidth, h: img.naturalHeight, src: img.getAttribute('src') };
    })()`);
    check("an <img> served from captures/ renders in the renderer", imgLoad.ok === true && imgLoad.w === 40 && imgLoad.h === 30, imgLoad);

    /* --- 4: the media library lists them and the previews load ----------- */
    const lib = await run(`(async function(){
      const btn = document.querySelector('[data-cap="media"]');
      if (!btn) return { opened: false };
      btn.click();
      await new Promise(r => setTimeout(r, 800));
      const panel = document.getElementById('mediaPanel');
      const q = n => panel && panel.querySelector('.media-card[data-name="' + n + '"]');
      const shotCard = q(${JSON.stringify(SHOT)});
      const vidCard = q(${JSON.stringify(NAME)});
      const out = {
        opened: !!panel && !panel.hidden,
        shotCard: !!shotCard, vidCard: !!vidCard,
        thumbSrc: shotCard && shotCard.querySelector('img') ? shotCard.querySelector('img').getAttribute('src') : null,
        vidThumbSrc: vidCard && vidCard.querySelector('video') ? vidCard.querySelector('video').getAttribute('src') : null
      };
      if (!shotCard) return out;

      shotCard.click();
      const img = document.querySelector('#mediaPreviewBody img');
      out.previewImgW = img ? img.naturalWidth : 0;
      out.previewImgLoaded = !!img && await new Promise(res => {
        if (img.complete && img.naturalWidth) return res(true);
        img.addEventListener('load', () => res(true), { once: true });
        img.addEventListener('error', () => res(false), { once: true });
        setTimeout(() => res(false), 4000);
      });
      document.getElementById('mediaPreviewClose').click();

      if (vidCard) {
        vidCard.click();
        const v = document.querySelector('#mediaPreviewBody video');
        out.videoLoaded = !!v && await new Promise(res => {
          if (v.readyState >= 1) return res(true);
          const to = setTimeout(() => res(false), 6000);
          v.addEventListener('loadedmetadata', () => { clearTimeout(to); res(true); }, { once: true });
          v.addEventListener('error', () => { clearTimeout(to); res(false); }, { once: true });
        });
        out.videoError = v && v.error ? v.error.code : null;
        out.videoReady = v ? v.readyState : -1;
      }
      return out;
    })()`);
    check("media library lists both captures", lib.opened === true && lib.shotCard === true && lib.vidCard === true, lib);
    check("library previews point at local-file://",
      /^local-file:\/\//.test(lib.thumbSrc || "") && /^local-file:\/\//.test(lib.vidThumbSrc || ""),
      { thumbSrc: lib.thumbSrc, vidThumbSrc: lib.vidThumbSrc });
    check("screenshot preview renders (image served from captures/)", lib.previewImgLoaded === true && lib.previewImgW === 40, lib);
    check("recording preview is viewable", lib.videoLoaded === true && lib.videoError === null, lib);
    check("no renderer console errors", errors.length === 0, errors);
  } catch (e) {
    console.log("EXC " + ((e && e.stack) || e));
    failed = true;
  } finally {
    clearTimeout(guard);
    cleanup();
    await wait(200);
    app.exit(failed ? 1 : 0);
  }
});
