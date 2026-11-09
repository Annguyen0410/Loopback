# Phase 4 — Core service

## Trạng thái
**PARTIAL** — service được port và khởi tạo một lần; các luồng cần dịch vụ ngoài
(OpenCode, Medium/LinkedIn, browser check-in) chưa chạy thật.

## Đã làm
- Scheduler: một `initScheduler` duy nhất trong bootstrap; task id giữ nguyên;
  enabled persist; run-now qua IPC/tray; retry/backoff giữ nguyên.
- Daily routine: step/note/streak, draft scaffold/read/open, auto-publish opt-in,
  browser check-in service + screenshot lỗi vào `automation/checkin-failures`.
- Watchers: hash/keyword/Gmail, baseline/dedupe, test dry-run, mark read.
- OpenCode: đọc config, backup trước ghi, write provider, test connection,
  import model, form automation, cảnh báo plaintext key.
- Social: Medium draft/public (tags ≤ 5), LinkedIn text-only/connections-only,
  history, lỗi → notification.
- Notification: một adapter `host.notify()` + ghi DB + push UI; cửa sổ đang focus
  thì `silentIfFocused` tránh toast đôi.
- Tray: Open Automation, Run Daily Routine, Auto Click start/stop, Phone on/off,
  Stop all; không tạo tray thứ hai.

## File chính
- `src/automation/main/services/scheduler.ts`, `routine.ts`, `draft.ts`,
  `browser-checkin.ts`, `notification-service.ts`, `opencode-*`,
  `social-posters.ts`
- `src/automation/main/bootstrap.ts`
- `src/main/automation-host.js` (tray actions)

## Lệnh đã chạy
| Lệnh | Exit | Kết quả |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.automation.json` | 0 | không lỗi |
| `npx electron tests/automation-app-smoke.cjs` | 0 | scheduler + notifications khởi tạo |
| `npm test` | 0 | 102/102 |

## Chưa verify
- Chạy routine thật và browser check-in (cần đăng nhập site, có thể claim) — chưa
  thực hiện để tránh thao tác ngoài ý muốn.
- Ghi config OpenCode thật / post Medium/LinkedIn thật — chưa có credential và
  không muốn thay đổi config ngoài phạm vi.
- Toast native hiển thị trực quan — chưa quan sát; DB + push đã test.
- Retry/backoff theo thời gian dài — chỉ đọc code + khởi tạo.

## Việc tiếp theo
- Phase 5: Win32 clicker/keyer/tab clicker, phone control.
