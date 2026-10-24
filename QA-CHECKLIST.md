# Loopback QA checklist

Automated checks are listed with the command that runs them. Manual items are Windows-only or need a real
device/profile; do not mark one passed unless it was actually performed on that machine.

## Automated (run from the repository root)

- [ ] `npm test` — 95 pure-logic tests: atomic writes, portable janitor, IPC role policy, external-URL rules,
      feed scheduler, monitor proxy, chat store, data migration, event model/dedupe, watch rules/cooldowns,
      trending baselines, event-density cells, CISA advisory normalization, the situation brief, aggregate
      feed health and cached-headline restoration.
- [ ] `npx electron audittest.js` — opens/closes every window, checks the single region picker, and that
      the hidden workspace opens exactly one window without saving its trigger as a chat message.
- [ ] `npx electron piptest.js` — bubble/bar states, drag, dock, resize, recording HUD.
- [ ] `npx electron captest.js` — screenshot + recording files, `local-file://`, media library.
- [ ] `npx electron rectest.js` — recording presets, fps, bitrate, capture state.
- [ ] `npx electron reviewtest.js` — screenshot review card, save/copy/annotate.
- [ ] `npx electron camtest.js` — camera bubble, pause/resume, camera on/off, burned-in position.
- [ ] `npx electron combotest.js`, `uitest.js`, `hudtest.js`, `menutest.js`, `traytest.js` — PiP, layout,
      HUD, small-window panel fit, tray/background.
- [ ] `npx electron monitortest.js` — feed ownership, cadences, honest OFFLINE/STALE/CACHED states, proxy
      allowlist, and the restart path that restores cached headlines with the right labels (58 checks).
- [ ] `npx electron searchtest.js` — global search, diacritics, in-chat marks, quick note. The global
      `Ctrl+Alt+N` check fails if another running app already owns that shortcut; close that app and rerun
      before treating it as a regression.
- [ ] `npx electron tests/bench-monitor-requests.js 130` — request counter; compare with the numbers in
      README's *Network and the hidden workspace* section (2026-10-23 baseline: 155 total, 78 main, 35 renderer).
- [ ] `npm run build` — produces `dist\Loopback 1.8.0.exe` and `dist\Loopback Setup 1.8.0.exe`.
      The asar must match the working tree (excluding `package.json`, which electron-builder rewrites).

## First run / data

- [ ] Back up `%APPDATA%\messenger-self-chat` before launching a new build on a real profile.
- [ ] First launch creates `meta.json` and `backups\<stamp>\`; the backup contains the old
      `messages.json`/`settings.json`/`quick.json`/`pip.json` and is readable.
- [ ] Existing messages, chats, attachments, voice notes, captures and settings are still present.
- [ ] Messages can be sent, edited, deleted, pinned, searched; the active chat survives a restart.
- [ ] A quick note captured from the popup appears in the main window and survives a restart.
- [ ] Export backup writes a JSON file; a deliberately oversized document shows an error instead of a
      silent loss.

## Chat, bubble and capture

- [ ] File picker, drag-and-drop, pasted clipboard image, voice note, whiteboard image.
- [ ] Markdown links open in the system browser; `javascript:`/`file:`/`data:` links do nothing.
- [ ] Screenshot: region selection, crop, review card, save, copy, reveal, delete.
- [ ] Screen recording: pause/resume, camera on/off, stop/save, playback and seeking in the media library.
- [ ] PiP: S/M/L, vertical/horizontal, drag, dock, collapse/expand, multi-monitor and negative coordinates.
- [ ] Themes: light/dark and all 16 accents; focus rings, contrast, tooltips, narrow window overflow.
- [ ] Tray: close keeps the app running when *Keep running in the tray* is on; open/quit from the tray.
- [ ] Single instance: a second launch focuses/reopens the existing app instead of starting a second one.

## Hidden workspace

- [ ] There is no visible button, tray item, rail icon or README instruction for the workspace.
- [ ] Typing the trigger in the composer opens exactly one window, clears the input, and creates no message.
- [ ] Opening the workspace does not start any feed while it is closed; chat-only use stays idle.
- [ ] Before the first feed answers, the header says STARTING; with a stored session and no live feed it says
      CACHED, never LIVE. A mix of live and failed feeds says DEGRADED, and the tooltip states the counts.
- [ ] TOP SIGNALS and the ticker mark restored headlines CACHED with their age; the first live push removes
      the mark.
- [ ] The Aircraft layer is labelled paused and contains no fabricated aircraft; no request goes to
      `opensky-network.org`.
- [ ] Closing, hiding or minimizing the workspace stops main's scheduler; reopening resumes once.
- [ ] Failed feeds show OFFLINE/STALE, never "no events"; static panels show STATIC with their edit date.
- [ ] Cyber advisories show CISA items with working source links, or an explicit OFFLINE state; WARN means the
      title mentions exploitation/emergency action, not an invented CVSS score.
- [ ] SITREP counts match the EVENTS tab, names each record's source and says it is deterministic; COPY BRIEF
      copies the same text.
- [ ] SAVE on an event detail adds it to SAVED; it survives a reload and stays readable after the live window;
      unsaving removes it.
- [ ] Event Heat draws cells only for geolocated records and its popup says "cached records, not a risk score".
- [ ] EVENTS filters by time/category/severity/source; a row opens details, a source link and (when present)
      centers the map; events without coordinates remain readable.
- [ ] Ctrl/Cmd+K finds a cached headline/event and opens it; typing does not fire network requests.
- [ ] Country brief keeps the static score labelled and adds matching events, headline mentions and coverage.
- [ ] WATCH rules persist, fire once per event, respect the 10-minute cooldown and show history with links.
- [ ] SPACE LAUNCHES shows a real scheduled launch or an explicit unreachable state; no invented countdown.
- [ ] TRENDING requires multiple sources and is labelled as volume, not danger.
- [ ] Monitor links open in the system browser only for `https:`; child windows never open inside the app.

## Packaging (Windows)

- [ ] Run the portable exe from a clean folder; it extracts once to `%TEMP%\loopback-portable` and starts.
- [ ] Install with the NSIS setup, launch from Start Menu, uninstall; user data remains in
      `%APPDATA%\messenger-self-chat`.
- [ ] Start with Windows (`--autostart`) comes up as the floating bubble/tray, with no chat window and no
      workspace feeds.
- [ ] High-DPI display and a second monitor: no clipped bubble, HUD, review card or dialog.

## Known limitations

- The chat is local but **not encrypted**; anyone with access to the Windows account can read the JSON and
  attachments.
- The hidden workspace is a UI secret only. The source is public, so it is not a security boundary.
- Global hotkey registration is best-effort; another app owning `Ctrl+Alt+N` does not break the ⚡ button.
