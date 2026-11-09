# Phase 2 — Host, cửa sổ, IPC, migration

## Trạng thái
**PASS**

## Đã làm
- `src/main/automation-host.js`: userDataDir = `<userData>/automation`; lazy require
  bootstrap sau `app.whenReady`; init/shutdown có try/catch; host bridge
  (`notify`, `getTheme`, `getLocale`, hotkey registry, `logError`).
- `src/main/automation-window.js`: BrowserWindow riêng, `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`, preload riêng; singleton; nhớ bounds;
  chặn navigate/window.open; đóng cửa sổ không quit app.
- `automation.html` ở root; HashRouter.
- `src/main/ipc-policy.js`: role `automation`, permission clipboard, prefix rule,
  ngoại lệ `automation:open/status/close`; guard cài trước handler.
- Rail button + tray submenu Automation.
- Chat preload thêm `automation.open/status`.
- Migration `src/main/automation-migrate.js` dùng `node:sqlite` readonly + `backup`,
  copy key, verify counts, ghi marker, không xoá nguồn.
- Retry an toàn: nếu target chỉ là scaffold rỗng và marker `ok:false`, backup rồi
  migrate lại; target có dữ liệu thật thì không bao giờ ghi đè.

## Lệnh đã chạy
| Lệnh | Exit | Kết quả |
|---|---|---|
| `npm test` | 0 | 102/102, gồm 7 test policy |
| `npx tsc --noEmit -p tsconfig.automation.json` | 0 | không lỗi |
| `npx electron tests/automation-app-smoke.cjs` | 0 | window/IPC/DB/migration |
| `npx electron scripts/automation-migrate-test.cjs` | 0 | 11/11 PASS |

## Test policy
- `roleForUrl('automation.html') === 'automation'`.
- Chat → `automation:credentials:list` bị chặn.
- Automation → `store:save` bị chặn.
- Automation → automation được phép.
- Monitor → automation bị chặn.
- `automation:open/status` cho chat; `automation:close` cho automation.
- Main frame bắt buộc.

## Migration
- Nguồn thật `%APPDATA%\TaskOrbit`: 9 notifications, 8 khóa config, 0 provider,
  **0 credential**.
- `vault.key` (75 byte, DPAPI `v10`) không giải mã được bằng Electron 43 trên máy
  này. Vì không có credential, migration copy DB, **không copy key**, tạo key mới;
  marker cảnh báo `key-undecryptable-but-no-credentials`.
- Nếu nguồn có credential + key hỏng: từ chối, hướng dẫn export/import passphrase.
- Nguồn không bị sửa; test so sánh byte-for-byte.

## Vấn đề / rủi ro
- TaskOrbit đang chạy nên lần migrate vào profile thật có thể ghi `source-busy`;
  retry sẽ chạy ở lần mở app sau khi đóng TaskOrbit.
- Chưa migrate browser-profiles (opt-in, không copy).

## Việc tiếp theo
- Phase 3: UI React, Vault, PromptForge.
