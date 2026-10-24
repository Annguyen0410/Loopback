/**
 * monitortest.js — realtime + regression checks for the World Monitor.
 *
 * Covers the "must update in real time, not once per day" work:
 *   1.  Finance tab: one dead feed must NOT blank the other sections
 *       (the old blanket catch wiped commodities/currencies/yield/FG).
 *   2.  Finance tab: polling loops exist with the right cadences
 *       (crypto 3m, F&G 5m, prediction 2m, World Bank macro 60m).
 *   3.  Prediction markets: live Polymarket data renders with percentages.
 *   4.  INFRA tab: port-weather poll loop exists (5 min, active tab only).
 *   5.  GDACS/GDELT/IODA: unreachable feed renders "unreachable", not a
 *       fake "no alerts" quiet-world message.
 *   6.  GDELT seendate "20260929T041500Z" renders a real date (was garbage).
 *   7.  Threat log timestamps use UTC like the events log.
 *   8.  Live hub polling exists for news/quakes/indices (main push channel).
 *
 * Run:  npx electron monitortest.js
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Never let a test write into the real Monitor preferences. `app.setPath`
// must run before `whenReady`, which is why it sits at module scope.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "loopback-monitortest-"));
app.setPath("userData", profile);

let PASS = 0, FAIL = 0;
function ok(cond, name, extra) {
  if (cond) { PASS++; console.log("  PASS  " + name); }
  else { FAIL++; console.log("  FAIL  " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* --------------------------------------------------------------- stubs -- */
// Direct network is left to the proxy stub, so every feed is deterministic.
ipcMain.handle("monitor:proxy", async (_e, url) => {
  const u = String(url || "");
  const deny = () => ({ ok: false, error: "host-not-allowed" });
  // GDELT + IODA are "unreachable" in this test.
  if (u.includes("gdeltproject.org")) return deny();
  if (u.includes("ioda.inetintel")) return deny();
  if (u.includes("gdacs.org")) {
    return { ok: true, text: `<?xml version="1.0"?><rss><channel>
      <item><title>Cyclone Test Event</title><pubDate>Tue, 29 Sep 2026 04:00:00 GMT</pubDate>
      <gdacs:alertlevel>Red</gdacs:alertlevel><gdacs:eventtype>TC</gdacs:eventtype>
      <geo:lat>15.0</geo:lat><geo:long>90.0</geo:long><gdacs:eventid>12345</gdacs:eventid></item>
      </channel></rss>` };
  }
  if (u.includes("www.cisa.gov")) {
    return { ok: true, text: `<?xml version="1.0"?><rss><channel>
      <item><title>CISA test advisory on a router flaw</title><link>https://www.cisa.gov/test-advisory</link>
      <pubDate>Fri, 23 Oct 2026 10:00:00 GMT</pubDate><description>Patch guidance for the test advisory.</description></item>
      <item><title>CISA Adds One Known Exploited Vulnerability to Catalog</title><link>https://www.cisa.gov/test-kev</link>
      <pubDate>Fri, 23 Oct 2026 09:00:00 GMT</pubDate><description>Catalog update.</description></item>
      </channel></rss>` };
  }
  if (u.includes("gamma-api.polymarket.com")) {
    return { ok: true, json: [
      { active: true, closed: false, question: "Will the test suite pass before Friday?",
        outcomes: "[\"Yes\", \"No\"]", outcomePrices: "[\"0.82\", \"0.18\"]",
        volume24hr: 2500000, endDate: "2026-10-15T00:00:00Z" },
      { active: true, closed: false, question: "Will the next release ship this week?",
        outcomes: "[\"Yes\", \"No\"]", outcomePrices: "[\"0.41\", \"0.59\"]",
        volume24hr: 850000, endDate: "2026-10-03T00:00:00Z" },
      { active: true, closed: false, question: "Tiny market below volume floor",
        outcomes: "[\"Yes\", \"No\"]", outcomePrices: "[\"0.50\", \"0.50\"]",
        volume24hr: 5000, endDate: "2026-10-03T00:00:00Z" }
    ] };
  }
  return { ok: false, error: "host-not-allowed(" + u.slice(0, 60) + ")" };
});
ipcMain.handle("monitor:indices", async () => ({ quoteResponse: { result: [
  { symbol: "^GSPC", regularMarketPrice: 5000.12, regularMarketChangePercent: 0.5 },
  { symbol: "^TNX", regularMarketPrice: 44.2, regularMarketChangePercent: -0.3 },
  { symbol: "2YY=F", regularMarketPrice: 4.42, regularMarketChangePercent: 0.1 },
  { symbol: "GC=F", regularMarketPrice: 2400.5, regularMarketChangePercent: -0.2 },
  { symbol: "EURUSD=X", regularMarketPrice: 1.0842, regularMarketChangePercent: 0.15 }
] } }));
ipcMain.handle("monitor:2y-yield", async () => null);
ipcMain.handle("monitor:quakes", async () => ({ ok: false }));
ipcMain.handle("monitor:sys", async () => ({
  ok: true, cpu: 12, mem: 40, disk: 55, proxyRxBytes: 0,
  interfaces: [{ name: "Wi-Fi", address: "192.168.1.5", mac: "00:11:22:33:44:55" }]
}));

/* ---------------------------------------------------------------- boot -- */
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: { preload: path.join(__dirname, "monitor-preload.js"), nodeIntegration: false, contextIsolation: true }
  });
  const consoleErrors = [];
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 3) consoleErrors.push(String(message).slice(0, 200));
  });
  await win.loadFile(path.join(__dirname, "monitor.html"));
  await new Promise(r => setTimeout(r, 800));

  const j = expr => win.webContents.executeJavaScript(expr, true);

  /* 1 — finance: one dead source must not blank the others. Uses real
     module imports so the same code paths as production run. */
  test("finance: dead source does not blank other sections", async () => {
    const r = await j(`(async () => {
      const m = await import("./src/monitor/finance.js");
      m.renderFinanceTab();
      /* Quotes arrive as a PUSH from the single owner in main — the tab no longer fetches indices itself. */
      m.applyLiveIndices({ quoteResponse: { result: [
        { symbol: "^GSPC", regularMarketPrice: 5000.12, regularMarketChangePercent: 0.5 },
        { symbol: "^TNX", regularMarketPrice: 44.2, regularMarketChangePercent: -0.3 },
        { symbol: "2YY=F", regularMarketPrice: 4.42, regularMarketChangePercent: 0.1 },
        { symbol: "GC=F", regularMarketPrice: 2400.5, regularMarketChangePercent: -0.2 },
        { symbol: "EURUSD=X", regularMarketPrice: 1.0842, regularMarketChangePercent: 0.15 }
      ] } });
      await new Promise(r => setTimeout(r, 4000)); // crypto hits the real API
      return {
        stocks: document.getElementById("finStocks").textContent,
        commod: document.getElementById("finCommodities").textContent,
        yieldTxt: document.getElementById("finYield").textContent,
        pred: document.getElementById("finPrediction").textContent,
        crypto: document.getElementById("finCrypto").textContent,
        macroRows: document.getElementById("finGDP").querySelectorAll(".fin-row").length
      };
    })()`);
    ok(r.stocks.includes("S&P 500") && r.stocks.includes("5000"), "indices render from push cache", r.stocks);
    ok(r.commod.includes("OFFLINE") === false && r.commod !== "", "commodities table not blanked by dead crypto feed", r.commod);
    ok(r.yieldTxt.includes("US 10Y") && r.yieldTxt.includes("4.42"), "yield curve renders (10Y from ^TNX)", r.yieldTxt);
    ok(r.crypto !== "Loading…" && (r.crypto.includes("$") || r.crypto.includes("OFFLINE")),
      "crypto settles on real rows or its own OFFLINE (never blanked)", r.crypto);
    ok(r.pred.includes("OFFLINE") === false, "prediction markets not OFFLINE (live)", r.pred);
    ok(r.macroRows > 0, "World Bank macro rendered rows", r.macroRows);
  });

  /* 2 — finance polling loops registered with the right cadences.
     A cache-busting import gives a fresh module instance because boot already
     registered the timers in the shared instance. */
  test("finance: polling loops registered (crypto 3m, FG 5m, poly 2m, macro 60m)", async () => {
    const r = await j(`(async () => {
      const seen = [];
      const raw = window.setInterval.bind(window);
      window.setInterval = (fn, ms) => { seen.push(ms); return raw(fn, ms); };
      const m = await import("./src/monitor/finance.js?fresh=" + Date.now());
      m.refreshFinancePolling();
      window.setInterval = raw;
      return seen;
    })()`);
    ok(r.includes(3 * 60 * 1000), "crypto 3-minute poll", r);
    ok(r.includes(5 * 60 * 1000), "fear&greed 5-minute poll", r);
    ok(r.includes(2 * 60 * 1000), "prediction markets 2-minute poll", r);
    ok(r.includes(60 * 60 * 1000), "World Bank macro hourly poll", r);
  });

  /* 3 — prediction markets render live percentages (stubbed proxy). */
  test("prediction markets: rows render with percentages", async () => {
    const r = await j(`(async () => {
      const m = await import("./src/monitor/finance.js");
      const okRendered = await m.loadPredictionMarkets();
      const el = document.getElementById("finPrediction");
      const rows = el.querySelectorAll(".fin-row").length;
      const pcts = [...el.querySelectorAll(".fin-val")].map(n => n.textContent.trim()).filter(t => /^\\d+%$/.test(t));
      return { okRendered, rows, pcts: pcts.slice(0, 3), first: (el.querySelector(".fin-row .fin-name") || {}).textContent || "" };
    })()`);
    ok(r.okRendered === true, "loadPredictionMarkets() reports live", r.okRendered);
    ok(r.rows >= 2, "at least 2 market rows", r.rows);
    ok(r.pcts.length >= 2 && r.pcts.every(t => /^\d+%$/.test(t)), "percentages formatted", r.pcts);
    ok(r.first.length > 5, "market question text present", r.first);
  });

  /* 4 — infra: poll loop registered + port weather actually renders. */
  test("infra: port-weather poll loop registered (5 min) and table renders", async () => {
    const r = await j(`(async () => {
      const tab = document.getElementById("sbInfra");
      tab.classList.add("active");
      const seen = [];
      const raw = window.setInterval.bind(window);
      window.setInterval = (fn, ms) => { seen.push(ms); return raw(fn, ms); };
      const m = await import("./src/monitor/infrastructure.js?fresh=" + Date.now());
      m.refreshInfraPolling();
      window.setInterval = raw;
      m.renderInfraTab();
      let portRows = 0;
      for (let i = 0; i < 40; i++) {           // up to ~10s for the real fetch
        await new Promise(r => setTimeout(r, 250));
        portRows = document.getElementById("infraPorts").querySelectorAll(".fin-row").length;
        if (portRows > 0) break;
      }
      return { seen, portRows };
    })()`);
    ok(r.seen.includes(5 * 60 * 1000), "5-minute port-weather poll", r.seen);
    ok(r.portRows > 0, "ports table rendered (real weather fetch ran)", r.portRows);
  });

  /* 5 — GDACS/GDELT/IODA: null (unreachable) renders an explicit state,
     [] (clean fetch, no events) renders the honest empty state. Pure render
     contract so the check is deterministic regardless of live-feed health. */
  test("unreachable feeds: explicit state instead of fake 'no alerts'", async () => {
    const r = await j(`(async () => {
      const g = await import("./src/monitor/geopolitics.js");
      const d = await import("./src/monitor/disasters.js");
      d.renderGDACS(null);  const gdacsNull  = document.getElementById("gdacsList").textContent;
      d.renderGDACS([]);    const gdacsEmpty = document.getElementById("gdacsList").textContent;
      g.renderGDELT(null);  const gdeltNull  = document.getElementById("gdeltList").textContent;
      g.renderGDELT([]);    const gdeltEmpty = document.getElementById("gdeltList").textContent;
      g.renderIODA(null);   const iodaNull   = document.getElementById("iodaList").textContent;
      g.renderIODA([]);     const iodaEmpty  = document.getElementById("iodaList").textContent;
      const gdelt = await g.fetchGDELT();
      const ioda = await g.fetchIODA();
      return { gdacsNull, gdacsEmpty, gdeltNull, gdeltEmpty, iodaNull, iodaEmpty,
        gdeltShape: gdelt === null ? "null" : Array.isArray(gdelt) ? "array" : "other",
        iodaShape: ioda === null ? "null" : Array.isArray(ioda) ? "array" : "other" };
    })()`);
    ok(/GDACS unreachable/i.test(r.gdacsNull), "GDACS null → unreachable state", r.gdacsNull);
    ok(/No recent GDACS alerts/i.test(r.gdacsEmpty), "GDACS [] → honest empty state", r.gdacsEmpty);
    ok(/GDELT unreachable/i.test(r.gdeltNull) && !/No GDELT events/.test(r.gdeltNull), "GDELT null → unreachable state", r.gdeltNull);
    ok(/No GDELT events/.test(r.gdeltEmpty), "GDELT [] → honest empty state", r.gdeltEmpty);
    ok(/IODA unreachable/i.test(r.iodaNull) && !/No major outages/.test(r.iodaNull), "IODA null → unreachable state", r.iodaNull);
    ok(/No major outages/.test(r.iodaEmpty), "IODA [] → honest empty state", r.iodaEmpty);
    ok(r.gdeltShape === "null" || r.gdeltShape === "array", "fetchGDELT contract: null=down, array=live", r.gdeltShape);
    ok(r.iodaShape === "null" || r.iodaShape === "array", "fetchIODA contract: null=down, array=live", r.iodaShape);
  });

  /* 6 — GDELT seendate parsed to a real date (was "20260929T0" garbage). */
  test("GDELT seendate renders a real ISO date", async () => {
    const r = await j(`(async () => {
      const g = await import("./src/monitor/geopolitics.js");
      g.renderGDELT([{ seendate: "20260929T041500Z", domain: "test.example", url: "https://example.com/a", title: "Seendate check" }]);
      const txt = document.getElementById("gdeltList").textContent;
      return { txt, dateOk: /2026-09-29/.test(txt) };
    })()`);
    ok(r.dateOk, "seendate → 2026-09-29", r.txt);
    ok(!r.txt.includes("20260929T0"), "no raw garbage string", r.txt);
  });

  /* 7 — threat log timestamps are UTC like the events log. */
  test("threat log timestamps use UTC", async () => {
    const r = await j(`(async () => {
      const a = await import("./src/monitor/alerts.js");
      a.logThreat("warn", "UTC check");
      const line = document.querySelector("#threatLog .threat-line:last-child").textContent;
      const m = line.match(/\\[(\\d{2}):(\\d{2}):(\\d{2})\\]/);
      const now = new Date();
      const utc = [now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()].map(n => String(n).padStart(2, "0"));
      const local = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, "0"));
      const off = utc.some((v, i) => v !== local[i]); // true when TZ ≠ UTC
      return { line, matchUtc: !!m && m[1] === utc[0] && m[2] === utc[1], off };
    })()`);
    ok(r.matchUtc || !r.off, "log line hour:minute equals UTC now", r.line);
    ok(/\[WARN\]/i.test(r.line) && r.line.includes("UTC check"), "message rendered with level", r.line);
  });

  /* 8 — one owner per feed. Main owns news/quakes/indices, the page owns the rest; neither polls the other's
     feeds, and the cadence is tied to how often each source changes (it used to be 20-30 s everywhere). */
  test("one owner per feed, with cadences tied to the source", async () => {
    const fs = require("fs");
    const mainSrc = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
    const newsSrc = fs.readFileSync(path.join(__dirname, "src", "monitor", "news.js"), "utf8");
    const marketsSrc = fs.readFileSync(path.join(__dirname, "src", "monitor", "markets.js"), "utf8");
    const quakesSrc = fs.readFileSync(path.join(__dirname, "src", "monitor", "quakes.js"), "utf8");
    const { FEED_CADENCE } = require("./src/main/monitor-scheduler.js");
    ok(/createMonitorScheduler/.test(mainSrc), "main runs the single-owner scheduler", null);
    ok(FEED_CADENCE.news >= 5 * 60 * 1000, "news cadence is minutes, not 30 s", FEED_CADENCE.news);
    ok(FEED_CADENCE.quakes >= 2 * 60 * 1000, "quakes cadence is not 20 s", FEED_CADENCE.quakes);
    ok(FEED_CADENCE.indices >= 2 * 60 * 1000, "indices cadence is not 30 s", FEED_CADENCE.indices);
    ok(!/setInterval\(fetchNews/.test(newsSrc), "the page does not poll news as well", null);
    ok(!/setInterval\(fetchMarkets/.test(marketsSrc), "the page does not poll indices as well", null);
    ok(!/setInterval\(.*fetchQuakes/.test(quakesSrc), "the page does not poll quakes as well", null);
    ok(!/pushMonitor\("refresh"/.test(mainSrc), "no duplicate refresh signals from main", null);
    ok(/gamma-api\.polymarket\.com/.test(fs.readFileSync(path.join(__dirname, "src", "main", "monitor-proxy.js"), "utf8")),
      "proxy allowlist has polymarket host", null);
  });

  /* 9 — normalized event timeline + search + country brief + watch + trends. */
  test("event timeline: dedupe, filters, details and map centering", async () => {
    const r = await j(`(async () => {
      const s = await import("./src/monitor/event-store.js");
      s.clearEvents();
      const now = Date.now();
      s.recordEvents([
        { category: "QUAKE", severity: "crit", title: "M 6.6 — Timeline test quake", source: "USGS",
          externalId: "timeline-quake", eventTime: now - 60000, observedAt: now - 60000, lat: 23.7, lng: 121, country: "Taiwan", value: 6.6 },
        { category: "FLOOD", severity: "warn", title: "Timeline test flood", source: "GDACS",
          externalId: "timeline-flood", eventTime: now - 120000, observedAt: now - 120000, country: "Vietnam" },
        { category: "QUAKE", severity: "crit", title: "M 6.6 — Timeline test quake", source: "USGS",
          externalId: "timeline-quake", eventTime: now - 60000, observedAt: now - 30000, lat: 23.7, lng: 121, country: "Taiwan", value: 6.6 }
      ]);
      const v = await import("./src/monitor/event-view.js");
      v.focusEvent(s.getEvents({ categories: ["QUAKE"], limit: 10 })[0].id);
      const rows = document.querySelectorAll("#evList .evt-row").length;
      const detail = document.getElementById("evDetail").textContent;
      const count = s.getEvents({ limit: 20 }).length;
      return { count, rows, detail, selected: document.querySelectorAll("#evList .evt-row.selected").length };
    })()`);
    ok(r.count === 2, "a repeated poll is one stored event", r.count);
    ok(r.rows === 2 && r.selected === 1, "timeline renders and selects the event", r);
    ok(/Timeline test quake/.test(r.detail) && /USGS/.test(r.detail) && /23\.70/.test(r.detail), "detail includes title, source and coordinates", r.detail);
  });

  test("command palette searches cached events and opens one", async () => {
    const r = await j(`(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
      const input = document.getElementById("paletteInput");
      input.value = "Timeline test quake";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const rows = [...document.querySelectorAll("#paletteResults .palette-item")].map(row => row.textContent);
      return { open: !document.getElementById("palette").hidden, rows };
    })()`);
    ok(r.open, "palette opened with Ctrl+K");
    ok(r.rows.some(row => /Timeline test quake/.test(row) && /event/i.test(row)), "event is searchable from the palette", r.rows);
  });

  test("country brief joins the static profile to matching live evidence", async () => {
    const r = await j(`(async () => {
      const c = await import("./src/monitor/country-risk.js");
      c.showRiskDetail("TW");
      const text = document.getElementById("riskModalBrief").textContent;
      return { text, modal: document.getElementById("riskModal").style.display };
    })()`);
    ok(r.modal === "flex", "country modal opens");
    ok(/COUNTRY BRIEF/.test(r.text) && /Timeline test quake/.test(r.text), "brief shows the matching event", r.text.slice(0, 180));
    ok(/STATIC PROFILE/.test(r.text) && /not a real\-time measurement/.test(r.text), "static scores stay explicitly labelled");
    ok(/DATA COVERAGE/.test(r.text), "coverage gaps are visible");
  });

  test("watchlist saves a rule, matches a new event and respects the cooldown", async () => {
    const r = await j(`(async () => {
      const s = await import("./src/monitor/event-store.js");
      const w = await import("./src/monitor/watchlist.js");
      document.querySelector('.sb-tab[data-tab="watch"]').click();
      document.getElementById("watchKind").value = "keyword";
      document.getElementById("watchValue").value = "Watchtest";
      document.getElementById("watchSound").checked = false;
      document.getElementById("watchNotify").checked = false;
      document.getElementById("watchAdd").click();
      const rules = JSON.parse(localStorage.getItem("wm_watch_rules_v2") || "[]");
      const now = Date.now();
      s.recordEvent({ category: "NEWS", severity: "warn", title: "Watchtest alert from a feed", source: "Wire Test", externalId: "watch-1", eventTime: now, observedAt: now });
      await new Promise(resolve => setTimeout(resolve, 120));
      const history = JSON.parse(localStorage.getItem("wm_watch_history_v2") || "[]");
      return {
        rules: rules.length,
        rule: rules[0] && rules[0].value,
        history: history.length,
        text: document.getElementById("watchHistory").textContent
      };
    })()`);
    ok(r.rules === 1 && r.rule === "Watchtest", "rule persisted", r);
    ok(r.history >= 1 && /Watchtest alert/.test(r.text), "new matching event recorded in history", r);
  });

  test("source health shows last success and the failure, and trends stay cross-source", async () => {
    const r = await j(`(async () => {
      const n = await import("./src/monitor/net.js");
      n.noteFeedStatus({ feed: "healthtest", status: "STALE", lastOk: Date.now() - 120000, lastErr: "timeout", lastAttempt: Date.now(), failures: 2 });
      n.renderFeedStatus();
      const row = [...document.querySelectorAll("#feedStatusList .fs-row")].find(el => /healthtest/.test(el.textContent));
      const s = await import("./src/monitor/event-store.js");
      const now = Date.now();
      s.recordEvents([
        { category: "NEWS", title: "Trendtest port closure reported", source: "Wire A", externalId: "trend-a", url: "https://example.com/a", eventTime: now - 60000, observedAt: now - 60000 },
        { category: "NEWS", title: "Trendtest port closure continues", source: "Wire B", externalId: "trend-b", url: "https://example.com/b", eventTime: now - 120000, observedAt: now - 120000 },
        { category: "NEWS", title: "Trendtest port union statement", source: "Wire C", externalId: "trend-c", url: "https://example.com/c", eventTime: now - 180000, observedAt: now - 180000 }
      ]);
      const t = await import("./src/monitor/trending.js");
      t.renderTrending();
      return { row: row ? row.textContent : "", title: row ? row.title : "", trends: document.getElementById("trendList").textContent };
    })()`);
    ok(/stale/.test(r.row) && /ok 2m/.test(r.row), "feed row shows stale + last-success age", r.row);
    ok(/last success 2m ago/.test(r.title) && /last error: timeout/.test(r.title), "tooltip carries last success and error", r.title);
    ok(/trendtest/.test(r.trends.toLowerCase()) && /3 sources/.test(r.trends), "trend requires and reports cross-source volume", r.trends);
  });

  /* 10 — v1.7 additions: CISA panel, deterministic brief, saved events and
     the derived event-density layer. Fixtures keep this offline-safe. */
  test("v1.7: cyber advisories, sitrep, saved events and event heat", async () => {
    const r = await j(`(async () => {
      const cyber = await import("./src/monitor/cyber.js?fresh=" + Date.now());
      cyber.initCyber();
      await new Promise(resolve => setTimeout(resolve, 500));
      const cyberText = document.getElementById("cyberList").textContent;

      const store = await import("./src/monitor/event-store.js");
      const withPoint = store.getEvents({ limit: 50 }).find(event => event.lat != null && event.lng != null);
      const pins = await import("./src/monitor/pins.js");
      if (withPoint) pins.togglePin(withPoint);
      const view = await import("./src/monitor/event-view.js");
      view.renderEventsTab();
      const savedEl = document.getElementById("evSaved");

      const sitrep = await import("./src/monitor/sitrep.js?fresh=" + Date.now());
      sitrep.initSitrep();
      const sitrepText = document.getElementById("sitrepBody").textContent;

      const layers = await import("./src/monitor/layer-toggles.js");
      layers.toggleLayer("eventHeat", true);
      const mapLayers = await import("./src/monitor/map-layers.js");
      await new Promise(resolve => setTimeout(resolve, 80));
      return {
        cyberText,
        savedVisible: !savedEl.hidden,
        savedText: savedEl.textContent,
        pinCount: pins.pinCount(),
        sitrepText,
        heat: mapLayers.debugLayerState().eventHeat
      };
    })()`);
    ok(/CISA test advisory|Known Exploited/.test(r.cyberText), "CISA advisories render from a real feed shape", r.cyberText.slice(0, 160));
    ok(r.savedVisible && r.pinCount === 1 && /CISA|test|quake/i.test(r.savedText), "a saved event appears in the EVENTS tab", r.savedText);
    ok(/ops/.test(r.sitrepText) && /Deterministic|deterministic/.test(r.sitrepText), "sitrep renders from cached records only", r.sitrepText.slice(0, 180));
    ok(r.heat && r.heat.markers >= 1, "event-density layer draws a cell from geolocated records", r.heat);
  });

  /* Cache-first restart: the header used to claim LIVE even with no data at all. Seed the same store a
     previous session would have left, reload, and check that the restored list and the badge both say CACHED. */
  test("cache-first headlines and an honest header after a restart", async () => {
    await j(`(async () => {
      const es = await import("./src/monitor/event-store.js");
      es.clearEvents();
      es.recordEvent({
        category: "NEWS", severity: "info", title: "Restored test headline",
        url: "https://example.com/restored", source: "Cache Test",
        eventTime: Date.now() - 5 * 60 * 1000, observedAt: Date.now() - 5 * 60 * 1000
      });
    })()`);
    const loaded = new Promise(resolve => win.webContents.once("did-finish-load", resolve));
    win.reload();
    await loaded;
    await new Promise(resolve => setTimeout(resolve, 1400));
    const r = await j(`(async () => {
      const net = await import("./src/monitor/net.js");
      for (const key of Object.keys(net.FEEDS)) delete net.FEEDS[key];
      net.renderFeedStatus();
      const badge = document.getElementById("headerLive");
      return {
        signals: document.getElementById("topSignals").textContent,
        ticker: document.getElementById("newsTrack").textContent,
        badgeText: badge.textContent,
        badgeClass: badge.className,
        badgeTitle: badge.title
      };
    })()`);
    ok(/Restored test headline/.test(r.signals), "stored headlines return after a restart", r.signals.slice(0, 160));
    ok(/CACHED/.test(r.signals) && /CACHED/.test(r.ticker), "restored headlines are labelled CACHED in both places", { signals: r.signals.slice(0, 80), ticker: r.ticker.slice(0, 80) });
    ok(/CACHED/.test(r.badgeText) && /cached/.test(r.badgeClass) && /earlier session/.test(r.badgeTitle),
      "the header says CACHED instead of a hard-coded LIVE", r);
  });

  /* run everything sequentially */
  console.log("\n== monitortest: " + tests.length + " groups ==");
  for (const t of tests) {
    try { await t.fn(); }
    catch (e) { FAIL++; console.log("  FAIL  " + t.name + "  → threw: " + e.message); }
  }
  console.log("\n== RESULT " + PASS + " passed, " + FAIL + " failed ==");
  console.log("CONSOLE-ERRORS " + JSON.stringify(consoleErrors));
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Windows may still hold a cache file */ }
  app.exit(FAIL > 0 || consoleErrors.length > 0 ? 1 : 0);
});
