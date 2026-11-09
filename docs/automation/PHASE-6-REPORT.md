# Phase 6 — Build, package, migration

## Trạng thái
**PASS trên máy hiện tại** — NSIS + portable build, asar đủ asset/native, packaged
app boot module. Máy sạch/chưa cài: **chưa verify**.

## Đã làm
- `package.json`:
  - scripts `build:automation:ui`, `build:automation:main`, `build:automation`,
    `build` (automation + electron-builder), `typecheck`;
  - dependencies runtime: `koffi`, `playwright-core`, `node-cron`, `qrcode`;
  - devDependencies: React/Vite/esbuild/TS/types;
  - bỏ `better-sqlite3`, `@electron/rebuild`, `postinstall` (xem deviation).
- electron-builder files thêm `automation.html`, `automation-preload.cjs`,
  `automation-main/**/*`, `automation-ui/**/*`.
- `asarUnpack`: `node_modules/koffi/**/*`, `node_modules/@koromix/**/*`.
- Build UI + main + copy HTML; electron-builder auto-rebuild native (koffi N-API).
- Thêm test seam `LOOPBACK_NO_STARTUP_EXTRAS=1` để chạy packaged verification mà
  không đổi Windows login item / không để tray.

## Output
| File | Kích thước |
|---|---|
| `dist/Loopback Setup 1.9.1.exe` | ~103 MB |
| `dist/Loopback 1.9.1.exe` (portable) | ~148 MB |
| `dist/win-unpacked/Loopback.exe` | unpacked |

## Asar đã kiểm tra
- `automation.html`
- `automation-preload.cjs`
- `automation-main/bootstrap.cjs` (332.7 KB)
- `automation-ui/index.html` + `automation-ui/assets/*.js|css`
- `node_modules/node-cron`, `playwright-core`, `qrcode`
- `koffi.node` nằm trong `app.asar.unpacked/node_modules/@koromix/koffi-win32-x64/win32_x64/`.

## Packaged boot
Log từ `dist/win-unpacked/Loopback.exe --autostart`:
- `database ready at ...\messenger-self-chat\automation\vault.db`
- `automation IPC handlers registered (77 channels)`
- scheduler đăng ký `daily-routine`, `leetcode-poll`
- hotkey fallback F6 → F7
- `automation module ready`
- Không có tray/window thứ hai; `--autostart` không tạo chat window.

## Migration
- Test tổng hợp: copy DB + key, verify counts, marker, nguồn không đổi, retry
  scaffold rỗng — 11/11 PASS.
- Nguồn thật: 9 notifications + 8 config, 0 credential; key DPAPI không giải mã
  được nên **không copy key**, tạo key mới. `marker.ok = true`.
- Profile thật đã import **9 notifications + 8 kv_config**; `vault.db` mở được,
  counts khớp nguồn. Không copy `vault.key` (không giải mã được, nguồn 0
  credential); key mới sẽ được tạo ở lần tạo credential đầu tiên.
- Lần chạy packaged bị ngắt trước khi marker kịp ghi; marker đã được đối chiếu
  counts và ghi lại `ok:true` với cảnh báo `key-undecryptable-but-no-credentials`.
  Không thay đổi DB nguồn hay đích.

## Vấn đề / rủi ro
- Một bản portable Loopback cũ đang chạy của người dùng giữ single-instance lock;
  không kill. Cần thoát bản đó trước khi mở bản build mới.
- Electron-builder cảnh báo thiếu `author` (không ảnh hưởng build).
- Chưa test cài NSIS trên Windows sạch; chưa test SmartScreen/signature thật.
- Portable 148 MB do `playwright-core` (không đóng gói Chromium).

## Việc tiếp theo
- Phase 7: test matrix, security, docs, final report.
