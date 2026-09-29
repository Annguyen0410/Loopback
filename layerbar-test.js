/* Smoke test for the monitor layer bar:
 *   1. drag the bar → moves freely + position persisted
 *   2. plain click on the bar → re-centers it on the screen (never "lệch")
 * Run: npx electron layerbar-test.js
 */
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

  const run = async () => {
    try {
      // Start from a deterministic, clean state (earlier runs persist
      // wm_layerbar_pos across Electron launches with the same userData).
      await win.webContents.executeJavaScript(`(function(){
        localStorage.removeItem('wm_layerbar_pos');
        const bar = document.getElementById('layerBar');
        bar.classList.remove('dragged');
        bar.style.left = ''; bar.style.top = ''; bar.style.width = '';
        return true;
      })()`);

      // 1) Drag the bar by its left padding (non-interactive area) +150/+90.
      const dragRes = await win.webContents.executeJavaScript(`(function(){
        const bar = document.getElementById('layerBar');
        const cs = getComputedStyle(bar);
        const r0 = bar.getBoundingClientRect();
        bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: r0.left + 8, clientY: r0.top + 8 }));
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r0.left + 8 + 150, clientY: r0.top + 8 + 90 }));
        const cs1 = getComputedStyle(bar);
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        return new Promise(res => setTimeout(res, 500)).then(() => {
          const r1 = bar.getBoundingClientRect();
          const cs2 = getComputedStyle(bar);
          return {
            dragged: bar.classList.contains('dragged'),
            before: { left: Math.round(r0.left), top: Math.round(r0.top), w: Math.round(r0.width), transform: cs.transform, transition: cs.transition },
            during: { left: bar.style.left, top: bar.style.top, transform: cs1.transform, transition: cs1.transition },
            after: { left: Math.round(r1.left), top: Math.round(r1.top), w: Math.round(r1.width), transform: cs2.transform },
            movedBy: { x: Math.round(r1.left - r0.left), y: Math.round(r1.top - r0.top) },
            saved: localStorage.getItem('wm_layerbar_pos')
          };
        });
      })()`);
      console.log("DRAG " + JSON.stringify(dragRes));
      const dragOk = !!dragRes && dragRes.dragged === true && !!dragRes.saved
        && Math.abs(dragRes.movedBy.x - 150) <= 3 && Math.abs(dragRes.movedBy.y - 90) <= 3;

      // 2) Plain click on the bar → re-center on screen (wait out the
      //    .3s transition before measuring).
      const clickRes = await win.webContents.executeJavaScript(`(function(){
        const bar = document.getElementById('layerBar');
        const r = bar.getBoundingClientRect();
        bar.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 8, clientY: r.top + 8 }));
        return new Promise(res => setTimeout(res, 1500)).then(() => ({
          dragged: bar.classList.contains('dragged'),
          left: bar.style.left, top: bar.style.top, width: bar.style.width,
          saved: localStorage.getItem('wm_layerbar_pos')
        }));
      })()`);
      console.log("CLICK " + JSON.stringify(clickRes));
      const clickOk = !!clickRes && clickRes.dragged === false && clickRes.left === "" && clickRes.top === "" && clickRes.width === "" && !clickRes.saved;

      // 3) After re-center, the bar's visual centre sits at screen centre.
      const c = await win.webContents.executeJavaScript(`(function(){
        const bar = document.getElementById('layerBar');
        const r = bar.getBoundingClientRect();
        return { barCenter: Math.round(r.left + r.width / 2), vpCenter: Math.round(window.innerWidth / 2), w: Math.round(r.width) };
      })()`);
      console.log("CENTERED " + JSON.stringify(c));
      const centerOk = Math.abs(c.barCenter - c.vpCenter) <= 3;

      console.log("DRAG-OK " + dragOk);
      console.log("CLICK-OK " + clickOk);
      console.log("CENTER-OK " + centerOk);
      console.log("CONSOLE-ERRORS " + JSON.stringify(errors));
    } catch (e) {
      console.log("EXC " + ((e && e.stack) || e));
    } finally {
      try { await win.webContents.executeJavaScript("localStorage.removeItem('wm_layerbar_pos')"); } catch {}
      app.quit();
    }
  };

  win.loadFile(path.join(__dirname, "monitor.html")).then(() => setTimeout(run, 10000));
});
