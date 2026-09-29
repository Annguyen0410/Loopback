/**
 * Country Risk tab — risk list with sorting, pinning, and a detail modal.
 * Rebuilt from the original monitor.js data.
 */

import { $, esc } from "./utils.js";

export const COUNTRIES = [
  { iso: "US", name: "United States", flag: "🇺🇸", lat: 39, lng: -98, ii: 22, ri: 82, domains: [78,85,72,91,88,80] },
  { iso: "CN", name: "China", flag: "🇨🇳", lat: 35, lng: 105, ii: 48, ri: 68, domains: [72,65,58,81,75,62] },
  { iso: "RU", name: "Russia", flag: "🇷🇺", lat: 60, lng: 90, ii: 67, ri: 45, domains: [55,42,38,50,61,38] },
  { iso: "IN", name: "India", flag: "🇮🇳", lat: 21, lng: 78, ii: 41, ri: 55, domains: [58,52,48,60,62,50] },
  { iso: "BR", name: "Brazil", flag: "🇧🇷", lat: -10, lng: -55, ii: 52, ri: 48, domains: [50,45,42,55,48,40] },
  { iso: "GB", name: "United Kingdom", flag: "🇬🇧", lat: 54, lng: -2, ii: 18, ri: 85, domains: [80,88,78,90,85,82] },
  { iso: "DE", name: "Germany", flag: "🇩🇪", lat: 51, lng: 10, ii: 15, ri: 88, domains: [82,90,85,88,92,84] },
  { iso: "FR", name: "France", flag: "🇫🇷", lat: 46, lng: 2, ii: 20, ri: 84, domains: [80,86,80,85,88,78] },
  { iso: "JP", name: "Japan", flag: "🇯🇵", lat: 36, lng: 138, ii: 25, ri: 80, domains: [78,82,75,88,80,76] },
  { iso: "KR", name: "South Korea", flag: "🇰🇷", lat: 36, lng: 128, ii: 30, ri: 76, domains: [75,78,72,82,76,70] },
  { iso: "IR", name: "Iran", flag: "🇮🇷", lat: 32, lng: 53, ii: 74, ri: 32, domains: [38,30,28,35,42,25] },
  { iso: "KP", name: "North Korea", flag: "🇰🇵", lat: 40, lng: 127, ii: 89, ri: 18, domains: [22,15,12,18,28,10] },
  { iso: "SA", name: "Saudi Arabia", flag: "🇸🇦", lat: 24, lng: 45, ii: 38, ri: 58, domains: [55,62,48,60,65,52] },
  { iso: "TR", name: "Turkey", flag: "🇹🇷", lat: 39, lng: 35, ii: 55, ri: 42, domains: [45,40,38,48,52,35] },
  { iso: "NG", name: "Nigeria", flag: "🇳🇬", lat: 9, lng: 8, ii: 68, ri: 28, domains: [32,28,22,35,38,20] },
  { iso: "ZA", name: "South Africa", flag: "🇿🇦", lat: -29, lng: 24, ii: 45, ri: 48, domains: [50,45,42,55,48,40] },
  { iso: "EG", name: "Egypt", flag: "🇪🇬", lat: 27, lng: 30, ii: 58, ri: 38, domains: [42,38,35,45,40,32] },
  { iso: "MX", name: "Mexico", flag: "🇲🇽", lat: 23, lng: -102, ii: 50, ri: 45, domains: [48,42,40,50,45,38] },
  { iso: "ID", name: "Indonesia", flag: "🇮🇩", lat: -5, lng: 120, ii: 42, ri: 52, domains: [55,50,48,58,52,45] },
  { iso: "AU", name: "Australia", flag: "🇦🇺", lat: -25, lng: 133, ii: 12, ri: 90, domains: [85,92,88,90,88,86] },
  { iso: "CA", name: "Canada", flag: "🇨🇦", lat: 56, lng: -106, ii: 10, ri: 92, domains: [88,94,90,92,90,88] },
  { iso: "AR", name: "Argentina", flag: "🇦🇷", lat: -34, lng: -64, ii: 48, ri: 42, domains: [45,40,38,48,42,35] },
  { iso: "PK", name: "Pakistan", flag: "🇵🇰", lat: 30, lng: 70, ii: 62, ri: 35, domains: [38,32,28,42,35,25] },
  { iso: "BD", name: "Bangladesh", flag: "🇧🇩", lat: 24, lng: 90, ii: 55, ri: 38, domains: [40,35,32,45,38,30] },
  { iso: "VN", name: "Vietnam", flag: "🇻🇳", lat: 16, lng: 108, ii: 35, ri: 55, domains: [58,52,48,60,55,50] },
  { iso: "TH", name: "Thailand", flag: "🇹🇭", lat: 15, lng: 100, ii: 40, ri: 50, domains: [52,48,45,55,50,42] },
  { iso: "MY", name: "Malaysia", flag: "🇲🇾", lat: 4, lng: 102, ii: 28, ri: 68, domains: [70,65,62,72,68,60] },
  { iso: "SG", name: "Singapore", flag: "🇸🇬", lat: 1.3, lng: 103.8, ii: 8, ri: 94, domains: [90,95,92,94,92,90] },
  { iso: "AE", name: "UAE", flag: "🇦🇪", lat: 24, lng: 54, ii: 22, ri: 75, domains: [72,78,68,75,80,70] },
  { iso: "IL", name: "Israel", flag: "🇮🇱", lat: 31, lng: 35, ii: 55, ri: 62, domains: [65,60,55,68,62,58] },
  { iso: "UA", name: "Ukraine", flag: "🇺🇦", lat: 49, lng: 32, ii: 72, ri: 35, domains: [38,32,28,42,35,28] },
  { iso: "PL", name: "Poland", flag: "🇵🇱", lat: 52, lng: 20, ii: 25, ri: 72, domains: [72,68,65,75,70,68] },
  { iso: "IT", name: "Italy", flag: "🇮🇹", lat: 42, lng: 12, ii: 22, ri: 78, domains: [75,82,78,80,76,74] },
  { iso: "ES", name: "Spain", flag: "🇪🇸", lat: 40, lng: -3, ii: 20, ri: 76, domains: [74,80,75,78,72,70] },
  { iso: "VE", name: "Venezuela", flag: "🇻🇪", lat: 8, lng: -66, ii: 82, ri: 22, domains: [28,20,18,25,22,15] },
  { iso: "SY", name: "Syria", flag: "🇸🇾", lat: 35, lng: 38, ii: 85, ri: 15, domains: [20,15,12,18,15,10] },
  { iso: "AF", name: "Afghanistan", flag: "🇦🇫", lat: 33, lng: 65, ii: 92, ri: 12, domains: [18,10,8,15,12,8] },
  { iso: "MM", name: "Myanmar", flag: "🇲🇲", lat: 22, lng: 96, ii: 78, ri: 28, domains: [32,28,22,35,28,20] },
  { iso: "ET", name: "Ethiopia", flag: "🇪🇹", lat: 9, lng: 40, ii: 65, ri: 30, domains: [35,30,25,38,32,22] },
  { iso: "CO", name: "Colombia", flag: "🇨🇴", lat: 4, lng: -72, ii: 48, ri: 42, domains: [45,40,38,48,42,38] },
  { iso: "PH", name: "Philippines", flag: "🇵🇭", lat: 13, lng: 122, ii: 42, ri: 48, domains: [50,45,42,52,48,42] },
  { iso: "KE", name: "Kenya", flag: "🇰🇪", lat: -1, lng: 38, ii: 52, ri: 40, domains: [42,38,35,45,40,35] },
  { iso: "TW", name: "Taiwan", flag: "🇹🇼", lat: 23.7, lng: 121, ii: 35, ri: 68, domains: [58,55,50,62,52,48] },
  { iso: "YE", name: "Yemen", flag: "🇾🇪", lat: 15, lng: 48, ii: 88, ri: 15, domains: [20,14,12,18,15,10] },
  { iso: "CU", name: "Cuba", flag: "🇨🇺", lat: 22, lng: -79, ii: 55, ri: 35, domains: [38,32,28,42,35,28] },
  { iso: "IQ", name: "Iraq", flag: "🇮🇶", lat: 33, lng: 44, ii: 78, ri: 30, domains: [35,30,25,38,32,22] },
  { iso: "LB", name: "Lebanon", flag: "🇱🇧", lat: 34, lng: 36, ii: 70, ri: 32, domains: [32,28,22,35,28,20] },
  { iso: "QA", name: "Qatar", flag: "🇶🇦", lat: 25, lng: 51, ii: 25, ri: 78, domains: [72,75,68,75,72,70] }
];

const DOMAIN_NAMES = ["Political", "Governance", "Economic", "Social", "Security", "Environment"];
const DOMAIN_COLORS = ["#0088ff", "#aa00ff", "#ff8800", "#00cc88", "#ff4444", "#88cc00"];

const SANCTIONS = {
  RU: { level: "crit", label: "Comprehensive" }, IR: { level: "crit", label: "Full embargo" },
  KP: { level: "crit", label: "Full embargo" }, CN: { level: "high", label: "Sectoral — tech" },
  VE: { level: "high", label: "Sectoral — oil" }, BY: { level: "high", label: "Sectoral — finance" },
  MM: { level: "high", label: "Military entities" }, CU: { level: "high", label: "Full embargo" },
  SY: { level: "crit", label: "Full embargo" }, TR: { level: "mod", label: "CAATSA warning" },
  NG: { level: "low", label: "Targeted — Boko Haram" }, IN: { level: "low", label: "None active" },
  SA: { level: "mod", label: "Khashoggi — limited" }
};

const TRAVEL = {
  UA: { level: "crit", label: "Do Not Travel" }, RU: { level: "crit", label: "Do Not Travel" },
  IR: { level: "crit", label: "Do Not Travel" }, KP: { level: "crit", label: "Do Not Travel" },
  MM: { level: "high", label: "Reconsider" }, VE: { level: "high", label: "Reconsider" },
  TR: { level: "mod", label: "Exercise Caution" }, BR: { level: "mod", label: "Exercise Caution" },
  NG: { level: "high", label: "Reconsider" }, EG: { level: "mod", label: "Exercise Caution" },
  PH: { level: "mod", label: "Exercise Caution" }, KE: { level: "mod", label: "Exercise Caution" },
  SA: { level: "mod", label: "Exercise Caution" }, ID: { level: "low", label: "Normal Precautions" },
  ZA: { level: "mod", label: "Exercise Caution" },
  YE: { level: "crit", label: "Do Not Travel" }, IQ: { level: "crit", label: "Do Not Travel" },
  LB: { level: "crit", label: "Do Not Travel" }, TW: { level: "low", label: "Normal Precautions" },
  QA: { level: "low", label: "Normal Precautions" }
};

const PINS_KEY = "wm_risk_pins";
let riskSortBy = "name";
let riskSortAsc = true;
let riskPins = loadPins();

function loadPins() { try { return JSON.parse(localStorage.getItem(PINS_KEY) || "[]"); } catch { return []; } }
function savePins() { localStorage.setItem(PINS_KEY, JSON.stringify(riskPins)); }

function countryTrends(iso) {
  const seed = iso.charCodeAt(0) + iso.charCodeAt(1);
  return { ii: ["up", "down", "flat"][seed % 3], ri: ["up", "down", "flat"][(seed >> 2) % 3] };
}

function renderRiskList(filter) {
  const el = $("riskList");
  if (!el) return;
  filter = (filter || "").toLowerCase();
  let filtered = COUNTRIES.slice();
  if (filter) filtered = filtered.filter(c => c.name.toLowerCase().indexOf(filter) >= 0 || c.iso.toLowerCase().indexOf(filter) >= 0);
  filtered.sort((a, b) => {
    const aPin = riskPins.indexOf(a.iso) >= 0 ? 0 : 1;
    const bPin = riskPins.indexOf(b.iso) >= 0 ? 0 : 1;
    if (aPin !== bPin) return aPin - bPin;
    let av, bv;
    if (riskSortBy === "ii") { av = a.ii; bv = b.ii; }
    else if (riskSortBy === "ri") { av = a.ri; bv = b.ri; }
    else { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
    if (av < bv) return riskSortAsc ? -1 : 1;
    if (av > bv) return riskSortAsc ? 1 : -1;
    return 0;
  });

  let html = "";
  let inPinned = false;
  for (const c of filtered) {
    const isPinned = riskPins.indexOf(c.iso) >= 0;
    if (!isPinned && !inPinned && riskPins.length > 0) { html += '<div class="pin-sep">PINNED ABOVE — ALL COUNTRIES BELOW</div>'; inPinned = true; }
    const iiColor = c.ii > 70 ? "#ff4444" : c.ii > 50 ? "#ff8800" : c.ii > 30 ? "#ffaa00" : "#44aa44";
    const riColor = c.ri < 30 ? "#ff4444" : c.ri < 50 ? "#ffaa00" : c.ri < 70 ? "#0088ff" : "#00ff88";
    const tr = countryTrends(c.iso);
    const iiTrend = tr.ii === "up" ? "▲" : tr.ii === "down" ? "▼" : "–";
    const riTrend = tr.ri === "up" ? "▲" : tr.ri === "down" ? "▼" : "–";
    const s = SANCTIONS[c.iso];
    const t = TRAVEL[c.iso];
    html += '<div class="risk-row' + (isPinned ? " pinned" : "") + '" data-iso="' + c.iso + '">' +
      '<span class="risk-pin' + (isPinned ? " pinned" : "") + '" data-iso="' + c.iso + '" title="' + (isPinned ? "Unpin" : "Pin") + '">' + (isPinned ? "★" : "☆") + "</span>" +
      '<span class="risk-flag">' + c.flag + "</span>" +
      '<span class="risk-name">' + c.name + "</span>" +
      '<span class="risk-trend ' + tr.ii + '">' + iiTrend + "</span>" +
      '<span class="risk-ii" style="color:' + iiColor + '">' + c.ii + "</span>" +
      '<span class="risk-trend ' + tr.ri + '">' + riTrend + "</span>" +
      '<span class="risk-ri" style="color:' + riColor + '">' + c.ri + "</span>" +
      (s ? '<span class="risk-sanc lvl-' + s.level + '" title="Sanctions: ' + s.label + '">' + (s.level === "crit" ? "🔴" : s.level === "high" ? "🟠" : s.level === "mod" ? "🟡" : "🟢") + "</span>" : '<span class="risk-sanc">–</span>') +
      (t ? '<span class="risk-trvl lvl-' + t.level + '" title="Travel: ' + t.label + '">' + (t.level === "crit" ? "■" : t.level === "high" ? "⚠" : t.level === "mod" ? "🔶" : "✓") + "</span>" : '<span class="risk-trvl">–</span>') +
      "</div>";
  }
  el.innerHTML = html || '<div class="panel-empty">No countries match</div>';

  el.querySelectorAll(".risk-row").forEach(row => {
    row.addEventListener("click", e => {
      if (e.target.closest(".risk-pin")) return;
      showRiskDetail(row.getAttribute("data-iso"));
    });
  });
  el.querySelectorAll(".risk-pin").forEach(pin => {
    pin.addEventListener("click", e => {
      e.stopPropagation();
      const iso = pin.getAttribute("data-iso");
      const idx = riskPins.indexOf(iso);
      if (idx >= 0) riskPins.splice(idx, 1); else riskPins.push(iso);
      savePins();
      const search = $("riskSearch");
      renderRiskList(search ? search.value : "");
    });
  });
}

function updateSortHeaders() {
  ["ii", "ri", "name"].forEach(s => {
    const el = document.getElementById("sort" + s.toUpperCase());
    if (!el) return;
    if (riskSortBy === s) { el.classList.add("active"); el.textContent = (s === "name" ? "COUNTRY " : s.toUpperCase()) + (riskSortAsc ? "▲" : "▼"); }
    else { el.classList.remove("active"); el.textContent = s === "name" ? "COUNTRY" : s.toUpperCase(); }
  });
}

export function showRiskDetail(iso) {
  const c = COUNTRIES.find(x => x.iso === iso);
  if (!c) return;
  const modal = $("riskModal"), title = $("riskModalTitle"), scores = $("riskModalScores"), domains = $("riskModalDomains");
  if (!modal || !title || !scores || !domains) return;
  // Show the stored profile exactly. An earlier version added rng(-3..3) /
  // rng(-4..4) jitter, so the same country reported different scores on every
  // open and the modal disagreed with the list behind it.
  const iif = c.ii, rif = c.ri;
  const iiColor = iif > 70 ? "#ff4444" : iif > 50 ? "#ff8800" : iif > 30 ? "#ffaa00" : "#44aa44";
  const riColor = rif < 30 ? "#ff4444" : rif < 50 ? "#ffaa00" : rif < 70 ? "#0088ff" : "#00ff88";
  title.innerHTML = c.flag + " " + c.name;
  scores.innerHTML = '<div class="modal-score"><div class="modal-score-label">Instability Index</div><div class="modal-score-val" style="color:' + iiColor + '">' + iif + "</div></div>" +
    '<div class="modal-score"><div class="modal-score-label">Resilience Index</div><div class="modal-score-val" style="color:' + riColor + '">' + rif + "</div></div>";
  let dhtml = "";
  const sanc = SANCTIONS[c.iso], trav = TRAVEL[c.iso];
  if (sanc) { const sc = sanc.level === "crit" ? "#ff4444" : sanc.level === "high" ? "#ff6600" : sanc.level === "mod" ? "#ffaa00" : "#00ff88"; dhtml += '<div class="modal-info-row"><span class="modal-info-label">OFAC Sanctions</span><span class="modal-info-val" style="color:' + sc + '">' + sanc.level.toUpperCase() + " — " + sanc.label + "</span></div>"; }
  if (trav) { const tc = trav.level === "crit" ? "#ff4444" : trav.level === "high" ? "#ff6600" : trav.level === "mod" ? "#ffaa00" : "#00ff88"; dhtml += '<div class="modal-info-row"><span class="modal-info-label">Travel Advisory</span><span class="modal-info-val" style="color:' + tc + '">' + trav.label + "</span></div>"; }
  for (let i = 0; i < DOMAIN_NAMES.length; i++) {
    const v = Math.max(0, Math.min(100, c.domains[i]));
    const dColor = v > 70 ? "#00ff88" : v > 50 ? "#ffaa00" : v > 30 ? "#ff8800" : "#ff4444";
    dhtml += '<div class="domain-row"><span class="domain-name">' + DOMAIN_NAMES[i] + '</span><div class="domain-bar"><div class="domain-fill" style="width:' + v + '%;background:' + dColor + '"></div></div><span class="domain-val" style="color:' + dColor + '">' + v + "</span></div>";
  }
  domains.innerHTML = dhtml;
  modal.style.display = "flex";
}

/** Top-5 most unstable countries for the INTEL tab. */
export function renderTopInstability() {
  const el = $("instabilityList");
  if (!el) return;
  const top = COUNTRIES.slice().sort((a, b) => b.ii - a.ii).slice(0, 5);
  let html = "";
  for (const c of top) {
    const color = c.ii > 70 ? "#ff4444" : c.ii > 50 ? "#ff8800" : "#ffaa00";
    const trend = ["▲", "─", "▼"][(c.iso.charCodeAt(0) + c.iso.charCodeAt(1)) % 3];
    html += '<div class="inst-row"><span class="inst-flag">' + c.flag + '</span><span class="inst-name">' + esc(c.name) + '</span><span class="inst-ii" style="color:' + color + '">' + c.ii + '</span><span class="inst-trend">' + trend + "</span></div>";
  }
  el.innerHTML = html;
}

/** Find the closest tracked country to a map click (returns ISO or null). */
export function nearestCountry(lat, lng) {
  let best = null, bestD = Infinity;
  for (const c of COUNTRIES) {
    let dlng = Math.abs(c.lng - lng);
    if (dlng > 180) dlng = 360 - dlng;
    const d = (c.lat - lat) * (c.lat - lat) + dlng * dlng;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best ? best.iso : null;
}

/* Wire the risk modal close controls once at boot (the modal can also be
   opened from a map click, before the RISK tab is ever opened). */
(function initRiskModal() {
  const modal = $("riskModal");
  const close = $("riskModalClose");
  if (close) close.addEventListener("click", () => { if (modal) modal.style.display = "none"; });
  if (modal) modal.addEventListener("click", e => { if (e.target === modal) modal.style.display = "none"; });
})();

export function renderRiskTab() {
  const search = $("riskSearch");
  if (search && !search.dataset.wired) {
    search.addEventListener("input", () => renderRiskList(search.value));
    search.dataset.wired = "1";
  }
  ["ii", "ri", "name"].forEach(s => {
    const el = document.getElementById("sort" + s.toUpperCase());
    if (el && !el.dataset.wired) {
      el.addEventListener("click", () => {
        if (riskSortBy === s) riskSortAsc = !riskSortAsc;
        else { riskSortBy = s; riskSortAsc = s === "name"; }
        updateSortHeaders();
        const f = $("riskSearch");
        renderRiskList(f ? f.value : "");
      });
      el.dataset.wired = "1";
    }
  });
  const sortPinned = $("sortPinned");
  if (sortPinned && !sortPinned.dataset.wired) {
    sortPinned.addEventListener("click", () => {
      if (riskPins.length > 0) { riskPins = []; savePins(); }
      sortPinned.classList.toggle("active", riskPins.length > 0);
      const f = $("riskSearch");
      renderRiskList(f ? f.value : "");
    });
    sortPinned.dataset.wired = "1";
  }
  renderRiskList("");
  updateSortHeaders();
}