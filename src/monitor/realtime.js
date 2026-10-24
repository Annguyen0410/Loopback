/**
 * Realtime feeds that sharpen the map: real ISS telemetry (wheretheiss.at)
 * and real natural hazards (NASA EONET).
 *
 * These go through fetchJSON so each one registers in the FEED STATUS panel
 * and the panel can tell "no data" apart from "no source". When a source is
 * down the layer is simply left empty — nothing is simulated.
 *
 * The aircraft layer is intentionally NOT polled. OpenSky's terms require a written licence for use of the REST
 * API in "any operational capacity — including integration into a live product, service, or automated system",
 * regardless of the entity's non-profit status (https://opensky-network.org/about/terms-of-use, read 2026-10-23).
 * The old 45 s poll also spent 4 credits on every global `states/all` request: 7,680 credits/day against the
 * anonymous 400/day allowance, so the layer spent most of its life rate-limited. Until a licensed source exists,
 * the layer stays empty and the map layer label says so. The drawing code in map-layers.js remains, so a
 * licensed feed can be connected with one setter — no fabricated aircraft are shown in the meantime.
 */

import { fetchJSON } from "./net.js";
import { setISS, setHazards } from "./map-layers.js";

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
  /* ISS: 60 s is well inside wheretheiss.at's 1 req/s limit and four times less traffic than the old 10 s
     timer. The station moves ~0.47 km/s, so a 60 s pin is already 28 km behind the real position; a faster
     timer buys nothing visible on a world map. */
  fetchISS();   setInterval(fetchISS, 60 * 1000);
  /* EONET publishes open events at a natural-hazard cadence, not a live ticker. */
  fetchEONET(); setInterval(fetchEONET, 30 * 60 * 1000);
}
