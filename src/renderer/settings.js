/**
 * Settings + theme management (dark mode, chat color theme).
 */

import { state, settings } from "./state.js";
import { $ } from "./dom.js";
import { toast } from "./toast.js";
import { confirmDialog } from "./dialog.js";

export function saveCfg() {
  // Keep every open window's theme/dark mode in sync.
  if (window.api.broadcastSettings) window.api.broadcastSettings({ ...settings });
  return window.api.saveSettings(settings);
}

export function applyTheme() {
  document.body.classList.toggle("dark", !!settings.darkMode);
  // Strip only theme-* tokens — never wipe pip-mode / sidebar-collapsed / etc.
  [...document.body.classList]
    .filter(c => c.startsWith("theme-"))
    .forEach(c => document.body.classList.remove(c));
  if (settings.theme && settings.theme !== "blue") document.body.classList.add("theme-" + settings.theme);
  const cb = $("settingDarkMode");
  if (cb) cb.checked = !!settings.darkMode;
  document.querySelectorAll(".theme-dot").forEach(d => d.classList.toggle("active", d.dataset.theme === settings.theme));
  window.api.setTheme(settings.darkMode ? "dark" : "light");
}

export function initTheme(onChanged) {
  const btnDarkToggle = $("btnDarkToggle");
  if (btnDarkToggle) btnDarkToggle.addEventListener("click", function () {
    settings.darkMode = !settings.darkMode;
    applyTheme();
    saveCfg();
    toast(settings.darkMode ? "Dark mode on" : "Dark mode off");
    if (onChanged) onChanged();
  });

  const settingDarkMode = $("settingDarkMode");
  if (settingDarkMode) settingDarkMode.addEventListener("change", function () {
    settings.darkMode = settingDarkMode.checked;
    applyTheme();
    saveCfg();
    if (onChanged) onChanged();
  });

  const btnThemePicker = $("btnThemePicker");
  if (btnThemePicker) btnThemePicker.addEventListener("click", function (e) {
    // Stop the global click-away handler from instantly closing the picker
    e.stopPropagation();
    const tp = $("themePicker");
    if (tp) tp.hidden = !tp.hidden;
    const ep = $("emojiPicker");
    if (ep) ep.hidden = true;
  });

  const themeColors = $("themeColors");
  if (themeColors) themeColors.addEventListener("click", function (e) {
    const dot = e.target.closest(".theme-dot");
    if (!dot) return;
    settings.theme = dot.dataset.theme;
    applyTheme();
    saveCfg();
    toast("Theme: " + settings.theme);
  });
}

/** Bubble-size segmented control in Settings (S / M / L → scale 0.75 / 1 / 1.3). */
export function initPipSize() {
  const seg = $("pipSizeSeg");
  if (!seg) return;
  const applyActive = () => {
    const scale = Number(settings.pipScale) || 1;
    seg.querySelectorAll(".seg-btn").forEach(b => b.classList.toggle("active", Number(b.dataset.scale) === scale));
    document.body.classList.toggle("pip-xs", scale < 1);
  };
  applyActive();
  seg.addEventListener("click", function (e) {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    settings.pipScale = Number(btn.dataset.scale);
    saveCfg();
    applyActive();
    if (window.api && window.api.pip) window.api.pip.resize();
    toast("Bubble size: " + (settings.pipScale < 1 ? "Small" : settings.pipScale > 1 ? "Large" : "Medium"));
  });
}

/**
 * Floating-bar behaviour: which edge it docks to, whether it shows up when the
 * app launches, whether minimizing drops the app into the bar, and the Windows
 * login item. All four are ordinary settings.json fields.
 */
export function initFloatingSettings() {
  const dockSeg = $("pipDockSeg");
  const applyDock = () => {
    const side = settings.pipDock === "left" ? "left" : "right";
    if (dockSeg) dockSeg.querySelectorAll(".seg-btn").forEach(b => b.classList.toggle("active", b.dataset.dock === side));
  };
  applyDock();
  if (dockSeg) dockSeg.addEventListener("click", e => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    settings.pipDock = btn.dataset.dock === "left" ? "left" : "right";
    saveCfg();
    applyDock();
    if (window.api.pip && window.api.pip.dock) window.api.pip.dock(settings.pipDock);
    toast("Floating bar docks " + settings.pipDock, "Dock " + settings.pipDock);
  });

  const bindToggle = (id, key, fallback, note) => {
    const el = $(id);
    if (!el) return;
    el.checked = settings[key] === undefined ? fallback : !!settings[key];
    el.addEventListener("change", async () => {
      settings[key] = el.checked;
      if (key === "startAtLogin" && window.api.setStartAtLogin) {
        // The OS is the source of truth for the login item.
        settings.startAtLogin = !!(await window.api.setStartAtLogin(el.checked));
        el.checked = settings.startAtLogin;
      }
      saveCfg();
      toast(note(el.checked), el.checked ? "On" : "Off");
    });
  };

  bindToggle("settingPipOnStartup", "pipOnStartup", true,
    on => on ? "The floating bar will be waiting when the app opens" : "The floating bar won't open on its own");
  bindToggle("settingPipOnMinimize", "pipOnMinimize", true,
    on => on ? "Minimizing the app shows the floating bar" : "Minimizing the app just hides it");
  bindToggle("settingStartAtLogin", "startAtLogin", false,
    on => on ? "Loopback will start with Windows" : "Loopback won't start with Windows");
}

export function initSettingsPanel({ onClearAll } = {}) {
  const btnSettings = $("btnSettings");
  if (btnSettings) btnSettings.addEventListener("click", () => { $("settingsPanel").hidden = false; });
  const btnCloseSettings = $("btnCloseSettings");
  if (btnCloseSettings) btnCloseSettings.addEventListener("click", () => { $("settingsPanel").hidden = true; });

  const btnExport = $("btnExport");
  if (btnExport) btnExport.addEventListener("click", async () => {
    const r = await window.api.exportData();
    if (r && r.ok) toast("Backup saved: " + r.path);
    else if (r && r.error) toast("Export failed: " + r.error);
  });

  const btnOpenData = $("btnOpenData");
  if (btnOpenData) btnOpenData.addEventListener("click", () => window.api.openDataFolder());

  // Recording: keep the app's own windows out of the video (default on).
  const hideInRec = $("settingHideInRec");
  if (hideInRec) {
    hideInRec.checked = settings.hideInRecording !== false;
    hideInRec.addEventListener("change", () => {
      settings.hideInRecording = hideInRec.checked;
      saveCfg();
      toast(hideInRec.checked
        ? "App window hidden from recordings"
        : "App window will show up in recordings");
    });
  }

  const btnClearAll = $("btnClearAll");
  if (btnClearAll) btnClearAll.addEventListener("click", async function () {
    const ok = await confirmDialog({
      title: "Clear current chat?",
      message: "Delete all messages in this chat? Attachments are removed from disk too.",
      okText: "Clear"
    });
    if (!ok) return;
    if (onClearAll) await onClearAll();
    toast("Chat cleared");
  });
}
