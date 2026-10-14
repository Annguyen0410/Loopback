const { contextBridge, ipcRenderer } = require("electron");

/* Bridge for the screenshot review window (review.html). Kept tiny and
 * explicit: the review can save a copy, copy to the clipboard, print a note
 * into the picture, reveal the stored file, delete it, collapse itself and
 * move/close itself — nothing else. */
contextBridge.exposeInMainWorld("review", {
  fileUrl: n => `local-file:///${encodeURIComponent(n)}`,
  // The pristine capture as bytes: the card builds its note canvas from a
  // same-origin blob, since drawing a local-file:// image taints the canvas.
  bytes: () => ipcRenderer.invoke("review:bytes"),
  download: () => ipcRenderer.invoke("review:download"),
  saveAs: () => ipcRenderer.invoke("review:saveAs"),
  copy: () => ipcRenderer.invoke("review:copy"),
  // The baked PNG (with the note printed on it) replaces the stored capture.
  annotate: payload => ipcRenderer.invoke("review:annotate", {
    note: String((payload && payload.note) || ""),
    buffer: payload && payload.buffer ? payload.buffer : undefined
  }),
  // A real minimize: the card drops to the taskbar and comes back from there.
  minimize: () => ipcRenderer.send("review:minimize"),
  reveal: () => ipcRenderer.invoke("review:reveal"),
  remove: () => ipcRenderer.invoke("review:remove"),
  close: () => ipcRenderer.send("review:close"),
  dragStart: () => ipcRenderer.invoke("review:getpos"),
  dragTo: pos => ipcRenderer.send("review:dragto", pos)
});
