const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("monitorApi", {
  fetchQuakes: () => ipcRenderer.invoke("monitor:quakes"),
  fetchIndices: () => ipcRenderer.invoke("monitor:indices"),
  fetch2YYield: () => ipcRenderer.invoke("monitor:2y-yield"),
  sys: () => ipcRenderer.invoke("monitor:sys"),
  // Generic CORS-bypassing proxy (host allowlist enforced in main)
  proxy: url => ipcRenderer.invoke("monitor:proxy", url),
  onLive: cb => ipcRenderer.on("monitor:live", (e, d) => cb(d)),
  close: () => ipcRenderer.send("monitor:close")
});
