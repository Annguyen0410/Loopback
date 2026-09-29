/**
 * Live earthquakes (USGS) + moon phase illustration.
 */

import { $, fmtTime } from "./utils.js";
import { fetchJSON } from "./net.js";
import { map } from "./map-engine.js";
import { logWorldEvent } from "./events.js";
import { setThreatInput } from "./threat-level.js";

const DEPTH_COLORS = [
  [10, "#ff2222"], [30, "#ff6600"], [70, "#ffaa00"],
  [150, "#aacc00"], [300, "#00aa44"], [500, "#0088ff"], [Infinity, "#7700cc"]
];
function depthColor(d) { for (const [max, c] of DEPTH_COLORS) if (d < max) return c; return "#7700cc"; }
function magBg(m) { return m >= 6 ? "#ff2222" : m >= 5 ? "#ff6600" : m >= 4 ? "#ffaa00" : m >= 3 ? "#44aa44" : "#557755"; }

export let quakeData = null;
export let quakeLayer = null;
let quakesCallback = null;
let allFeatures = [];
let offsetMin = 0; // timeline scrub
let majorOnly = false; // M5+ filter

export function initQuakeLayer() {
  if (!map) return;
  if (!quakeLayer) {
    quakeLayer = L.layerGroup();
    const show = layerDefault("quakes");
    if (show) quakeLayer.addTo(map);
  }
}

function layerDefault(name) {
  const v = localStorage.getItem("wm_layer_" + name);
  if (v !== null) return v === "1";
  const def = name === "quakes";
  localStorage.setItem("wm_layer_" + name, def ? "1" : "0");
  return def;
}

export function setQuakeMajorOnly(on) { majorOnly = !!on; renderQuakes(); }

export function onQuakes(cb) { quakesCallback = cb; }

export async function fetchQuakes() {
  try {
    const data = await fetchJSON("quakes", "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson", { direct: false });
    if (data && data.features && data.features.length) {
      applyQuakeData(data);
      return data;
    }
  } catch { /* recorded by fetchJSON */ }
  // No simulated earthquakes: an empty feed shows an empty state rather than
  // inventing seismic events (they also reached the event log and threat level).
  if (!quakeData) renderQuakeEmptyState();
  return quakeData;
}

function renderQuakeEmptyState() {
  const st = $("stats");
  if (st) {
    st.innerHTML =
      '<button class="widget-toggle" title="Toggle" data-target="stats">&#x23FB;</button>' +
      '<div class="panel-head">SEISMIC STATS</div>' +
      '<div class="panel-empty">USGS feed unreachable</div>';
  }
  const tk = $("ticker");
  if (tk) tk.innerHTML = '<span class="tq-place">USGS quake feed unreachable</span>';
}

/** Main-process push (monitor:live type=quakes). */
export function applyLiveQuakes(data) {
  if (data && data.features && data.features.length) applyQuakeData(data);
}

function applyQuakeData(data) {
  quakeData = data;
  allFeatures = data.features;
  renderQuakes();
  renderMoonPhase();
  renderStats(data.features);
  renderTicker(data.features);
  recordQuakeIntel(data.features);
  if (quakesCallback) quakesCallback(data);
}

export function scrubQuakes(offMin) {
  offsetMin = offMin;
  renderQuakes();
}

function renderQuakes() {
  if (!map || !quakeLayer) return;
  quakeLayer.clearLayers();
  const cutoff = Date.now() - (offsetMin || 0) * 60000;
  for (const f of allFeatures) {
    if (f.properties.time > cutoff) continue; // scrubbed out
    if (majorOnly && f.properties.mag < 5) continue;
    const [lng, lat, depth] = f.geometry.coordinates;
    const mag = f.properties.mag;
    const color = depthColor(depth);
    const circle = L.circleMarker([lat, lng], {
      radius: Math.min(28, Math.max(4, mag * 3.2)),
      fillColor: color, color: "#000", weight: 1, opacity: 0.8, fillOpacity: 0.55
    });
    circle.bindPopup(
      '<div class="popup-mag" style="color:' + color + '">M ' + mag.toFixed(1) + "</div>" +
      '<div class="popup-place">' + (f.properties.place || "Unknown") + "</div>" +
      '<div class="popup-row"><span class="popup-label">Depth</span><span class="popup-value">' + depth.toFixed(1) + " km</span></div>" +
      '<div class="popup-row"><span class="popup-label">Time</span><span class="popup-value">' + fmtTime(f.properties.time) + "</span></div>" +
      (f.properties.tsunami ? '<div class="popup-row"><span class="popup-label">Tsunami</span><span class="popup-value" style="color:#ff4444">Yes</span></div>' : "")
    );
    quakeLayer.addLayer(circle);
  }
}

export function renderStats(features) {
  const st = $("stats");
  if (!st) return;
  const total = features.length;
  let maxMag = 0, significant = 0, avgDepth = 0;
  for (const f of features) {
    const m = f.properties.mag, d = f.geometry.coordinates[2];
    if (m > maxMag) maxMag = m;
    if (m >= 4.5) significant++;
    avgDepth += d;
  }
  avgDepth = total ? (avgDepth / total).toFixed(1) : "0";
  st.innerHTML =
    '<button class="widget-toggle" title="Toggle" data-target="stats">&#x23FB;</button>' +
    '<div class="panel-head">SEISMIC STATS</div>' +
    '<div class="stat-row"><span class="stat-label">Total (24h)</span><span class="stat-value">' + total + "</span></div>" +
    '<div class="stat-row"><span class="stat-label">Max Magnitude</span><span class="stat-value mag">' + maxMag.toFixed(1) + "</span></div>" +
    '<div class="stat-row"><span class="stat-label">Significant (4.5+)</span><span class="stat-value">' + significant + "</span></div>" +
    '<div class="stat-row"><span class="stat-label">Avg Depth</span><span class="stat-value">' + avgDepth + " km</span></div>";
}

export function renderTicker(features) {
  const tk = $("ticker");
  if (!tk) return;
  const sorted = features.slice().sort((a, b) => b.properties.time - a.properties.time);
  let html = "";
  for (const q of sorted) {
    const m = q.properties.mag;
    const p = (q.properties.place || "?").replace(/,?\s*region of/i, "").trim();
    const d = q.geometry.coordinates[2];
    html += '<span class="tq-item"><span class="tq-mag" style="background:' + magBg(m) + '">M' + m.toFixed(1) + '</span><span class="tq-place">' + p + '</span><span class="tq-depth">' + d.toFixed(0) + "km</span></span>";
  }
  tk.innerHTML = html + html;
}

/* Feed the world-events log + threat level from live quake data. */
function recordQuakeIntel(features) {
  let big = 0;
  for (const f of features) {
    const m = f.properties.mag;
    if (m >= 6) big++;
    if (m >= 4.5) {
      logWorldEvent({
        cat: "QUAKE",
        sev: m >= 6 ? "crit" : m >= 5 ? "warn" : "info",
        title: "M" + m.toFixed(1) + " — " + (f.properties.place || "Unknown"),
        time: f.properties.time,
        key: "q" + (f.id || (f.properties.time + "|" + m))
      });
    }
  }
  setThreatInput("bigQuakes", big);
}

/* ---------- Moon phase ---------- */

export function renderMoonPhase() {
  const el = $("moonPhase");
  if (!el) return;
  const synodic = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14) / 86400000; // new moon 2000-01-06
  const days = Date.now() / 86400000 - ref;
  const phase = ((days % synodic) + synodic) % synodic / synodic; // 0..1
  const NAMES = ["New", "Waxing Crescent", "First Quarter", "Waxing Gibbous", "Full", "Waning Gibbous", "Last Quarter", "Waning Crescent"];
  const idx = Math.floor(phase * 8 + 0.5) % 8;
  const illum = Math.round((1 - Math.cos(phase * 2 * Math.PI)) / 2 * 100);
  const EMOJI = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
  el.innerHTML = '<div class="moon-face">' + EMOJI[idx] + "</div>" +
    '<div class="moon-name">' + NAMES[idx] + "</div>" +
    '<div class="moon-illum">' + illum + "% illuminated</div>";
}
