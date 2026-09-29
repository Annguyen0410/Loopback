/**
 * Composer: Messenger-style pill input (auto-grow textarea, Shift+Enter for
 * newline, thumbs-up → send toggle), attach, typing indicator, /world shortcut.
 */

import { $ } from "./dom.js";
import { addMessage } from "./messages.js";
import { openCanvas } from "./canvas.js";

function hideAttachPopover() {
  const p = $("attachPopover");
  if (p) p.hidden = true;
}

/* Auto-grow the textarea as lines wrap, capped by CSS max-height. */
function autosize() {
  const el = $("messageInput");
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
  updateSendState();
}

/* Messenger behaviour: empty input shows 👍, typing shows the send arrow. */
function updateSendState() {
  const input = $("messageInput");
  const btn = $("btnSend");
  if (!input || !btn) return;
  btn.classList.toggle("empty", !input.value.trim());
}

export function initComposer() {
  const messageInput = $("messageInput");
  const btnSend = $("btnSend");

  if (btnSend) btnSend.addEventListener("click", async e => {
    e.preventDefault();
    // 👍 button with empty input sends a thumbs-up reaction message
    if (messageInput && !messageInput.value.trim() && btnSend.classList.contains("empty")) {
      await addMessage("👍", []);
      return;
    }
    await addMessage(messageInput ? messageInput.value : "", []);
  });

  if (messageInput) {
    messageInput.addEventListener("keydown", async e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const val = messageInput.value.trim();
        if (val === "/world") { messageInput.value = ""; autosize(); window.api.openMonitor(); return; }
        await addMessage(messageInput.value, []);
      }
    });

    messageInput.addEventListener("input", autosize);

    let typingTimeout;
    messageInput.addEventListener("input", () => {
      const ti = $("typingIndicator");
      if (ti) ti.hidden = false;
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => { if (ti) ti.hidden = true; }, 1500);
    });

    /* Paste image from clipboard (Ctrl+V) → attach directly */
    messageInput.addEventListener("paste", async e => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.type && item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) return;
          const reader = new FileReader();
          reader.onloadend = async () => {
            const saved = await window.api.savePasted({ name: "pasted-" + Date.now(), dataUrl: reader.result });
            if (saved) await addMessage("", [saved]);
          };
          reader.readAsDataURL(file);
          return;
        }
      }
    });
  }

  updateSendState();

  /* Attach popover: Image / File / Draw quick actions. */
  const btnAttach = $("btnAttach");
  const popover = $("attachPopover");
  if (btnAttach && popover) {
    btnAttach.addEventListener("click", e => {
      e.stopPropagation();
      popover.hidden = !popover.hidden;
    });
    document.addEventListener("click", e => {
      if (popover.hidden) return;
      if (e.target.closest("#attachPopover") || e.target.closest("#btnAttach")) return;
      popover.hidden = true;
    });
    const sendFiles = async (filters) => {
      popover.hidden = true;
      const files = await window.api.pickFiles(filters);
      if (files && files.length) await addMessage($("messageInput").value, files);
    };
    $("attachImage").addEventListener("click", () =>
      sendFiles([{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }]));
    $("attachFile").addEventListener("click", () => sendFiles());
    $("attachDraw").addEventListener("click", () => { popover.hidden = true; openCanvas(); });
  }
}
