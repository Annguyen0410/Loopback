/**
 * Context menu, reaction picker, edit modal, pinned-bar, search,
 * and image-download helper for the lightbox.
 */

import { state, ui, messagesFor } from "./state.js";
import { $, placePopup } from "./dom.js";
import { plainText, fold } from "./utils.js";
import { toast } from "./toast.js";
import { findMsg, render, save, deleteMessage } from "./messages.js";
import { markRow, flashMessage } from "./search.js";

/* ---------- Context menu ---------- */

/* The message row the open menu belongs to (so it can follow a scroll). */
let ctxAnchorRow = null;

/** The visible (not filtered-out) rows of a floating menu. */
function menuItems(menu) {
  return [...menu.querySelectorAll("li")].filter(li =>
    !li.classList.contains("ctx-sep") && li.style.display !== "none" && !li.hidden
  );
}

function showItem(menu, action, on) {
  const li = menu.querySelector('[data-action="' + action + '"]');
  if (li) li.style.display = on ? "" : "none";
}

function setItemLabel(menu, action, text) {
  const li = menu.querySelector('[data-action="' + action + '"]');
  if (!li) return;
  // Never blow away the icon: only the caption span carries the text.
  const label = li.querySelector(".ctx-label") || li;
  label.textContent = text;
}

function focusItem(menu, idx) {
  const items = menuItems(menu);
  items.forEach(li => li.classList.remove("focused"));
  if (!idx && idx !== 0) return;
  if (idx < 0) idx = items.length - 1;
  if (idx >= items.length) idx = 0;
  const li = items[idx];
  if (li) li.classList.add("focused");
}

/**
 * Open the message menu.
 * Positioned from the ⋯ button it was clicked from (or the row for a
 * right-click), measured after the items are filtered, so it always stays
 * fully inside the window instead of being cut off at an edge.
 */
export function showCtxMenu(e, msgId) {
  e.preventDefault();
  ui.ctxTarget = msgId;
  const msg = findMsg(msgId);
  const menu = $("ctxMenu");
  if (!menu) return;
  ctxAnchorRow = null;

  const hasText = !!(msg && msg.text && !msg.deleted);
  const hasFiles = !!(msg && msg.files && msg.files.length && !msg.deleted);
  const target = e.target && e.target.closest ? e.target.closest(".msg-hover-btn") : null;
  const row = document.querySelector('.msg-row[data-id="' + msgId + '"]');

  // Keep the row's hover tools open while its menu is up, so the menu is
  // clearly attached to the message it acts on.
  document.querySelectorAll(".msg-row.actions-visible").forEach(r => { if (r !== row) r.classList.remove("actions-visible"); });
  if (row) row.classList.add("actions-visible");

  ctxAnchorRow = row;

  // Unhide first, then fill in the items, then measure + place.
  menu.hidden = false;
  menu.scrollTop = 0;
  focusItem(menu, null);
  showItem(menu, "reply", hasText);
  showItem(menu, "copy", hasText);
  showItem(menu, "copyMd", hasText);
  showItem(menu, "save", hasFiles);
  showItem(menu, "edit", hasText);
  // These always apply (also to a deleted tombstone).
  showItem(menu, "react", true);
  showItem(menu, "pin", true);
  showItem(menu, "delete", true);
  setItemLabel(menu, "pin", msg && msg.pinned ? "Unpin" : "Pin");
  const sep = menu.querySelector(".ctx-sep");
  if (sep) {
    const afterSep = menuItems(menu).indexOf(menu.querySelector('[data-action="delete"]'));
    sep.style.display = afterSep >= 0 ? "" : "none";
  }

  placePopup(menu, target
    ? { anchor: target.getBoundingClientRect(), gap: 6 }
    : { x: e.clientX, y: e.clientY });
}

export function closeCtxMenu() {
  const menu = $("ctxMenu");
  if (menu) {
    menu.hidden = true;
    menuItems(menu).forEach(li => li.classList.remove("focused"));
  }
  ctxAnchorRow = null;
  document.querySelectorAll(".msg-row.actions-visible").forEach(r => r.classList.remove("actions-visible"));
}

/* The menu is fixed, so while the conversation scrolls (the app's own
   smooth auto-scroll to the newest message included) it follows the message
   it belongs to — and closes once that message has scrolled out of view. */
function followCtxMenu() {
  const menu = $("ctxMenu");
  if (!menu || menu.hidden) return;
  const row = ctxAnchorRow && ctxAnchorRow.isConnected ? ctxAnchorRow : null;
  if (!row) { closeCtxMenu(); return; }
  const list = $("messages");
  const rowRect = row.getBoundingClientRect();
  const listRect = list ? list.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  if (rowRect.bottom < listRect.top || rowRect.top > listRect.bottom) { closeCtxMenu(); return; }
  const tools = row.querySelector(".msg-hover-actions") || row;
  placePopup(menu, { anchor: tools.getBoundingClientRect(), gap: 6 });
}

export function initContextMenu() {
  const ctxMenu = $("ctxMenu");
  if (!ctxMenu) return;

  // Stay glued to the message while the conversation scrolls or resizes.
  const messagesEl = $("messages");
  if (messagesEl) messagesEl.addEventListener("scroll", followCtxMenu, { passive: true });
  window.addEventListener("resize", followCtxMenu);
  window.addEventListener("blur", closeCtxMenu);

  // Mouse hover takes over the keyboard highlight.
  ctxMenu.addEventListener("mouseover", e => {
    const li = e.target.closest("li");
    if (!li) return;
    ctxMenu.querySelectorAll("li.focused").forEach(x => { if (x !== li) x.classList.remove("focused"); });
  });

  document.addEventListener("keydown", e => {
    if (ctxMenu.hidden) return;
    const t = e.target;
    if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return;
    const items = menuItems(ctxMenu);
    if (e.key === "Escape") { e.preventDefault(); closeCtxMenu(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      const at = items.findIndex(li => li.classList.contains("focused"));
      focusItem(ctxMenu, e.key === "ArrowDown" ? at + 1 : at - 1);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      const cur = ctxMenu.querySelector("li.focused");
      if (!cur) return;
      e.preventDefault();
      cur.click();
    }
  });

  ctxMenu.addEventListener("click", async function (e) {
    // Don't let the global click handler close the reaction picker
    // we may open right below when "React" is chosen.
    e.stopPropagation();
    const li = e.target.closest("li");
    const action = li ? li.dataset.action : null;
    if (!action || !ui.ctxTarget) return;
    const msg = findMsg(ui.ctxTarget);
    if (!msg) return;
    closeCtxMenu();
    if (action === "react") { showReactionPicker(e, ui.ctxTarget); return; }
    if (action === "copy") { try { navigator.clipboard.writeText(plainText(msg.text)); } catch {} toast("Copied plain text"); return; }
    if (action === "copyMd") { try { navigator.clipboard.writeText(msg.text || ""); } catch {} toast("Copied markdown"); return; }
    if (action === "pin") { msg.pinned = !msg.pinned; render(false); await save(); toast(msg.pinned ? "Pinned" : "Unpinned"); return; }
    if (action === "edit") { openEdit(msg); return; }
    if (action === "delete") { await deleteMessage(msg); toast("Deleted"); return; }
    if (action === "save") {
      const first = (msg.files || [])[0];
      if (first) { window.api.revealFile(first.storedName); toast("Saved — showing in folder"); }
      return;
    }
    if (action === "reply") {
      const inp = $("messageInput");
      if (inp) { inp.value = "> " + (msg.text || "").split("\n")[0] + "\n"; inp.focus(); }
      return;
    }
  });
}

/* ---------- Reactions ---------- */

export function showReactionPicker(e, msgId) {
  ui.ctxTarget = msgId;
  const picker = $("reactionPicker");
  if (!picker) return;
  picker.hidden = false;
  // Anchor to the message row so the picker sits above its bubble,
  // clamped to stay fully inside the viewport.
  const row = document.querySelector('.msg-row[data-id="' + msgId + '"]') || e.target.closest(".msg-row");
  const rect = (row || e.target).getBoundingClientRect();
  const pw = picker.offsetWidth || 200;
  const ph = picker.offsetHeight || 40;
  picker.style.left = Math.max(8, Math.min(rect.left + 20, window.innerWidth - pw - 8)) + "px";
  // Sit above the bubble when there is room, otherwise flip below it so the
  // picker never jumps to a far-away corner of the screen.
  const above = rect.top - ph - 10;
  picker.style.top = (above >= 8 ? above : Math.min(rect.bottom + 10, window.innerHeight - ph - 8)) + "px";
}

export async function toggleReaction(msgId, emoji) {
  const msg = findMsg(msgId);
  if (!msg) return;
  if (!msg.reactions) msg.reactions = {};
  const adding = !msg.reactions[emoji];
  if (msg.reactions[emoji]) delete msg.reactions[emoji];
  else msg.reactions[emoji] = (msg.reactions[emoji] || 0) + 1;
  if (adding) flyEmoji(emoji, msgId);
  render(false);
  await save();
}

/* A little emoji that flies up from the bubble when a reaction lands. */
function flyEmoji(emoji, msgId) {
  const row = document.querySelector('.msg-row[data-id="' + msgId + '"]');
  if (!row) return;
  const rect = row.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "fly-emoji";
  el.textContent = emoji;
  el.style.left = (rect.left + rect.width / 2) + "px";
  el.style.top = (rect.top + 6) + "px";
  document.body.append(el);
  setTimeout(() => el.remove(), 900);
}

export function initReactionPicker() {
  const reactionPicker = $("reactionPicker");
  if (!reactionPicker) return;
  reactionPicker.addEventListener("click", async function (e) {
    const btn = e.target.closest(".reaction-btn");
    if (!btn || !ui.ctxTarget) return;
    await toggleReaction(ui.ctxTarget, btn.dataset.emoji);
    reactionPicker.hidden = true;
  });
}

/* ---------- Edit modal ---------- */

function openEdit(msg) {
  ui.editingId = msg.id;
  const inp = $("editInput");
  if (inp) inp.value = msg.text || "";
  const modal = $("editModal");
  if (modal) modal.hidden = false;
  if (inp) inp.focus();
}

export function initEditModal() {
  const btnCancelEdit = $("btnCancelEdit");
  if (btnCancelEdit) btnCancelEdit.addEventListener("click", () => { $("editModal").hidden = true; ui.editingId = null; });
  const btnSaveEdit = $("btnSaveEdit");
  if (btnSaveEdit) btnSaveEdit.addEventListener("click", async () => {
    if (!ui.editingId) return;
    const msg = findMsg(ui.editingId);
    if (msg) { msg.text = $("editInput").value.trim(); msg.edited = true; }
    $("editModal").hidden = true;
    ui.editingId = null;
    render(false);
    await save();
    toast("Edited");
  });
}

/* ---------- Pinned bar ---------- */

export function initPinnedBar() {
  const btnUnpin = $("btnUnpin");
  if (!btnUnpin) return;
  btnUnpin.addEventListener("click", async () => {
    const pinned = messagesFor(state.activeChatId).filter(m => m.pinned && !m.deleted);
    if (pinned.length) { pinned[pinned.length - 1].pinned = false; render(false); await save(); }
  });
}

/* ---------- In-conversation search ---------- */

export function initMsgSearch() {
  const btnSearchMsgs = $("btnSearchMsgs");
  if (btnSearchMsgs) btnSearchMsgs.addEventListener("click", () => {
    const bar = $("searchBar");
    if (!bar) return;
    bar.hidden = !bar.hidden;
    if (!bar.hidden) $("msgSearchInput").focus();
  });

  const btnCloseSearch = $("btnCloseSearch");
  if (btnCloseSearch) btnCloseSearch.addEventListener("click", () => {
    $("searchBar").hidden = true;
    ui.searchHits = []; ui.searchIdx = -1;
    render(false);
  });

  const msgSearchInput = $("msgSearchInput");
  if (msgSearchInput) msgSearchInput.addEventListener("input", () => {
    // Diacritic-insensitive, same matching rules as the global search.
    const q = fold(msgSearchInput.value).trim();
    ui.searchHits = []; ui.searchIdx = -1;
    if (!q) { $("searchCount").textContent = ""; render(false); return; }
    messagesFor(state.activeChatId).forEach((m, i) => {
      if (m.text && fold(m.text).includes(q)) ui.searchHits.push(i);
    });
    $("searchCount").textContent = ui.searchHits.length ? "1/" + ui.searchHits.length : "0 results";
    render(false);
    if (ui.searchHits.length) { ui.searchIdx = 0; highlightHit(); }
  });

  const btnNextSearch = $("btnNextSearch");
  if (btnNextSearch) btnNextSearch.addEventListener("click", searchNext);
  const btnPrevSearch = $("btnPrevSearch");
  if (btnPrevSearch) btnPrevSearch.addEventListener("click", searchPrev);
  if (msgSearchInput) msgSearchInput.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); searchNext(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); searchPrev(); }
  });

  function searchNext() {
    if (ui.searchHits.length) { ui.searchIdx = (ui.searchIdx + 1) % ui.searchHits.length; highlightHit(); }
  }
  function searchPrev() {
    if (ui.searchHits.length) { ui.searchIdx = (ui.searchIdx - 1 + ui.searchHits.length) % ui.searchHits.length; highlightHit(); }
  }
}

function highlightHit() {
  const q = $("msgSearchInput").value.trim();
  if (!q) return;
  $("searchCount").textContent = (ui.searchIdx + 1) + "/" + ui.searchHits.length;
  document.querySelectorAll(".msg-row.search-active").forEach(r => r.classList.remove("search-active"));

  // Mark the matches without touching the rendered markdown markup
  // (Range-wrapped <mark>, never a rewritten innerHTML).
  const msgs = messagesFor(state.activeChatId);
  const hitIds = new Set(ui.searchHits.map(i => msgs[i] && msgs[i].id).filter(Boolean));
  const active = msgs[ui.searchHits[ui.searchIdx]];

  $("messages").querySelectorAll(".msg-row").forEach(row => {
    if (!hitIds.has(row.dataset.id)) return;
    if (active && row.dataset.id === active.id) {
      row.classList.add("search-active");
      flashMessage(active.id, q); // marks + scrolls the active hit
    } else {
      markRow(row, q);
    }
  });
}
