/**
 * Map layer toggles. Every checkbox with [data-layer] is wired here and its
 * state is applied to the real map layers we own.
 *
 * Layers dropped for having no free real data source (naval, cyber, disease,
 * GPS jamming) no longer have a toggle at all.
 */

import { map } from "./map-engine.js";
import { quakeLayer, setQuakeMajorOnly } from "./quakes.js";
import { renderLayer } from "./map-layers.js";
import { setDayNight } from "./daynight.js";

// Default visibility. Layers with no free real source (naval, cyber, disease,
// GPS jamming) were removed rather than shown as simulated data.
const DEFAULTS = { quakes: 1, military: 0, wildfire: 1, weatherEvents: 1, satellites: 0, cables: 0, ports: 1, airq: 1, conflict: 0, chokepoints: 0, dayNight: 1, datacenters: 0, nuclear: 0, bases: 0, spaceports: 0 };

// Human labels used by the command palette + toggles.
export const LAYER_META = [
  { id: "quakes", label: "Earthquakes" },
  { id: "military", label: "Aircraft (ADS-B)" },
  { id: "wildfire", label: "Natural hazards" },
  { id: "weatherEvents", label: "Storms" },
  { id: "satellites", label: "Satellites & ISS" },
  { id: "cables", label: "Submarine cables" },
  { id: "ports", label: "Ports" },
  { id: "airq", label: "Air quality" },
  { id: "quakesMajor", label: "M5+ quakes only" },
  { id: "conflict", label: "Conflict hotspots" },
  { id: "chokepoints", label: "Maritime chokepoints" },
  { id: "dayNight", label: "Day / night terminator" },
  { id: "datacenters", label: "AI data centers" },
  { id: "nuclear", label: "Nuclear facilities" },
  { id: "bases", label: "Military bases" },
  { id: "spaceports", label: "Spaceports" }
];

export const layerState = { quakes: true }; // layer -> visible

export function toggleLayer(name, on) {
  layerState[name] = !!on;
  if (name === "quakes" && quakeLayer && map) {
    if (on) map.addLayer(quakeLayer); else map.removeLayer(quakeLayer);
  }
  if (name === "quakesMajor") setQuakeMajorOnly(on);
  if (name === "dayNight") setDayNight(on);
  // Other layers render live in map-layers.js — update state, then redraw immediately.
  renderLayer(name);
}

function initLayerToggles() {
  document.querySelectorAll(".layer-toggle input[data-layer]").forEach(input => {
    const name = input.getAttribute("data-layer");
    input.checked = !!layerStateDefault(name);
    input.addEventListener("change", () => toggleLayer(name, input.checked));
    toggleLayer(name, input.checked); // seed layerState so map-layers sees defaults
  });
}

function layerStateDefault(name) {
  // Persist the user's choice
  const k = "wm_layer_" + name;
  const v = localStorage.getItem(k);
  if (v !== null) return v === "1";
  const def = DEFAULTS[name] === 1;
  localStorage.setItem(k, def ? "1" : "0");
  return def;
}

/* ---- Free-drag the layer bar ------------------------------------------
 * The bar can be parked ANYWHERE on the screen; the position persists in
 * localStorage. A plain click on the bar (not on a toggle) re-centers it on
 * the screen — it never gets stuck off-centre ("bị lệch"). */
const LAYER_BAR_POS_KEY = "wm_layerbar_pos";
const LAYER_BAR_INTERACTIVE = ".layer-toggle, .base-btn, .base-switch, .widget-toggle";

function initLayerBarDrag() {
  const bar = document.getElementById("layerBar");
  if (!bar) return;

  /* Restore a previously saved position. */
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LAYER_BAR_POS_KEY) || "null"); } catch {}
  if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
    bar.classList.add("dragged");
    bar.style.left = saved.x + "px";
    bar.style.top = saved.y + "px";
  }

  const onInteractive = t => !!(t && t.closest && t.closest(LAYER_BAR_INTERACTIVE));

  let drag = null;          // active drag state
  let justDragged = false;  // suppress click-to-center after a real drag

  bar.addEventListener("pointerdown", e => {
    if (e.button !== 0 || onInteractive(e.target)) return;
    const r = bar.getBoundingClientRect();
    // Anchor at the current VISUAL position and lock the current width so
    // the bar follows the pointer exactly. Without the lock, removing the
    // transform frees up available width and the shrink-to-fit bar re-wraps
    // mid-drag (692px → 960px), which makes the drag jumpy and off-pointer.
    bar.classList.add("dragged");
    bar.style.left = Math.round(r.left) + "px";
    bar.style.top = Math.round(r.top) + "px";
    bar.style.width = Math.round(r.width) + "px";
    drag = { sx: e.clientX, sy: e.clientY, lx: Math.round(r.left), ly: Math.round(r.top), moved: false };
    e.preventDefault();
  });

  window.addEventListener("pointermove", e => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const maxX = Math.max(8, window.innerWidth - bar.offsetWidth - 8);
    const maxY = Math.max(8, window.innerHeight - bar.offsetHeight - 8);
    bar.style.left = Math.min(Math.max(8, drag.lx + dx), maxX) + "px";
    bar.style.top = Math.min(Math.max(8, drag.ly + dy), maxY) + "px";
    e.preventDefault();
  });

  function endDrag() {
    if (!drag) return;
    justDragged = drag.moved;
    if (justDragged) {
      // Persist the inline position (offsetLeft is unreliable on fixed elements).
      const x = parseFloat(bar.style.left) || 0;
      const y = parseFloat(bar.style.top) || 0;
      localStorage.setItem(LAYER_BAR_POS_KEY, JSON.stringify({ x, y }));
    }
    drag = null;
    setTimeout(() => { justDragged = false; }, 0);
  }
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);

  /* Plain click on the bar (not a toggle, not after a drag) → center it. */
  bar.addEventListener("click", e => {
    if (onInteractive(e.target) || justDragged) return;
    localStorage.removeItem(LAYER_BAR_POS_KEY);
    bar.classList.remove("dragged");
    bar.style.left = "";
    bar.style.top = "";
    bar.style.width = "";
  });
}

export function initLayers() {
  initLayerToggles();
  initLayerBarDrag();
  // expose for compatibility + any programmatic callers
  window._toggleLayer = toggleLayer;
}