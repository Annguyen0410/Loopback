/**
 * Widget show/hide registry — also drives the SETTINGS menu (widgetsBtn).
 * Visibility is persisted in localStorage under wm_widget_<id>.
 */

import { $ } from "./utils.js";

export const WIDGETS = [
  { id: "finTicker",    name: "Markets Ticker",   color: "#00ff88", def: true  },
  { id: "stats",        name: "Seismic Stats",    color: "#00ff88", def: true  },
  { id: "tzPanel",      name: "Global Time",      color: "#0088ff", def: true  },
  { id: "sysPanel",     name: "System Status",    color: "#ffaa00", def: true  },
  { id: "threatLevel",  name: "Threat Level",     color: "#ff6600", def: false },
  { id: "uptimePanel",  name: "Uptime",           color: "#00ff88", def: false },
  { id: "satPanel",     name: "Satellites",       color: "#0088ff", def: false },
  { id: "alertPanel",   name: "Alert Counter",    color: "#ff4444", def: true  },
  { id: "threatPanel",  name: "Threat Log",       color: "#ff4444", def: true  },
  { id: "eventsPanel",  name: "World Events",     color: "#00ccff", def: true  },
  { id: "earthCamPanel", name: "Earth Cam",        color: "#00ccff", def: true  },
  { id: "feedPanel",    name: "Feed Status",      color: "#00ff88", def: true  },
  { id: "spacePanel",   name: "Space Weather",    color: "#ffaa00", def: true  },
  { id: "weatherPanel", name: "World Weather",    color: "#00aaff", def: true  },
  { id: "moonPanel",    name: "Moon Phase",       color: "#aaccff", def: false },
  { id: "netPanel",     name: "Network I/O",      color: "#ffaa00", def: true  },
  { id: "devicesPanel", name: "Connected Nodes",  color: "#0088ff", def: true  },
  { id: "layerBar",     name: "Map Layers",       color: "#ff6600", def: true  },
  { id: "newsTicker",   name: "Breaking News",    color: "#cc0000", def: true  },
  { id: "quakeTicker",  name: "Quake Ticker",     color: "#ff6600", def: true  },
];

const KEY = id => "wm_widget_" + id;
const WIDGET_LAYOUT_V = 4;

/* One-time migration: reset widget visibility so new compact defaults apply. */
function migrateWidgetDefaults() {
  if (localStorage.getItem("wm_widget_layout_v") === String(WIDGET_LAYOUT_V)) return;
  for (const w of WIDGETS) localStorage.removeItem(KEY(w.id));
  localStorage.setItem("wm_widget_layout_v", String(WIDGET_LAYOUT_V));
}

export function isVisible(id) {
  const v = localStorage.getItem(KEY(id));
  if (v === null) { const w = WIDGETS.find(w => w.id === id); return w ? !!w.def : true; }
  return v === "1";
}

function apply(id) {
  const el = document.querySelector('[data-widget="' + id + '"]');
  if (el) el.classList.toggle("widget-collapsed", !isVisible(id));
}

export function toggleWidget(id) {
  localStorage.setItem(KEY(id), isVisible(id) ? "0" : "1");
  apply(id);
  buildWidgetMenu();
}

export function buildWidgetMenu() {
  const menu = $("widgetsMenu");
  if (!menu) return;
  let html = "";
  for (const w of WIDGETS) {
    const vis = isVisible(w.id);
    html += '<div class="widgets-menu-item' + (vis ? "" : " off") + '" data-w="' + w.id + '">' +
      '<span><span class="wm-dot" style="background:' + w.color + '"></span>' + w.name + '</span>' +
      '<span class="wm-check">' + (vis ? "✓" : "") + "</span></div>";
  }
  menu.innerHTML = html;
  menu.querySelectorAll(".widgets-menu-item").forEach(item => {
    item.addEventListener("click", e => { e.stopPropagation(); toggleWidget(item.getAttribute("data-w")); });
  });
}

export function initWidgets() {
  migrateWidgetDefaults();
  for (const w of WIDGETS) apply(w.id);
  buildWidgetMenu();

  document.addEventListener("click", e => {
    const btn = e.target.closest(".widget-toggle");
    if (btn) {
      e.stopPropagation(); e.preventDefault();
      const target = btn.getAttribute("data-target");
      if (target) toggleWidget(target);
      return;
    }
    const collapsed = e.target.closest(".widget-collapsed");
    if (collapsed) {
      const wid = collapsed.getAttribute("data-widget");
      if (wid) toggleWidget(wid);
    }
  });

  const widgetsBtn = $("widgetsBtn");
  const widgetsMenu = $("widgetsMenu");
  if (widgetsBtn && widgetsMenu) {
    widgetsBtn.addEventListener("click", e => { e.stopPropagation(); buildWidgetMenu(); widgetsMenu.classList.toggle("open"); });
    document.addEventListener("click", () => widgetsMenu.classList.remove("open"));
  }
}
