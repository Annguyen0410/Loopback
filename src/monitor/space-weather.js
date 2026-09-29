/**
 * Space weather panel — NOAA SWPC products (no key):
 *   Kp index, solar wind speed, proton density, IMF magnitude.
 */

import { $ } from "./utils.js";
import { fetchJSON } from "./net.js";

/**
 * NOAA SWPC products (no key).
 *
 * The old `/products/solar-wind/plasma-7-day.json` and `mag-7-day.json`
 * endpoints now 404, and the plasma table's columns are
 * [time_tag, density, speed] — the previous code read them in the opposite
 * order, so the panel printed the density as the solar-wind speed.
 * The `/products/summary/*.json` files below are the current, tiny
 * (60-byte) replacements and carry the latest reading only.
 */
export async function fetchSpaceWeather() {
  try {
    // Kp index (last row = current). NOAA now returns OBJECTS
    // [{time_tag, Kp, a_running, station_count}]; it used to return arrays,
    // and reading last[2] against the new shape silently produced "--".
    const kpRows = await fetchJSON("space.kp",
      "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json", { timeout: 12000 });
    const kpLast = Array.isArray(kpRows) && kpRows.length ? kpRows[kpRows.length - 1] : null;
    const kp = kpLast ? num(kpLast.Kp != null ? kpLast.Kp : kpLast[1]) : null;

    // Solar wind speed — [{"proton_speed": 325, "time_tag": "..."}]
    const sp = await fetchJSON("space.plasma",
      "https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json", { timeout: 12000 });
    const wind = Array.isArray(sp) && sp.length ? num(sp[sp.length - 1].proton_speed) : null;

    // IMF — [{"bt": 3, "bz_gsm": -1, "time_tag": "..."}]. Bz is the field
    // that actually drives geomagnetic storms, so it earns a panel row.
    const mag = await fetchJSON("space.mag",
      "https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json", { timeout: 12000 });
    const last = Array.isArray(mag) && mag.length ? mag[mag.length - 1] : null;
    const bt = last ? num(last.bt) : null;
    const bz = last ? num(last.bz_gsm) : null;

    // F10.7 cm solar radio flux — [{"flux": 95, "time_tag": "..."}]
    const flux = await fetchJSON("space.flux",
      "https://services.swpc.noaa.gov/products/summary/10cm-flux.json", { timeout: 12000 });
    const f107 = Array.isArray(flux) && flux.length ? num(flux[flux.length - 1].flux) : null;

    setVal("spKp", kp != null ? kp.toFixed(1) : "--");
    setVal("spWind", wind != null ? wind.toFixed(0) + " km/s" : "-- km/s");
    setVal("spProton", bz != null ? bz.toFixed(1) + " nT" : "-- nT");
    setVal("spMag", bt != null ? bt.toFixed(1) + " nT" : "-- nT");
    setVal("spFlux", f107 != null ? f107.toFixed(0) + " sfu" : "-- sfu");
  } catch { /* recorded by feeds */ }
}

/** Coerce a NOAA cell to a finite number, or null. */
function num(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
}

function setVal(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

export function initSpaceWeather() {
  fetchSpaceWeather();
  setInterval(fetchSpaceWeather, 15 * 60 * 1000);
}