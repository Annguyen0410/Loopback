/** Toast notifications. */

import { $ } from "./dom.js";

let toastTimer = null;

/* The floating bubble is a real 56×248 (vertical) or 280×52 (horizontal)
   window — a long caption there wraps into a wall of text, so callers can
   pass a short form that is used only in those tiny windows. */
function tinyWindow() {
  return window.innerWidth < 340 || window.innerHeight < 120;
}

export function toast(msg, short) {
  const el = $("toast");
  if (!el) return;
  el.textContent = short && tinyWindow() ? short : msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2500);
}
