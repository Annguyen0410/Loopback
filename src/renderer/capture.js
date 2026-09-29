/**
 * Rail tools: region screenshot + screen recorder (screen + mic + cam).
 * Finished files land in userData/captures and broadcast capture:saved.
 *
 * The camera is owned by ./camera.js so that turning it off really gives the
 * device back (LED off), and so the live preview and the camera bubble burned
 * into the recording always agree on where the camera sits.
 */

import { $ } from "./dom.js";
import { toast } from "./toast.js";
import { settings } from "./state.js";
import { saveCfg } from "./settings.js";
import * as camera from "./camera.js";

let mediaRecorder = null;
let recChunks = [];
let screenStream = null;
let micStream = null;
let mixedStream = null;
let audioCtx = null;
let canvas = null;
let drawTimer = null;
let recTick = null;
let recStart = 0;
let isRec = false;
let starting = false;
let camEnabled = true;
let micEnabled = true;
let paused = false;
let pausedAt = 0;
let pausedTotal = 0;
let previewEl = null;
let previewVideo = null;
let previewBadge = null;
let overlayOpen = false;
let frameTimer = null;

/** Preview size at the default (M) step; S/L scale it. */
const PREVIEW_BASE = { w: 160, h: 120 };

/**
 * Recording presets, chosen in the mini panel (⚙ in the floating menu).
 * `height` is the tallest the recorded frame gets — the screen is scaled down to
 * it — and `bitrate` the encoder budget at 30 fps (60 fps gets double).
 */
export const REC_QUALITIES = {
  sd: { label: "SD", height: 480, bitrate: 2_500_000 },
  hd: { label: "HD", height: 720, bitrate: 6_000_000 },
  fhd: { label: "FHD", height: 1080, bitrate: 11_000_000 }
};
export const REC_FPS = [30, 60];

function recQuality() {
  return REC_QUALITIES[settings.recQuality] || REC_QUALITIES.hd;
}

function recFps() {
  return Number(settings.recFps) === 60 ? 60 : 30;
}

function wantCursor() {
  return settings.recCursor !== false;
}

/** Camera / mic constraints honouring the devices picked in the mini panel. */
function camConstraint() {
  return camera.camVideoConstraint(settings.camDeviceId);
}

function micConstraint() {
  const a = { echoCancellation: true, noiseSuppression: true };
  if (settings.micDeviceId) a.deviceId = { exact: String(settings.micDeviceId) };
  return a;
}

function pickVideoMime() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  const c = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=h264,opus",
    "video/webm",
    "video/mp4"
  ];
  return c.find(t => MediaRecorder.isTypeSupported(t)) || "";
}

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

function inPipMode() {
  return !!(document.body && document.body.classList.contains("pip-mode"));
}

/**
 * Recording from the floating bar (collapsed 56×248 bubble or the expanded
 * mini-chat) uses the separate floating camera window instead of the in-app
 * preview: the bubble has no room for it, and a window that floats over the
 * desktop lets the camera be dropped anywhere on the screen.
 */
function useFloatingCam() {
  return inPipMode();
}

/* ---- camera bubble model (shared with the recording) ------------------ */

function camPos() {
  return camera.normPos(settings.camPos);
}

function camScale() {
  return camera.scaleIndex(settings.camScale);
}

/** Default on: the app's own windows are kept out of the recording so the
 *  viewer only sees the screen plus the burned-in camera bubble. */
function hideAppWhileRecording() {
  return settings.hideInRecording !== false;
}

function setAppHidden(hide) {
  try {
    if (window.api && window.api.capture && window.api.capture.setContentProtection) {
      window.api.capture.setContentProtection(!!hide);
    }
  } catch {}
}

function previewBox() {
  const f = camera.scaleFor(camScale()) / camera.CAM_SCALES[1];
  const w = Math.max(72, Math.round(PREVIEW_BASE.w * f));
  return { w, h: Math.round(w * (PREVIEW_BASE.h / PREVIEW_BASE.w)) };
}

/* ---- UI -------------------------------------------------------------- */

function setToggleUi() {
  document.querySelectorAll('[data-cap-toggle="mic"]').forEach(btn => {
    btn.classList.toggle("off", !micEnabled);
    btn.classList.toggle("on", micEnabled);
    btn.title = micEnabled ? "Mute microphone" : "Unmute microphone";
    btn.setAttribute("aria-pressed", micEnabled ? "false" : "true");
  });
  document.querySelectorAll('[data-cap-toggle="cam"]').forEach(btn => {
    const on = camEnabled && camera.isLive();
    btn.classList.toggle("off", !on);
    btn.classList.toggle("on", on);
    btn.title = on ? "Turn camera off (releases the device)" : "Turn camera on";
    btn.setAttribute("aria-pressed", on ? "false" : "true");
  });
}

function setPauseUi() {
  const hud = $("recHud");
  if (hud) hud.classList.toggle("paused", paused);
  const btn = $("recHudPause");
  if (btn) {
    btn.title = paused ? "Resume recording" : "Pause recording";
    btn.setAttribute("aria-pressed", paused ? "true" : "false");
    const label = btn.querySelector(".rec-hud-text");
    if (label) label.textContent = paused ? "Resume" : "Pause";
  }
}

function elapsedMs() {
  const now = Date.now();
  const held = paused && pausedAt ? now - pausedAt : 0;
  return Math.max(0, now - recStart - pausedTotal - held);
}

function setRecUi(on) {
  isRec = on;
  document.querySelectorAll('[data-cap="rec"], #btnScreenRec').forEach(btn => {
    btn.classList.toggle("recording", on);
    btn.classList.toggle("busy", starting && !on);
    btn.title = on ? "Stop recording" : "Record screen (mic + camera)";
  });
  const hud = $("recHud");
  if (hud) hud.hidden = !on;
  paused = false;
  pausedAt = 0;
  pausedTotal = 0;
  setPauseUi();
  if (!on) {
    if (recTick) { cancelAnimationFrame(recTick); recTick = null; }
    const t = $("recHudTime");
    if (t) t.textContent = "00:00";
    closeCamOverlay();
    renderPreview();
  } else {
    recStart = Date.now();
    setToggleUi();
    renderPreview();
    if (camEnabled && camera.isLive() && useFloatingCam()) openCamOverlay();
    const loop = () => {
      if (!isRec) return;
      const el = $("recHudTime");
      if (el) el.textContent = fmtElapsed(elapsedMs());
      recTick = requestAnimationFrame(loop);
    };
    loop();
  }
}

/**
 * Floating camera bubble window: the user drags it around the desktop and the
 * recording burns the camera at exactly that spot. Frames are pushed in from
 * here (this window already holds the camera) at ~8fps.
 */
async function openCamOverlay() {
  if (!window.api || !window.api.cam || overlayOpen) return false;
  try {
    const r = await window.api.cam.open({ scale: camScale() });
    overlayOpen = !!(r && r.ok);
    // Adopt the window's real spot so the burned-in bubble matches immediately.
    if (r && r.pos) settings.camPos = r.pos;
    if (overlayOpen) document.body.classList.add("cam-overlay");
    startCamFrames();
    return overlayOpen;
  } catch { return false; }
}

function closeCamOverlay() {
  stopCamFrames();
  document.body.classList.remove("cam-overlay");
  if (!overlayOpen) return;
  overlayOpen = false;
  try { window.api.cam.close(); } catch {}
}

function startCamFrames() {
  if (frameTimer || !overlayOpen) return;
  const off = document.createElement("canvas");
  off.width = 192;
  off.height = 144;
  const octx = off.getContext("2d");
  frameTimer = setInterval(() => {
    if (!overlayOpen) { stopCamFrames(); return; }
    const v = camera.overlayVideo();
    if (!v || !v.videoWidth) return;
    try {
      octx.drawImage(v, 0, 0, off.width, off.height);
      window.api.cam.frame(off.toDataURL("image/jpeg", 0.6));
    } catch {}
  }, 120);
}

function stopCamFrames() {
  if (frameTimer) { clearInterval(frameTimer); frameTimer = null; }
}

function stopStream(s) {
  if (!s) return;
  try { s.getTracks().forEach(t => { try { t.stop(); } catch {} }); } catch {}
}

function hidePreview() {
  if (previewEl) previewEl.hidden = true;
  if (previewVideo) {
    try { previewVideo.srcObject = null; } catch {}
  }
}

function ensurePreview() {
  if (!previewEl) {
    previewEl = $("camPreview");
    previewVideo = $("camPreviewVideo");
    previewBadge = $("camPreviewSize");
  }
  return !!(previewEl && previewVideo);
}

/**
 * Paint the live camera preview at the exact spot the recording burns the
 * bubble into (and only while it is really on air).
 */
function renderPreview() {
  if (!ensurePreview()) return;
  const show = isRec && camEnabled && camera.isLive();
  if (!show) { hidePreview(); return; }
  const box = previewBox();
  const pos = camPos();
  previewEl.style.width = box.w + "px";
  previewEl.style.height = box.h + "px";
  previewEl.style.left = (pos.x * 100).toFixed(3) + "%";
  previewEl.style.top = (pos.y * 100).toFixed(3) + "%";
  if (previewBadge) previewBadge.textContent = camera.CAM_SIZE_LABELS[camScale()];
  previewEl.hidden = false;
  const st = camera.currentStream();
  try {
    if (previewVideo.srcObject !== st) previewVideo.srcObject = st;
    previewVideo.muted = true;
    previewVideo.playsInline = true;
    if (previewVideo.readyState >= 1) previewVideo.play().catch(() => {});
    else previewVideo.addEventListener("loadedmetadata", () => { previewVideo.play().catch(() => {}); }, { once: true });
  } catch {}
}

function stopTracks() {
  if (drawTimer) { clearInterval(drawTimer); drawTimer = null; }
  stopStream(screenStream);
  camera.release();
  stopStream(micStream);
  stopStream(mixedStream);
  screenStream = micStream = mixedStream = null;
  if (audioCtx) {
    try { audioCtx.close(); } catch {}
    audioCtx = null;
  }
  if (canvas) { canvas.width = 0; canvas.height = 0; canvas = null; }
  closeCamOverlay();
  setAppHidden(false);
  setRecWindowUnthrottled(false);
  renderPreview();
}

/**
 * Chromium throttles timers in backgrounded/occluded windows, which is exactly
 * the situation a screen recorder runs in (the user works in another app), and
 * a sleeping display stops producing frames altogether. Ask the main process to
 * hold this window hot and the display awake for the duration.
 */
function setRecWindowUnthrottled(on) {
  try {
    if (window.api && window.api.capture && window.api.capture.recordingActive) {
      window.api.capture.recordingActive(!!on);
    }
  } catch {}
}

async function stopRec(save = true) {
  const rec = mediaRecorder;
  mediaRecorder = null;
  const chunks = recChunks;
  recChunks = [];
  const willSave = !!rec && save && chunks.length > 0;

  if (rec) {
    try {
      await new Promise(resolve => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        rec.onstop = finish;
        rec.onerror = finish;
        try {
          if (rec.state === "paused") rec.resume();
          if (rec.state !== "inactive") rec.stop();
          else finish();
        } catch { finish(); }
        setTimeout(finish, 2000);
      });
    } catch {}
  }

  stopTracks();
  setRecUi(false);
  starting = false;
  camEnabled = micEnabled = true;
  setToggleUi();

  if (!willSave) {
    if (save && rec && chunks.length === 0) toast("Nothing to save", "Nothing");
    else if (!save) toast("Recording discarded", "Discarded");
    return;
  }

  try {
    const blob = new Blob(chunks, { type: (chunks[0] && chunks[0].type) || "video/webm" });
    if (blob.size < 1000) {
      toast("Recording too short", "Too short");
      return;
    }
    const buffer = await blob.arrayBuffer();
    const d = new Date();
    const p = n => String(n).padStart(2, "0");
    const name = `rec-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.webm`;
    const r = await window.api.capture.save(name, buffer);
    if (r && r.ok) {
      toast("Recording saved — camera as viewers see it: " + name, "Saved \u2713");
      window.api.capture.broadcast({ name: r.name, kind: "video" });
    } else {
      toast("Save failed" + (r && r.error ? ": " + r.error : ""), "Save failed");
    }
  } catch (e) {
    toast("Save failed", "Save failed");
    console.error(e);
  }
}

function applyTrackEnable() {
  if (micStream) {
    micStream.getAudioTracks().forEach(t => { try { t.enabled = micEnabled; } catch {} });
  }
  setToggleUi();
}

async function toggleMic() {
  if (!isRec && !starting) return;
  micEnabled = !micEnabled;
  applyTrackEnable();
  toast(micEnabled ? "Mic on" : "Mic muted", micEnabled ? "Mic on" : "Mic off");
}

/**
 * Camera off = the device is released (hardware light goes out). Turning it
 * back on opens it again — mid-recording included.
 */
async function toggleCam() {
  if (!isRec && !starting) return;
  if (camEnabled) {
    camEnabled = false;
    camera.release();
    // The floating bubble stays put (so the position is not lost) but turns
    // into a plain "Camera off" chip: nothing is captured, nothing is drawn.
    stopCamFrames();
    try { if (window.api.cam) window.api.cam.state("off"); } catch {}
    setToggleUi();
    renderPreview();
    toast("Camera off — device released, light out", "Cam off");
    return;
  }
  camEnabled = true;
  setToggleUi();
  const ok = await camera.acquire(settings.camDeviceId);
  if (!ok) {
    camEnabled = false;
    setToggleUi();
    renderPreview();
    toast("Camera unavailable — in use by another app or disabled?", "Cam unavailable");
    return;
  }
  setToggleUi();
  renderPreview();
  if (useFloatingCam()) openCamOverlay();
  try { if (window.api.cam) window.api.cam.state("on"); } catch {}
  startCamFrames();
  toast("Camera on", "Cam on");
}

/** The camera went away on its own (unplugged, switched off in the OS). */
function handleCamLost(reason) {
  camEnabled = false;
  stopCamFrames();
  try { if (window.api.cam) window.api.cam.state("off"); } catch {}
  setToggleUi();
  renderPreview();
  toast(reason, "Cam off");
}

function togglePause() {
  if (!isRec || !mediaRecorder) return;
  try {
    if (mediaRecorder.state === "paused") {
      mediaRecorder.resume();
      pausedTotal += Date.now() - (pausedAt || Date.now());
      pausedAt = 0;
      paused = false;
    } else if (mediaRecorder.state === "recording") {
      mediaRecorder.pause();
      paused = true;
      pausedAt = Date.now();
    } else return;
  } catch { return; }
  setPauseUi();
  toast(paused ? "Recording paused" : "Recording resumed", paused ? "Paused" : "Resumed");
}

function cycleCamSize() {
  const next = (camScale() + 1) % camera.CAM_SCALES.length;
  settings.camScale = next;
  saveCfg();
  renderPreview();
  toast("Camera size: " + camera.CAM_SIZE_LABELS[next], "Cam " + camera.CAM_SIZE_LABELS[next]);
  return next;
}

function waitForVideo(video, ms = 2000) {
  return new Promise(resolve => {
    let settled = false;
    const go = () => {
      if (settled) return;
      settled = true;
      try { video.play().catch(() => {}); } catch {}
      resolve();
    };
    if (video.readyState >= 1) go();
    else {
      video.addEventListener("loadedmetadata", go, { once: true });
      setTimeout(go, ms);
    }
  });
}

async function getCamMic() {
  // Prefer cam+mic together; fall back to independent requests so one
  // denial doesn't kill the other.
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: camConstraint(),
      audio: micConstraint()
    });
    return { stream: s, hasCam: s.getVideoTracks().length > 0, hasMic: s.getAudioTracks().length > 0 };
  } catch {}

  let cam = null;
  let mic = null;
  try {
    cam = await navigator.mediaDevices.getUserMedia({ video: camConstraint() });
  } catch {}
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: micConstraint() });
  } catch {}

  if (!cam && !mic) return null;
  const tracks = [
    ...(cam ? cam.getVideoTracks() : []),
    ...(mic ? mic.getAudioTracks() : [])
  ];
  return {
    stream: new MediaStream(tracks),
    hasCam: !!cam && cam.getVideoTracks().length > 0,
    hasMic: !!mic && mic.getAudioTracks().length > 0
  };
}

async function startRec() {
  if (starting) return;
  if (isRec) { await stopRec(true); return; }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    toast("Screen capture not available", "No screen capture");
    return;
  }

  starting = true;
  document.querySelectorAll('[data-cap="rec"], #btnScreenRec').forEach(btn => btn.classList.add("busy"));

  const fps = recFps();
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: fps, max: fps },
        // Chromium draws the pointer into the captured surface when asked.
        cursor: wantCursor() ? "always" : "never"
      },
      audio: true
    });
  } catch (e) {
    starting = false;
    document.querySelectorAll('[data-cap="rec"], #btnScreenRec').forEach(btn => btn.classList.remove("busy"));
    toast(
      e && e.name === "NotAllowedError" ? "Screen capture cancelled" : "Screen capture failed: " + ((e && e.name) || "error"),
      e && e.name === "NotAllowedError" ? "Cancelled" : "Capture failed"
    );
    return;
  }

  // Keep the app's own windows out of the recording before anything rolls,
  // and keep this window's timers running at full speed for the duration.
  if (hideAppWhileRecording()) setAppHidden(true);
  setRecWindowUnthrottled(true);

  const camMic = await getCamMic();
  if (camMic) {
    const camTracks = camMic.stream.getVideoTracks();
    const micTracks = camMic.stream.getAudioTracks();
    const adopted = camTracks.length ? camera.attachStream(new MediaStream(camTracks)) : false;
    // Never leave a camera open that nothing draws from — its light would stay on.
    if (!adopted) camTracks.forEach(t => { try { t.stop(); } catch {} });
    micStream = micTracks.length ? new MediaStream(micTracks) : null;
    camEnabled = adopted;
    micEnabled = !!micStream;
  } else {
    toast("Mic/camera unavailable — recording screen only", "Screen only");
    camEnabled = micEnabled = false;
  }

  try {
    const screenVid = document.createElement("video");
    screenVid.muted = true;
    screenVid.playsInline = true;
    screenVid.srcObject = new MediaStream(screenStream.getVideoTracks());
    await waitForVideo(screenVid, 2000);

    const sw = screenVid.videoWidth || 1280;
    const sh = screenVid.videoHeight || 720;
    const preset = recQuality();
    // Record the screen scaled down to the preset height: fewer pixels to move
    // each frame is what keeps 30/60 fps steady, and even dimensions keep every
    // encoder happy.
    const qScale = Math.min(1, preset.height / Math.max(1, sh));
    canvas = document.createElement("canvas");
    canvas.width = Math.max(320, Math.round((sw * qScale) / 2) * 2);
    canvas.height = Math.max(180, Math.round((sh * qScale) / 2) * 2);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("canvas 2d unavailable");

    // The camera bubble is painted from live state every frame, so moving or
    // resizing it (or turning the camera off) shows up in the video at once.
    /* The frame pump runs on a plain interval instead of requestAnimationFrame:
       rAF is throttled (and paused outright when the window is occluded or
       minimised) exactly while the user is working in another app — the moment
       a screen recording matters most — which is what made the video stutter
       and drop frames. */
    const frameMs = Math.max(8, Math.round(1000 / fps));
    const draw = () => {
      if (!screenStream || !canvas) return;
      try {
        ctx.drawImage(screenVid, 0, 0, canvas.width, canvas.height);
        const camVid = camera.overlayVideo();
        if (camEnabled && camera.isLive() && camVid && camVid.videoWidth) {
          camera.drawCamBubble(ctx, camVid, camera.camRect(
            canvas.width, canvas.height, camVid.videoWidth, camVid.videoHeight, camPos(), camScale()
          ));
        }
      } catch {}
    };
    draw();
    drawTimer = setInterval(draw, frameMs);

    /* Mix mic + optional screen system audio into one track.
     * An audio track is only added when a real source sits behind it: an
     * audio track that never delivers data (a silent mixer destination, for
     * instance) makes the WebM muxer emit empty blobs — the recording then
     * "saves" nothing at all. */
    let audioTracks = [];
    const audioSources = [micStream, screenStream]
      .filter(s => s && s.getAudioTracks && s.getAudioTracks().length);
    if (audioSources.length) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
        if (audioCtx.state !== "running") throw new Error("audio context not running");
        const dest = audioCtx.createMediaStreamDestination();
        audioSources.forEach(s => {
          try { audioCtx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest); } catch {}
        });
        audioTracks = dest.stream.getAudioTracks();
      } catch {
        // Falls back to the raw mic/screen tracks — still real audio data.
        try { if (audioCtx) audioCtx.close(); } catch {}
        audioCtx = null;
        audioTracks = audioSources[0].getAudioTracks().slice();
      }
    }
    if (micStream) {
      micStream.getAudioTracks().forEach(t => { try { t.enabled = micEnabled; } catch {} });
    }

    const canvasStream = canvas.captureStream(fps);
    const vt = canvasStream.getVideoTracks()[0];
    // Tell the encoder this is camera-like motion rather than a slide deck, so
    // it spends its bits on movement instead of crispness — that reads smoother.
    if (vt) { try { vt.contentHint = "motion"; } catch {} }
    mixedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioTracks
    ]);

    if (!mixedStream.getVideoTracks().length) throw new Error("no video track");

    const mime = pickVideoMime();
    // Bitrate follows the preset, and 60 fps gets double the budget of 30 fps.
    const bitrate = Math.round(preset.bitrate * (fps / 30));
    try {
      mediaRecorder = mime
        ? new MediaRecorder(mixedStream, { mimeType: mime, videoBitsPerSecond: bitrate })
        : new MediaRecorder(mixedStream);
    } catch {
      mediaRecorder = new MediaRecorder(mixedStream);
    }

    recChunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data && e.data.size) recChunks.push(e.data); };
    mediaRecorder.onerror = err => {
      console.error("MediaRecorder error", err);
      stopRec(false);
    };

    mediaRecorder.start(1000);
    starting = false;
    setRecUi(true);
    setToggleUi();
    renderPreview();
    toast(
      camEnabled ? "Recording (screen + cam + mic)" : "Recording started",
      "REC started"
    );

    const sTrack = screenStream.getVideoTracks()[0];
    if (sTrack) sTrack.addEventListener("ended", () => { stopRec(true); }, { once: true });
  } catch (e) {
    console.error("startRec failed", e);
    stopTracks();
    starting = false;
    mediaRecorder = null;
    setRecUi(false);
    toast("Recording failed: " + ((e && e.message) || e.name || "error"), "Rec failed");
  }
}

async function startShot(btn) {
  // Never fail silently: a dead bridge is still something the user must see.
  if (!window.api || !window.api.capture || !window.api.capture.startShot) {
    toast("Capture bridge unavailable", "Shot failed");
    return;
  }
  if (btn) btn.classList.add("busy");
  try {
    const r = await window.api.capture.startShot();
    if (r && r.ok) toast("Drag to select a region", "Drag to select");
    // A picker closed before it appeared is a cancel, not a failure: saying
    // "Screenshot failed" there would just be noise.
    else if (r && r.canceled) { /* nothing to report */ }
    else if (r && r.error) toast("Screenshot failed: " + r.error, "Shot failed");
    else toast("Screenshot failed", "Shot failed");
  } catch (e) {
    toast("Screenshot failed", "Shot failed");
    console.error(e);
  } finally {
    if (btn) btn.classList.remove("busy");
  }
}

function bindHud() {
  const bind = (id, fn) => {
    const el = $(id);
    if (!el || el.dataset.bound) return;
    el.dataset.bound = "1";
    el.addEventListener("click", e => { e.stopPropagation(); fn(); });
  };
  bind("recHudMic", () => toggleMic());
  bind("recHudCam", () => toggleCam());
  bind("recHudPause", () => togglePause());
  bind("recHudStop", () => stopRec(true));
  bind("recHudDiscard", () => stopRec(false));
}

/** Drag the live preview to move the camera bubble; double-click to resize. */
function bindPreview() {
  if (!ensurePreview() || previewEl.dataset.bound) return;
  previewEl.dataset.bound = "1";
  let drag = null;

  previewEl.addEventListener("pointerdown", e => {
    if (e.button !== 0 || previewEl.hidden) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.target && e.target.closest && e.target.closest(".cam-preview-size")) return;
    const p = camPos();
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false };
    previewEl.classList.add("dragging");
    try { previewEl.setPointerCapture(e.pointerId); } catch {}
  });

  previewEl.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    const box = previewBox();
    const next = camera.clampNorm(
      { x: drag.ox + (e.clientX - drag.sx) / vw, y: drag.oy + (e.clientY - drag.sy) / vh },
      vw, vh, box.w, box.h, 8
    );
    if (Math.abs(next.x - drag.ox) > 0.001 || Math.abs(next.y - drag.oy) > 0.001) drag.moved = true;
    settings.camPos = next;
    renderPreview();
  });

  const end = e => {
    if (!drag) return;
    if (e && e.pointerId != null && e.pointerId !== drag.id) return;
    const moved = drag.moved;
    const id = drag.id;
    drag = null;
    previewEl.classList.remove("dragging");
    try { previewEl.releasePointerCapture(id); } catch {}
    if (moved) {
      saveCfg();
      toast("Camera moved — viewers see it there", "Cam moved");
    }
  };
  previewEl.addEventListener("pointerup", end);
  previewEl.addEventListener("pointercancel", end);
  previewEl.addEventListener("dblclick", e => { e.preventDefault(); e.stopPropagation(); cycleCamSize(); });
  if (previewBadge) previewBadge.addEventListener("click", e => { e.stopPropagation(); cycleCamSize(); });
}

/** Backstop for a camera that disappears without ending its track. */
function watchDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.addEventListener) return;
  navigator.mediaDevices.addEventListener("devicechange", async () => {
    if (!isRec || !camEnabled || !camera.isLive()) return;
    if (await camera.hasVideoInput()) return;
    camera.release();
    handleCamLost("Camera unplugged — camera off");
  });
}

export function initCapture() {
  document.querySelectorAll('[data-cap="shot"]').forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      startShot(btn);
    });
  });

  document.querySelectorAll('[data-cap="rec"]').forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      startRec();
    });
  });

  bindHud();
  ensurePreview();
  bindPreview();
  watchDevices();
  camera.onChange(() => { setToggleUi(); renderPreview(); });
  camera.onLost(reason => handleCamLost(reason));

  /* The floating camera window keeps the recorded position in sync: wherever
     the user parks it on the desktop is where viewers see the camera. */
  if (window.api.cam) {
    window.api.cam.onMoved(d => {
      if (!d || !d.pos) return;
      settings.camPos = d.pos;
      if (d.final) saveCfg();
    });
    window.api.cam.onResized(d => {
      if (!d || typeof d.scale !== "number") return;
      settings.camScale = d.scale;
      saveCfg();
      if (previewBadge) previewBadge.textContent = camera.CAM_SIZE_LABELS[camScale()];
    });
    window.api.cam.onClosed(() => {
      overlayOpen = false;
      stopCamFrames();
      document.body.classList.remove("cam-overlay");
    });
  }

  if (window.api.capture.onSaved) {
    window.api.capture.onSaved(info => {
      if (info && info.kind === "image") toast("Screenshot saved", "Saved \u2713");
    });
  }

  // The overlay can end without a file (clicked instead of dragged, crop
  // failed). Say so — otherwise "Screenshot" just seems to do nothing.
  if (window.api.capture.onFailed) {
    window.api.capture.onFailed(info => {
      const reason = (info && info.reason) || "Screenshot failed";
      const short = (info && info.short) || "Shot failed";
      toast(reason, short);
    });
  }
}
