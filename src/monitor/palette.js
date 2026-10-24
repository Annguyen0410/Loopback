/**
 * Command palette — Ctrl/Cmd+K. Static commands plus the current normalized
 * event history (which includes cached news headlines), all filtered locally.
 * Typing never triggers a fetch.
 */

import { $, esc } from "./utils.js";
import { categoryLabel, formatAge } from "./event-model.mjs";
import { getEvents } from "./event-store.js";
import { pinnedEvents } from "./pins.js";
import { focusEvent } from "./event-view.js";
import { activate } from "./sidebar-tabs.js";
import { toggleLayer, layerState, LAYER_META } from "./layer-toggles.js";
import { WIDGETS, toggleWidget, isVisible } from "./widgets.js";
import { COUNTRIES, showRiskDetail } from "./country-risk.js";

const TABS = [
  { id: "intel", label: "Intel & Disasters" },
  { id: "risk", label: "Country Risk" },
  { id: "events", label: "Event Timeline" },
  { id: "watch", label: "Watchlist & Alerts" },
  { id: "route", label: "Route Explorer" },
  { id: "scenario", label: "Scenario Engine" },
  { id: "finance", label: "Financial Data" },
  { id: "infra", label: "Infrastructure" }
];

function buildCommands() {
  const cmds = [];
  for (const tab of TABS) {
    cmds.push({ type: "tab", label: tab.label, hint: "Open tab", keywords: "section panel", run: () => activate(tab.id) });
  }
  cmds.push({
    type: "tab",
    label: "Saved events",
    hint: "Pinned records",
    keywords: "bookmarks pins saved",
    run: () => activate("events")
  });
  for (const layer of LAYER_META) {
    cmds.push({
      type: "layer",
      label: (layerState[layer.id] ? "Hide" : "Show") + " layer — " + layer.label,
      hint: "Map layer",
      keywords: "toggle map " + layer.id,
      run: () => toggleLayer(layer.id, !layerState[layer.id])
    });
  }
  for (const widget of WIDGETS) {
    cmds.push({
      type: "widget",
      label: (isVisible(widget.id) ? "Hide" : "Show") + " widget — " + widget.name,
      hint: "Widget",
      keywords: "toggle panel " + widget.id,
      run: () => toggleWidget(widget.id)
    });
  }
  for (const country of COUNTRIES) {
    cmds.push({
      type: "country",
      label: "Country brief — " + country.name + " " + country.flag,
      hint: "Risk profile · II " + country.ii,
      keywords: country.iso + " " + country.name,
      run: () => { activate("risk"); showRiskDetail(country.iso); }
    });
  }
  // Events are already cached; the date filter keeps a 72 h window and the
  // cap keeps the palette quick on a long session.
  const recent = getEvents({ from: Date.now() - 72 * 60 * 60 * 1000, limit: 160 });
  for (const event of recent) {
    cmds.push({
      type: "event",
      label: event.title,
      hint: categoryLabel(event.category) + " · " + event.source + " · " +
        formatAge(event.eventTime || event.observedAt),
      keywords: [event.category, event.source, event.country, event.countryName].filter(Boolean).join(" "),
      run: () => focusEvent(event.id)
    });
  }
  // Saved records may outlive the live window; index them too, without a
  // duplicate row for one that is still in the recent list.
  const recentIds = new Set(recent.map(event => event.id));
  for (const event of pinnedEvents()) {
    if (recentIds.has(event.id)) continue;
    cmds.push({
      type: "saved",
      label: event.title,
      hint: "Saved · " + categoryLabel(event.category) + " · " + event.source,
      keywords: ["saved", "pinned", event.category, event.country].filter(Boolean).join(" "),
      run: () => focusEvent(event.id)
    });
  }
  return cmds;
}

function score(cmd, tokens) {
  if (!tokens.length) return 1;
  const label = String(cmd.label || "").toLowerCase();
  const hint = String(cmd.hint || "").toLowerCase();
  const keywords = String(cmd.keywords || "").toLowerCase();
  let total = 0;
  for (const token of tokens) {
    if (label.startsWith(token)) total += 100;
    else if (label.includes(token)) total += 45;
    else if (hint.includes(token)) total += 18;
    else if (keywords.includes(token)) total += 14;
    else return 0;
  }
  return total;
}

export function initPalette() {
  const overlay = $("palette");
  const input = $("paletteInput");
  const results = $("paletteResults");
  if (!overlay || !input || !results) return;
  let cmds = buildCommands();

  function render(query) {
    const tokens = String(query || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
    const list = tokens.length
      ? cmds.map(cmd => ({ cmd, s: score(cmd, tokens) }))
        .filter(row => row.s > 0)
        .sort((a, b) => b.s - a.s || String(a.cmd.label).localeCompare(String(b.cmd.label)))
        .slice(0, 18)
        .map(row => row.cmd)
      : cmds.slice(0, 12);

    results.innerHTML = "";
    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "palette-empty";
      empty.textContent = "No cached command, event or headline matches.";
      results.append(empty);
      return;
    }
    list.forEach((cmd, index) => {
      const row = document.createElement("div");
      row.className = "palette-item" + (index === 0 ? " active" : "");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", index === 0 ? "true" : "false");
      row.innerHTML =
        '<span class="palette-type">' + esc(cmd.type) + "</span>" +
        '<span class="palette-label">' + esc(cmd.label) + "</span>" +
        '<span class="palette-hint">' + esc(cmd.hint || "") + "</span>";
      row.addEventListener("click", () => {
        overlay.hidden = true;
        input.value = "";
        try { cmd.run(); } catch (error) { console.warn("[Monitor] palette command", error); }
      });
      results.append(row);
    });
  }

  function activeItem() { return results.querySelector(".palette-item.active"); }

  function open() {
    cmds = buildCommands();
    input.value = "";
    overlay.hidden = false;
    input.focus();
    render("");
  }

  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && (event.key === "k" || event.key === "K")) {
      event.preventDefault();
      if (overlay.hidden) open(); else overlay.hidden = true;
    } else if (event.key === "Escape" && !overlay.hidden) {
      overlay.hidden = true;
    }
  });

  input.addEventListener("input", () => render(input.value));
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      const active = activeItem();
      if (active) active.click(); else overlay.hidden = true;
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = [...results.querySelectorAll(".palette-item")];
      if (!items.length) return;
      let index = items.findIndex(item => item.classList.contains("active"));
      if (index < 0) index = 0;
      if (event.key === "ArrowDown") index = (index + 1) % items.length;
      else index = (index - 1 + items.length) % items.length;
      items.forEach(item => {
        item.classList.remove("active");
        item.setAttribute("aria-selected", "false");
      });
      items[index].classList.add("active");
      items[index].setAttribute("aria-selected", "true");
      items[index].scrollIntoView({ block: "nearest" });
    }
  });
  overlay.addEventListener("click", event => { if (event.target === overlay) overlay.hidden = true; });
}
