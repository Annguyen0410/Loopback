/**
 * Network I/O panel — 24-bar sparkline + TX/RX from real byte counters.
 * RX = renderer resource-timing bytes + main-process proxy response bytes.
 * TX ≈ 0 (monitor issues no uploads); no data → 0 / empty bars.
 */

import { $ } from "./utils.js";
import { api } from "./bridge.js";

const history = new Array(24).fill(0); // KB/s
let lastLocal = 0;
let lastProxy = 0;
let lastTs = 0;
let primed = false;
let everActive = false;

function localRxBytes() {
  try {
    const entries = performance.getEntriesByType("resource");
    let b = 0;
    for (const e of entries) {
      b += e.transferSize || e.encodedBodySize || 0;
    }
    return b;
  } catch { return 0; }
}

function render(rxKBs, txKBs) {
  const el = $("netGraph");
  if (el) {
    const max = Math.max(4, ...history);
    let html = "";
    for (let i = 0; i < history.length; i++) {
      const h = history[i] > 0 ? Math.max(2, Math.round((history[i] / max) * 26)) : 2;
      html += '<div class="net-bar" style="height:' + h + 'px"></div>';
    }
    el.innerHTML = html;
  }
  const tx = $("txRate");
  const rx = $("rxRate");
  if (tx) tx.textContent = everActive ? String(Math.round(txKBs)) : "—";
  if (rx) rx.textContent = everActive ? String(Math.round(rxKBs)) : "—";
}

export function initNet() {
  let lastProxySample = 0;
  async function update() {
    let proxy = lastProxySample;
    if (api && api.sys) {
      try {
        const s = await api.sys();
        if (s && s.ok && typeof s.proxyRxBytes === "number") {
          proxy = s.proxyRxBytes;
          lastProxySample = proxy;
        }
      } catch { /* keep last proxy baseline */ }
    }
    const now = Date.now();
    const local = localRxBytes();
    if (!primed) {
      lastLocal = local;
      lastProxy = proxy;
      lastTs = now;
      primed = true;
      render(0, 0);
      return;
    }
    const dt = Math.max(0.5, (now - lastTs) / 1000);
    let delta = (local - lastLocal) + (proxy - lastProxy);
    if (delta < 0) delta = 0;
    lastLocal = local;
    lastProxy = proxy;
    lastTs = now;
    if (delta > 0) everActive = true;
    const rxKBs = delta / dt / 1024;
    history.shift();
    history.push(rxKBs);
    render(rxKBs, 0);
  }
  update();
  setInterval(update, 1000);
}
