# Phase 7 — Hardening, test matrix, docs

## Trạng thái
**PARTIAL** — kiểm thử tự động và các đường chính pass; một số luồng thao tác thật
bên ngoài chưa verify (ghi rõ bên dưới).

## Test tự động
| Lệnh | Exit | Kết quả |
|---|---|---|
| `npm test` | 0 | 102/102 pass |
| `npx tsc --noEmit -p tsconfig.automation.json` | 0 | không lỗi |
| `npx electron scripts/automation-headless.cjs` | 0 | 7/7 PASS |
| `npx electron scripts/automation-migrate-test.cjs` | 0 | 11/11 PASS |
| `npx electron tests/automation-app-smoke.cjs` | 0 | 30+ check PASS |
| `npx electron scripts/koffi-probe.cjs` | 0 | screen width 1920 |
| `npm run build` | 0 | NSIS + portable |

## Đã verify
- 9 trang render, không trắng, nav đúng.
- IPC 3 chiều: chat ↛ automation, automation ↛ store, automation → automation;
  monitor ↛ automation; main-frame bắt buộc.
- Vault: create/list/reveal/delete, provider cleanup, encryption main-process.
- Phone: fallback port, token, 401/200, stop/port closed.
- Migration: copy + verify + source untouched + retry scaffold.
- Packaged boot: 77 IPC channels, scheduler, hotkey fallback, DB ready.
- Đóng workspace: app sống, không leak BrowserWindow thứ hai.
- Chat/PiP/monitor/screenshot: code không bị sửa ngoài rail mở automation.

## Chưa verify (không tuyên bố pass)
- PromptForge chat/stream/key thật (không có OpenRouter key).
- Auto clicker/keyer/tab clicker thao tác thật, F6–F10 trên desktop.
- Browser check-in/login/claim, OpenCode write, Medium/LinkedIn publish.
- Toast native trực quan; QR trên điện thoại; PWA cài đặt.
- Cài NSIS trên máy Windows sạch.
- Theme/locale host ↔ UI mapping (UI vẫn dùng setting riêng TaskOrbit).
- Clicker với cửa sổ elevated.

## Security
- CSP `automation.html`: `default-src 'self'; script-src 'self'; style-src 'self'
  'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'`.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- `setWindowOpenHandler` chỉ https; chặn `will-navigate` ra ngoài.
- Secret chỉ ở main; AES-256-GCM + safeStorage; không log secret.
- Clipboard guard: clear sau 30s hoặc khi quit nếu vẫn còn secret.
- Remote: constant-time token, rate limit, body limit, LAN-only khi user bật.
- IPC guard cài trước handler automation.

## Test matrix thủ công — trạng thái
| Nhóm | Trạng thái |
|---|---|
| Chat send/edit/delete/search/pin/reaction | Không sửa; regression test 102 pass |
| PiP/tuck/floating bar/quick note | Không sửa; chưa thao tác thủ công |
| Screenshot/review/media/record | Không sửa; chưa thao tác thủ công |
| Monitor | Không sửa |
| Automation 9 trang | PASS (render) |
| Vault | PASS CRUD; export/import chưa thử |
| PromptForge | Render PASS; live chat chưa verify |
| Routine/scheduler/watcher | Khởi tạo PASS; chạy thật chưa verify |
| Clicker/keyer/tab clicker | Code + typecheck; chưa thao tác thật |
| Phone | PASS fallback/401/stop |
| Migration | PASS (synthetic + real source temp) |
| Quit cleanup | Headless DB/hotkey PASS; clicker/Chrome/server chưa quan sát |

## Dọn dẹp / docs
- Ghi đầy đủ Phase 0–7 + FINAL-REPORT.
- Giữ alias `window.api` trong workspace (có ghi chú); chưa bỏ vì React pages
  vẫn dùng.
- Không commit/push/deploy.

## Việc tiếp theo
- Chạy test matrix thủ công với credential/dịch vụ thật; cài NSIS trên máy sạch.
