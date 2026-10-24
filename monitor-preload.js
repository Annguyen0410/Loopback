const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("monitorApi", {
  /* News, quakes and indices are PUSHED by the single owner in main (monitor:live); there is deliberately no
     fetchQuakes/fetchIndices bridge here — a second fetch path is what made every feed download twice. */
  sys: () => ipcRenderer.invoke("monitor:sys"),
  // Generic CORS-bypassing proxy (host allowlist enforced in main)
  proxy: url => ipcRenderer.invoke("monitor:proxy", url),
  onLive: cb => ipcRenderer.on("monitor:live", (e, d) => cb(d)),
  close: () => ipcRenderer.send("monitor:close")
});
