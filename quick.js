/* Quick-note popup logic (global Ctrl+Alt+N).
   Enter saves into the selected chat, Shift+Enter adds a line, Esc closes. */

const api = window.quickApi;
const note = document.getElementById("note");
const chatsEl = document.getElementById("chats");
const statusEl = document.getElementById("status");
const btnClose = document.getElementById("btnClose");

let chats = [];
let activeChatId = null;
let saving = false;

function chipFor(chat) {
  const b = document.createElement("button");
  b.className = "chip" + (chat.id === activeChatId ? " active" : "");
  b.dataset.chatId = chat.id;
  b.textContent = (chat.pinned ? "📌 " : "") + chat.name;
  b.addEventListener("click", () => {
    activeChatId = chat.id;
    chatsEl.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c === b));
    note.focus();
  });
  return b;
}

function renderChips() {
  chatsEl.innerHTML = "";
  chats.forEach(c => chatsEl.append(chipFor(c)));
}

function setStatus(text, cls) {
  statusEl.textContent = text || "";
  statusEl.className = cls || "";
}

async function load() {
  try {
    const cfg = await api.load();
    chats = (cfg && Array.isArray(cfg.chats)) ? cfg.chats : [];
    // Prefer the chat last captured into, else the one the app is showing.
    activeChatId = (cfg && cfg.lastChatId) || (cfg && cfg.activeChatId) || (chats[0] && chats[0].id) || null;
    document.body.classList.toggle("light", !cfg || cfg.dark !== true);
    renderChips();
  } catch {
    setStatus("Could not load chats", "err");
  }
  note.focus();
}

async function save() {
  const text = note.value.trim();
  if (!text || saving) return;
  saving = true;
  try {
    const res = await api.save(text, activeChatId);
    if (res && res.ok) {
      setStatus("Saved to " + res.chatName, "ok");
      note.value = "";
      activeChatId = res.chatId;
      setTimeout(() => api.hide(), 220);
    } else {
      setStatus("Could not save", "err");
    }
  } finally {
    saving = false;
  }
}

note.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
  else if (e.key === "Escape") { e.preventDefault(); api.hide(); }
});

btnClose.addEventListener("click", () => api.hide());

// The window is reused (hidden, never destroyed). An unsaved draft is kept,
// so summoning the popup again never loses a half-typed thought; only the
// status line resets and the chat list is refreshed.
if (api.onFocus) api.onFocus(() => {
  setStatus("");
  load();
});

window.addEventListener("keydown", e => { if (e.key === "Escape") api.hide(); });

load();
