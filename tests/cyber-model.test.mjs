import test from "node:test";
import assert from "node:assert/strict";
import { cyberSeverity, normaliseCyberItem } from "../src/monitor/cyber-model.mjs";

test("exploitation language is flagged as warn, a normal advisory is info", () => {
  assert.equal(cyberSeverity("CISA Adds One Known Exploited Vulnerability to Catalog"), "warn");
  assert.equal(cyberSeverity("Emergency Directive 26-01"), "warn");
  assert.equal(cyberSeverity("Apple Releases Security Updates"), "info");
  assert.equal(cyberSeverity(""), "info");
});

test("an advisory becomes an official CYBER event with its real link and time", () => {
  const item = normaliseCyberItem({
    title: "  CISA   Releases  Advisory ",
    url: "https://www.cisa.gov/news-events/alerts/2026/10/23/example",
    summary: "Details",
    time: "2026-10-23T10:00:00Z"
  });
  assert.equal(item.category, "CYBER");
  assert.equal(item.severity, "info");
  assert.equal(item.title, "CISA Releases Advisory");
  assert.equal(item.quality, "official");
  assert.equal(item.externalId, item.url);
  assert.equal(item.eventTime, Date.parse("2026-10-23T10:00:00Z"));
});

test("a blank title is rejected instead of producing an empty event", () => {
  assert.equal(normaliseCyberItem({ title: "   " }), null);
  assert.equal(normaliseCyberItem({}), null);
});
