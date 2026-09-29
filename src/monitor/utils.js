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
