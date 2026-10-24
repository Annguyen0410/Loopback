/**
 * Deterministic global situation brief.
 *
 * The brief is built only from records already cached by the Monitor: no AI,
 * no key, no outbound request. It separates operational events from headlines,
 * names the source of every item it prints, and says plainly that the counts
 * describe cached records rather than an intelligence assessment.
 */

import { categoryLabel, formatAge } from "./event-model.mjs";

const NON_OPERATIONAL = new Set(["NEWS", "ALERT"]);

export function summariseFeeds(feeds) {
  const list = Array.isArray(feeds) ? feeds : Object.values(feeds || {});
  const counts = { live: 0, stale: 0, offline: 0, total: list.length };
  for (const feed of list) {
    const status = String((feed && feed.status) || "").toUpperCase();
    if (status === "LIVE") counts.live++;
    else if (status === "STALE") counts.stale++;
    else counts.offline++;
  }
  return counts;
}

function stamp(event) {
  return (event && (event.eventTime || event.observedAt)) || 0;
}

function severityRank(event) {
  if (event.severity === "crit") return 2;
  if (event.severity === "warn") return 1;
  return 0;
}

export function buildSitrep(events, { now = Date.now(), hours = 24, maxTop = 4 } = {}) {
  const windowHours = Math.max(1, Math.min(168, Number(hours) || 24));
  const since = now - windowHours * 60 * 60 * 1000;
  const inWindow = [];
  for (const event of events || []) {
    if (!event) continue;
    if (stamp(event) >= since) inWindow.push(event);
  }

  const operational = inWindow.filter(event => !NON_OPERATIONAL.has(event.category));
  const headlines = inWindow.filter(event => event.category === "NEWS");
  const alerts = inWindow.filter(event => event.category === "ALERT");

  const categories = new Map();
  const countries = new Map();
  let crit = 0;
  let warn = 0;
  for (const event of operational) {
    categories.set(event.category, (categories.get(event.category) || 0) + 1);
    if (event.severity === "crit") crit++;
    else if (event.severity === "warn") warn++;
    const place = event.countryName || event.country;
    if (place) countries.set(place, (countries.get(place) || 0) + 1);
  }

  const top = operational.slice()
    .sort((a, b) => severityRank(b) - severityRank(a) || stamp(b) - stamp(a))
    .slice(0, Math.max(0, maxTop));

  return {
    hours: windowHours,
    since,
    generatedAt: now,
    total: inWindow.length,
    operational: operational.length,
    headlines: headlines.length,
    alerts: alerts.length,
    crit,
    warn,
    categories: [...categories.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ id, label: categoryLabel(id), count })),
    countries: [...countries.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, count]) => ({ name, count })),
    top
  };
}

function utcStamp(timestamp) {
  return new Date(timestamp).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function sitrepText(brief, { feeds = [], now = Date.now() } = {}) {
  const lines = [];
  lines.push("LOOPBACK WORLD MONITOR — SITUATION BRIEF");
  lines.push("Window: last " + brief.hours + "h · generated " + utcStamp(now));
  lines.push("");
  lines.push(
    "Events: " + brief.operational + " operational · " + brief.crit + " critical · " +
    brief.warn + " warning · " + brief.headlines + " headlines"
  );
  if (brief.categories.length) {
    lines.push("Categories: " + brief.categories.map(c => c.label + " " + c.count).join(" · "));
  }
  if (brief.countries.length) {
    lines.push("Countries named: " + brief.countries.map(c => c.name + " " + c.count).join(" · "));
  }
  lines.push("");
  if (brief.top.length) {
    lines.push("Top records:");
    for (const event of brief.top) {
      const sev = String(event.severity || "info").toUpperCase();
      lines.push("- [" + sev + "] " + event.title + " — " + (event.source || "unknown source") +
        ", " + formatAge(stamp(event), now));
    }
  } else {
    lines.push("No operational records in this window.");
  }
  const feedCounts = summariseFeeds(feeds);
  lines.push("");
  lines.push("Feeds: " + feedCounts.live + " live · " + feedCounts.stale + " stale · " +
    feedCounts.offline + " offline (of " + feedCounts.total + ")");
  lines.push("Counts describe cached public-feed records. This is not an intelligence assessment.");
  return lines.join("\n");
}
