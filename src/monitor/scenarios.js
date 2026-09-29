/**
 * Scenario engine — selectable geopolitical scenarios drawn on the map.
 */

import { map } from "./map-engine.js";
import { $ } from "./utils.js";

const SCENARIOS = {
  taiwan: { name: "Taiwan Strait Crisis", emoji: "🇹🇼", color: "#ff4444", severity: "CRITICAL", prob: 32, timeToImpact: "Days to weeks", regions: [{ lat: 25, lng: 121, r: 3.5 }, { lat: 26, lng: 122, r: 2.5 }, { lat: 31, lng: 122, r: 2 }], chokes: ["Taiwan Strait", "South China Sea", "Luzon Strait"], sectors: ["Semiconductors", "Shipping", "Insurance", "Defense"], impact: "CRITICAL - 40% global chip supply disrupted", econImpact: "~$2.3T global GDP impact" },
  redsea: { name: "Red Sea Blockade", emoji: "🚢", color: "#ff8800", severity: "SEVERE", prob: 55, timeToImpact: "Ongoing", regions: [{ lat: 15, lng: 42, r: 4 }, { lat: 22, lng: 38, r: 3 }], chokes: ["Bab el-Mandeb", "Suez Canal"], sectors: ["Container Shipping", "Energy", "Insurance"], impact: "SEVERE - 12% global trade rerouted", econImpact: "~$1.1T trade disruption" },
  ukraine: { name: "Ukraine-Russia Sanctions", emoji: "⚔️", color: "#ff4400", severity: "HIGH", prob: 70, timeToImpact: "Ongoing", regions: [{ lat: 49, lng: 32, r: 5 }, { lat: 55, lng: 37, r: 4 }], chokes: ["Black Sea", "Turkish Straits", "Baltic Sea"], sectors: ["Energy", "Agriculture", "Metals"], impact: "HIGH - grain/energy prices elevated 15-30%", econImpact: "~$800B cumulative sanctions" },
  hormuz: { name: "Hormuz Closure", emoji: "🛢️", color: "#ff0000", severity: "CRITICAL", prob: 18, timeToImpact: "Hours to days", regions: [{ lat: 26, lng: 56, r: 3 }, { lat: 25, lng: 55, r: 2.5 }], chokes: ["Strait of Hormuz", "Bab el-Mandeb", "Suez Canal"], sectors: ["Crude Oil", "LNG", "Petrochemicals"], impact: "CRITICAL - 21% global oil supply at risk", econImpact: "~$3.8T energy shock" },
  panama: { name: "Panama Canal Drought", emoji: "🌵", color: "#dd8800", severity: "HIGH", prob: 60, timeToImpact: "Ongoing", regions: [{ lat: 9, lng: -80, r: 2 }, { lat: 8, lng: -79, r: 1.5 }], chokes: ["Panama Canal"], sectors: ["Shipping", "LNG", "Agriculture"], impact: "HIGH - Canal capacity reduced 40%", econImpact: "~$350B trade rerouting" },
  malacca: { name: "Malacca Piracy Surge", emoji: "🛳️", color: "#ff6600", severity: "MODERATE", prob: 25, timeToImpact: "Weeks", regions: [{ lat: 2, lng: 102, r: 2 }], chokes: ["Malacca Strait"], sectors: ["Shipping", "Energy"], impact: "MODERATE - 30% of global shipping affected", econImpact: "~$200B insurance spike" },
  covid: { name: "Pandemic Resurgence", emoji: "🦠", color: "#ffdd00", severity: "SEVERE", prob: 14, timeToImpact: "Weeks to months", regions: [{ lat: 35, lng: 105, r: 5 }, { lat: 21, lng: 78, r: 4 }], chokes: ["Major ports", "Air cargo hubs"], sectors: ["All sectors", "Healthcare", "Travel"], impact: "GLOBAL - supply chains disrupted", econImpact: "~$4T global GDP impact" },
  cyber: { name: "Global Cyber Attack", emoji: "💻", color: "#aa00ff", severity: "CRITICAL", prob: 22, timeToImpact: "Hours to days", regions: [{ lat: 39, lng: -98, r: 6 }, { lat: 35, lng: 135, r: 4 }], chokes: ["Digital infrastructure", "SWIFT network"], sectors: ["Finance", "Energy", "Logistics"], impact: "CRITICAL - port operations halted globally", econImpact: "~$1.5T digital disruption" }
};

let activeScenario = null;
let scenarioLayer = null;
function ensureLayer() { if (!scenarioLayer && window.L && map) scenarioLayer = L.layerGroup(); return scenarioLayer; }

function renderScenarioCards() {
  const el = $("scenList");
  if (!el) return;
  let html = "";
  for (const k in SCENARIOS) {
    const s = SCENARIOS[k];
    const pctCls = s.prob >= 50 ? "crit" : s.prob >= 25 ? "high" : "mod";
    const sevCls = s.severity === "CRITICAL" ? "sev-crit" : s.severity === "SEVERE" ? "sev-sev" : s.severity === "HIGH" ? "sev-high" : "sev-mod";
    html += '<div class="scen-card" data-scen="' + k + '">' +
      '<div class="scen-card-row"><span class="scen-emoji">' + s.emoji + '</span><span class="scen-name">' + s.name + '</span><span class="scen-pct ' + pctCls + '">' + s.prob + "% prob</span></div>" +
      '<div class="scen-impact-row"><span class="scen-severity ' + sevCls + '">' + s.severity + "</span> " + s.econImpact + "</div>" +
      '<div class="scen-impact-row" style="color:#666">⏱ ' + s.timeToImpact + '</div>' +
      '<div class="scen-sectors">Affected: ' + (s.sectors || []).join(" · ") + " • Chokepoints: " + (s.chokes || []).slice(0, 3).join(", ") + "</div>" +
      "</div>";
  }
  el.innerHTML = html;
}

function activateScenario(scenId) {
  const s = SCENARIOS[scenId];
  if (!s || !map) return;
  clearScenario();
  activeScenario = scenId;
  document.querySelectorAll(".scen-card[data-scen]").forEach(c => c.classList.toggle("active", c.getAttribute("data-scen") === scenId));
  const lg = ensureLayer();
  if (!lg) return;
  if (!map.hasLayer(lg)) lg.addTo(map);
  for (const r of s.regions) {
    const circle = L.circle([r.lat, r.lng], { radius: r.r * 100000, color: s.color, fillColor: s.color, fillOpacity: 0.15, weight: 1, opacity: 0.6 });
    circle.bindPopup('<div style="color:' + s.color + ';font-weight:700;font-size:13px">' + s.name + '</div><div style="color:#888;margin-top:4px">Impact: ' + s.impact + '</div><div style="color:#ffaa00;margin-top:4px;font-size:10px">Economic: ' + s.econImpact + '</div><div style="color:#ff6600;margin-top:4px;font-size:10px">Chokepoints: ' + (s.chokes || []).join(", ") + '</div><div style="color:#777;margin-top:2px;font-size:9px">Prob: ' + s.prob + "% • ⏱ " + s.timeToImpact + "</div>");
    scenarioLayer.addLayer(circle);
  }
  if (s.regions.length > 0) map.setView([s.regions[0].lat, s.regions[0].lng], 4, { animate: true });
}

function clearScenario() {
  if (scenarioLayer) scenarioLayer.clearLayers();
  activeScenario = null;
  document.querySelectorAll(".scen-card.active").forEach(b => b.classList.remove("active"));
}

export function renderScenarioTab() {
  renderScenarioCards();
  document.addEventListener("click", e => {
    const card = e.target.closest(".scen-card");
    if (!card) return;
    e.stopPropagation();
    const scenId = card.getAttribute("data-scen");
    if (!scenId) return;
    if (activeScenario === scenId) clearScenario(); else activateScenario(scenId);
  });
  const clear = $("scenClear");
  if (clear) clear.onclick = clearScenario;
}