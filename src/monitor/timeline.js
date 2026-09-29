/**
 * Timeline bar: lets the user scrub through time across the day.
 * For live feeds it shows time-of-poll and drives a "replay" view of quakes
 * & flights. For forecast feeds it shows a "now → +6h" gradient.
 *
 * Sits above the news ticker as a thin slider bar.
 */

import { $, pad } from "./utils.js";

let cb = null; // on-range-change callback
let playing = false;
let playTimer = null;

export function initTimeline(onRangeChange) {
  cb = onRangeChange || null;
  const slider = $("timelineRange");
  if (!slider) return;
  slider.addEventListener("input", () => { if (cb) cb(getRange()); });

  const btn = $("timelinePlay");
  if (btn) btn.addEventListener("click", () => {
    // startPlayback/stopPlayback own the `playing` flag and the button label —
    // toggling them here too meant the label flipped straight back to ▶ and
    // the paused state desynced from the running interval.
    if (playing) stopPlayback(); else startPlayback();
  });
}

function startPlayback() {
  if (playTimer) clearInterval(playTimer);
  playing = true;
  const b = $("timelinePlay");
  if (b) b.textContent = "⏸";
  playTimer = setInterval(() => {
    const s = $("timelineRange");
    if (!s) return;
    let v = Number(s.value) + 2;
    if (v > Number(s.max)) v = 0;
    s.value = v;
    if (cb) cb(getRange());
  }, 500);
}
function stopPlayback() {
  if (playTimer) clearInterval(playTimer);
  playTimer = null;
  playing = false;
  const b = $("timelinePlay");
  if (b) b.textContent = "▶";
}

export function getRange() {
  const s = $("timelineRange");
  if (!s) return { offsetMin: 0, windowMin: 24 * 60 };
  // 0..100 → 24h..0 (offset minutes into the past)
  const pct = Number(s.value) / 100;
  const maxWin = 24 * 60;
  return { offsetMin: Math.round(maxWin * (1 - pct)), windowMin: maxWin };
}

export function setLabel(text) {
  const el = $("timelineLabel");
  if (el) el.textContent = text;
}

export function tickLabel(offsetMin) {
  const d = new Date(Date.now() - offsetMin * 60000);
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}
