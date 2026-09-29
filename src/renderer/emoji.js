/**
 * Emoji picker.
 */

import { $ } from "./dom.js";
import { toast } from "./toast.js";

const EMOJIS = ["😀","😂","😍","🥰","😎","🤔","😢","😡","👍","👎","❤️","🔥","🎉","🙏","💯","✨","😊","🤣","😘","🥺","😭","😤","🤝","👏","🙌","💪","🤞","✌️","🤟","🖐️","👋","🤚","💕","💖","💗","💙","💚","💛","🧡","💜","🤎","🖤","🤍","♥️","💘","💝","💟","⭐","🌟","💫","🌈","☀️","🌙","⚡","🎵","🎶","🎮","🎯","🏆","🎁","🎂","🍕","🍔","☕","🍺","🥂","🌹","🌸","🌺","🐶","🐱","🦊","🐻","🐼","🦁","🐯","🐸","🐵","🦄","🐝","🦋","🐢","🐬","🐳","🌍","🚀","✈️","🏠","💡","📱","💻","📷","🔑","🔒","📌","✏️","📝","✅","❌","⭕","❗","❓","💬","💭","👁️","🧠"];

function buildGrid(filter) {
  const grid = $("emojiGrid");
  if (!grid) return;
  grid.innerHTML = "";
  const list = filter ? EMOJIS.filter(e => e.includes(filter)) : EMOJIS;
  for (const em of list) {
    const btn = document.createElement("button");
    btn.className = "emoji-cell";
    btn.type = "button";
    btn.textContent = em;
    btn.addEventListener("click", () => {
      const inp = $("messageInput");
      if (inp) { inp.value += em; inp.focus(); }
    });
    grid.append(btn);
  }
}

export function initEmoji() {
  buildGrid();
  const btnEmoji = $("btnEmoji");
  if (btnEmoji) btnEmoji.addEventListener("click", e => {
    // Stop the global click-away handler from instantly closing the picker
    e.stopPropagation();
    const ep = $("emojiPicker");
    if (ep) ep.hidden = !ep.hidden;
    const tp = $("themePicker");
    if (tp) tp.hidden = true;
  });
  const emojiSearch = $("emojiSearch");
  if (emojiSearch) emojiSearch.addEventListener("input", () => buildGrid(emojiSearch.value));
}
