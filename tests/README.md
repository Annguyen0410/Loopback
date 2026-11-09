# Tests

Two layers, one command for each, and a combined command for a release check.

| Command | What it proves | Needs a display? |
| --- | --- | --- |
| `npm test` | Pure logic: shared text, URL policy, IPC role matrix, store, migrations, proxy, scheduler | No |
| `npm run typecheck:automation` | TaskOrbit TypeScript source and IPC types compile | No |
| `npm run test:e2e` | Real Electron windows, preload bridges, IPC, files, capture and automation | Yes |
| `npm run test:all` | All of the above, in that order | Yes |

## Unit tests

`tests/*.test.js` and `tests/*.test.mjs` run under `node --test`. They never
read or write the real profile. `tests/shared-text.test.mjs` imports the shared
pure module directly; `tests/ipc-matrix.test.js` generates one assertion for
every channel/role cell and every permission/role pair. The architecture test
is a static guardrail for the source/bundle boundaries and package layout.

## E2E suites

The root suites are real Electron programs. They set `app.setPath("userData")`
before `main.js` loads when the matching environment variable is present, so the
runner gives each one a fresh temporary profile:

```text
AUDITTEST_USERDATA   UITEST_USERDATA      PIPTEST_USERDATA
HUDTEST_USERDATA     MENUTEST_USERDATA    CAPTEST_USERDATA
RECTEST_USERDATA     REVIEWTEST_USERDATA  CAMTEST_USERDATA
COMBOTEST_USERDATA   SEARCHTEST_USERDATA  TRAYTEST_USERDATA
```

`monitortest.js`, `monitor-test.js`, `layerbar-test.js` and
`tests/automation-app-smoke.cjs` create their own scratch profiles.

The current gate is **16 suites / 491 E2E checks** plus **869 unit tests**.

Run one suite while debugging:

```bash
npm run test:e2e -- --only=audit
npm run test:e2e -- --only=audit,ui,capture
npm run test:e2e -- --list
```

Logs are written to `.test-runs/<key>.log`, which is git-ignored. The runner
uses the Electron executable from `node_modules`, not a global install, and
kills only the child process tree it started. Close the normal Loopback app
before running the full set: it owns the single-instance lock and the global
`Ctrl+Alt+N` hotkey, and a suite that exercises those paths will be skipped or
fail for that environmental reason.

## Rules for new tests

- Prefer a pure test. If the logic needs a DOM or Electron, extract the pure
  decision first; do not add jsdom just to test a string helper.
- Every new IPC channel needs a row in `src/main/ipc-policy.js` and is covered
  automatically by the matrix test.
- Every real window suite must use a throwaway profile and clean up any captures
  or downloads it creates.
- A test failure is a finding, not something to suppress with a retry.
