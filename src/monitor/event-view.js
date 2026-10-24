/**
 * EVENTS tab — the unified, filtered timeline over event-store.js.
 *
 * The old timeline could only scrub the earthquake layer. This view keeps
 * every category in one list, shows whether a source reported a time or only
 * an observation time, and lets a row open its details and (when coordinates
 * exist) center the existing Leaflet map.
 */

import { $, esc, escAttr, safeHref } from "./utils.js";
import { categoryLabel, eventMatchesCountry, formatAge } from "./event-model.mjs";
import { allEvents, eventById, getEvents, subscribeEvents } from "./event-store.js";
import { renderTrending } from "./trending.js";
import { map } from "./map-engine.js";

const state = {
  hours: 24,
  category: "",
  severity: "",
  query: "",
  country: "",
  countryLabel: "",
  selected: "",
  wired: false,
  activate: null
};

const MAX_ROWS = 150;

function hoursToMs(hours) { return Number(hours) * 60 * 60 * 1000; }

function stamp(event) {
  return event.eventTime || event.observedAt || 0;
}

function selectedEvent() {
  return state.selected ? eventById(state.selected) : null;
}

function timeText(event) {
  if (!event.eventTime) return "--:--";
  const d = new Date(event.eventTime);
  return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
}

function refreshCategoryOptions() {
  const select = $("evCategory");
  if (!select) return;
  const current = select.value;
  const seen = new Set();
  let html = '<option value="">All categories</option>';
  for (const event of allEvents()) {
    if (seen.has(event.category)) continue;
    seen.add(event.category);
    html += '<option value="' + escAttr(event.category) + '">' + esc(categoryLabel(event.category)) + "</option>";
  }
  select.innerHTML = html;
  select.value = current;
}

function applyFilters() {
  const now = Date.now();
  const from = now - hoursToMs(state.hours);
  let rows = getEvents({
    from,
    to: now,
    category: null,
    categories: state.category ? [state.category] : null,
    severities: state.severity ? [state.severity] : null,
    query: state.query,
    country: state.country || null,
    limit: MAX_ROWS
  });
  // `state.country` is either an ISO code or a name; the shared normalizer
  // resolves both without guessing from a headline.
  if (state.country) rows = rows.filter(event => eventMatchesCountry(event, state.country));
  return rows;
}

function renderCountryChip() {
  const chip = $("evCountryChip");
  if (!chip) return;
  if (!state.country) { chip.hidden = true; chip.textContent = ""; return; }
  chip.hidden = false;
  chip.innerHTML = "Country: " + esc(state.countryLabel || state.country) + ' <span class="ev-chip-x" aria-hidden="true">✕</span>';
}

function renderList() {
  const list = $("evList");
  const count = $("evCount");
  if (!list) return;
  const rows = applyFilters();
  if (count) {
    count.textContent = rows.length + " event" + (rows.length === 1 ? "" : "s") +
      " · last " + state.hours + "h" + (state.country ? " · " + (state.countryLabel || state.country) : "");
  }
  if (!rows.length) {
    const failed = $("evFeedError");
    list.innerHTML = '<div class="panel-empty">' +
      (failed && failed.textContent ? "No matching events — some feeds are offline (see FEED STATUS)." : "No matching events in this window.") +
      "</div>";
    return;
  }
  let html = "";
  for (const event of rows) {
    const sev = event.severity === "crit" ? "crit" : event.severity === "warn" ? "warn" : "info";
    const selected = event.id === state.selected ? " selected" : "";
    const where = event.country ? " · " + (event.countryName || event.country) : "";
    html += '<div class="evt-row ' + sev + selected + '" data-event-id="' + escAttr(event.id) + '" tabindex="0" role="button" aria-label="' +
      escAttr(categoryLabel(event.category) + ": " + event.title) + '">' +
      '<span class="evt-time">' + timeText(event) + "</span>" +
      '<span class="evt-sev ' + sev + '"></span>' +
      '<span class="evt-body"><span class="evt-cat">' + esc(event.category) + "</span>" +
      '<span class="evt-title">' + esc(event.title) + "</span>" +
      '<span class="evt-meta">' + esc(event.source) + " · " + esc(event.timeUnknown ? "time not reported" : formatAge(event.eventTime)) + where + "</span></span>" +
      "</div>";
  }
  list.innerHTML = html;
  renderCountryChip();
}

function renderDetail() {
  const box = $("evDetail");
  const event = selectedEvent();
  if (!box) return;
  if (!event) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  const when = event.eventTime
    ? new Date(event.eventTime).toISOString().replace("T", " ").slice(0, 19) + " UTC"
    : "Not reported by the source";
  const observed = new Date(event.observedAt).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const point = event.lat != null && event.lng != null
    ? event.lat.toFixed(2) + ", " + event.lng.toFixed(2)
    : "No coordinates reported";
  const sourceLink = event.url
    ? '<a class="evd-link" href="' + safeHref(event.url) + '" target="_blank" rel="noopener">Open at source ↗</a>'
    : '<span class="evd-muted">No source link</span>';
  box.innerHTML =
    '<div class="evd-head"><span class="evt-cat">' + esc(event.category) + "</span>" +
    '<span class="evd-sev ' + event.severity + '">' + esc(event.severity.toUpperCase()) + "</span>" +
    '<button class="evd-close" id="evdClose" title="Close details" aria-label="Close details">✕</button></div>' +
    '<div class="evd-title">' + esc(event.title) + "</div>" +
    (event.summary ? '<div class="evd-summary">' + esc(event.summary) + "</div>" : "") +
    '<div class="evd-rows">' +
    '<div><span>Event time</span><b>' + esc(when) + "</b></div>" +
    '<div><span>Observed</span><b>' + esc(observed) + " · " + esc(formatAge(event.observedAt)) + "</b></div>" +
    '<div><span>Source</span><b>' + esc(event.source) + " · " + esc(event.quality) + "</b></div>" +
    '<div><span>Location</span><b>' + esc(point) + (event.country ? " · " + esc(event.countryName || event.country) : "") + "</b></div>" +
    "</div>" +
    '<div class="evd-actions">' + sourceLink +
    (event.lat != null && event.lng != null ? '<button class="evd-btn" id="evdMap">Center map</button>' : "") +
    "</div>";
  const close = $("evdClose");
  if (close) close.onclick = () => { state.selected = ""; box.hidden = true; renderList(); };
  const center = $("evdMap");
  if (center) center.onclick = () => centerOn(event);
}

function centerOn(event) {
  if (!map || event.lat == null || event.lng == null || typeof L === "undefined") return;
  map.setView([event.lat, event.lng], Math.max(map.getZoom(), 5));
  const html = '<div class="popup-mag">' + esc(categoryLabel(event.category)) + "</div>" +
    '<div class="popup-place">' + esc(event.title) + "</div>" +
    '<div class="popup-row"><span class="popup-label">Source</span><span class="popup-value">' + esc(event.source) + "</span></div>";
  L.popup({ maxWidth: 320 }).setLatLng([event.lat, event.lng]).setContent(html).openOn(map);
}

export function selectEvent(id) {
  if (!id) return;
  state.selected = id;
  renderList();
  renderDetail();
  const row = document.querySelector('.evt-row[data-event-id="' + CSS.escape(id) + '"]');
  if (row) row.scrollIntoView({ block: "nearest" });
}

export function focusEvent(id) {
  if (!id) return;
  state.hours = 72;
  state.category = "";
  state.severity = "";
  state.query = "";
  state.country = "";
  state.countryLabel = "";
  syncControls();
  if (state.activate) state.activate("events");
  selectEvent(id);
}

export function focusCountryEvents(country) {
  const name = typeof country === "string" ? country : (country && (country.name || country.iso)) || "";
  const iso = typeof country === "object" && country ? country.iso : "";
  state.hours = 72;
  state.category = "";
  state.severity = "";
  state.query = "";
  state.country = name || iso;
  state.countryLabel = name || iso;
  syncControls();
  if (state.activate) state.activate("events");
  renderEventsTab();
}

function syncControls() {
  const time = $("evTime");
  const category = $("evCategory");
  const severity = $("evSeverity");
  const search = $("evSearch");
  if (time) time.value = String(state.hours);
  if (category) category.value = state.category;
  if (severity) severity.value = state.severity;
  if (search) search.value = state.query;
}

export function renderEventsTab() {
  refreshCategoryOptions();
  renderList();
  renderDetail();
  renderTrending();
}

export function initEventView({ activate } = {}) {
  if (state.wired) {
    if (activate) state.activate = activate;
    return;
  }
  state.wired = true;
  state.activate = activate || state.activate;

  const search = $("evSearch");
  const time = $("evTime");
  const category = $("evCategory");
  const severity = $("evSeverity");
  if (search) search.addEventListener("input", () => {
    state.query = search.value;
    state.selected = "";
    renderList();
    renderDetail();
  });
  if (time) time.addEventListener("change", () => {
    state.hours = Number(time.value) || 24;
    renderList();
  });
  if (category) category.addEventListener("change", () => {
    state.category = category.value;
    renderList();
  });
  if (severity) severity.addEventListener("change", () => {
    state.severity = severity.value;
    renderList();
  });
  const chip = $("evCountryChip");
  if (chip) chip.addEventListener("click", () => {
    state.country = "";
    state.countryLabel = "";
    renderList();
  });
  const list = $("evList");
  if (list) {
    list.addEventListener("click", event => {
      const row = event.target.closest && event.target.closest(".evt-row");
      if (row) selectEvent(row.getAttribute("data-event-id"));
    });
    list.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const row = event.target.closest && event.target.closest(".evt-row");
      if (!row) return;
      event.preventDefault();
      selectEvent(row.getAttribute("data-event-id"));
    });
  }
  window.addEventListener("wm-focus-event", event => {
    const id = event.detail && event.detail.id;
    if (id) focusEvent(id);
  });
  subscribeEvents(() => {
    refreshCategoryOptions();
    if ($("sbEvents") && $("sbEvents").classList.contains("active")) {
      renderList();
      renderDetail();
      renderTrending();
    }
  });
  refreshCategoryOptions();
  renderList();
}
