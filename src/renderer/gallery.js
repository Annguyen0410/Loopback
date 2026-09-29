/**
 * Media library panel: screenshots + screen recordings stored in
 * userData/captures — preview, download, reveal, delete.
 */

import { $ } from "./dom.js";
import { toast } from "./toast.js";
import { confirmDialog } from "./dialog.js";
import { ensureRoomForPanel } from "./pip.js";

let items = [];
let filter = "all";

function fmtSize(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    });
  } catch { return ""; }
}

function fileUrl(name) {
  if (window.api && window.api.fileUrl) return window.api.fileUrl(name);
  return "local-file:///" + encodeURIComponent(name);
}

function filtered() {
  if (filter === "all") return items;
  return items.filter(i => i.kind === filter);
}

function renderGrid() {
  const grid = $("mediaGrid");
  const empty = $("mediaEmpty");
  if (!grid) return;
  const list = filtered();
  grid.innerHTML = "";
  if (empty) empty.hidden = list.length > 0;

  list.forEach(item => {
    const card = document.createElement("div");
    card.className = "media-card";
    card.dataset.name = item.name;

    const thumb = document.createElement("div");
    thumb.className = "media-thumb";
    if (item.kind === "image") {
      const im = document.createElement("img");
      im.loading = "lazy";
      im.alt = item.name;
      im.src = fileUrl(item.name);
      thumb.append(im);
    } else {
      thumb.classList.add("video");
      thumb.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
        '<span class="media-badge">REC</span>';
      const vid = document.createElement("video");
      vid.preload = "metadata";
      vid.muted = true;
      vid.playsInline = true;
      vid.src = fileUrl(item.name);
      thumb.prepend(vid);
    }

    const meta = document.createElement("div");
    meta.className = "media-meta";
    meta.innerHTML =
      '<div class="media-name" title="' + item.name.replace(/"/g, "&quot;") + '">' + item.name + "</div>" +
      '<div class="media-sub">' + fmtSize(item.size) + " · " + fmtTime(item.mtime) + "</div>";

    const actions = document.createElement("div");
    actions.className = "media-actions";

    const btnDl = document.createElement("button");
    btnDl.type = "button";
    btnDl.title = "Download";
    btnDl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    btnDl.addEventListener("click", async e => {
      e.stopPropagation();
      const r = await window.api.capture.download(item.name);
      if (r && r.ok) toast("Saved: " + r.path);
      else if (r && !r.canceled) toast("Download failed");
    });

    const btnReveal = document.createElement("button");
    btnReveal.type = "button";
    btnReveal.title = "Show in folder";
    btnReveal.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>';
    btnReveal.addEventListener("click", e => {
      e.stopPropagation();
      window.api.capture.reveal(item.name);
    });

    const btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.title = "Delete";
    btnDel.className = "danger";
    btnDel.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
    btnDel.addEventListener("click", async e => {
      e.stopPropagation();
      const ok = await confirmDialog({
        title: "Delete capture?",
        message: "Remove “" + item.name + "” from the media library?",
        okText: "Delete"
      });
      if (!ok) return;
      await window.api.capture.remove(item.name);
      toast("Deleted");
      await refresh();
    });

    actions.append(btnDl, btnReveal, btnDel);
    card.append(thumb, meta, actions);

    // Click card → simple preview overlay
    card.addEventListener("click", () => preview(item));
    grid.append(card);
  });
}

function preview(item) {
  const ov = $("mediaPreview");
  const body = $("mediaPreviewBody");
  const title = $("mediaPreviewTitle");
  if (!ov || !body) return;
  if (title) title.textContent = item.name;
  body.innerHTML = "";
  if (item.kind === "image") {
    const im = document.createElement("img");
    im.src = fileUrl(item.name);
    im.alt = item.name;
    body.append(im);
  } else {
    const vid = document.createElement("video");
    vid.src = fileUrl(item.name);
    vid.controls = true;
    vid.autoplay = true;
    vid.playsInline = true;
    body.append(vid);
  }
  ov.hidden = false;
}

async function refresh() {
  if (!window.api || !window.api.capture) return;
  try {
    items = (await window.api.capture.list()) || [];
  } catch { items = []; }
  renderGrid();
}

export function openGallery() {
  // The media panel is wider than the collapsed bubble — grow it first.
  ensureRoomForPanel();
  const p = $("mediaPanel");
  if (p) p.hidden = false;
  refresh();
}

export function closeGallery() {
  const p = $("mediaPanel");
  if (p) p.hidden = true;
  const ov = $("mediaPreview");
  if (ov) ov.hidden = true;
  const body = $("mediaPreviewBody");
  if (body) {
    body.querySelectorAll("video").forEach(v => { try { v.pause(); } catch {} });
    body.innerHTML = "";
  }
}

export function toggleGallery() {
  const p = $("mediaPanel");
  if (p && !p.hidden) closeGallery();
  else openGallery();
}

export function initGallery() {
  document.querySelectorAll('[data-cap="media"]').forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      toggleGallery();
    });
  });

  const btnClose = $("btnCloseMedia");
  if (btnClose) btnClose.addEventListener("click", closeGallery);

  const btnFolder = $("btnMediaFolder");
  if (btnFolder) btnFolder.addEventListener("click", () => {
    if (window.api && window.api.capture) window.api.capture.openFolder();
  });

  const tabs = $("mediaTabs");
  if (tabs) tabs.addEventListener("click", e => {
    const b = e.target.closest(".seg-btn");
    if (!b) return;
    filter = b.dataset.filter || "all";
    tabs.querySelectorAll(".seg-btn").forEach(x => x.classList.toggle("active", x === b));
    renderGrid();
  });

  const prevClose = $("mediaPreviewClose");
  if (prevClose) prevClose.addEventListener("click", e => {
    e.stopPropagation();
    const ov = $("mediaPreview");
    if (ov) ov.hidden = true;
    const body = $("mediaPreviewBody");
    if (body) {
      body.querySelectorAll("video").forEach(v => { try { v.pause(); } catch {} });
      body.innerHTML = "";
    }
  });

  const prevOv = $("mediaPreview");
  if (prevOv) prevOv.addEventListener("click", e => {
    if (e.target === prevOv) {
      prevOv.hidden = true;
      const body = $("mediaPreviewBody");
      if (body) body.innerHTML = "";
    }
  });

  if (window.api && window.api.capture && window.api.capture.onSaved) {
    window.api.capture.onSaved(() => {
      const p = $("mediaPanel");
      if (p && !p.hidden) refresh();
    });
  }
}
