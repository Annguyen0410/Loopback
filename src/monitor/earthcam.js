/**
 * "EARTH CAM" — live full-disk Earth imagery from the Himawari-8 geostationary
 * satellite (JMA/NICT, free, no key). Updated every 10 minutes with a ~30-min
 * delay; the play button loops a time-lapse through the last ~12 hours.
 */

import { $, pad } from "./utils.js";

const BASE = "https://himawari8.nict.go.jp/img/D531106/1d/550/";
/** Key-free fallback: NOAA STAR CDN full-disk geocolor (GOES-East). */
const GOES_URL = "https://cdn.star.nesdis.noaa.gov/GOES19/ABI/FD/GEOCOLOR/678x678.jpg";
const DELAY_MS = 30 * 60 * 1000; // imagery is published ~30 min late
const STEP_MS = 10 * 60 * 1000;  // new frame every 10 min

let usingHimawari = true;

function frameUrl(offsetMs) {
  const t = new Date(Date.now() - DELAY_MS - (offsetMs || 0));
  let mins = t.getUTCMinutes();
  mins -= mins % 10;
  const d = t.getUTCFullYear() + "/" + pad(t.getUTCMonth() + 1) + "/" + pad(t.getUTCDate());
  const hm = pad(t.getUTCHours()) + pad(mins) + "00";
  return BASE + d + "/" + hm + "_0_0.png";
}

function frameLabel(offsetMs) {
  const t = new Date(Date.now() - DELAY_MS - (offsetMs || 0));
  const mins = t.getUTCMinutes() - (t.getUTCMinutes() % 10);
  return t.getUTCFullYear() + "-" + pad(t.getUTCMonth() + 1) + "-" + pad(t.getUTCDate()) +
    " " + pad(t.getUTCHours()) + ":" + pad(mins) + " UTC";
}

let playing = false;
let playTimer = null;

function show(offsetMs) {
  const img = $("earthCamImg");
  const meta = $("earthCamMeta");
  const frame = $("earthCamFrame");
  if (!img || !meta) return;
  img.classList.add("cam-loading");
  if (frame) frame.classList.toggle("cam-crop", !usingHimawari);
  if (usingHimawari) {
    img.src = frameUrl(offsetMs);
    img.alt = "Himawari-8 full disk";
    meta.innerHTML = '<span class="cam-live">● LIVE</span> ' + frameLabel(offsetMs);
  } else {
    img.src = GOES_URL + "?t=" + Date.now();
    img.alt = "GOES-19 full disk";
    meta.innerHTML = '<span class="cam-live">● LIVE</span> GOES-19 full disk · ' +
      new Date().toISOString().slice(11, 16) + " UTC";
  }
}

/** Grid imagery can be blocked on some networks — swap to NOAA once, then give up gracefully. */
function handleError() {
  const img = $("earthCamImg");
  const meta = $("earthCamMeta");
  const src = $("earthCamSrc");
  if (!img || !meta) return;
  if (usingHimawari) {
    usingHimawari = false;
    if (src) src.textContent = "GOES-19";
    if (playing) stopPlay();
    else show(0);
    return;
  }
  img.classList.remove("cam-loading");
  meta.innerHTML = '<span class="cam-off">◌ IMAGERY OFFLINE</span>';
}

function startPlay() {
  if (playing) { stopPlay(); return; }
  // The NOAA fallback only serves a "latest" frame — no archive to loop through.
  if (!usingHimawari) { show(0); return; }
  playing = true;
  const btn = $("earthCamPlay");
  if (btn) btn.textContent = "⏸";
  let offset = 23 * 30 * 60 * 1000; // 11.5h ago
  show(offset);
  playTimer = setInterval(() => {
    offset -= 30 * 60 * 1000;
    if (offset < 0) offset = 23 * 30 * 60 * 1000;
    show(offset);
  }, 500);
}

function stopPlay() {
  playing = false;
  if (playTimer) clearInterval(playTimer);
  playTimer = null;
  const btn = $("earthCamPlay");
  if (btn) btn.textContent = "▶";
  show(0); // back to live
}

export function initEarthCam() {
  const img = $("earthCamImg");
  if (img) {
    img.addEventListener("load", () => img.classList.remove("cam-loading"));
    img.addEventListener("error", handleError);
  }
  show(0);
  const btn = $("earthCamPlay");
  if (btn) btn.addEventListener("click", startPlay);
  setInterval(() => { if (!playing) show(0); }, STEP_MS);
}
