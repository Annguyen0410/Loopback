import test from "node:test";
import assert from "node:assert/strict";
import { normaliseEvent } from "../src/monitor/event-model.mjs";
import { collectMatches, normaliseRule, ruleMatches } from "../src/monitor/watch-model.mjs";

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

function event(overrides = {}) {
  return normaliseEvent({
    category: "QUAKE",
    severity: "crit",
    title: "M 6.1 — Taiwan region",
    source: "USGS",
    externalId: "q-1",
    eventTime: NOW - 60000,
    observedAt: NOW - 30000,
    country: "Taiwan",
    value: 6.1,
    ...overrides
  }, { now: NOW });
}

test("keyword, country, category and magnitude rules match their event", () => {
  const quake = event();
  assert.equal(ruleMatches(quake, { kind: "keyword", value: "taiwan" }), true);
  assert.equal(ruleMatches(quake, { kind: "keyword", value: "ceasefire" }), false);
  assert.equal(ruleMatches(quake, { kind: "country", value: "TW" }), true);
  assert.equal(ruleMatches(quake, { kind: "category", value: "QUAKE" }), true);
  assert.equal(ruleMatches(quake, { kind: "category", value: "DISASTER" }), true);
  assert.equal(ruleMatches(quake, { kind: "magnitude", value: "6" }), true);
  assert.equal(ruleMatches(quake, { kind: "magnitude", value: "6.5" }), false);
});

test("a rule honours its minimum severity and disabled state", () => {
  const info = event({ externalId: "flood-1", category: "FLOOD", severity: "info", title: "Flood in Vietnam", country: "Vietnam", value: null });
  assert.equal(ruleMatches(info, { kind: "keyword", value: "flood", minSeverity: "info" }), true);
  assert.equal(ruleMatches(info, { kind: "keyword", value: "flood", minSeverity: "warn" }), false);
  assert.equal(ruleMatches(info, { kind: "keyword", value: "flood", enabled: false }), false);
});

test("collectMatches fires at most one event per rule and suppresses the same event", () => {
  const events = [
    event(),
    event({ externalId: "q-2", title: "M 6.4 — Taiwan region", value: 6.4 })
  ];
  const rules = [
    normaliseRule({ id: "r1", kind: "keyword", value: "Taiwan", minSeverity: "warn" })
  ];
  const first = collectMatches(events, rules, { now: NOW, cooldownMs: 10 * 60 * 1000 });
  assert.equal(first.length, 1);
  assert.equal(first[0].event.id, events[0].id);
  const seen = new Set([first[0].key]);
  const second = collectMatches(events, rules, {
    now: NOW + 60 * 1000,
    lastFired: { r1: NOW },
    seenKeys: seen,
    cooldownMs: 10 * 60 * 1000
  });
  assert.equal(second.length, 0, "cooldown and seen key both suppress a repeat");
});

test("after the cooldown a new event can fire the same rule", () => {
  const rules = [normaliseRule({ id: "r1", kind: "category", value: "QUAKE" })];
  const events = [event({ externalId: "q-3", observedAt: NOW + 11 * 60 * 1000 })];
  const matches = collectMatches(events, rules, {
    now: NOW + 11 * 60 * 1000,
    lastFired: { r1: NOW },
    cooldownMs: 10 * 60 * 1000
  });
  assert.equal(matches.length, 1);
});

test("normaliseRule keeps only supported kinds and clamps a magnitude", () => {
  assert.equal(normaliseRule({ kind: "nonsense", value: "x" }).kind, "keyword");
  assert.equal(normaliseRule({ kind: "magnitude", value: "99" }).value, "10");
  assert.equal(normaliseRule({ kind: "country", value: "vn" }).value, "VN");
});
