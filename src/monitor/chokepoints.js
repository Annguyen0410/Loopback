/**
 * Maritime chokepoints — a REFERENCE list of the world's key straits and
 * canals: real coordinates plus widely published transit notes.
 *
 * This module used to carry a per-strait "disruption index" and a matching
 * coloured bar. No free public API publishes such a score, so it was invented
 * — it has been removed rather than displayed as if it were measured.
 */

import { $, esc } from "./utils.js";

export const CHOKES = [
  { name: "Strait of Hormuz",  lat: 26.6, lng: 56.5,  note: "~20% of global oil transit" },
  { name: "Malacca Strait",    lat: 2.0,  lng: 102.0, note: "~30% of global shipping" },
  { name: "Suez Canal",        lat: 30.4, lng: 32.4,  note: "~12% of global trade" },
  { name: "Bab el-Mandeb",     lat: 12.6, lng: 43.3,  note: "Red Sea southern gate" },
  { name: "Panama Canal",      lat: 9.1,  lng: -79.7, note: "Atlantic–Pacific shortcut" },
  { name: "Turkish Straits",   lat: 41.1, lng: 29.1,  note: "Black Sea access" },
  { name: "Taiwan Strait",     lat: 24.0, lng: 119.0, note: "East Asia shipping lane" },
  { name: "Kerch Strait",      lat: 45.3, lng: 36.5,  note: "Sea of Azov access" },
  { name: "Danish Straits",    lat: 56.0, lng: 11.0,  note: "Baltic Sea access" },
  { name: "South China Sea",   lat: 12.0, lng: 114.0, note: "disputed waters" }
];

export function renderChokepointsPanel() {
  const el = $("chokepointList");
  if (!el) return;
  let html = "";
  for (const c of CHOKES) {
    html += '<div class="choke-row">' +
      '<span class="choke-dot"></span>' +
      '<span class="choke-name">' + esc(c.name) + "</span>" +
      '<span class="choke-note">' + esc(c.note) + "</span></div>";
  }
  el.innerHTML = html;
}
