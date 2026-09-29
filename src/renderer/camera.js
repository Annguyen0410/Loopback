/**
 * Camera capture + camera-bubble geometry.
 *
 * The bubble the viewer sees inside a recording and the live preview on
 * screen are rendered from one shared model (a normalized centre + a size
 * step), so dragging the preview also moves the burned-in camera.
 *
 * Turning the camera off really releases the device here: muting a video
 * track (`enabled = false`) keeps it open and the hardware LED stays lit,
 * which is exactly what users complain about — stopping the track is the
 * only way to make the light go out.
 */

/** Bubble width as a fraction of the frame; index 1 is the default (M). */
export const CAM_SCALES = [0.16, 0.22, 0.3];
export const CAM_SIZE_LABELS = ["S", "M", "L"];
/** Normalized centre of the bubble inside a frame (bottom-right-ish default). */
export const CAM_DEFAULT_POS = { x: 0.9, y: 0.82 };
/** Gap kept between the bubble and the frame edge in px. */
export const CAM_FRAME_MARGIN = 24;
export const CAM_VIDEO = { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" };

/**
 * Video constraints for a capture. Picking a specific device (mini recording
 * panel → Camera) means asking for it exactly and dropping `facingMode`, which
 * would otherwise make the browser choose for us.
 */
export function camVideoConstraint(deviceId) {
  if (!deviceId) return { ...CAM_VIDEO };
  const c = { width: { ideal: 640 }, height: { ideal: 480 }, deviceId: { exact: String(deviceId) } };
  return c;
}

let stream = null;      // video-only MediaStream that is currently open
let video = null;       // hidden <video> feeding the recording canvas
let lossCb = null;      // called when the device disappears on its own
const subs = new Set(); // re-render subscribers (preview / buttons)

const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);

/** Position as a normalized {x,y} centre, tolerant of junk input. */
export function normPos(p) {
  return { x: num(p && p.x, CAM_DEFAULT_POS.x), y: num(p && p.y, CAM_DEFAULT_POS.y) };
}

/** Clamp a size step to a valid CAM_SCALES index. */
export function scaleIndex(i) {
  const n = Math.round(num(i, 1));
  return Math.min(CAM_SCALES.length - 1, Math.max(0, n));
}

export function scaleFor(i) {
  return CAM_SCALES[scaleIndex(i)];
}

/**
 * Keep a normalized centre inside a window so the preview is never half cut
 * off: the allowed range shrinks by half the box plus a margin.
 */
export function clampNorm(pos, vw, vh, boxW, boxH, margin = 8) {
  const p = normPos(pos);
  const padX = Math.min(0.45, (Math.max(0, boxW) / 2 + margin) / Math.max(1, vw));
  const padY = Math.min(0.45, (Math.max(0, boxH) / 2 + margin) / Math.max(1, vh));
  return {
    x: Math.min(1 - padX, Math.max(padX, p.x)),
    y: Math.min(1 - padY, Math.max(padY, p.y))
  };
}

/**
 * Where the camera bubble goes inside a frame of frameW×frameH.
 * The real camera aspect ratio is preserved and the box is clamped so it can
 * never hang off the frame (small frames included).
 */
export function camRect(frameW, frameH, camW, camH, pos, idx, margin = CAM_FRAME_MARGIN) {
  const w = Math.max(1, Math.round(num(frameW, 1)));
  const h = Math.max(1, Math.round(num(frameH, 1)));
  const pw = Math.max(80, Math.min(Math.round(w * scaleFor(idx)), Math.round(w * 0.6)));
  const ratio = camW > 0 && camH > 0 ? camH / camW : 0.75;
  const ph = Math.max(56, Math.round(pw * ratio));
  const p = normPos(pos);
  const m = Math.max(0, Math.min(num(margin, CAM_FRAME_MARGIN), Math.floor(Math.min(w, h) / 4)));
  let x = Math.round(p.x * w - pw / 2);
  let y = Math.round(p.y * h - ph / 2);
  x = Math.max(m, Math.min(x, Math.max(m, w - pw - m)));
  y = Math.max(m, Math.min(y, Math.max(m, h - ph - m)));
  return { x, y, w: pw, h: ph };
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
}

/** Draw the camera bubble over the screen frame. Returns the rect it used. */
export function drawCamBubble(ctx, camVideo, rect) {
  if (!ctx || !camVideo || !rect || !camVideo.videoWidth) return null;
  const { x, y, w, h } = rect;
  if (w <= 0 || h <= 0) return null;
  const r = Math.max(6, Math.round(Math.min(w, h) * 0.08));
  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.closePath();
  ctx.clip();
  try { ctx.drawImage(camVideo, x, y, w, h); } catch {}
  ctx.restore();
  // Border painted after the clip is released, so it is never cut in half.
  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, x + 1, y + 1, Math.max(1, w - 2), Math.max(1, h - 2), r);
  ctx.strokeStyle = "rgba(255,255,255,.85)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  return rect;
}

/* ---- device lifecycle ------------------------------------------------- */

export function isLive() {
  const t = videoTrack();
  return !!(stream && t && t.readyState === "live");
}

export function videoTrack() {
  return stream ? (stream.getVideoTracks()[0] || null) : null;
}

/** The open video-only stream (null when the camera is released). */
export function currentStream() {
  return stream;
}

/** The hidden <video> the recording draws from — null when released. */
export function overlayVideo() {
  return video;
}

/** Subscribe to any camera state change. Returns an unsubscribe function. */
export function onChange(cb) {
  if (typeof cb !== "function") return () => {};
  subs.add(cb);
  return () => subs.delete(cb);
}

/** Called when the device vanishes (unplugged, switched off in the OS). */
export function onLost(cb) {
  lossCb = cb;
}

function emit() {
  subs.forEach(cb => { try { cb() } catch {} });
}

/**
 * Adopt an already-acquired stream (the record flow grabs cam+mic in one
 * request and hands the video half over). Returns false if it has no video.
 */
export function attachStream(src) {
  release();
  const tracks = src && src.getVideoTracks ? src.getVideoTracks() : [];
  if (!tracks.length) return false;
  const wrapped = new MediaStream(tracks);
  stream = wrapped;
  const track = tracks[0];
  track.addEventListener("ended", () => {
    // Ours was released (stream already null/other) — only a device that went
    // away on its own leaves the live stream we adopted.
    if (stream !== wrapped) return;
    release();
    if (lossCb) { try { lossCb("Camera disconnected — camera off") } catch {} }
  });
  try {
    video = document.createElement("video");
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
    video.srcObject = wrapped;
    if (document.body) document.body.appendChild(video);
    const go = () => { try { video.play().catch(() => {}) } catch {} };
    if (video.readyState >= 1) go();
    else video.addEventListener("loadedmetadata", go, { once: true });
  } catch {
    video = null;
  }
  emit();
  return true;
}

/** Close the camera: stops the tracks (LED off) and drops the video element. */
export function release() {
  const s = stream;
  stream = null;
  if (s) s.getTracks().forEach(t => { try { t.stop() } catch {} });
  const v = video;
  video = null;
  if (v) {
    try { v.pause(); } catch {}
    try { v.srcObject = null; } catch {}
    try { v.remove(); } catch {}
  }
  if (s) emit();
  return !!s;
}

/** Open the camera on demand (used when it is turned back on mid-recording). */
export async function acquire(deviceId) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
  let s = null;
  try {
    s = await navigator.mediaDevices.getUserMedia({ video: camVideoConstraint(deviceId) });
  } catch {
    return false;
  }
  if (!attachStream(s)) {
    try { s.getTracks().forEach(t => { try { t.stop() } catch {} }); } catch {}
    return false;
  }
  return true;
}

/** Is there any camera left on the machine (unplugged / disabled in the OS)? */
export async function hasVideoInput() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some(d => d.kind === "videoinput");
  } catch {
    return true;
  }
}
