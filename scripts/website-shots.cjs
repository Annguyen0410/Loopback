/*
 * Capture the real Loopback windows for the product website.
 *
 *   npx electron scripts/website-shots.cjs
 *
 * It boots a throwaway profile (never your own data), seeds a small realistic
 * conversation, and saves screenshots of the actual running app into
 * website/assets/shots/. Nothing is drawn by hand: every image is a capture of
 * an Electron window, so the website cannot show a feature that does not exist.
 *
 * The media library is photographed after two genuine captures have been taken
 * by this same process, so its thumbnails are real files from captures\.
 */
const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "website", "assets", "shots");
const PROFILE = process.env.WEBSHOT_USERDATA || path.join(ROOT, ".test-runs", "website-profile");

fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.mkdirSync(path.join(OUT, "themes"), { recursive: true });
fs.mkdirSync(path.join(PROFILE, "files"), { recursive: true });
fs.mkdirSync(path.join(PROFILE, "captures"), { recursive: true });
fs.mkdirSync(path.join(PROFILE, "automation"), { recursive: true });
/* Tell the one-way TaskOrbit import that this throwaway profile is settled, so a
   website capture never copies the developer's real automation vault. */
fs.writeFileSync(path.join(PROFILE, "automation", "migration.json"), JSON.stringify({
  ok: true, source: null, reason: "website-capture", at: new Date().toISOString()
}, null, 2));

app.setPath("userData", PROFILE);
/* Crisp captures: the window is laid out at CSS pixels, the PNG/JPEG is 2x. */
app.commandLine.appendSwitch("force-device-scale-factor", "2");

const now = Date.now();
const chats = [
  { id: "chat-notes", name: "Notes to Self", pinned: true, createdAt: now - 9000 },
  { id: "chat-ideas", name: "Ideas", pinned: false, createdAt: now - 8000 },
  { id: "chat-tasks", name: "Tasks", pinned: false, createdAt: now - 7000 }
];

const plan = [
  "# Q4 planning",
  "",
  "- [x] Close the October loop",
  "- [ ] Pick the one thing for November",
  "- [ ] Book the room for the workshop"
].join("\n");
fs.writeFileSync(path.join(PROFILE, "files", "q4-plan.md"), plan);

const messages = [
  {
    id: "m1", chatId: "chat-notes", text: "Morning check-in\n\nSlept six hours. Talked to Hà about the workshop — she is in if we keep it to twenty people.\n\n- [x] Confirm the room\n- [ ] Send the reading list\n- [ ] Ask about the projector",
    files: [], createdAt: now - 1000 * 60 * 214, read: true, reactions: {}, pinned: false, edited: false
  },
  {
    id: "m2", chatId: "chat-notes", text: "The thing I keep forgetting: renew the domain before the 30th.\n\nAnd the checkout bug is not the cache — it is the stale token.",
    files: [], createdAt: now - 1000 * 60 * 208, read: true, reactions: {}, pinned: true, edited: false
  },
  {
    id: "m3", chatId: "chat-notes", text: "Q4 plan, so I stop rewriting it in my head every morning.",
    files: [{ storedName: "q4-plan.md", name: "Q4-plan.md", size: Buffer.byteLength(plan), category: "file" }],
    createdAt: now - 1000 * 60 * 196, read: true, reactions: {}, pinned: false, edited: false
  },
  {
    id: "m4", chatId: "chat-notes", text: "Reminder for tomorrow: **do not** schedule anything before 10. The first two hours are the only ones that are really mine.",
    files: [], createdAt: now - 1000 * 60 * 120, read: true, reactions: {}, pinned: false, edited: true
  },
];

const settings = {
  darkMode: false,
  theme: "blue",
  pipScale: 1,
  pipDock: "left",
  pipOnStartup: false,
  pipOnMinimize: true,
  runInBackground: true,
  startAtLogin: false
};

fs.writeFileSync(path.join(PROFILE, "messages.json"), JSON.stringify({
  chats,
  messages,
  activeChatId: "chat-notes"
}, null, 2));
fs.writeFileSync(path.join(PROFILE, "settings.json"), JSON.stringify(settings, null, 2));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findWindow(predicate) {
  return BrowserWindow.getAllWindows().find((win) => {
    if (win.isDestroyed()) return false;
    try { return predicate(win.webContents.getURL()); } catch { return false; }
  });
}

const findChat = () => findWindow((url) => url.includes("index.html") && !url.includes("pip=1"));
const findPip = () => findWindow((url) => url.includes("pip=1"));

async function waitFor(fn, tries = 60, ms = 250) {
  for (let i = 0; i < tries; i++) {
    const value = await fn();
    if (value) return value;
    await wait(ms);
  }
  return null;
}

async function appReady(win) {
  for (let i = 0; i < 40; i++) {
    const ready = await win.webContents.executeJavaScript("document.body.classList.contains('app-ready')").catch(() => false);
    if (ready) return true;
    await wait(200);
  }
  return false;
}

/** Save a capture as JPEG at an exact target width (aspect preserved). */
async function saveJpeg(win, name, width, quality = 84) {
  const image = await win.webContents.capturePage();
  const size = image.getSize();
  const scaled = width && size.width !== width ? image.resize({ width, quality: "best" }) : image;
  const target = path.join(OUT, name.endsWith(".jpg") ? name : name + ".jpg");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, scaled.toJPEG(quality));
  const final = scaled.getSize();
  console.log(`shot  ${path.relative(ROOT, target)}  ${final.width}x${final.height}`);
  return final;
}

async function savePng(win, name, width) {
  const image = await win.webContents.capturePage();
  const size = image.getSize();
  const scaled = width && size.width !== width ? image.resize({ width, quality: "best" }) : image;
  const target = path.join(OUT, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, scaled.toPNG());
  const final = scaled.getSize();
  console.log(`shot  ${path.relative(ROOT, target)}  ${final.width}x${final.height}`);
  return final;
}

require(path.join(ROOT, "main.js"));

app.whenReady().then(async () => {
  try {
    const chat = await waitFor(findChat, 60, 250);
    if (!chat) throw new Error("chat window never appeared");
    if (!(await appReady(chat))) throw new Error("chat window never became ready");
    await wait(900);

    chat.setContentSize(1440, 900);
    await wait(500);

    await saveJpeg(chat, "chat-blue", 1440, 86);
    await saveJpeg(chat, "themes/blue", 1200, 84);

    /* A real capture of the real window, stored in the app's own library. */
    const firstShot = await chat.webContents.capturePage();
    fs.writeFileSync(path.join(PROFILE, "captures", "12-11-2026_09-14-02-shot.png"), firstShot.toPNG());

    /* ---- all sixteen themes (light), exactly as the theme picker sets them */
    const order = ["blue", "purple", "pink", "green", "orange", "red", "teal", "gradient",
      "sunset", "ocean", "forest", "candy", "mono", "galaxy", "aurora", "coffee"];
    for (const theme of order) {
      await chat.webContents.executeJavaScript(`(() => {
        const dot = document.querySelector('.theme-dot[data-theme=${JSON.stringify(theme)}]');
        if (!dot) return false;
        dot.click();
        return true;
      })()`);
      await wait(420);
      if (theme !== "blue") await saveJpeg(chat, `themes/${theme}`, 1200, 82);
    }

    /* ---- dark mode in the Blue theme */
    await chat.webContents.executeJavaScript(`document.querySelector('.theme-dot[data-theme="blue"]').click()`);
    await wait(300);
    await chat.webContents.executeJavaScript("document.getElementById('btnDarkToggle').click()");
    await wait(600);
    await saveJpeg(chat, "chat-dark", 1200, 84);
    await chat.webContents.executeJavaScript("document.getElementById('btnDarkToggle').click()");
    await wait(450);

    /* ---- settings panel */
    await chat.webContents.executeJavaScript("document.getElementById('btnSettings').click()");
    await wait(700);
    await saveJpeg(chat, "chat-settings", 1200, 84);
    await chat.webContents.executeJavaScript("document.getElementById('btnCloseSettings').click()");
    await wait(500);

    /* A second real capture so the library is not empty. */
    const secondShot = await chat.webContents.capturePage();
    fs.writeFileSync(path.join(PROFILE, "captures", "13-11-2026_16-40-51-shot.png"), secondShot.toPNG());

    /* ---- media library */
    await chat.webContents.executeJavaScript("document.getElementById('btnMedia').click()");
    await wait(1200);
    await saveJpeg(chat, "chat-media", 1200, 84);
    await chat.webContents.executeJavaScript("document.getElementById('btnCloseMedia').click()");
    await wait(400);

    /* ---- floating bar, collapsed and opened */
    ipcMain.emit("pip:openbar", {}, "left");
    const pip = await waitFor(findPip, 40, 200);
    if (pip) {
      await appReady(pip);
      await wait(700);
      await savePng(pip, "bar-vertical.png", 168);
      ipcMain.emit("pip:expand");
      /* The expand is animated in main; wait for the real window bounds, not a guess. */
      for (let i = 0; i < 40; i++) {
        const size = pip.getContentSize();
        if (size[1] >= 600) break;
        await wait(150);
      }
      await wait(900);
      /* The popup opens at ~50% of the work area; a fixed, supported size gives
         the site a consistent, readable plate. */
      pip.setContentSize(430, 700);
      await wait(900);
      await saveJpeg(pip, "pip-chat", 860, 84);
    } else {
      console.log("warn  floating bar window never appeared");
    }

    /* ---- world monitor (hidden workspace) */
    ipcMain.emit("monitor:open");
    const monitor = await waitFor(() => findWindow((url) => url.includes("monitor.html")), 80, 250);
    if (monitor) {
      await wait(6500); /* give the first feed cycle a chance to paint */
      await saveJpeg(monitor, "monitor", 1600, 84);
      monitor.close();
    } else {
      console.log("warn  monitor window never appeared");
    }

    /* ---- TaskOrbit automation workspace.
       main.js deliberately skips automation init in a test boot (so a smoke test
       never touches a real vault), so this capture initialises it against the
       throwaway profile before opening the window. */
    const automationHost = require(path.join(ROOT, "src", "main", "automation-host.js"));
    try {
      await automationHost.init({
        iconPath: path.join(ROOT, "assets", "icon.png"),
        getAccent: () => "blue",
        getLocale: () => "en"
      });
      await wait(1200);
      automationHost.open();
    } catch (error) {
      console.log("warn  automation workspace failed to initialise: " + (error && error.message || error));
    }
    const automation = await waitFor(() => findWindow((url) => url.includes("automation.html")), 80, 250);
    if (automation) {
      const painted = await waitFor(async () => {
        const text = await automation.webContents.executeJavaScript("document.body.innerText.slice(0, 400)").catch(() => "");
        return text && !/Loading\.\.\./.test(text) ? text : null;
      }, 40, 500);
      if (!painted) console.log("warn  automation page is still loading");
      automation.setContentSize(1600, 1000);
      await wait(1200);
      await saveJpeg(automation, "automation", 1600, 84);
      automation.close();
    } else {
      console.log("warn  automation window never appeared");
    }

    console.log("done");
  } catch (error) {
    console.error("failed: " + (error && error.stack || error));
    process.exitCode = 1;
  } finally {
    setTimeout(() => app.quit(), 300);
  }
});
