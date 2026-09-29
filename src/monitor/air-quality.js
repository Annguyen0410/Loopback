/**
 * Air quality hotspots — Open-Meteo Air Quality API (no key), matching
 * known-polluted city coordinates. Gracefully shows a friendly empty state
 * when the feed is unavailable.
 */

import { $, esc } from "./utils.js";
import { fetchJSON } from "./net.js";
import { setAirQuality } from "./map-layers.js";

const HOTSPOTS = [
  { name: "Beijing", lat: 39.90, lng: 116.40 },
  { name: "Delhi",   lat: 28.61, lng: 77.20 },
  { name: "Lahore",  lat: 31.55, lng: 74.34 },
  { name: "Bangkok", lat: 13.75, lng: 100.49 },
  { name: "Shanghai",lat: 31.23, lng: 121.47 },
  { name: "Mexico City", lat: 19.43, lng: -99.13 }
];

export async function fetchAirQuality() {
  try {
    const out = [];
    // Batch all cities in one request (Open-Meteo supports multi-location)
    const lat = HOTSPOTS.map(h => h.lat).join(",");
    const lng = HOTSPOTS.map(h => h.lng).join(",");
    const url = "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" + lat +
      "&longitude=" + lng + "&current=pm2_5,pm10";
    const data = await fetchJSON("airq", url, { timeout: 15000 });
    if (data && Array.isArray(data)) {
      for (let i = 0; i < HOTSPOTS.length; i++) {
        const loc = data[i];
        if (loc && loc.current && typeof loc.current.pm2_5 === "number") {
          out.push({ name: HOTSPOTS[i].name, lat: HOTSPOTS[i].lat, lng: HOTSPOTS[i].lng, val: loc.current.pm2_5 });
        }
      }
    }
    renderAirQuality(out);
    setAirQuality(out);
  } catch { /* recorded by feed — empty state shown */ }
}

export function renderAirQuality(rows) {
  const el = $("oaqList");
  if (!el) return;
  if (!rows || !rows.length) {
    el.innerHTML = '<div class="panel-empty">No air-quality data</div>';
    return;
  }
  // "Hotspots" should read worst-first, not in the order the cities were
  // typed into the source array.
  const sorted = rows.slice().sort((a, b) => (b.val || 0) - (a.val || 0));
  let html = "";
  for (const r of sorted.slice(0, 14)) {
    const v = r.val;
    const color = v == null ? "#888" : v > 150 ? "#ff5c66" : v > 55 ? "#ffb84d" : "#2dffa8";
    const band = v == null ? "—" : v > 150 ? "unhealthy" : v > 55 ? "moderate" : "good";
    html += '<div class="ioda-row" title="' + esc(band) +
      ' — WHO 24h PM2.5 guideline is 15 µg/m³"><span class="ioda-dot" style="background:' + color + '"></span>' +
      '<span class="ioda-name">' + esc(r.name) + "</span>" +
      '<span class="ioda-score">' + (v == null ? "—" : v.toFixed(0)) + " <span class=\"ioda-unit\">µg/m³</span></span>" +
      '<span class="ioda-type">PM2.5</span></div>';
  }
  el.innerHTML = html;
}

