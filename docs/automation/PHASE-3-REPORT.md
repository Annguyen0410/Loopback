# Phase 3 — UI React, Vault, PromptForge

## Trạng thái
**PARTIAL** — 9 trang render và Vault CRUD pass; PromptForge live chat chưa verify
vì không có OpenRouter API key.

## Đã làm
- Vite config riêng, React, HashRouter, `base: './'`; script rewrite asset path
  `./assets/` → `./automation-ui/assets/` và inject CSP nghiêm.
- `automation.html` ở root, asset local trong `automation-ui/`.
- Giữ 9 trang TaskOrbit: Home, Today, Vault, Providers, Auto Click,
  PromptForge, Auto Post, Notifications, Settings.
- ErrorBoundary: lỗi một trang không trắng cửa sổ.
- Preload canonical `window.automationApi`; alias `window.api` chỉ trong cửa sổ
  automation để code React cũ chạy trong giai đoạn chuyển đổi.
- Host bridge read-only thêm `host.getTheme()` / `host.getLocale()`.
- Vault: create/list/reveal/delete qua IPC thật, encryption main-process,
  clipboard guard 30s (clear khi hết hạn hoặc khi quit), export/import passphrase.
- PromptForge: key/catalogue/session/rules/plugins/streaming port nguyên;
  stream bị cancel khi cửa sổ automation đóng.

## Lệnh đã chạy
| Lệnh | Exit | Kết quả |
|---|---|---|
| `npm run build:automation:ui` | 0 | Vite build 2.8s, asset local |
| `npm run build:automation` | 0 | HTML + main + preload |
| `npx electron tests/automation-app-smoke.cjs` | 0 | 9 route + Vault CRUD |

## Test đã pass
- 9/9 route render, không ErrorBoundary, không trang trắng.
- Nav active đúng theo hash.
- Vault: tạo provider + credential, list, reveal đúng secret, xoá credential,
  xoá provider.
- DB persistence qua IPC (setting ghi rồi đọc lại).
- Mở lại cửa sổ vẫn trả lời; đóng cửa sổ app vẫn sống.

## Chưa verify
- PromptForge lưu key/validate/refresh model/chat streaming/stop/regenerate với
  key thật (không có credential).
- Auto-hide secret sau 60s (UI) — chưa test thủ công.
- Theme/locale UI vẫn dùng setting riêng của TaskOrbit; bridge host có nhưng
  chưa map hai chiều.

## Việc tiếp theo
- Phase 4: routine, scheduler, watchers, OpenCode, social.
