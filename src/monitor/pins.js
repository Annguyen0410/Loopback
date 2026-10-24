/**
 * Saved events.
 *
 * A live event ages out of the bounded event store after 72 h. A saved record is
 * a local snapshot, kept separately (and also bounded) so it can be reopened
 * after it has left the live window. It is stored only in this profile's
 * localStorage — nothing is uploaded.
 */

const KEY = "wm_saved_events_v1";
const MAX = 60;
const listeners = new Set();

function storage() {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function snapshot(event) {
  if (!event || !event.id || !event.title) return null;
  return {
    id: event.id,
    dedupeKey: event.dedupeKey || "",
    category: event.category || "EVENT",
    family: event.family || "other",
    severity: event.severity || "info",
    title: event.title,
    summary: event.summary || "",
    url: event.url || "",
    source: event.source || "",
    sourceUrl: event.sourceUrl || "",
    country: event.country || "",
    countryName: event.countryName || "",
    lat: event.lat == null ? null : Number(event.lat),
    lng: event.lng == null ? null : Number(event.lng),
    value: event.value == null ? null : Number(event.value),
    quality: event.quality || "unknown",
    eventTime: event.eventTime || null,
    observedAt: event.observedAt || Date.now(),
    timeUnknown: !!event.timeUnknown,
    savedAt: Date.now()
  };
}

function load() {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(snapshot).filter(Boolean).slice(0, MAX);
  } catch {
    return [];
  }
}

let pins = load();

function persist() {
  const store = storage();
  if (!store) return;
  try { store.setItem(KEY, JSON.stringify(pins.slice(0, MAX))); } catch { /* quota: memory copy stays */ }
}

function emit() {
  for (const fn of [...listeners]) {
    try { fn(pins); } catch (error) { console.warn("[Monitor] pins listener", error); }
  }
}

export function isPinned(id) {
  return !!id && pins.some(event => event.id === id);
}

export function togglePin(event) {
  if (!event || !event.id) return false;
  if (isPinned(event.id)) {
    pins = pins.filter(saved => saved.id !== event.id);
    persist();
    emit();
    return false;
  }
  const copy = snapshot(event);
  if (!copy) return false;
  pins = [copy, ...pins].slice(0, MAX);
  persist();
  emit();
  return true;
}

export function pinnedEvents() {
  return pins.slice();
}

export function savedEventById(id) {
  return pins.find(event => event.id === id) || null;
}

export function pinCount() {
  return pins.length;
}

export function subscribePins(fn) {
  if (typeof fn !== "function") return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}
