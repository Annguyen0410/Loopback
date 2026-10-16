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
  cancel: () => ipcRenderer.send("shot:cancel"),
  /* The frozen screen is really on the page now. Main keeps the picker hidden
     until this lands, so the user never stares at a black full-screen window
     that ignores clicks (the page has no listener up yet at that point). */
  painted: () => ipcRenderer.send("shot:painted")
});

ipcRenderer.on("shot:ready", (e, d) => {
  if (subs.length) subs.forEach(cb => { try { cb(d); } catch {} });
  else pending = d;
});
