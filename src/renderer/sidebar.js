/**
 * Sidebar: multi-chat conversation list, Messenger-style.
 * Renders every chat (pinned first, most recent on top) with a per-chat
 * options menu (rename / pin / delete). Preview updates live.
 */

import { state, settings, getActiveChat, messagesFor } from "./state.js";
import { $, placePopup } from "./dom.js";
import { esc, fmtTime, avClass, fold } from "./utils.js";
import { promptDialog, confirmDialog } from "./dialog.js";
import { saveCfg } from "./settings.js";

let handlers = { createChat() {}, renameChat() {}, deleteChat() {}, toggleChatPin() {}, selectChat() {} };
let chatMenuTarget = null;
/* Kept across re-renders so a live incoming message (which calls
   renderConvList() with no argument) doesn't wipe an active search. */
let currentFilter = "";

function lastMessage(chatId) {
  const msgs = messagesFor(chatId);
  return msgs[msgs.length - 1] || null;
}

function previewText(msg) {
  if (!msg) return "";
  if (msg.deleted) return "Message deleted";
  if (msg.text) {
    return msg.text
      .replace(/```[\s\S]*?```/g, " [code] ")
      .replace(/[`*_~#>]/g, "")
      .replace(/\[[^\]]+\]\([^)]*\)/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (msg.files && msg.files.length) return "📎 " + (msg.files[0].name || "Attachment");
  return "";
}

function sortedChats(filter) {
  // Folded the same way as the message search, so "gio" matches "giờ" here too.
  const q = fold(filter).trim();
  let chats = state.chats.slice();
  if (q) {
    chats = chats.filter(c =>
      fold(c.name).includes(q) || fold(previewText(lastMessage(c.id))).includes(q));
  }
  chats.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    const ta = lastMessage(a.id) ? lastMessage(a.id).createdAt : a.createdAt;
    const tb = lastMessage(b.id) ? lastMessage(b.id).createdAt : b.createdAt;
    return tb - ta;
  });
  return chats;
}

export function renderConvList(filter) {
  const list = $("convList");
  if (!list) return;
  if (filter !== undefined) currentFilter = filter || "";
  const raw = currentFilter.trim();
  const q = fold(raw).trim();
  const chats = sortedChats(raw);
  list.innerHTML = "";

  if (q) {
    const label = document.createElement("div");
    label.className = "list-label";
    label.textContent = "Chats";
    list.append(label);
  }

  if (!chats.length) {
    const empty = document.createElement("div");
    empty.className = "conv-empty";
    empty.textContent = raw ? "No chats match “" + raw + "”" : "No chats yet — click the compose button to create one";
    list.append(empty);
    return;
  }

  const active = getActiveChat();

  chats.forEach(chat => {
    const last = lastMessage(chat.id);
    const preview = previewText(last);
    const isActive = active && chat.id === active.id;
    const idx = state.chats.indexOf(chat);

    const item = document.createElement("div");
    item.className = "conv-item" + (isActive ? " active" : "");
    item.dataset.id = chat.id;

    const av = document.createElement("div");
    av.className = "conv-avatar-wrap";
    av.innerHTML =
      '<div class="avatar avatar-md ' + avClass(idx) + '">' + esc(chat.name.trim().charAt(0).toUpperCase()) + "</div>" +
      (isActive ? '<span class="conv-online-dot" title="Active"></span>' : "");

    const body = document.createElement("div");
    body.className = "conv-body";
    body.innerHTML =
      '<div class="conv-top"><span class="conv-name">' + esc(chat.name) + "</span>" +
      '<span class="conv-top-right">' + (chat.pinned ? '<span class="conv-pin" title="Pinned">📌</span>' : "") +
      '<span class="conv-time">' + esc(last ? fmtTime(last.createdAt) : "") + "</span></span></div>" +
      '<div class="conv-preview"><span class="you-prefix">You: </span>' + esc(preview || "No messages yet") + "</div>";

    const menuBtn = document.createElement("button");
    menuBtn.className = "conv-menu-btn";
    menuBtn.type = "button";
    menuBtn.title = "Options";
    menuBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>';
    menuBtn.addEventListener("click", e => { e.stopPropagation(); openChatMenu(e, chat.id); });

    item.addEventListener("click", () => handlers.selectChat(chat.id));
    item.append(av, body, menuBtn);
    list.append(item);
  });
}

function openChatMenu(e, chatId) {
  chatMenuTarget = chatId;
  const menu = $("chatMenu");
  if (!menu) return;
  const chat = state.chats.find(c => c.id === chatId);
  // Only the caption span carries the text — the row keeps its icon.
  const pinLi = menu.querySelector('[data-action="pin"] .ctx-label');
  if (pinLi) pinLi.textContent = chat && chat.pinned ? "Unpin" : "Pin";
  menu.hidden = false;
  // Prefer sitting beside the ⋯ button; flip/clamp so it is never cut off
  // by the window edge and the last item always stays clickable.
  const btn = e.target && e.target.closest ? e.target.closest(".conv-menu-btn") : null;
  placePopup(menu, btn ? { anchor: btn.getBoundingClientRect(), gap: 6 } : { x: e.clientX, y: e.clientY });
}

function closeChatMenu() {
  const menu = $("chatMenu");
  if (menu) menu.hidden = true;
  chatMenuTarget = null;
}

export function initSidebar(h = {}) {
  handlers = Object.assign(handlers, h);

  const sidebarSearch = $("sidebarSearch");
  if (sidebarSearch) sidebarSearch.addEventListener("input", () => renderConvList(sidebarSearch.value));
  renderConvList();

  /* Collapse / expand the chat list (persisted via settings.sidebarCollapsed). */
  function setCollapsed(collapsed, save = true) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    settings.sidebarCollapsed = collapsed;
    if (save && window.api && window.api.saveSettings) saveCfg();
  }
  if (settings.sidebarCollapsed) document.body.classList.add("sidebar-collapsed");

  const btnCollapse = $("btnSidebarCollapse");
  if (btnCollapse) btnCollapse.addEventListener("click", e => {
    e.stopPropagation();
    setCollapsed(true);
  });
  const btnOpen = $("btnSidebarOpen");
  if (btnOpen) btnOpen.addEventListener("click", e => {
    e.stopPropagation();
    setCollapsed(false);
  });

  const btnCompose = $("btnCompose");
  if (btnCompose) btnCompose.addEventListener("click", async () => {
    const name = await promptDialog({
      title: "New chat", placeholder: "Chat name", okText: "Create"
    });
    if (name && name.trim()) handlers.createChat(name.trim());
  });

  const menu = $("chatMenu");
  if (menu) {
    menu.addEventListener("click", async e => {
      const li = e.target.closest("li");
      const action = li ? li.dataset.action : null;
      const id = chatMenuTarget;
      closeChatMenu();
      if (!action || !id) return;
      const chat = state.chats.find(c => c.id === id);
      if (!chat) return;
      if (action === "rename") {
        const name = await promptDialog({
          title: "Rename chat", value: chat.name, okText: "Save"
        });
        if (name && name.trim()) handlers.renameChat(id, name.trim());
      } else if (action === "pin") {
        handlers.toggleChatPin(id);
      } else if (action === "delete") {
        const ok = await confirmDialog({
          title: "Delete chat?",
          message: 'Delete "' + chat.name + '" and all of its messages? This cannot be undone.',
          okText: "Delete"
        });
        if (ok) handlers.deleteChat(id);
      }
    });
    document.addEventListener("click", e => {
      if (menu.hidden) return;
      if (e.target.closest("#chatMenu") || e.target.closest(".conv-menu-btn")) return;
      closeChatMenu();
    });
    // A fixed menu would drift away from its chat row on scroll/resize.
    const body = $("sidebarBody");
    if (body) body.addEventListener("scroll", closeChatMenu, { passive: true });
    window.addEventListener("resize", closeChatMenu);
  }
}
