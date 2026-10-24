/**
 * Network layer for the world monitor.
 *
 * fetchJSON tries a direct fetch() first, then falls back to the main
 * process proxy (which bypasses CORS entirely, see main.js monitor:proxy).
 *
 * Every call is recorded in FEEDS so the FEED STATUS panel always knows
 * which stream is LIVE / STALE / OFFLINE.
 */

import { proxyFetch } from "./bridge.js";
import { summariseFeeds } from "./feed-health.mjs";
import { headlinesFromEvents } from "./headline-cache.mjs";
import { allEvents } from "./event-store.js";

export const FEEDS = {}; // name -> { name, status, lastOk, lastErr, count, latency, everyMs }

/* How often the PAGE asks each feed. This is display only — the timer lives next to the fetcher — but the FEED
   STATUS tooltip can then state the cadence instead of leaving the user to guess, and a cadence that no longer
   matches the code is visible in one place. The main-process feeds report their own cadence with each status. */
const CADENCE_MS = {
  news: 5 * 60 * 1000,
  quakes: 2 * 60 * 1000,
  indices: 5 * 60 * 1000,
  weather: 3 * 60 * 1000,
  gdacs: 5 * 60 * 1000,
  gdelt: 5 * 60 * 1000,
  ioda: 10 * 60 * 1000,
  airq: 5 * 60 * 1000,
  "space.kp": 10 * 60 * 1000,
  "space.plasma": 10 * 60 * 1000,
  "space.mag": 10 * 60 * 1000,
  "space.flux": 10 * 60 * 1000,
  launches: 10 * 60 * 1000,
  iss: 60 * 1000,
  eonet: 30 * 60 * 1000,
  "cisa-advisories": 15 * 60 * 1000,
  "finance.crypto": 3 * 60 * 1000,
  "finance.cg": 3 * 60 * 1000,
  "finance.fg": 5 * 60 * 1000,
  "finance.poly": 2 * 60 * 1000,
  "port.weather": 5 * 60 * 1000,
  satellites: 6 * 60 * 60 * 1000
};

let renderedFeedHtml = "";

function now() { return Date.now(); }

function everyLabel(ms) {
  if (!ms) return "";
  if (ms < 60_000) return Math.round(ms / 1000) + "s";
  if (ms % 3_600_000 === 0) return Math.round(ms / 3_600_000) + "h";
  return Math.round(ms / 60_000) + "m";
}

function hasCachedHeadlines() {
  /* Count only headlines that could actually be rendered (https link, title), so the badge never promises a
     cache the news panel cannot show. */
  try { return headlinesFromEvents(allEvents(), { limit: 1 }).length > 0; } catch { return false; }
}

/** The header badge is a claim, so it is painted from the same statuses as the panel. */
function paintHeaderHealth(summary) {
  const el = document.getElementById("headerLive");
  if (!el) return;
  el.className = "header-live " + summary.state;
  el.title = summary.title;
  el.setAttribute("aria-label", summary.label + " — " + summary.title);
  el.innerHTML = '<span class="live-dot"></span>' + summary.label;
}

function record(name, ok, err, latency) {
  const f = FEEDS[name] || (FEEDS[name] = {
    name, status: "OFFLINE", lastOk: 0, lastErr: "", count: 0, latency: 0,
    source: "page", lastAttempt: 0, fails: 0, lastErrAt: 0, everyMs: CADENCE_MS[name] || 0
  });
  if (!f.everyMs) f.everyMs = CADENCE_MS[name] || 0;
  f.latency = latency;
  f.source = "page";
  f.lastAttempt = now();
  if (ok) {
    f.status = "LIVE";
    f.lastOk = now();
    f.lastErr = "";
    f.fails = 0;
    f.count++;
  } else {
    f.fails = (f.fails || 0) + 1;
    f.lastErrAt = now();
    if (f.lastOk && now() - f.lastOk < 15 * 60 * 1000) f.status = "STALE";
    else f.status = "OFFLINE";
    f.lastErr = String(err || "unknown").slice(0, 120);
  }
  renderFeedStatus();
}

/**
 * A feed fetched by the single owner in the main process (news/quakes/indices). The page does not poll these
 * any more, so its own counter would never see them; this is how they appear in FEED STATUS with the truth
 * main reports — including OFFLINE/STALE, which must never be rendered as "no events".
 */
export function noteFeedStatus(update) {
  if (!update || !update.feed) return;
  const f = FEEDS[update.feed] || (FEEDS[update.feed] = {
    name: update.feed, status: "OFFLINE", lastOk: 0, lastErr: "", count: 0, latency: 0, source: "main"
  });
  f.source = "main";
  f.status = update.status || f.status;
  if (update.lastOk) f.lastOk = update.lastOk;
  if (update.lastAttempt) f.lastAttempt = update.lastAttempt;
  if (Number.isFinite(update.everyMs)) f.everyMs = update.everyMs;
  if (Number.isFinite(update.failures)) f.fails = update.failures;
  f.lastErr = String(update.lastErr || "").slice(0, 120);
  if (f.lastErr) f.lastErrAt = now();
  if (update.status === "LIVE") f.count++;
  renderFeedStatus();
}

/* Reference material — curated in the app, not fetched. It is listed separately and labelled STATIC so a
   country score can never be mistaken for live intelligence. */
const REFERENCE_SOURCES = [
  { name: "country risk index", updated: "edited 2026-10" },
  { name: "maritime chokepoints", updated: "edited 2026-10" }
];

const DIRECT_OK = new Set();   // hosts that answered directly at least once
const THROTTLED = new Set();   // hosts that returned 429 — skip direct attempts
const DIRECT_BLOCKED = new Set(); // hosts that failed direct (CORS/other) — don't retry every poll

/** Fetch a raw TEXT (XML/RSS) response through the main-process proxy.
 *  Used by the GDACS + news feeds that are XML, not JSON. */
export async function fetchText(name, url, { timeout = 12000 } = {}) {
  const t0 = now();
  const p = await proxyFetch(url);
  if (!p.ok) { record(name, false, p.error, now() - t0); throw new Error(name + ": proxy " + p.error); }
  record(name, true, null, now() - t0);
  return p.text !== undefined ? p.text : JSON.stringify(p.json);
}

export async function fetchJSON(name, url, { proxy = true, direct = true, timeout = 12000 } = {}) {
  const t0 = now();
  const host = new URL(url).hostname;
  // Try direct first unless the host is rate-limited (429) or failed CORS
  // before. A previous success must NOT skip the direct path: the old guard
  // included !DIRECT_OK.has(host), which silently routed every later poll of
  // a healthy host through the proxy forever.
  if (direct && !THROTTLED.has(host) && !DIRECT_BLOCKED.has(host)) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined });
      if (r.status === 429) THROTTLED.add(host);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      DIRECT_OK.add(host);
      record(name, true, null, now() - t0);
      return j;
    } catch (e) {
      // Remember the failure so every later poll goes straight to the proxy
      // instead of re-paying the CORS timeout (the comment above promised
      // this, but only successful hosts were cached).
      DIRECT_BLOCKED.add(host);
    }
  }
  if (!proxy) { record(name, false, "direct-failed", now() - t0); throw new Error(name + ": direct failed"); }
  const p = await proxyFetch(url);
  if (!p.ok) { record(name, false, p.error, now() - t0); throw new Error(name + ": proxy " + p.error); }
  record(name, true, null, now() - t0);
  return p.json !== undefined ? p.json : JSON.parse(p.text);
}

/* ---------- FEED STATUS panel ---------- */

export function renderFeedStatus() {
  const summary = summariseFeeds(FEEDS, { now: now(), hasCache: hasCachedHeadlines() });
  paintHeaderHealth(summary);

  const el = document.getElementById("feedStatusList");
  if (!el) return;
  const keys = Object.keys(FEEDS).sort();
  if (!keys.length) { el.innerHTML = '<div class="panel-empty">No feeds yet</div>'; return; }
  const esc = t => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let html = "";
  for (const k of keys) {
    const f = FEEDS[k];
    const dotCls = f.status === "LIVE" ? "live" : f.status === "STALE" ? "stale" : "off";
    const age = f.lastOk ? Math.round((now() - f.lastOk) / 1000) : null;
    const ageStr = age == null ? "never" : age < 60 ? age + "s" : Math.round(age / 60) + "m";
    const latency = f.latency ? " · " + Math.round(f.latency) + "ms" : "";
    const every = everyLabel(f.everyMs);
    const title = (f.source === "main" ? "Fetched by the app's single owner" : "Fetched by this page") +
      (every ? " every " + every : "") +
      " · last success " + (age == null ? "never" : ageStr + " ago") +
      (f.lastErr ? " · last error: " + f.lastErr : " · no error") +
      (f.fails ? " · " + f.fails + " consecutive failure(s)" : "");
    html += '<div class="fs-row" title="' + esc(title) + '">' +
      '<span class="fs-dot ' + dotCls + '"></span>' +
      '<span class="fs-name">' + esc(f.name) + '</span>' +
      '<span class="fs-meta">' + esc(f.status.toLowerCase()) + ' · ok ' + esc(ageStr) + esc(latency) + '</span>' +
      '</div>';
  }
  for (const s of REFERENCE_SOURCES) {
    html += '<div class="fs-row" title="Curated in the app — static reference, not a live feed">' +
      '<span class="fs-dot static"></span>' +
      '<span class="fs-name">' + esc(s.name) + '</span>' +
      '<span class="fs-meta">static · ' + esc(s.updated) + '</span>' +
      '</div>';
  }
  // Avoid replacing the panel every 30 s when nothing changed: each replacement is a reflow in a small panel.
  if (html === renderedFeedHtml) return;
  renderedFeedHtml = html;
  el.innerHTML = html;
}
// keep the panel (and the header claim) fresh even between polls
setInterval(renderFeedStatus, 30000);
