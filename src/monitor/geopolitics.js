/**
 * Geopolitics: GDELT events & IODA internet outages (both no-key).
 */

import { $, esc } from "./utils.js";
import { fetchJSON } from "./net.js";
import { setConflict } from "./map-layers.js";
import { logWorldEvent } from "./events.js";
import { setThreatInput } from "./threat-level.js";
import { COUNTRIES } from "./country-risk.js";

/* ---------- GDELT DOC 2.0 ---------- */

const NAME_TO_COUNTRY = new Map(COUNTRIES.map(c => [c.name.toLowerCase(), c]));

/**
 * GDELT's artlist mode returns no coordinates at all — only the country the
 * *reporting outlet* sits in. The previous version filtered on `a.lat/a.lng`,
 * which artlist never provides, so the Conflicts map layer was permanently
 * empty. Geocode to the reporting country's centroid and aggregate, so the
 * map shows real "where this conflict is being reported from" hotspots.
 */
function conflictHotspots(articles) {
  const buckets = new Map();
  let matched = 0;
  for (const a of articles) {
    const c = NAME_TO_COUNTRY.get(String(a.sourcecountry || "").toLowerCase());
    if (!c) continue;
    matched++;
    const b = buckets.get(c.iso) || { lat: c.lat, lng: c.lng, name: c.name, count: 0, title: "" };
    b.count++;
    if (!b.title) b.title = a.title || "";
    buckets.set(c.iso, b);
  }
  return [...buckets.values()].map(b => ({
    lat: b.lat,
    lng: b.lng,
    place: b.name + " — " + b.count + " conflict report" + (b.count > 1 ? "s" : ""),
    title: b.title
  }));
}

// GDELT allows one query every 5 seconds and answers 429 when it is busy.
// Back off instead of retrying into the rate limiter every poll.
let gdeltBackoffUntil = 0;

/**
 * Fetch GDELT conflict reports.
 * Returns an array (possibly empty — a clean fetch with no matches) or
 * `null` when the feed could not be reached at all. The caller renders
 * those two states differently: "no events" is news, "unreachable" is not.
 */
export async function fetchGDELT() {
  if (Date.now() < gdeltBackoffUntil) return null;
  try {
    const url = "https://api.gdeltproject.org/api/v2/doc/doc?query=conflict%20OR%20protest%20OR%20sanctions&mode=artlist&maxrecords=25&format=json&sort=datedesc";
    const data = await fetchJSON("gdelt", url, { timeout: 20000 });
    if (data && data.articles && data.articles.length) {
      setConflict(conflictHotspots(data.articles));
      return data.articles;
    }
    return [];
  } catch (e) {
    if (/429|rate/i.test(String((e && e.message) || e))) gdeltBackoffUntil = Date.now() + 5 * 60 * 1000;
    return null;
  }
}

/** GDELT `seendate` "20260929T041500Z" → epoch ms (it is not ISO). */
function seenDateMs(s) {
  if (!s || s.length < 15) return null;
  const t = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
    +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15));
  return isFinite(t) ? t : null;
}

export function renderGDELT(articles) {
  const el = $("gdeltList");
  if (!el) return;
  // null = fetch failed. The old code folded that into "No GDELT events yet",
  // which read as a quiet world while the feed was actually down.
  if (articles == null) { el.innerHTML = '<div class="panel-empty">GDELT unreachable — retrying…</div>'; return; }
  if (!articles.length) { el.innerHTML = '<div class="panel-empty">No GDELT events in the current window</div>'; return; }
  let html = "";
  setThreatInput("conflicts", articles.length);
  for (const a of articles.slice(0, 20)) {
    // seendate "20260929T041500Z" sliced at (0,10) printed the garbage
    // "20260929T0" — format it properly now.
    const t = seenDateMs(a.seendate);
    const dt = t ? new Date(t).toISOString().slice(0, 10) : "";
    html += '<div class="gdelt-row"><span class="gdelt-source">' + esc(a.domain || "?") + "</span>" +
      '<span class="gdelt-title"><a href="' + a.url + '" target="_blank" rel="noopener">' + esc((a.title || "").slice(0, 110)) + "</a></span>" +
      '<span class="gdelt-date">' + dt + "</span></div>";
  }
  // Surface a handful of conflicts in the live events log — with the
  // report's own timestamp, not the poll time.
  for (const a of articles.slice(0, 6)) {
    logWorldEvent({
      cat: "CONFLICT", sev: "info",
      title: (a.title || "").slice(0, 90),
      time: seenDateMs(a.seendate) || undefined,
      key: "gdelt" + (a.url || a.title || Math.random())
    });
  }
  el.innerHTML = html;
}

/* ---------- IODA internet outages ---------- */

/**
 * IODA internet outages. Returns the event array (possibly empty) or
 * `null` when the API is unreachable — the renderer shows those differently.
 */
export async function fetchIODA() {
  try {
    const until = Math.floor(Date.now() / 1000);
    const from = until - 24 * 3600;
    const url = "https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?from=" + from + "&until=" + until + "&limit=30";
    const data = await fetchJSON("ioda", url, { timeout: 15000 });
    if (data && data.data && Array.isArray(data.data)) return data.data;
    return [];
  } catch { /* recorded */ }
  return null;
}

/** "14d 5h" / "3h 20m" / "42m" from a duration in seconds. */
function shortDuration(sec) {
  if (!sec || sec <= 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return d + "d " + h + "h";
  if (h) return h + "h " + m + "m";
  return m + "m";
}

export function renderIODA(events) {
  const el = $("iodaList");
  if (!el) return;
  if (events == null) { el.innerHTML = '<div class="panel-empty">IODA unreachable — retrying…</div>'; return; }
  if (!events.length) { el.innerHTML = '<div class="panel-empty">No major outages in last 24h</div>'; return; }

  // IODA v2 reports an unbounded anomaly *score* (not a percentage) plus a
  // location_name and a duration. Normalise the score within the visible set
  // so the bar reads as relative severity instead of a nonsense "2010830%".
  const rows = [];
  for (const ev of events.slice(0, 14)) {
    const score = Number(ev.score) || 0;
    rows.push({
      ev,
      score,
      name: ev.location_name || ev.location || "Unknown",
      code: ev.location || ""
    });
  }
  const max = Math.max(1, ...rows.map(r => r.score));

  let html = "";
  for (const r of rows) {
    // sqrt flattens IODA's long tail so small anomalies stay visible.
    const pct = Math.round(Math.sqrt(r.score / max) * 100);
    const color = pct > 66 ? "#ff5c66" : pct > 33 ? "#ffb84d" : "#2dffa8";
    const dur = shortDuration(r.ev.duration);
    if (pct > 66) {
      logWorldEvent({
        cat: "OUTAGE", sev: "warn",
        title: r.name + " — outage " + dur,
        key: "ioda" + r.code + Math.round(r.score)
      });
    }
    html += '<div class="ioda-row" title="IODA anomaly score ' + Math.round(r.score) + ' · source ' + esc(r.ev.datasource || "?") + '">' +
      '<span class="ioda-dot" style="background:' + color + '"></span>' +
      '<span class="ioda-name">' + esc(r.name) + "</span>" +
      '<span class="ioda-bar"><span class="ioda-bar-fill" style="width:' + pct + "%;background:" + color + '"></span></span>' +
      '<span class="ioda-score">' + dur + "</span>" +
      '<span class="ioda-type">' + esc(r.ev.datasource || "?") + "</span></div>";
  }
  el.innerHTML = html;
}
