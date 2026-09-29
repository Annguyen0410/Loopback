/** DOM access helpers. */

export const $ = id => document.getElementById(id);

export function onReady(fn) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
  else fn();
}

/**
 * Place a fixed-position popup next to a point or an anchor element so it is
 * always fully inside the window: it flips to the other side of the anchor
 * first, then clamps to a safe margin.
 *
 * The element must already be visible (not hidden) so its real size can be
 * measured — call this after unhiding it.
 *
 * opts:
 *   x, y    cursor position (used when there is no anchor)
 *   anchor  DOMRect to sit beside (menu opens to its right / below it)
 *   margin  min gap to the window edge (default 10)
 *   gap     space between the anchor and the popup (default 8)
 *   up      true → prefer opening above the point/anchor
 *
 * Returns { flippedX, flippedY } plus the applied left/top.
 */
export function placePopup(el, opts = {}) {
  if (!el) return null;
  const { x = 0, y = 0, anchor = null, margin = 10, gap = 8, up = false } = opts;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = el.offsetWidth || 180;
  const h = el.offsetHeight || 200;

  // Preferred spot: beside the anchor (or at the cursor) or above it.
  const right = anchor ? anchor.right + gap : x;
  const under = anchor ? anchor.top : y;
  const wrapX = right + w > vw - margin;
  const wrapY = up ? under - h < margin : under + h > vh - margin;

  let left = wrapX ? (anchor ? anchor.left - w - gap : x - w) : right;
  let top = wrapY ? (anchor ? anchor.bottom - h : y - h) : under;

  // Clamp — even a window too small to fit the popup keeps it on screen.
  left = Math.max(margin, Math.min(left, Math.max(margin, vw - w - margin)));
  top = Math.max(margin, Math.min(top, Math.max(margin, vh - h - margin)));

  el.style.left = Math.round(left) + "px";
  el.style.top = Math.round(top) + "px";
  // Grow the pop-in animation out of the corner closest to the anchor.
  el.style.transformOrigin = (wrapX ? "right" : "left") + " " + (wrapY ? "bottom" : "top");
  return { flippedX: wrapX, flippedY: wrapY, left: Math.round(left), top: Math.round(top) };
}
