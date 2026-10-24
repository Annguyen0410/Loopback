/**
 * Live world-events log — the compact bottom strip over the normalized event
 * store in event-store.js. It remains a glanceable feed; the full filtered
 * timeline lives in the EVENTS tab.
 */

import { $, esc, escAttr, pad } from "./utils.js";
import { formatAge } from "./event-model.mjs";
import { getEvents, recordEvent, subscribeEvents } from "./event-store.js";

const MAX_ROWS = 40;

function renderAlertCount() {
  const el = $("alertCount");
  if (!el) return;
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const alerts = getEvents({ from: since, severities: ["warn", "crit"], limit: 600 })
    .filter(ev => ev.category !== "NEWS" && ev.category !== "ALERT");
  el.textContent = alerts.length.toLocaleString();
}

function timeLabel(event) {
  if (!event.eventTime) return "--:--";
  const d = new Date(event.eventTime);
  return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
}

export function renderEventsLog() {
  const el = $("eventsLog");
  if (!el) return;
  // Headlines have their own ticker; this strip is for operational events.
  const events = getEvents({ limit: 240 }).filter(event => event.category !== "NEWS").slice(0, MAX_ROWS);
  if (!events.length) {
    el.innerHTML = '<div class="ev-empty">Waiting for live events…</div>';
    renderAlertCount();
    return;
  }
  let html = "";
  for (const event of events) {
    const sev = event.severity === "crit" ? "crit" : event.severity === "warn" ? "warn" : "info";
    const when = event.timeUnknown
      ? "time not reported · observed " + formatAge(event.observedAt)
      : new Date(event.eventTime).toISOString().replace("T", " ").slice(0, 19) + "Z";
    const tip = when + " · " + event.source + (event.url ? " · click to open details" : "");
    html += '<div class="ev-row" data-event-id="' + escAttr(event.id) + '" tabindex="0" role="button" title="' + escAttr(tip) + '">' +
      '<span class="ev-time">' + timeLabel(event) + "</span>" +
      '<span class="ev-tag ' + sev + '">' + esc(event.category) + "</span>" +
      '<span class="ev-text">' + esc(event.title) + "</span>" +
      "</div>";
  }
  el.innerHTML = html;
  renderAlertCount();
}

/**
 * Record one event. Kept as the single call site used by every source module;
 * extra fields (source, url, lat/lng, country, value, quality) flow straight
 * into the normalized store.
 */
export function logWorldEvent({
  cat = "EVENT", sev = "info", title = "", time, key, source, sourceUrl, url,
  lat, lng, country, value, quality = "unknown", summary, observedAt
} = {}) {
  return recordEvent({
    category: cat,
    severity: sev,
    title,
    eventTime: time,
    externalId: key,
    source,
    sourceUrl,
    url,
    lat,
    lng,
    country,
    value,
    quality,
    summary,
    observedAt
  });
}

function focus(id) {
  if (!id) return;
  window.dispatchEvent(new CustomEvent("wm-focus-event", { detail: { id } }));
}

document.addEventListener("click", event => {
  const row = event.target.closest && event.target.closest("[data-event-id]");
  if (row) focus(row.getAttribute("data-event-id"));
});
document.addEventListener("keydown", event => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const row = event.target.closest && event.target.closest("[data-event-id]");
  if (!row) return;
  event.preventDefault();
  focus(row.getAttribute("data-event-id"));
});

subscribeEvents(renderEventsLog);
renderEventsLog();
