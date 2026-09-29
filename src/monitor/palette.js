/**
 * Command palette — Ctrl/Cmd+K. Fuzzy-filters every tab, map layer, widget
 * and country profile into one jump box, like a proper ops console.
 */

import { $, esc } from "./utils.js";
import { activate } from "./sidebar-tabs.js";
import { toggleLayer, layerState, LAYER_META } from "./layer-toggles.js";
import { WIDGETS, toggleWidget, isVisible } from "./widgets.js";
import { COUNTRIES, showRiskDetail } from "./country-risk.js";

const TABS = [
  { id: "intel", label: "Intel & Disasters" },
  { id: "risk", label: "Country Risk" },
  { id: "route", label: "Route Explorer" },
  { id: "scenario", label: "Scenario Engine" },
  { id: "finance", label: "Financial Data" },
  { id: "infra", label: "Infrastructure" }
];

function buildCommands() {
  const cmds = [];
  for (const t of TABS) cmds.push({ type: "tab", label: t.label, hint: "Open tab", run: () => activate(t.id) });
  for (const l of LAYER_META) {
    cmds.push({
      type: "layer",
      label: (layerState[l.id] ? "Hide" : "Show") + " layer — " + l.label,
      hint: "Map layer",
      run: () => toggleLayer(l.id, !layerState[l.id])
    });
  }
  for (const w of WIDGETS) {
    cmds.push({
      type: "widget",
      label: (isVisible(w.id) ? "Hide" : "Show") + " widget — " + w.name,
      hint: "Widget",
      run: () => toggleWidget(w.id)
    });
  }
  for (const c of COUNTRIES) {
    cmds.push({
      type: "country",
      label: "Country — " + c.name + " " + c.flag,
      hint: "Risk profile · II " + c.ii,
      run: () => { activate("risk"); showRiskDetail(c.iso); }
    });
  }
  return cmds;
}

export function initPalette() {
  const overlay = $("palette");
  const input = $("paletteInput");
  const results = $("paletteResults");
  if (!overlay || !input || !results) return;
  // Commands are rebuilt every time the palette opens: layer/widget labels
  // include their current Show/Hide state, so a cached list went stale after
  // the first toggle.
  let cmds = buildCommands();

  function render(q) {
    const s = (q || "").toLowerCase().trim();
    const list = s ? cmds.filter(c => c.label.toLowerCase().includes(s)) : cmds.slice(0, 12);
    results.innerHTML = "";
    list.slice(0, 14).forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "palette-item" + (i === 0 ? " active" : "");
      row.innerHTML =
        '<span class="palette-type">' + c.type + "</span>" +
        '<span class="palette-label">' + esc(c.label) + "</span>" +
        '<span class="palette-hint">' + esc(c.hint || "") + "</span>";
      row.addEventListener("click", () => { overlay.hidden = true; input.value = ""; c.run(); });
      results.append(row);
    });
  }

  function activeItem() { return results.querySelector(".palette-item.active"); }

  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      overlay.hidden = !overlay.hidden;
      if (!overlay.hidden) {
        cmds = buildCommands();
        input.value = "";
        input.focus();
        render("");
      }
    } else if (e.key === "Escape") {
      overlay.hidden = true;
    }
  });

  input.addEventListener("input", () => render(input.value));
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      const active = activeItem();
      if (active) active.click(); else overlay.hidden = true;
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...results.querySelectorAll(".palette-item")];
      if (!items.length) return;
      let idx = items.findIndex(i => i.classList.contains("active"));
      if (idx < 0) idx = 0;
      if (e.key === "ArrowDown") idx = (idx + 1) % items.length;
      else idx = (idx - 1 + items.length) % items.length;
      items.forEach(i => i.classList.remove("active"));
      items[idx].classList.add("active");
      items[idx].scrollIntoView({ block: "nearest" });
    }
  });
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.hidden = true; });
}
