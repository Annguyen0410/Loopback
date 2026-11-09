# TaskOrbit → Loopback: FINAL REPORT

Ngày: 2026-11-09
Workspace: `D:\Code folder\Messenger`
Không commit, không push, không deploy.

## 1. Kết quả tổng quan

TaskOrbit đã được tích hợp vào Loopback thành **một Electron app duy nhất**:

- Một process, một tray, một single-instance lock, một installer.
- Chat/PiP/monitor/screenshot/quick note/theme giữ nguyên code paths; chỉ thêm
  rail button và tray submenu.
- Automation chạy trong cửa sổ riêng (`automation.html`), preload riêng,
  HashRouter, 9 trang.
- Database riêng `%APPDATA%\messenger-self-chat\automation\vault.db`;
  không ghi vào JSON store/chat.
- IPC automation prefix `automation:` (77 handler), guard role-based.
- Đóng workspace không quit app; quit app dừng service và đóng DB.

**Trạng thái chung: PARTIAL** — các đường tự động/đóng gói/migration đã pass;
một số luồng cần credential hoặc thao tác chuột/bàn phím thật chưa verify.

## 2. Kiến trúc đã triển khai

```text
main.js                         lifecycle, tray, chat, IPC guard
src/main/automation-host.js     host bridge + lifecycle automation
src/main/automation-window.js   BrowserWindow automation, bounds, IPC mở/đóng
src/main/automation-migrate.js  copy vault cũ, backup/verify
automation.html                 entry root (HashRouter)
automation-preload.cjs          contextBridge → window.automationApi (+ alias api)
automation-main/bootstrap.cjs   bundle main process automation
automation-ui/                  React build
src/automation/
  main/bootstrap.ts, ipc.ts, paths.ts, db.ts, adapters/host.ts, services/**
  preload/index.ts
  renderer/**                   React pages
  shared/**                     types + IPC channels
```

- `initAutomation(host)` nhận `userDataDir`, `getWindow`, `notify`, theme/locale,
  hotkey registry, `logError`; không gọi `app.whenReady`, `app.quit`,
  `requestSingleInstanceLock`, `new Tray`, `app.getPath('userData')`.
- `shutdownAutomation()` dừng clicker/keyer/tab clicker, remote server, scheduler,
  watcher, stream, clipboard timer, đóng DB.
- `window-all-closed` chỉ bỏ qua khi cửa sổ vừa đóng là automation workspace,
  nên đóng workspace không làm mất scheduler/phone/clicker; đóng chat vẫn quit
  như hành vi cũ.
- `automation:open/status` cho chat; `automation:close` cho workspace;
  mọi kênh `automation:` khác chỉ role automation.

## 3. Parity tính năng

| Nhóm | Trạng thái |
|---|---|
| Dashboard/Home | Render PASS; stats qua DB/IPC |
| Today/Daily Routine | Render + service PASS; chạy check-in thật chưa verify |
| Vault | CRUD/reveal/delete/encryption PASS; export/import chưa thử |
| Providers/OpenCode | UI + service port; ghi config thật chưa verify |
| Auto Click & Key Presser | Port + typecheck; thao tác thật chưa verify |
| Tab Auto Click | Port + port fallback + PID cleanup; launch thật chưa verify |
| PromptForge | UI/service port, stream cleanup; live chat chưa verify (không key) |
| Auto Post | Port; publish thật chưa verify |
| Notifications/Watchers | DB + push + adapter; toast thật chưa quan sát |
| Scheduler | Một init, task id giữ nguyên; chạy dài hạn chưa verify |
| Phone Control | Bật/tắt, fallback, 401/200, đóng port PASS; QR thật chưa thử |
| Settings/Logs | Render + log dir; tail/rotation UI chưa thử |
| Theme/locale | UI riêng TaskOrbit; host bridge có nhưng chưa map hai chiều |

## 4. Test/build đã chạy

| Lệnh | Exit | Kết quả |
|---|---|---|
| `npm test` | 0 | 102 pass, 0 fail |
| `npx tsc --noEmit -p tsconfig.automation.json` | 0 | không lỗi |
| `npm run build:automation` | 0 | UI 601K, main 332.7 KB, preload 14.8 KB |
| `npx electron scripts/automation-headless.cjs` | 0 | 7/7 PASS |
| `npx electron scripts/automation-migrate-test.cjs` | 0 | 11/11 PASS |
| `npx electron scripts/real-migration-probe.cjs` | 0 | 9 notifications + 8 config |
| `npx electron tests/automation-app-smoke.cjs` | 0 | 9 trang + Vault + phone + close/DB |
| `npx electron scripts/koffi-probe.cjs` | 0 | screen width 1920 |
| `npm run build` | 0 | NSIS + portable |

Smoke test chi tiết:
- 9 route render, nav active đúng, không ErrorBoundary.
- `window.api` alias và `window.automationApi` đều gọi IPC.
- Vault create/list/reveal/delete + provider cleanup.
- Phone: 8787 bận → fallback; token sai 401; token đúng 200; tắt → port đóng.
- Setting persist qua SQLite; đóng workspace app vẫn sống; không leak window.
- Module shutdown sạch.

## 5. Migration

- Nguồn: `%APPDATA%\TaskOrbit` (9 notifications, 8 kv_config, 0 provider,
  **0 credential**) và `%APPDATA%\opencode-automation-hub` nếu có.
- Đích: `<userData>\automation\`.
- Quy trình: source readonly → `.backup()` → verify counts → marker; nguồn không
  đổi; target có dữ liệu thật thì không ghi đè; scaffold rỗng được backup rồi retry.
- Browser profiles: không copy (opt-in).
- `vault.key` nguồn (75 byte DPAPI `v10`) **không giải mã được** bằng Electron 43
  trên máy này. Vì vault nguồn không có credential, migration vẫn copy DB và
  **bỏ key**, để vault mới sinh key; marker ghi
  `key-undecryptable-but-no-credentials`.
- Nếu nguồn có credential mà key hỏng: migration từ chối và hướng dẫn export/import
  passphrase trong TaskOrbit → Automation → Vault.
- Profile thật đã import **9 notifications + 8 kv_config**, counts khớp nguồn;
  marker `ok:true` với cảnh báo key bị bỏ qua. `vault.key` mới sẽ được tạo ở lần
  tạo credential đầu tiên.
- Một bản portable Loopback cũ đang chạy (PID 8412) giữ single-instance lock;
  không kill. Cần thoát bản đó trước khi mở bản build mới.

## 6. Build / package

- `dist/Loopback Setup 1.9.1.exe` (~103 MB, NSIS).
- `dist/Loopback 1.9.1.exe` (~148 MB, portable).
- `dist/win-unpacked/Loopback.exe`.
- Asar có `automation.html`, `automation-preload.cjs`,
  `automation-main/bootstrap.cjs`, `automation-ui/**`, `node-cron`,
  `playwright-core`, `qrcode`.
- `koffi.node` nằm trong `app.asar.unpacked/node_modules/@koromix/...`.
- Packaged boot log: DB ready, 77 IPC channels, scheduler đăng ký, hotkey
  fallback F6→F7, module ready.

## 7. Deviations có chủ ý

1. **`better-sqlite3` → `node:sqlite`.** Electron 43 = ABI 148; better-sqlite3
   12.11.1 chỉ có prebuild tới electron-v146; máy không có Visual Studio/Windows
   SDK. `node:sqlite` (Node 24.17 trong Electron 43) cung cấp `DatabaseSync` và
   `backup`, cùng định dạng file, không cần native rebuild. Đã bỏ dependency,
   `postinstall` electron-rebuild và `@electron/rebuild`.
2. **`window.api` alias** trong workspace, cạnh `window.automationApi`, để React
   pages cũ chạy trong giai đoạn chuyển đổi. Ghi chú trong preload; có thể bỏ sau
   khi đổi hết page.
3. **`LOOPBACK_NO_STARTUP_EXTRAS=1`** — test seam chỉ dùng cho packaged
   verification, tránh đổi Windows login item/tray. Không ảnh hưởng launch thật.
4. **Port phone fallback 12 cổng** (8787→8799) và tab clicker 9222→9234, thay vì
   chỉ một port cố định.

## 8. Chưa verify (không tuyên bố pass)

- PromptForge: lưu/validate key OpenRouter, refresh catalogue, free-model fallback,
  streaming/stop/regenerate với API thật.
- Auto clicker/key presser/tab clicker: click/gõ thật, ghost cursor, F6–F10 trên
  desktop, launch Chrome/Edge và pick point.
- Browser check-in login/claim, OpenCode ghi config, Medium/LinkedIn publish.
- Toast native hiển thị trực quan; notification không double toast khi focus.
- QR/PWA trên điện thoại cùng Wi-Fi.
- Cài NSIS và chạy trên Windows sạch; SmartScreen/signature.
- Theme/locale host ↔ UI mapping.
- Clicker với cửa sổ elevated.
- `npm start` thủ công trong phiên này (chat/PiP/monitor được bảo vệ bởi code
  không đổi và regression tests, nhưng chưa click-through).

## 9. Chạy / gỡ

```bash
cd "D:/Code folder/Messenger"
npm start                 # dev
npm run build             # NSIS + portable trong dist/
npm test                  # 102 test
npx tsc --noEmit -p tsconfig.automation.json
npx electron scripts/automation-headless.cjs
npx electron tests/automation-app-smoke.cjs
```

- Mở automation: rail button hoặc tray → Automation → Open Automation.
- Dữ liệu automation: `%APPDATA%\messenger-self-chat\automation\`.
- Gỡ: chạy uninstaller; dữ liệu automation nằm cùng userData, xoá thủ công nếu
  muốn (không có bước tự xoá).
- TaskOrbit cũ: tắt autostart/tray của nó sau khi xác nhận migration; không xoá
  dữ liệu nguồn.

## 10. Diff summary (không commit)

Modified: `main.js`, `preload.js`, `src/main/ipc-policy.js`, `index.html`,
`src/renderer/main.js`, `package.json`, `package-lock.json`.

Added:
- `src/main/automation-host.js`, `automation-window.js`, `automation-migrate.js`
- `src/automation/**`
- `automation.esbuild.mjs`, `automation.vite.config.mjs`, `tsconfig.automation.json`
- `automation.html`, `automation-preload.cjs`, `automation-main/`, `automation-ui/`
- `scripts/copy-automation-html.mjs`, `automation-headless.cjs`, `koffi-probe.cjs`,
  `electron-probe.cjs`, `automation-migrate-test.cjs`, `real-migration-probe.cjs`
- `tests/automation-policy.test.js`, `tests/automation-app-smoke.cjs`
- `docs/automation/**`, `.backup/**`

Không commit/push/deploy. Không xoá dữ liệu cũ. Không đổi `name`/`appId`.
