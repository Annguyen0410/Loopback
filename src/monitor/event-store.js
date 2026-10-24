/**
 * The Monitor's one event history.
 *
 * `events.js` used to render each event into a DOM row and forget it. This
 * store keeps the same normalized records for the timeline, command palette,
 * country brief, watchlist and trends. It is bounded in memory, pruned by age,
 * and persisted only as a small recent window so a reload does not start blank
 * (local-first, not an archive).
 */

import {
  MAX_EVENTS,
  RETENTION_MS,
  filterEventList,
  mergeEventList,
  normaliseEvent,
  summariseEventCounts
} from "./event-model.mjs";

const KEY = "wm_events_v2";
const PERSIST_MAX = 260;
const listeners = new Set();
let events = load();

function storage() {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function load() {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return mergeEventList([], parsed, { now: Date.now() });
  } catch {
    return [];
  }
}

function persist() {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(events.slice(0, PERSIST_MAX)));
  } catch {
    // A full quota must not stop the live log. The in-memory history remains.
  }
}

function emit(added) {
  if (!added.length) return;
  for (const fn of [...listeners]) {
    try { fn(added, events); } catch (error) { console.warn("[Monitor] event listener", error); }
  }
}

/**
 * Store one normalized event. A repeated poll returns the existing record and
 * does not emit, which is what keeps watch alerts and the live log quiet.
 */
export function recordEvent(input) {
  return recordEvents([input])[0] || null;
}

export function recordEvents(inputs) {
  const list = Array.isArray(inputs) ? inputs.filter(Boolean) : [];
  if (!list.length) return [];
  const before = new Set(events.map(event => event.dedupeKey));
  const normalized = list.map(input => normaliseEvent(input));
  events = mergeEventList(events, normalized, { now: Date.now(), max: MAX_EVENTS, retentionMs: RETENTION_MS });
  persist();
  const added = events.filter(event => !before.has(event.dedupeKey));
  emit(added);
  return added;
}

export function getEvents(options = {}) {
  return filterEventList(events, { limit: 200, ...options });
}

export function allEvents() {
  return events;
}

export function eventById(id) {
  return events.find(event => event.id === id) || null;
}

export function eventSummary() {
  return summariseEventCounts(events);
}

export function subscribeEvents(fn) {
  if (typeof fn !== "function") return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearEvents() {
  events = [];
  persist();
}

export { MAX_EVENTS, RETENTION_MS };
