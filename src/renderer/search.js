/**
 * Global search across EVERY chat (sidebar box, Ctrl+Shift+F).
 *
 * - matched on plain text (markdown stripped) plus attachment names
 * - diacritic-insensitive: "gio" finds "giờ", "cafe" finds "café"
 * - results render as snippets; clicking/Enter jumps to the message and
 *   flashes it inside its own chat
 *
 * The in-conversation search (`interactions.js`) reuses `markRow` /
 * `flashMessage` from here so both searches highlight the same way.
 */

import { state } from "./state.js";
import { $ } from "./dom.js";
import { fmtTime, fold, foldMap, plainText, avClass } from "./utils.js";
import { selectChat } from "./messages.js";
import { renderConvList } from "./sidebar.js";

const MAX_RESULTS = 80;
let items = [];      // flat list of message hits, in display order
let activeIdx = -1;  // keyboard-selected hit

/* ---------- matching ---------- */

/** Match `query` inside `text` (both folded). Returns original offsets or null. */
function findIn(text, q) {
  const src = String(text == null ? "" : text);
  const { text: folded, map } = foldMap(src);
  const idx = folded.indexOf(q);
  if (idx < 0) return null;
  const last = map[idx + q.length - 1];
  return { start: map[idx], end: (last == null ? src.length - 1 : last) + 1 };
}

/**
 * A window of text around the match, split into
 * { before, match, after } so the caller can build DOM safely.
 */
function snippet(text, q, padBefore, padAfter) {
  const src = String(text == null ? "" : text);
  const hit = findIn(src, q);
  if (!hit) return null;
  const start = Math.max(0, hit.start - (padBefore == null ? 34 : padBefore));
  const end = Math.min(src.length, hit.end + (padAfter == null ? 60 : padAfter));
  const flat = s => s.replace(/\s+/g, " ");
  return {
    before: (start > 0 ? "…" : "") + flat(src.slice(start, hit.start)),
    match: flat(src.slice(hit.start, hit.end)),
    after: flat(src.slice(hit.end, end)) + (end < src.length ? "…" : "")
  };
}

/** Every message (any chat) whose text or attachment names match, newest first. */
export function searchAll(rawQuery) {
  const q = fold(rawQuery).trim();
  if (!q) return [];
  const out = [];
  for (const msg of state.messages) {
    if (!msg || msg.deleted) continue;
    const body = plainText(msg.text || "");
    const names = (msg.files || []).map(f => f && f.name ? f.name : "").join(" · ");
    const hay = names ? body + "\n" + names : body;
    if (!hay) continue;
    const sn = snippet(hay, q);
    if (!sn) continue;
    const chat = state.chats.find(c => c.id === msg.chatId);
    if (!chat) continue;
    out.push({ chat, msg, snippet: sn });
  }
  out.sort((a, b) => b.msg.createdAt - a.msg.createdAt);
  return out;
}

/* ---------- highlighting (shared with in-conversation search) ---------- */

/**
 * Wrap every match of `query` inside a rendered row's bubble with <mark>.
 * Walks text nodes and uses Range.surroundContents so markdown markup
 * (code blocks, tables, lists, links…) is never destroyed.
 */
export function markRow(row, query) {
  const q = fold(query).trim();
  if (!q || !row) return 0;
  const bubble = row.querySelector(".bubble");
  if (!bubble) return 0;

  const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const p = node.parentElement;
      if (!p || p.closest("pre,code,mark,script,style,a")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  let count = 0;
  for (const node of nodes) {
    const text = node.nodeValue;
    const { text: folded, map } = foldMap(text);
    const ranges = [];
    let from = 0;
    for (;;) {
      const idx = folded.indexOf(q, from);
      if (idx < 0) break;
      const last = map[idx + q.length - 1];
      const s = map[idx];
      const e = (last == null ? text.length - 1 : last) + 1;
      if (e > s) ranges.push([s, e]);
      from = idx + q.length;
    }
    count += ranges.length;
    // Backwards: surrounding a later range keeps earlier offsets valid.
    for (let i = ranges.length - 1; i >= 0; i--) {
      const r = document.createRange();
      r.setStart(node, ranges[i][0]);
      r.setEnd(node, ranges[i][1]);
      const mk = document.createElement("mark");
      mk.className = "search-hit";
      try { r.surroundContents(mk); } catch {}
    }
  }
  return count;
}

/** Pulse a message row and scroll it into view (jump target). */
export function flashMessage(msgId, query) {
  const row = document.querySelector('.msg-row[data-id="' + msgId + '"]');
  if (!row) return false;
  if (query) markRow(row, query);
  row.classList.remove("msg-flash");
  void row.offsetWidth; // restart the animation
  row.classList.add("msg-flash");
  setTimeout(() => row.classList.remove("msg-flash"), 2000);
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}

/** Open the chat that owns a message, then highlight that message. */
export function openHit(chatId, msgId, query) {
  selectChat(chatId);
  if (!flashMessage(msgId, query)) {
    // Chat just switched and the row may not be painted yet — retry next frame.
    requestAnimationFrame(() => flashMessage(msgId, query));
  }
}

/* ---------- results panel ---------- */

function clearResults() {
  items = [];
  activeIdx = -1;
  const box = $("searchResults");
  if (box) { box.hidden = true; box.innerHTML = ""; }
}

/* After a jump the search is done — clear the box and show every chat again. */
function resetSearch() {
  const input = $("sidebarSearch");
  if (input) { input.value = ""; input.blur(); }
  currentQuery = "";
  clearResults();
  renderConvList("");
}

function selectIdx(i) {
  if (!items.length) return;
  activeIdx = (i + items.length) % items.length;
  const box = $("searchResults");
  if (!box) return;
  box.querySelectorAll(".sr-item").forEach((el, n) => el.classList.toggle("sr-active", n === activeIdx));
  const el = box.querySelectorAll(".sr-item")[activeIdx];
  if (el) el.scrollIntoView({ block: "nearest" });
}

function buildItem(hit, n) {
  const chatIdx = state.chats.indexOf(hit.chat);
  const item = document.createElement("div");
  item.className = "sr-item";
  item.dataset.n = String(n);

  const av = document.createElement("div");
  av.className = "sr-avatar avatar avatar-sm " + avClass(chatIdx);
  av.textContent = (hit.chat.name || "?").trim().charAt(0).toUpperCase();

  const body = document.createElement("div");
  body.className = "sr-body";

  const top = document.createElement("div");
  top.className = "sr-top";
  const name = document.createElement("span");
  name.className = "sr-chat";
  name.textContent = hit.chat.name;
  const time = document.createElement("span");
  time.className = "sr-time";
  time.textContent = fmtTime(hit.msg.createdAt);
  top.append(name, time);

  const snip = document.createElement("div");
  snip.className = "sr-snippet";
  snip.append(document.createTextNode(hit.snippet.before));
  const mark = document.createElement("mark");
  mark.className = "search-hit";
  mark.textContent = hit.snippet.match;
  snip.append(mark, document.createTextNode(hit.snippet.after));

  body.append(top, snip);
  item.append(av, body);
  item.addEventListener("click", () => {
    activeIdx = n;
    const q = currentQuery;
    openHit(hit.chat.id, hit.msg.id, q);
    resetSearch();
  });
  return item;
}

function renderResults(q) {
  const box = $("searchResults");
  if (!box) return;
  const hits = searchAll(q);
  const shown = hits.slice(0, MAX_RESULTS);
  items = shown.map(h => ({ chatId: h.chat.id, msgId: h.msg.id }));
  activeIdx = -1;

  box.innerHTML = "";
  if (!q) { box.hidden = true; return; }
  box.hidden = false;

  const header = document.createElement("div");
  header.className = "sr-header";
  header.textContent = hits.length
    ? hits.length + " message" + (hits.length === 1 ? "" : "s") + (hits.length > shown.length ? " (first " + shown.length + ")" : "")
    : "No messages found";
  box.append(header);

  shown.forEach((hit, n) => box.append(buildItem(hit, n)));
}

let currentQuery = "";

/* ---------- wiring ---------- */

export function initGlobalSearch() {
  const input = $("sidebarSearch");
  if (!input) return;

  input.addEventListener("input", () => {
    currentQuery = input.value;
    renderResults(currentQuery);
  });

  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); selectIdx(activeIdx + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); selectIdx(activeIdx - 1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx < 0 && items.length) activeIdx = 0;
      const item = items[activeIdx];
      if (!item) return;
      const q = currentQuery;
      openHit(item.chatId, item.msgId, q);
      resetSearch();
    } else if (e.key === "Escape") {
      input.value = "";
      currentQuery = "";
      input.blur();
      renderConvList("");
      renderResults("");
    }
  });
}

/** Focus the sidebar search box (Ctrl+Shift+F). */
export function focusGlobalSearch() {
  const input = $("sidebarSearch");
  if (!input) return;
  input.focus();
  input.select();
}
