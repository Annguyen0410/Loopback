# Loopback

> Renamed from **Messenger Self-Chat** in **v1.3.9** (the old name collided with
> Meta's "Messenger" and read like a half-finished feature).

A small **Electron desktop app** that looks like Facebook Messenger, but it's
just you — a private notebook styled as a chat-to-self, with full **file
attachment** support, a **16-theme** design system, rich **markdown**, and a
**floating always-on-top chat bubble** (PiP).

Type a message → it goes to disk. Drop a file → it copies to a local
`files/` folder. Close the app, reopen it, everything is still there. No
server, no network, no account, no cloud.

---

## Quick start

```bash
# from the project folder (e.g. D:\Code folder\Messenger)
npm install        # first time only — pulls Electron (~90MB)
npm start          # launch the desktop app
```

That opens the Loopback window. Type into the bottom input and hit
**Enter** to drop a note. In the chat, type `/world` to open the fullscreen
World Monitor.

---

## Build & update the desktop app

The project is already an Electron app — `npm start` runs it directly. When
you change code, **rebuild + reinstall** to update the installed copy:

```bash
npm run build      # electron-builder → creates installers in dist/
```

A build also creates a `dist/win-unpacked/` folder (a few hundred MB). It is
only needed for debugging — delete it after building to save space.

Outputs in `dist/`:

| File | Purpose |
| --- | --- |
| `Loopback Setup <ver>.exe` | NSIS installer — installs with Start-menu + desktop shortcuts |
| `Loopback <ver>.exe` | Portable build — copy & run, no install |

**Update an existing install:**

```powershell
# from PowerShell, inside the project folder:
& ".\dist\Loopback Setup <ver>.exe"

# silently (no UI) — e.g. from a script:
Start-Process ".\dist\Loopback Setup <ver>.exe" -ArgumentList "/S" -Wait
```

From **Git Bash** the `/S` switch is path-mangled, so pass it as `//S` (or run
with `MSYS2_ARG_CONV_EXCL='*'`). Only one setup instance can run at a time: if an
earlier one is still alive the next launch exits with code `2`, so close the app
and any leftover *Loopback Setup* process first — then check
`(Get-Item "$env:LOCALAPPDATA\Programs\Loopback\Loopback.exe").VersionInfo.ProductVersion`
to confirm, and delete `dist\Loopback*<old version>*` afterwards.

For the **same** `appId` the installer **overwrites the old version in place**
(same shortcut, same folder). v1.3.9 changed the `appId` for the rename, so that
one jump needs the old *Messenger Self-Chat* install uninstalled first —
electron-builder treats a different `appId` as a different app and would install
side by side. Your data is **never touched** by install/uninstall: notes live in
`%APPDATA%\messenger-self-chat`, outside the app folder. The data folder keeps
that legacy name on purpose — it follows the `name` field in `package.json`, not
`productName`; renaming `name` would make the app look like it lost every note.

**Check which version is installed:**

```powershell
(Get-Item "C:\Users\nguye\AppData\Local\Programs\Loopback\Loopback.exe").VersionInfo.ProductVersion
```

Build only a portable exe (faster, no installer):

```bash
npx electron-builder --win portable
```

First build downloads the code-signing + NSIS toolchain (~100MB); later
builds are quick. If a build fails because `assets/` is missing, create an
empty folder: `mkdir assets`.

---

## Features

- **Messenger-style UI**: dark rail, conversation sidebar, blue bubbles, day dividers
- **16 chat themes** — Blue, Purple, Pink, Green, Orange, Red, Teal, Gradient,
  Sunset, Ocean, Forest, Candy, Mono, Galaxy, Aurora (animated wallpaper), Coffee
- **Rich markdown** in messages — tables, task lists `- [x]`, ordered lists,
  blockquotes, headings, `hr`, images, code blocks, bold/italic/strike/links
- **Floating chat bubble (PiP)** — a tiny always-on-top bubble, expands into a
  full mini-chat, toggles **vertical** (bookmark tab) / **horizontal** (pill),
  and has an adjustable size (Settings → S/M/L). Dragging it only moves it —
  the chat opens on a click (a drag never expands it). The vertical tab is
  **five round buttons in one straight column** — open chat, screenshot,
  record, media library, recording settings — each with a tooltip, sized so
  they fit the 56px-wide window (and the 42px one at 0.75 scale) exactly
- **It behaves like a real app window** — the ⤢ button in the chat header (or a
  double-click on the header) fills the whole work area and, while maximized,
  stops being always-on-top and takes a taskbar slot like any other window;
  press it again to shrink back to the size you had. The corner grip still
  free-resizes, and **minimizing collapses straight to the floating bar in the
  same tick** — no intermediate half-sized window, no second click
- **The bar can be waiting for you** — with *Show the bar when the app starts*
  on, the floating bar is already on screen (docked to the left or right edge,
  *Dock to*) when the app opens, and **minimizing the app brings it straight up**
  (*Minimizing shows the bar*). *Start with Windows* registers the app as a
  login item, so the bar is there after a reboot too
- **Drag & drop files onto the bubble** to attach them instantly
- **Realtime sync between windows** — messages, chats and theme changes made
  in one window appear in the other immediately
- **Multiple self-chats** — seeded with Notes to Self / Ideas / Tasks;
  create, rename, delete or pin each one from the ⋯ menu
- **Attach any file type** — images, PDFs, docs, audio, video, archives, code
- Inline previews: images thumbnails, audio/video players, styled cards for everything else
- **Voice messages** (mic recording) and **whiteboard** drawing → sent as files
- **Message actions menu** (right-click a message, or its ⋯ hover button):
  React, Reply, Copy, Copy Markdown, Save File, Pin, Edit, Delete — placed
  from the real element size so it flips and clamps instead of running off
  the window edge, follows the message while you scroll, and is keyboard
  driven (`↑`/`↓`, `Enter`, `Esc`)
- **Message reactions** with flying-emoji animation, edit, delete, pin, reply
- **Accurate copy** — "Copy" gives clean plain text, "Copy Markdown" keeps the
  raw syntax; bubble text is selectable
- Keyboard: `Enter` send, `Shift+Enter` newline, `Esc` dismiss, `Ctrl/Cmd+F` in-chat search, `Ctrl/Cmd+Shift+F` global (all chats) search, `Ctrl/Cmd+Alt+N` quick note; in the sidebar search `↑`/`↓` pick a result and `Enter` opens it
- **Global search across every chat** — the sidebar box (or `Ctrl+Shift+F`) searches
  all messages and attachment names, shows snippets with the match highlighted,
  and jumps straight to the message (which pulses briefly) in its own chat.
  Matching ignores Vietnamese accents, so `gio` finds `giờ` and `cafe` finds `café`.
- **Quick note popup** — a global `Ctrl+Alt+N` hotkey anywhere in the OS opens a
  small always-on-top capture box: type, `Enter`, done (Esc / click-away closes).
  Notes land in the chat you were last in and appear live in the main window.
  Also on the ⚡ rail button.
- **Screenshot + screen recorder** on the rail (and in the bubble header):
  drag-select a region, or record the screen with mic + camera and a floating
  HUD (Mic / Cam / Pause / Discard / Stop). Everything lands in the **media
  library** with inline playback. Taking a screenshot **parks the floating
  bubble and the camera bubble just off every display** for the grab and puts
  them straight back, so a selection that crosses the pill captures what is
  behind it, never the pill itself.
- **Mini recording panel in the floating menu** (⚙ on the pill or in the bubble
  header): quality **SD / HD / FHD**, **30 / 60 fps**, show-or-hide the mouse
  cursor, and pick exactly which **camera** and **microphone** to use — no trip
  through the full Settings panel. Choices are saved and apply to the next
  recording; device names appear once the app has had mic/camera access once.
- **Smooth recordings**: the frame pump runs on a fixed interval rather than
  `requestAnimationFrame`, the recording window is kept unthrottled and the
  display awake while it runs, the encoder gets a `motion` content hint, and the
  bitrate follows the preset (60 fps gets double the 30 fps budget). Screen
  capture no longer stalls just because you switched to another app.
- **Camera bubble in the recording** — viewers see your camera burned into the
  video. Drag the live preview to move it, double-click (or the S/M/L badge) to
  resize; the position is remembered. Turning the camera off in the HUD really
  releases the device, so the camera light goes out (and the bubble disappears
  from the video), then back on mid-recording when you want it.
- **Floating camera bubble when you record from the bubble** — hit record on the
  floating bar (collapsed tab or expanded mini-chat) and a small always-on-top
  camera window appears on the desktop: drag it anywhere, click its S/M/L badge
  to resize. Wherever you park it is exactly where the camera lands in the
  video, and it is excluded from capture itself (the collapsed bar has no room
  for the in-app preview, so this is the control instead).
- **Pause / resume** a recording without stopping it — the timer holds while paused.
- **The app keeps itself out of recordings** (default on, toggle in Settings)
  so viewers see your screen plus the camera bubble, never the floating bar,
  HUD or live preview. The floating bubble is deliberately **not**
  content-protected while it is idle: on Windows builds that cannot exclude a
  window from capture, `setContentProtection` paints it as an opaque **black
  rectangle** instead of hiding it (electron#45990 / #46180 / #47834), which
  turned the floating pill into a black box with no visible buttons. Protection
  is applied only for the duration of a recording and always released after it.
- **Minimize into the floating bar** — the ⬛ rail button puts the app away:
  the chat window is hidden (taskbar entry included, so only the bubble is
  left), and the bar sits docked and collapsed on the side. The bubble shows a
  one-line tip with the way back; tapping it opens the chat popup, launching the
  app again restores the window, and closing the bar brings the chat window
  back automatically (so the app is never left with nothing on screen)
- **Subdued palette** — every theme keeps its hue (`--accent-key`) but the
  colour the UI actually paints with is mixed toward a neutral slate
  (`--accent: color-mix(in srgb, var(--accent-key) 64–68%, #6f7681)`, with
  hover/pressed derived from that), so all 16 themes are noticeably calmer:
  measured saturation drops from 1.00 → 0.68 (blue), 0.91 → 0.52 (purple),
  0.67 → 0.41 (forest). Surfaces, borders and shadows are softer too, and the
  floating bar uses a soft gradient instead of a flat neon fill
- **Readable in every theme** — text on an accent fill uses a per-theme pair of
  tokens (`--on-accent`, `--accent-solid`, plus `--pill-shift` for the direction
  the bar's gradient fades in), so a mid-tone hue like green/teal takes dark ink
  and a dark one like mono/coffee keeps white. Message bubbles were darkened
  until the white text clears WCAG AA at *both* ends of the gradient (worst
  theme went from **2.5:1 to 4.6:1**). `audittest.js` measures this on the
  rendered styles for all 16 themes × light/dark
- **Panels stay aligned and readable at any width** — Settings, the recording
  panel and the media library share one shell: a two-column grid (label left,
  control right) whose control column never shrinks, so toggles and segment
  pickers all end on the same edge, segment labels are never clipped, and hints
  stay 12px with AA contrast (7.5:1 hints, 13.7:1 labels). Below 440px they go
  full-bleed and tighten their padding instead of jumbling
- Search sidebar, export JSON backup, open data folder, single-instance lock

## Where data lives

```
C:\Users\<you>\AppData\Roaming\messenger-self-chat\
├── messages.json    # chats + messages (each message has a chatId)
├── settings.json    # dark mode + theme + bubble size + floating-bar options
│                    #   (pipOnStartup, pipOnMinimize, pipDock, startAtLogin)
├── pip.json         # bubble orientation (vertical/horizontal) + position
├── quick.json       # quick-note target chat
├── error.log        # last main-process errors (see "Notes")
├── files\           # attached file contents (UUID-named)
└── voice\           # recorded voice messages (UUID-named)
```

## Project layout

| Path                    | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `main.js`               | Electron main — windows, PiP, IPC, JSON I/O, file storage, realtime broadcast |
| `preload.js`            | contextBridge — exposes a safe `window.api` + `window.monitorApi` |
| `index.html`            | Messenger UI markup                                            |
| `styles.css`            | 16 themes, animations, markdown styles, PiP bubble             |
| `src/renderer/`         | Renderer logic, split into ES modules by feature (see below)   |
| `monitor.html/js/css`   | World-monitor fullscreen window (Launched with `/world`)        |
| `monitor-preload.js`    | Preload for the monitor window                                  |
| `quick.html/js`         | Quick-note capture popup (global `Ctrl+Alt+N`)                  |
| `cam.html/js/preload`   | Floating camera bubble (while recording from the floating bar)   |
| `quick-preload.js`      | Preload for the quick-note popup (chats + save only)            |
| `package.json`          | `electron` devDependency, `npm start` runs it                   |

`src/renderer/` is organized as plain ES modules (no bundler needed):

| Module           | Responsibility                                          |
| ---------------- | ------------------------------------------------------- |
| `main.js`        | Entry point — loads persisted data, wires all modules, PiP mode |
| `state.js`       | Shared `state` / `settings` / ephemeral UI registries   |
| `dom.js`         | `$` selector, `onReady`, floating popup placement (`placePopup`) |
| `utils.js`       | Pure helpers (uid, escape, bytes, dates, plainText)     |
| `toast.js`       | Toast notifications                                     |
| `dialog.js`      | In-app prompt/confirm modals (Electron has no window.prompt) |
| `settings.js`    | Dark mode / 16 themes / settings panel / bubble size, dock & startup |
| `messages.js`    | Message rendering, add/edit/delete, pinning, read state, realtime save |
| `search.js`      | Global cross-chat search, `markRow`/`flashMessage` shared with the in-chat search |
| `interactions.js`| Context menu, reactions + fly-emoji, edit modal, search  |
| `composer.js`    | Text input, send, attach, typing indicator              |
| `dragdrop.js`    | Drag-and-drop file handling (via `webUtils`)             |
| `voice.js`       | Voice message recording (MediaRecorder)                  |
| `canvas.js`      | Whiteboard: pen/eraser, send as image                    |
| `sidebar.js`     | Conversation list preview                               |
| `capture.js`     | Screenshots + screen recorder (HUD, pause, preview drag, quality presets) |
| `recprefs.js`    | Mini recording panel (⚙ in the floating menu) + device pickers |
| `pip.js`         | Floating-bubble helpers (grow the bubble before a panel covers it) |
| `camera.js`      | Camera device lifecycle + camera-bubble geometry         |
| `gallery.js`     | Media library (screenshots + recordings)                |
| `emoji.js`       | Emoji picker                                            |
| `markdown.js`    | Full markdown renderer (tables, tasks, quotes, images)  |

## Notes

- The renderer has `contextIsolation: true` and no Node access — all disk I/O
  happens in the main process via IPC. Safe default.
- A custom `local-file://` protocol serves file bytes back to the renderer so
  images can render inline without exposing the filesystem. It resolves names
  across `files/`, `voice/` **and** `captures/` (whichever actually holds the
  file) and answers byte ranges with `206 + accept-ranges`, which is what lets
  a screen recording seek/play in the media library.
- The region-screenshot overlay is re-sized to the **display bounds** right
  after it is created: Windows clamps a fresh window to the *work area*, which
  left the picker 48px short of the screen it had just grabbed (the taskbar
  strip could not be selected, and the overlay no longer matched the captured
  pixels).
- `window.prompt` / `window.confirm` are **not supported in Electron** — the
  app ships its own `dialog.js` modals instead.
- The PiP bubble window is transparent, frameless, always-on-top, and
  throttled (`spellcheck: false`, `backgroundThrottling: true`) to stay light.
  It is **born at the size it will be used at**: opening the floating chat
  creates the window already expanded and centred (and main answers the
  renderer's `pip:getState()` pull, because the `pip:state` push can arrive
  before the renderer's listener exists), so the chat never starts up squeezed
  into a 56×248 pill.
- Realtime sync replays saved state into every other open window; the main
  process filters out the sender to avoid loops.
- The quick-note popup writes through the **main process** (`note:append`) and
  then replays the fresh state into every other window, so a stale renderer can
  never overwrite a note captured while the window was hidden.
- The global hotkey is registered best-effort: if another app already owns
  `Ctrl+Alt+N` the ⚡ rail button still opens the popup (a warning is logged).
- `audittest.js` (`npx electron audittest.js`) is the "is the app healthy and
  ready to use?" sweep: opens and closes **every** window (side panels, the
  floating bar in all its states, the monitor, the quick note, the screenshot
  picker), fails on any renderer console error, checks that every `api.*` path
  the renderer calls exists on the live bridge (a typo there is a button that
  silently does nothing) and that every DOM id it looks up exists in the
  document (a renamed id is a dead control; this is how a welcome block that
  deleted itself on the first render was found), that the theme picker and the
  stylesheet agree, that all 16 themes stay readable in light and dark, that
  nothing was written to `error.log`, and that no window is left behind. Set
  `AUDITTEST_USERDATA=<dir>` to run it against a throwaway profile.
- `combotest.js` (`npx electron combotest.js`) is the **combination** suite:
  every other file proves one feature works alone, this one uses them *at the
  same time*. It opens the chat window, the floating popup, all three side
  panels, the quick note and the monitor together; sends a message from the
  popup and back, a burst of 10 in one go; switches theme (and re-measures
  contrast in the popup); hammers collapse/expand ×6, flip, maximise/restore,
  dock and Esc while everything is open; starts a **real recording from the
  collapsed bubble**, then tucks the app away, opens + cancels the screenshot
  picker and expands the popup *during* that recording before stopping and
  saving it; parks both floating bubbles out of frame for a region grab (and
  checks `pip.json` is not rewritten); plays the fresh recording back from the
  media library while searching and deleting from it; then tucks, relaunches
  and closes the bar. Fails on any renderer error and on any `error.log` entry.
  Set `COMBOTEST_USERDATA=<dir>` for a throwaway profile.
- `searchtest.js` (`npx electron searchtest.js`) smoke-tests global search +
  quick capture against the real app and restores your data afterwards.
- `monitortest.js` (`npx electron monitortest.js`) exercises the `/world`
  World Monitor's realtime contract: the Finance tab survives one dead feed
  (each section owns its OFFLINE state instead of a blanket catch blanking the
  tab), its self-update timers exist at the right cadences (crypto 3m,
  Fear & Greed 5m, Polymarket prediction markets 2m, World Bank macro 60m),
  the INFRA port-weather table re-polls every 5 minutes, unreachable GDACS /
  GDELT / IODA feeds say "unreachable — retrying…" instead of faking a quiet
  world, GDELT's `seendate` renders a real date, and the threat log timestamps
  in UTC like the events log beside it.
- The collapsed bubble is a real 56×248 (vertical) or 280×52 (horizontal)
  window, so its in-window UI adapts: the recording HUD drops to icon-only
  controls under 400px wide, stacks vertically in the narrow bubble, and
  toasts get a short caption — nothing is sliced off at the window edges.
- `hudtest.js` (`npx electron hudtest.js`) smoke-tests exactly that: it builds
  all three bubble-sized windows (vertical 56×248, horizontal 280×52 and the
  42×186 one that `pipScale 0.75` produces), shows the HUD + a toast and checks
  every control stays inside — including the pill itself: five round buttons
  must sit in **one straight column** (a wrapped second column lands outside
  the window, which is how the tools used to vanish) with a real hit target and
  a title. In the short bubble the toast has no room beside the stacked HUD, so
  it is suppressed rather than drawn over the pause/discard/stop buttons.
- `piptest.js` (`npx electron piptest.js`) also proves screenshots stay clean:
  it parks the bubble, opens the real region picker, asserts the bubble is off
  every display and back afterwards with a matching viewport, then takes an
  actual screenshot of a rect over a solid **magenta** backdrop window and
  checks the saved crop is still 100% magenta.
- `rectest.js` (`npx electron rectest.js`) smoke-tests the mini recording panel
  and the smoothness work: it opens the ⚙ from the floating menu, changes
  quality / fps / cursor, then records through the real pipeline with **no
  `requestAnimationFrame` at all** (what a throttled window looks like) and
  checks the frames keep moving, the frame is 480p, the capture stream really
  runs at 60 fps, the encoder bitrate follows the preset, the cursor setting
  reaches `getDisplayMedia`, and the unthrottled state is released afterwards.
- `captest.js` (`npx electron captest.js`) records a real clip through the
  app, then checks `local-file://` serves it (200/206/404), that `<img>` loads
  from `captures/` and that the media-library preview really plays it.
- The floating camera bubble (`cam.html`) is excluded from capture and is fed
  frames (JPEG, ~8fps) from the recording window, which already holds the
  camera stream — no second `getUserMedia`, so the hardware is opened once.
- Run `camtest.js` with `CAMTEST_USERDATA=<dir>` for deterministic geometry:
  it persists the camera position in the profile it runs against, so repeated
  runs against your real profile drift the floating camera bubble and a few
  position checks then fail.
- `camtest.js` (`npx electron camtest.js`) smoke-tests the camera in a
  recording without touching hardware (canvas streams stand in for the screen
  and camera): it reads real pixels out of the recorded frames to prove the
  camera is burned in where the preview shows it, that dragging moves it, that
  camera-off **stops the track** (LED out) and re-opens it on demand, that a
  camera which disappears on its own flips to off, and that pause really holds.
  Same run also guards the audio rule below. It covers **both flows**: the
  in-app preview (drag/resize/pause/release) and recording started from the
  floating bar, where it opens the floating camera window, checks live frames
  arrive, drags it on the desktop and verifies the burned bubble lands exactly
  there — then that camera-off says "Camera off" and stopping closes it.
- A recording never mixes in an audio track that has no real source behind it:
  a silent mixer destination makes the WebM muxer emit empty blobs, i.e. a
  recording that "saves" nothing.
- `menutest.js` (`npx electron menutest.js`) smoke-tests the message menu:
  edge clamping/flipping, item filtering, keyboard nav, follow-on-scroll and
  the sidebar ⋯ menu — including a PiP-sized 380×300 window. Set
  `MENUTEST_USERDATA=<dir>` to run it against a throwaway profile. It also
  compresses a window to 380×300 and 320×420 and measures the three side
  panels there: inside the window, one label column / one control column
  (nothing overlapping), toggles and pickers on a single right edge, no clipped
  segment label, hints ≥12px and AA contrast against the panel surface — plus a
  palette check that every theme accent really is less saturated than its raw
  hue.
- `piptest.js` also covers the window behaviour: maximize fills the work area
  and its layout follows, restore returns the previous size, **collapse lands on
  the bar within the same tick** (an animated shrink used to walk through every
  intermediate size), `pip:openbar` opens the bar collapsed and docked flush to
  an edge, minimizing the app brings that bar up right away, and **launching the
  app again after the chat window was closed rebuilds it** (see below) instead
  of dying on a dead window handle.
- Closing the chat window while the floating bar is open does **not** quit the
  app — the bar stays. That is a normal state, so `main.js` never keeps a
  destroyed `BrowserWindow` around: the variable is cleared on `closed`, every
  window reference is checked before use, and `createWindow()` is idempotent
  (it focuses the window when it exists, builds it when it does not). Starting
  the app a second time therefore always brings the chat window back. Touching a
  destroyed window used to surface as Electron's modal *"A JavaScript error
  occurred in the main process — TypeError: Object has been destroyed"* dialog.
- A last-resort `uncaughtException` / `unhandledRejection` handler writes stray
  main-process errors to `error.log` in the data folder (trimmed at 256 KB)
  instead of showing that modal dialog to the user.
- CSP allows only same-origin + the data sources the monitor needs.
- UI is responsive — drag the window narrow and the sidebar collapses.
- Renderer code is split into ES modules under `src/renderer/`; no bundler —
  Electron >= 28 loads native ES modules directly via `<script type="module">`.
