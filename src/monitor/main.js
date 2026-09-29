/**
 * World Monitor entry point.
 *
 * Boot order:
 *   1. window close/keyboard
 *   2. map init + base layer
 *   3. widget toggle system + menu
 *   4. static panels (system status, sys clock, moon phase etc.)
 *   5. sidebar tabs
 *   6. live feeds (each polls on its own schedule)
 */

import { $, pad } from "./utils.js";
import { FEEDS, renderFeedStatus } from "./net.js";
import { onLive, api, closeMonitor } from "./bridge.js";
import { initWidgets } from "./widgets.js";
import { initWidgets as initUiWidgets } from "./widgets-ui.js";
import { initSysStatus } from "./sys-status.js";
import { initNet } from "./net-io.js";
import { initDevices } from "./devices.js";
import { initThreatLevel } from "./threat-level.js";
import { initTimeline } from "./timeline.js";
import { initBaseLayers } from "./base-layers.js";
import { initLayers } from "./layer-toggles.js";
import { initDayNight } from "./daynight.js";
import { initMapLayers } from "./map-layers.js";
import { initMarkets, applyLiveMarkets } from "./markets.js";
import { initMap, map } from "./map-engine.js";
import { initSidebar } from "./sidebar-tabs.js";
import { initNews, applyLiveNews } from "./news.js";
import { fetchQuakes, initQuakeLayer, renderMoonPhase, scrubQuakes, quakeData, applyLiveQuakes } from "./quakes.js";
import { nearestCountry, showRiskDetail, renderTopInstability } from "./country-risk.js";
import { renderChokepointsPanel } from "./chokepoints.js";
import { initRealtime } from "./realtime.js";
import { initEarthCam } from "./earthcam.js";
import { initPalette } from "./palette.js";
import { addRule, startAlertEngine, evaluateAlerts } from "./alerts.js";
import { fetchWeather } from "./weather.js";
import { fetchGDACS, renderGDACS } from "./disasters.js";
import { fetchGDELT, renderGDELT, fetchIODA, renderIODA } from "./geopolitics.js";
import { fetchAirQuality } from "./air-quality.js";
import { fetchSpaceWeather } from "./space-weather.js";
import { applyLiveIndices, refreshFinancePolling } from "./finance.js";
import { refreshInfraPolling } from "./infrastructure.js";

/* ---------- close ---------- */
const closeBtn = $("closeBtn");
if (closeBtn) closeBtn.onclick = closeMonitor;
/* Escape closes the topmost layer first: the command palette, then the risk
   modal, then the window itself. Without the guards a single Escape also
   quit the whole monitor while the palette was open. */
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  const palette = document.getElementById("palette");
  if (palette && !palette.hidden) return; // palette handles its own Escape
  const modal = document.getElementById("riskModal");
  if (modal && modal.style.display !== "none" && modal.style.display !== "") return;
  closeMonitor();
});

/* ---------- map ---------- */
initMap((lat, lng) => {
  const iso = nearestCountry(lat, lng);
  if (iso) showRiskDetail(iso);
});
new MutationObserver(() => { /* sidebar resizes → tickers re-align */ })
  .observe(document.getElementById("sidebar"), { attributes: true, attributeFilter: ["class"] });

/* ---------- widgets ---------- */
initWidgets();
initUiWidgets();
initSysStatus();
initNet();
initDevices();
initThreatLevel();
initBaseLayers();
initDayNight();
initLayers();
initMapLayers();
initNews();
initMarkets();
initRealtime();
initEarthCam();
initPalette();
renderChokepointsPanel();
renderTopInstability();

/* ---------- timeline ---------- */
initTimeline(({ offsetMin }) => {
  setTimelineText(offsetMin);
  scrubQuakes(offsetMin); // actually rewind/forward the quake layer
});
function setTimelineText(offsetMin) {
  const el = document.getElementById("timelineLabel");
  if (!el) return;
  if (offsetMin === 0) el.textContent = "NOW — last 24h";
  else el.textContent = "T-" + (offsetMin >= 60 ? Math.round(offsetMin / 60) + "h" : offsetMin + "m");
}

/* Last-updated stamp in the header. */
function stampUpdate() {
  const el = document.getElementById("updateTime");
  if (el) el.textContent = "Updated " + new Date().toLocaleTimeString();
}

/* ---------- sidebar tabs ---------- */
initSidebar();

/* ---------- live feeds ---------- */
if (map) initQuakeLayer();

/* ---------- poll loops ---------- */
fetchQuakes().finally(stampUpdate);  setInterval(() => fetchQuakes().finally(stampUpdate), 60 * 1000);
fetchWeather();                      setInterval(fetchWeather, 3 * 60 * 1000);
/* The fetchers return null when the feed is unreachable — render that state
   instead of silently folding it into "no alerts" (catch + .then(null)). */
fetchGDACS().then(renderGDACS);      setInterval(() => fetchGDACS().then(renderGDACS), 5 * 60 * 1000);
fetchGDELT().then(renderGDELT);      setInterval(() => fetchGDELT().then(renderGDELT), 5 * 60 * 1000);
fetchIODA().then(renderIODA);        setInterval(() => fetchIODA().then(renderIODA), 10 * 60 * 1000);
fetchAirQuality();                   setInterval(fetchAirQuality, 5 * 60 * 1000);
fetchSpaceWeather();                 setInterval(fetchSpaceWeather, 5 * 60 * 1000);
renderMoonPhase();                   setInterval(renderMoonPhase, 60 * 60 * 1000);

/* ---------- live push from main (monitor:live) ---------- */
onLive(msg => {
  if (!msg || !msg.type) return;
  try {
    if (msg.type === "news") applyLiveNews(msg.data);
    else if (msg.type === "quakes") { applyLiveQuakes(msg.data); stampUpdate(); }
    else if (msg.type === "indices") { applyLiveIndices(msg.data); applyLiveMarkets(msg.data); }
    else if (msg.type === "refresh") {
      const f = msg.data && msg.data.feed;
      if (f === "gdacs") fetchGDACS().then(renderGDACS).finally(stampUpdate);
      else if (f === "gdelt") fetchGDELT().then(renderGDELT).finally(stampUpdate);
      else if (f === "weather") fetchWeather().finally(stampUpdate);
      else if (f === "space") fetchSpaceWeather().finally(stampUpdate);
      else if (f === "airq") fetchAirQuality().finally(stampUpdate);
    }
  } catch (e) { console.warn("[Monitor] live push", e); }
});

/* World Bank macro is annual data — refresh hourly instead of only on the
   first tab open, so the numbers self-update during a long session. */
refreshFinancePolling();
refreshInfraPolling();

/* ---------- alert rules ---------- */
addRule({
  id: "bigquake",
  label: "M≥6 earthquake",
  severity: "crit",
  test: () => {
    const d = window.__lastQuakeData; // injected by quakes.js below
    if (!d) return null;
    const big = d.features.find(f => f.properties.mag >= 6 && Date.now() - f.properties.time < 60 * 60 * 1000);
    if (big) return { fire: true, msg: "M" + big.properties.mag.toFixed(1) + " — " + big.properties.place };
  }
});
startAlertEngine();
/* The old ambient "port scan / DNS tunnelling" log was generated from random
   IPs — fabricated security telemetry. The threat log is now fed only by the
   real alert rules and live feed events above. */

/* expose last quake data for alert rule */
Object.defineProperty(window, "__lastQuakeData", { get: () => quakeData });

/* ---------- initial UI noise ---------- */
renderFeedStatus();
renderMoonPhase();
console.log("[Monitor] booted — feeds register on first poll (" + Object.keys(FEEDS).length + " now)");
