/**
 * Hover tooltips.
 *
 * The floating popup stacks eleven controls in one header, and "minimize",
 * "close" and "fill the screen" look alike at a glance — pressing the wrong one
 * used to cost the whole floating bar. Every control that carries a
 * description (`data-tip`, falling back to `title`) therefore says out loud
 * what it does on hover, instead of making the user click to find out.
 *
 * One element is parked on <body>: it sits under its target, flips above it
 * when the bottom of the window would cut it off, and never eats pointer
 * events. Inside the COLLAPSED bubble the window is 56px wide — nothing can be
 * painted outside it — so there the native `title` is left alone, because the
 * OS draws that one beyond the window bounds.
 */

const SHOW_DELAY = 200;   // long enough not to flicker while the mouse travels
const GAP = 9;            // distance from the target
const EDGE = 8;           // keep-away from the window edges

let tip = null;
let shown = null;         // element the visible tip belongs to
let timer = null;

function ensureTip() {
  if (tip && tip.isConnected) return tip;
  tip = document.createElement("div");
  tip.className = "tip";
  tip.setAttribute("role", "tooltip");
  document.body.append(tip);
  return tip;
}

function textFor(el) {
  return el.dataset.tip || el.getAttribute("title") || "";
}

/* A 56px-wide bubble can't hold a tooltip, and the OS already draws the native
   title outside the window there — so leave that case to the OS. */
function tooSmallForTip() {
  return document.body.classList.contains("pip-collapsed") || window.innerWidth < 320;
}

function positionFor(el, el_tip) {
  const r = el.getBoundingClientRect();
  const w = el_tip.offsetWidth;
  const h = el_tip.offsetHeight;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.min(Math.max(left, EDGE), Math.max(EDGE, window.innerWidth - w - EDGE));
  const below = r.bottom + GAP + h <= window.innerHeight - EDGE;
  const top = below ? r.bottom + GAP : Math.max(EDGE, r.top - GAP - h);
  return { left: Math.round(left), top: Math.round(top), arrow: Math.round(r.left + r.width / 2 - left), below };
}

function show(el) {
  const text = textFor(el);
  if (!text) return;
  const el_tip = ensureTip();
  el_tip.textContent = text;
  el_tip.classList.add("show");
  // Position after the text is in, so the measured box is the real one.
  const pos = positionFor(el, el_tip);
  el_tip.style.left = pos.left + "px";
  el_tip.style.top = pos.top + "px";
  el_tip.style.setProperty("--tip-arrow", Math.min(Math.max(pos.arrow, 12), el_tip.offsetWidth - 12) + "px");
  el_tip.classList.toggle("below", pos.below);
  el_tip.classList.toggle("above", !pos.below);
  el_tip.classList.toggle("wide", text.length > 90);
  shown = el;
  /* Suppress the native tooltip while ours is up, or both would appear. It is
     handed back untouched on the way out (tests and screen readers read it). */
  if (el.hasAttribute("title")) el.dataset.tipTitle = el.getAttribute("title");
  el.removeAttribute("title");
}

export function hideTip() {
  clearTimeout(timer);
  timer = null;
  if (shown) {
    if (shown.dataset.tipTitle && !shown.hasAttribute("title")) {
      shown.setAttribute("title", shown.dataset.tipTitle);
      delete shown.dataset.tipTitle;
    }
    shown = null;
  }
  if (tip) tip.classList.remove("show");
}

function targetOf(e) {
  const el = e.target && e.target.closest ? e.target.closest("[data-tip],button[title]") : null;
  if (!el || el === tip) return null;
  return el;
}

export function initTips() {
  document.addEventListener("pointerover", e => {
    const el = targetOf(e);
    if (!el) return;
    if (el === shown) { clearTimeout(timer); return; }  // moving inside the same control
    hideTip();
    if (tooSmallForTip()) return;
    timer = setTimeout(() => { if (el.isConnected) show(el); }, SHOW_DELAY);
  }, true);

  document.addEventListener("pointerout", e => {
    const el = targetOf(e);
    if (!el) return;
    // Leaving for a child of the same control is not leaving the control.
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    hideTip();
  }, true);

  /* Anything that moves the page (or the pointer) takes the tip with it — it is
     pinned to a fixed position, so it would otherwise hang in mid-air. */
  ["pointerdown", "wheel", "keydown"].forEach(ev =>
    window.addEventListener(ev, hideTip, true));
  window.addEventListener("blur", hideTip);
  window.addEventListener("resize", hideTip);
  document.addEventListener("scroll", hideTip, true);

  /* Hidden windows (tucked into the bar) must not keep a tip alive. */
  document.addEventListener("visibilitychange", () => { if (document.hidden) hideTip(); });
}
