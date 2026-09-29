/**
 * Map data layers — renders every layer toggle as real Leaflet content.
 *
 *  quakes        USGS live (owned by quakes.js)
 *  hazards       GDACS events (wildfires/floods/etc.) — live coords if present
 *  weatherEvents storm tracks (live from Open-Meteo storm warnings)
 *  aircraft      real ADS-B positions (OpenSky)
 *  ports         real world port list
 *  cables        real submarine cable geometry (TeleGeography)
 *  satellites    real ISS position + track (wheretheiss.at)
 *  airq          live PM2.5 from Open-Meteo (reuses air-quality data)
 *  conflict      GDELT reporting-country hotspots when feed is live
 */

import { map, drawGroundTrack, clearGroundTrack } from "./map-engine.js";
import { layerState } from "./layer-toggles.js";
import { $, esc } from "./utils.js";
import { CHOKES } from "./chokepoints.js";
import { renderDatacenters, renderNuclear, renderBases, renderSpaceports } from "./sites.js";
import { fetchJSON } from "./net.js";

if (typeof window !== "undefined") window.__mapLayers = { debug: () => import("./map-layers.js").then(m => m.debugLayerState()) };

const layers = {}; // name -> L.layerGroup

export function getMapLayer(name) {
  if (!map) return null;
  if (!layers[name]) layers[name] = L.layerGroup();
  const el = layers[name];
  if (layerState[name] && !map.hasLayer(el)) map.addLayer(el);
  else if (!layerState[name] && map.hasLayer(el)) map.removeLayer(el);
  return el;
}

function applyState(name) {
  const el = layers[name];
  if (!el) return;
  if (layerState[name] && !map.hasLayer(el)) map.addLayer(el);
  else if (!layerState[name] && map.hasLayer(el)) map.removeLayer(el);
}

export function refreshLayer(name) { applyState(name); renderLayer(name); }

const RENDERERS = {
  airq: renderAirQuality, wildfire: renderHazards, weatherEvents: renderStorms,
  ports: renderPorts, cables: renderCables, conflict: renderConflict,
  military: drawAircraft, satellites: drawSatellites, chokepoints: renderChokepoints,
  datacenters: renderDatacenters, nuclear: renderNuclear, bases: renderBases,
  spaceports: renderSpaceports
};

export function renderLayer(name) { const f = RENDERERS[name]; if (f) f(); }

/* ---------- Air quality (PM2.5) markers ---------- */

let lastAQ = [];
export function setAirQuality(rows) { lastAQ = rows || []; renderAirQuality(); }

function renderAirQuality() {
  const g = getMapLayer("airq");
  if (!g) return;
  g.clearLayers();
  if (!layerState.airq) return;
  for (const r of lastAQ) {
    if (r.lat == null) continue;
    const col = r.val > 150 ? "#ff4444" : r.val > 55 ? "#ffaa00" : "#00cc88";
    const m = L.circleMarker([r.lat, r.lng], {
      radius: 6, fillColor: col, color: "#000", weight: 1, opacity: 0.8, fillOpacity: 0.65
    });
    m.bindPopup('<div class="popup-mag" style="color:' + col + '">' + r.val.toFixed(0) + " PM2.5</div>" +
      '<div class="popup-place">' + esc(r.name) + "</div>");
    m.addTo(g);
  }
}

/* ---------- Hazards (GDACS) ---------- */

let lastGDACS = [];
let hazardsExtra = [];
export function setGDACS(items) { lastGDACS = items || []; renderHazards(); }
export function setHazards(items) { hazardsExtra = items || []; renderHazards(); }

function renderHazards() {
  const g = getMapLayer("wildfire");
  if (!g) return;
  g.clearLayers();
  if (!layerState.wildfire) return;
  for (const it of lastGDACS.concat(hazardsExtra)) {
    if (it.lat == null) continue;
    const sev = String(it.severity || "").toLowerCase();
    const col = sev.includes("red") ? "#ff2222" : sev.includes("orange") ? "#ff8800" : sev.includes("green") ? "#22cc66" : "#ffdd00";
    const m = L.circleMarker([it.lat, it.lng], {
      radius: 9, fillColor: col, color: "#000", weight: 1.5, opacity: 0.85, fillOpacity: 0.6
    });
    m.bindPopup('<div class="popup-mag" style="color:' + col + '">' + esc(it.icon || "⚠") + " Hazard</div>" +
      '<div class="popup-place">' + esc(it.title) + "</div>");
    m.addTo(g);
  }
}

/* ---------- Storm track (Open-Meteo severe weather) ---------- */

let lastStorms = [];
export function setStorms(list) { lastStorms = list || []; renderStorms(); }

function renderStorms() {
  const g = getMapLayer("weatherEvents");
  if (!g) return;
  g.clearLayers();
  if (!layerState.weatherEvents) return;
  for (const s of lastStorms) {
    const m = L.circleMarker([s.lat, s.lng], {
      radius: 11, fillColor: "#00ffcc", color: "#000", weight: 1, opacity: 0.85, fillOpacity: 0.35
    });
    m.bindPopup('<div class="popup-mag" style="color:#00ffcc">' + esc(s.event) + "</div>" +
      '<div class="popup-place">' + esc(s.place) + "</div>");
    m.addTo(g);
  }
}

/* ---------- Aircraft — real ADS-B only ----------------------------------
 * Positions come from OpenSky's anonymous state vector API. The old version
 * fell back to ~80 scripted airliners flying invented routes and reported
 * fictional altitudes in the popups; that is gone. If OpenSky is rate-limited
 * the layer stays empty rather than inventing traffic.
 */

let trafficTimer = null;
let liveAircraft = null;

export function setAircraftLive(list) {
  liveAircraft = Array.isArray(list) && list.length ? list : null;
  drawAircraft();
}

export function initTraffic() {
  if (!map || trafficTimer) return;
  drawAircraft();
  trafficTimer = setInterval(drawAircraft, 20000);
}

/** Rotated ✈ marker icon. */
function planeIcon(deg) {
  return L.divIcon({
    className: "plane-marker",
    html: '<div class="plane-icon" style="transform:rotate(' + deg + 'deg)">✈</div>',
    iconSize: [18, 18], iconAnchor: [9, 9]
  });
}

function drawAircraft() {
  const g = getMapLayer("military");
  if (!g) return;
  g.clearLayers();
  if (!layerState.military || !liveAircraft) return;
  for (const s of liveAircraft.slice(0, 400)) {
    if (s.lat == null || s.lng == null) continue;
    const m = L.marker([s.lat, s.lng], { icon: planeIcon(s.heading || 0) });
    m.bindPopup('<div class="popup-mag" style="color:#0088ff">✈ ' + esc(s.call || "N/A") + "</div>" +
      '<div class="popup-row"><span class="popup-label">Alt</span><span class="popup-value">' + Math.round((s.alt || 0) * 3.28084) + " ft</span></div>" +
      '<div class="popup-row"><span class="popup-label">Speed</span><span class="popup-value">' + Math.round((s.vel || 0) * 1.94384) + " kt</span></div>" +
      '<div class="popup-row"><span class="popup-label">Source</span><span class="popup-value">OpenSky ADS-B</span></div>');
    m.addTo(g);
  }
}

/* ---------- Ports (real list) ---------- */

const PORTS = [
  ["Shanghai", 31.23, 121.48], ["Singapore", 1.26, 103.84], ["Ningbo", 29.87, 121.55],
  ["Shenzhen", 22.53, 113.86], ["Rotterdam", 51.95, 4.14], ["Los Angeles", 33.73, -118.26],
  ["Hamburg", 53.54, 9.98], ["Busan", 35.10, 129.04], ["Antwerp", 51.25, 4.40],
  ["Dubai", 25.07, 55.06], ["Felixstowe", 51.95, 1.35], ["New York", 40.64, -74.04],
  ["Hong Kong", 22.31, 114.17], ["Kaohsiung", 22.60, 120.30], ["Long Beach", 33.75, -118.21],
  ["Tanjung Pelepas", 1.36, 103.52], ["Shanghai Yangshan", 30.62, 122.06], ["Qingdao", 36.07, 120.25],
  ["Xiamen", 24.44, 118.06], ["Le Havre", 49.49, 0.11], ["Valencia", 39.46, -0.33], ["Algeciras", 36.13, -5.43]
];

function renderPorts() {
  const g = getMapLayer("ports");
  if (!g) return;
  g.clearLayers();
  if (!layerState.ports) return;
  for (const [name, lat, lng] of PORTS) {
    const m = L.circleMarker([lat, lng], {
      radius: 3.5, fillColor: "#44ccff", color: "#000", weight: 0.8, opacity: 0.8, fillOpacity: 0.75
    });
    m.bindPopup('<div class="popup-place">⚓ ' + esc(name) + "</div>");
    m.addTo(g);
  }
}

/* ---------- Submarine cables — TeleGeography public dataset -------------
 * Replaces hand-drawn polylines that merely carried real cable names. The
 * geometry here is TeleGeography's published cable map data, fetched lazily
 * the first time the layer is switched on.
 */

const CABLE_GEO_URL = "https://www.submarinecablemap.com/api/v3/cable/cable-geo.json";
let cableData = null;
let cablesLoading = false;

async function loadCables() {
  if (cableData || cablesLoading) return;
  cablesLoading = true;
  try {
    const geo = await fetchJSON("cables", CABLE_GEO_URL, { timeout: 40000, direct: false });
    cableData = geo && Array.isArray(geo.features) ? geo.features : [];
  } catch { cableData = []; }
  cablesLoading = false;
  renderCables();
}

function renderCables() {
  const g = getMapLayer("cables");
  if (!g) return;
  g.clearLayers();
  if (!layerState.cables) return;
  if (!cableData) { loadCables(); return; }
  for (const f of cableData) {
    const geom = f.geometry;
    if (!geom || !geom.coordinates) continue;
    const name = (f.properties && f.properties.name) || "Submarine cable";
    const col = (f.properties && f.properties.color) || "#ff4488";
    const segs = geom.type === "MultiLineString" ? geom.coordinates : [geom.coordinates];
    for (const seg of segs) {
      if (!seg || seg.length < 2) continue;
      const pts = seg.map(c => [c[1], c[0]]);
      const line = L.polyline(pts, { color: col, weight: 1.3, opacity: 0.7 });
      line.bindPopup('<div class="popup-place">🗄 ' + esc(name) + "</div>" +
        '<div class="popup-row"><span class="popup-label">Source</span><span class="popup-value">TeleGeography</span></div>');
      line.addTo(g);
    }
  }
}

/* ---------- Satellites — real ISS telemetry only -----------------------
 * The Starlink / Tiangong markers were positioned by an orbit formula, which
 * looks precise but is not observation. Only the real ISS position from
 * wheretheiss.at is drawn, and the ground track is built from successive real
 * fixes rather than a synthetic orbit.
 */

let liveISS = null;
const issTrack = []; // real observed positions, oldest first

export function setISS(d) {
  liveISS = d && d.latitude != null ? d : null;
  if (liveISS) {
    issTrack.push([liveISS.latitude, liveISS.longitude]);
    if (issTrack.length > 150) issTrack.shift();
  }
  drawSatellites();
}

function drawSatellites() {
  const g = getMapLayer("satellites");
  if (!g) return;
  g.clearLayers();
  if (!layerState.satellites || !liveISS) { clearGroundTrack("iss"); return; }

  if (issTrack.length > 1) drawGroundTrack("iss", issTrack, "#00aaff", { dashArray: "2 3" });
  const m = L.circleMarker([liveISS.latitude, liveISS.longitude], {
    radius: 5, fillColor: "#00ccff", color: "#000", weight: 0.8, opacity: 0.9, fillOpacity: 0.9
  });
  m.bindPopup('<div class="popup-place">🛰 ISS (ZARYA)</div>' +
    '<div class="popup-row"><span class="popup-label">Alt</span><span class="popup-value">' + Math.round(liveISS.altitude || 0) + " km</span></div>" +
    '<div class="popup-row"><span class="popup-label">Velocity</span><span class="popup-value">' + Math.round(liveISS.velocity || 0) + " km/h</span></div>" +
    '<div class="popup-row"><span class="popup-label">Source</span><span class="popup-value">wheretheiss.at</span></div>');
  m.addTo(g);
}

/* ---------- Conflict hotspots (GDELT geo dots) ---------- */

let lastConflict = [];
export function setConflict(list) { lastConflict = list || []; renderConflict(); }

function renderConflict() {
  const g = getMapLayer("conflict");
  if (!g) return;
  g.clearLayers();
  if (!layerState.conflict) return;
  for (const c of lastConflict) {
    if (c.lat == null) continue;
    const m = L.circleMarker([c.lat, c.lng], {
      radius: 7, fillColor: "#ff00aa", color: "#000", weight: 1, opacity: 0.85, fillOpacity: 0.55
    });
    m.bindPopup('<div class="popup-mag" style="color:#ff00aa">⚠ ' + esc(c.title) + "</div>" +
      '<div class="popup-place">' + esc(c.place) + "</div>" +
      '<div class="popup-row"><span class="popup-label">Source</span><span class="popup-value">GDELT</span></div>' +
      '<div class="popup-row"><span class="popup-label">Plotted at</span><span class="popup-value">reporting country</span></div>');
    m.addTo(g);
  }
}

/* Cyber and disease incident layers were removed: no free public feed
   publishes live incident/outbreak locations, and inventing them put fake
   incident markers on real cities. */

/* ---------- Maritime chokepoints (real straits, reference only) ---------- */

function renderChokepoints() {
  const g = getMapLayer("chokepoints");
  if (!g) return;
  g.clearLayers();
  if (!layerState.chokepoints) return;
  for (const c of CHOKES) {
    const m = L.circleMarker([c.lat, c.lng], {
      radius: 6, fillColor: "#ff8844", color: "#000", weight: 1, opacity: 0.85, fillOpacity: 0.5
    });
    m.bindPopup('<div class="popup-mag" style="color:#ff8844">⛴ ' + esc(c.name) + "</div>" +
      '<div class="popup-place">' + esc(c.note) + "</div>");
    m.addTo(g);
  }
}

/* ---------- master init + re-render on toggle ---------- */

export function initMapLayers() {
  renderAirQuality();
  renderHazards();
  renderStorms();
  renderPorts();
  renderCables();
  renderConflict();
  renderChokepoints();
  renderDatacenters();
  renderNuclear();
  renderBases();
  renderSpaceports();
  initTraffic();
  drawSatellites();
  setInterval(drawSatellites, 15000);
  setInterval(renderPorts, 300000);
  // Cable geometry is static; only re-draw when the layer is toggled.
}

export function applyLayerStateAll() {
  for (const name of Object.keys(layers)) applyState(name);
}

export function debugLayerState() {
  const out = {};
  for (const name of Object.keys(layers)) {
    const el = layers[name];
    out[name] = { on: layerState[name] === true, markers: el.getLayers().length, onMap: map.hasLayer(el) };
  }
  return out;
}
