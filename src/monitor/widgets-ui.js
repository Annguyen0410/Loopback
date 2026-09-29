/**
 * Small world clock + uptime + satellites widgets.
 * Satellite count = real CelesTrak active-catalog object count (via proxy).
 * Alert counter is driven by events.js.
 */

import { $, pad } from "./utils.js";
import { fetchJSON, fetchText } from "./net.js";

const TIMEZONES = [
  { city: "New York", tz: "America/New_York" },
  { city: "London", tz: "Europe/London" },
  { city: "Tokyo", tz: "Asia/Tokyo" },
  { city: "Sydney", tz: "Australia/Sydney" },
  { city: "Dubai", tz: "Asia/Dubai" },
  { city: "Moscow", tz: "Europe/Moscow" }
];

/**
 * Active-catalog object count.
 *
 * Primary source is CelesTrak (3 TLE lines per object), but CelesTrak
 * frequently answers 403 to non-browser clients, so SatNOGS DB is used as a
 * real fallback instead of leaving the widget stuck on "—".
 */
async function loadSatellites() {
  const el = $("satCount");
  if (!el) return;

  try {
    const json = await fetchJSON("satellites",
      "https://db.satnogs.org/api/satellites/?format=json", { timeout: 25000 });
    if (Array.isArray(json) && json.length) {
      el.textContent = json.length.toLocaleString();
      el.title = "SatNOGS DB satellite catalog";
      return;
    }
  } catch { /* fall through to CelesTrak */ }

  try {
    const tle = await fetchText(
      "satellites",
      "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle",
      { timeout: 20000 }
    );
    const count = Math.floor(tle.split(/\r?\n/).filter(l => l.trim()).length / 3);
    if (count > 0) {
      el.textContent = count.toLocaleString();
      el.title = "CelesTrak active catalog";
      return;
    }
  } catch { /* both sources down → OFFLINE */ }

  el.textContent = "—";
  el.title = "OFFLINE";
}

export function initWidgets() {
  /* Main clock + date */
  function tickClock() {
    const el = $("clock");
    const n = new Date();
    if (el) el.textContent = pad(n.getUTCHours()) + ":" + pad(n.getUTCMinutes()) + ":" + pad(n.getUTCSeconds()) + " UTC";
    const d = $("headerDate");
    if (d) d.textContent = n.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  tickClock();
  setInterval(tickClock, 1000);

  /* World clock list */
  function tickZones() {
    const el = $("tzList");
    if (!el) return;
    let html = "";
    for (const z of TIMEZONES) {
      const time = new Date().toLocaleTimeString("en-US", { timeZone: z.tz, hour: "2-digit", minute: "2-digit", hour12: false });
      html += '<div class="tz-row"><span class="tz-city">' + z.city + '</span><span class="tz-time">' + time + "</span></div>";
    }
    el.innerHTML = html;
  }
  tickZones();
  setInterval(tickZones, 1000);

  /* Satellites: real count from CelesTrak (proxy allowlisted in main) */
  const sat = $("satCount");
  if (sat) { sat.textContent = "—"; sat.title = "Loading…"; }
  loadSatellites();
  setInterval(loadSatellites, 6 * 60 * 60 * 1000);

  /* Uptime (session uptime — real, local) */
  const startTime = Date.now();
  setInterval(() => {
    const el = $("uptimeValue");
    if (!el) return;
    const s = Math.floor((Date.now() - startTime) / 1000);
    el.textContent = pad(Math.floor(s / 3600)) + ":" + pad(Math.floor((s % 3600) / 60)) + ":" + pad(s % 60);
  }, 1000);
}
