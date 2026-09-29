/**
 * Mini recording panel — the ⚙ inside the floating menu (pill or expanded
 * mini-chat). Same idea as the "webcam / microphone / recording quality" screen
 * a dedicated screen recorder puts in its floating bar, but it lives in the
 * bubble that is already open, so nothing has to be hunted for.
 *
 * Values are stored on the shared `settings` object and persisted to
 * settings.json; capture.js reads them when the next recording starts.
 */

import { $ } from "./dom.js";
import { settings } from "./state.js";
import { saveCfg } from "./settings.js";
import { toast } from "./toast.js";
import { ensureRoomForPanel } from "./pip.js";
import { REC_QUALITIES } from "./capture.js";

const FPS_CHOICES = [30, 60];

export function qualityKey() {
  return REC_QUALITIES[settings.recQuality] ? settings.recQuality : "hd";
}

export function fpsValue() {
  return Number(settings.recFps) === 60 ? 60 : 30;
}

function mbps(bits) {
  return (bits / 1_000_000).toFixed(1) + " Mbps";
}

/** Repaint the panel from `settings` (also used after a settings sync). */
export function syncRecPrefsUi() {
  const q = qualityKey();
  const qSeg = $("miniQuality");
  if (qSeg) qSeg.querySelectorAll(".seg-btn").forEach(b => b.classList.toggle("active", b.dataset.q === q));
  const qHint = $("miniQualityHint");
  if (qHint) {
    const preset = REC_QUALITIES[q];
    qHint.textContent = preset.label + " · up to " + preset.height + "p · ~" + mbps(preset.bitrate) +
      " — higher is sharper but heavier.";
  }
  const fSeg = $("miniFps");
  if (fSeg) fSeg.querySelectorAll(".seg-btn").forEach(b => b.classList.toggle("active", Number(b.dataset.fps) === fpsValue()));
  const cur = $("miniCursor");
  if (cur) cur.checked = settings.recCursor !== false;
}

async function readDevices() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return { cams: [], mics: [] };
    const all = await navigator.mediaDevices.enumerateDevices();
    return {
      cams: all.filter(d => d.kind === "videoinput"),
      mics: all.filter(d => d.kind === "audioinput")
    };
  } catch { return { cams: [], mics: [] }; }
}

/** Fill a <select> with "System default" + the devices; returns true when the
 *  devices actually carry names (i.e. permission has been granted before). */
function fillSelect(sel, list, current, noun) {
  if (!sel) return false;
  sel.textContent = "";
  const def = document.createElement("option");
  def.value = "";
  def.textContent = "System default";
  sel.append(def);

  let named = false;
  list.forEach((d, i) => {
    const o = document.createElement("option");
    o.value = d.deviceId;
    if (d.label) named = true;
    o.textContent = d.label || (noun + " " + (i + 1));
    sel.append(o);
  });

  // Keep the saved choice selectable even if that device is unplugged right now.
  if (current && !list.some(d => d.deviceId === current)) {
    const o = document.createElement("option");
    o.value = current;
    o.textContent = "Saved device (not connected)";
    sel.append(o);
  }
  sel.value = typeof current === "string" ? current : "";
  return named;
}

export async function refreshRecDevices(notify) {
  const { cams, mics } = await readDevices();
  const camNamed = fillSelect($("miniCam"), cams, settings.camDeviceId, "Camera");
  const micNamed = fillSelect($("miniMic"), mics, settings.micDeviceId, "Microphone");
  const hint = $("miniDeviceHint");
  if (hint) {
    if (!cams.length && !mics.length) hint.textContent = "No camera or microphone found — screen-only recording still works.";
    else if (camNamed || micNamed) hint.textContent = "Pick the camera and microphone to record with.";
    else hint.textContent = "Names appear once the app has been granted camera/microphone access — press ↻ after allowing it.";
  }
  if (notify) toast("Device list refreshed", "Refreshed");
  return { cams: cams.length, mics: mics.length };
}

export function openRecPrefs() {
  // The panel is wider than the collapsed pill — grow the bubble first.
  ensureRoomForPanel();
  const p = $("miniPanel");
  if (p) p.hidden = false;
  syncRecPrefsUi();
  refreshRecDevices(false);
}

export function closeRecPrefs() {
  const p = $("miniPanel");
  if (p) p.hidden = true;
}

export function toggleRecPrefs() {
  const p = $("miniPanel");
  if (!p) return;
  if (p.hidden) openRecPrefs();
  else closeRecPrefs();
}

export function initRecPrefs() {
  ["btnPipSettings", "btnBubbleSettings"].forEach(id => {
    const b = $(id);
    if (!b) return;
    b.addEventListener("click", e => {
      e.stopPropagation();
      toggleRecPrefs();
    });
  });

  const close = $("btnCloseMini");
  if (close) close.addEventListener("click", e => { e.stopPropagation(); closeRecPrefs(); });

  const refresh = $("btnMiniRefresh");
  if (refresh) refresh.addEventListener("click", e => { e.stopPropagation(); refreshRecDevices(true); });

  const qSeg = $("miniQuality");
  if (qSeg) qSeg.addEventListener("click", e => {
    const b = e.target.closest(".seg-btn");
    if (!b || !REC_QUALITIES[b.dataset.q]) return;
    settings.recQuality = b.dataset.q;
    saveCfg();
    syncRecPrefsUi();
    toast("Quality: " + REC_QUALITIES[b.dataset.q].label + " (next recording)", "Quality " + REC_QUALITIES[b.dataset.q].label);
  });

  const fSeg = $("miniFps");
  if (fSeg) fSeg.addEventListener("click", e => {
    const b = e.target.closest(".seg-btn");
    const fps = b && Number(b.dataset.fps);
    if (!FPS_CHOICES.includes(fps)) return;
    settings.recFps = fps;
    saveCfg();
    syncRecPrefsUi();
    toast(fps + " fps (next recording)", fps + " fps");
  });

  const cur = $("miniCursor");
  if (cur) cur.addEventListener("change", () => {
    settings.recCursor = cur.checked;
    saveCfg();
    toast(cur.checked ? "Mouse cursor will be recorded" : "Mouse cursor hidden", cur.checked ? "Cursor on" : "Cursor off");
  });

  const cam = $("miniCam");
  if (cam) cam.addEventListener("change", () => {
    settings.camDeviceId = cam.value || "";
    saveCfg();
    toast("Camera: " + (cam.selectedOptions[0] ? cam.selectedOptions[0].textContent : "default"), "Camera set");
  });

  const mic = $("miniMic");
  if (mic) mic.addEventListener("change", () => {
    settings.micDeviceId = mic.value || "";
    saveCfg();
    toast("Microphone: " + (mic.selectedOptions[0] ? mic.selectedOptions[0].textContent : "default"), "Mic set");
  });

  syncRecPrefsUi();

  // Device names only appear after a successful capture — keep the list fresh.
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => {
      const p = $("miniPanel");
      if (p && !p.hidden) refreshRecDevices(false);
    });
  }
}
