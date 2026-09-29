/**
 * Fullscreen screenshot overlay: drag a rectangle over the frozen screen.
 * Selection is reported in image-pixel coordinates (main crops NativeImage).
 */
(function () {
  const q = new URLSearchParams(location.search);
  const imgW = Number(q.get("imgW")) || Number(q.get("w")) || 1;
  const imgH = Number(q.get("imgH")) || Number(q.get("h")) || 1;

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
  /* Failsafe: this overlay is a full-screen opaque window. If the frozen
     screen never arrives (or fails to decode), close it — a black screen the
     user cannot get rid of is far worse than a failed screenshot. */
  const failsafe = setTimeout(() => {
    if (!shotData) { try { window.shot.cancel(); } catch {} }
  }, 2500);
  window.shot.ready(d => {
    if (d && d.dataUrl) {
      shotData = d.dataUrl;
      clearTimeout(failsafe);
      img.src = d.dataUrl;
    }
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
