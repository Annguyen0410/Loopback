/**
 * Day/Night terminator — the live boundary between sunlight and darkness,
 * computed from the Sun's current ecliptic position (no API needed). Draws
 * a semi-transparent night cap, the terminator line, and ☀/☾ markers.
 */

import { map } from "./map-engine.js";

let nightLayer = null;

function sunPosition(date) {
  const rad = Math.PI / 180;
  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12, 0, 0)) / 86400000;
  const L = (280.460 + 0.9856474 * d) * rad;
  const g = (357.528 + 0.9856003 * d) * rad;
  const lambda = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const eps = 23.439 * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (280.46061837 + 360.98564736629 * d) * rad;
  let lng = ra - gmst;
  lng = ((lng + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return { lat: dec / rad, lng: lng / rad };
}

/** Points 90° from a pole point (the great-circle terminator). */
function ring(poleLatDeg, poleLngDeg, steps = 360) {
  const rad = Math.PI / 180;
  const lat = poleLatDeg * rad, lng = poleLngDeg * rad;
  const pts = [];
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const b = (i / steps) * 2 * Math.PI;
    const lat2 = Math.asin(Math.cos(lat) * Math.cos(b));
    let lng2 = lng + Math.atan2(Math.sin(b) * Math.cos(lat), -Math.sin(lat) * Math.sin(lat2));
    // unwrap longitude so the ring stays continuous across ±180
    if (prev != null) {
      let d = lng2 - prev;
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      lng2 = prev + d;
    }
    prev = lng2;
    pts.push([lat2 / rad, lng2 / rad]);
  }
  return pts;
}

function update() {
  if (!nightLayer || !map) return;
  nightLayer.clearLayers();
  const sun = sunPosition(new Date());

  // Night cap: ring around the anti-solar point (filled)
  const nightRing = ring(-sun.lat, sun.lng + 180);
  nightLayer.addLayer(L.polygon(nightRing, { color: "transparent", fillColor: "#000033", fillOpacity: 0.14, weight: 0, interactive: false }));

  // Terminator boundary line (around the sun)
  const dayRing = ring(sun.lat, sun.lng);
  nightLayer.addLayer(L.polyline(dayRing, { color: "#ffcc66", weight: 1.2, opacity: 0.5, dashArray: "4 4", interactive: false }));

  // Sun + moon markers
  const sunPt = L.circleMarker([sun.lat, sun.lng], { radius: 6, fillColor: "#ffdd55", color: "#000", weight: 1, opacity: 0.95, fillOpacity: 0.9 });
  sunPt.bindPopup('<div class="popup-place">☀️ Sub-solar point</div>');
  nightLayer.addLayer(sunPt);
  const moonPt = L.circleMarker([-sun.lat, sun.lng + 180], { radius: 5, fillColor: "#cccccc", color: "#000", weight: 1, opacity: 0.9, fillOpacity: 0.85 });
  moonPt.bindPopup('<div class="popup-place">🌙 Anti-solar point</div>');
  nightLayer.addLayer(moonPt);
}

function layerDefault() {
  const k = "wm_layer_dayNight";
  const v = localStorage.getItem(k);
  if (v !== null) return v === "1";
  localStorage.setItem(k, "1");
  return true;
}

export function initDayNight() {
  if (!map) return;
  nightLayer = L.layerGroup();
  if (layerDefault()) nightLayer.addTo(map);
  update();
  setInterval(update, 60 * 1000);
  if (typeof window !== "undefined") {
    window.__daynight = {
      onMap: () => !!(nightLayer && map && map.hasLayer(nightLayer)),
      layers: () => (nightLayer ? nightLayer.getLayers().length : 0)
    };
  }
}

export function setDayNight(on) {
  if (!nightLayer || !map) return;
  if (on) { if (!map.hasLayer(nightLayer)) nightLayer.addTo(map); }
  else if (map.hasLayer(nightLayer)) map.removeLayer(nightLayer);
}
