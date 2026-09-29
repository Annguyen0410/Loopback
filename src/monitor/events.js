/**
 * Live world-events log — a single chronological stream fed by the real
 * data modules (quakes, disasters, conflicts, outages, alerts). Entries are
 * de-duplicated across polls and rendered newest-first into #eventsLog.
 * The alert counter (#alertCount) reflects real warn/crit events.
 */

import { $, esc, pad } from "./utils.js";

const MAX = 120;
const seen = new Set();
let alertCount = 0;

/* Placeholder until the first live event arrives. */
(function initPlaceholder() {
  const el = document.getElementById("eventsLog");
  if (el) el.innerHTML = '<div class="ev-empty">Waiting for live events…</div>';
})();

/**
 * Record a world event. `key` de-duplicates across polls; `time` is the
 * event's own timestamp (falls back to now).
 */
export function logWorldEvent({ cat = "EVENT", sev = "info", title = "", time, key } = {}) {
  const k = key || (cat + "|" + (time || 0) + "|" + title);
  if (seen.has(k)) return;
  seen.add(k);
  if (seen.size > 400) { const first = seen.values().next().value; seen.delete(first); }

  const el = document.getElementById("eventsLog");
  if (el && !el.dataset.seeded) { el.innerHTML = ""; el.dataset.seeded = "1"; }
  const row = document.createElement("div");
  row.className = "ev-row";
  const d = new Date(time || Date.now());
  const ts = pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
  const sevCls = sev === "crit" ? "crit" : sev === "warn" ? "warn" : "info";
  row.innerHTML =
    '<span class="ev-time">' + ts + "</span>" +
    '<span class="ev-tag ' + sevCls + '">' + esc(cat) + "</span>" +
    '<span class="ev-text" title="' + esc(title) + '">' + esc(title) + "</span>";
  if (el) {
    el.insertBefore(row, el.firstChild);
    while (el.children.length > MAX) el.removeChild(el.lastChild);
  }

  if (sev === "crit" || sev === "warn") {
    alertCount++;
    renderAlertCount();
  }
}

function renderAlertCount() {
  const el = $("alertCount");
  if (el) el.textContent = alertCount.toLocaleString();
}
