/* Minimal bridge for quick.html — quick capture only needs chats + save. */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("quickApi", {
  load: () => ipcRenderer.invoke("quick:chats"),
  save: (text, chatId) => ipcRenderer.invoke("quick:append", { text, chatId }),
  hide: () => ipcRenderer.send("quick:hide"),
  onFocus: cb => ipcRenderer.on("quick:focus", () => cb())
});
