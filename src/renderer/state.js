/**
 * Shared mutable state for the whole renderer.
 * Loaded once in main.js from disk, mutated by feature modules.
 *
 * Data model (v1.3 multi-chat):
 *   state.chats        — [{ id, name, pinned, createdAt }]
 *   state.messages     — [{ ..., chatId }]
 *   state.activeChatId — id of the chat shown in the main panel
 */

export const state = { chats: [], messages: [], activeChatId: null };
/* `theme` / `darkMode` / `pipScale` / `hideInRecording` / `camPos` / `camScale`
   are the long-standing ones; the last five come from the mini recording panel
   in the floating menu (see recprefs.js). */
export const settings = {
  darkMode: false,
  theme: "blue",
  sidebarCollapsed: false,
  /* Floating bar behaviour (Settings → Floating Bar). */
  pipOnStartup: true,   // drop the bar on its dock when the app launches
  pipOnMinimize: true,  // minimizing the app shows the bar
  pipDock: "right",     // "left" | "right" — which edge the bar parks on
  startAtLogin: false,  // Windows login item (app.setLoginItemSettings)
  recQuality: "hd",  // "sd" | "hd" | "fhd"
  recFps: 30,        // 30 | 60
  recCursor: true,   // draw the mouse pointer into the recording
  camDeviceId: "",   // "" = system default camera
  micDeviceId: ""    // "" = system default microphone
};

/** Small cross-module registries (not persisted). */
export const ui = {
  ctxTarget: null,
  editingId: null,
  searchHits: [],
  searchIdx: -1,
};

/** The chat currently shown in the main panel (falls back to the first). */
export function getActiveChat() {
  if (!state.chats.length) return null;
  return state.chats.find(c => c.id === state.activeChatId) || state.chats[0];
}

/** Messages belonging to a chat (defaults to the active chat). */
export function messagesFor(chatId) {
  const id = chatId == null ? state.activeChatId : chatId;
  return state.messages.filter(m => m.chatId === id);
}
