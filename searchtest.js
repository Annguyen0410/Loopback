/* Smoke test for the v1.8 capture features:
 *   1. global search finds messages in OTHER chats
 *   2. diacritic-insensitive: "gio" matches "giờ", "tưởng" matches "tưởng"
 *   3. clicking a result jumps to that chat and flashes the message
 *   4. in-conversation search marks hits WITHOUT destroying markdown
 *   5. the quick-note popup (Ctrl+Alt+N) appends to disk + syncs the main window
 *
 * Run (close the app first — it holds the single-instance lock):
 *   npx electron searchtest.js
 */
const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain } = require("electron");

const USER_DATA = app.getPath("userData");
const F = {
  data: path.join(USER_DATA, "messages.json"),
  settings: path.join(USER_DATA, "settings.json"),
  quick: path.join(USER_DATA, "quick.json")
};
const backups = {};
for (const k of Object.keys(F)) backups[k] = fs.existsSync(F[k]) ? fs.readFileSync(F[k], "utf8") : null;

const CHAT_A = "chat-notes";
const CHAT_B = "chat-ideas";
const NOTE_TEXT = "Ghi nhanh từ phím tắt";

fs.mkdirSync(USER_DATA, { recursive: true });
fs.writeFileSync(F.data, JSON.stringify({
  chats: [
    { id: CHAT_A, name: "Notes to Self", pinned: true, createdAt: 1 },
    { id: CHAT_B, name: "Ideas", pinned: false, createdAt: 2 }
  ],
  activeChatId: CHAT_A,
  messages: [
    { id: "m1", chatId: CHAT_A, text: "Mua sữa lúc **giờ** chiều", files: [], createdAt: Date.now() - 90000, reactions: {}, read: true },
    { id: "m2", chatId: CHAT_B, text: "Ý tưởng: làm app ghi chú", files: [], createdAt: Date.now() - 60000, reactions: {}, read: true },
    { id: "m3", chatId: CHAT_B, text: "**Quan trọng**: bản nháp cuối", files: [], createdAt: Date.now() - 30000, reactions: {}, read: true }
  ]
}), "utf8");
fs.writeFileSync(F.quick, "{}", "utf8");

// Boot the real app (registers every IPC handler + the global shortcut).
require("./main.js");

const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
function check(name, cond, extra) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));
  if (!cond) failed = true;
}
const mainWindow = () => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getSize()[0] > 700 && w.getTitle() !== "Quick note");
const quickWindow = () => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getTitle() === "Quick note");

const guard = setTimeout(() => {
  console.log("FAIL  timed out — if the app is already running, close it and re-run");
  app.exit(1);
}, 90000);

app.whenReady().then(async () => {
  try {
    await wait(1200);
    const win = mainWindow();
    check("main window booted with seeded chats", !!win);
    if (!win) return;
    const run = js => win.webContents.executeJavaScript(js);

    // Wait for the renderer to finish wiring its modules (cold start is slow).
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      ready = await run(`document.body.classList.contains('app-ready')`);
      if (!ready) await wait(250);
    }
    check("renderer finished initializing", ready === true);

    /* --- 1 + 2: global search across chats, diacritic-insensitive --------- */
    const res = await run(`(function(){
      const input = document.getElementById('sidebarSearch');
      input.value = 'gio';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const box = document.getElementById('searchResults');
      const list = document.getElementById('convList');
      const first = list.querySelector('.conv-item');
      return {
        hidden: box.hidden,
        items: box.querySelectorAll('.sr-item').length,
        text: box.textContent,
        marked: box.querySelectorAll('mark.search-hit').length,
        itemVisible: !!first && first.getBoundingClientRect().height > 20,
        resultsBelowChats: box.getBoundingClientRect().top >= list.getBoundingClientRect().bottom - 1,
        resultsHeight: Math.round(box.getBoundingClientRect().height)
      };
    })()`);
    check("search for 'gio' finds the 'giờ' note in another chat via snippet", !res.hidden && res.items === 1 && res.text.includes("giờ"), res);
    check("snippet highlights the match", res.marked === 1, res);
    check("sidebar layout: chat rows still visible, results stacked underneath", res.itemVisible && res.resultsBelowChats && res.resultsHeight > 30, res);

    /* --- 3: click a result → jump to the owning chat + flash the message --- */
    await run(`(function(){
      const input = document.getElementById('sidebarSearch');
      input.value = 'tưởng';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    const jump = await run(`(function(){
      const item = document.querySelector('#searchResults .sr-item');
      if (!item) return { found: false };
      item.click();
      const row = document.querySelector('.msg-row[data-id="m2"]');
      return {
        found: true,
        chat: document.getElementById('chatName').textContent,
        flash: !!(row && row.classList.contains('msg-flash')),
        flashed: !!document.querySelector('.msg-row.msg-flash'),
        resultsHidden: document.getElementById('searchResults').hidden,
        box: document.getElementById('sidebarSearch').value,
        chats: document.querySelectorAll('#convList .conv-item').length
      };
    })()`);
    check("diacritic query 'tưởng' matched the folded text", jump.found, jump);
    check("result click switched to the owning chat", jump.chat === "Ideas", jump);
    check("jumped message is flashed/highlighted", jump.flash || jump.flashed, jump);
    check("result panel closes after jumping", jump.resultsHidden, jump);
    check("search resets after jumping (box cleared, every chat listed)", jump.box === "" && jump.chats === 2, jump);

    /* --- 4: in-conversation search keeps markdown intact ------------------- */
    const md = await run(`(function(){
      document.getElementById('searchBar').hidden = false;
      const inp = document.getElementById('msgSearchInput');
      inp.value = 'quan';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      const row = document.querySelector('.msg-row[data-id="m3"]');
      const html = row ? row.querySelector('.bubble').innerHTML : '';
      return {
        strong: !!(row && row.querySelector('strong')),
        marks: row ? row.querySelectorAll('mark.search-hit').length : 0,
        rawSyntax: html.includes('**')
      };
    })()`);
    check("in-chat search marks the hit", md.marks >= 1, md);
    check("markdown survives highlighting (no <strong> loss, no raw ** shown)", md.strong && !md.rawSyntax, md);

    /* --- 5: quick note popup writes to disk + syncs the main window -------- */
    ipcMain.emit("quick:open");
    await wait(1800);
    const qw = quickWindow();
    check("quick-note window opened", !!qw);
    if (qw) {
      const popup = await qw.webContents.executeJavaScript(`(function(){
        const chips = document.querySelectorAll('#chats .chip');
        const note = document.getElementById('note');
        note.value = ${JSON.stringify(NOTE_TEXT)};
        note.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return { chips: chips.length, active: (document.querySelector('.chip.active') || {}).textContent || '' };
      })()`);
      check("popup lists the available chats", popup.chips === 2, popup);
      await wait(1200);

      const data = JSON.parse(fs.readFileSync(F.data, "utf8"));
      const saved = data.messages.find(m => m.text === NOTE_TEXT);
      check("quick note was appended to messages.json", !!saved, data.messages.map(m => m.text));
      check("quick note landed in the chat the app was on (Ideas)", saved && saved.chatId === CHAT_B, saved && saved.chatId);
      check("popup hid itself after saving", !qw.isVisible());

      const shown = await run(`document.getElementById('messages').textContent.indexOf(${JSON.stringify(NOTE_TEXT)}) >= 0`);
      check("main window received the note live (state:changed → render)", shown === true, shown);

      // Shortcut wiring: the accelerator must be registered with the OS.
      const { globalShortcut } = require("electron");
      check("global Ctrl+Alt+N shortcut registered", globalShortcut.isRegistered("CommandOrControl+Alt+N"));
    }
  } catch (e) {
    console.log("EXC " + ((e && e.stack) || e));
    failed = true;
  } finally {
    clearTimeout(guard);
    for (const k of Object.keys(F)) {
      try {
        if (backups[k] !== null) fs.writeFileSync(F[k], backups[k], "utf8");
        else if (fs.existsSync(F[k])) fs.unlinkSync(F[k]);
      } catch {}
    }
    console.log("RESULT " + (failed ? "FAIL" : "PASS"));
    app.exit(failed ? 1 : 0);
  }
});
