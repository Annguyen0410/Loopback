# Phase 5 — Win32 + Phone Control

## Trạng thái
**PARTIAL** — phone API/port fallback/401 verify đầy đủ; clicker/keyer/tab clicker
được port và typecheck nhưng chưa điều khiển chuột/bàn phím thật.

## Đã làm
- Auto clicker: koffi Win32; virtual/system; Pick/Fixed/Route/Cursor; preset CPS;
  jitter; clicks per tick 1–50; start delay; duration/count; pause when foreground;
  double click; trái/phải/giữa; anti-idle; ghost cursor overlay.
- Hotkey F6–F10 qua host registry; kiểm tra trùng, fallback (log thực tế:
  `F6 is taken — fell back to F7`); shutdown nhả hotkey.
- Key presser: key list, interval, start/stop, status; quit dừng.
- Tab clicker:
  - launch Opera GX/Opera/Chrome/Edge với remote debugging `127.0.0.1`;
  - quét port 9222…9234, chọn port trống, lưu endpoint thực;
  - profile riêng `automation/browser-profiles`;
  - chỉ kill PID do module tạo (`taskkill /PID <pid> /T`), không kill browser lạ;
  - stop/quit nhả CDP, tắt focus emulation và đóng browser do app mở.
- Phone control:
  - bind `0.0.0.0` khi bật; port 8787 + fallback 12 cổng kế tiếp, lưu port thực;
  - token constant-time (`timingSafeEqual`), rate limit 240 req/phút/IP,
    body limit 64 KB, `Cache-Control: no-store`, bỏ CORS wildcard;
  - QR/LAN URL, PWA manifest/service worker, endpoint status/notifications/tasks/
    routine/clicker;
  - tắt server đóng port; quit đóng server.

## Lệnh đã chạy
| Lệnh | Exit | Kết quả |
|---|---|---|
| `npx electron scripts/koffi-probe.cjs` | 0 | koffi OK — screen width 1920 |
| `npx electron tests/automation-app-smoke.cjs` | 0 | phone server, fallback, 401, 200, stop |
| `npx tsc --noEmit -p tsconfig.automation.json` | 0 | không lỗi |

## Test phone đã pass
- Bật server khi 8787 bận → dùng 8788 (lần đầu) / 8799 theo config đã migrate.
- Token sai → 401; token đúng → 200.
- Tắt server → kết nối lại thất bại (port đóng).
- Token dài ≥ 16 ký tự.

## Chưa verify
- Click thật / gõ phím thật / ghost cursor / F6–F10 trên desktop (tránh di chuyển
  chuột và gõ vào cửa sổ người dùng đang dùng).
- Launch Chrome/Edge + list tab + pick point + stop (tránh mở browser thật).
- QR quét bằng điện thoại cùng Wi-Fi.
- Hành vi với cửa sổ elevated (giới hạn đã biết của Win32 input).

## Việc tiếp theo
- Phase 6: build, package, asar/native, migration.
