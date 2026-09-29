/**
 * Map engine: Leaflet init, base layer choice, layer toggles, click→risk modal,
 * and a polyline ground track drawer used by the ISS / ships / disasters.
 */

import { $, rng } from "./utils.js";

export let map = null;
export const groundTracks = new Map(); // name -> L.polyline

/**
 * Base maps. Esri's ArcGIS canvas services are the only key-free raster
 * basemaps left — CARTO's public tiles now stamp an "API KEY REQUIRED"
 * watermark across every tile, so they are deliberately avoided here.
 * Each style pairs a base canvas with a transparent label/reference overlay.
 */
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const BASES = {
  dark:  { url: ESRI + "/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",  ref: ESRI + "/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",  att: "Tiles &copy; Esri" },
  light: { url: ESRI + "/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", ref: ESRI + "/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", att: "Tiles &copy; Esri" },
  sat:   { url: ESRI + "/World_Imagery/MapServer/tile/{z}/{y}/{x}",               ref: ESRI + "/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", att: "Tiles &copy; Esri" }
};

let currentBase = null;
let currentRef = null;

export function initMap(onCountryClick) {
  try {
    if (typeof L === "undefined" || !$("map")) { console.warn("[Monitor] Leaflet missing"); return; }
    map = L.map("map", { center: [20, 0], zoom: 2, zoomControl: true, attributionControl: true });
    setBase("dark");
    // Click near a country → open its risk modal
    map.on("click", e => {
      if (!onCountryClick) return;
      onCountryClick(e.latlng.lat, e.latlng.lng);
    });
  } catch (e) { console.error("[Monitor] Map init error:", e); }
}

export function setBase(name) {
  if (!map || !BASES[name]) return;
  if (currentBase) map.removeLayer(currentBase);
  if (currentRef) map.removeLayer(currentRef);
  const b = BASES[name];
  const opts = { attribution: b.att, maxZoom: 19, crossOrigin: true };
  currentBase = L.tileLayer(b.url, opts);
  currentBase.addTo(map);
  // Label overlay sits above the imagery but below every data layer.
  if (b.ref) {
    currentRef = L.tileLayer(b.ref, { maxZoom: 19, opacity: 0.9 });
    currentRef.addTo(map);
  }
}

export function getBase() { return currentBase; }
export function getBaseLayers() { return [currentBase, currentRef].filter(Boolean); }

/**
 * Ground track: animated dashed polyline orbiting a moving object.
 * Waypoints are precomputed (e.g. TLE-less circular/orbit formula).
 */
export function drawGroundTrack(name, latLngs, color, opts) {
  if (!map) return;
  const prev = groundTracks.get(name);
  if (prev) map.removeLayer(prev);
  const line = L.polyline(latLngs, Object.assign({ color, weight: 1.6, dashArray: "4 5", opacity: 0.7 }, opts || {}));
  line.addTo(map);
  groundTracks.set(name, line);
}

export function clearGroundTrack(name) {
  const prev = groundTracks.get(name);
  if (prev) map.removeLayer(prev);
  groundTracks.delete(name);
}

/** Simple viewport-fit helper. */
export function fitBounds(a, b) {
  if (!map) return;
  map.fitBounds([a, b], { padding: [120, 120], maxZoom: 6 });
}
