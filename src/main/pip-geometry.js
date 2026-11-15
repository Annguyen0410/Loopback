'use strict';

/**
 * Floating-bar (PiP) geometry and visibility rules.
 *
 * The bar is a small frameless, transparent, always-on-top window that parks
 * against a screen edge. Everything that decides *where* it may sit, and
 * whether the user can see it at all, lives here — no Electron, no DOM — so the
 * rules can be checked against real monitor layouts instead of a real desktop.
 *
 * The rules exist because of one reported bug: "sometimes pressing minimize
 * shows no floating bar at all". Electron happily keeps a window at x = -20000,
 * and a `pip.json` written on a monitor that is no longer attached, a bar parked
 * outside every display for a screenshot, or a bar dragged to a 24px sliver all
 * end the same way: a window that is "open" and invisible. A request to show the
 * bar is therefore a decision, not a resize:
 *
 *   create   → there is no window yet
 *   collapse → an expanded popup has to become the bar first
 *   relocate → the window is off every display and must be pulled back
 *   show     → it exists, collapsed and on screen: (re)show it
 *
 * Sizes are owned here too, so the window that gets created and the rectangle
 * that gets clamped cannot disagree about how big the bar is.
 */

/** How much of the bar must overlap a display before it counts as visible. */
const MIN_VISIBLE = 24;
/** Gap between a docked bar and the screen edge. */
const DOCK_GAP = 6;
/** Collapsed bubble sizes at scale 1 — vertical bookmark tab / horizontal pill. */
const BUBBLE_V = Object.freeze({ w: 56, h: 286 });
const BUBBLE_H = Object.freeze({ w: 320, h: 52 });

const finite = n => typeof n === 'number' && Number.isFinite(n);
const int = n => Math.round(n);

/**
 * A rectangle with real numbers and a positive size, or null. Every entry point
 * runs through this: a `NaN` from a corrupted pip.json or a missing width must
 * never reach `setBounds`.
 */
function normalizeRect(rect) {
  if (!rect || typeof rect !== 'object') return null;
  if (!finite(rect.x) || !finite(rect.y)) return null;
  if (!finite(rect.width) || !finite(rect.height)) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { x: int(rect.x), y: int(rect.y), width: int(rect.width), height: int(rect.height) };
}

/** A display work area (negative coordinates on a monitor left of the primary). */
function normalizeArea(area) {
  if (!area || typeof area !== 'object') return null;
  if (!finite(area.x) || !finite(area.y)) return null;
  if (!finite(area.width) || !finite(area.height)) return null;
  if (area.width <= 0 || area.height <= 0) return null;
  return { x: int(area.x), y: int(area.y), width: int(area.width), height: int(area.height) };
}

function normalizeAreas(workAreas) {
  if (!Array.isArray(workAreas)) return [];
  return workAreas.map(normalizeArea).filter(Boolean);
}

function minVisibleOf(opts) {
  const raw = opts && opts.minVisible;
  return finite(raw) && raw >= 0 ? raw : MIN_VISIBLE;
}

/** Overlap of two rectangles: `{ w, h, area }`, all zero when they miss. */
function overlap(bounds, area) {
  const b = normalizeRect(bounds);
  const a = normalizeArea(area);
  if (!b || !a) return { w: 0, h: 0, area: 0 };
  const w = Math.max(0, Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x));
  const h = Math.max(0, Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y));
  return { w, h, area: w * h };
}

/** Centre point of a rect (used to pick "its" display). */
function centerOf(bounds) {
  const b = normalizeRect(bounds);
  if (!b) return null;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

function pointInArea(point, area) {
  if (!point || !area) return false;
  return point.x >= area.x && point.x < area.x + area.width &&
    point.y >= area.y && point.y < area.y + area.height;
}

/** Shortest distance from a point to a rectangle (0 when it is inside). */
function distanceToArea(point, area) {
  const p = point || { x: 0, y: 0 };
  const a = normalizeArea(area);
  if (!a) return Infinity;
  const dx = p.x < a.x ? a.x - p.x : p.x > a.x + a.width ? p.x - (a.x + a.width) : 0;
  const dy = p.y < a.y ? a.y - p.y : p.y > a.y + a.height ? p.y - (a.y + a.height) : 0;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * True when enough of the bar overlaps a display that a person can see and
 * click it: `minVisible` px in both directions on at least one work area.
 */
function isOnScreen(bounds, workAreas, opts) {
  const b = normalizeRect(bounds);
  if (!b) return false;
  const areas = normalizeAreas(workAreas);
  if (!areas.length) return false;
  const need = minVisibleOf(opts);
  const needW = Math.min(need, b.width);
  const needH = Math.min(need, b.height);
  return areas.some(a => {
    const o = overlap(b, a);
    return o.w >= needW && o.h >= needH;
  });
}

/** Move a rect fully inside one work area, keeping its size (aligned when it cannot fit). */
function clampInto(bounds, area) {
  const b = normalizeRect(bounds);
  const a = normalizeArea(area);
  if (!b) return null;
  if (!a) return b;
  const x = b.width >= a.width ? a.x : Math.min(Math.max(b.x, a.x), a.x + a.width - b.width);
  const y = b.height >= a.height ? a.y : Math.min(Math.max(b.y, a.y), a.y + a.height - b.height);
  return { x: int(x), y: int(y), width: b.width, height: b.height };
}

/**
 * The display a rect belongs to: the one that contains its centre, else the
 * nearest one, else `fallback`, else the first. `null` only with no displays.
 */
function pickWorkArea(point, workAreas, fallback) {
  const areas = normalizeAreas(workAreas);
  if (!areas.length) return normalizeArea(fallback);
  for (const a of areas) if (pointInArea(point, a)) return a;
  if (point) {
    let best = null;
    let bestD = Infinity;
    for (const a of areas) {
      const d = distanceToArea(point, a);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best) return best;
  }
  return normalizeArea(fallback) || areas[0];
}

/**
 * Guarantee a rect on a display that exists right now.
 *
 * Returns `{ bounds, moved, reason }`. `bounds` is null only when the input
 * rectangle itself is unusable; a display-less session keeps the rect as-is
 * (`reason: "no-displays"`) instead of inventing coordinates.
 */
function ensureOnScreen(bounds, workAreas, opts) {
  const b = normalizeRect(bounds);
  if (!b) return { bounds: null, moved: false, reason: 'invalid' };
  const areas = normalizeAreas(workAreas);
  if (!areas.length) return { bounds: b, moved: false, reason: 'no-displays' };
  if (isOnScreen(b, areas, opts)) return { bounds: b, moved: false, reason: null };
  const area = pickWorkArea(centerOf(b), areas, null) || areas[0];
  return { bounds: clampInto(b, area), moved: true, reason: 'off-screen' };
}

/**
 * Where a docked bar sits: flush against one edge with a small gap, vertically
 * centred in the work area (the taskbar-safe area, not the raw display bounds).
 */
function dockBounds(area, size, side, gap) {
  const a = normalizeArea(area);
  const s = normalizeRect({
    x: 0, y: 0,
    width: size && size.w, height: size && size.h
  });
  if (!a || !s) return null;
  const g = finite(gap) && gap >= 0 ? gap : DOCK_GAP;
  return {
    x: side === 'left' ? a.x + g : a.x + a.width - s.width - g,
    y: a.y + Math.max(g, int((a.height - s.height) / 2)),
    width: s.width,
    height: s.height
  };
}

/** Clamp a persisted scale into the range the settings slider can produce. */
function normalizeScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(1.6, Math.max(0.6, n));
}

/** Collapsed bar size for an orientation and a saved scale. */
function bubbleSize(vertical, scale) {
  const s = normalizeScale(scale);
  const base = vertical === false ? BUBBLE_H : BUBBLE_V;
  return { w: int(base.w * s), h: int(base.h * s) };
}

/** A saved `pip.json` position, or null when it is missing or unusable. */
function savedPosition(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  if (!finite(cfg.x) || !finite(cfg.y)) return null;
  return { x: int(cfg.x), y: int(cfg.y) };
}

/**
 * What a "show me the bar" request has to do, given the state the window is in.
 * Pure so the decision can be tested for every combination — including the one
 * that used to do nothing at all (exists + collapsed + hidden).
 */
function barPlan(state) {
  const s = state || {};
  if (!s.exists) return 'create';
  if (!s.collapsed) return 'collapse';
  if (s.offScreen) return 'relocate';
  return 'show';
}

module.exports = {
  MIN_VISIBLE,
  DOCK_GAP,
  BUBBLE_V,
  BUBBLE_H,
  normalizeRect,
  normalizeArea,
  normalizeAreas,
  overlap,
  centerOf,
  pointInArea,
  distanceToArea,
  isOnScreen,
  clampInto,
  pickWorkArea,
  ensureOnScreen,
  dockBounds,
  normalizeScale,
  bubbleSize,
  savedPosition,
  barPlan
};
