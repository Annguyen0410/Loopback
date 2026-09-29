/**
 * Markets ticker — populates the #finTicker strip via monitorApi.fetchIndices()
 * (Yahoo v8 chart, fetched in the main process). Duplicated items for the
 * infinite marquee look, matching the existing news ticker pattern.
 */

import { $, esc } from "./utils.js";
import { api } from "./bridge.js";

let cached = [];

export function renderMarkets(items) {
  const el = $("finTicker");
  if (!el) return;
  if (!items || !items.length) return;
  cached = items;
  let html = "";
  for (const q of items.slice(0, 30)) {
    const sym = (q.symbol || "").replace("=F", "").replace("=X", "").toUpperCase();
    const price = q.regularMarketPrice != null ? formatPrice(q.regularMarketPrice) : "—";
    const chg = q.regularMarketChangePercent != null ? q.regularMarketChangePercent : 0;
    const cls = chg > 0.005 ? "up" : chg < -0.005 ? "down" : "";
    html += '<span class="fin-item"><span class="fin-sym">' + esc(sym) + "</span>" +
      '<span class="fin-price">' + price + "</span>" +
      '<span class="fin-chg ' + cls + '">' + (chg > 0 ? "+" : "") + chg.toFixed(2) + "%</span></span>";
  }
  el.innerHTML = html + html;
}

function formatPrice(v) {
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (v >= 100) return v.toFixed(1);
  if (v >= 10) return v.toFixed(2);
  if (v >= 1) return v.toFixed(3);
  return v.toFixed(4);
}

export async function fetchMarkets() {
  try {
    if (!api || !api.fetchIndices) return;
    const data = await api.fetchIndices();
    if (data && data.quoteResponse && data.quoteResponse.result && data.quoteResponse.result.length) {
      renderMarkets(data.quoteResponse.result);
    }
  } catch { /* silent — ticker just stays empty */ }
}

/** Main-process push (monitor:live type=indices). */
export function applyLiveMarkets(payload) {
  const result = payload && payload.quoteResponse && payload.quoteResponse.result;
  if (result && result.length) renderMarkets(result);
}

export function initMarkets() {
  fetchMarkets();
  setInterval(fetchMarkets, 2 * 60 * 1000); // fallback when live hub is off
}