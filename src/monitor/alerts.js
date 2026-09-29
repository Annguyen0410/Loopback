/**
 * Alert engine: rules with memoized dedup so the same event doesn't
 * re-fire every poll.
 *
 * Rules ship as an array of { id, label, severity, test: () => ({fire, msg}) }
 * and are evaluated once a minute. Firing inserts a line into the threat
 * log and (optionally) plays a sound.
 */

import { $, pad } from "./utils.js";
import { logWorldEvent } from "./events.js";

let RULES = [];
let fired = new Map();   // ruleId -> timestamp of last fire (for cooldown)
const COOLDOWN = 5 * 60 * 1000;

let audioCtx = null;
function beep(severity) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.frequency.value = severity === "crit" ? 920 : severity === "warn" ? 620 : 440;
    gain.gain.value = 0.06;
    osc.type = "sine";
    osc.start();
    osc.stop(audioCtx.currentTime + 0.18);
  } catch { /* audio blocked until user gesture */ }
}

/* Standby placeholder — replaced by the first real alert line. */
(function initThreatPlaceholder() {
  const body = document.getElementById("threatLog");
  if (body) body.innerHTML = '<div class="threat-line"><span class="t-time">[--:--:--]</span> <span class="t-info">[STANDBY]</span> Armed — waiting for live alert conditions…</div>';
})();

export function logThreat(lvl, msg) {
  const body = $("threatLog");
  if (!body) return;
  if (!body.dataset.seeded) { body.innerHTML = ""; body.dataset.seeded = "1"; }
  // UTC, matching the world-events log next to it — the two panels used to
  // disagree by the local UTC offset (Vietnam: 7 hours).
  const now = new Date();
  const ts = pad(now.getUTCHours()) + ":" + pad(now.getUTCMinutes()) + ":" + pad(now.getUTCSeconds());
  const line = document.createElement("div");
  line.className = "threat-line";
  line.innerHTML = '<span class="t-time">[' + ts + ']</span> <span class="t-' + lvl + '">[' + lvl.toUpperCase() + ']</span> ' + msg;
  body.appendChild(line);
  while (body.children.length > 80) body.removeChild(body.firstChild);
  body.scrollTop = body.scrollHeight;
}

export function addRule(rule) { RULES.push(rule); }

export function evaluateAlerts() {
  for (const r of RULES) {
    try {
      const out = r.test();
      if (!out || !out.fire) continue;
      const last = fired.get(r.id) || 0;
      if (Date.now() - last < COOLDOWN) continue;
      fired.set(r.id, Date.now());
      logThreat(out.severity || r.severity || "warn", out.msg || r.label);
      logWorldEvent({ cat: "ALERT", sev: out.severity || r.severity || "warn", title: out.msg || r.label, key: r.id + "|" + (out.msg || r.label) });
      if (out.sound !== false) beep(out.severity || r.severity);
    } catch { /* rule exploded — ignore */ }
  }
}

export function startAlertEngine() {
  setInterval(evaluateAlerts, 60 * 1000);
}

/**
 * NOTE: this module used to expose startNoiseLog(), which filled the THREAT
 * LOG with randomly generated "port scan from <random IP>" / "DNS tunnelling"
 * lines. That was fabricated security telemetry shown as if real. The panel
 * is now driven only by evaluateAlerts() (live feed conditions) and by
 * logWorldEvent() entries from the real data modules.
 */
