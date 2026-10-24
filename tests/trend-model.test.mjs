import test from "node:test";
import assert from "node:assert/strict";
import { clusterHeadlines, computeTrends, titleTokens } from "../src/monitor/trend-model.mjs";

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

function story(title, source, minutesAgo, overrides = {}) {
  return {
    id: source + "-" + minutesAgo,
    title,
    source,
    eventTime: NOW - minutesAgo * 60 * 1000,
    observedAt: NOW - minutesAgo * 60 * 1000,
    url: "https://example.com/" + encodeURIComponent(title),
    ...overrides
  };
}

test("tokens remove stopwords and fold a simple plural", () => {
  const tokens = titleTokens("The ports and the shipping ports are closed after the attack");
  assert.ok(tokens.includes("port"));
  assert.ok(tokens.includes("shipping"));
  assert.ok(!tokens.includes("the"));
  assert.ok(!tokens.includes("after"));
});

test("trends require multiple recent stories from multiple sources", () => {
  const events = [
    story("Taiwan strait shipping warning", "Wire A", 60),
    story("Taiwan strait patrol continues", "Wire B", 90),
    story("Taiwan semiconductor exports rise", "Wire C", 120),
    story("Taiwan strait report from yesterday", "Wire A", 20 * 60)
  ];
  const trends = computeTrends(events, { now: NOW });
  const taiwan = trends.find(row => row.term === "taiwan");
  assert.ok(taiwan, "Taiwan is a trend");
  assert.equal(taiwan.recent, 3);
  assert.equal(taiwan.sources.length, 3);
  assert.equal(taiwan.baseline, 1);
});

test("one source repeating a term does not become a trend", () => {
  const events = [
    story("Taiwan strait warning", "Wire A", 20),
    story("Taiwan strait patrol", "Wire A", 40)
  ];
  assert.equal(computeTrends(events, { now: NOW }).length, 0);
});

test("similar headlines cluster, unrelated headlines do not", () => {
  const clusters = clusterHeadlines([
    story("Port attack disrupts shipping in the strait", "A", 10),
    story("Port attack disrupts shipping in the strait today", "B", 20),
    story("Earthquake strikes inland region", "C", 30)
  ], { threshold: 0.5 });
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].events.length, 2);
  assert.equal(clusters[0].sources.size, 2);
});
