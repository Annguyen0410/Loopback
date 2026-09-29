/**
 * Infrastructure tab — built only from real, free sources:
 *
 *   UNDERSEA CABLES   TeleGeography public cable map API (catalog size +
 *                     real length / landing-point counts for major systems)
 *   PORT CONDITIONS   Open-Meteo forecast at real port coordinates
 *   ENERGY            World Bank annual indicators (latest available year)
 *
 * The previous version of this file was entirely invented: cable fault
 * tickets ("repair ship en route, ETA 4d"), port congestion percentages,
 * strategic-petroleum stockpile levels and pipeline status claims. Those rows
 * were indistinguishable from measured data, so they are gone.
 */

import { $, esc } from "./utils.js";
import { fetchJSON } from "./net.js";
import { fetchIndicator, INDICATORS } from "./worldbank.js";

const CABLE_API = "https://www.submarinecablemap.com/api/v3/cable";
/** Real cable ids from the TeleGeography catalog. */
const FEATURED_CABLES = [
  "2africa", "marea", "faster", "jupiter", "dunant", "grace-hopper",
  "southern-cross-next", "asia-africa-europe-1-aae-1"
];

/** Real port coordinates for the conditions panel. */
const PORTS = [
  { name: "Shanghai", lat: 31.23, lng: 121.48 },
  { name: "Singapore", lat: 1.26, lng: 103.84 },
  { name: "Rotterdam", lat: 51.95, lng: 4.14 },
  { name: "Los Angeles", lat: 33.73, lng: -118.26 },
  { name: "Jebel Ali", lat: 25.01, lng: 55.06 },
  { name: "Busan", lat: 35.10, lng: 129.04 },
  { name: "Santos", lat: -23.96, lng: -46.30 }
];

const ENERGY_COUNTRIES = ["WLD", "US", "CN", "IN", "DE"];

function empty(id, msg) {
  const el = $(id);
  if (el) el.innerHTML = '<div class="panel-empty">' + esc(msg) + "</div>";
}

/* ---------- Undersea cables ---------- */

async function renderCables() {
  const el = $("infraCables");
  if (!el) return;
  el.innerHTML = '<div class="panel-loading"><div class="skel"></div><div class="skel w-75"></div><div class="skel w-60"></div></div>';

  let catalog = [];
  try {
    catalog = await fetchJSON("cables.catalog", CABLE_API + "/all.json", { timeout: 30000, direct: false });
  } catch { /* fall through to the empty state */ }

  const details = [];
  await Promise.all(FEATURED_CABLES.map(async (id) => {
    try {
      const d = await fetchJSON("cables." + id, CABLE_API + "/" + id + ".json", { timeout: 20000, direct: false });
      if (d && d.name) details.push({
        name: d.name,
        length: d.length || "—",
        landings: Array.isArray(d.landing_points) ? d.landing_points.length : null
      });
    } catch { /* skip this cable */ }
  }));

  if (!details.length && !(Array.isArray(catalog) && catalog.length)) {
    empty("infraCables", "TeleGeography cable map unreachable");
    return;
  }
  details.sort((a, b) => (b.landings || 0) - (a.landings || 0));

  let html = "";
  if (Array.isArray(catalog) && catalog.length) {
    html += '<div class="fin-row"><span class="fin-name">Catalogued systems</span><span class="fin-val">' +
      catalog.length.toLocaleString() + " cables</span></div>" +
      '<div class="fin-row" style="font-size:8px;color:var(--text-dim)">TeleGeography submarine cable map · live catalog</div>';
  }
  for (const d of details) {
    html += '<div class="fin-row"><span class="fin-name"><span class="infra-status ok"></span>' + esc(d.name) + "</span>" +
      '<span class="fin-val" style="font-size:9px">' + esc(d.length) +
      (d.landings != null ? ' · <span style="color:var(--text-dim)">' + d.landings + " landings</span>" : "") +
      "</span></div>";
  }
  el.innerHTML = html;
}

/* ---------- Port conditions (real weather at the quay) ---------- */

async function renderPorts() {
  const el = $("infraPorts");
  if (!el) return;
  el.innerHTML = '<div class="panel-loading"><div class="skel"></div><div class="skel w-90"></div><div class="skel w-60"></div></div>';

  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + PORTS.map(p => p.lat).join(",") +
    "&longitude=" + PORTS.map(p => p.lng).join(",") +
    "&current=wind_speed_10m,wind_gusts_10m,precipitation,visibility";
  let data = null;
  try { data = await fetchJSON("port.weather", url, { timeout: 20000 }); } catch { /* recorded */ }
  if (!Array.isArray(data)) { empty("infraPorts", "Open-Meteo unreachable"); return; }

  let html = "";
  for (let i = 0; i < PORTS.length; i++) {
    const c = data[i] && data[i].current;
    if (!c) continue;
    const wind = c.wind_speed_10m;
    const gust = c.wind_gusts_10m;
    // Colour by operational impact of wind at the quay.
    const col = gust >= 60 ? "#ff5c66" : gust >= 40 ? "#ffb84d" : "#2dffa8";
    const pct = Math.max(4, Math.min(100, Math.round((wind / 60) * 100)));
    html += '<div class="fin-row"><span class="fin-name">' + esc(PORTS[i].name) + "</span>" +
      '<span class="port-bar-wrap"><span class="port-bar-fill" style="width:' + pct + "%;background:" + col + '"></span></span>' +
      '<span class="port-pct" style="color:' + col + '">' + Math.round(wind) + " km/h</span></div>" +
      '<div class="fin-row" style="padding-left:11px;font-size:8px;color:var(--text-dim)">↳ gusts ' + Math.round(gust) +
      " km/h · rain " + (c.precipitation != null ? c.precipitation : "—") + " mm · vis " +
      (c.visibility != null ? Math.round(c.visibility / 1000) + " km" : "—") + "</div>";
  }
  el.innerHTML = html;
}

/* ---------- Energy (World Bank, latest annual) ---------- */

async function renderEnergy() {
  const el = $("infraEnergy");
  if (!el) return;
  el.innerHTML = '<div class="panel-loading"><div class="skel"></div><div class="skel w-75"></div></div>';

  const specs = [
    { code: INDICATORS.renewableElectricity, label: "Renewables share of electricity output" },
    { code: INDICATORS.fossilFuelShare, label: "Fossil fuel share of energy use" },
    { code: INDICATORS.energyImports, label: "Net energy imports (% of use)" }
  ];
  const sets = await Promise.all(specs.map(s => fetchIndicator(s.code, ENERGY_COUNTRIES).catch(() => [])));

  let html = "";
  for (let i = 0; i < specs.length; i++) {
    const rows = sets[i];
    html += '<div class="fin-row"><span class="fin-name">' + esc(specs[i].label) + "</span>" +
      '<span class="fin-val" style="font-size:8px;color:var(--text-dim)">' +
      (rows.length ? rows[0].year : "—") + "</span></div>";
    if (!rows.length) {
      html += '<div class="fin-row" style="padding-left:11px;font-size:8px;color:var(--text-dim)">no data</div>';
      continue;
    }
    for (const r of rows) {
      const col = r.value >= 50 ? "#2dffa8" : r.value >= 20 ? "#ffb84d" : "#8f8f9a";
      html += '<div class="fin-row" style="padding-left:11px"><span class="fin-name" style="font-size:9px">' +
        esc(r.country) + '</span><span class="fin-val" style="font-size:9px;color:' + col + '">' +
        r.value.toFixed(1) + "%</span></div>";
    }
  }
  html += '<div class="fin-row" style="font-size:8px;color:var(--text-dim)">World Bank annual indicators · latest reported year</div>';
  el.innerHTML = html;
}

export function renderInfraTab() {
  renderCables();
  renderPorts();
  renderEnergy();
}

/* ---- Self-updating INFRA tab --------------------------------------------
 * Port weather is live data but used to render exactly once, when the tab
 * was first opened: leave it open overnight and the "current" wind was hours
 * stale. Re-poll while the tab is visible (5 min ≈ Open-Meteo's own update
 * cadence). Cables and World Bank energy are static catalogs — no polling. */
let infraTimers = [];

export function refreshInfraPolling() {
  const infraTab = document.getElementById("sbInfra");
  if (!infraTab || infraTimers.length) return;
  infraTimers.push(setInterval(() => {
    if (infraTab.classList.contains("active")) renderPorts();
  }, 5 * 60 * 1000));
}
