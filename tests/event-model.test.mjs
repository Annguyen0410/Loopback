import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EVENTS,
  eventKey,
  eventMatchesCountry,
  filterEventList,
  formatAge,
  mergeEventList,
  normaliseEvent,
  safeExternalUrl
} from "../src/monitor/event-model.mjs";

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

function quake(overrides = {}) {
  return {
    category: "QUAKE",
    severity: "warn",
    title: "M 5.2 — Test region",
    source: "USGS",
    sourceUrl: "https://earthquake.usgs.gov/",
    url: "https://earthquake.usgs.gov/earthquakes/eventpage/test",
    externalId: "q1",
    eventTime: NOW - 10 * 60 * 1000,
    observedAt: NOW - 9 * 60 * 1000,
    lat: 12.5,
    lng: 99.5,
    country: "Thailand",
    value: 5.2,
    quality: "official",
    ...overrides
  };
}

test("normalisation keeps event time and observation time separate", () => {
  const event = normaliseEvent(quake({ time: undefined, eventTime: null }), { now: NOW });
  assert.equal(event.eventTime, null);
  assert.equal(event.timeUnknown, true);
  assert.equal(event.observedAt, NOW - 9 * 60 * 1000);
  assert.equal(event.country, "TH");
  assert.equal(event.countryName, "Thailand");
  assert.equal(event.family, "disaster");
});

test("unknown timestamps are never replaced by the poll time", () => {
  const event = normaliseEvent({ title: "Old story", category: "NEWS", source: "BBC" }, { now: NOW });
  assert.equal(event.eventTime, null);
  assert.equal(event.observedAt, NOW);
  assert.equal(event.timeUnknown, true);
});

test("unsafe source URLs are not passed through", () => {
  assert.equal(safeExternalUrl("javascript:alert(1)"), "");
  assert.equal(safeExternalUrl("http://example.com/a"), "");
  assert.equal(safeExternalUrl("https://user:pass@example.com/a"), "");
  assert.equal(safeExternalUrl("https://127.0.0.1/a"), "");
  assert.equal(safeExternalUrl("https://example.com/a#fragment"), "https://example.com/a");
});

test("the same external id produces one event across repeated polls", () => {
  const first = normaliseEvent(quake(), { now: NOW });
  const second = normaliseEvent(quake({ observedAt: NOW - 5 * 60 * 1000 }), { now: NOW });
  assert.equal(first.dedupeKey, second.dedupeKey);
  const merged = mergeEventList([first], [second], { now: NOW });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].observedAt, NOW - 5 * 60 * 1000);
});

test("merge is bounded and news cannot evict every operational event", () => {
  const news = Array.from({ length: 500 }, (_, index) => normaliseEvent({
    category: "NEWS",
    title: "Headline " + index,
    source: "Wire " + (index % 5),
    externalId: "news-" + index,
    eventTime: NOW - index * 1000,
    url: "https://example.com/" + index
  }, { now: NOW }));
  const quakes = Array.from({ length: 5 }, (_, index) => normaliseEvent(quake({ externalId: "q-" + index }), { now: NOW }));
  const merged = mergeEventList([], [...news, ...quakes], { now: NOW });
  assert.ok(merged.length <= MAX_EVENTS);
  assert.equal(merged.filter(event => event.category === "NEWS").length, 420);
  assert.equal(merged.filter(event => event.category === "QUAKE").length, 5);
});

test("filters use time, severity, category, text and country", () => {
  const events = [
    normaliseEvent(quake(), { now: NOW }),
    normaliseEvent(quake({
      category: "FLOOD", severity: "crit", title: "Flood in Vietnam", source: "GDACS",
      externalId: "flood-1", country: "Vietnam", eventTime: NOW - 3 * 60 * 60 * 1000
    }), { now: NOW }),
    normaliseEvent(quake({
      category: "NEWS", severity: "info", title: "Markets close higher", source: "BBC",
      externalId: "news-1", eventTime: NOW - 60 * 60 * 1000, url: "https://example.com/markets"
    }), { now: NOW })
  ];
  assert.equal(filterEventList(events, { from: NOW - 30 * 60 * 1000 }).length, 1);
  assert.equal(filterEventList(events, { severities: ["crit"] }).length, 1);
  assert.equal(filterEventList(events, { categories: ["FLOOD"] }).length, 1);
  assert.equal(filterEventList(events, { query: "vietnam flood" }).length, 1);
  assert.equal(filterEventList(events, { country: "VN" }).length, 1);
  assert.equal(eventMatchesCountry(events[1], { iso: "VN", name: "Vietnam" }), true);
});

test("event keys are deterministic and include the source", () => {
  const event = normaliseEvent(quake(), { now: NOW });
  assert.equal(event.id, normaliseEvent(quake(), { now: NOW + 1000 }).id);
  assert.equal(eventKey({ title: "x", source: "A" }), eventKey({ title: "x", source: "A" }));
  assert.notEqual(eventKey({ title: "x", source: "A" }), eventKey({ title: "x", source: "B" }));
});

test("age format stays honest for an unknown time", () => {
  assert.equal(formatAge(null, NOW), "unknown");
  assert.equal(formatAge(NOW - 2 * 60 * 1000, NOW), "2m ago");
  assert.equal(formatAge(NOW - 3 * 60 * 60 * 1000, NOW), "3h ago");
});
