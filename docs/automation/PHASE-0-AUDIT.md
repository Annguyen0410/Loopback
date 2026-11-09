# Phase 0 — Baseline, audit, backup

## Trạng thái
**PARTIAL** — audit và backup đầy đủ; `npm test` baseline pass; chưa build portable
baseline riêng trước khi sửa (đã bù bằng packaged build ở Phase 6).

## Hiện trạng Messenger
- Electron 43.0.0, electron-builder 26.15.3, `name` = `messenger-self-chat`,
  `appId` = `com.loopback.desktop`.
- `main.js` CommonJS (~118 KB): cửa sổ chat, PiP, tray, monitor, quick note,
  screenshot/review, JSON store, hotkey `Ctrl+Alt+N`.
- `preload.js` expose `window.api`; các preload phụ cho monitor/quick/shot/review/cam.
- `src/main/ipc-policy.js`: role theo URL, `ROLE_CHANNELS`, `PAGE_ROLES`,
  `ROLE_PERMISSIONS`, `installIpcGuard`.
- Không có bundler; renderer chat là HTML + ES module thuần.
- Dữ liệu: `%APPDATA%\messenger-self-chat\` (`messages.json`, `settings.json`,
  `files/`, `voice/`, `captures/`).

## Hiện trạng TaskOrbit
- Electron 37, React 18, TypeScript, electron-vite.
- Entry `src/main/index.ts` tự tạo window/tray/single-instance — **không port**.
- Service chính: auto-clicker, key-presser, tab-clicker, credential-vault,
  database, opencode, prompt-forge, routine, routine-state, draft,
  browser-checkin, scheduler, social-posters, notification-service,
  remote-control, remote-web, logs, encryption.
- DB `vault.db` + key `vault.key`; dependency: better-sqlite3 12, koffi 3,
  playwright-core 1.63, node-cron 4, qrcode 1.5.
- Remote server bind `0.0.0.0:8787`.

## Kênh IPC / bề mặt tích hợp
- Toàn bộ kênh automation được đổi prefix `automation:`; thống kê runtime:
  **77 handler** đăng ký sau guard.
- Push dùng `automation:push:*`; chỉ gửi tới `host.getWindow()`.
- Policy thêm role `automation`, quyền `clipboard-sanitized-write`, ngoại lệ
  `automation:open`/`automation:status` cho chat và `automation:close`.
- Bề mặt mới: `automation.html` (root), `automation-preload.cjs`,
  `automation-main/bootstrap.cjs`, `automation-ui/`.

## Dependency / môi trường
- Electron 43 dùng Node 24.17, ABI native **148**.
- `better-sqlite3@12.11.1` chỉ có prebuild tới `electron-v146`; máy không có
  Visual Studio/Windows SDK nên rebuild thất bại (`gyp ERR! find VS`).
- **Quyết định thay thế:** dùng `node:sqlite` có sẵn trong Electron 43 cho
  `DatabaseSync` + `backup`. Cùng file SQLite, không cần native rebuild.
  Đây là deviation so với prompt (prompt yêu cầu better-sqlite3) và được ghi rõ
  trong FINAL-REPORT.
- `koffi` (Win32), `playwright-core`, `node-cron`, `qrcode` giữ nguyên.

## Baseline đã chạy
| Lệnh | Kết quả |
|---|---|
| `npm test` (trước thay đổi) | 95/95 pass |
| `npx electron --version` | v43.0.0 |
| `npm test` (sau khi thêm policy test) | 102/102 pass |
| `npx tsc --noEmit -p tsconfig.automation.json` | exit 0 |
| `npx electron scripts/koffi-probe.cjs` | koffi OK — screen width 1920 |

`npm start` thủ công: chưa chạy trong phiên tự động này; các đường chat/PiP/monitor
được bảo vệ bằng test hiện có và không bị sửa. Ghi nhận là **chưa verify thủ công**.

## Backup
Đã copy (không xoá nguồn):
- `.backup/messenger-self-chat-20261108/`
- `.backup/TaskOrbit-20261108/` (2 file LOCK của LevelDB không copy được)
- `.backup/opencode-automation-hub-20261108/`

## Rủi ro đã xác định
1. TaskOrbit đang chạy khi tích hợp → migration có thể bị `source-busy`; không kill.
2. `vault.key` của TaskOrbit không giải mã được bằng `safeStorage` trên máy này.
   Vault nguồn có **0 credential**, nên migration vẫn copy được notifications và
   config; key mới sẽ được tạo. Nếu có credential thì migration từ chối và yêu cầu
   export/import passphrase.
3. Port 8787/9222 có thể bận → đã thêm fallback.
4. Hotkey F6–F10 có thể trùng → host registry fallback (ghi log).
5. Đóng cửa sổ automation không được quit app → `window-all-closed` bỏ qua khi
   automation host ready.

## Việc tiếp theo
- Phase 1: tách module, chạy headless, typecheck.
