const { app, BrowserWindow } = require("electron");
const path = require("path");
const https = require("https");

function proxyFetch(url, cb) {
  https.get(url, res => {
    if (res.statusCode !== 200) { cb({ ok: false, error: "HTTP " + res.statusCode }); res.resume(); return; }
    let data = "";
    res.on("data", d => data += d);
    res.on("end", () => { try { cb({ ok: true, json: JSON.parse(data) }); } catch { cb({ ok: true, text: data }); } });
  }).on("error", e => cb({ ok: false, error: e.message }));
}

app.whenReady().then(() => {
  const { ipcMain } = require("electron");
  ipcMain.handle("monitor:proxy", async (_, url) => new Promise(r => proxyFetch(url, r)));
  ipcMain.handle("monitor:indices", async () => ({ ok: false }));
  ipcMain.handle("monitor:2y-yield", async () => 0);
  ipcMain.handle("monitor:quakes", async () => ({ ok: false }));
  ipcMain.handle("monitor:sys", async () => ({
    ok: true, cpu: 12, mem: 40, disk: 55,
    interfaces: [{ name: "Wi-Fi", address: "192.168.1.5", mac: "00:11:22:33:44:55" }],
    proxyRxBytes: 0, hostname: "test", platform: "win32", uptime: 1
  }));

  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: { preload: path.join(__dirname, "monitor-preload.js"), nodeIntegration: false, contextIsolation: true }
  });
  const errors = [];
  win.webContents.on("console-message", (e, level, message) => { if (level >= 3) errors.push(String(message).slice(0, 200)); });
  win.loadFile(path.join(__dirname, "monitor.html")).then(() => {
    setTimeout(() => {
      win.webContents.executeJavaScript("(function(){ document.querySelectorAll('.layer-toggle input[data-layer]').forEach(function(inp){ if(!inp.checked){ inp.checked=true; inp.dispatchEvent(new Event('change',{bubbles:true})); } }); return new Promise(function(res){ setTimeout(res, 700); }).then(function(){ return window.__mapLayers.debug(); }); })()")
        .then(async r => {
          const d = await r;
          const dom = await win.webContents.executeJavaScript("(function(){ var r={planes:document.querySelectorAll('.plane-icon').length,ships:document.querySelectorAll('.ship-icon').length}; return r; })()");
          console.log("LAYERS " + JSON.stringify(d));
          console.log("DOM-ICONS " + JSON.stringify(dom));
          console.log("CONSOLE-ERRORS " + JSON.stringify(errors));
          app.quit();
        }).catch(e => { console.log("ERR " + e.message + " :: " + JSON.stringify(errors)); app.quit(); });
    }, 11000);
  });
});