# Architecture

This is the working map for Loopback 1.9.10. The goal is one desktop app with
clear ownership: chat, capture, monitor and the integrated TaskOrbit workspace
share one tray, one installer and one user-data root, but do not reach into each
other's storage or windows.

## Layers

```text
main.js                         Electron lifecycle, windows, IPC registration
│
├── src/main/                  main-process policy and persistence
│   ├── security.js            URL validation / internal-page rules
│   ├── ipc-policy.js          role → channel / permission matrix
│   ├── atomic-write.js        crash-safe file replacement
│   ├── store.js               one chat-document owner + revision guard
│   ├── store-migrations.js    verified first-run backup
│   ├── portable-janitor.js    cleanup of old portable extraction
│   ├── monitor-proxy.js       allowlisted feed proxy
│   ├── monitor-scheduler.js   one owner per feed
│   ├── automation-host.js     TaskOrbit lifecycle bridge
│   ├── automation-window.js   the workspace window
│   └── automation-migrate.js  one-way old TaskOrbit vault import
│
├── src/renderer/              chat UI, split by feature (no bundler)
├── src/monitor/               hidden World Monitor page modules
├── src/shared/text.mjs        pure text/format helpers (no DOM, no Electron)
├── src/automation/            TaskOrbit TypeScript source
│   ├── shared/                IPC contract and shared types
│   ├── main/                  services, DB, scheduler, vault
│   ├── preload/               automation bridge
│   └── renderer/              React workspace
│
├── automation-main/           generated TaskOrbit main bundle
├── automation-ui/             generated TaskOrbit renderer bundle
├── monitor.html/js/css        monitor page
├── index.html/styles.css      chat page and themes
└── tests/                     pure Node tests; root *.js are Electron E2E suites
```

The root `main.js` is deliberately the composition root. New cross-cutting
policy belongs in `src/main/`; new chat behaviour belongs in `src/renderer/`; a
new TaskOrbit service belongs in `src/automation/main/services/` and must cross
the IPC boundary through `src/automation/shared/ipc-channels.ts`.

## Ownership rules

1. **One writer per data domain.** Chat data is owned by `store.js`; TaskOrbit
   data is owned by its SQLite vault under `<userData>/automation/`. Neither
   module writes the other's files.
2. **Windows are untrusted.** The IPC guard derives a role from the URL that
   actually loaded, checks the main frame, and applies the channel table in
   `src/main/ipc-policy.js`. A renderer cannot claim a role.
3. **Only the main process touches disks and OS APIs.** Preload bridges expose
   narrow methods; no renderer gets `require`.
4. **Generated bundles are not edited.** Change `src/automation/`, then run
   `npm run build:automation`. The root `automation-main/` and `automation-ui/`
   directories are build output.
5. **Shared pure code stays pure.** `src/shared/text.mjs` has no DOM/Electron
   imports so it can run under plain Node; renderer-only helpers such as `esc`
   and `uid` stay in `src/renderer/utils.js`.

## Data roots

| Data | Location | Owner |
| --- | --- | --- |
| chats / attachments / voice / captures | `%APPDATA%\messenger-self-chat` | chat main process |
| settings / PiP state | same root, `settings.json` / `pip.json` | chat main process |
| TaskOrbit vault, logs, browser profiles | `%APPDATA%\messenger-self-chat\automation` | automation module |
| old TaskOrbit archive | `.backup/TaskOrbit-*` (local only) | not runtime; never packaged |

The `.backup/` tree is an archive of old profiles and data, not a second copy of
the app. It is excluded from the installer and from source control. Deleting it
is a separate, destructive data decision and is not done by the app or tests.

## TaskOrbit integration

`src/main/automation-host.js` lazily requires
`automation-main/bootstrap.cjs` after Electron is ready. On first launch it may
copy an old TaskOrbit vault with SQLite's backup API; the source is never
modified. The workspace has its own window and preload. The chat window can only
call `automation:open` / `automation:status`; every other `automation:*` channel
is reserved for the automation role.

The legacy TaskOrbit source tree is not kept in the project root. Active code is
under `src/automation`, with the runtime bundles generated at the paths above.

## Tests

- `npm test` — pure Node tests. No display, no network, no user profile.
- `npm run typecheck:automation` — TypeScript contract check.
- `npm run test:e2e` — Electron suites, each with a throwaway profile. The
  runner is `scripts/run-e2e.mjs`; logs are under `.test-runs/`.
- `npm run test:all` — unit + typecheck + E2E.

Keep a new test in the smallest layer that can prove the rule: pure helper in
`tests/`, policy in `tests/ipc-matrix.test.js`, and only a real window/OS
interaction in a root `*test.js` Electron suite.

## Adding a feature

1. Put the pure rule in `src/shared/` or `src/main/` and add a Node test.
2. Add any new IPC channel to `src/main/ipc-policy.js` and to the matrix test.
3. Put the UI in one renderer module; do not import another feature's internals.
4. If it needs a new window, give it a page role and a preload; never enable
   `nodeIntegration`.
5. Rebuild, run `npm test`, then the relevant E2E suite, then `npm run test:all`.
