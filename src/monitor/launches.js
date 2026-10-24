/**
 * Upcoming orbital launches — The Space Devs' Launch Library 2.
 *
 * Free and keyless, but rate-limited. One request every ten minutes is well
 * below the anonymous allowance and only runs while the hidden window is
 * visible (poll-gate). A failed request renders OFFLINE; the panel never
 * invents a launch or a countdown.
 */

import { $, esc, safeHref } from "./utils.js";
import { fetchJSON } from "./net.js";

const URL = "https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=5";
let launches = [];
let loaded = false;
let failed = false;

function countdown(net, status) {
  const at = Date.parse(net || "");
  if (!Number.isFinite(at)) return "TBD";
  const ms = at - Date.now();
  if (/success/i.test(status || "")) return "LAUNCHED";
  if (/fail/i.test(status || "")) return "FAILED";
  const sign = ms < 0 ? "+" : "-";
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / 3600000);
  const days = Math.floor(hours / 24);
  const mins = Math.floor((abs % 3600000) / 60000);
  // Past the launch window but not yet confirmed: count up for a day, then
  // stop pretending the time is still meaningful.
  if (ms < 0 && days >= 1) return "PAST";
  if (days > 0) return "T" + sign + days + "d " + (hours % 24) + "h";
  if (hours > 0) return "T" + sign + hours + "h " + mins + "m";
  return "T" + sign + Math.max(0, mins) + "m";
}

function render() {
  const el = $("launchList");
  if (!el) return;
  if (!loaded) {
    el.innerHTML = '<div class="panel-empty">Loading launches…</div>';
    return;
  }
  if (failed) {
    el.innerHTML = '<div class="panel-empty">Launch Library 2 unreachable — retrying…</div>';
    return;
  }
  if (!launches.length) {
    el.innerHTML = '<div class="panel-empty">No upcoming launches reported.</div>';
    return;
  }
  let html = "";
  for (const launch of launches) {
    const status = String((launch.status && launch.status.abbrev) || "").toUpperCase();
    const color = status === "GO" || /SUCCESS/i.test(status)
      ? "var(--accent)"
      : status === "TBC" || status === "TBD" ? "var(--amber)"
        : /FAIL/i.test(status) ? "var(--red)" : "var(--text-dim)";
    const provider = (launch.launch_service_provider && launch.launch_service_provider.name) || "Unknown provider";
    const pad = (launch.pad && ((launch.pad.location && launch.pad.location.name) || launch.pad.name)) || "";
    const link = safeHref(launch.url || launch.infoURL || "https://thespacedevs.com/llapi");
    html += '<div class="launch-row">' +
      '<span class="launch-time" data-net="' + esc(launch.net || "") + '" data-status="' + esc(status) + '" style="color:' + color + '">' + esc(countdown(launch.net, status)) + "</span>" +
      '<span class="launch-main"><a href="' + link + '" target="_blank" rel="noopener">' + esc(launch.name || "Unnamed launch") + "</a>" +
      '<span class="launch-meta">' + esc(provider) + (pad ? " · " + esc(pad) : "") + "</span></span>" +
      "</div>";
  }
  el.innerHTML = html + '<div class="launch-source">Source: Launch Library 2 · times in UTC · updates every 10m</div>';
}

function tickCountdowns() {
  const el = $("launchList");
  if (!el || failed || !launches.length) return;
  el.querySelectorAll(".launch-time[data-net]").forEach(node => {
    node.textContent = countdown(node.getAttribute("data-net"), node.getAttribute("data-status"));
  });
}

export async function fetchLaunches() {
  try {
    const data = await fetchJSON("launches", URL, { timeout: 15000 });
    const results = data && Array.isArray(data.results) ? data.results : [];
    launches = results.filter(item => item && item.name).slice(0, 5);
    loaded = true;
    failed = false;
    render();
  } catch {
    loaded = true;
    failed = true;
    render();
  }
}

export function initLaunches() {
  render();
  fetchLaunches();
  setInterval(fetchLaunches, 10 * 60 * 1000);
  setInterval(tickCountdowns, 30 * 1000);
}
