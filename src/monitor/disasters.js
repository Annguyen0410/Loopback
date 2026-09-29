/**
 * Disaster alert feed (GDACS) — RSS XML fetched via proxy text and parsed
 * with DOMParser. No API key needed.
 */

import { $, esc } from "./utils.js";
import { fetchText } from "./net.js";
import { setGDACS } from "./map-layers.js";
import { logWorldEvent } from "./events.js";
import { setThreatInput } from "./threat-level.js";

/** GDACS event type → glyph, so the panel reads at a glance. */
const TYPE_ICON = { EQ: "🌎", TC: "🌀", FL: "🌊", VO: "🌋", WF: "🔥", DR: "🏜" };
const TYPE_NAME = { EQ: "Earthquake", TC: "Cyclone", FL: "Flood", VO: "Volcano", WF: "Wildfire", DR: "Drought" };

/**
 * GDACS RSS. Note the real element names: the alert tier is
 * `gdacs:alertlevel` (Green/Orange/Red), the event kind is `gdacs:eventtype`
 * and coordinates live in `<geo:lat>` / `<geo:long>` — an earlier version of
 * this module read `gdacs:severity` and `geo:lon`, which do not exist in the
 * feed, so every item lost its severity and its map position.
 */
export async function fetchGDACS() {
  try {
    const xml = await fetchText("gdacs", "https://www.gdacs.org/xml/rss.xml", { timeout: 12000 });
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const txt = (node, sel) => {
      const el = node.querySelector(sel);
      return el && el.textContent ? el.textContent.trim() : "";
    };
    const items = [...(doc.querySelectorAll("item") || [])].map(item => {
      const lat = parseFloat(txt(item, "geo\\:lat, lat"));
      const lng = parseFloat(txt(item, "geo\\:long, geo\\:lon, lon"));
      const type = txt(item, "gdacs\\:eventtype").toUpperCase();
      const it = {
        title: txt(item, "title"),
        pubDate: txt(item, "pubDate"),
        link: txt(item, "link") || "https://www.gdacs.org/",
        // `gdacs:severity` is a magnitude element (value/unit attrs) — the
        // alert tier we want for colour coding is `gdacs:alertlevel`.
        severity: txt(item, "gdacs\\:alertlevel, alertlevel") || txt(item, "gdacs\\:severity, severity"),
        type,
        kind: TYPE_NAME[type] || "Hazard",
        icon: TYPE_ICON[type] || "⚠",
        country: txt(item, "gdacs\\:country"),
        eventId: txt(item, "gdacs\\:eventid"),
        severityText: txt(item, "gdacs\\:severity"),
        population: txt(item, "gdacs\\:population")
      };
      if (isFinite(lat) && isFinite(lng)) { it.lat = lat; it.lng = lng; }
      return it;
    });
    const clean = items.filter(i => i.title);
    setGDACS(clean);
    return clean;
  } catch { /* recorded by fetchText */ }
  // Unreachable. Callers distinguish this from a clean-but-empty fetch.
  return null;
}

export function renderGDACS(items) {
  const el = $("gdacsList");
  if (!el) return;
  // null = the feed itself was unreachable — never present that as a quiet world.
  if (items == null) {
    el.innerHTML = '<div class="panel-empty">GDACS unreachable — retrying…</div>';
    return;
  }
  if (!items.length) {
    el.innerHTML = '<div class="panel-empty">No recent GDACS alerts</div>';
    return;
  }
  let html = "";
  let red = 0;
  let orange = 0;
  for (const it of items.slice(0, 14)) {
    const lvl = (it.severity || "").toLowerCase();
    const cls = lvl.includes("red") ? "crit" : lvl.includes("orange") ? "warn" : lvl.includes("green") ? "ok" : "info";
    const sev = lvl.includes("red") ? "crit" : lvl.includes("orange") ? "warn" : "info";
    if (sev === "crit") red++;
    if (sev === "warn") orange++;
    // Only Orange/Red alerts are newsworthy enough for the live event stream.
    if (sev !== "info") {
      logWorldEvent({
        cat: it.kind ? it.kind.toUpperCase() : "DISASTER",
        sev,
        title: it.title,
        time: it.pubDate ? (Date.parse(it.pubDate) || Date.now()) : Date.now(),
        key: "gd" + (it.eventId || it.title)
      });
    }
    const meta = it.country
      ? esc(it.country) + " · " + (it.pubDate || "").slice(0, 16)
      : esc((it.pubDate || "").slice(0, 16));
    const href = it.link || "https://www.gdacs.org/";
    html += '<div class="gdacs-row">' +
      '<span class="gdacs-level ' + cls + '" title="' + esc(it.severity || "unknown") + " — " + esc(it.kind || "") + '">' + esc(it.icon || "⚠") + "</span>" +
      '<span class="gdacs-title"><a href="' + href + '" target="_blank" rel="noopener">' + esc(it.title) + "</a></span>" +
      '<span class="gdacs-meta">' + meta + "</span></div>";
  }
  el.innerHTML = html;
  // Orange counts half a step so a wave of flood warnings still moves the dial.
  setThreatInput("redAlerts", red + (orange ? Math.min(1, orange / 4) : 0));
}