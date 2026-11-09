/**
 * Renderer helpers.
 *
 * Pure formatting lives in `../shared/text.mjs` so it can be tested by Node
 * without a DOM. This file keeps the two browser-specific helpers and
 * re-exports the shared names, so every existing `./utils.js` import keeps
 * working.
 */

import {
  avClass,
  bytes,
  fmtDate,
  fmtTime,
  fold,
  foldMap,
  plainText
} from "../shared/text.mjs";

export { avClass, bytes, fmtDate, fmtTime, fold, foldMap, plainText };

export function uid() {
  try { return crypto.randomUUID(); } catch { return Date.now() + "-" + Math.random(); }
}

export function esc(t) {
  const s = document.createElement("span");
  s.textContent = t == null ? "" : String(t);
  return s.innerHTML;
}
