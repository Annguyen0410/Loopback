/**
 * Fullscreen screenshot overlay: drag a rectangle over the frozen screen.
 * Selection is reported in image-pixel coordinates (main crops NativeImage).
 */
(function () {
  const q = new URLSearchParams(location.search);
  /* The frozen screen's pixel size arrives with `shot:ready` — this page is
     built in parallel with the screen grab, so its size is not known yet when
     it loads. The display bounds from the query stay as a fallback.
     These are `let` on purpose: pxScale() and the full-screen button read them. */
  let imgW = Number(q.get("imgW")) || Number(q.get("w")) || 1;
  let imgH = Number(q.get("imgH")) || Number(q.get("h")) || 1;

  /** Overlay CSS pixels → source image pixels (HiDPI / multi-monitor).
   *  The frozen screen is stretched to fill the page (object-fit:fill at
   *  100%), and the overlay window cannot always occupy the whole display
   *  (Windows clamps a frameless window), so the mapping has to use the REAL
   *  paint area. The old code divided by the requested display size from the
   *  query string: on a clamped/hi-DPI window that offset the crop, and when
   *  it drifted far enough `shot:done` rejected the selection — a screenshot
   *  that silently saved nothing. */
  function pxScale() {
    return {
      x: imgW / Math.max(1, window.innerWidth),
      y: imgH / Math.max(1, window.innerHeight)
    };
  }

  const img = document.getElementById("shotImg");
  const sel = document.getElementById("sel");
  const dims = document.getElementById("dims");
  let start = null;
  let dragging = false;

  function showSel(x, y, w, h) {
    sel.classList.add("on");
    sel.style.left = x + "px";
    sel.style.top = y + "px";
    sel.style.width = w + "px";
    sel.style.height = h + "px";
    const s = pxScale();
    dims.textContent = Math.round(w * s.x) + "×" + Math.round(h * s.y);
  }

  function hideSel() {
    sel.classList.remove("on");
    dims.textContent = "—";
  }

  let shotData = null;
  /* Failsafe: this overlay is a full-screen opaque window. If the frozen screen
     arrives but never decodes, close it — a black screen the user cannot get
     rid of is far worse than a failed screenshot. The clock starts when the
     image is actually here: the page is built while the screen grab runs, so
     waiting for `shot:ready` can legitimately take seconds. */
  let failsafe = null;
  /* The frozen screen is only painted once the browser has the decoded bitmap,
     and main holds the window back until then (`shot:painted`). Showing the
     picker earlier meant a black full-screen window that swallowed clicks for a
     second or two — indistinguishable from a hung app. */
  function announcePainted() {
    try { window.shot.painted(); } catch {}
  }
  /* Announced straight from `load`, not from requestAnimationFrame: a window
     main has not shown yet is a hidden window, and Chromium pauses rAF there. */
  img.addEventListener("load", announcePainted);

  window.shot.ready(d => {
    if (!d || !d.dataUrl) return;
    if (Number(d.imgW) > 0) imgW = Number(d.imgW);
    if (Number(d.imgH) > 0) imgH = Number(d.imgH);
    shotData = d.dataUrl;
    clearTimeout(failsafe);
    failsafe = setTimeout(() => {
      if (!img.complete) { try { window.shot.cancel(); } catch {} }
    }, 2500);
    img.src = d.dataUrl;
    if (img.complete) announcePainted(); // already decoded (cached)
  });
  img.addEventListener("error", () => { try { window.shot.cancel(); } catch {} });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); window.shot.cancel(); }
  });

  document.getElementById("btnCancel").addEventListener("click", e => {
    e.stopPropagation();
    window.shot.cancel();
  });

  document.getElementById("btnFull").addEventListener("click", e => {
    e.stopPropagation();
    window.shot.done({ x: 0, y: 0, w: imgW, h: imgH });
  });

  document.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    if (!shotData) return; // image not ready yet
    // Ignore chrome buttons — they handle their own click.
    if (e.target.closest && e.target.closest("#bar")) return;
    dragging = true;
    start = { x: e.clientX, y: e.clientY };
    try { document.body.setPointerCapture(e.pointerId); } catch {}
    showSel(start.x, start.y, 0, 0);
  });

  document.addEventListener("pointermove", e => {
    if (!dragging || !start) return;
    const x = Math.min(start.x, e.clientX);
    const y = Math.min(start.y, e.clientY);
    const w = Math.abs(e.clientX - start.x);
    const h = Math.abs(e.clientY - start.y);
    showSel(x, y, w, h);
  });

  document.addEventListener("pointerup", e => {
    if (!dragging || !start) return;
    dragging = false;
    const x = Math.min(start.x, e.clientX);
    const y = Math.min(start.y, e.clientY);
    const w = Math.abs(e.clientX - start.x);
    const h = Math.abs(e.clientY - start.y);
    start = null;
    if (w < 4 || h < 4) { hideSel(); return; } // treated as cancel-click
    const s = pxScale();
    window.shot.done({
      x: Math.round(x * s.x),
      y: Math.round(y * s.y),
      w: Math.round(w * s.x),
      h: Math.round(h * s.y)
    });
  });
})();
