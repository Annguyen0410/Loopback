/**
 * Realtime feeds that sharpen the map: real aircraft (OpenSky ADS-B), real
 * ISS telemetry (wheretheiss.at) and real natural hazards (NASA EONET).
 *
 * These go through fetchJSON so each one registers in the FEED STATUS panel
 * and the panel can tell "no data" apart from "no source". When a source is
 * down the layer is simply left empty — nothing is simulated.
 */

import { fetchJSON } from "./net.js";
import { setAircraftLive, setISS, setHazards } from "./map-layers.js";

/* ---------- Aircraft (OpenSky anonymous state vectors) ---------- */
export async function fetchRealAircraft() {
  try {
    // direct:false — OpenSky/eonet/wheretheiss send no CORS headers, so go
    // straight through the main-process proxy instead of logging a CSP/CORS
    // error on every poll.
    const r = await fetchJSON("opensky", "https://opensky-network.org/api/states/all", { timeout: 25000, direct: false });
    if (r && Array.isArray(r.states)) {
      const states = r.states
        .map(s => ({
          call: (s[1] || "").trim(),
          lng: s[5], lat: s[6], alt: s[7], vel: s[9], heading: s[10]
        }))
        .filter(s => s.lat != null && s.lng != null);
      setAircraftLive(states.length ? states : null);
      return;
    }
  } catch { /* rate-limited or offline → empty layer */ }
  setAircraftLive(null);
}

/* ---------- ISS (wheretheiss.at) ---------- */
export async function fetchISS() {
  try {
    const r = await fetchJSON("iss", "https://api.wheretheiss.at/v1/satellites/25544", { timeout: 15000, direct: false });
    if (r && r.latitude != null) setISS(r);
  } catch { /* no ISS fix → layer stays empty */ }
}

/* ---------- Natural hazards (NASA EONET) ---------- */
export async function fetchEONET() {
  try {
    const r = await fetchJSON("eonet", "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=60", { timeout: 30000, direct: false });
    if (r && Array.isArray(r.events)) {
      const items = r.events.map(e => {
        const geo = e.geometry && e.geometry[0];
        const cats = (e.categories || []).map(c => c.id);
        const severe = cats.some(id => ["wildfires", "volcanoes", "severeStorms", "earthquakes", "floods"].includes(id));
        return {
          title: e.title,
          lat: geo ? geo.coordinates[1] : null,
          lng: geo ? geo.coordinates[0] : null,
          severity: severe ? "orange" : "green",
          icon: cats.includes("volcanoes") ? "🌋" : cats.includes("wildfires") ? "🔥" : cats.includes("severeStorms") ? "🌪" : "⚠"
        };
      }).filter(i => i.lat != null);
      setHazards(items);
    }
  } catch { /* no EONET → GDACS-only hazards */ }
}

export function initRealtime() {
  fetchRealAircraft();  setInterval(fetchRealAircraft, 45 * 1000);
  fetchISS();           setInterval(fetchISS, 10 * 1000);
  fetchEONET();         setInterval(fetchEONET, 30 * 60 * 1000);
}
