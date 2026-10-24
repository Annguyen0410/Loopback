/**
 * Pure event model for the World Monitor.
 *
 * The monitor used to keep only a visual log: every show() call built a row and
 * the event was gone. Nothing could filter it, search it, match it against a
 * watch rule, or tell a headline from an earthquake. This module is the small,
 * dependency-free core shared by the renderer and the tests:
 *
 *   normaliseEvent()  one shape for every source
 *   eventKey()        a stable key so a repeated poll is not a second event
 *   mergeEventList()  bounded, de-duplicated history (newest first)
 *   filterEventList() time / category / severity / text / country view
 *
 * It never invents a timestamp. A source that does not report an event time
 * gets `eventTime: null` and the UI says so; `observedAt` is when we saw it.
 */

import { countryCode, countryLabel } from "./country-codes.mjs";

export const MAX_EVENTS = 900;
export const MAX_NEWS_EVENTS = 420;
export const RETENTION_MS = 72 * 60 * 60 * 1000;

const SEV_RANK = { info: 0, warn: 1, crit: 2 };

const CATEGORY_ALIASES = {
  EQ: "QUAKE",
  EARTHQUAKE: "QUAKE",
  SEISMIC: "QUAKE",
  TC: "CYCLONE",
  TROPICAL_CYCLONE: "CYCLONE",
  FL: "FLOOD",
  VO: "VOLCANO",
  WF: "WILDFIRE",
  DR: "DROUGHT",
  CONFLICT: "CONFLICT",
  OUTAGE: "OUTAGE",
  CYBER: "CYBER",
  NEWS: "NEWS",
  ALERT: "ALERT",
  WEATHER: "WEATHER"
};

const FAMILIES = {
  QUAKE: "disaster",
  CYCLONE: "disaster",
  FLOOD: "disaster",
  VOLCANO: "disaster",
  WILDFIRE: "disaster",
  DROUGHT: "disaster",
  HAZARD: "disaster",
  DISASTER: "disaster",
  CONFLICT: "conflict",
  OUTAGE: "infrastructure",
  CYBER: "infrastructure",
  NEWS: "news",
  ALERT: "alert",
  WEATHER: "weather"
};

const CATEGORY_LABELS = {
  QUAKE: "Earthquake",
  CYCLONE: "Cyclone",
  FLOOD: "Flood",
  VOLCANO: "Volcano",
  WILDFIRE: "Wildfire",
  DROUGHT: "Drought",
  HAZARD: "Hazard",
  DISASTER: "Disaster",
  CONFLICT: "Conflict",
  OUTAGE: "Internet outage",
  CYBER: "Cyber",
  NEWS: "Headline",
  ALERT: "Alert",
  WEATHER: "Weather"
};

function text(value, max) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] || text(category, 24) || "Event";
}

export function categoryFamily(category) {
  return FAMILIES[category] || "other";
}

export function normaliseCategory(value, fallback = "EVENT") {
  const raw = text(value, 40).toUpperCase().replace(/[\s-]+/g, "_");
  return CATEGORY_ALIASES[raw] || raw || fallback;
}

export function normaliseSeverity(value) {
  const v = text(value, 12).toLowerCase();
  if (v === "critical" || v === "crit" || v === "red" || v === "high") return "crit";
  if (v === "warning" || v === "warn" || v === "orange" || v === "medium") return "warn";
  return "info";
}

export function severityRank(value) {
  return SEV_RANK[normaliseSeverity(value)] ?? 0;
}

/** https only, no credentials, no obvious local destination. */
export function safeExternalUrl(raw) {
  let u;
  try { u = new URL(String(raw || "")); } catch { return ""; }
  if (u.protocol !== "https:" || u.username || u.password) return "";
  const host = u.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return "";
  if (/^[\d.]+$/.test(host) || host.includes(":")) return "";
  u.hash = "";
  return u.toString();
}

/** Parse a source timestamp without silently replacing "unknown" with "now". */
export function parseEventTime(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

/** Stable 32-bit FNV-1a, enough for a local de-duplication key. */
function hash(input) {
  let h = 0x811c9dc5;
  const s = String(input);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function eventKey(input = {}) {
  const source = text(input.source || input.sourceName, 60).toLowerCase();
  const external = text(input.externalId || input.id || input.key, 180);
  if (external) return source + "|" + external;
  const url = safeExternalUrl(input.url);
  if (url) return source + "|" + url;
  return source + "|" + normaliseCategory(input.category || input.cat) + "|" +
    text(input.title, 180).toLowerCase() + "|" + (parseEventTime(input.eventTime || input.time) || "");
}

export function normaliseEvent(input = {}, { now = Date.now() } = {}) {
  const category = normaliseCategory(input.category || input.cat);
  const severity = normaliseSeverity(input.severity || input.sev);
  const eventTime = parseEventTime(input.eventTime || input.time);
  const observedAt = parseEventTime(input.observedAt || input.fetchedAt) || now;
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  const rawCountry = text(input.country, 60);
  const country = countryCode(rawCountry) || (/^[a-z]{2}$/i.test(rawCountry) ? rawCountry.toUpperCase() : rawCountry);
  const countryName = country ? countryLabel(country) : "";
  const source = text(input.source || input.sourceName || "Unknown source", 60);
  const title = text(input.title || input.headline, 240);

  return {
    id: text(input.id, 80) || ("ev-" + hash(eventKey({ ...input, category, source }))),
    dedupeKey: eventKey({ ...input, category, source }),
    category,
    family: categoryFamily(category),
    severity,
    title,
    summary: text(input.summary || input.description, 500),
    url: safeExternalUrl(input.url),
    source,
    sourceUrl: safeExternalUrl(input.sourceUrl),
    country,
    countryName,
    lat: hasPoint ? lat : null,
    lng: hasPoint ? lng : null,
    value: Number.isFinite(Number(input.value)) ? Number(input.value) : null,
    quality: ["official", "media", "derived", "reference", "unknown"].includes(input.quality)
      ? input.quality : "unknown",
    eventTime,
    observedAt,
    timeUnknown: !eventTime,
    ingestedAt: now
  };
}

function newestFirst(a, b) {
  return (b.eventTime || b.observedAt || 0) - (a.eventTime || a.observedAt || 0);
}

/**
 * Merge incoming events into the bounded history. Same key + same or older
 * observation is a no-op; a newer observation refreshes the record. The
 * caller gets the stored list, not a copy.
 */
export function mergeEventList(existing, incoming, {
  now = Date.now(),
  max = MAX_EVENTS,
  maxNews = MAX_NEWS_EVENTS,
  retentionMs = RETENTION_MS
} = {}) {
  const byKey = new Map();
  for (const raw of existing || []) {
    const ev = normaliseEvent(raw, { now });
    if (ev.title) byKey.set(ev.dedupeKey, ev);
  }
  for (const raw of incoming || []) {
    const ev = normaliseEvent(raw, { now });
    if (!ev.title) continue;
    const old = byKey.get(ev.dedupeKey);
    if (!old) { byKey.set(ev.dedupeKey, ev); continue; }
    if ((ev.observedAt || 0) >= (old.observedAt || 0)) {
      byKey.set(ev.dedupeKey, {
        ...old,
        ...ev,
        // A source can update a story without changing its publication time.
        eventTime: ev.eventTime || old.eventTime,
        ingestedAt: old.ingestedAt || ev.ingestedAt
      });
    }
  }
  const cutoff = now - Math.max(0, retentionMs);
  const sorted = [...byKey.values()]
    .filter(ev => (ev.eventTime || ev.observedAt || 0) >= cutoff)
    .sort(newestFirst);
  // Headlines arrive far faster than anything else. Without a per-category
  // cap they would evict every quake and disaster still inside the same 72 h.
  const kept = [];
  let news = 0;
  for (const event of sorted) {
    if (event.category === "NEWS") {
      if (news >= maxNews) continue;
      news++;
    }
    kept.push(event);
    if (kept.length >= Math.max(1, max)) break;
  }
  return kept;
}

export function eventMatchesCountry(event, country) {
  if (!event || !country) return false;
  const wantedCode = typeof country === "object"
    ? countryCode(country.iso || country.name)
    : countryCode(country);
  const eventCode = countryCode(event.country || event.countryName);
  if (wantedCode && eventCode) return wantedCode === eventCode;
  const wanted = text(typeof country === "object" ? (country.name || country.iso) : country, 60).toLowerCase();
  const value = text(event.countryName || event.country, 60).toLowerCase();
  return !!wanted && (value === wanted || value.includes(wanted) || wanted.includes(value));
}

function eventHaystack(event) {
  return [
    event.title,
    event.summary,
    event.source,
    event.country,
    event.category,
    categoryLabel(event.category)
  ].join(" ").toLowerCase();
}

/**
 * Newest-first view over the stored history. `from`/`to` are epoch ms; an
 * unknown event time is judged by its observation time so it remains usable,
 * while the UI still labels it as unknown.
 */
export function filterEventList(events, {
  from = null,
  to = null,
  categories = null,
  severities = null,
  query = "",
  country = null,
  limit = 200
} = {}) {
  const cats = categories ? new Set([...categories].map(c => normaliseCategory(c))) : null;
  const sevs = severities ? new Set([...severities].map(normaliseSeverity)) : null;
  const tokens = text(query, 120).toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const event of events || []) {
    const stamp = event.eventTime || event.observedAt || 0;
    if (from != null && stamp < from) continue;
    if (to != null && stamp > to) continue;
    if (cats && !cats.has(event.category)) continue;
    if (sevs && !sevs.has(normaliseSeverity(event.severity))) continue;
    if (country && !eventMatchesCountry(event, country)) continue;
    const hay = eventHaystack(event);
    if (tokens.length && !tokens.every(token => hay.includes(token))) continue;
    out.push(event);
  }
  out.sort(newestFirst);
  return out.slice(0, Math.max(0, limit));
}

export function summariseEventCounts(events) {
  const categories = new Map();
  const severities = { info: 0, warn: 0, crit: 0 };
  for (const event of events || []) {
    categories.set(event.category, (categories.get(event.category) || 0) + 1);
    const sev = normaliseSeverity(event.severity);
    severities[sev]++;
  }
  return {
    total: (events || []).length,
    categories: [...categories.entries()].sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, label: categoryLabel(id), count })),
    severities
  };
}

export function formatAge(timestamp, now = Date.now()) {
  if (!timestamp) return "unknown";
  const mins = Math.max(0, Math.round((now - timestamp) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return mins + "m ago";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + "h ago";
  return Math.floor(hours / 24) + "d ago";
}
