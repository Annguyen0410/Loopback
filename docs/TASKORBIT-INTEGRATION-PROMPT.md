# PROMPT THỰC THI: TÍCH HỢP TOÀN BỘ TASKORBIT VÀO MESSENGER

Bạn là kỹ sư Electron/TypeScript cấp cao, chịu trách nhiệm tích hợp **toàn bộ** tính
năng của TaskOrbit vào Messenger/Loopback thành **một ứng dụng duy nhất**, không
xung đột với các tính năng hiện có.

Đây là chỉ thị thực thi, không phải bản tư vấn. Hãy đọc hết prompt này trước khi
làm. Không hỏi lại những quyết định đã chốt; nếu có ambiguity nhỏ, chọn phương án
ít rủi ro nhất và ghi vào báo cáo. Chỉ dừng khi gặp blocker thật sự (thiếu quyền,
thiếu credential, thao tác có thể phá dữ liệu) hoặc khi đã hoàn thành Definition
of Done.

---

## 1. MỤC TIÊU CUỐI CÙNG

Messenger là **app chính**. Sau khi hoàn thành:

- Một tiến trình Electron, một tray, một single-instance lock, một installer.
- Chat, PiP, floating bar, quick note, screenshot, review card, camera bubble,
  monitor window, theme, dữ liệu chat — hoạt động **y hệt trước khi tích hợp**.
- Toàn bộ TaskOrbit chạy trong cùng app:
  - Dashboard/Home
  - Today / Daily Routine (draft, auto publish, streak, browser check-in)
  - Credential Vault (provider, credential, reveal/copy, clipboard guard,
    export/import)
  - Providers / OpenCode (ghi config, test, import model, form automation)
  - Auto Click & Key Presser (virtual/system, các mode, preset, hotkey, anti-idle,
    ghost cursor)
  - Tab Auto Click (CDP, launch browser, list tab, pick point, start/stop)
  - PromptForge (enhancer, rules, plugins, session, streaming, free model mode,
    catalogue refresh, retry)
  - Auto Post (Medium, LinkedIn, history)
  - Notifications / Watchers (hash, keyword, Gmail, dedupe, test, mark read)
  - Scheduler (task, cron, retry, enabled persistence, run now)
  - Phone Control (token, QR, PWA, API, port fallback)
  - Settings, Logs, theme, ngôn ngữ
- Không có app thứ hai, tray thứ hai, cửa sổ tranh chấp, notification đôi,
  scheduler đôi, hotkey bị mất, port bị chiếm, dữ liệu chat bị chạm.

---

## 2. ĐƯỜNG DẪN VÀ NGUỒN SỰ THẬT

### 2.1. Workspace đích

```text
D:\Code folder\Messenger
```

Đây là nơi implement. Giữ nguyên git working tree; **không commit, không push,
không deploy, không publish**.

### 2.2. Nguồn TaskOrbit (read-only)

```text
D:\Code folder\Tool for me\opencode-automation-hub
```

Được phép đọc và copy code sang Messenger. **Không sửa repo TaskOrbit gốc**, trừ
khi thật sự cần và phải báo rõ. Mọi fix phải nằm trong bản copy ở Messenger.

### 2.3. Tài liệu kiến trúc bắt buộc đọc trước

```text
D:\Code folder\Messenger\docs\TASKORBIT-INTEGRATION.md
```

Đọc toàn bộ file này trước Phase 0. Nếu file không tồn tại, dùng phần kiến trúc
trong prompt này làm nguồn chính.

### 2.4. Thứ tự ưu tiên khi mâu thuẫn

1. Yêu cầu bảo toàn dữ liệu và hành vi Messenger.
2. Prompt này.
3. `docs/TASKORBIT-INTEGRATION.md`.
4. Code hiện có của hai repo.

---

## 3. RÀNG BUỘC KHÔNG ĐƯỢC VI PHẠM

1. **Không import `src/main/index.ts` của TaskOrbit.** File đó tự gọi
   `app.whenReady()`, tạo tray, single-instance, `globalShortcut`,
   `window-all-closed`. Chỉ port service/renderer.
2. **Không tạo app/tray/single-instance thứ hai.** Messenger giữ
   `app.requestSingleInstanceLock()`, tray, menu, `app.on('will-quit')`.
3. **Không đổi `name` trong `package.json`** (`messenger-self-chat`) và **không
   đổi `appId`** (`com.loopback.desktop`) trong suốt quá trình tích hợp. Đổi sẽ
   làm mất userData/danh tính cài đặt.
4. **Không ghi vào `messages.json`, `settings.json`, `files/`, `voice/`,
   `captures/`** của Messenger. Automation có database riêng.
5. **Không đổi schema JSON store** của Messenger, trừ khi có lý do bắt buộc và
   phải có migration/backup.
6. **Không đặt `automation.html` trong thư mục con.** Nó phải ở root app vì
   `roleForUrl()` trong `src/main/ipc-policy.js` chỉ cấp role cho file `file://`
   có thư mục cha đúng bằng thư mục app.
7. **Mọi kênh IPC automation phải có prefix `automation:`**; chat không được gọi
   handler automation; automation không được gọi `store:*`, `capture:*`, `pip:*`.
8. **IPC guard phải được cài trước khi đăng ký handler automation.** Không được
   đăng ký handler trước `installIpcGuard`, nếu không guard vô hiệu.
9. **Không tắt `contextIsolation`, không bật `nodeIntegration`, không hạ
   `sandbox`** của cửa sổ automation. Preload chỉ dùng `contextBridge`.
10. **Không hạ Electron xuống 37.** Messenger dùng Electron 43; native module
    phải rebuild theo Electron 43.
11. **Không chuyển Messenger sang React/Vite.** Chỉ thêm pipeline build riêng cho
    automation; chat vẫn là HTML + ES module thuần.
12. **Không dùng iframe, `webview`, hay sidecar process** cho automation.
13. **Không xoá dữ liệu TaskOrbit cũ**, không tự động migrate mà không backup,
    không ghi đè `vault.db`/`vault.key`.
14. **Không commit/push/deploy.** Không chạy `git push`, không publish site.
15. **Không thêm tính năng mới ngoài parity TaskOrbit.** Không redesign chat,
    không đổi theme, không đổi copy.
16. **Không bỏ qua test/build lỗi.** Sửa nguyên nhân; không skip test, không
    giảm assertion, không thêm `@ts-ignore` để che lỗi.
17. **Không dùng `sudo`/elevation.** Không thao tác ngoài hai thư mục nguồn.
18. **Không giết process theo tên.** Nếu cần dừng Chrome/Electron, chỉ kill PID
    do app tạo.
19. **Không để secret trong renderer/localStorage/log.** Key chỉ ở main, mã hoá.
20. **Không kết thúc khi UI mới chỉ “render được”.** Phải chứng minh IPC, DB,
    hotkey, notification, scheduler, build packaged hoạt động hoặc ghi rõ phần
    chưa verify.

---

## 4. HIỆN TRẠNG PHẢI TÔN TRỌNG

### 4.1. Messenger/Loopback

- Electron 43, `electron-builder` 26.
- `main.js` là CommonJS monolith (~118 KB): window, PiP, IPC, JSON store,
  screenshot, tray, monitor, hotkey `Ctrl+Alt+N`.
- `preload.js` expose `window.api`; `monitor-preload.js`, `quick-preload.js`,
  `shot-preload.js`, `review-preload.js`, `cam-preload.js`.
- `src/main/ipc-policy.js`: `ROLE_CHANNELS`, `PAGE_ROLES`, `ROLE_PERMISSIONS`,
  `roleForUrl`, `frameIsMain`, `installIpcGuard`. Role chat/pip/monitor/quick/
  shot/review/cam.
- `src/main/store.js`: JSON store, atomic write, migration, backup.
- `package.json` **không có runtime dependencies**; build.files là whitelist.
- Không có bundler; `src/renderer/` là ES module thuần.
- Data: `%APPDATA%\messenger-self-chat\`.

### 4.2. TaskOrbit

- Electron 37, React 18, TypeScript, electron-vite.
- Main entry `src/main/index.ts`: tự tạo window, tray, single-instance,
  scheduler, hotkey, remote server. **Không copy file này.**
- `src/preload/index.ts`: expose `window.api` với nhiều namespace.
- `src/main/services/`: `auto-clicker`, `key-presser`, `tab-clicker`,
  `credential-vault`, `database`, `opencode-*`, `prompt-forge`, `routine`,
  `routine-state`, `draft`, `browser-checkin`, `scheduler`, `social-posters`,
  `notification-service`, `remote-control`, `remote-web`, `logs`, `encryption`.
- DB `vault.db`, key `vault.key`; `better-sqlite3` 12, `koffi` 3,
  `playwright-core` 1.63, `node-cron` 4, `qrcode` 1.5.
- PromptForge mặc định `openrouter/free`, watcher 6 giờ, retry 1 lần.
- Remote server bind `0.0.0.0:8787` (fallback cần thêm).
- Data cũ: `%APPDATA%\TaskOrbit\` hoặc `%APPDATA%\opencode-automation-hub\`.

---

## 5. KIẾN TRÚC BẮT BUỘC

### 5.1. Một host, một module

```text
Messenger host
├─ main.js                         # lifecycle, tray, IPC guard, chat windows
├─ src/main/automation-host.js     # cầu nối, không chứa nghiệp vụ
├─ src/main/automation-window.js   # BrowserWindow automation
├─ src/main/automation-migrate.js  # copy dữ liệu cũ
├─ automation.html                 # entry root
├─ automation-preload.cjs          # preload riêng
├─ automation-main/bootstrap.cjs   # build từ src/automation/main
├─ automation-ui/                  # build React
└─ src/automation/
   ├─ main/
   │  ├─ bootstrap.ts
   │  ├─ ipc.ts
   │  ├─ paths.ts
   │  ├─ adapters/host.ts
   │  └─ services/                 # copy từ TaskOrbit
   ├─ preload/index.ts
   ├─ renderer/                    # React app
   └─ shared/                      # types, ipc-channels
```

### 5.2. Hợp đồng bootstrap

`automation-main/bootstrap.cjs` export:

```ts
initAutomation(host: AutomationHost): Promise<void>
shutdownAutomation(): Promise<void>
openAutomationRoute(route: string): void
```

`AutomationHost`:

```ts
{
  userDataDir: string          // ...\automation
  appVersion: string
  getWindow(): BrowserWindow | null
  notify(input: {
    title: string
    body: string
    route?: string
    priority?: 'low' | 'normal' | 'high'
    silentIfFocused?: boolean
  }): void
  getTheme(): { mode: 'light' | 'dark'; accent: string }
  getLocale(): 'vi' | 'en'
  registerHotkey(id: string, accelerator: string, handler: () => void): boolean
  unregisterHotkey(id: string): void
  logError(scope: string, error: unknown): void
}
```

Module không được gọi trực tiếp: `app.whenReady`, `app.quit`,
`requestSingleInstanceLock`, `new Tray`, `globalShortcut.unregisterAll`,
`app.getPath('userData')`, `new Notification`, `BrowserWindow.getAllWindows()`.

### 5.3. UI

- Cửa sổ **Automation Workspace** riêng, giống mô hình Monitor.
- `BrowserWindow` với `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, preload `automation-preload.cjs`.
- `show: false` + `ready-to-show`; nhớ bounds trong `automation/window.json`.
- HashRouter (`automation.html#/vault`); không BrowserRouter.
- Không import `styles.css` của Messenger; không dùng CSS toàn cục chat.
- Rail button + tray menu để mở.
- Không dùng `parent`, không modal; không đặt cửa sổ automation vào logic PiP.

### 5.4. IPC

- Prefix toàn bộ: `automation:app:get-info`, `automation:credentials:list`, …
- Push: `automation:push:*`.
- `PAGE_ROLES['automation.html'] = 'automation'`.
- `ROLE_PERMISSIONS.automation = new Set(['clipboard-sanitized-write'])`.
- `channelAllowed`:
  - exact table trước;
  - nếu `channel.startsWith('automation:')` → chỉ role `automation`;
  - ngoại lệ: `automation:open` cho CHAT, `automation:status` cho CHAT,
    `automation:close` cho automation.
- Test 3 chiều: chat→automation handler bị chặn; automation→store bị chặn;
  automation→automation cho phép; monitor→automation bị chặn.
- `automation:open` từ rail/tray; `automation:status` read-only.
- Push chỉ gửi `host.getWindow()`.

### 5.5. Preload

- `automation-preload.cjs` expose `window.automationApi`.
- Alias `window.api` **chỉ trong cửa sổ automation** để code React cũ chạy trong
  giai đoạn chuyển đổi; ghi chú rõ và có thể bỏ sau.
- Chat preload chỉ thêm `automation.open()` và `automation.status()`.

---

## 6. CÁC PHASE THỰC THI

Thực hiện tuần tự Phase 0 → 7. Sau mỗi phase, chạy kiểm tra, ghi báo cáo, rồi
tiếp tục. Không bỏ qua phase. Nếu phase trước fail, sửa trong phase đó trước khi
đi tiếp.

### PHASE 0 — BASELINE, AUDIT, BACKUP

**Mục tiêu:** biết chính xác hiện trạng, có bản chạy được để so sánh, có backup.

Việc phải làm:

1. Đọc `docs/TASKORBIT-INTEGRATION.md`.
2. Đọc `main.js`, `preload.js`, `src/main/ipc-policy.js`, `src/main/store.js`,
   `package.json` của Messenger.
3. Đọc `src/main/index.ts`, `src/preload/index.ts`, `src/main/services/*.ts`,
   `src/shared/ipc-channels.ts`, `src/shared/constants.ts`, `src/shared/types.ts`
   của TaskOrbit.
4. Liệt kê đầy đủ kênh IPC, service, dependency, cửa sổ, hotkey, port.
5. Chạy baseline:

```bash
cd "D:/Code folder/Messenger"
npm test
npm start
```

Mở app, kiểm tra chat, PiP, quick note, screenshot, monitor. Đóng app.
6. Build baseline portable:

```bash
npx electron-builder --win portable
```

Ghi lại tên file/kích thước; không ghi đè bản cũ nếu có.
7. Backup dữ liệu (chỉ đọc/copy, không xoá):

```text
%APPDATA%\messenger-self-chat
%APPDATA%\TaskOrbit
%APPDATA%\opencode-automation-hub
```

8. Tạo báo cáo `docs/automation/PHASE-0-AUDIT.md`: kênh IPC, service, dependency,
   rủi ro, đường dẫn dữ liệu, kết quả baseline.
9. Không sửa code trong phase này.

**Exit criteria:**

- `npm test` pass.
- `npm start` mở được app và các tính năng chính hoạt động.
- Có baseline portable exe.
- Có audit đầy đủ và backup.

---

### PHASE 1 — TÁCH MODULE, CHẠY HEADLESS

**Mục tiêu:** TaskOrbit service sống trong Messenger mà không cần UI, không tạo
tray/window/app lifecycle riêng.

Việc phải làm:

1. Tạo `src/automation/` theo cây ở mục 5.1.
2. Copy từ TaskOrbit:
   - `src/main/services/**` → `src/automation/main/services/`
   - `src/shared/**` → `src/automation/shared/`
   - `src/main/utils/**` (encryption, logger, jsonc…) → `src/automation/main/utils/`
   - `src/preload/index.ts` → `src/automation/preload/index.ts`
   - `src/renderer/**` → `src/automation/renderer/` (có thể để Phase 3)
3. **Không copy `src/main/index.ts`** và **không copy nguyên
   `src/main/ipc/index.ts`**. Viết `ipc.ts` mới, đăng ký handler với prefix
   `automation:`.
4. Thay mọi `app.getPath('userData')` bằng `paths.ts`:
   - `db`, `key`, `logs`, `browser-profiles`, `checkin-failures`,
     `automation-failures`, `drafts`, `window.json`.
   - `paths.init(host.userDataDir)` tạo thư mục.
5. Thay `windows.ts`/`setPrimaryWindow` bằng `host.getWindow()`.
6. Thay `notification-service` native call bằng `host.notify()`; vẫn giữ ghi DB.
7. Thay `initClickerHotkey` trực tiếp bằng `host.registerHotkey()`.
8. `scheduler.ts`: đổi `initScheduler(mainWindow)` thành
   `initScheduler({ notify, getWindow, runTask })`; chỉ init một lần.
9. Tạo `bootstrap.ts`:
   - `initAutomation(host)` → paths, migration, DB, IPC, scheduler, hotkey,
     remote (nếu enabled), PromptForge watcher.
   - `shutdownAutomation()` → dừng clicker/keyer/tab clicker, remote, scheduler,
     watcher, đóng DB.
   - Bọc từng bước trong try/catch; lỗi một module không làm chết host.
10. Build esbuild:

```bash
node automation.esbuild.mjs
```

Output `automation-main/bootstrap.cjs`.
11. Viết `scripts/automation-headless.cjs`: một Electron script tối giản tạo
    `app.whenReady()`, gọi `initAutomation` với host giả (userDataDir tạm),
    list providers/notifications, gọi `shutdownAutomation()`, `app.quit()`.
    Chạy:

```bash
npx electron scripts/automation-headless.cjs
```

12. Chạy typecheck riêng:

```bash
npx tsc --noEmit -p tsconfig.automation.json
```

**Exit criteria:**

- Headless script chạy exit 0.
- DB `vault.db` được tạo trong thư mục tạm.
- Không có tray/window nào được tạo.
- `npm test` của Messenger vẫn pass.
- Không import `src/main/index.ts`.

---

### PHASE 2 — HOST, CỬA SỔ, IPC, MIGRATION

**Mục tiêu:** mở được cửa sổ automation từ Messenger, IPC đúng quyền, dữ liệu cũ
migrate được, chat không bị ảnh hưởng.

Việc phải làm:

1. Tạo `src/main/automation-host.js`:
   - tính `userDataDir = path.join(app.getPath('userData'), 'automation')`;
   - lazy `require('../automation-main/bootstrap.cjs')` sau `app.whenReady`;
   - gọi `initAutomation` trong try/catch; log lỗi;
   - gọi `shutdownAutomation` trong `will-quit`;
   - cung cấp `notify`, `getTheme`, `getLocale`, `registerHotkey`,
     `unregisterHotkey`, `logError`.
2. Tạo `src/main/automation-window.js`:
   - BrowserWindow như mục 5.3;
   - `loadFile(path.join(__dirname, '../../automation.html'))`;
   - `setWindowOpenHandler` chỉ https; chặn `will-navigate`;
   - nhớ bounds; singleton; deep link `automation.html#/...`;
   - đóng cửa sổ không quit app; destroy renderer, giữ service.
3. Tạo `automation.html` root + một trang test tối giản gọi
   `automation:app:get-info`, hiển thị DB path/version.
4. Sửa `src/main/ipc-policy.js`:
   - `PAGE_ROLES['automation.html'] = 'automation'`;
   - permission clipboard;
   - prefix rule + ngoại lệ;
   - đảm bảo `installIpcGuard` chạy trước `registerAutomationIpc`.
5. Đăng ký IPC automation:
   - import `IPC` từ `src/automation/shared/ipc-channels.ts`;
   - chỉ đăng ký sau guard;
   - handler trả `{ ok, data/error }`;
   - push chỉ tới automation window.
6. Thêm rail button + tray submenu:
   - Open Automation
   - Auto Clicker start/stop (nếu Phase 5 chưa xong, disable)
   - Run Daily Routine now (nếu chưa xong, disable)
   - Stop all automation
   - Phone Control on/off (nếu chưa xong, disable)
   Không tạo tray mới.
7. Chat preload thêm `automation.open/status`; chat renderer thêm nút rail gọi nó.
8. Migration:
   - `src/main/automation-migrate.js`: phát hiện `%APPDATA%\TaskOrbit` hoặc
     `%APPDATA%\opencode-automation-hub`;
   - dùng `better-sqlite3` readonly + `.backup(dest)`; copy `vault.key`; copy
     `browser-profiles` nếu người dùng đồng ý; ghi `migration.json`; verify counts;
   - không xoá nguồn; backup trước khi migrate.
9. Test thủ công:
   - mở chat → rail → automation window;
   - gọi `automation:app:get-info`;
   - chat vẫn gửi/nhận, PiP vẫn chạy;
   - đóng automation → app vẫn sống;
   - mở lại → DB còn dữ liệu;
   - chat gọi `automation:credentials:list` phải bị chặn;
   - automation gọi `store:save` phải bị chặn.
10. Viết `tests/automation-policy.test.js` cho policy.

**Exit criteria:**

- Cửa sổ automation mở/đóng độc lập.
- Ít nhất 1 handler automation hoạt động; 2 chiều chặn đúng.
- Migration tạo được `automation/vault.db` + `vault.key`.
- Chat/PiP/monitor không đổi hành vi.
- `npm test` pass.

---

### PHASE 3 — UI REACT, VAULT, PROMPTFORGE

**Mục tiêu:** toàn bộ giao diện TaskOrbit chạy trong cửa sổ automation; 2 trang
nặng nhất (Vault, PromptForge) hoàn chỉnh.

Việc phải làm:

1. Vite config:
   - root `src/automation/renderer`;
   - `base: './automation-ui/'`;
   - `outDir` tuyệt đối `<project>/automation-ui`;
   - plugin React.
2. `scripts/copy-automation-html.mjs`: copy `automation-ui/index.html` →
   `automation.html` root; kiểm tra asset path.
3. Build UI:

```bash
npm run build:automation:ui
```

4. React app:
   - giữ 9 trang TaskOrbit; dùng HashRouter;
   - bỏ mọi thứ window/tray/app lifecycle;
   - `window.automationApi` hoặc alias `window.api` trong preload;
   - ErrorBoundary để lỗi một trang không trắng cả cửa sổ.
5. Theme/locale:
   - `automationApi.host.getTheme()` + subscribe;
   - map sang CSS variables TaskOrbit;
   - locale en/vi; lưu lựa chọn.
6. Vault:
   - list/create/update/delete credential;
   - reveal/copy; clipboard guard 30s;
   - export/import passphrase;
   - hiển thị encryption available.
7. PromptForge:
   - lưu/xoá key; validate;
   - refresh models; free model mode; `openrouter/free`;
   - chat streaming; stop; regenerate; session;
   - rules/plugins;
   - cancel stream khi cửa sổ đóng.
8. Notification adapter:
   - item vào DB + push UI;
   - native qua `host.notify()`;
   - không double toast khi window focused.
9. Kiểm tra:
   - mở từng trang;
   - tạo credential, reload, còn dữ liệu;
   - PromptForge key + chat;
   - đổi theme/ngôn ngữ;
   - đóng/mở window, dữ liệu còn.

**Exit criteria:**

- Tất cả trang render không trắng.
- Vault + PromptForge hoạt động end-to-end.
- Không có CSS nào rò sang chat.
- `npm run build:automation` pass.
- `npm test` pass.

---

### PHASE 4 — CORE SERVICE

**Mục tiêu:** routine, scheduler, watchers, OpenCode, social chạy đúng, không
chạy trùng, notification đúng một nguồn.

Việc phải làm:

1. Scheduler:
   - một `initScheduler` duy nhất;
   - task id giữ nguyên;
   - retry/backoff; enabled persist;
   - run now từ UI/tray;
   - không chạy 2 lần khi app restart.
2. Daily Routine:
   - step done/note; streak;
   - draft scaffold/read/open; path setting;
   - auto publish opt-in; publish qua social;
   - browser check-in: login, claim, dry-run, allowLogin, persistent profile;
   - screenshot lỗi vào `automation/checkin-failures`.
3. LeetCode tracker + watchers:
   - hash/keyword/Gmail;
   - baseline/dedupe;
   - test dry-run không notify;
   - real notify đúng 1 lần.
4. OpenCode:
   - đọc config, backup trước ghi;
   - write provider, test connection, import model;
   - form automation;
   - cảnh báo plaintext key.
5. Social:
   - Medium draft/public, tags tối đa 5;
   - LinkedIn text-only, connections-only;
   - history; lỗi → notification.
6. Tray actions: run routine, stop all, status.
7. Test:
   - disable/enable task; restart app; không chạy trùng;
   - watcher test; real;
   - OpenCode backup;
   - routine draft.

**Exit criteria:**

- Routine/scheduler/watcher/OpenCode/social hoạt động.
- Không có notification/scheduler trùng.
- `npm test` pass.

---

### PHASE 5 — WIN32 + PHONE CONTROL

**Mục tiêu:** auto clicker/key presser/tab clicker và phone API hoạt động, an
toàn, dọn dẹp sạch.

Việc phải làm:

1. Auto clicker:
   - koffi Win32; chỉ Windows; platform khác disable/không crash;
   - virtual/system; Pick/Fixed/Route/Cursor;
   - preset CPS; jitter; clicks per tick 1–50;
   - start delay 1s; duration/count;
   - pauseWhenForeground; double click; chuột trái/phải/giữa;
   - anti-idle; ghost cursor;
   - F6–F10 qua host registry; conflict fallback; lưu lựa chọn;
   - quit → stop, nhả chuột/phím.
2. Key presser:
   - key list; interval; start/stop; status;
   - quit → stop.
3. Tab clicker:
   - launch Chrome/Edge với remote debugging `127.0.0.1`;
   - port 9222 → fallback nếu bận;
   - list tab, pick point, start/stop;
   - profile riêng trong `automation/browser-profiles`;
   - chỉ kill PID do app tạo; đóng browser khi stop/quit;
   - focus emulation + lifecycle flags.
4. Phone Control:
   - HTTP server bind `0.0.0.0` khi user bật;
   - port 8787 → fallback 8788–8799; lưu port thực;
   - token constant-time; body limit; rate limit;
   - QR + URL LAN; PWA manifest/service worker;
   - endpoint routine/tasks/clicker/notifications;
   - tắt server đóng port; quit đóng server.
5. Ghost cursor:
   - overlay BrowserWindow `skipTaskbar`, `focusable:false`,
     `setIgnoreMouseEvents(true)`;
   - host track; đóng khi quit; không ảnh hưởng `window-all-closed`.
6. Test:
   - F6 start/stop; đổi hotkey; quit không kẹt;
   - tab clicker launch/list/stop;
   - phone mở trên cùng Wi-Fi; sai token 401; tắt server;
   - port bận → fallback.

**Exit criteria:**

- Clicker/keyer/tab clicker/phone hoạt động.
- Không kill Chrome lạ; không kẹt input; không port conflict.
- `npm test` pass.

---

### PHASE 6 — BUILD, PACKAGE, MIGRATION

**Mục tiêu:** exe NSIS/portable chạy trên máy sạch, đủ asset/native, migrate đủ.

Việc phải làm:

1. `package.json`:
   - thêm scripts `build:automation:ui`, `build:automation:main`,
     `build:automation`, `build`, `postinstall` electron-rebuild;
   - dependencies: `better-sqlite3`, `koffi`, `playwright-core`, `node-cron`,
     `qrcode`;
   - devDependencies: React/Vite/esbuild/TS/types/@electron/rebuild.
2. `electron-builder`:
   - files thêm `automation.html`, `automation-preload.cjs`,
     `automation-main/**/*`, `automation-ui/**/*`;
   - `asarUnpack` cho `better-sqlite3`, `koffi`;
   - giữ nguyên NSIS/portable hiện có.
3. Rebuild native cho Electron 43:

```bash
npx electron-rebuild -f -w better-sqlite3
```

4. Build:

```bash
npm run build
```

5. Kiểm tra output:
   - `automation.html`, `automation-ui`, `automation-main`,
     `automation-preload.cjs` có trong asar/asar.unpacked;
   - native `.node` nằm đúng;
   - không thiếu `bindings`/`file-uri-to-path`.
6. Chạy portable/NSIS:
   - chat hoạt động;
   - automation mở;
   - Vault/PromptForge đọc dữ liệu;
   - clicker/phone;
   - đóng app sạch.
7. Migration trên bản packaged:
   - từ bản TaskOrbit cũ; verify counts;
   - không xoá nguồn;
   - nếu key DPAPI fail, hiện hướng dẫn export/import.
8. Clean Windows test nếu có thể; nếu không, ghi rõ “chưa test máy sạch”.

**Exit criteria:**

- `npm run build` exit 0.
- Portable/NSIS chạy được trên máy hiện tại.
- Không lỗi native/asset.
- Migration packaged pass.
- `npm test` pass.

---

### PHASE 7 — HARDENING, TEST MATRIX, DOCS

**Mục tiêu:** chứng minh “không xung đột”, dọn dẹp, bàn giao.

Việc phải làm:

1. Chạy toàn bộ test Messenger + test automation.
2. Test matrix thủ công:
   - chat, PiP, tuck, floating bar, quick note;
   - screenshot, review, media, record;
   - monitor mở/đóng/ẩn;
   - automation 9 trang;
   - vault, promptforge, routine, scheduler, watcher, opencode, social;
   - clicker, keyer, tab clicker, phone;
   - migration, đóng/mở, quit.
3. Kiểm tra IPC 3 chiều bằng test tự động.
4. Kiểm tra security:
   - CSP; navigation; window open;
   - secret không ra renderer/log;
   - remote token/rate limit;
   - IPC fuzz vài input sai.
5. Kiểm tra perf:
   - idle CPU/RAM khi cửa sổ automation đóng;
   - không timer/interval rò;
   - DB đóng khi quit;
   - không Chrome/overlay orphan.
6. Dọn code:
   - xoá alias `window.api` nếu đã đổi hết;
   - xoá import chết;
   - không để `console.log` secret;
   - cập nhật README/docs.
7. Tắt autostart/tray của TaskOrbit cũ; hướng dẫn người dùng.
8. Viết `docs/automation/FINAL-REPORT.md`.
9. Không làm WebContentsView trong prompt này; chỉ ghi chú tùy chọn.

**Exit criteria:**

- Tất cả mục Definition of Done pass hoặc được ghi rõ là chưa verify.
- Không còn blocker.
- Báo cáo cuối đầy đủ.

---

## 7. CHECKLIST TÍNH NĂNG BẮT BUỘC

Đánh dấu từng mục khi hoàn thành. Không được bỏ mục nào.

### 7.1. Shell / hệ thống

- [ ] Một app, một process, một tray, một installer.
- [ ] Chat, PiP, tuck, floating bar, quick note không đổi.
- [ ] Screenshot, review card, media library, screen record không đổi.
- [ ] Monitor window không đổi.
- [ ] Theme 16 màu + dark mode của chat không đổi.
- [ ] `Ctrl+Alt+N` vẫn hoạt động.
- [ ] Rail button mở automation.
- [ ] Tray submenu automation.
- [ ] Single-instance: mở lần hai focus đúng cửa sổ.
- [ ] Đóng automation không quit app; quit app dọn sạch.

### 7.2. Dashboard / Home

- [ ] Thống kê provider/credential/notification/task.
- [ ] Trạng thái encryption.
- [ ] Trạng thái remote/clicker/scheduler.
- [ ] Deep link từ dashboard.

### 7.3. Today / Daily Routine

- [ ] Step done/note; persist.
- [ ] Streak.
- [ ] Draft scaffold/read/open; đường dẫn setting.
- [ ] Auto publish opt-in.
- [ ] Browser check-in login + claim.
- [ ] Dry-run không claim.
- [ ] `allowLogin: false`.
- [ ] Persistent profile.
- [ ] Screenshot lỗi.
- [ ] Thông báo kết quả.

### 7.4. Vault

- [ ] Provider CRUD.
- [ ] Credential 5 loại: username, apikey, token, 2fa, custom.
- [ ] Reveal/copy.
- [ ] Clipboard tự xoá 30s.
- [ ] Auto-hide sau 60s (nếu có).
- [ ] Export/import passphrase.
- [ ] Encryption available check.
- [ ] Không log secret.

### 7.5. Providers / OpenCode

- [ ] Đọc config OpenCode.
- [ ] Backup trước ghi.
- [ ] Write provider.
- [ ] Test connection.
- [ ] Import model.
- [ ] Form automation.
- [ ] JSON preset mở/lưu.
- [ ] Cảnh báo plaintext key.

### 7.6. Auto Click & Key Presser

- [ ] Virtual mode.
- [ ] System mode.
- [ ] Pick / Fixed / Route / Cursor.
- [ ] Preset CPS.
- [ ] Jitter.
- [ ] Clicks per tick 1–50.
- [ ] Start delay 1s.
- [ ] Duration/count.
- [ ] Double click; chuột trái/phải/giữa.
- [ ] Pause when foreground.
- [ ] Anti-idle.
- [ ] Ghost cursor.
- [ ] Hotkey F6–F10; conflict fallback.
- [ ] Key presser: key, interval, start/stop.
- [ ] Quit nhả chuột/phím.

### 7.7. Tab Auto Click

- [ ] Launch Chrome/Edge.
- [ ] Remote debugging 127.0.0.1.
- [ ] Port fallback.
- [ ] List tabs.
- [ ] Pick point.
- [ ] Start/stop.
- [ ] Focus emulation + lifecycle flags.
- [ ] Profile riêng.
- [ ] Chỉ kill PID của app.
- [ ] Đóng browser khi stop/quit.

### 7.8. PromptForge

- [ ] Lưu/xoá key OpenRouter.
- [ ] Validate key.
- [ ] Refresh catalogue.
- [ ] Free model mode; `openrouter/free`.
- [ ] Lọc model chat text.
- [ ] Fallback model free.
- [ ] Retry 404/410/429/5xx.
- [ ] Watcher 6h.
- [ ] Session list/new/save/delete/active.
- [ ] Streaming chat; stop; regenerate.
- [ ] Enhancer.
- [ ] Rules.
- [ ] Plugins.
- [ ] Markdown GFM.
- [ ] Cancel stream khi đóng cửa sổ.

### 7.9. Auto Post

- [ ] Medium draft.
- [ ] Medium public.
- [ ] Tags tối đa 5.
- [ ] LinkedIn text.
- [ ] Connections-only.
- [ ] History.
- [ ] Lỗi → notification.

### 7.10. Notifications / Watchers

- [ ] Notification list/mark read/clear.
- [ ] Push đúng cửa sổ.
- [ ] Native toast qua host.
- [ ] Không double toast.
- [ ] Watcher hash.
- [ ] Watcher keyword.
- [ ] Watcher Gmail.
- [ ] Baseline/dedupe.
- [ ] Test dry-run không notify.
- [ ] Real notify một lần.

### 7.11. Scheduler

- [ ] Daily routine.
- [ ] Check-in batch.
- [ ] LeetCode.
- [ ] Watchers.
- [ ] Enable/disable persist.
- [ ] Run now.
- [ ] Retry/backoff.
- [ ] Không chạy trùng.
- [ ] Không chạy khi task disabled.

### 7.12. Phone Control

- [ ] Enable/disable.
- [ ] Port 8787 + fallback.
- [ ] Token rotate.
- [ ] QR.
- [ ] PWA manifest/service worker.
- [ ] Endpoint status/notifications/tasks/routine/clicker.
- [ ] Token sai 401.
- [ ] Body limit/rate limit.
- [ ] Tắt server đóng port.
- [ ] Chỉ LAN, cảnh báo.

### 7.13. Settings / Logs

- [ ] Config automation.
- [ ] Theme/locale.
- [ ] Log tail.
- [ ] Open log dir.
- [ ] Log rotation.
- [ ] Không lẫn log host.

### 7.14. Build / migration / security

- [ ] Vite + esbuild build.
- [ ] `automation.html` root.
- [ ] `automation-preload.cjs`.
- [ ] `automation-main/bootstrap.cjs`.
- [ ] `automation-ui` assets.
- [ ] `asarUnpack` native.
- [ ] Electron 43 rebuild.
- [ ] Migration DB + key.
- [ ] Không xoá dữ liệu cũ.
- [ ] IPC 3 chiều.
- [ ] CSP/navigation.
- [ ] Secret không ra renderer.
- [ ] `npm test` pass.
- [ ] `npm run build` pass.

---

## 8. QUY TẮC XUNG ĐỘT CỤ THỂ

1. **App lifecycle:** chỉ Messenger. Không `app.whenReady`/`app.quit` trong module.
2. **Tray:** chỉ tray Messenger; thêm submenu.
3. **Single-instance:** chỉ Messenger.
4. **`window-all-closed`:** cửa sổ automation là auxiliary; đóng không quit.
5. **Hotkey:** host registry; kiểm tra `globalShortcut.isRegistered`; fallback;
   không `unregisterAll`.
6. **`window.api`:** preload riêng; canonical `automationApi`; alias tạm.
7. **IPC:** prefix; role; guard trước handler.
8. **CSS/DOM:** cửa sổ riêng; không import `styles.css` chat.
9. **Router:** HashRouter trong automation.html; không đổi hash chat.
10. **DB:** SQLite riêng; không đụng JSON store.
11. **UserData:** inject `automation/`; không `app.setPath`.
12. **Notification:** một adapter; không gọi `notify:show` từ automation.
13. **Scheduler:** một init; task id giữ nguyên.
14. **Port:** fallback; lưu port thực.
15. **Native:** Electron 43; rebuild; asarUnpack.
16. **Build:** pipeline riêng; không viết lại Messenger.
17. **Packaging:** files whitelist; kiểm tra asar.
18. **PiP:** không parent; không chen vào logic PiP.
19. **Monitor:** không dùng lại session/preload.
20. **Ghost cursor:** host track; skipTaskbar; focusable false.
21. **Playwright Chrome:** profile riêng; kill PID của app.
22. **Theme/locale:** host push; không import CSS.
23. **Log:** riêng; forward fatal.
24. **App identity:** giữ name/appId.
25. **Autostart:** dùng của Messenger; tắt TaskOrbit cũ.
26. **Clipboard:** host guard; clear khi quit.
27. **CSP:** chặt; không nới production.
28. **Dev origin:** chỉ dev, exact origin.
29. **OpenCode:** backup trước ghi; cảnh báo plaintext.
30. **Migration:** backup, không xoá, verify.

---

## 9. BUILD / PACKAGE CHI TIẾT

### 9.1. Scripts

```json
{
  "scripts": {
    "build:automation:ui": "vite build --config automation.vite.config.mjs",
    "build:automation:main": "node automation.esbuild.mjs",
    "build:automation": "npm run build:automation:ui && npm run build:automation:main && node scripts/copy-automation-html.mjs",
    "build": "npm run build:automation && electron-builder",
    "dev:automation": "vite --config automation.vite.config.mjs",
    "postinstall": "electron-rebuild -f -w better-sqlite3"
  }
}
```

### 9.2. Vite

- root: `src/automation/renderer`
- base: `./automation-ui/`
- outDir: absolute `<project>/automation-ui`
- emptyOutDir: true
- plugin React
- input: `index.html` của renderer

### 9.3. esbuild

```js
{
  entryPoints: ['src/automation/main/bootstrap.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: 'automation-main/bootstrap.cjs',
  external: ['electron', 'better-sqlite3', 'koffi', 'playwright-core']
}
```

Preload build tương tự, external `electron`, outfile `automation-preload.cjs`.

### 9.4. electron-builder

Thêm files:

```text
automation.html
automation-preload.cjs
automation-main/**/*
automation-ui/**/*
```

Thêm asarUnpack:

```json
[
  "node_modules/better-sqlite3/**/*",
  "node_modules/koffi/**/*"
]
```

Giữ nguyên NSIS/portable, appId, productName, icon.

### 9.5. Dependency

Runtime dependencies:

```text
better-sqlite3
koffi
playwright-core
node-cron
qrcode
```

Dev dependencies (bundled vào UI):

```text
react
react-dom
react-router-dom
react-markdown
remark-gfm
i18next
react-i18next
vite
@vitejs/plugin-react
esbuild
typescript
@types/*
electron-rebuild
```

Không đóng gói Chromium. Tab clicker dùng Chrome/Edge hệ thống.

---

## 10. DATA MIGRATION CHI TIẾT

### 10.1. Đích

```text
%APPDATA%\messenger-self-chat\automation\
├─ vault.db (+ -wal, -shm)
├─ vault.key
├─ logs\
├─ browser-profiles\
├─ checkin-failures\
├─ automation-failures\
├─ window.json
└─ migration.json
```

### 10.2. Nguồn

```text
%APPDATA%\TaskOrbit\
%APPDATA%\opencode-automation-hub\
```

Chọn thư mục có `vault.db`.

### 10.3. Quy trình

1. Nếu TaskOrbit đang chạy, yêu cầu đóng.
2. Backup đích (nếu đã có) vào `automation/backups/<date>/` bằng `.backup()`.
3. Mở source readonly; `.backup(dest)`; đóng source.
4. Copy `vault.key` nguyên byte.
5. Copy `browser-profiles` nếu người dùng đồng ý; bỏ qua được.
6. Verify counts: providers, credentials, notifications, kv keys.
7. Ghi `migration.json`.
8. Không xoá nguồn.
9. Nếu `safeStorage.decryptString(vault.key)` fail: không ghi đè; hướng dẫn
   export/import bằng passphrase.
10. Nếu đích đã có DB: không migrate đè; hiện thông báo.

### 10.4. Draft

- Giữ đường dẫn setting cũ (`Documents/TaskOrbit/Daily` hoặc tùy chọn).
- Không tự di chuyển.
- Nếu chưa có setting, dùng mặc định hiện tại của TaskOrbit.

---

## 11. BẢO MẬT

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` cho
  automation window.
- IPC guard: role theo URL + main frame + prefix; test 3 chiều.
- `shell.openExternal` chỉ https; dùng `security.externalUrl` của Messenger.
- Chặn `will-navigate`, `setWindowOpenHandler` ra ngoài.
- CSP `automation.html`:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'`.
- Secret chỉ main; `aes-256-gcm` + `safeStorage`; không log/localStorage.
- Clipboard guard; clear timer khi quit.
- Remote: token, rate limit, body limit, constant-time compare, LAN only, cảnh báo.
- Playwright profile dưới `automation/browser-profiles`; không sync cloud.
- OpenCode plaintext key: cảnh báo + backup.
- Không chạy app elevated; ghi rõ limitation clicker với cửa sổ elevated.
- Không để `automation.html` load script ngoài; Vite asset local.

---

## 12. TEST MATRIX VÀ LỆNH KIỂM TRA

### 12.1. Lệnh

```bash
cd "D:/Code folder/Messenger"
npm test
npx tsc --noEmit -p tsconfig.automation.json
npm run build:automation
npm run build
npx electron-builder --win portable
```

### 12.2. Unit/pure test

- `roleForUrl` automation.html.
- `channelAllowed` 3 chiều.
- `frameIsMain`.
- Migration path detection (mock fs/DB).
- Scheduler one-init.
- Hotkey conflict fallback.
- Port fallback.

### 12.3. Messenger regression

- Chat send/edit/delete/search/pin/reaction.
- Voice, markdown, attachment.
- PiP collapse/expand/tuck/floating bar.
- Quick note `Ctrl+Alt+N`.
- Screenshot region/review/media/record.
- Monitor open/close/hide.
- Theme 16 màu/dark.
- Settings/startup/tray.

### 12.4. Automation

- 9 trang render.
- Vault CRUD/reveal/copy/export/import.
- PromptForge key/free model/chat/stop/session.
- Routine step/draft/streak/check-in.
- Scheduler enable/disable/run now/restart.
- Watcher test/real/dedupe.
- OpenCode backup/write/test.
- Social draft/public/history.
- Clicker F6/conflict/quit.
- Tab clicker launch/list/stop.
- Phone QR/token/401/port.
- Logs tail/open.

### 12.5. Packaged

- NSIS + portable.
- Native modules load.
- Assets present.
- Migration.
- No second tray/process.
- Quit cleanup.
- Clean Windows nếu có.

---

## 13. DEFINITION OF DONE

Chỉ kết thúc khi tất cả đúng:

1. `npm test` pass.
2. `npm run build:automation` pass.
3. `npm run build` pass, tạo exe.
4. `npm start` mở chat; rail/tray mở automation.
5. Tất cả 9 trang automation render; Vault/PromptForge dùng được.
6. Migration từ TaskOrbit cũ đủ provider/credential/notification/key.
7. Không có app/tray/single-instance/notification/scheduler thứ hai.
8. Chat/PiP/monitor/screenshot/quick note/theme không đổi.
9. IPC 3 chiều đúng; chat không đọc vault; automation không ghi chat.
10. F6–F10 hoạt động/không mất hotkey; conflict có fallback.
11. Phone API bật/tắt đúng, token sai 401, port fallback.
12. Quit app dọn clicker/Chrome/server/DB/overlay.
13. Packaged exe chạy được; không thiếu native/asset.
14. Báo cáo cuối `docs/automation/FINAL-REPORT.md` đầy đủ.
15. Không commit/push/deploy; không xoá dữ liệu cũ.

Nếu mục nào chưa verify được (ví dụ máy sạch), ghi rõ **“chưa verify”**, không
được nói đã pass.

---

## 14. ĐỊNH DẠNG BÁO CÁO

Sau mỗi phase, tạo `docs/automation/PHASE-<n>-REPORT.md`:

```markdown
# Phase <n> — <tên>

## Trạng thái
PASS / PARTIAL / BLOCKED

## Đã làm
- ...

## File thay đổi
- ...

## Lệnh đã chạy
| Lệnh | Exit | Kết quả |
|---|---|---|

## Test
- ...

## Vấn đề / rủi ro
- ...

## Việc tiếp theo
- ...
```

Cuối cùng tạo `docs/automation/FINAL-REPORT.md` gồm:

- Tóm tắt kiến trúc đã triển khai.
- Danh sách tính năng đã parity.
- Kết quả test/build.
- Migration.
- Những gì chưa verify.
- Hướng dẫn chạy/gỡ.
- Diff summary (không commit).

---

## 15. ĐIỀU KIỆN DỪNG

Dừng và báo cáo ngay khi:

- Không thể rebuild `better-sqlite3` cho Electron 43 sau khi đã thử đúng quy trình.
- IPC guard không thể đảm bảo 3 chiều mà không phá Messenger.
- Migration có nguy cơ mất dữ liệu và không thể backup an toàn.
- Thiếu quyền/credential cần thiết cho một tính năng (ghi rõ, làm phần còn lại).
- Một thao tác đòi hỏi xoá dữ liệu người dùng hoặc deploy.

Không dừng chỉ vì UI chưa đẹp, thiếu screenshot, hay muốn hỏi preference.

---

## 16. BẮT ĐẦU

Bắt đầu ngay bằng Phase 0:

1. Đọc `docs/TASKORBIT-INTEGRATION.md`.
2. Audit hai codebase.
3. Chạy baseline.
4. Backup.
5. Ghi `docs/automation/PHASE-0-AUDIT.md`.
6. Đi tiếp Phase 1 nếu exit criteria pass.

Không chờ xác nhận từng phase. Chỉ dừng theo mục 15.
