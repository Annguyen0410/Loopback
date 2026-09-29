/**
 * Weather panel: Open-Meteo (no key) for major world cities.
 */

import { $ } from "./utils.js";
import { fetchJSON } from "./net.js";
import { setStorms } from "./map-layers.js";

const CITIES = [
  { name: "New York", lat: 40.7, lng: -74.0 },
  { name: "London", lat: 51.5, lng: -0.1 },
  { name: "Tokyo", lat: 35.7, lng: 139.7 },
  { name: "Sydney", lat: -33.9, lng: 151.2 },
  { name: "Moscow", lat: 55.8, lng: 37.6 },
  { name: "Dubai", lat: 25.2, lng: 55.3 },
  { name: "Singapore", lat: 1.35, lng: 103.8 },
  { name: "Frankfurt", lat: 50.1, lng: 8.7 }
];

const WX_LABELS = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 51: "Drizzle", 61: "Rain", 71: "Snow", 95: "Thunder", 96: "Thunder+Hail" };

function label(code) { return WX_LABELS[code] || "Mixed (" + code + ")"; }

export async function fetchWeather() {
  try {
    const qs = "latitude=" + CITIES.map(c => c.lat).join(",") + "&longitude=" + CITIES.map(c => c.lng).join(",") + "&current_weather=true";
    const data = await fetchJSON("weather", "https://api.open-meteo.com/v1/forecast?" + qs);
    if (!data || !Array.isArray(data)) return;
    recordStorms(data);
    const box = $("wxCities");
    if (!box) return;
    let html = "";
    for (let i = 0; i < CITIES.length; i++) {
      const w = data[i] && data[i].current_weather;
      if (!w) continue;
      html += '<div class="wx-city"><span class="wx-name">' + CITIES[i].name + '</span><span class="wx-temp">' + w.temperature + "°C</span>" +
        '<span class="wx-desc">' + label(w.weathercode) + "</span>" +
        '<span class="wx-wind">' + Math.round(w.windspeed) + " km/h " + degArrow(w.winddirection) + "</span></div>";
    }
    box.innerHTML = html;
  } catch { /* recorded */ }
}

function degArrow(d) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(d / 45) % 8];
}

/* Derive storm markers from cities currently reporting thunder/rain+hail */
function recordStorms(data) {
  const storms = [];
  for (let i = 0; i < CITIES.length; i++) {
    const w = data[i] && data[i].current_weather;
    if (!w) continue;
    const c = w.weathercode;
    if (c === 95 || c === 96 || c === 99 || c === 61 || c === 63) {
      storms.push({ lat: CITIES[i].lat, lng: CITIES[i].lng, place: CITIES[i].name, event: c >= 95 ? "Thunderstorm" : "Rain" });
    }
  }
  setStorms(storms);
}


