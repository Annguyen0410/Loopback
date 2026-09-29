const { contextBridge, ipcRenderer } = require("electron");

// Buffer the payload until the page attaches its callback (load race).
let pending = null;
const subs = [];

contextBridge.exposeInMainWorld("shot", {
  ready: cb => {
    subs.push(cb);
    if (pending) { const d = pending; pending = null; cb(d); }
  },
  done: sel => ipcRenderer.send("shot:done", sel),
  cancel: () => ipcRenderer.send("shot:cancel")
});

ipcRenderer.on("shot:ready", (e, d) => {
  if (subs.length) subs.forEach(cb => { try { cb(d); } catch {} });
  else pending = d;
});
