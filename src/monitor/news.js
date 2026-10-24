/**
 * Breaking news — aggregated from real newsroom feeds only: the official RSS
 * feeds of BBC / Al Jazeera / France 24 / The Guardian, plus each
 * broadcaster's own YouTube upload feed (Atom). Every headline therefore
 * links to a real article or video; nothing is synthesised. An empty result
 * renders OFFLINE rather than filling the ticker with invented stories.
 */

import { $, esc, safeHref } from "./utils.js";
import { allEvents, recordEvents } from "./event-store.js";
import { ageLabel, headlinesFromEvents } from "./headline-cache.mjs";
// Shared with the main-process owner of the news feeds so the names in the FEED STATUS panel cannot drift.
import NEWS_SOURCES from "./news-sources.json" with { type: "json" };

const ALL_SOURCES = NEWS_SOURCES;

let headlines = [];
let fetchedOnce = false;
/* True until the live owner in main has pushed a news cycle. A restored list is still real reporting, but it
   is old, so every place it appears says CACHED instead of implying it just arrived. */
let cachedOnly = false;

function relAge(ts) {
  if (!ts) return "";
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return mins + "m";
  const h = Math.floor(mins / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}

/** Number of sources wired up, for the boot log. */
export function sourceCount() { return ALL_SOURCES.length; }
export const sourceNames = () => ALL_SOURCES.map(s => s.name);

/** Extract the first non-empty text for any of `names` inside `node`. */
function textOf(node, ...names) {
  for (const n of names) {
    const el = node.querySelector(n);
    const t = el && el.textContent ? el.textContent.trim() : "";
    if (t) return t;
  }
  return "";
}

/** Atom (YouTube) entries put the URL in a link[href], not in link text. */
function entryUrl(node) {
  const alt = node.querySelector('link[rel="alternate"], link');
  const href = alt && alt.getAttribute ? alt.getAttribute("href") : "";
  if (href) return href.trim();
  return textOf(node, "link") || "#";
}

/**
 * Parse either an RSS feed (<item>) or an Atom feed (<entry>) into the same
 * headline shape. `src.kind === "video"` marks YouTube uploads so the ticker
 * can show a ▶ marker and users know a click opens a video.
 */
function parseFeed(xml, src) {
  const sourceName = typeof src === "string" ? src : src.name;
  const kind = typeof src === "string" ? "rss" : src.kind || "rss";
  const feedUrl = typeof src === "string" ? "" : src.url || "";
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const nodes = [...doc.querySelectorAll("item"), ...doc.querySelectorAll("entry")];
  return nodes.map(it => ({
    title: textOf(it, "title"),
    url: kind === "video" ? entryUrl(it) : textOf(it, "link") || entryUrl(it),
    source: sourceName,
    kind,
    feedUrl,
    // No publication date is a real state. The UI says "time not reported"
    // instead of making an old story look like it happened at poll time.
    time: Date.parse(textOf(it, "pubDate", "published", "updated", "dc:date")) || null
  })).filter(it => it.title);
}

/** Cached headlines for the country brief and palette (no network). */
export function getHeadlines() {
  return headlines.slice();
}

/** Main-process push: array of { name, text } RSS/Atom payloads. */
export function applyLiveNews(parts) {
  if (!Array.isArray(parts) || !parts.length) return;
  const out = [];
  for (const p of parts) {
    if (p && p.text) {
      // Atom payloads (<entry>) come from the YouTube upload feeds.
      const isVideo = /youtube\.com\/feeds/.test(p.url || "") || /<entry[\s>]/.test(p.text);
      out.push(...parseFeed(p.text, { name: p.name || "?", kind: isVideo ? "video" : "rss", url: p.url || "" }));
    }
  }
  if (!out.length) return;
  cachedOnly = false;
  headlines = out.sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 40);
  fetchedOnce = true;
  recordEvents(headlines.map(item => ({
    category: "NEWS",
    severity: "info",
    title: item.title,
    summary: item.kind === "video" ? "Video report" : "News headline",
    url: item.url,
    source: item.source,
    sourceUrl: item.feedUrl,
    eventTime: item.time,
    externalId: item.url || item.title,
    quality: "media"
  })));
  renderNews();
  renderTopSignals();
}

export function renderNews() {
  const el = $("newsTrack");
  if (!el) return;
  if (!headlines.length) {
    el.innerHTML = "";
    return;
  }
  let html = "";
  for (const it of headlines.slice(0, 12)) {
    const mark = it.kind === "video" ? "▶ " : "";
    html += '<span><span class="news-dot"></span><a href="' + safeHref(it.url) + '" target="_blank" rel="noopener">' +
      mark + esc(it.title) + "</a><span class='news-src'>" + esc(it.source || "") + "</span></span>";
  }
  const badge = cachedOnly
    ? '<span class="news-cache" title="Restored from the local event store; the live news feed has not answered yet">CACHED</span>'
    : "";
  el.innerHTML = badge + html + html;
}

export function renderTopSignals() {
  const el = $("topSignals");
  if (!el) return;
  if (!headlines.length) {
    el.innerHTML = '<div class="panel-empty">' + (fetchedOnce ? "OFFLINE" : "Loading top signals…") + "</div>";
    return;
  }
  let html = "";
  if (cachedOnly) {
    html += '<div class="signal-cache" title="Restored from the local event store; the live news feed has not answered yet">' +
      "CACHED · " + esc(ageLabel(headlines)) + " · waiting for the live feed</div>";
  }
  for (const h of headlines.slice(0, 8)) {
    const src = (h.kind === "video" ? "▶ " : "") + h.source;
    html += '<div class="signal-row"><span class="signal-src">' + esc(src) + "</span>" +
      '<span class="signal-title"><a href="' + safeHref(h.url) + '" target="_blank" rel="noopener">' + esc(h.title) + "</a></span>" +
      '<span class="signal-age">' + relAge(h.time) + "</span></div>";
  }
  el.innerHTML = html;
}

export function initNews() {
  /* The main process owns the news feeds and pushes them over `monitor:live` (applyLiveNews above). The page
     used to fetch all 39 sources itself every five minutes as well, so every feed was downloaded twice — and
     "duplicated for safety" is just a second source of truth. */
  /* Before the first push, restore the last session's headlines from the same bounded event store that feeds
     the timeline and palette. They are labelled CACHED until a live cycle replaces them; a blank ticker while
     the network is down is more honest than fake data but less useful than real, dated reporting. */
  if (!headlines.length) {
    const cached = headlinesFromEvents(allEvents());
    if (cached.length) {
      headlines = cached;
      cachedOnly = true;
      fetchedOnce = true;
    }
  }
  renderTopSignals();
  renderNews();
}

/** Exposed for the palette/country brief and for tests: true while the list is the restored one. */
export function isCachedNews() { return cachedOnly; }
