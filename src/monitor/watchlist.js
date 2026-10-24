/**
 * WATCH tab — user-owned rules over the normalized event store.
 *
 * The old alert engine had one hard-coded M6+ quake rule. These rules are
 * local, editable, disabled individually, de-duplicated by event and cooled
 * down per rule. A rule firing never fabricates an event: it can only match a
 * record that a real feed already produced.
 */

import { $, esc, escAttr, safeHref } from "./utils.js";
import { categoryLabel, formatAge } from "./event-model.mjs";
import { collectMatches, normaliseRule, ruleLabel } from "./watch-model.mjs";
import { subscribeEvents } from "./event-store.js";
import { COUNTRIES } from "./country-risk.js";
import { focusEvent } from "./event-view.js";
import { logThreat, playAlertTone } from "./alerts.js";

const RULES_KEY = "wm_watch_rules_v2";
const HISTORY_KEY = "wm_watch_history_v2";
const COOLDOWN_MS = 10 * 60 * 1000;
const MAX_HISTORY = 60;

let rules = loadRules();
let history = loadHistory();
let editing = "";
let started = Date.now();
let wired = false;

function uid() {
  return "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

function loadRules() {
  try {
    const raw = JSON.parse(localStorage.getItem(RULES_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.map(rule => {
      const normalized = normaliseRule(rule);
      if (!normalized.id) normalized.id = uid();
      return normalized;
    }).filter(rule => rule.value);
  } catch { return []; }
}

function saveRules() {
  try { localStorage.setItem(RULES_KEY, JSON.stringify(rules.slice(0, 40))); } catch { /* local quota */ }
}

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(row => row && row.key && row.eventId).slice(0, MAX_HISTORY);
  } catch { return []; }
}

function saveHistory() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY))); } catch { /* local quota */ }
}

function lastFiredMap() {
  const out = {};
  for (const row of history) {
    if (!row.ruleId) continue;
    out[row.ruleId] = Math.max(out[row.ruleId] || 0, Number(row.at) || 0);
  }
  return out;
}

function seenKeys() {
  return new Set(history.map(row => row.key).filter(Boolean));
}

function setError(message = "") {
  const el = $("watchError");
  if (el) { el.textContent = message; el.hidden = !message; }
}

function syncKindFields() {
  const kind = ($("watchKind") || {}).value || "keyword";
  const value = $("watchValue");
  const category = $("watchCategory");
  const number = $("watchNumber");
  if (value) {
    value.hidden = kind === "category" || kind === "magnitude";
    value.placeholder = kind === "country" ? "Country name or ISO (e.g. VN)" : "e.g. ceasefire, Taiwan, port";
  }
  if (category) category.hidden = kind !== "category";
  if (number) number.hidden = kind !== "magnitude";
}

function ensureNotificationPermission() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    try { Notification.requestPermission().catch(() => {}); } catch { /* embedded webview */ }
  }
}

function notify(rule, event) {
  if (!rule.notify || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification("Loopback Monitor · " + ruleLabel(rule), {
      body: event.title,
      silent: true
    });
    n.onclick = () => { try { window.focus(); } catch {} focusEvent(event.id); };
  } catch { /* notification is optional */ }
}

function toast(rule, event) {
  let box = $("watchToasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "watchToasts";
    box.className = "watch-toasts";
    document.body.append(box);
  }
  const item = document.createElement("div");
  item.className = "watch-toast sev-" + event.severity;
  item.dataset.eventId = event.id;
  item.innerHTML = '<span class="watch-toast-rule">' + esc(ruleLabel(rule)) + "</span>" +
    '<span class="watch-toast-title">' + esc(event.title) + "</span>" +
    '<span class="watch-toast-meta">' + esc(event.source) + " · " + esc(formatAge(event.observedAt)) + "</span>";
  item.addEventListener("click", () => {
    item.remove();
    focusEvent(event.id);
  });
  box.append(item);
  setTimeout(() => { try { item.remove(); } catch {} }, 8000);
}

function evaluate(events) {
  if (!rules.length || !Array.isArray(events) || !events.length) return;
  const now = Date.now();
  const fired = lastFiredMap();
  const seen = seenKeys();
  const matches = collectMatches(
    events.filter(event => (event.observedAt || 0) >= started),
    rules,
    { now, lastFired: fired, seenKeys: seen, cooldownMs: COOLDOWN_MS }
  );
  if (!matches.length) return;
  for (const match of matches) {
    const { rule, event, key } = match;
    history.unshift({
      key,
      ruleId: rule.id,
      label: ruleLabel(rule),
      eventId: event.id,
      title: event.title,
      url: event.url,
      source: event.source,
      severity: event.severity,
      at: now
    });
    logThreat(event.severity, "[" + ruleLabel(rule) + "] " + event.title);
    if (rule.sound) playAlertTone(event.severity);
    notify(rule, event);
    toast(rule, event);
  }
  history = history.slice(0, MAX_HISTORY);
  saveHistory();
  if ($("sbWatch") && $("sbWatch").classList.contains("active")) renderWatchTab();
}

function countryFromInput(value) {
  const needle = String(value || "").trim().toLowerCase();
  if (!needle) return null;
  return COUNTRIES.find(c => c.iso.toLowerCase() === needle || c.name.toLowerCase() === needle) ||
    COUNTRIES.find(c => c.name.toLowerCase().includes(needle)) || null;
}

function readForm() {
  const kind = ($("watchKind") || {}).value || "keyword";
  const severity = ($("watchSeverity") || {}).value || "info";
  const sound = !!($("watchSound") && $("watchSound").checked);
  const notifyOn = !!($("watchNotify") && $("watchNotify").checked);
  let value = "";
  let label = "";
  if (kind === "keyword") {
    value = String(($("watchValue") || {}).value || "").trim();
    if (!value) return { error: "Enter a keyword or phrase." };
  } else if (kind === "country") {
    const country = countryFromInput(($("watchValue") || {}).value);
    if (!country) return { error: "Pick one of the tracked countries." };
    value = country.iso;
    label = "Country · " + country.name;
  } else if (kind === "category") {
    value = String(($("watchCategory") || {}).value || "").trim();
    if (!value) return { error: "Pick a category." };
    label = "Category · " + categoryLabel(value);
  } else if (kind === "magnitude") {
    const n = Number(($("watchNumber") || {}).value);
    if (!Number.isFinite(n) || n < 0 || n > 10) return { error: "Magnitude must be between 0 and 10." };
    value = String(n);
    label = "Magnitude ≥ " + n;
  }
  return {
    kind,
    value,
    label,
    minSeverity: severity,
    sound,
    notify: notifyOn
  };
}

function resetForm() {
  editing = "";
  const title = $("watchFormTitle");
  const add = $("watchAdd");
  const cancel = $("watchCancel");
  if (title) title.textContent = "NEW RULE";
  if (add) add.textContent = "ADD RULE";
  if (cancel) cancel.hidden = true;
  const value = $("watchValue");
  if (value) value.value = "";
  const number = $("watchNumber");
  if (number) number.value = "";
  const notify = $("watchNotify");
  if (notify) notify.checked = false;
  setError("");
  syncKindFields();
}

function saveForm() {
  const parsed = readForm();
  if (parsed.error) { setError(parsed.error); return; }
  setError("");
  const existing = editing ? rules.find(rule => rule.id === editing) : null;
  const rule = normaliseRule({
    ...parsed,
    id: existing ? existing.id : uid(),
    enabled: existing ? existing.enabled : true,
    createdAt: existing ? existing.createdAt : Date.now()
  });
  if (existing) Object.assign(existing, rule);
  else rules.unshift(rule);
  if (rule.notify) ensureNotificationPermission();
  saveRules();
  resetForm();
  renderRules();
}

function renderRules() {
  const el = $("watchRules");
  if (!el) return;
  if (!rules.length) {
    el.innerHTML = '<div class="panel-empty">No rules yet. Add a keyword, a country, a category or a magnitude floor.</div>';
    return;
  }
  let html = "";
  for (const rule of rules) {
    html += '<div class="watch-rule' + (rule.enabled ? "" : " off") + '" data-rule-id="' + escAttr(rule.id) + '">' +
      '<label class="watch-switch" title="Enable or disable this rule"><input type="checkbox" data-watch-toggle="' + escAttr(rule.id) + '"' + (rule.enabled ? " checked" : "") + '><span></span></label>' +
      '<span class="watch-rule-main"><span class="watch-rule-label">' + esc(ruleLabel(rule)) + "</span>" +
      '<span class="watch-rule-meta">' + esc(rule.minSeverity.toUpperCase()) + (rule.sound ? " · tone" : "") + (rule.notify ? " · desktop" : "") + "</span></span>" +
      '<button class="watch-icon" data-watch-edit="' + escAttr(rule.id) + '" title="Edit rule" aria-label="Edit rule">✎</button>' +
      '<button class="watch-icon danger" data-watch-del="' + escAttr(rule.id) + '" title="Delete rule" aria-label="Delete rule">✕</button>' +
      "</div>";
  }
  el.innerHTML = html;
}

function renderHistory() {
  const el = $("watchHistory");
  const count = $("watchHistoryCount");
  if (count) count.textContent = String(history.length);
  if (!el) return;
  if (!history.length) {
    el.innerHTML = '<div class="panel-empty">No rule has fired yet.</div>';
    return;
  }
  let html = "";
  for (const row of history) {
    html += '<div class="watch-hit">' +
      '<div class="watch-hit-title">' + (row.url
        ? '<a href="' + safeHref(row.url) + '" target="_blank" rel="noopener">' + esc(row.title) + "</a>"
        : esc(row.title)) + "</div>" +
      '<div class="watch-hit-meta"><span>' + esc(row.label) + "</span><span>" + esc(row.source || "") + " · " + esc(formatAge(row.at)) + "</span></div>" +
      "</div>";
  }
  el.innerHTML = html;
}

export function renderWatchTab() {
  renderRules();
  renderHistory();
  syncKindFields();
}

function wire() {
  if (wired) return;
  wired = true;
  const kind = $("watchKind");
  if (kind) kind.addEventListener("change", syncKindFields);
  const add = $("watchAdd");
  if (add) add.addEventListener("click", saveForm);
  const cancel = $("watchCancel");
  if (cancel) cancel.addEventListener("click", resetForm);
  const clear = $("watchClearHistory");
  if (clear) clear.addEventListener("click", () => {
    history = [];
    saveHistory();
    renderHistory();
  });
  const list = $("watchRules");
  if (list) {
    list.addEventListener("change", event => {
      const id = event.target && event.target.getAttribute ? event.target.getAttribute("data-watch-toggle") : "";
      if (!id) return;
      const rule = rules.find(item => item.id === id);
      if (!rule) return;
      rule.enabled = !!event.target.checked;
      saveRules();
      renderRules();
    });
    list.addEventListener("click", event => {
      const edit = event.target.closest && event.target.closest("[data-watch-edit]");
      if (edit) {
        const rule = rules.find(item => item.id === edit.getAttribute("data-watch-edit"));
        if (!rule) return;
        editing = rule.id;
        const title = $("watchFormTitle");
        const save = $("watchAdd");
        const cancel = $("watchCancel");
        if (title) title.textContent = "EDIT RULE";
        if (save) save.textContent = "SAVE RULE";
        if (cancel) cancel.hidden = false;
        if ($("watchKind")) $("watchKind").value = rule.kind;
        if ($("watchSeverity")) $("watchSeverity").value = rule.minSeverity;
        if ($("watchSound")) $("watchSound").checked = rule.sound;
        if ($("watchNotify")) $("watchNotify").checked = rule.notify;
        if (rule.kind === "category" && $("watchCategory")) $("watchCategory").value = rule.value;
        else if (rule.kind === "magnitude" && $("watchNumber")) $("watchNumber").value = rule.value;
        else if ($("watchValue")) {
          const country = rule.kind === "country" ? countryFromInput(rule.value) : null;
          $("watchValue").value = country ? country.name : rule.value;
        }
        syncKindFields();
        return;
      }
      const del = event.target.closest && event.target.closest("[data-watch-del]");
      if (del) {
        rules = rules.filter(item => item.id !== del.getAttribute("data-watch-del"));
        saveRules();
        if (editing === del.getAttribute("data-watch-del")) resetForm();
        renderRules();
      }
    });
  }
  const form = $("watchForm");
  if (form) form.addEventListener("keydown", event => {
    if (event.key === "Enter" && event.target && event.target.tagName !== "BUTTON") {
      event.preventDefault();
      saveForm();
    }
  });
}

export function initWatchlist() {
  wire();
  renderWatchTab();
  subscribeEvents(evaluate);
}

export { evaluate as evaluateWatchRules };
