/**
 * Breaking news — aggregated from real newsroom feeds only: the official RSS
 * feeds of BBC / Al Jazeera / France 24 / The Guardian, plus each
 * broadcaster's own YouTube upload feed (Atom). Every headline therefore
 * links to a real article or video; nothing is synthesised. An empty result
 * renders OFFLINE rather than filling the ticker with invented stories.
 */

import { $, esc } from "./utils.js";
import { fetchText } from "./net.js";
// Shared with the main-process live hub so the two lists can never drift.
import NEWS_SOURCES from "./news-sources.json" with { type: "json" };

const ALL_SOURCES = NEWS_SOURCES;

/** Run `fn` over `items` with a bounded number of in-flight requests. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

let headlines = [];
let fetchedOnce = false;

function relAge(ts) {
  if (!ts) return "";
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return mins + "m";
  const h = Math.floor(mins / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}

export async function fetchNews() {
  // Fetched in parallel with a small concurrency cap — the old sequential
  // loop would need minutes for the full source list.
  const parts = await mapLimit(ALL_SOURCES, 8, async (src) => {
    try {
      const xml = await fetchText("news:" + src.name, src.url, { timeout: 15000 });
      return parseFeed(xml, src);
    } catch { return []; } // source down → skip
  });
  const out = parts.flat();
  headlines = out.length ? out.sort((a, b) => b.time - a.time).slice(0, 40) : [];
  fetchedOnce = true;
  renderNews();
  renderTopSignals();
  return headlines;
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
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const nodes = [...doc.querySelectorAll("item"), ...doc.querySelectorAll("entry")];
  return nodes.map(it => ({
    title: textOf(it, "title"),
    url: kind === "video" ? entryUrl(it) : textOf(it, "link") || entryUrl(it),
    source: sourceName,
    kind,
    time: Date.parse(textOf(it, "pubDate", "published", "updated", "dc:date")) || Date.now()
  })).filter(it => it.title);
}

/** Main-process push: array of { name, text } RSS/Atom payloads. */
export function applyLiveNews(parts) {
  if (!Array.isArray(parts) || !parts.length) return;
  const out = [];
  for (const p of parts) {
    if (p && p.text) {
      // Atom payloads (<entry>) come from the YouTube upload feeds.
      const isVideo = /youtube\.com\/feeds/.test(p.url || "") || /<entry[\s>]/.test(p.text);
      out.push(...parseFeed(p.text, { name: p.name || "?", kind: isVideo ? "video" : "rss" }));
    }
  }
  if (!out.length) return;
  headlines = out.sort((a, b) => b.time - a.time).slice(0, 40);
  fetchedOnce = true;
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
    html += '<span><span class="news-dot"></span><a href="' + it.url + '" target="_blank" rel="noopener">' +
      mark + esc(it.title) + "</a><span class='news-src'>" + esc(it.source || "") + "</span></span>";
  }
  el.innerHTML = html + html;
}

export function renderTopSignals() {
  const el = $("topSignals");
  if (!el) return;
  if (!headlines.length) {
    el.innerHTML = '<div class="panel-empty">' + (fetchedOnce ? "OFFLINE" : "Loading top signals…") + "</div>";
    return;
  }
  let html = "";
  for (const h of headlines.slice(0, 8)) {
    const src = (h.kind === "video" ? "▶ " : "") + h.source;
    html += '<div class="signal-row"><span class="signal-src">' + esc(src) + "</span>" +
      '<span class="signal-title"><a href="' + h.url + '" target="_blank" rel="noopener">' + esc(h.title) + "</a></span>" +
      '<span class="signal-age">' + relAge(h.time) + "</span></div>";
  }
  el.innerHTML = html;
}

export function initNews() {
  fetchNews();
  setInterval(fetchNews, 5 * 60 * 1000); // fallback when live hub is off
}
