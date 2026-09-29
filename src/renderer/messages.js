/**
 * Message storage: rendering, add/delete/edit, pinning, read state.
 */

import { state, ui, getActiveChat, messagesFor } from "./state.js";
import { $ } from "./dom.js";
import { esc, bytes, fmtTime, fmtDate, uid, avClass } from "./utils.js";
import { renderMarkdown } from "./markdown.js";
import { toast } from "./toast.js";
import { renderConvList } from "./sidebar.js";

export function findMsg(id) { return state.messages.find(m => m.id === id); }

export function save() {
  // Persist to disk and replay into every other open window (realtime sync).
  if (window.api.broadcastState) window.api.broadcastState(state);
  return window.api.save(state);
}

/** Drop every message in the active chat plus its stored files. */
export async function clearAllMessages() {
  const chat = getActiveChat();
  if (!chat) return;
  const msgs = messagesFor(chat.id);
  const names = [];
  for (const m of msgs) for (const f of (m.files || [])) names.push(f.storedName);
  if (names.length) await window.api.deleteFiles(names);
  state.messages = state.messages.filter(m => m.chatId !== chat.id);
  render(true);
  await save();
}

/* Lightbox for images */
let lb = null;
function openLightbox(src, name) {
  if (!lb) {
    lb = document.createElement("div");
    lb.className = "lightbox";
    lb.innerHTML = '<div class="lb-bg"></div><div class="lb-content"><div class="lb-name"></div><img class="lb-img" alt=""><button class="lb-close">&#x2715;</button></div>';
    lb.querySelector(".lb-close").onclick = () => lb.remove();
    lb.querySelector(".lb-bg").onclick = () => lb.remove();
    document.body.append(lb);
  }
  lb.querySelector(".lb-img").src = src;
  lb.querySelector(".lb-name").textContent = name || "";
  document.body.append(lb); // re-attach if previously closed
}

function buildFileEl(file, msg) {
  const wrap = document.createElement("div");
  wrap.className = "attach";
  const url = window.api.fileUrl(file.storedName);

  if (file.category === "image") {
    const imgWrap = document.createElement("div");
    imgWrap.className = "attach-image";
    const img = document.createElement("img");
    img.src = url;
    img.alt = file.name;
    // Lightbox: open full-size in-app instead of external program
    img.onclick = e => { e.stopPropagation(); openLightbox(url, file.name); };
    imgWrap.append(img);
    wrap.append(imgWrap);
  } else if (file.category === "video") {
    const v = document.createElement("video");
    v.src = url; v.controls = true;
    v.style.maxWidth = "320px"; v.style.borderRadius = "12px";
    wrap.append(v);
  } else if (file.category === "audio") {
    const a = document.createElement("audio");
    a.src = url; a.controls = true; a.style.width = "260px";
    wrap.append(a);
  } else {
    const card = document.createElement("div");
    card.className = "attach-card";
    const ext = (file.name.split(".").pop() || "?").toUpperCase().slice(0, 4);
    card.innerHTML = '<div class="attach-icon">' + esc(ext) + '</div><div class="attach-info"><div class="attach-name">' + esc(file.name) + '</div><div class="attach-meta">' + bytes(file.size) + '</div></div>';
    wrap.append(card);
  }

  const footer = document.createElement("div");
  footer.className = "attach-footer";
  footer.innerHTML = '<div class="attach-meta-full">' + esc(file.name) + " &middot; " + bytes(file.size) + "</div>";
  const actions = document.createElement("div");
  actions.className = "attach-actions";
  const openBtn = document.createElement("button");
  openBtn.textContent = "Open";
  openBtn.onclick = () => window.api.openFile(file.storedName);
  const showBtn = document.createElement("button");
  showBtn.textContent = "Show";
  showBtn.onclick = () => window.api.revealFile(file.storedName);
  actions.append(openBtn, showBtn);
  footer.append(actions);
  wrap.append(footer);
  return wrap;
}

function buildMsg(msg, hooks, groupClass) {
  const row = document.createElement("div");
  row.className = "msg-row me";
  row.dataset.id = msg.id;
  if (groupClass) row.classList.add(groupClass);
  const inner = document.createElement("div");
  inner.className = "msg-inner";

  const hover = document.createElement("div");
  hover.className = "msg-hover-actions";
  hover.innerHTML =
    '<button class="msg-hover-btn" data-act="react"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></button>' +
    '<button class="msg-hover-btn" data-act="more"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg></button>';
  hover.querySelector('[data-act="react"]').onclick = e => { e.stopPropagation(); hooks.showReactionPicker(e, msg.id); };
  hover.querySelector('[data-act="more"]').onclick = e => { e.stopPropagation(); hooks.showCtxMenu(e, msg.id); };
  inner.append(hover);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (msg.files && msg.files.length) bubble.classList.add("has-attachment");
  if (msg.deleted) {
    bubble.innerHTML = '<em style="opacity:0.6">Message deleted</em>';
  } else {
    if (msg.text) {
      const txt = document.createElement("div");
      txt.innerHTML = renderMarkdown(msg.text);
      bubble.append(txt);
    }
    if (msg.edited) {
      const el = document.createElement("span");
      el.className = "edited-label";
      el.textContent = " edited";
      bubble.append(el);
    }
    for (const file of (msg.files || [])) bubble.append(buildFileEl(file, msg));
  }
  // Messenger-style inline timestamp, trailing the text inside the bubble
  const bubbleTime = document.createElement("span");
  bubbleTime.className = "bubble-time";
  bubbleTime.textContent = fmtTime(msg.createdAt);
  bubble.append(bubbleTime);
  inner.append(bubble);

  bubble.addEventListener("click", function (e) {
    if (e.target.closest(".msg-hover-btn")) return;
    e.stopPropagation();
    document.querySelectorAll(".msg-row.actions-visible").forEach(r => { if (r !== row) r.classList.remove("actions-visible"); });
    row.classList.toggle("actions-visible");
  });

  // Right-click anywhere on the message opens the same actions menu.
  row.addEventListener("contextmenu", e => {
    if (e.target.closest("input, textarea, a")) return;
    hooks.showCtxMenu(e, msg.id);
  });

  if (msg.reactions && Object.keys(msg.reactions).length) {
    const rDiv = document.createElement("div");
    rDiv.className = "msg-reactions";
    for (const [emoji, count] of Object.entries(msg.reactions)) {
      const chip = document.createElement("span");
      chip.className = "reaction-chip";
      chip.innerHTML = emoji + '<span class="count">' + count + "</span>";
      chip.onclick = () => hooks.toggleReaction(msg.id, emoji);
      rDiv.append(chip);
    }
    inner.append(rDiv);
  }

  if (msg.pinned) {
    const pin = document.createElement("div");
    pin.className = "pin-badge";
    pin.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" fill="#fff"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>';
    inner.append(pin);
  }

  if (msg.read) {
    const rr = document.createElement("div");
    rr.className = "read-receipt";
    rr.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 12l5 5L17 6"/><path d="M7 12l5 5L23 6"/></svg> Read';
    inner.append(rr);
  }

  row.append(inner);

  // Your profile avatar sits to the right of each bubble, like Messenger
  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = "Y";
  avatar.title = "You";
  row.append(avatar);

  return row;
}

let hooks = { showCtxMenu: () => {}, showReactionPicker: () => {}, toggleReaction: async () => {} };
export function bindMessageHooks(h) { hooks = Object.assign(hooks, h); }

/* The welcome block ("Your Notes") is a child of #messages in the markup, so
   the `innerHTML = ""` reset below deleted it for good the first time render()
   ran — after that the empty chat could never show it again. Keep the node and
   put it back whenever the list is empty. */
let emptyStateEl = null;

export function render(scroll) {
  const msgs = $("messages");
  if (!msgs) return;
  const chat = getActiveChat();
  const list = chat ? messagesFor(chat.id) : [];
  renderHeader(chat, list);
  const empty = $("emptyState") || emptyStateEl;
  if (empty) emptyStateEl = empty;
  msgs.innerHTML = "";
  if (!list.length) {
    if (empty) { msgs.append(empty); empty.hidden = false; }
    updatePinned();
    updateMeta();
    renderConvList();
    return;
  }
  if (empty) empty.hidden = true;
  let lastDate = "";
  let prevMsg = null;
  let prevDay = "";
  list.forEach((msg, i) => {
    const d = fmtDate(msg.createdAt);
    if (d !== lastDate) {
      lastDate = d;
      const div = document.createElement("div");
      div.className = "day-divider";
      div.textContent = d;
      msgs.append(div);
    }
    const next = list[i + 1];
    const clusterBack = !(d !== prevDay) && clustered(prevMsg, msg);
    const clusterFwd = clustered(msg, next);
    prevDay = d;
    let groupClass = "";
    if (clusterBack && clusterFwd) groupClass = "group-mid";
    else if (clusterBack) groupClass = "group-bot";
    else if (clusterFwd) groupClass = "group-top";
    msgs.append(buildMsg(msg, hooks, groupClass));
    prevMsg = msg;
  });
  if (scroll) msgs.scrollTop = msgs.scrollHeight;
  updatePinned();
  updateMeta();
  renderConvList();
}

/* Two adjacent messages belong to the same visual "cluster" when neither
   is deleted, neither carries files, and they landed close in time. */
function clustered(a, b) {
  if (!a || !b) return false;
  if (a.deleted || b.deleted) return false;
  if (a.files && a.files.length) return false;
  if (b.files && b.files.length) return false;
  return b.createdAt >= a.createdAt && (b.createdAt - a.createdAt) < 15 * 60 * 1000;
}

function updateMeta() {
  const el = $("chatMeta");
  if (!el) return;
  const chat = getActiveChat();
  const list = chat ? messagesFor(chat.id) : [];
  const n = list.length;
  const last = list[n - 1];
  if (!n) { el.textContent = ""; return; }
  el.textContent = n + " message" + (n === 1 ? "" : "s") + " · last " + fmtTime(last.createdAt);
}

/** Keep the chat header (avatar + name) in sync with the active chat. */
function renderHeader(chat, list) {
  const avatar = $("chatAvatar");
  const name = $("chatName");
  if (!chat) return;
  if (name) name.textContent = chat.name;
  if (avatar) {
    const idx = state.chats.indexOf(chat);
    avatar.className = "avatar avatar-md " + avClass(idx);
    avatar.textContent = (chat.name || "?").trim().charAt(0).toUpperCase();
  }
  // Persist the active selection so reloads reopen the same chat
  if (state.activeChatId !== chat.id) state.activeChatId = chat.id;
}

export async function addMessage(text, files) {
  const clean = String(text || "").trim();
  if (!clean && (!files || !files.length)) return;
  const chat = getActiveChat();
  if (!chat) return;
  state.messages.push({
    id: uid(), chatId: chat.id, text: clean, files: files || [],
    createdAt: Date.now(), read: true, reactions: {}, pinned: false, edited: false
  });
  const input = $("messageInput");
  if (input) { input.value = ""; input.style.height = "auto"; }
  const sendBtn = $("btnSend");
  if (sendBtn) sendBtn.classList.add("empty");
  render(true);
  await save();
  try { window.api.notify({ title: chat.name, body: clean || "File sent" }); } catch {}
}

/** Soft-delete a message and remove its files from disk. */
export async function deleteMessage(msg) {
  const names = (msg.files || []).map(f => f.storedName);
  if (names.length) await window.api.deleteFiles(names);
  msg.text = ""; msg.files = []; msg.deleted = true;
  render(false);
  await save();
}

export function updatePinned() {
  const bar = $("pinnedBar");
  if (!bar) return;
  const chat = getActiveChat();
  const list = chat ? messagesFor(chat.id) : [];
  const pinned = list.filter(m => m.pinned && !m.deleted);
  if (pinned.length) {
    bar.hidden = false;
    $("pinnedText").textContent = pinned[pinned.length - 1].text || "Pinned message";
  } else {
    bar.hidden = true;
  }
}

/* ================= Chat CRUD (multi-chat) ================= */

export function selectChat(id) {
  if (!state.chats.find(c => c.id === id)) return;
  state.activeChatId = id;
  render(true);
  save();
}

export async function createChat(name) {
  const clean = String(name || "").trim();
  if (!clean) return;
  const chat = { id: uid(), name: clean, pinned: false, createdAt: Date.now() };
  state.chats.push(chat);
  state.activeChatId = chat.id;
  render(true);
  renderConvList();
  await save();
  toast("Chat created");
}

export async function renameChat(id, name) {
  const clean = String(name || "").trim();
  const chat = state.chats.find(c => c.id === id);
  if (!chat || !clean) return;
  chat.name = clean;
  render(false);
  renderConvList();
  await save();
}

export async function deleteChat(id) {
  const chat = state.chats.find(c => c.id === id);
  if (!chat) return;
  const msgs = messagesFor(id);
  const names = [];
  for (const m of msgs) for (const f of (m.files || [])) names.push(f.storedName);
  if (names.length) await window.api.deleteFiles(names);
  state.messages = state.messages.filter(m => m.chatId !== id);
  state.chats = state.chats.filter(c => c.id !== id);
  if (state.activeChatId === id) state.activeChatId = null;
  // Never leave the app without a chat to write into
  if (!state.chats.length) {
    state.chats.push({ id: uid(), name: "Notes to Self", pinned: false, createdAt: Date.now() });
  }
  render(true);
  renderConvList();
  await save();
  toast("Chat deleted");
}

export async function toggleChatPin(id) {
  const chat = state.chats.find(c => c.id === id);
  if (!chat) return;
  chat.pinned = !chat.pinned;
  renderConvList();
  await save();
}
