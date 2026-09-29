const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("api", {
  /* Store */
  load: () => ipcRenderer.invoke("store:load"),
  save: d => ipcRenderer.invoke("store:save", d),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: d => ipcRenderer.invoke("settings:save", d),

  /* Files */
  pickFiles: filters => ipcRenderer.invoke("file:pick", filters),
  saveCanvas: d => ipcRenderer.invoke("file:saveCanvas", d),
  savePasted: d => ipcRenderer.invoke("file:savePasted", d),
  openFile: n => ipcRenderer.invoke("file:open", n),
  revealFile: n => ipcRenderer.invoke("file:reveal", n),
  deleteFiles: names => ipcRenderer.invoke("file:delete", names),
  exportData: () => ipcRenderer.invoke("store:export"),
  openDataFolder: () => ipcRenderer.invoke("app:openDataFolder"),
  resizeImage: d => ipcRenderer.invoke("image:resize", d),
  // Drag & drop: electron no longer exposes File.path; use webUtils
  storeDroppedFiles: files => {
    const paths = files
      .map(f => { try { return webUtils.getPathForFile(f); } catch { return null; } })
      .filter(Boolean);
    return ipcRenderer.invoke("file:storePaths", paths);
  },
  fileUrl: n => `local-file:///${encodeURIComponent(n)}`,

  /* Voice */
  saveVoice: d => ipcRenderer.invoke("voice:save", d),

  /* Misc */
  notify: o => ipcRenderer.invoke("notify:show", o),
  setTheme: m => ipcRenderer.invoke("theme:set", m),
  openMonitor: () => ipcRenderer.send("monitor:open"),

  /* Quick note popup (also on the global Ctrl+Alt+N hotkey) */
  openQuickNote: () => ipcRenderer.send("quick:open"),

  /* Floating PiP chat bubble */
  openPip: () => ipcRenderer.send("pip:open"),
  togglePip: () => ipcRenderer.send("pip:toggle"),
  /* Open the floating BAR (collapsed, docked) right away. */
  openPipBar: side => ipcRenderer.send("pip:openbar", side),
  /* Put the whole app away: hide the chat window, keep the floating bar. */
  tuckIntoBar: () => ipcRenderer.send("app:tuckIntoBar"),
  /* "Start with Windows" — resolves to the state the OS reports. */
  setStartAtLogin: on => ipcRenderer.invoke("app:startAtLogin", !!on),
  pip: {
    expand: () => ipcRenderer.send("pip:expand"),
    collapse: () => ipcRenderer.send("pip:collapse"),
    close: () => ipcRenderer.send("pip:close"),
    flip: () => ipcRenderer.send("pip:flip"),
    resize: () => ipcRenderer.send("pip:resize"),
    maximize: () => ipcRenderer.send("pip:maximize"),
    dock: side => ipcRenderer.send("pip:dock", side),
    dragStart: () => ipcRenderer.invoke("pip:getpos"),
    dragTo: pos => ipcRenderer.send("pip:dragto", pos),
    resizeTo: size => ipcRenderer.send("pip:resizeto", size),
    getOrient: () => ipcRenderer.invoke("pip:getorient"),
    /* Authoritative current state — pulled once on init, because the
       pip:state push can arrive before the listener exists. */
    getState: () => ipcRenderer.invoke("pip:getstate"),
    onOrient: cb => ipcRenderer.on("pip:orient", (e, m) => cb(m)),
    onState: cb => ipcRenderer.on("pip:state", (e, s) => cb(s)),
    onMaximized: cb => ipcRenderer.on("pip:maximized", (e, on) => cb(!!on)),
    /* A one-line tip from main — e.g. the way back after the app was tucked
       away into the bar. */
    onHint: cb => ipcRenderer.on("pip:hint", (e, d) => cb(d || {}))
  },

  /* Floating camera bubble window (while recording from the collapsed bubble) */
  cam: {
    open: opts => ipcRenderer.invoke("cam:open", opts || {}),
    close: () => ipcRenderer.send("cam:close"),
    frame: dataUrl => ipcRenderer.send("cam:frame", dataUrl),
    state: s => ipcRenderer.send("cam:state", s),
    onMoved: cb => ipcRenderer.on("cam:moved", (e, d) => cb(d)),
    onResized: cb => ipcRenderer.on("cam:resized", (e, d) => cb(d)),
    onClosed: cb => ipcRenderer.on("cam:closed", () => cb())
  },

  /* Realtime cross-window sync */
  broadcastState: d => ipcRenderer.send("state:broadcast", d),
  onStateChanged: cb => ipcRenderer.on("state:changed", (e, d) => cb(d)),
  broadcastSettings: d => ipcRenderer.send("settings:broadcast", d),
  onSettingsChanged: cb => ipcRenderer.on("settings:changed", (e, d) => cb(d)),

  /* Screenshots + screen recordings + media library */
  capture: {
    startShot: () => ipcRenderer.invoke("capture:startShot"),
    list: () => ipcRenderer.invoke("capture:list"),
    save: (name, data) => ipcRenderer.invoke("capture:save", { name, dataUrl: typeof data === "string" ? data : undefined, buffer: data instanceof ArrayBuffer ? data : undefined }),
    remove: names => ipcRenderer.invoke("capture:delete", names),
    download: name => ipcRenderer.invoke("capture:download", name),
    reveal: name => ipcRenderer.invoke("capture:reveal", name),
    openFolder: () => ipcRenderer.invoke("capture:openFolder"),
    setContentProtection: on => ipcRenderer.invoke("capture:setContentProtection", !!on),
    // While a recording runs, keep this window's timers unthrottled and the
    // display awake so the frame pump cannot stall.
    recordingActive: on => ipcRenderer.invoke("capture:recordingActive", !!on),
    broadcast: info => ipcRenderer.send("capture:broadcast", info),
    onSaved: cb => ipcRenderer.on("capture:saved", (e, info) => cb(info)),
    // A region screenshot that produced nothing (clicked instead of dragging,
    // crop failed…) — the overlay would otherwise vanish silently.
    onFailed: cb => ipcRenderer.on("shot:failed", (e, info) => cb(info))
  }
});

// monitorApi is only used by monitor.html (its own preload exposes it too),
// exposing here is harmless and keeps both bridges symmetrical.
contextBridge.exposeInMainWorld("monitorApi", {
  fetchQuakes: () => ipcRenderer.invoke("monitor:quakes"),
  fetchIndices: () => ipcRenderer.invoke("monitor:indices"),
  fetch2YYield: () => ipcRenderer.invoke("monitor:2y-yield"),
  sys: () => ipcRenderer.invoke("monitor:sys"),
  onLive: cb => ipcRenderer.on("monitor:live", (e, d) => cb(d)),
  close: () => ipcRenderer.send("monitor:close")
});
