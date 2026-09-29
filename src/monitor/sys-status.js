/**
 * System status panel: CPU / MEM / NET / DISK — real host metrics via IPC.
 * NET latency = mean of live FEEDS latencies; missing metrics render as —.
 */

import { $ } from "./utils.js";
import { api } from "./bridge.js";
import { FEEDS } from "./net.js";

function setBar(id, val, max, suffix) {
  const fill = $(id + "Fill");
  const label = $(id + "Val");
  if (!fill || !label) return;
  if (val == null || Number.isNaN(val)) {
    fill.style.width = "0%";
    fill.style.background = "#666";
    fill.style.color = "#666";
    label.textContent = "—";
    return;
  }
  const pct = Math.max(0, Math.min(100, Math.round((val / max) * 100)));
  const color = pct > 80 ? "#ff5c66" : pct > 60 ? "#ffb84d" : "#2dffa8";
  fill.style.width = pct + "%";
  fill.style.background = color;
  // `.sys-fill` glows with currentColor, which is inherited text colour —
  // without this the halo never matched the bar.
  fill.style.color = color;
  label.textContent = Math.round(val) + (suffix || "%");
}

function avgFeedLatency() {
  let sum = 0, n = 0;
  for (const f of Object.values(FEEDS)) {
    if (f && f.latency > 0 && f.status !== "OFFLINE") {
      sum += f.latency;
      n++;
    }
  }
  return n ? Math.round(sum / n) : null;
}

export function initSysStatus() {
  let inFlight = false;
  async function update() {
    if (inFlight) return;
    inFlight = true;
    try {
      if (!api || !api.sys) {
        setBar("cpu", null, 100);
        setBar("mem", null, 100);
        setBar("net", null, 200, "ms");
        setBar("disk", null, 100);
        return;
      }
      let s = null;
      try { s = await api.sys(); } catch { s = null; }
      if (!s || !s.ok) {
        setBar("cpu", null, 100);
        setBar("mem", null, 100);
        setBar("net", null, 200, "ms");
        setBar("disk", null, 100);
        return;
      }
      setBar("cpu", s.cpu, 100);
      setBar("mem", s.mem, 100);
      setBar("net", avgFeedLatency(), 200, "ms");
      setBar("disk", s.disk, 100);
    } finally {
      inFlight = false;
    }
  }
  update();
  setInterval(update, 2000);
}
