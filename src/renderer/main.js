/**
 * Entry point: wires every feature module together.
 */

import { onReady, $ } from "./dom.js";
import { state, settings } from "./state.js";
import { uid } from "./utils.js";
import { toast } from "./toast.js";
import { applyTheme, initTheme, initSettingsPanel, initPipSize, initFloatingSettings } from "./settings.js";
import { initEmoji } from "./emoji.js";
import {
  render, addMessage, clearAllMessages, bindMessageHooks,
  selectChat, createChat, renameChat, deleteChat, toggleChatPin,
} from "./messages.js";
import {
  showCtxMenu, showReactionPicker, toggleReaction,
  initContextMenu, initReactionPicker, initEditModal,
  initPinnedBar, initMsgSearch, closeCtxMenu,
} from "./interactions.js";
import { initGlobalSearch, focusGlobalSearch } from "./search.js";
import { initComposer } from "./composer.js";
import { initDragDrop } from "./dragdrop.js";
import { initVoice } from "./voice.js";
import { initCanvas, closeCanvas } from "./canvas.js";
import { initCapture } from "./capture.js";
import { initGallery, closeGallery } from "./gallery.js";
import { initRecPrefs, closeRecPrefs, syncRecPrefsUi } from "./recprefs.js";
import { renderConvList, initSidebar } from "./sidebar.js";
import { initTips } from "./tip.js";
import { initSectionResize } from "./panelsize.js";

function closeAll() {
  ["ctxMenu", "reactionPicker", "emojiPicker", "themePicker", "editModal", "attachPopover"].forEach(id => {
    const el = $(id);
    if (el) el.hidden = true;
  });
  document.querySelectorAll(".msg-row.actions-visible").forEach(r => r.classList.remove("actions-visible"));
}

function initGlobalKeys() {
  document.addEventListener("click", closeAll);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      const closedOverlay = closeEscapeTargets();
      // PiP expanded: first Esc collapses to the bubble (doesn't kill the window).
      if (!closedOverlay && PIP_MODE && document.body.classList.contains("pip-mode") &&
          !document.body.classList.contains("pip-collapsed")) {
        e.preventDefault();
        collapsePip();
      }
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
      e.preventDefault();
      if (e.shiftKey) { focusGlobalSearch(); return; } // every chat
      const sb = $("searchBar"); if (sb) sb.hidden = false;
      const inp = $("msgSearchInput"); if (inp) inp.focus();
    }
  });
}

function closeEscapeTargets() {
  let closed = false;
  const cm = $("ctxMenu");
  if (cm && !cm.hidden) { closeCtxMenu(); closed = true; }
  closeAll();
  const sb = $("searchBar");
  if (sb && !sb.hidden) { sb.hidden = true; closed = true; }
  const sp = $("settingsPanel");
  if (sp && !sp.hidden) { sp.hidden = true; closed = true; }
  const pv = $("mediaPreview");
  if (pv && !pv.hidden) {
    pv.hidden = true; closed = true;
    const pb = $("mediaPreviewBody");
    if (pb) { pb.querySelectorAll("video").forEach(v => { try { v.pause(); } catch {} }); pb.innerHTML = ""; }
  }
  const mp = $("mediaPanel");
  if (mp && !mp.hidden) { closeGallery(); closed = true; }
  const mini = $("miniPanel");
  if (mini && !mini.hidden) { closeRecPrefs(); closed = true; }
  const cv = $("canvasPanel");
  if (cv && cv.classList.contains("open")) { closeCanvas(); closed = true; }
  return closed;
}

/* The side panels and the whiteboard live OUTSIDE .app so that they stay up
   when the window shrinks to the bubble — which is precisely how the floating
   bar used to "disappear" after pressing minimize: a 340px panel left open
   covers the 56×248 window it just shrank into. Minimizing puts them away
   first, so what the user asked for (the bar) is what they see. */
function closeFloatingOverlays() {
  closeGallery();
  closeRecPrefs();
  closeCanvas();
  const sp = $("settingsPanel");
  if (sp) sp.hidden = true;
}

function collapsePip() {
  // Both sides flip in the same tick: the renderer paints the bar and the main
  // process shrinks the window instantly (no intermediate half-size window).
  closeFloatingOverlays();
  document.body.classList.add("pip-collapsed");
  document.body.classList.remove("pip-max");
  if (window.api && window.api.pip) window.api.pip.collapse();
}

function expandPip() {
  document.body.classList.remove("pip-collapsed", "pip-max");
  if (window.api && window.api.pip) window.api.pip.expand();
  const inp = $("messageInput");
  if (inp) setTimeout(() => inp.focus(), 150);
}

/* ---- Floating PiP bubble mode ----
 * When index.html is loaded with ?pip=1 we hide the nav rail and start
 * collapsed as a small floating pill; clicking it expands into the full
 * mini-chat (and vice-versa via the collapse button). */
const PIP_MODE = new URLSearchParams(location.search).get("pip") === "1";

function initPipMode() {
  if (!PIP_MODE) return;
  const api = window.api;
  document.body.classList.add("pip-mode", "pip-vertical");
  // Main auto-expands on open; only flash collapsed until pip:state arrives.
  document.body.classList.add("pip-collapsed");

  // Main can force expand/collapse (rail toggle) — keep body class in sync.
  const applyPipState = s => {
    if (s === "expanded") document.body.classList.remove("pip-collapsed");
    else if (s === "collapsed") {
      // Collapsing from anywhere (rail toggle, launch, Esc) also puts the side
      // panels away — they are painted over the bubble, not inside .app.
      closeFloatingOverlays();
      document.body.classList.add("pip-collapsed");
    }
  };
  if (api && api.pip && api.pip.onState) api.pip.onState(applyPipState);
  /* The push above is sent when the window finishes loading, which can be
     BEFORE this listener exists (the init below is async). A popup born
     already expanded would then stay painted as a pill forever, so ask main
     for the authoritative state once — same idea as pip:getOrient. */
  if (api && api.pip && api.pip.getState) {
    api.pip.getState().then(applyPipState).catch(() => {});
  }

  const bubble = $("pipBubble");

  /* Drag the pill + tap to expand.
   * pointerdown is NOT async-waiting for IPC before arming drag — we start
   * with a cached base and refresh from main when getpos returns, so a slow
   * IPC never swallows the click/expand. Expand fires on pointerup if the
   * pointer barely moved (click after pointer-capture was unreliable). */
  if (bubble) {
    let dragState = null;
    let pendingPos = null;
    let lastSend = 0;
    let expandArmed = false;
    /* A move gesture must never open the chat, but Chrome still fires a
       `click` when mousedown and mouseup land on the same element — i.e.
       right after a drag. These three keep track of what the gesture was. */
    let dragMoved = false;          // this gesture actually moved the window
    let downScreen = null;          // where the gesture started (screen px)
    let suppressClickUntil = 0;     // drag-end click window

    bubble.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      if (e.target.closest(".pip-tool")) return;
      e.preventDefault();
      expandArmed = true;
      dragMoved = false;
      downScreen = { x: e.screenX, y: e.screenY };
      dragState = {
        sx: e.screenX, sy: e.screenY,
        base: null, moved: false, id: e.pointerId
      };
      pendingPos = null;
      try { bubble.setPointerCapture(e.pointerId); } catch {}
      // Refresh base in background; moves wait until it arrives.
      Promise.resolve(api.pip.dragStart()).then(pos => {
        if (dragState && dragState.id === e.pointerId && pos) dragState.base = pos;
      }).catch(() => {});
    });

    bubble.addEventListener("pointermove", e => {
      if (!dragState || e.pointerId !== dragState.id) return;
      const dx = e.screenX - dragState.sx;
      const dy = e.screenY - dragState.sy;
      if (!dragState.moved && Math.abs(dx) + Math.abs(dy) > 4) dragState.moved = true;
      if (dragState.moved) { expandArmed = false; dragMoved = true; }
      if (!dragState.moved || !dragState.base) return;
      pendingPos = { x: dragState.base.x + dx, y: dragState.base.y + dy };
      const now = performance.now();
      if (now - lastSend >= 16) {
        lastSend = now;
        api.pip.dragTo(pendingPos);
        pendingPos = null;
      }
    });

    function endPointerDrag(e) {
      if (!dragState) return;
      // A pending target that differs from the start means the window did
      // move, even if the per-move threshold never tripped.
      if (pendingPos && dragState.base &&
          (pendingPos.x !== dragState.base.x || pendingPos.y !== dragState.base.y)) {
        dragState.moved = true;
      }
      if (pendingPos) { api.pip.dragTo(pendingPos); pendingPos = null; }
      const wasDrag = dragState.moved;
      const pid = dragState.id;
      dragState = null;
      try { if (e && e.pointerId != null) bubble.releasePointerCapture(e.pointerId); } catch {}
      if (wasDrag) {
        // The window moved → the click that ends this gesture must not open it.
        dragMoved = true;
        suppressClickUntil = performance.now() + 600;
      }
      // Tap (no real drag) → expand. Skip if pointerup was on a tool button.
      if (!wasDrag && expandArmed && !(e && e.target && e.target.closest && e.target.closest(".pip-tool"))) {
        expandPip();
      }
      expandArmed = false;
      void pid;
    }
    bubble.addEventListener("pointerup", endPointerDrag);
    bubble.addEventListener("pointercancel", e => {
      expandArmed = false;
      if (dragState) {
        if (pendingPos) { api.pip.dragTo(pendingPos); pendingPos = null; }
        dragState = null;
      }
      try { if (e && e.pointerId != null) bubble.releasePointerCapture(e.pointerId); } catch {}
    });

    // Fallback if pointerup was missed (e.g. capture lost): a plain click
    // still expands — but a drag must never count as a click.
    bubble.addEventListener("click", e => {
      if (e.target.closest(".pip-tool")) return;
      if (!document.body.classList.contains("pip-collapsed")) return;
      if (dragMoved || performance.now() < suppressClickUntil) return;
      const jitter = downScreen && (e.screenX || e.screenY)
        ? Math.abs(e.screenX - downScreen.x) + Math.abs(e.screenY - downScreen.y)
        : 0;
      if (jitter > 6) return;
      expandPip();
    });
  }

  /* Drop files straight onto the collapsed bubble → expand + send them. */
  if (bubble) {
    bubble.addEventListener("dragenter", e => { e.preventDefault(); bubble.classList.add("pip-dragover"); });
    bubble.addEventListener("dragover", e => { e.preventDefault(); bubble.classList.add("pip-dragover"); });
    bubble.addEventListener("dragleave", () => bubble.classList.remove("pip-dragover"));
    bubble.addEventListener("drop", async e => {
      e.preventDefault();
      bubble.classList.remove("pip-dragover");
      const files = Array.from(e.dataTransfer.files || []);
      if (!files.length) return;
      if (!api.storeDroppedFiles) { toast("File drop unavailable"); return; }
      const stored = await api.storeDroppedFiles(files);
      if (!stored || !stored.length) { toast("Could not save files"); return; }
      // Expand so the user sees the attached files, then send them.
      expandPip();
      await addMessage("", stored);
      toast(stored.length + " file" + (stored.length > 1 ? "s" : "") + " sent");
    });
  }

  /* Resize the expanded popup freely (compress or expand): frameless /
   * transparent windows can't rely on OS edge-drag, so a corner grip
   * drives setSize through IPC (min/max clamps live in the main process). */
  const grip = $("pipResize");
  if (grip) {
    let rz = null;
    grip.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      e.preventDefault();
      rz = { sx: e.screenX, sy: e.screenY, w: window.innerWidth, h: window.innerHeight };
      try { grip.setPointerCapture(e.pointerId); } catch {}
    });
    grip.addEventListener("pointermove", e => {
      if (!rz) return;
      if (api && api.pip && api.pip.resizeTo) {
        api.pip.resizeTo({
          w: Math.round(rz.w + (e.screenX - rz.sx)),
          h: Math.round(rz.h + (e.screenY - rz.sy))
        });
      }
    });
    const endResize = () => { rz = null; };
    grip.addEventListener("pointerup", endResize);
    grip.addEventListener("pointercancel", endResize);
  }

  /* Maximize / restore. The popup is frameless, so it has no OS maximize box —
     this header button (or a double-click on the header) fills the screen and
     brings the window back to its previous size. */
  const btnMax = $("btnPipMax");
  if (btnMax) btnMax.addEventListener("click", e => {
    e.stopPropagation();
    if (api && api.pip && api.pip.maximize) api.pip.maximize();
  });
  const header = $("chatHeader");
  if (header) header.addEventListener("dblclick", e => {
    if (e.target.closest("button") || e.target.closest("a")) return;
    if (api && api.pip && api.pip.maximize) api.pip.maximize();
  });
  if (api && api.pip && api.pip.onMaximized) {
    api.pip.onMaximized(on => document.body.classList.toggle("pip-max", !!on));
  }
  if (api && api.pip && api.pip.onHint) {
    api.pip.onHint(d => { if (d && d.text) toast(d.text, "App minimized to the bubble"); });
  }

  const btnCollapse = $("btnPipCollapse");
  if (btnCollapse) btnCollapse.addEventListener("click", e => {
    e.stopPropagation();
    collapsePip();
  });

  const btnClose = $("btnPipClose");
  if (btnClose) btnClose.addEventListener("click", e => {
    e.stopPropagation();
    if (api && api.pip) api.pip.close();
  });

  /* Orientation (vertical bookmark-tab vs horizontal pill) */
  const btnOrient = $("btnPipOrient");
  if (btnOrient) btnOrient.addEventListener("click", () => {
    if (api && api.pip) api.pip.flip();
  });
  function applyOrient(m) {
    document.body.classList.remove("pip-vertical", "pip-horizontal");
    document.body.classList.add("pip-" + (m === "horizontal" ? "horizontal" : "vertical"));
  }
  if (api && api.pip && api.pip.onOrient) {
    api.pip.onOrient(applyOrient);
  }
  // Pull current orientation in case main's did-finish-load push arrived
  // before this listener was registered.
  if (api && api.pip && api.pip.getOrient) {
    api.pip.getOrient().then(m => { if (m) applyOrient(m); }).catch(() => {});
  }
}

/* Realtime sync: apply state/settings pushed from the other window. */
function initCrossWindowSync() {
  const api = window.api;
  if (!api) return;
  if (api.onStateChanged) {
    api.onStateChanged(data => {
      if (!data || !Array.isArray(data.chats)) return;
      Object.assign(state, data);
      renderConvList();
      render(true);
    });
  }
  if (api.onSettingsChanged) {
    api.onSettingsChanged(data => {
      if (!data) return;
      Object.assign(settings, data);
      applyTheme();
      document.body.classList.toggle("sidebar-collapsed", !!settings.sidebarCollapsed);
      document.body.classList.toggle("pip-xs", (Number(settings.pipScale) || 1) < 1);
      // Another window changed the recording options — keep the mini panel honest.
      syncRecPrefsUi();
    });
  }
}

onReady(async () => {
  if (!window.api) { console.error("API bridge not found"); return; }

  bindMessageHooks({ showCtxMenu, showReactionPicker, toggleReaction });

  /* Rail button: put the app away — the chat window hides and the floating bar
     (docked, collapsed) is what stays on screen. */
  const btnPip = $("btnPip");
  if (btnPip) btnPip.addEventListener("click", () => {
    if (window.api.tuckIntoBar) window.api.tuckIntoBar();
    else if (window.api.togglePip) window.api.togglePip();
    else if (window.api.openPip) window.api.openPip();
  });

  /* The floating bar explains the way back after the app was tucked away. */
  if (window.api.pip && window.api.pip.onHint) {
    window.api.pip.onHint(d => { if (d && d.text) toast(d.text, "App minimized to the bubble"); });
  }

  const btnQuickNote = $("btnQuickNote");
  if (btnQuickNote) btnQuickNote.addEventListener("click", () => window.api.openQuickNote());

  /* Load persisted data */
  try {
    const loaded = await window.api.load();
    if (loaded && Array.isArray(loaded.messages)) Object.assign(state, loaded);
    const cfg = await window.api.loadSettings();
    if (cfg) Object.assign(settings, cfg);
  } catch (err) {
    console.error("Init load failed:", err);
  }

  migrateData();

  /* Wire every feature */
  applyTheme();
  initTheme(() => { render(false); });
  initEmoji();
  initSettingsPanel({ onClearAll: clearAllMessages });
  initPipSize();
  initFloatingSettings();
  document.body.classList.toggle("pip-xs", (Number(settings.pipScale) || 1) < 1);
  initContextMenu();
  initReactionPicker();
  initEditModal();
  initPinnedBar();
  initMsgSearch();
  initGlobalSearch();
  initComposer();
  initDragDrop();
  initVoice();
  initCanvas();
  initCapture();
  initGallery();
  initRecPrefs();
  initSidebar({ createChat, renameChat, deleteChat, toggleChatPin, selectChat });
  initSectionResize();
  initTips();
  initGlobalKeys();

  /* First paint */
  renderConvList();
  render(true);
  initCrossWindowSync();
  initPipMode();

  // Signals to smoke tests (and anything else) that every module is wired.
  document.body.classList.add("app-ready");
  console.log("Loopback initialized. Chats:", state.chats.length, "· Messages:", state.messages.length, PIP_MODE ? "· PIP mode" : "");
});

/**
 * One-time migration from the old single-chat model (flat `messages` array)
 * to the multi-chat model. Existing notes are folded into a "Notes to Self"
 * chat; two empty starter chats (Ideas, Tasks) are added alongside.
 */
function migrateData() {
  if (!Array.isArray(state.chats)) state.chats = [];

  if (!state.chats.length) {
    const seed = ["Notes to Self", "Ideas", "Tasks"];
    seed.forEach((name, i) => state.chats.push({
      id: uid(), name, pinned: i === 0, createdAt: Date.now() - (seed.length - i) * 1000
    }));
    const existing = Array.isArray(state.messages) ? state.messages : [];
    existing.forEach(m => { m.chatId = state.chats[0].id; });
  }

  // Back-fill chatId on any legacy message that lacks one
  const ids = new Set(state.chats.map(c => c.id));
  for (const m of state.messages) {
    if (!ids.has(m.chatId)) m.chatId = state.chats[0].id;
  }

  // Ensure a valid active chat
  if (!state.chats.find(c => c.id === state.activeChatId)) {
    state.activeChatId = state.chats[0].id;
  }
}
