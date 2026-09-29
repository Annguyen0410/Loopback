/**
 * Threat-level display: LOW / MODERATE / ELEVATED / HIGH / CRITICAL.
 * Now computed from live feeds (big quakes, conflict volume, red alerts)
 * rather than a random walk — modules feed it via setThreatInput().
 */

import { $ } from "./utils.js";

const LEVELS = ["low", "moderate", "elevated", "high", "critical"];
const inputs = { bigQuakes: 0, conflicts: 0, redAlerts: 0 };
let idx = 2;
let hasData = false; // until a real feed reports, the badge must not assert a level

export function initThreatLevel() {
  // The old boot state showed "ELEVATED" from nothing at all. Start neutral.
  const badge = $("tlBadge");
  if (badge) { badge.textContent = "NO DATA"; badge.className = "tl-badge none"; badge.title = "Waiting for live feeds"; }
}

/** Feed one live metric; the level is recomputed from all inputs. */
export function setThreatInput(key, val) {
  inputs[key] = val || 0;
  hasData = true;
  const score =
    (inputs.bigQuakes >= 2 ? 2 : inputs.bigQuakes >= 1 ? 1 : 0) +
    (inputs.redAlerts >= 2 ? 2 : inputs.redAlerts >= 1 ? 1 : 0) +
    (inputs.conflicts >= 8 ? 1 : 0);
  idx = score >= 4 ? 4 : score >= 3 ? 3 : score >= 2 ? 2 : score >= 1 ? 1 : 0;
  render();
}

function render() {
  const badge = $("tlBadge");
  if (!badge || !hasData) return;
  const level = LEVELS[idx];
  const counts = [];
  if (inputs.bigQuakes) counts.push(inputs.bigQuakes + " quake" + (inputs.bigQuakes > 1 ? "s" : "") + " M6+");
  if (inputs.redAlerts) counts.push(Math.round(inputs.redAlerts) + " red/orange alert" + (inputs.redAlerts > 1 ? "s" : ""));
  if (inputs.conflicts) counts.push(inputs.conflicts + " conflict reports");
  badge.textContent = level.toUpperCase();
  badge.className = "tl-badge " + level;
  badge.title = counts.length ? "From live feeds: " + counts.join(", ") : "Live feed composite";
}

export function current() { return LEVELS[idx]; }
