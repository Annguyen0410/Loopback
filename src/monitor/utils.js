/** Small pure helpers shared across monitor modules. */

export const $ = id => document.getElementById(id);
export const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); return el; };

export function pad(n) { return String(n).padStart(2, "0"); }
export function rng(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
export function rf(min, max) { return Math.random() * (max - min) + min; }

export function esc(t) {
  const s = document.createElement("span");
  s.textContent = t == null ? "" : String(t);
  return s.innerHTML;
}

/** The same, for inside an HTML attribute: `esc` leaves quotes alone, which is enough to break out of one. */
export function escAttr(t) {
  return esc(t).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * An href taken from a feed is untrusted input. Only an https URL with no credentials is allowed through;
 * anything else becomes `#` — a broken link, never a `javascript:`/`data:`/`file:` one. The window-open
 * handler in main checks again before the OS browser is launched, but the page must not even render the bad
 * value into an attribute.
 */
export function safeHref(raw) {
  let u;
  try { u = new URL(String(raw || "")); } catch { return "#"; }
  if (u.protocol !== "https:" || u.username || u.password) return "#";
  return u.toString();
}

export function fmtTime(t) {
  return new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtClock(d = new Date()) {
  return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
}

export function debounce(fn, ms) {
  let t = null;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}
