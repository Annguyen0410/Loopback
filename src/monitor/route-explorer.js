/**
 * Route explorer — pick two ports and get the real great-circle distance, the
 * true great-circle track drawn on the map, and which real chokepoints lie
 * near that track.
 *
 * Everything here is computed from coordinates. The previous version filled
 * the panel with rng() values: transit days, nautical miles, fuel cost, CO2
 * tonnage, insurance multiples and alternative-corridor ETAs were all random
 * numbers presented as an assessment. Those are gone.
 *
 * The only stated assumption is service speed, which is labelled in the output
 * so the reader can judge it.
 */

import { map } from "./map-engine.js";
import { $, esc } from "./utils.js";
import { CHOKES } from "./chokepoints.js";

/** Real port / waypoint coordinates. */
const PORTS = {
  shanghai: { lat: 31.23, lng: 121.48 }, rotterdam: { lat: 51.95, lng: 4.14 },
  singapore: { lat: 1.26, lng: 103.84 }, houston: { lat: 29.73, lng: -95.02 },
  dubai: { lat: 25.01, lng: 55.06 }, "los angeles": { lat: 33.73, lng: -118.26 },
  mumbai: { lat: 18.95, lng: 72.95 }, london: { lat: 51.51, lng: 0.48 },
  istanbul: { lat: 40.97, lng: 28.68 }, sydney: { lat: -33.96, lng: 151.23 },
  suez: { lat: 30.02, lng: 32.58 }, panama: { lat: 8.95, lng: -79.56 },
  malacca: { lat: 2.0, lng: 102.0 }, hormuz: { lat: 26.6, lng: 56.5 },
  busan: { lat: 35.10, lng: 129.04 }, tianjin: { lat: 38.99, lng: 117.74 },
  antwerp: { lat: 51.27, lng: 4.35 }, jeddah: { lat: 21.48, lng: 39.18 },
  tokyo: { lat: 35.45, lng: 139.66 }, "new york": { lat: 40.65, lng: -74.05 },
  vancouver: { lat: 49.29, lng: -123.11 }, odesa: { lat: 46.49, lng: 30.74 },
  aden: { lat: 12.79, lng: 45.03 }, mombasa: { lat: -4.06, lng: 39.67 },
  "cape town": { lat: -33.92, lng: 18.43 }, colombo: { lat: 6.95, lng: 79.84 }
};

/** Typical service speeds (knots) by vessel class — the one stated assumption. */
const SERVICE_SPEED = {
  "Ultra-Large Container": 22,
  "Suezmax Tanker": 14,
  "VLCC": 15,
  "Bulk Carrier": 14,
  "LNG Carrier": 19,
  "Panamax": 21
};

const NM_PER_KM = 1 / 1.852;
const R_KM = 6371;

const toRad = d => (d * Math.PI) / 180;
const toDeg = r => (r * 180) / Math.PI;

/** Great-circle distance in kilometres. */
function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Interpolate the great circle between two points (spherical linear interp). */
function greatCircle(a, b, steps = 96) {
  const φ1 = toRad(a.lat), λ1 = toRad(a.lng), φ2 = toRad(b.lat), λ2 = toRad(b.lng);
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
  )));
  if (!d) return [[a.lat, a.lng], [b.lat, b.lng]];
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    pts.push([toDeg(Math.atan2(z, Math.hypot(x, y))), toDeg(Math.atan2(y, x))]);
  }
  return pts;
}

/** Chokepoints whose real position sits on (or very near) the plotted track. */
function chokesOnTrack(track, maxKm = 320) {
  const hits = [];
  for (const c of CHOKES) {
    let best = Infinity;
    for (const [lat, lng] of track) {
      const dLat = (lat - c.lat) * 111;
      const dLng = (lng - c.lng) * 111 * Math.cos(toRad(c.lat));
      const d = Math.hypot(dLat, dLng);
      if (d < best) best = d;
    }
    if (best <= maxKm) hits.push({ name: c.name, km: Math.round(best), note: c.note });
  }
  return hits.sort((a, b) => a.km - b.km);
}

let routeLine = null;

export function renderRouteTab() {
  const calc = $("routeCalc");
  if (calc && !calc.dataset.wired) {
    calc.addEventListener("click", calcRoute);
    calc.dataset.wired = "1";
  }
  ["routeFrom", "routeTo"].forEach(id => {
    const el = $(id);
    if (el && !el.dataset.wired) {
      el.addEventListener("keydown", e => { if (e.key === "Enter") calcRoute(); });
      el.dataset.wired = "1";
    }
  });
}

/** Match the typed text against a known port name. */
function findPort(input) {
  const q = String(input || "").toLowerCase().trim();
  if (!q) return null;
  if (PORTS[q]) return { key: q, ...PORTS[q] };
  for (const k of Object.keys(PORTS)) {
    if (q.includes(k) || k.includes(q)) return { key: k, ...PORTS[k] };
  }
  return null;
}

const title = s => s.charAt(0).toUpperCase() + s.slice(1);

function calcRoute() {
  if (!map) return;
  const result = $("routeResult");
  if (!result) return;

  const fromRaw = $("routeFrom").value || "Shanghai";
  const toRaw = $("routeTo").value || "Rotterdam";
  const cargo = $("routeCargo") ? $("routeCargo").value : "—";
  const vessel = $("routeVessel") ? $("routeVessel").value : "Ultra-Large Container";

  const fromPt = findPort(fromRaw);
  const toPt = findPort(toRaw);
  if (!fromPt || !toPt) {
    const unknown = !fromPt ? fromRaw : toRaw;
    result.innerHTML = '<div class="route-seg"><div class="route-seg-title">UNKNOWN PORT</div>' +
      '<div class="route-seg-text">No coordinates for “' + esc(unknown) + '”. Known ports: ' +
      esc(Object.keys(PORTS).map(title).join(", ")) + "</div></div>";
    result.classList.add("active");
    return;
  }
  if (fromPt.key === toPt.key) {
    result.innerHTML = '<div class="route-seg"><div class="route-seg-title">SAME POINT</div>' +
      '<div class="route-seg-text">Origin and destination resolve to the same place.</div></div>';
    result.classList.add("active");
    return;
  }

  const km = haversineKm(fromPt, toPt);
  const nm = km * NM_PER_KM;
  const track = greatCircle(fromPt, toPt);
  const nearChokes = chokesOnTrack(track);

  const speed = SERVICE_SPEED[vessel] || 18;
  const hours = nm / speed;
  const days = hours / 24;

  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
  routeLine = L.polyline(track, { color: "#00ff88", weight: 2, dashArray: "8 4", opacity: 0.75 }).addTo(map);
  routeLine.bindPopup('<div class="popup-place">' + esc(title(fromPt.key)) + " → " + esc(title(toPt.key)) + "</div>" +
    '<div class="popup-row"><span class="popup-label">Great circle</span><span class="popup-value">' +
    Math.round(nm).toLocaleString() + " nm</span></div>");

  let chokesHtml = "";
  if (nearChokes.length) {
    for (const c of nearChokes) {
      chokesHtml += '<div class="route-choke-severity"><span class="choke-sev-dot"></span>' +
        '<span class="choke-sev-name">' + esc(c.name) + "</span>" +
        '<span class="choke-sev-level">' + c.km + " km off track</span></div>" +
        '<div class="choke-detail">↳ ' + esc(c.note) + "</div>";
    }
  } else {
    chokesHtml = '<div class="route-seg-text">No listed chokepoint lies within 320 km of the direct track.</div>';
  }

  result.innerHTML =
    '<div class="route-path"><span>' + esc(title(fromPt.key)) + '</span><span class="route-arrow">→</span><span>' + esc(title(toPt.key)) + "</span></div>" +
    '<div class="route-seg"><div class="route-seg-title">GREAT-CIRCLE DISTANCE (COMPUTED)</div>' +
      '<div class="route-seg-text" style="font-size:13px;font-weight:700;color:var(--accent)">' +
      Math.round(nm).toLocaleString() + " nm · " + Math.round(km).toLocaleString() + " km</div>" +
      '<div class="route-seg-text" style="font-size:8.5px">Straight great-circle measure between the two coordinates. ' +
      "An actual passage through canals or around capes is longer.</div></div>" +
    '<div class="route-seg"><div class="route-seg-title">TRANSIT AT ' + speed + " kn</div>" +
      '<div class="route-seg-text">' + days.toFixed(1) + " days (" + Math.round(hours) + " h) — assuming " +
      speed + " knots service speed for a " + esc(vessel) + "</div>" +
      '<div class="route-seg-text" style="font-size:8.5px">Assumption only: excludes port time, weather and canal transit.</div></div>' +
    '<div class="route-choke"><div class="route-choke-title">CHOKEPOINTS NEAR THE TRACK</div>' + chokesHtml + "</div>" +
    '<div class="route-seg"><div class="route-seg-title">CARGO / VESSEL</div><div class="route-seg-text">' +
      esc(cargo) + " • " + esc(vessel) + "</div></div>";

  result.classList.add("active");
  map.fitBounds(L.latLngBounds([[fromPt.lat, fromPt.lng], [toPt.lat, toPt.lng]]), { padding: [120, 120], maxZoom: 6 });
}
