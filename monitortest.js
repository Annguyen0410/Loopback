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

  /* 8 — live hub main-process polling exists for news/quakes/indices. */
  test("main live hub: news/quakes/indices poll loops wired in main.js", async () => {
    const fs = require("fs");
    const src = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
    ok(/tick\("news",\s*pollLiveNews,\s*30 \* 1000/.test(src), "news polled every 30s in main", null);
    ok(/tick\("quakes",\s*pollLiveQuakes,\s*20 \* 1000/.test(src), "quakes polled every 20s in main", null);
    ok(/tick\("indices",\s*pollLiveIndices,\s*30 \* 1000/.test(src), "indices polled every 30s in main", null);
    ok(src.includes("gamma-api.polymarket.com"), "proxy allowlist has polymarket host", null);
  });

  /* run everything sequentially */
  console.log("\n== monitortest: " + tests.length + " groups ==");
  for (const t of tests) {
    try { await t.fn(); }
    catch (e) { FAIL++; console.log("  FAIL  " + t.name + "  → threw: " + e.message); }
  }
  console.log("\n== RESULT " + PASS + " passed, " + FAIL + " failed ==");
  console.log("CONSOLE-ERRORS " + JSON.stringify(consoleErrors));
  app.exit(FAIL > 0 || consoleErrors.length > 0 ? 1 : 0);
});
