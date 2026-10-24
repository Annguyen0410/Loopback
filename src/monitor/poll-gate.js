/**
 * Pauses the monitor's poll loops while its window is hidden.
 *
 * Closing, hiding or minimizing the monitor already stops the main-process feeds (main listens for those
 * events). The page's own loops — weather, GDACS, GDELT, IODA, air quality, aircraft, system status, clocks —
 * kept their timers running behind a hidden window. Chromium throttles a hidden renderer to about one timer a
 * minute, which is a mitigation, not a design: the work still happens and none of it is visible.
 *
 * This module replaces `window.setInterval` once, before any other monitor module registers a timer, with a
 * wrapper that skips a tick while `document.hidden` and records when each timer last really ran. When the
 * window becomes visible again, each timer that missed at least one interval runs once and resumes its normal
 * cadence — a fresh page, without the burst of every timer firing in the same second.
 *
 * It must stay the FIRST import of monitor/main.js: ES modules evaluate in import order, and the feed modules
 * register their top-level intervals while they are evaluated.
 */

const rawSetInterval = window.setInterval.bind(window);
const rawClearInterval = window.clearInterval.bind(window);
const timers = new Map(); // id -> { ms, run, last }
let nextId = 1;
let installed = false;

function runTimer(entry) {
  entry.last = Date.now();
  try { entry.run(); } catch (err) { console.warn("[Monitor] timer", err); }
}

export function installPollGate() {
  if (installed) return;
  installed = true;

  window.setInterval = (fn, ms, ...args) => {
    if (typeof fn !== "function") return rawSetInterval(fn, ms, ...args);
    const entry = {
      ms: Math.max(1, Number(ms) || 1),
      last: Date.now(),
      run: () => fn(...args)
    };
    const id = nextId++;
    // The real timer only exists to schedule; the callback itself is gated.
    entry.handle = rawSetInterval(() => { if (!document.hidden) runTimer(entry); }, entry.ms);
    timers.set(id, entry);
    return id;
  };

  window.clearInterval = id => {
    const entry = timers.get(id);
    if (entry) { rawClearInterval(entry.handle); timers.delete(id); return; }
    rawClearInterval(id);
  };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    const now = Date.now();
    for (const entry of timers.values()) {
      if (now - entry.last >= entry.ms) runTimer(entry);
    }
  });
}

installPollGate();
