/**
 * SITREP widget — a deterministic brief built from the cached event store.
 *
 * Nothing here calls a model or an API. The panel exists so the owner can read
 * (and copy) what the Monitor actually has, with the source of every record and
 * an explicit note when feeds are stale or offline.
 */

import { $, esc, escAttr, safeHref } from "./utils.js";
import { formatAge } from "./event-model.mjs";
import { allEvents, subscribeEvents } from "./event-store.js";
import { FEEDS } from "./net.js";
import { buildSitrep, sitrepText, summariseFeeds } from "./sitrep-model.mjs";
import { activate } from "./sidebar-tabs.js";

let latest = null;

function feedLine(counts) {
  if (!counts.total) return "No feed has reported yet.";
  const parts = [];
  if (counts.live) parts.push(counts.live + " live");
  if (counts.stale) parts.push(counts.stale + " stale");
  if (counts.offline) parts.push(counts.offline + " offline");
  return parts.join(" · ");
}

function render() {
  const body = $("sitrepBody");
  if (!body) return;
  const brief = buildSitrep(allEvents(), { hours: 24 });
  latest = brief;
  const feeds = summariseFeeds(FEEDS);
  const allDown = feeds.total > 0 && feeds.live === 0 && feeds.offline === feeds.total;

  let html = '<div class="sitrep-counts">' +
    '<span><b>' + brief.operational + "</b> ops</span>" +
    '<span class="sitrep-crit"><b>' + brief.crit + "</b> crit</span>" +
    '<span class="sitrep-warn"><b>' + brief.warn + "</b> warn</span>" +
    '<span><b>' + brief.headlines + "</b> headlines</span>" +
    "</div>";

  if (brief.categories.length) {
    html += '<div class="sitrep-cats">' + brief.categories
      .map(cat => esc(cat.label) + " <b>" + cat.count + "</b>").join(" · ") + "</div>";
  }

  if (allDown) {
    html += '<div class="sitrep-note warn">Every tracked feed is offline. An empty brief here means "no data", not "a quiet world".</div>';
  } else if (!brief.operational) {
    html += '<div class="sitrep-note">No operational records in the last 24h. ' +
      (brief.headlines ? brief.headlines + " headline(s) are cached separately." : "No headlines cached either.") + "</div>";
  }

  if (brief.top.length) {
    html += '<div class="sitrep-list">';
    for (const event of brief.top) {
      const sev = event.severity === "crit" ? "crit" : event.severity === "warn" ? "warn" : "info";
      const tip = [event.source, formatAge(event.eventTime || event.observedAt)].filter(Boolean).join(" · ");
      html += '<div class="sitrep-row ' + sev + '" title="' + escAttr(tip) + '">' +
        '<span class="sitrep-sev ' + sev + '"></span>' +
        '<span class="sitrep-main">' +
        (event.url
          ? '<a href="' + safeHref(event.url) + '" target="_blank" rel="noopener">' + esc(event.title) + "</a>"
          : esc(event.title)) +
        '<span class="sitrep-meta">' + esc(event.source || "unknown source") + " · " +
        esc(formatAge(event.eventTime || event.observedAt)) + "</span></span></div>";
    }
    html += "</div>";
  }

  html += '<div class="sitrep-feeds ' + (allDown ? "warn" : "") + '">' + esc(feedLine(feeds)) + "</div>" +
    '<div class="sitrep-actions">' +
    '<button class="route-btn" id="sitrepCopy">COPY BRIEF</button>' +
    '<button class="route-btn sitrep-open" id="sitrepOpen">OPEN EVENTS</button>' +
    "</div>" +
    '<div class="sitrep-note">Deterministic: built from cached records only — no AI, no extra request. Counts are not a risk score.</div>';

  body.innerHTML = html;

  const copy = $("sitrepCopy");
  if (copy) copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(sitrepText(brief, { feeds: FEEDS, now: Date.now() }));
      copy.textContent = "COPIED";
      setTimeout(() => { copy.textContent = "COPY BRIEF"; }, 1600);
    } catch {
      copy.textContent = "COPY FAILED";
      setTimeout(() => { copy.textContent = "COPY BRIEF"; }, 1600);
    }
  };
  const open = $("sitrepOpen");
  if (open) open.onclick = () => activate("events");
}

export function initSitrep() {
  render();
  subscribeEvents(render);
  // The brief only reads memory, so a slow refresh is enough; it also keeps the
  // "x ago" labels and feed states honest between events.
  setInterval(render, 30000);
}

export function currentBrief() { return latest; }
