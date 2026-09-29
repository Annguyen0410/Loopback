/* Minimal bridge for cam.html — the floating camera bubble window. */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("camApi", {
  onFrame: cb => ipcRenderer.on("cam:frame", (e, url) => cb(url)),
  onSize: cb => ipcRenderer.on("cam:size", (e, label) => cb(label)),
  onState: cb => ipcRenderer.on("cam:state", (e, state) => cb(state)),
  dragStart: () => ipcRenderer.invoke("cam:dragStart"),
  dragTo: pos => ipcRenderer.send("cam:dragTo", pos),
  dragEnd: () => ipcRenderer.send("cam:dragEnd"),
  cycleSize: () => ipcRenderer.send("cam:cycleSize")
});
