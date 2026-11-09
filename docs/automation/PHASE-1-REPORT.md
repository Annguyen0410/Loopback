# Phase 1 — Tách module, chạy headless

## Trạng thái
**PASS**

## Đã làm
- Tạo `src/automation/` với `main/`, `preload/`, `renderer/`, `shared/`.
- Port service TaskOrbit; **không** copy `src/main/index.ts`.
- Viết `ipc.ts` mới, toàn bộ kênh prefix `automation:`.
- Thay `app.getPath('userData')` bằng `paths.ts` + `host.userDataDir`.
- Thay `windows.ts` bằng adapter `host.getWindow()`.
- Notification qua `host.notify()`; hotkey qua `host.registerHotkey()`.
- Scheduler một init, nhận `{ notify, getWindow, runTask }`.
- Bootstrap `initAutomation` / `shutdownAutomation` / `openAutomationRoute`.
- esbuild bundle `automation-main/bootstrap.cjs` và `automation-preload.cjs`.
- Headless harness với host giả, userDataDir tạm.

## File chính
- `src/automation/main/bootstrap.ts`, `ipc.ts`, `paths.ts`, `db.ts`,
  `adapters/host.ts`, `services/**`
- `automation.esbuild.mjs`
- `scripts/automation-headless.cjs`

## Lệnh đã chạy
| Lệnh | Exit | Kết quả |
|---|---|---|
| `node automation.esbuild.mjs` | 0 | bootstrap 332.7 KB, preload 14.8 KB |
| `npx tsc --noEmit -p tsconfig.automation.json` | 0 | không lỗi |
| `npx electron scripts/automation-headless.cjs` | 0 | 7/7 PASS |
| `npm test` | 0 | 102/102 pass |

## Test headless
- `vault.db` được tạo trong thư mục tạm.
- Schema: `credentials`, `kv_config`, `notifications`, `post_history`, `providers`.
- Không tạo window/tray, không single-instance, không gọi `globalShortcut.unregisterAll`.
- Hotkey được nhả khi shutdown.
- DB đóng sạch.

## Vấn đề / rủi ro
- `better-sqlite3` không rebuild được cho Electron 43 → dùng `node:sqlite`
  (xem Phase 0 và FINAL-REPORT).
- `node-cron` để external trong bundle vì bản ESM dùng `import.meta.url`.

## Việc tiếp theo
- Phase 2: host thật, cửa sổ automation, IPC guard, migration.
