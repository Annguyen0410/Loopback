/* Screenshot review — the window that opens the moment a region screenshot is
 * taken. It exists so a screenshot ENDS with the image in front of you and a
 * Download button: no trip through the floating bubble into the media library
 * just to save a picture.
 *
 * Everything it can do lives in main (review:*): Download copies straight into
 * the Downloads folder (no dialog, no extra click), Copy puts the picture on
 * the clipboard as image/png so it pastes into a page, a document or a chat,
 * Save as… opens the picker, Show in folder reveals the stored copy in
 * captures/, Delete throws the capture away, and the note above the buttons is
 * printed INTO the picture (baked with a canvas, then stored, so the card, the
 * file and the media library all show the same thing).
 */
(function () {
  const q = new URLSearchParams(location.search);
  const name = q.get("name") || "";
  const fileSrc = window.review && window.review.fileUrl ? window.review.fileUrl(name) : "";

  const img = document.getElementById("shot");
  const meta = document.getElementById("meta");
  const status = document.getElementById("status");
  const note = document.getElementById("note");
  const btnMin = document.getElementById("btnMin");

  const w = q.get("w") || "?", h = q.get("h") || "?";
  let sizeBytes = Number(q.get("bytes")) || 0;

  function fmtSize(n) {
    const b = Number(n) || 0;
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + " KB";
    return (b / (1024 * 1024)).toFixed(1) + " MB";
  }

  /* The size grows when a note is printed under the picture, so the line is
     rebuilt from state instead of being set once. */
  function metaText() { return `${w}×${h} · ${fmtSize(sizeBytes)} · ${name}`; }
  meta.textContent = metaText();

  function say(text, kind) {
    status.textContent = text || "";
    status.className = kind || "";
  }

  /* One in-flight action at a time: a double click on Download must not write
     the file twice. */
  let busy = false;
  async function run(btn, fn) {
    if (busy) return;
    busy = true;
    if (btn) btn.classList.add("busy");
    try { await fn(); }
    catch (e) { say("Failed: " + ((e && e.message) || e), "err"); }
    finally {
      busy = false;
      if (btn) btn.classList.remove("busy");
    }
  }

  /* ---- the note, printed into the picture --------------------------------
     The pristine pixels come from the main process as bytes and are drawn from
     a same-origin blob: drawing the local-file:// image straight off the <img>
     TAINTS the canvas ("Tainted canvases may not be exported") and the note
     could never be encoded. They are kept in memory because the file on disk is
     exactly what the note replaces — that is what makes the note undoable. A
     note adds a caption strip under the picture, and that result is what gets
     stored, so Download, Copy, Save as… and the media library all hand out the
     annotated picture. */
  const NOTE_FONT = size => `600 ${size}px "Segoe UI", system-ui, -apple-system, sans-serif`;
  let baseCanvas = null;

  async function ensureBase() {
    if (baseCanvas) return baseCanvas;
    if (!window.review || !window.review.bytes) return null;
    let u8 = null;
    try { u8 = await window.review.bytes(); } catch { u8 = null; }
    if (!u8 || !u8.length) return null;
    const blob = new Blob([u8], { type: "image/png" });
    try {
      // An ImageBitmap decodes the bytes straight into a canvas-clean picture —
      // no URL, so not even the document's img-src CSP is in the way.
      const bitmap = typeof createImageBitmap === "function" ? await createImageBitmap(blob) : null;
      let source = bitmap, w = bitmap ? bitmap.width : 0, h = bitmap ? bitmap.height : 0;
      if (!source) {
        const url = URL.createObjectURL(blob);
        try {
          const probe = new Image();
          await new Promise((res, rej) => { probe.onload = res; probe.onerror = rej; probe.src = url; });
          source = probe; w = probe.naturalWidth; h = probe.naturalHeight;
        } finally { URL.revokeObjectURL(url); }   // the pixels are in the canvas below
      }
      if (!w || !h) return null;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(source, 0, 0);
      baseCanvas = c;
      return baseCanvas;
    } catch { return null; }
  }

  if (fileSrc) img.src = fileSrc;

  function bake(text) {
    if (!baseCanvas) return null;
    const pad = Math.max(10, Math.round(baseCanvas.width * 0.012));
    const fs = Math.min(30, Math.max(13, Math.round(baseCanvas.width / 44)));
    const lh = Math.round(fs * 1.4);
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = NOTE_FONT(fs);
    const maxW = Math.max(40, baseCanvas.width - pad * 2);
    const lines = [];
    let line = "";
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
      const next = line ? line + " " + word : word;
      if (line && probe.measureText(next).width > maxW) { lines.push(line); line = word; }
      else line = next;
      if (lines.length === 5) break;         // a note is a note, not an essay
    }
    if (line && lines.length < 6) lines.push(line);
    const rows = Math.max(1, lines.length);
    const strip = Math.round(pad * 1.5) * 2 + rows * lh;
    const out = document.createElement("canvas");
    out.width = baseCanvas.width;
    out.height = baseCanvas.height + strip;
    const g = out.getContext("2d");
    g.fillStyle = "#101215";
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(baseCanvas, 0, 0);
    g.fillStyle = "#f4f5f7";
    g.font = NOTE_FONT(fs);
    g.textBaseline = "top";
    lines.forEach((l, i) => g.fillText(l, pad, baseCanvas.height + Math.round(pad * 1.5) + i * lh));
    return out.toDataURL("image/png");
  }

  /* A data URL becomes bytes the main process can write to disk. */
  function bytesOf(dataUrl) {
    const bin = atob(String(dataUrl).slice(String(dataUrl).indexOf(",") + 1));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  async function applyNote() {
    if (!window.review || !window.review.annotate) return;
    const text = note.value.trim();
    let payload = { note: "" };
    if (text) {
      await ensureBase();
      const url = bake(text);
      if (!url) { say("The picture is still loading — try again in a moment", "err"); return; }
      img.src = url;                        // the card shows exactly what is being stored
      payload = { note: text, buffer: bytesOf(url) };
    } else if (fileSrc) {
      img.src = fileSrc;                    // cleared: back to the pristine shot
    }
    const r = await window.review.annotate(payload);
    if (r && r.ok) {
      sizeBytes = r.size;
      meta.textContent = metaText();
      say(text ? "Note printed on the picture" : "Note cleared", text ? "ok" : "");
    } else if (text) {
      say("Could not print the note" + (r && r.error ? ": " + r.error : ""), "err");
    }
  }

  let noteTimer = null;
  note.addEventListener("input", () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(applyNote, 300);
  });
  note.addEventListener("blur", () => { clearTimeout(noteTimer); applyNote(); });

  /* ---- minimize ---------------------------------------------------------
     A real minimize: the window drops to the taskbar, exactly like the main
     window does, and the taskbar button (or a click on it) brings the card back
     at the same size and place. The card keeps a taskbar button for that. */
  if (btnMin) btnMin.addEventListener("click", e => {
    e.stopPropagation();
    if (window.review && window.review.minimize) window.review.minimize();
  });

  document.getElementById("btnDownload").addEventListener("click", e => run(e.currentTarget, async () => {
    const r = await window.review.download();
    if (r && r.ok) say("Saved to " + r.path, "ok");
    else say("Download failed" + (r && r.error ? ": " + r.error : ""), "err");
  }));

  document.getElementById("btnCopy").addEventListener("click", e => run(e.currentTarget, async () => {
    const r = await window.review.copy();
    say(r && r.ok ? "Copied — press Ctrl+V in a page, a document or a chat" : "Copy failed",
      r && r.ok ? "ok" : "err");
  }));

  document.getElementById("btnSaveAs").addEventListener("click", e => run(e.currentTarget, async () => {
    const r = await window.review.saveAs();
    if (r && r.ok) say("Saved to " + r.path, "ok");
    else if (r && r.canceled) say("");            // the user backed out — not an error
    else say("Save failed" + (r && r.error ? ": " + r.error : ""), "err");
  }));

  document.getElementById("btnReveal").addEventListener("click", e => run(e.currentTarget, async () => {
    await window.review.reveal();
    say("Showing the stored copy");
  }));

  document.getElementById("btnDelete").addEventListener("click", e => run(e.currentTarget, async () => {
    const r = await window.review.remove();
    if (r && r.ok) { say("Deleted", "ok"); window.review.close(); }
    else say("Delete failed", "err");
  }));

  document.getElementById("btnClose").addEventListener("click", () => window.review.close());

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    // Escape in the note field puts the caret away instead of closing the card.
    if (document.activeElement === note) { note.blur(); return; }
    e.preventDefault();
    window.review.close();
  });

  /* Dragging: the window is frameless + transparent, so the header drives it
     through the same absolute-position IPC the floating bubble uses (native
     -webkit-app-region drag does nothing on a transparent window). */
  const bar = document.getElementById("bar");
  let drag = null;

  bar.addEventListener("pointerdown", async e => {
    if (e.button !== 0 || (e.target && e.target.closest && e.target.closest("button"))) return;
    e.preventDefault();
    const pos = await window.review.dragStart();
    if (!pos) return;
    drag = { id: e.pointerId, sx: e.screenX, sy: e.screenY, ox: pos.x, oy: pos.y };
    try { bar.setPointerCapture(e.pointerId); } catch {}
  });

  bar.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    window.review.dragTo({
      x: drag.ox + (e.screenX - drag.sx),
      y: drag.oy + (e.screenY - drag.sy)
    });
  });

  const endDrag = e => {
    if (!drag) return;
    if (e && e.pointerId != null && e.pointerId !== drag.id) return;
    try { bar.releasePointerCapture(drag.id); } catch {}
    drag = null;
  };
  bar.addEventListener("pointerup", endDrag);
  bar.addEventListener("pointercancel", endDrag);
})();
