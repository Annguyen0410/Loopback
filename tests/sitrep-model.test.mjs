import test from "node:test";
import assert from "node:assert/strict";
import { buildSitrep, sitrepText, summariseFeeds } from "../src/monitor/sitrep-model.mjs";

const now = Date.UTC(2026, 9, 23, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function event(overrides) {
  return {
    category: "QUAKE",
    severity: "info",
    title: "Test event",
    source: "USGS",
    eventTime: now - HOUR,
    observedAt: now,
    ...overrides
  };
}

test("a brief separates operational records from headlines", () => {
  const brief = buildSitrep([
    event({ title: "M5 quake" }),
    event({ category: "NEWS", title: "Headline", severity: "info" }),
    event({ category: "ALERT", title: "Rule hit" }),
    event({ title: "Old quake", eventTime: now - 30 * HOUR })
  ], { now, hours: 24 });
  assert.equal(brief.total, 3);
  assert.equal(brief.operational, 1);
  assert.equal(brief.headlines, 1);
  assert.equal(brief.alerts, 1);
});

test("critical records sort first and counts stay honest", () => {
  const brief = buildSitrep([
    event({ title: "Info now", eventTime: now - 60_000 }),
    event({ title: "Critical yesterday", severity: "crit", eventTime: now - 20 * HOUR }),
    event({ title: "Warn", severity: "warn", category: "CONFLICT", eventTime: now - 2 * HOUR })
  ], { now });
  assert.equal(brief.operational, 3);
  assert.equal(brief.crit, 1);
  assert.equal(brief.warn, 1);
  assert.equal(brief.top[0].title, "Critical yesterday");
  assert.equal(brief.top[1].title, "Warn");
  assert.equal(brief.categories[0].id, "QUAKE");
});

test("missing event time falls back to the observation time without inventing one", () => {
  const brief = buildSitrep([
    event({ eventTime: null, observedAt: now - 2 * HOUR })
  ], { now, hours: 24 });
  assert.equal(brief.operational, 1);
  assert.equal(brief.top[0].title, "Test event");
});

test("feed states are summarised, not guessed", () => {
  const counts = summariseFeeds([
    { status: "LIVE" },
    { status: "LIVE" },
    { status: "STALE" },
    { status: "OFFLINE" }
  ]);
  assert.deepEqual(counts, { live: 2, stale: 1, offline: 1, total: 4 });
  assert.deepEqual(summariseFeeds({}), { live: 0, stale: 0, offline: 0, total: 0 });
});

test("text names the source and refuses to call the brief an intelligence assessment", () => {
  const brief = buildSitrep([
    event({ title: "M6.1 offshore", severity: "warn", source: "USGS" })
  ], { now });
  const text = sitrepText(brief, { feeds: [{ status: "LIVE" }], now });
  assert.match(text, /SITUATION BRIEF/);
  assert.match(text, /M6\.1 offshore/);
  assert.match(text, /USGS/);
  assert.match(text, /not an intelligence assessment/i);
});

test("an empty window says so instead of implying the world is quiet", () => {
  const brief = buildSitrep([], { now });
  assert.equal(brief.operational, 0);
  const text = sitrepText(brief, { feeds: [], now });
  assert.match(text, /No operational records in this window/);
  assert.match(text, /0 live · 0 stale · 0 offline/);
});
