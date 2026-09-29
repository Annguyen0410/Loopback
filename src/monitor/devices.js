/**
 * Connected nodes — real non-loopback IPv4 interfaces via monitor:sys IPC.
 * No interfaces / IPC failure → OFFLINE empty state.
 */

import { $, esc } from "./utils.js";
import { api } from "./bridge.js";

let nodes = null; // null = loading, [] = empty/offline

export function initDevices() {
  render();
  refresh();
  setInterval(refresh, 30000);
}

async function refresh() {
  if (!api || !api.sys) {
    nodes = [];
    render();
    return;
  }
  try {
    const s = await api.sys();
    if (s && s.ok && Array.isArray(s.interfaces)) {
      nodes = s.interfaces.map(i => ({ name: i.name, ip: i.address, online: true }));
    } else {
      nodes = [];
    }
  } catch {
    nodes = [];
  }
  render();
}

function render() {
  const el = $("devicesList");
  if (!el) return;
  if (nodes === null) {
    el.innerHTML = '<div class="panel-empty">Loading…</div>';
    return;
  }
  if (!nodes.length) {
    el.innerHTML = '<div class="panel-empty">OFFLINE</div>';
    return;
  }
  let html = "";
  for (const d of nodes) {
    const cls = d.online ? "online" : "offline";
    html += '<div class="device-row"><span class="device-status ' + cls + '"></span><span class="device-name">' +
      esc(d.name) + '</span><span class="device-ip">' + esc(d.ip) + "</span></div>";
  }
  el.innerHTML = html;
}
