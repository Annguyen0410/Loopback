/**
 * TRENDING — a transparent count over cached headlines, not a threat score.
 *
 * It uses only events already in event-store.js; opening the tab or receiving
 * a poll causes no extra network request.
 */

import { $, esc, safeHref } from "./utils.js";
import { computeTrends } from "./trend-model.mjs";
import { getEvents } from "./event-store.js";

const WINDOW_MS = 72 * 60 * 60 * 1000;

export function renderTrending() {
  const el = $("trendList");
  if (!el) return;
  const events = getEvents({ from: Date.now() - WINDOW_MS, limit: 600 });
  const trends = computeTrends(events);
  if (!trends.length) {
    el.innerHTML = '<div class="panel-empty">Not enough cross-source headlines yet.</div>';
    return;
  }
  let html = "";
  for (const trend of trends) {
    const delta = trend.baseline === 0 ? "new" : "+" + Math.max(0, trend.recent - Math.round(trend.baseline / 4));
    const samples = trend.samples.slice(0, 2).map(sample =>
      '<a href="' + safeHref(sample.url) + '" target="_blank" rel="noopener">' + esc(sample.title) + "</a>"
    ).join("");
    html += '<div class="trend-row">' +
      '<div class="trend-head"><span class="trend-term">' + esc(trend.term) + "</span>" +
      '<span class="trend-count">' + trend.recent + " mentions · " + trend.sources.length + " sources · " + esc(delta) + "</span></div>" +
      '<div class="trend-samples">' + samples + "</div></div>";
  }
  el.innerHTML = html + '<div class="trend-note">Cached headline mentions in the last 6h vs the prior 24h. Volume is not danger.</div>';
}
