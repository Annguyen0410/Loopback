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

export const FEEDS = {}; // name -> { name, status, lastOk, lastErr, count, latency }

function now() { return Date.now(); }

function record(name, ok, err, latency) {
  const f = FEEDS[name] || (FEEDS[name] = { name, status: "OFFLINE", lastOk: 0, lastErr: "", count: 0, latency: 0 });
  f.latency = latency;
  if (ok) { f.status = "LIVE"; f.lastOk = now(); f.lastErr = ""; f.count++; }
  else {
    if (f.lastOk && now() - f.lastOk < 15 * 60 * 1000) f.status = "STALE";
    else f.status = "OFFLINE";
    f.lastErr = String(err || "unknown").slice(0, 120);
  }
  renderFeedStatus();
}

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
  const el = document.getElementById("feedStatusList");
  if (!el) return;
  const keys = Object.keys(FEEDS).sort();
  if (!keys.length) { el.innerHTML = '<div class="panel-empty">No feeds yet</div>'; return; }
  let html = "";
  for (const k of keys) {
    const f = FEEDS[k];
    const dotCls = f.status === "LIVE" ? "live" : f.status === "STALE" ? "stale" : "off";
    const age = f.lastOk ? Math.round((now() - f.lastOk) / 1000) : null;
    const ageStr = age == null ? "never" : age < 60 ? age + "s" : Math.round(age / 60) + "m";
    html += '<div class="fs-row" title="' + (f.lastErr || "ok") + '">' +
      '<span class="fs-dot ' + dotCls + '"></span>' +
      '<span class="fs-name">' + f.name + '</span>' +
      '<span class="fs-meta">' + f.status.toLowerCase() + ' · ' + ageStr + '</span>' +
      '</div>';
  }
  el.innerHTML = html;
}
// keep the panel fresh even between polls
setInterval(renderFeedStatus, 10000);
