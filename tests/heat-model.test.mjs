import test from "node:test";
import assert from "node:assert/strict";
import { clusterEvents } from "../src/monitor/heat-model.mjs";

const now = Date.UTC(2026, 9, 23, 12, 0, 0);

function event(overrides) {
  return {
    category: "QUAKE",
    severity: "info",
    lat: 0,
    lng: 0,
    eventTime: now - 60_000,
    observedAt: now,
    ...overrides
  };
}

test("nearby events share a cell and far events do not", () => {
  const clusters = clusterEvents([
    event({ lat: 10, lng: 10 }),
    event({ lat: 11, lng: 11 }),
    event({ lat: -40, lng: 120 })
  ], { from: now - 3600_000, cellSize: 6, max: 10 });
  assert.equal(clusters.length, 2);
  const big = clusters.find(cluster => cluster.count === 2);
  assert.ok(big);
  assert.equal(big.categories[0].id, "QUAKE");
  assert.equal(clusters.reduce((sum, cluster) => sum + cluster.count, 0), 3);
});

test("events without coordinates or outside the window are excluded", () => {
  const clusters = clusterEvents([
    event({ lat: null, lng: null }),
    event({ lat: 5, lng: 5, eventTime: now - 48 * 3600_000 }),
    event({ lat: 5, lng: 5 })
  ], { from: now - 24 * 3600_000 });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 1);
});

test("severity and latest timestamp are tracked per cell", () => {
  const clusters = clusterEvents([
    event({ lat: 30, lng: 30, severity: "crit", eventTime: now - 10 * 60_000 }),
    event({ lat: 30, lng: 30, severity: "warn", eventTime: now - 5 * 60_000 }),
    event({ lat: 30, lng: 30, severity: "info", eventTime: now - 60_000 })
  ], { from: now - 3600_000 });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].crit, 1);
  assert.equal(clusters[0].warn, 1);
  assert.equal(clusters[0].info, 1);
  assert.equal(clusters[0].latest, now - 60_000);
});

test("the result is capped and critical cells sort first", () => {
  const input = [];
  for (let i = 0; i < 12; i++) {
    input.push(event({ lat: 20, lng: -120 + i * 20, severity: i === 11 ? "crit" : "info" }));
  }
  const clusters = clusterEvents(input, { from: now - 3600_000, max: 3 });
  assert.equal(clusters.length, 3);
  assert.equal(clusters[0].crit, 1);
});
