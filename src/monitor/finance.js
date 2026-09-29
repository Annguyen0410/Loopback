/**
 * Finance tab — live crypto / indices / commodities / FX / yield from
 * monitor:indices + public APIs, plus real annual macro figures from the
 * World Bank. Central-bank policy rates and prediction markets have no free
 * live source → OFFLINE empty (never hardcoded).
 */

import { $, esc } from "./utils.js";
import { fetchJSON } from "./net.js";
import { api } from "./bridge.js";
import { fetchIndicator, INDICATORS } from "./worldbank.js";

const MACRO_COUNTRIES = ["WLD", "US", "CN", "IN", "DE", "BR"];

const CRYPTO_URL = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=8&page=1&sparkline=false";
const CG_GLOBAL_URL = "https://api.coingecko.com/api/v3/global";
const FNG_URL = "https://api.alternative.me/fng/";

/* ---- Prediction markets — Polymarket gamma API (free, no key) ---- */
const POLYMARKET_URL = "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=40&order=volume24hr&ascending=false";
let polymarketRows = [];

/** Some gamma fields arrive as JSON strings; accept both shapes. */
function maybeArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const a = JSON.parse(v); return Array.isArray(a) ? a : null; } catch { return null; } }
  return null;
}

function fmtMoney(v) {
  if (!(v > 0)) return "—";
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  return "$" + Math.round(v / 1e3) + "k";
}

/**
 * Top open Polymarket markets by 24h volume with live probabilities.
 * Only real, keyless source for prediction markets — the panel previously
 * said "No free live source" while this API existed all along.
 * Returns true when at least one market rendered.
 */
export async function loadPredictionMarkets() {
  const el = $("finPrediction");
  if (!el) return false;
  let rows = [];
  try {
    const markets = await fetchJSON("finance.poly", POLYMARKET_URL, { timeout: 15000 });
    if (Array.isArray(markets)) {
      rows = markets
        .filter(m => m && m.active && !m.closed && Number(m.volume24hr) >= 100000)
        .map(m => {
          const outcomes = maybeArray(m.outcomes);
          const prices = maybeArray(m.outcomePrices);
          const p = prices && prices.length ? parseFloat(prices[0]) : NaN;
          return {
            q: String(m.question || ""),
            side: outcomes && outcomes.length ? String(outcomes[0]) : "",
            p: isFinite(p) ? p : null,
            vol: Number(m.volume24hr),
            end: m.endDate ? Date.parse(m.endDate) : null
          };
        })
        .filter(r => r.p != null && r.q && r.q.length <= 110)
        .sort((a, b) => b.vol - a.vol)
        .slice(0, 8);
    }
  } catch { /* OFFLINE below */ }
  polymarketRows = rows;
  renderPredictionMarkets();
  return rows.length > 0;
}

function renderPredictionMarkets() {
  const el = $("finPrediction");
  if (!el) return;
  if (!polymarketRows.length) {
    el.innerHTML = '<div class="panel-empty">OFFLINE</div>';
    return;
  }
  let html = "";
  for (const r of polymarketRows) {
    const pct = Math.round(r.p * 100);
    const cls = pct >= 65 ? "up" : pct <= 35 ? "down" : "";
    html += '<div class="fin-row" title="P(first outcome' + (r.side ? ' “' + r.side + '”' : "") +
      ') · 24h volume ' + fmtMoney(r.vol) + (r.end ? " · ends " + new Date(r.end).toISOString().slice(0, 10) : "") + '">' +
      '<span class="fin-name">' + esc(r.q) + '</span>' +
      '<span class="fin-val ' + cls + '">' + pct + "%</span></div>";
  }
  html += '<div class="fin-row" style="font-size:8px;color:var(--text-dim)">Polymarket · leading-outcome probability · top 8 by 24h volume ≥ $100k</div>';
  el.innerHTML = html;
}

/* ---- Per-section loaders: one dead feed must never blank the others ---- */

/** Crypto table + global stats. Returns true when live data rendered. */
export async function loadCrypto() {
  try {
    const cg = await fetchJSON("finance.crypto", CRYPTO_URL);
    if (cg && cg.length) {
      const liveDot = $("finLiveDot");
      if (liveDot) liveDot.style.display = "inline-block";
      const el = $("finCrypto");
      if (el) {
        let html = "";
        const ICONS = { bitcoin: "₿", ethereum: "Ξ", solana: "◉", ripple: "✕", "binancecoin": "◆", cardano: "▲" };
        for (const c of cg) {
          const cls = c.price_change_percentage_24h > 0 ? "up" : "down";
          const sign = c.price_change_percentage_24h > 0 ? "+" : "";
          html += '<div class="fin-row"><span class="fin-name"><span class="crypto-icon">' + (ICONS[c.id] || "◆") + "</span>" +
            (c.name || c.symbol).toUpperCase() +
            '</span><span class="fin-val ' + cls + '">$' +
            c.current_price.toLocaleString(undefined, { maximumFractionDigits: 2 }) +
            ' <span style="font-size:8px">' + sign +
            (c.price_change_percentage_24h ? c.price_change_percentage_24h.toFixed(2) : "0.00") + "%</span></span></div>";
        }
        el.innerHTML = html;
      }
    } else {
      emptyTable("finCrypto", "OFFLINE");
      return false;
    }
  } catch {
    emptyTable("finCrypto", "OFFLINE");
    return false;
  }
  try {
    const cgGlobal = await fetchJSON("finance.cg", CG_GLOBAL_URL);
    if (cgGlobal && cgGlobal.data) {
      const el = $("finCryptoGlobal"), gdot = $("dotCgGlobal");
      if (gdot) gdot.style.display = "inline-block";
      if (el) {
        const m = cgGlobal.data;
        el.innerHTML = '<div class="fin-row"><span class="fin-name">Total Market Cap</span><span class="fin-val">$' +
          (m.total_market_cap && m.total_market_cap.usd ? (m.total_market_cap.usd / 1e12).toFixed(2) + "T" : "—") + "</span></div>" +
          '<div class="fin-row"><span class="fin-name">24h Volume</span><span class="fin-val">$' +
          (m.total_volume && m.total_volume.usd ? (m.total_volume.usd / 1e9).toFixed(1) + "B" : "—") + "</span></div>" +
          '<div class="fin-row"><span class="fin-name">BTC Dominance</span><span class="fin-val">' +
          (m.market_cap_percentage && m.market_cap_percentage.btc ? m.market_cap_percentage.btc.toFixed(1) + "%" : "—") + "</span></div>";
      }
    }
  } catch { /* global stats optional */ }
  return true;
}

/** Fear & Greed gauge. Returns true when live data rendered. */
export async function loadFearGreed() {
  try {
    const fg = await fetchJSON("finance.fg", FNG_URL);
    if (fg && fg.data && fg.data[0] && fg.data[0].value) {
      const el = $("fgGauge");
      if (el) {
        const pct = parseInt(fg.data[0].value, 10);
        if (!Number.isNaN(pct)) {
          const emoji = pct >= 75 ? "🟢 EXTREME GREED" : pct >= 55 ? "🤑 GREED" : pct >= 45 ? "😐 NEUTRAL" : pct >= 25 ? "😨 FEAR" : "😰 EXTREME FEAR";
          const color = pct >= 75 ? "#00cc44" : pct >= 55 ? "#88cc00" : pct >= 45 ? "#ffcc00" : pct >= 25 ? "#ff8800" : "#ff2222";
          el.innerHTML = '<div class="fg-wrap"><div class="fg-gauge-bar"><div class="fg-marker" style="left:' +
            pct + '%"></div><span class="fg-extreme left">Fear</span><span class="fg-extreme right">Greed</span></div><div><div class="fg-label" style="color:' +
            color + '">' + emoji + '</div><div class="fg-val">' + fg.data[0].value + " / 100</div></div></div>";
          return true;
        }
      }
    }
  } catch { /* OFFLINE below */ }
  const el = $("fgGauge");
  if (el) el.innerHTML = '<div class="panel-empty">OFFLINE</div>';
  return false;
}

/**
 * GDP growth and inflation from the World Bank — annual, latest reported year.
 * These were previously left as OFFLINE even though a free keyless source
 * exists for both.
 */
async function loadMacroTables() {
  const el = $("finGDP");
  if (!el) return;
  el.innerHTML = '<div class="panel-loading"><div class="skel"></div><div class="skel w-75"></div><div class="skel w-60"></div></div>';

  const [gdp, cpi] = await Promise.all([
    fetchIndicator(INDICATORS.gdpGrowth, MACRO_COUNTRIES).catch(() => []),
    fetchIndicator(INDICATORS.inflation, MACRO_COUNTRIES).catch(() => [])
  ]);
  if (!gdp.length && !cpi.length) {
    el.innerHTML = '<div class="panel-empty">World Bank unreachable</div>';
    return;
  }
  const dot = $("finGdpDot");
  if (dot) dot.style.display = "inline-block";

  const block = (label, rows, colour) => {
    let h = '<div class="fin-row"><span class="fin-name" style="color:var(--text-secondary)">' + esc(label) +
      '</span><span class="fin-val" style="font-size:8px;color:var(--text-dim)">' + (rows.length ? rows[0].year : "—") + "</span></div>";
    for (const r of rows) {
      h += '<div class="fin-row" style="padding-left:11px"><span class="fin-name" style="font-size:9.5px">' +
        esc(r.country) + '</span><span class="fin-val" style="font-size:9.5px;color:' + colour(r.value) + '">' +
        (r.value > 0 ? "+" : "") + r.value.toFixed(1) + "%</span></div>";
    }
    return h;
  };

  el.innerHTML =
    block("GDP growth (annual %)", gdp, v => (v >= 3 ? "#2dd881" : v >= 0 ? "#ffb84d" : "#ff5c66")) +
    block("Inflation, consumer prices (%)", cpi, v => (v <= 4 ? "#2dd881" : v <= 8 ? "#ffb84d" : "#ff5c66")) +
    '<div class="fin-row" style="font-size:8px;color:var(--text-dim)">World Bank · latest reported year</div>';
}

const COMMODITY_MAP = [
  { name: "Brent Crude", sym: "BZ=F" },
  { name: "WTI Crude",   sym: "CL=F" },
  { name: "Natural Gas", sym: "NG=F" },
  { name: "Gold",        sym: "GC=F" },
  { name: "Silver",      sym: "SI=F" },
  { name: "Copper",      sym: "HG=F" },
  { name: "Wheat",       sym: "ZW=F" },
  { name: "Corn",        sym: "ZC=F" }
];

const FX_MAP = [
  { name: "EUR/USD", sym: "EURUSD=X" },
  { name: "GBP/USD", sym: "GBPUSD=X" },
  { name: "USD/JPY", sym: "JPY=X" },
  { name: "USD/CNY", sym: "CNY=X" },
  { name: "USD/INR", sym: "INR=X" },
  { name: "USD/BRL", sym: "BRL=X" },
  { name: "USD/TRY", sym: "TRY=X" },
  { name: "EUR/GBP", sym: "EURGBP=X" },
  { name: "CHF/USD", sym: "CHFUSD=X" }
];

function emptyTable(id, msg) {
  const el = $(id);
  if (el) el.innerHTML = '<div class="panel-empty">' + msg + "</div>";
}

function quoteMap(result) {
  const m = new Map();
  for (const q of result || []) m.set(q.symbol, q);
  return m;
}

function rowsFromMap(map, defs) {
  const rows = [];
  for (const d of defs) {
    const q = map.get(d.sym);
    if (!q || q.regularMarketPrice == null) continue;
    rows.push({
      name: d.name,
      price: q.regularMarketPrice,
      chg: q.regularMarketChangePercent || 0
    });
  }
  return rows;
}

function renderTable(id, data) {
  const el = $(id);
  if (!el) return;
  if (!data || !data.length) {
    el.innerHTML = '<div class="panel-empty">OFFLINE</div>';
    return;
  }
  let html = "";
  for (const d of data) {
    const cls = d.chg > 0 ? "up" : d.chg < 0 ? "down" : "";
    html += '<div class="fin-row"><span class="fin-name">' + d.name + '</span><span class="fin-val ' + cls + '">' +
      d.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) +
      ' <span style="font-size:8px">' + (d.chg > 0 ? "+" : "") + d.chg.toFixed(2) + "</span></span></div>";
  }
  el.innerHTML = html;
}

function yieldFromTnx(q) {
  if (!q || q.regularMarketPrice == null) return null;
  const p = q.regularMarketPrice;
  return p > 20 ? p / 10 : p;
}

function yieldFrom2y(q) {
  if (!q || q.regularMarketPrice == null) return null;
  // Yahoo quotes 2YY=F as the yield itself (e.g. 4.42). An earlier version
  // applied (100 - price), which printed "US 2Y 95.58%" on the yield curve.
  const p = q.regularMarketPrice;
  return p > 20 ? p / 10 : p; // guard a feed that quotes yield x10
}

function renderYieldLive(map, q2y) {
  const el = $("finYield");
  if (!el) return;
  const y10 = yieldFromTnx(map.get("^TNX"));
  const y2 = yieldFrom2y(q2y && q2y.regularMarketPrice != null ? q2y : map.get("2YY=F"));
  if (y10 == null && y2 == null) {
    el.innerHTML = '<div class="panel-empty">OFFLINE</div>';
    return;
  }
  const row = (name, val, cls) =>
    '<div class="fin-row"><span class="fin-name">' + name + '</span><span class="fin-val ' + (cls || "") + '">' + val + "</span></div>";
  let html = "";
  if (y2 != null) html += row("US 2Y", y2.toFixed(2) + "%");
  if (y10 != null) html += row("US 10Y", y10.toFixed(2) + "%");
  if (y10 != null && y2 != null) {
    const bp = (y10 - y2) * 100;
    html += row(
      "US 2Y-10Y Spread",
      (bp >= 0 ? "+" : "") + bp.toFixed(1) + "bp",
      bp >= 0 ? "up" : "down"
    );
  }
  el.innerHTML = html;
}

function renderStockTable(data) {
  const el = $("finStocks");
  if (!el) return;
  if (!data || !data.length) {
    el.innerHTML = '<div class="panel-empty">OFFLINE</div>';
    return;
  }
  let html = "";
  const SYM = { "^GSPC": "S&P 500", "^IXIC": "NASDAQ", "^DJI": "DOW", "^FTSE": "FTSE", "^GDAXI": "DAX", "^N225": "NIKKEI", "^HSI": "HSI", "000001.SS": "SHCOMP", "^STOXX50E": "STOXX", "^VIX": "VIX", "^TNX": "US10Y" };
  for (const q of data.slice(0, 12)) {
    const name = SYM[q.symbol] || q.symbol;
    const chg = q.regularMarketChangePercent != null ? q.regularMarketChangePercent : 0;
    const cls = chg > 0.005 ? "up" : chg < -0.005 ? "down" : "";
    html += '<div class="fin-row"><span class="fin-name">' + name + '</span><span class="fin-val ' + cls + '">' +
      (q.regularMarketPrice != null ? q.regularMarketPrice.toFixed(2) : "—") +
      ' <span style="font-size:8px">' + (chg > 0 ? "+" : "") + chg.toFixed(2) + "%</span></span></div>";
  }
  el.innerHTML = html;
}

function refreshFeedsList(got) {
  const el = $("finFeeds");
  if (!el) return;
  const items = [
    ["Equity Indices", !!got.indices],
    ["Commodities / FX", !!got.indices],
    ["Crypto Market", !!got.crypto],
    ["Fear &amp; Greed", !!got.fg],
    ["Yield Curve", !!got.yield],
    ["Prediction (Polymarket)", !!got.poly],
    ["Macro (World Bank)", !!got.macro]
  ];
  let html = "";
  for (const [n, ok] of items) {
    html += '<div class="fin-row"><span class="fin-name">' + n + '</span><span class="fin-val ' +
      (ok ? "up" : "") + '">' + (ok ? "●" : "○") + "</span></div>";
  }
  el.innerHTML = html;
  const dot = $("dotFeeds");
  if (dot) dot.style.display = "inline-block";
}

let lastQuotes = null;

/** Main-process push (monitor:live type=indices). */
export function applyLiveIndices(payload) {
  const result = payload && payload.quoteResponse && payload.quoteResponse.result;
  if (!result || !result.length) return;
  lastQuotes = result;
  const map = quoteMap(result);
  const stockDot = $("finStockDot");
  if (stockDot) stockDot.style.display = "inline";
  renderStockTable(result);
  renderTable("finCommodities", rowsFromMap(map, COMMODITY_MAP));
  renderTable("finCurrencies", rowsFromMap(map, FX_MAP));
  const fxDot = $("finFxDot");
  if (fxDot) fxDot.style.display = "inline-block";
  renderYieldLive(map, map.get("2YY=F"));
}

async function loadLiveFinance() {
  const got = { indices: false, crypto: false, fg: false, yield: false };
  try {
    const dot = $("finStockDot");
    if (dot) dot.style.display = "inline";
    let map = new Map();
    if (lastQuotes) {
      map = quoteMap(lastQuotes);
      got.indices = true;
      renderStockTable(lastQuotes);
      renderTable("finCommodities", rowsFromMap(map, COMMODITY_MAP));
      renderTable("finCurrencies", rowsFromMap(map, FX_MAP));
      const fxDot = $("finFxDot");
      if (fxDot) fxDot.style.display = "inline-block";
    } else if (api && api.fetchIndices) {
      try {
        const d = await api.fetchIndices();
        const result = d && d.quoteResponse && d.quoteResponse.result;
        if (result && result.length) {
          map = quoteMap(result);
          got.indices = true;
          renderStockTable(result);
          renderTable("finCommodities", rowsFromMap(map, COMMODITY_MAP));
          renderTable("finCurrencies", rowsFromMap(map, FX_MAP));
          const fxDot = $("finFxDot");
          if (fxDot) fxDot.style.display = "inline-block";
        } else {
          emptyTable("finCommodities", "OFFLINE");
          emptyTable("finCurrencies", "OFFLINE");
          renderStockTable(null);
        }
      } catch {
        emptyTable("finCommodities", "OFFLINE");
        emptyTable("finCurrencies", "OFFLINE");
        renderStockTable(null);
      }
    } else {
      emptyTable("finCommodities", "OFFLINE");
      emptyTable("finCurrencies", "OFFLINE");
      emptyTable("finStocks", "OFFLINE");
    }

    let y2 = map.get("2YY=F") || null;
    if (api && api.fetch2YYield) {
      try {
        const y = await api.fetch2YYield();
        const meta = y && y.chart && y.chart.result && y.chart.result[0] && y.chart.result[0].meta;
        if (meta && meta.regularMarketPrice != null) y2 = meta;
      } catch { /* fall back to 2YY=F from indices */ }
    }
    renderYieldLive(map, y2);
    got.yield = !!(map.size || y2);

    const [cryptoOk, fgOk] = await Promise.all([loadCrypto(), loadFearGreed()]);
    got.crypto = cryptoOk;
    got.fg = fgOk;
    got.poly = polymarketRows.length > 0;
  } catch (e) {
    /* Section loaders own their OFFLINE states. The old blanket catch wiped
       commodities/currencies/yield/FG whenever ONE source threw, so a single
       dead feed blanked the entire Finance tab. */
    console.warn("[Monitor] finance load", e);
  }
  refreshFeedsList(got);
}

export function renderFinanceTab() {
  emptyTable("finCommodities", "Loading…");
  emptyTable("finCurrencies", "Loading…");
  emptyTable("finStocks", "Loading…");
  emptyTable("finCrypto", "Loading…");
  // Central-bank policy rates still have no free live source.
  emptyTable("finRates", "No free live source");
  loadPredictionMarkets();
  loadMacroTables();
  emptyTable("finYield", "Loading…");
  emptyTable("finFeeds", "Loading…");
  const fg = $("fgGauge");
  if (fg) fg.innerHTML = "";
  const cg = $("finCryptoGlobal");
  if (cg) cg.innerHTML = "";
  loadLiveFinance();
}

/* ---- Self-updating Finance tab ------------------------------------------
 * The tab used to load exactly once, when first opened: crypto/F&G/prediction
 * markets froze for the whole session and the World Bank tables never saw the
 * next annual release. Poll while the tab is open (first load happens in
 * renderFinanceTab). */
let financeTimers = [];

export function refreshFinancePolling() {
  const finTab = document.getElementById("sbFinance");
  if (!finTab || financeTimers.length) return;
  const whenActive = fn => () => { if (finTab.classList.contains("active")) fn(); };
  financeTimers.push(setInterval(whenActive(loadCrypto), 3 * 60 * 1000));
  financeTimers.push(setInterval(whenActive(loadFearGreed), 5 * 60 * 1000));
  financeTimers.push(setInterval(whenActive(loadPredictionMarkets), 2 * 60 * 1000));
  financeTimers.push(setInterval(whenActive(loadMacroTables), 60 * 60 * 1000));
}
