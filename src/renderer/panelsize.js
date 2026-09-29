/**
 * Draggable section widths.
 *
 * The chat list and every side panel (media library, recording settings, the
 * settings panel) are sized by a custom property on <body>, driven by a thin
 * grip on their inner edge. Dragging one wider or narrower is remembered in
 * settings.json, so a window opened tomorrow keeps the shape you left it in.
 *
 * The width lives on a variable instead of the element so the stylesheet can
 * still take it away when it needs to: `body.sidebar-collapsed .sidebar{width:0}`
 * outranks the base rule, and the narrow-window media queries still force a
 * full-width panel. An inline width on the element would beat both.
 */

import { $ } from "./dom.js";
import { settings } from "./state.js";
import { saveCfg } from "./settings.js";

/* min/max are the floor and ceiling in CSS pixels; `edge` is the side the grip
   sits on, which is the side the pointer drags. */
const SECTIONS = [
  { base: "sidebar", handle: "sbResize", key: "sidebarWidth", cssVar: "--sb-w", min: 220, max: 520, edge: "right" },
  { base: "mediaPanel", handle: "mediaResize", key: "mediaPanelWidth", cssVar: "--w-media", min: 280, max: 760, edge: "left" },
  { base: "miniPanel", handle: "miniResize", key: "miniPanelWidth", cssVar: "--w-mini", min: 260, max: 760, edge: "left" },
  { base: "settingsPanel", handle: "settingsResize", key: "settingsPanelWidth", cssVar: "--w-settings", min: 280, max: 760, edge: "left" }
];

/* Never wider than the window itself (a panel wider than the popup would hang
   off the edge), and never narrower than the section's floor. */
function clampWidth(v, min, max) {
  const ceiling = Math.min(max, Math.max(min, window.innerWidth - 24));
  return Math.round(Math.min(Math.max(v, min), ceiling));
}

export function applySectionSizes() {
  SECTIONS.forEach(s => {
    const v = Number(settings[s.key]);
    if (Number.isFinite(v) && v > 0) {
      document.body.style.setProperty(s.cssVar, clampWidth(v, s.min, s.max) + "px");
    }
  });
}

export function initSectionResize() {
  applySectionSizes();

  SECTIONS.forEach(s => {
    const grip = $(s.handle);
    const el = $(s.base);
    if (!grip || !el) return;

    let drag = null;

    grip.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      drag = { x: e.screenX, from: el.getBoundingClientRect().width, to: 0 };
      drag.to = clampWidth(drag.from, s.min, s.max);
      // The .22s width transition would lag a pixel behind the pointer.
      document.body.classList.add("resizing");
      try { grip.setPointerCapture(e.pointerId); } catch {}
    });

    grip.addEventListener("pointermove", e => {
      if (!drag) return;
      const dx = e.screenX - drag.x;
      drag.to = clampWidth(drag.from + (s.edge === "right" ? dx : -dx), s.min, s.max);
      document.body.style.setProperty(s.cssVar, drag.to + "px");
    });

    const finish = () => {
      if (!drag) return;
      document.body.classList.remove("resizing");
      const w = drag.to;
      drag = null;
      settings[s.key] = w;
      saveCfg();
    };
    grip.addEventListener("pointerup", finish);
    grip.addEventListener("pointercancel", finish);

    /* Double-click the grip → back to the built-in width. */
    grip.addEventListener("dblclick", e => {
      e.preventDefault();
      delete settings[s.key];
      document.body.style.removeProperty(s.cssVar);
      saveCfg();
    });
  });

  /* Another window (the popup and the main window are the same UI) resized a
     section — follow it instead of showing a different width. */
  if (window.api && window.api.onSettingsChanged) {
    window.api.onSettingsChanged(data => {
      if (!data) return;
      Object.assign(settings, data);
      applySectionSizes();
    });
  }

  /* A window that gets narrower than a saved panel width would clip it: the
     clamp is re-applied, so the panel shrinks with the window and grows back. */
  window.addEventListener("resize", applySectionSizes);
}
