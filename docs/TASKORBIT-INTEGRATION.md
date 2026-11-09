# Tích hợp TaskOrbit vào Messenger (Loopback)

> Tài liệu thiết kế — chưa thay đổi code.
>
> Mục tiêu: Messenger/Loopback là **app chính duy nhất**; toàn bộ tính năng TaskOrbit
> (Vault, OpenCode, Auto Click/Key Presser, Tab Clicker, PromptForge, Daily Routine,
> Auto Post, Watchers, Scheduler, Phone Control, Logs…) chuyển sang chạy trong cùng
> một ứng dụng, một tiến trình, một tray, một installer — không xung đột với chat,
> PiP, screenshot, monitor hay dữ liệu hiện có.

---

## 1. Kết luận trước khi đi vào chi tiết

Không thể copy `main.js`, `preload.js`, `index.html` của TaskOrbit đè lên Messenger.
Hai app được xây theo hai thế hệ khác nhau:

| | Messenger / Loopback | TaskOrbit |
|---|---|---|
| Electron | 43 | 37 |
| UI | HTML + CSS + ES module thuần, không bundler | React 18 + TypeScript + electron-vite |
| Main process | một `main.js` ~118 KB | nhiều service TypeScript |
| Lưu trữ | JSON (`messages.json`, `settings.json`), atomic + backup | SQLite `vault.db` + `vault.key` |
| Native | không có | `better-sqlite3`, `koffi` (Win32), `playwright-core` |
| Cửa sổ | chat, PiP, quick note, review, shot overlay, cam, monitor | một cửa sổ chính + ghost cursor |
| Tray / hotkey | tray riêng, `Ctrl+Alt+N` | tray riêng, `F6…F10` |
| Build | electron-builder, danh sách file cố định | electron-vite + electron-builder |

Vì vậy cách đúng là **strangler / host + module**:

1. Messenger giữ vai trò **host**: app lifecycle, single-instance, tray, window
   registry, IPC guard, notification, userData, installer.
2. TaskOrbit trở thành **một bounded context tên `automation`**: service chạy trong
   main process, UI React riêng, database riêng, preload riêng, IPC namespace riêng.
3. Không import `src/main/index.ts` của TaskOrbit (nó tự gọi `app.whenReady()`,
   tạo tray, đăng ký single-instance, `globalShortcut`, `window-all-closed`).
   Chỉ port **service** và **renderer**, thay phần “app” bằng adapter do Messenger cấp.
4. UI mở dưới dạng **Automation Workspace window** (giống mô hình cửa sổ Monitor
   đã có). Đây là phương án ít xung đột nhất; sau này có thể nhúng cùng build đó
   vào cửa sổ chính bằng `WebContentsView` mà không phải làm lại service.

---

## 2. Kiến trúc đích

```
┌──────────────────────────────────────────────────────────────────────┐
│                        MESSENGER / LOOPBACK (host)                   │
│  main.js                                                             │
│   ├─ single-instance lock        ├─ tray + menu                      │
│   ├─ chat / PiP / quick / shot   ├─ global hotkey Ctrl+Alt+N         │
│   ├─ review / cam / monitor      ├─ JSON store + migrations          │
│   ├─ IPC guard (role theo URL)   └─ notification adapter             │
│   │                                                                  │
│   └─ src/main/automation-host.js                                     │
│        ├─ automation window (BrowserWindow riêng)                   │
│        ├─ automation preload                                        │
│        ├─ lifecycle: init / shutdown                                │
│        ├─ hotkey registry (F6–F10, chống trùng)                     │
│        └─ require('../../automation-main/bootstrap.cjs')            │
│                                                                      │
│  automation.html  ──►  automation-ui/  (React build)                │
│  automation-preload.cjs                                             │
└──────────────────────────────┬───────────────────────────────────────┘
                               │  một tiến trình Electron
┌──────────────────────────────▼───────────────────────────────────────┐
│                    AUTOMATION MODULE (TaskOrbit)                     │
│  automation-main/bootstrap.cjs                                       │
│   ├─ services: vault, providers, opencode, clicker, keyer,          │
│   │            tab-clicker, prompt-forge, routine, scheduler,       │
│   │            watchers, social, remote-control, logs               │
│   ├─ db: better-sqlite3 (vault.db) + vault.key                      │
│   ├─ ipc: automation:* (đăng ký sau IPC guard của host)             │
│   └─ adapters: paths, notifications, windows, hotkeys, theme        │
│                                                                      │
│  automation-ui: React 18 + HashRouter, 9 trang TaskOrbit            │
└──────────────────────────────────────────────────────────────────────┘
```

### Nguyên tắc

- **Một tiến trình, một app**: không sidecar, không app thứ hai, không tray thứ hai.
- **Host sở hữu app lifecycle**; module chỉ sở hữu nghiệp vụ automation.
- **Host sở hữu mọi BrowserWindow chính**; module xin host tạo overlay/ghost cursor.
- **Database tách tuyệt đối**: không ghi vào `messages.json`/`settings.json`.
- **IPC tách tuyệt đối**: `automation:*`; chat không gọi được handler automation,
  automation không gọi được `store:*`, `capture:*`, `pip:*` của chat.
- **UI tách document**: cửa sổ automation có DOM/CSS/router riêng, không thể
  “đè” CSS `.page`, `.card`, `.btn` của Messenger.
- **Có thể thay mặt tiền**: service không biết UI là cửa sổ riêng hay WebContentsView.

### Vì sao cửa sổ Automation riêng (giai đoạn đầu)

Messenger đang có:

- chat DOM thuần, 16 theme, PiP/tuck-into-bar, floating bar;
- screenshot overlay toàn màn hình, review card, camera bubble;
- monitor là cửa sổ riêng với preload/role riêng;
- IPC guard phân quyền theo URL của trang.

Nhét React + CSS toàn cục + HashRouter vào `index.html` của chat sẽ va chạm ở
CSS, focus, phím tắt, router hash và vòng đời PiP. Một cửa sổ riêng:

- không chia sẻ DOM/CSS với chat;
- có preload riêng, `sandbox: true`, bề mặt tấn công nhỏ;
- lỗi UI automation không làm chết chat;
- tận dụng đúng mô hình `monitor.html` đã có;
- vẫn là **một app**: một process, một tray, một installer, mở từ rail/tray.

Nếu sau này muốn “một cửa sổ”:

- dùng `WebContentsView` gắn vào `BrowserWindow` chính (Electron 43 hỗ trợ),
  với cùng `automation.html`, cùng preload, cùng IPC;
- **không dùng iframe** (preload không chạy trong iframe, IPC phải postMessage,
  CSP/focus/keyboard phức tạp);
- **không chuyển toàn bộ Messenger sang React** chỉ để nhúng một trang.

---

## 3. Cây thư mục đích

```
Messenger/
├─ main.js                          # host: thêm require automation-host
├─ automation.html                  # entry HTML ở root (bắt buộc, xem IPC policy)
├─ automation-preload.cjs           # build output preload
├─ automation-main/                 # build output main bundle (CJS)
│  └─ bootstrap.cjs
├─ automation-ui/                   # build output React (assets)
├─ automation.vite.config.mjs
├─ automation.esbuild.mjs
├─ src/
│  ├─ main/
│  │  ├─ automation-host.js         # cầu nối host ↔ module
│  │  ├─ automation-window.js       # tạo/quản lý cửa sổ automation
│  │  ├─ automation-migrate.js      # copy dữ liệu TaskOrbit cũ
│  │  └─ … (store, security, ipc-policy, …)
│  └─ automation/
│     ├─ main/
│     │  ├─ bootstrap.ts            # entry cho esbuild
│     │  ├─ ipc.ts                  # đăng ký automation:*
│     │  ├─ paths.ts                # thay app.getPath('userData')
│     │  ├─ adapters/host.ts        # notify/window/theme/locale
│     │  └─ services/               # port từ TaskOrbit
│     ├─ preload/index.ts
│     ├─ renderer/                  # React app
│     └─ shared/                    # types + ipc-channels
├─ scripts/
│  └─ copy-automation-html.mjs
└─ docs/TASKORBIT-INTEGRATION.md    # tài liệu này
```

`automation.html` **phải nằm ở root app**, không nằm trong thư mục con: hàm
`roleForUrl()` trong `src/main/ipc-policy.js` chỉ cấp role cho file `file://`
có thư mục cha đúng bằng thư mục app. Đây là chi tiết dễ làm hỏng toàn bộ IPC.

---

## 4. Hợp đồng giữa host và module

`automation-main/bootstrap.cjs` export:

```ts
export interface AutomationHost {
  /** Thư mục riêng: %APPDATA%\messenger-self-chat\automation */
  userDataDir: string
  appVersion: string
  /** Cửa sổ automation hiện tại, hoặc null khi đã đóng */
  getWindow(): BrowserWindow | null
  /** Native notification + click mở đúng route */
  notify(input: {
    title: string
    body: string
    route?: string
    priority?: 'low' | 'normal' | 'high'
    silentIfFocused?: boolean
  }): void
  getTheme(): { mode: 'light' | 'dark'; accent: string }
  getLocale(): 'vi' | 'en'
  /** Đăng ký hotkey toàn cục; trả false nếu bị app khác chiếm */
  registerHotkey(id: string, accelerator: string, handler: () => void): boolean
  unregisterHotkey(id: string): void
  /** Ghi log lỗi nghiêm trọng vào error.log của host */
  logError(scope: string, error: unknown): void
}

export function initAutomation(host: AutomationHost): Promise<void>
export function shutdownAutomation(): Promise<void>
export function openAutomationRoute(route: string): void
```

Quy tắc:

- Module **không** gọi `app.whenReady()`, `app.quit()`, `app.requestSingleInstanceLock()`,
  `app.setLoginItemSettings()`, `new Tray()`, `globalShortcut.unregisterAll()`.
- Module **không** gọi `app.getPath('userData')` trực tiếp. Tất cả đường dẫn đi qua
  `paths.ts` được khởi tạo bằng `host.userDataDir`.
- Module **không** dùng `BrowserWindow.getAllWindows()` để gửi push. Chỉ gửi cho
  `host.getWindow()`; nếu cửa sổ đóng thì bỏ qua (hoặc lưu queue ngắn).
- Module **không** tự `new Notification()`; gọi `host.notify()`.
- Module **không** tự đăng ký hotkey; gọi `host.registerHotkey()`.
- Mọi lỗi khởi tạo module phải bị bắt tại `automation-host.js`; chat vẫn chạy bình
  thường, tray hiện mục “Automation failed to start”.

---

## 5. Vòng đời

### Khởi động

```
app.requestSingleInstanceLock()          // host, giữ nguyên
app.whenReady()
  ├─ storeMigrations.migrate(...)        // host, giữ nguyên
  ├─ installIpcGuard(...)                // host, PHẢI trước khi đăng ký handler
  ├─ createWindow() / createTray()       // host, giữ nguyên
  └─ initAutomation({ ... })             // module
       ├─ paths.init(host.userDataDir)
       ├─ migrateTaskOrbitData()         // lần đầu
       ├─ getDb()                        // vault.db
       ├─ registerAutomationIpc()        // automation:*
       ├─ initScheduler(host adapter)
       ├─ initClickerHotkey(host registry)
       ├─ applyRemoteConfig()            // chỉ khi user đã bật
       └─ startPromptForgeModelWatcher()
```

Thứ tự quan trọng: **IPC guard phải được cài trước khi module đăng ký handler**.
Nếu không, handler của automation sẽ nằm ngoài guard và mọi cửa sổ đều gọi được.

### Tắt

`app.on('will-quit')` của host gọi `shutdownAutomation()` **trước** khi host thoát:

1. dừng auto clicker/key presser (nhả phím/chuột, tránh kẹt);
2. dừng tab clicker + đóng Chrome do app khởi chạy (chỉ PID của app);
3. đóng remote server;
4. dừng scheduler + watchers;
5. dừng PromptForge stream/watcher;
6. `db.pragma('wal_checkpoint(TRUNCATE)')` rồi `closeDb()`;
7. huỷ hotkey của automation (không `unregisterAll` — host còn `Ctrl+Alt+N`).

### Khi đóng cửa sổ Automation

- Cửa sổ bị destroy để giải phóng renderer; **service vẫn chạy** (scheduler,
  watchers, remote server nếu bật, PromptForge watcher).
- Auto clicker/key presser/tab clicker: tiếp tục chạy nếu đang chạy, vì chúng là
  tác vụ toàn cục; tray hiện trạng thái + nút “Stop all”. Nếu muốn an toàn hơn,
  cấu hình “stop when window closes” — mặc định nên là **tiếp tục**, giống TaskOrbit.
- Mở lại: tạo cửa sổ mới, load đúng route gần nhất; không khởi tạo lại DB/service.
- Cửa sổ automation **không** được tính là cửa sổ chat trong logic
  `window-all-closed`/tuck/PiP của Messenger. Đăng ký nó vào danh sách auxiliary
  và loại trừ khỏi quyết định “đóng cửa sổ cuối thì thoát”.

### Single-instance / deep link

- Giữ nguyên lock của Messenger. TaskOrbit không được tạo lock thứ hai.
- `second-instance` của Messenger: nếu argv có `--automation` thì mở/focus
  automation window; ngược lại giữ hành vi chat hiện tại.
- Tray/rail mở automation: nếu cửa sổ đã có thì `show()/focus()`; nếu chưa thì tạo.

---

## 6. IPC, preload và policy

### 6.1. Namespace

Đổi toàn bộ kênh TaskOrbit sang tiền tố `automation:`:

```ts
// src/automation/shared/ipc-channels.ts
export const IPC = {
  appGetInfo: 'automation:app:get-info',
  credentialsList: 'automation:credentials:list',
  // … tất cả handler hiện có
}
export const PUSH = {
  notification: 'automation:push:notification',
  automationLog: 'automation:push:automation-log',
  taskUpdate: 'automation:push:task-update',
  routineLog: 'automation:push:routine-log',
  clickerStatus: 'automation:push:clicker-status',
  promptForgeEvent: 'automation:push:promptforge'
}
```

Lý do: Messenger đã có `app:openDataFolder`, `app:startAtLogin`, `notify:show`,
`settings:*`; TaskOrbit có `app:get-info`. Không prefix sẽ va chạm hoặc tranh
quyền với handler của chat.

### 6.2. Role mới trong `ipc-policy.js`

Thêm vào `PAGE_ROLES`:

```js
'automation.html': 'automation'
```

Thêm permission (chỉ cần clipboard; automation không cần camera/mic):

```js
automation: new Set(['clipboard-sanitized-write'])
```

Thêm luật kênh. `ROLE_CHANNELS` hiện là exact-match; có thể thêm nhánh prefix
nhưng phải chặn chiều ngược lại:

```js
function channelAllowed(channel, role) {
  if (Object.prototype.hasOwnProperty.call(ROLE_CHANNELS, channel)) {
    return ROLE_CHANNELS[channel].includes(role)
  }
  // MỌI kênh automation:* chỉ role automation được gọi…
  if (channel.startsWith('automation:')) return role === 'automation'
  return DEFAULT_ROLES.includes(role)
}
```

Ngoại lệ cần khai báo rõ trong `ROLE_CHANNELS`:

```js
'automation:open': CHAT,          // rail/tray chat mở cửa sổ
'automation:status': CHAT,        // chat đọc badge/trạng thái (read-only)
'automation:close': ['automation']
```

Như vậy:

- chat gọi `automation:open`/`status` được, nhưng không gọi được
  `automation:credentials:list`;
- automation gọi mọi `automation:*` được, nhưng không gọi được `store:save`,
  `capture:*`, `pip:*`;
- monitor/quick/review/shot/cam không gọi được gì của automation.

Viết test cho cả 3 chiều trước khi làm UI.

### 6.3. Preload

`automation-preload.cjs` (build từ `src/automation/preload/index.ts`):

- expose `window.automationApi` là canonical;
- trong giai đoạn chuyển đổi, expose thêm alias `window.api` **chỉ trong cửa sổ
  automation** để code React TaskOrbit hiện tại chạy mà không phải sửa toàn bộ
  `window.api.*`. Alias này an toàn vì là document riêng, nhưng nên bỏ sau khi
  đổi import sang `automationApi`.

Preload của chat (`preload.js`) chỉ thêm:

```js
automation: {
  open: route => ipcRenderer.send('automation:open', route),
  status: () => ipcRenderer.invoke('automation:status')
}
```

Không nhét toàn bộ API automation vào preload chat.

### 6.4. Envelope và push

Giữ `IpcResult<T>` (`{ ok, data?, error? }`) của TaskOrbit. Handler nào throw
cũng phải trả `{ ok: false, error }`, không để lộ stack ra renderer.

Push chỉ gửi tới `host.getWindow()`:

```ts
const win = host.getWindow()
if (win && !win.isDestroyed()) {
  win.webContents.send(PUSH.notification, item)
}
```

Không dùng `BrowserWindow.getAllWindows().forEach(...)` — sẽ gửi notification
automation sang chat/PiP và có thể lộ dữ liệu.

### 6.5. Dev mode

`roleForUrl()` chỉ chấp nhận `file://`. Nếu muốn HMR của Vite:

- chỉ khi `!app.isPackaged`;
- chỉ chấp nhận đúng origin `http://localhost:5174` (không wildcard);
- coi đường dẫn `/` hoặc `/index.html` là role `automation`;
- production không được nới luật này.

Cách an toàn hơn: `vite build --watch` + `npm start`, không thêm dev origin.

---

## 7. Dữ liệu và migration

### 7.1. Vị trí mới

```
%APPDATA%\messenger-self-chat\
├─ messages.json                 # Messenger — KHÔNG đụng
├─ settings.json                 # Messenger — KHÔNG đụng
├─ files\, voice\, captures\     # Messenger — KHÔNG đụng
└─ automation\
   ├─ vault.db (+ -wal, -shm)    # TaskOrbit SQLite
   ├─ vault.key                  # master key (safeStorage/DPAPI)
   ├─ logs\
   ├─ browser-profiles\          # profile Playwright theo account
   ├─ checkin-failures\
   ├─ automation-failures\
   ├─ window.json                # bounds cửa sổ automation
   └─ migration.json             # dấu vết đã migrate
```

Không đổi `name` trong `package.json` (`messenger-self-chat`) và không đổi
`appId` (`com.loopback.desktop`) trong giai đoạn này: userData và danh tính cài
đặt của Messenger phải giữ nguyên. Đổi tên sẽ làm app trông như “mất hết dữ liệu”.

### 7.2. Migration từ TaskOrbit

Nguồn có thể là:

```
%APPDATA%\TaskOrbit\
%APPDATA%\opencode-automation-hub\
```

Kiểm tra cả hai; chọn thư mục có `vault.db`.

Quy trình một lần:

1. Nếu TaskOrbit đang chạy, yêu cầu đóng (kiểm tra lock/process; không copy khi
   đang ghi).
2. Mở source bằng `better-sqlite3` readonly, dùng `.backup(dest)` (bao gồm WAL)
   thay vì copy tay 3 file.
3. Copy `vault.key` nguyên byte. Key được `safeStorage` (DPAPI) mã hoá theo user
   Windows hiện tại; cùng máy/cùng user thì decrypt được. Nếu `decryptString`
   thất bại: không ghi đè, hiện hướng dẫn export/import vault bằng passphrase.
4. Copy `browser-profiles` nếu người dùng đồng ý (có thể rất lớn); bỏ qua được.
5. Không copy `logs` cũ trừ khi cần điều tra.
6. Ghi `migration.json` (source, thời điểm, kích thước, kết quả).
7. Verify: đếm providers/credentials/notifications/kv keys; hiện summary.
8. **Không xoá dữ liệu cũ.** Giữ TaskOrbit cũ ít nhất một phiên bản để fallback.

Dữ liệu nhạy cảm:

- `vault.key` + `vault.db` phải đi cùng nhau; copy lẻ sẽ không giải mã được.
- Không log secret, không đưa key vào renderer.
- Backup trước migration: dùng `.backup()` vào `automation/backups/<date>/`,
  không copy file đang mở.

### 7.3. Draft và dữ liệu ngoài userData

- Draft Daily Routine hiện có thể nằm ở `Documents/TaskOrbit/Daily` (theo setting).
  Giữ nguyên đường dẫn đã cấu hình; không tự di chuyển.
- Browser profile/check-in failure chuyển vào `automation/` như trên.
- OpenCode config vẫn ở `~/.config/opencode/opencode.json`; không liên quan userData.
- PromptForge API key nằm trong `kv_config` của `vault.db`, đã mã hoá bằng
  `vault.key`; migration copy cả hai là đủ.

### 7.4. Tương thích schema

- Giữ nguyên schema `vault.db` hiện tại; không đổi tên bảng.
- Nếu cần bảng mới, thêm migration có version trong `kv_config` hoặc bảng
  `schema_version`; chạy trước khi service dùng DB.
- `better-sqlite3` mở một connection duy nhất trong main; WAL + `busy_timeout`.
- Không mở DB từ renderer.

---

## 8. UI / UX

### 8.1. Điểm vào

- Thêm một nút vào rail trái của Messenger (icon orbit/automation), cạnh các nút
  screenshot/quick note; `data-tip` mô tả “Automation — vault, providers,
  clicker, PromptForge, routine…”. Click gọi `window.api.automation.open()`.
- Thêm mục trong tray: `Automation ▸ Open`, `Auto Clicker: Start/Stop`,
  `Run Daily Routine now`, `Stop all automation`, `Phone Control: On/Off`.
- Không thêm tray thứ hai, không thêm icon taskbar riêng cho automation.

### 8.2. Cửa sổ

```js
new BrowserWindow({
  width: 1440, height: 900, minWidth: 1100, minHeight: 700,
  title: 'Automation — Loopback',
  icon: APP_ICON,
  autoHideMenuBar: true,
  backgroundColor: dark ? '#0f1117' : '#f6f7f9',
  webPreferences: {
    preload: path.join(__dirname, 'automation-preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  }
})
```

- `sandbox: true` được vì preload chỉ dùng `electron` + `contextBridge`; nếu
  preload cần `node:crypto`, chuyển việc sinh `streamId` sang main hoặc dùng
  Web Crypto (`globalThis.crypto.randomUUID()`), đừng tắt sandbox.
- Không đặt `parent` (cửa sổ độc lập, maximize được); không modal.
- `show: false` + `ready-to-show`.
- Nhớ bounds trong `automation/window.json`; kiểm tra display còn tồn tại.
- `setWindowOpenHandler` → chỉ mở `https:` bằng `shell.openExternal`, còn lại deny.
- Chặn `will-navigate` ra ngoài `automation.html`.

### 8.3. React app

- Giữ 9 trang hiện có: Home/Dashboard, Today/Routine, Vault, Providers,
  Auto Click & Key Presser, Tab Clicker, PromptForge, Auto Post,
  Notifications/Watchers, Scheduler, Phone Control, Settings, Logs.
- Dùng **HashRouter** (`automation.html#/vault`) để chạy được với `file://` và
  deep link từ tray (`#/notifications`). Không dùng BrowserRouter.
- Router hash nằm trong document riêng, không ảnh hưởng chat.
- Bỏ qua `src/main/index.ts` và mọi thứ liên quan tray/window của TaskOrbit;
  giữ `App.tsx`, pages, components, CSS.
- Nếu sau này nhúng bằng `WebContentsView`, vẫn dùng HashRouter; không đổi sang
  router của Messenger.

### 8.4. Theme và ngôn ngữ

- Không import `styles.css` của Messenger vào React app.
- Host cấp token qua `automationApi.host.getTheme()` và push khi đổi theme:
  `{ mode, accent, background, surface, text, border }`.
- Map accent của Messenger (16 theme) sang biến CSS của TaskOrbit; không cần
  giống 100%, nhưng phải đọc được ở cả light/dark.
- Ngôn ngữ: TaskOrbit có en/vi. Nếu Messenger chưa có setting ngôn ngữ, để
  automation tự chọn và lưu trong config; nếu sau này Messenger có, host push
  locale xuống. Không chia sẻ instance i18next với vanilla JS.

### 8.5. Notification

- TaskOrbit ghi notification vào DB và push item cho UI (như hiện tại).
- Native toast đi qua `host.notify()`; host dùng `Notification` của Electron
  (hoặc handler `notify:show` đã có), click mở đúng route automation.
- Tránh double toast: nếu cửa sổ automation đang focus, có thể chỉ hiện in-app;
  native chỉ khi unfocused (`silentIfFocused`).
- Không trộn notification automation vào danh sách chat; badge/tray riêng.
- Watcher/automation không được gọi `notify:show` trực tiếp qua IPC chat.

### 8.6. Command palette / phím tắt

- Palette `Ctrl+K` của TaskOrbit chỉ hoạt động khi cửa sổ automation focus.
- Không đăng ký `Ctrl+1…9` toàn cục; chúng là phím nội bộ của React app.
- Hotkey toàn cục duy nhất của automation là clicker (F6–F10), đăng ký qua host.
- Không đụng `Ctrl+Alt+N` của quick note.

---

## 9. Map từng tính năng

| Tính năng | Nguồn TaskOrbit | Đích | Cách tích hợp | Rủi ro chính |
|---|---|---|---|---|
| Dashboard/Home | `Home.tsx`, stats | `#/home` | Reuse; đọc DB/service qua IPC | Số liệu trùng nguồn |
| Today/Daily Routine | `routine.ts`, `routine-state.ts`, `draft.ts`, `browser-checkin.ts` | `#/` | Reuse; scheduler + adapter notify; draft path giữ nguyên | Playwright profile, login, timezone |
| Vault | `credential-vault.ts`, `database.ts`, `encryption.ts` | `#/vault` | Reuse; DB/key trong `automation/`; clipboard guard | Migration key/DPAPI |
| Providers/OpenCode | `opencode-*.ts`, `browser-automation.ts` | `#/providers` | Reuse; ghi file ngoài app; backup trước khi ghi | Ghi plaintext key, đường dẫn config |
| Auto Clicker | `auto-clicker.ts` | `#/clicker` | Reuse; `koffi` Win32; hotkey qua host; ghost cursor qua host | F6 trùng, UAC/DPI, kẹt chuột |
| Key Presser | `key-presser.ts` | `#/clicker` | Reuse; cùng service window/status | Phím tắt trùng |
| Tab Clicker | `tab-clicker.ts` | `#/tabs` | Reuse; Playwright + Chrome debug port; profile riêng | Port 9222 trùng, Chrome treo |
| PromptForge | `prompt-forge.ts`, `PromptForge.tsx` | `#/promptforge` | Reuse; API key trong vault; free model watcher; stream push | Token/stream, CSP ảnh markdown |
| Auto Post | `social-posters.ts` | `#/social` | Reuse; credential từ vault; network từ main | Rate limit, token hết hạn |
| Notifications | `notification-service.ts` | `#/notifications` | DB reuse; native qua host; push đúng window | Double toast |
| Watchers | `scheduler.ts`, `leetcode-tracker.ts`, `alert-service.ts` | `#/notifications` | Reuse; một scheduler; dedupe | Chạy trùng khi cả 2 app |
| Scheduler | `scheduler.ts` | `#/scheduler` | Reuse; `initScheduler` một lần; task id giữ nguyên | Cron trùng, DST/missed |
| Phone Control | `remote-control.ts`, `remote-web.ts` | `#/remote` | Reuse; HTTP 8787 → fallback; PWA sinh runtime | Firewall, port, LAN security |
| Settings | `PromptForgeModals`, config | `#/settings` | Module config riêng; theme/locale bridge | Hai nơi chỉnh theme |
| Logs | `logs.ts`, `logger.ts` | `#/logs` | Log file riêng; tail qua IPC; open dir | Lẫn log host |
| Tray/hotkeys | `index.ts` (bỏ) | Host | Viết lại menu; hotkey registry | Tray thứ hai |
| Auth/phone token | `remote-control.ts` | Host | Token trong DB; QR; rate limit | Lộ token qua URL |

### Ghi chú theo nhóm

**Vault**: giữ `aes-256-gcm` + `safeStorage`; không đổi format ciphertext. Key
`vault.key` copy từ bản cũ. Nếu người dùng chuyển máy, chỉ export/import có
passphrase mới cứu được dữ liệu — hiện UI đã có, giữ nguyên.

**OpenCode**: service ghi `opencode.json` bên ngoài app, có backup. Đây là thao
tác nguy hiểm nhất về dữ liệu người dùng; giữ nguyên backup + xác nhận. Không
đổi đường dẫn config để tránh “mất provider” với người dùng OpenCode.

**Auto clicker**: `koffi` gọi Win32 trên main thread; chỉ Windows. Trên macOS/Linux
ẩn/disable trang, đừng crash. Khi quit phải `stopClicker()` để nhả chuột. Nếu
app không elevated, không click được cửa sổ elevated — giữ limitation này.

**Tab clicker**: TaskOrbit tạo Chrome/Edge với remote debugging. Đổi port nếu
9222 bận; bind debugging `127.0.0.1`, không ra LAN. Chỉ kill process do app tạo,
không kill Chrome của người dùng.

**PromptForge**: key OpenRouter mã hoá trong `kv_config`; `openrouter/free` mặc
định; watcher 6 giờ; retry 1 lần khi 404/410/429/5xx. API call ở main, không CORS.
Khi đóng cửa sổ, cancel stream để không giữ `AbortController`/socket.

**Scheduler**: `initScheduler` hiện nhận `mainWindow`; đổi thành adapter
`{ notify, runTask, getWindow }`. Chỉ gọi một lần trong `initAutomation`. Task id
giữ nguyên để config `enabled` cũ khớp. Không để cả TaskOrbit cũ và Messenger
cùng chạy cron.

**Phone Control**: `server.listen(port, '0.0.0.0')`; thêm fallback 8788–8799 khi
`EADDRINUSE`; lưu port thực. Chỉ bật khi user bật; hiện cảnh báo “chỉ dùng Wi-Fi
tin cậy, không mở Internet”. Token so sánh constant-time; giới hạn body; không
đọc file tùy ý.

**Social**: gọi API Medium/LinkedIn từ main; token lấy từ vault; lỗi trả về
notification. Không dùng browser automation trừ khi cần.

**Watchers**: giữ dedupe/hash/keyword/Gmail; notification qua host. Nếu Messenger
ngủ/resume, có thể bỏ lỡ cron — ghi limitation; có thể catch-up một lần khi
`powerMonitor.resume` (tùy chọn).

---

## 10. Ma trận xung đột và cách xử lý

| # | Xung đột | Hậu quả nếu bỏ qua | Cách xử lý |
|---|---|---|---|
| 1 | Hai `app.whenReady()` / hai main entry | Tray/window/DB khởi tạo hai lần | Không import `src/main/index.ts`; chỉ `initAutomation()` từ host |
| 2 | Hai single-instance lock | App thứ hai không mở / tranh cửa sổ | Chỉ Messenger giữ lock; bỏ lock TaskOrbit |
| 3 | Hai tray | Hai icon, menu rối | Chỉ tray Messenger; thêm submenu Automation |
| 4 | `window-all-closed` | Đóng cửa sổ automation làm thoát app | Đăng ký auxiliary window; loại khỏi quyết định quit |
| 5 | `globalShortcut.unregisterAll` | Mất `Ctrl+Alt+N` khi automation quit | Chỉ unregister hotkey của automation |
| 6 | `window.api` trùng tên | Chat/automation ghi đè API của nhau | Cửa sổ riêng + preload riêng; canonical `automationApi` |
| 7 | Kênh `app:*` trùng | Handler sai chạy | Prefix toàn bộ `automation:` |
| 8 | IPC guard không biết role mới | Chat gọi được vault, hoặc automation bị chặn | Thêm `automation.html` role + prefix rule + test 3 chiều |
| 9 | `roleForUrl` chỉ nhận file root | Automation bị `ipc-denied` | Đặt `automation.html` ở root |
| 10 | CSS toàn cục `.page/.card/.btn` | Giao diện chat vỡ | Cửa sổ riêng (hoặc Shadow DOM/WebContentsView) |
| 11 | Router hash | Đổi hash làm chat nhảy trang | HashRouter trong document riêng |
| 12 | JSON store vs SQLite | Ghi đè/mất chat | DB riêng `automation/vault.db` |
| 13 | `app.setPath('userData')` | Messenger mất dữ liệu | Không set global; inject `automation/` |
| 14 | Notification đôi | 2 toast cho 1 sự kiện | Một adapter `host.notify()` |
| 15 | Scheduler đôi | Routine/check-in chạy 2 lần | Một `initScheduler`; tắt autostart app cũ |
| 16 | Port 8787 | Phone API không lên | Fallback port + hiện URL thực |
| 17 | Electron 37 → 43 | `better-sqlite3` ABI lỗi | `@electron/rebuild` cho Electron 43; test packaged |
| 18 | Không có bundler | React/native không chạy | Build riêng Vite + esbuild; không viết lại Messenger |
| 19 | `build.files` whitelist | Thiếu JS/native trong exe | Thêm `automation-*`, `asarUnpack` native |
| 20 | PiP/tuck/floating bar | Cửa sổ automation chen ngang | Không đặt parent; ẩn/hiện độc lập; không tính vào PiP |
| 21 | Monitor window | Dùng nhầm session/preload | Không tái sử dụng; role riêng |
| 22 | Ghost cursor overlay | Taskbar/quit bất thường | `skipTaskbar`, `focusable:false`, host track, đóng khi quit |
| 23 | Playwright Chrome | Kill nhầm Chrome người dùng | Chỉ kill PID do app tạo; profile riêng |
| 24 | Theme/locale | Giao diện lệch, đổi ngôn ngữ sai | Host push token/locale; không import CSS |
| 25 | Log/error | Lẫn log, khó debug | Log riêng; forward fatal qua `host.logError` |
| 26 | App name/appId | Mất userData/installed identity | Giữ `messenger-self-chat` + `com.loopback.desktop` |
| 27 | Autostart | Hai app khởi động cùng Windows | Dùng `startAtLogin` của Messenger; tắt TaskOrbit cũ |
| 28 | Clipboard guard | Secret còn trong clipboard | Dùng host clipboard + timer; clear khi quit |
| 29 | CSP ảnh markdown | Ảnh trong PromptForge không hiện | `img-src 'self' data: blob: https:`; cân nhắc privacy |
| 30 | Dev Vite origin | Guard chặn HMR hoặc nới quá rộng | Chỉ dev, exact origin, không áp dụng production |

---

## 11. Build và đóng gói

### 11.1. Vì sao cần build riêng

Messenger không có bundler; React/TS của TaskOrbit không thể `require()` trực
tiếp. Không chuyển cả Messenger sang Vite (rủi ro cao, làm hỏng PiP/monitor).
Thay vào đó thêm **một pipeline automation độc lập**:

```
src/automation/renderer  ──Vite──►  automation-ui/  + automation.html (root)
src/automation/preload   ──esbuild──►  automation-preload.cjs
src/automation/main      ──esbuild──►  automation-main/bootstrap.cjs
```

### 11.2. Scripts

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

`copy-automation-html.mjs` copy `automation-ui/index.html` → `automation.html`
ở root. Đặt Vite `base: './automation-ui/'` để asset path đã đúng khi HTML
được copy ra root.

### 11.3. Vite

- `root: src/automation/renderer`
- `base: './automation-ui/'`
- `build.outDir: <project>/automation-ui` (absolute, tránh tính `../` sai)
- `build.emptyOutDir: true`
- plugin React.
- Không dùng `index.html` của Messenger làm input.

### 11.4. esbuild

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
`node-cron` và `qrcode` có thể bundle; `react-markdown`/`remark-gfm` nằm trong
UI bundle.

### 11.5. Dependency

Thêm vào `dependencies` của Messenger (không phải dev, vì main require lúc runtime):

- `better-sqlite3`
- `koffi`
- `playwright-core`
- `node-cron`
- `qrcode`

Thêm vào `devDependencies` (vì đã bundle vào UI):

- `react`, `react-dom`, `react-router-dom`, `react-markdown`, `remark-gfm`,
  `i18next`, `react-i18next`
- `vite`, `@vitejs/plugin-react`, `esbuild`, `typescript`, `@types/*`,
  `@electron/rebuild`

Giữ `electron` 43; **không hạ xuống 37**. `better-sqlite3` phải rebuild theo
Electron 43; `koffi` là N-API prebuilt nhưng vẫn phải test packaged.

### 11.6. electron-builder

Thêm vào `build.files`:

```
"automation.html",
"automation-preload.cjs",
"automation-main/**/*",
"automation-ui/**/*"
```

Thêm `asarUnpack` cho native:

```json
"asarUnpack": [
  "node_modules/better-sqlite3/**/*",
  "node_modules/koffi/**/*"
]
```

Lưu ý:

- `files` hiện là whitelist; thiếu `automation-ui` sẽ ra exe trắng.
- `playwright-core` chỉ là client; **không** đóng gói Chromium. Máy đích cần
  Chrome/Edge cài sẵn cho tab clicker/browser check-in.
- `better-sqlite3` kéo theo `bindings`, `file-uri-to-path`; để electron-builder
  tự gom production deps hoặc thêm pattern nếu thiếu.
- Portable build giải nén vào `%TEMP%`; native `.node` phải nằm trong
  `app.asar.unpacked`, không load từ trong asar.
- Kiểm tra dung lượng: `playwright-core` + native làm exe tăng đáng kể; chấp
  nhận được nhưng cần đo.

### 11.7. Dev flow

Cách an toàn:

```
npm run build:automation
npm start
```

Cách có HMR (chỉ dev):

```
npm run dev:automation        # Vite 5174
set AUTOMATION_DEV_URL=http://localhost:5174
npm start                     # automation window load URL dev
```

Nếu dùng cách 2, phải thêm dev-only role rule như mục 6.5; production vẫn chỉ
`file://`.

---

## 12. Bảo mật

- Giữ `contextIsolation: true`, `nodeIntegration: false`; automation window
  `sandbox: true`.
- IPC guard: role theo URL + main-frame + namespace; test cả 3 chiều.
- Không expose `ipcRenderer`, `require`, `process` qua contextBridge.
- `shell.openExternal` chỉ `https:` qua `security.externalUrl` của Messenger.
- Chặn `will-navigate`/`setWindowOpenHandler` ra ngoài app.
- CSP cho `automation.html`:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'`.
  API call nằm ở main nên renderer không cần connect ra ngoài.
- Secret: chỉ ở main, mã hoá `aes-256-gcm` + `safeStorage`; không localStorage,
  không log, không gửi qua IPC trừ khi user bấm Reveal/Copy.
- Clipboard guard dùng host; clear timer khi quit.
- Remote server: token, rate limit, body limit, constant-time compare, chỉ LAN,
  cảnh báo firewall; không auto-enable.
- Playwright profile chứa cookie đăng nhập: để trong `automation/browser-profiles`,
  không sync cloud, không share giữa account.
- OpenCode ghi key plaintext vào config ngoài app: giữ cảnh báo + backup.
- Không chạy automation với quyền admin mặc định; clicker không click được cửa
  sổ elevated — ghi rõ limitation.

---

## 13. Test và tiêu chí nghiệm thu

### Unit / pure test (không cần Electron)

- `roleForUrl('file:///.../automation.html')` → `automation`.
- `automation.html?pip=1` vẫn là automation (không phải pip).
- `channelAllowed('automation:credentials:list', 'chat')` → false.
- `channelAllowed('automation:open', 'chat')` → true.
- `channelAllowed('store:save', 'automation')` → false.
- `channelAllowed('automation:anything', 'monitor')` → false.
- `frameIsMain` vẫn chặn subframe.
- Migration path detection, copy plan, marker (mock fs/DB; không load native
  trong node:test).
- Scheduler idempotent/one-init; hotkey conflict fallback; port fallback.

### Messenger regression

- `npm test` (17 file hiện có) pass.
- Chat: gửi/nhận, edit/delete, search, pin, reaction, voice, markdown, theme.
- PiP: collapse/expand, tuck, floating bar, multi-monitor.
- Screenshot: region, review card, media library, screen record.
- Monitor window: mở/đóng, feed, ẩn/hiện.
- Quick note `Ctrl+Alt+N`.
- Settings/startup/tray.

### Automation integration

- Mở từ rail và tray; đóng/mở lại giữ DB.
- 9 trang load đúng; deep link `#/notifications` từ tray.
- Vault: tạo/sửa/xoá credential; reveal/copy; clipboard tự xoá.
- PromptForge: lưu key, refresh model free, chat stream, stop, đổi model.
- Scheduler: task chạy đúng giờ; không chạy 2 lần; disable persist.
- Watcher: test dry-run không notify; real notify 1 lần.
- Clicker: F6 start/stop; đổi hotkey khi trùng; quit không kẹt chuột.
- Tab clicker: launch Chrome, list tab, start/stop, đóng Chrome.
- Phone: bật server, QR mở trên điện thoại cùng Wi-Fi; sai token bị 401;
  tắt server đóng port.
- OpenCode: backup trước ghi; test provider.
- Social: publish thử với token; lỗi hiện notification.

### Packaged / clean Windows

- Cài NSIS + chạy portable trên máy sạch.
- Không thiếu `automation.html`/asset/native.
- `better-sqlite3` load được; `koffi` load được.
- Không có thêm tray/process thứ hai.
- Migration từ bản TaskOrbit cũ: đủ credential/notification/key.
- Gỡ cài đặt không để lại process/Chrome treo.
- Antivirus/SmartScreen: exe unsigned sẽ cảnh báo; ghi chú.

### Tiêu chí “không xung đột”

1. Một process, một tray, một installer.
2. Chat/PiP/monitor/screenshot hoạt động y hệt trước tích hợp.
3. Không có notification/scheduler chạy trùng.
4. Không có hotkey nào bị mất khi mở/đóng automation.
5. Đóng automation không làm thoát app; quit app dừng sạch clicker/Chrome/server.
6. Dữ liệu Messenger không bị migration automation chạm vào.
7. IPC: chat không đọc được vault; automation không ghi được chat store.

---

## 14. Lộ trình triển khai

### Phase 0 — Baseline (0.5–1 ngày)

- Chạy `npm test`, `npm start`, build exe hiện tại; lưu bản chạy được.
- Tạo branch `feature/automation-integration`.
- Inventory kênh IPC/service TaskOrbit; chốt danh sách port.
- Backup `%APPDATA%\messenger-self-chat` và dữ liệu TaskOrbit.

**Exit:** có baseline exe + test pass + danh sách kênh.

### Phase 1 — Tách module, chạy headless (3–5 ngày)

- Copy `src/main/services`, `src/shared`, `src/preload` sang `src/automation/`.
- Bỏ `app` khỏi service: thay bằng `paths.ts`, `host.ts`.
- Đổi import `@shared` sang alias của module.
- Viết `bootstrap.ts` export `initAutomation/shutdownAutomation`; **không** copy
  `index.ts`.
- Build esbuild; chạy một script Node/Electron tối giản gọi init, mở DB, list
  providers/notifications để chứng minh service sống.

**Exit:** service khởi tạo/đóng sạch, không cần UI, không tạo tray/window.

### Phase 2 — Host + cửa sổ + IPC (3–5 ngày)

- `automation-host.js`: đường dẫn, init/shutdown, bắt lỗi.
- `automation-window.js`: BrowserWindow, preload, bounds, deep link.
- `automation.html` root + build rỗng (hello + gọi `automation:app:get-info`).
- `ipc-policy.js`: role automation, prefix rule, `automation:open/status`.
- Rail + tray entry.
- Test IPC 3 chiều; test đóng/mở không quit app.

**Exit:** mở cửa sổ automation từ Messenger, gọi được 1 handler, chat không bị ảnh hưởng.

### Phase 3 — UI thật + Vault/PromptForge (4–6 ngày)

- Build React đầy đủ; HashRouter; 9 trang render.
- Theme/locale bridge.
- Vault + PromptForge hoàn chỉnh (2 trang nặng nhất về IPC/secret).
- Notification adapter + push đúng window.

**Exit:** dùng được Vault/PromptForge trong app mới; dữ liệu cũ migrate.

### Phase 4 — Core services (4–6 ngày)

- Scheduler, Routine, Draft, Browser check-in, Watchers, OpenCode, Social.
- Một scheduler; notification không trùng; OpenCode backup.
- Tray actions: run routine, stop all.

**Exit:** routine/watcher/scheduler chạy đúng, không chạy trùng.

### Phase 5 — Win32 + Phone (4–6 ngày)

- Auto clicker/key presser: koffi, ghost cursor, hotkey registry.
- Tab clicker: Chrome/Edge, port fallback, profile, cleanup.
- Phone Control: server, QR, PWA, port fallback, firewall message.

**Exit:** F6 hoạt động, phone mở được, quit sạch.

### Phase 6 — Đóng gói + migration (3–5 ngày)

- electron-rebuild, asarUnpack, files list, portable/NSIS.
- Migration script + UI một lần; verify counts.
- Clean Windows test; sửa thiếu asset/native.

**Exit:** exe cài mới chạy đủ, migrate đủ, không lỗi native.

### Phase 7 — Hardening (3–5 ngày)

- Test matrix đầy đủ; perf idle; memory; log rotation.
- Security review IPC/CSP/remote.
- Docs, troubleshooting; tắt autostart/tray của TaskOrbit cũ.
- (Tùy chọn) WebContentsView inline mode.

**Exit:** nghiệm thu “không xung đột”; sẵn sàng thay app cũ.

### Ước lượng

- MVP (Vault + PromptForge + scheduler + cửa sổ): **8–12 ngày**.
- Full parity (tất cả tính năng + phone + clicker + packaging): **4–6 tuần**
  cho 1 dev quen codebase; có thể lâu hơn nếu native module/packaging phát sinh.
- Inline WebContentsView: +3–5 ngày.

Đây là ước lượng thô; rủi ro lớn nhất nằm ở native ABI, IPC guard và packaging,
không nằm ở React UI.

---

## 15. Phương án đã cân nhắc và lý do loại

| Phương án | Ưu | Nhược | Kết luận |
|---|---|---|---|
| **Cửa sổ Automation riêng** | Ít xung đột nhất; theo mô hình Monitor; preload/sandbox riêng | Không “một cửa sổ” tuyệt đối | **Chọn giai đoạn 1** |
| WebContentsView nhúng | Một cửa sổ; vẫn tách webContents | Xử lý bounds/PiP/tuck/focus; phức tạp | Giai đoạn 2 tùy chọn |
| Iframe trong index.html | Rẻ | Preload không chạy; IPC postMessage; CSP/focus | Không |
| Sidecar process | Cô lập | Hai app/tray/process; IPC nặng | Không |
| Viết lại Messenger bằng React | Đồng nhất | Rủi ro mất PiP/monitor/chat; rất lớn | Không |
| Giữ 2 app dùng chung DB | Nhanh | Không phải “một app”; trùng scheduler/hotkey | Không |
| Chỉ copy service, bỏ UI TaskOrbit | Nhẹ | Mất tính năng UI đã làm | Không |

---

## 16. Checklist trước khi bắt tay

- [ ] Chốt tên hiển thị: vẫn `Loopback`, hay đổi `Messenger`? (Không đổi
      `name`/`appId`/userData.)
- [ ] Chốt cửa sổ riêng hay WebContentsView ngay từ đầu.
- [ ] Chốt hành vi khi đóng cửa sổ automation: service tiếp tục chạy?
- [ ] Chốt hotkey clicker: F6 mặc định, fallback F7–F10 hay để user chọn.
- [ ] Chốt port phone mặc định 8787 + fallback.
- [ ] Chốt có migrate browser profile (cookie đăng nhập) hay không.
- [ ] Chốt có giữ TaskOrbit cũ cạnh tranh trong thời gian chuyển đổi không
      (khuyến nghị: tắt autostart, chỉ dùng Messenger).
- [ ] Có bản backup dữ liệu trước mọi migration.
- [ ] Có test IPC 3 chiều trước khi làm UI.

---

## 17. Tóm tắt một câu

**Messenger giữ nguyên vai trò app host; TaskOrbit được đóng gói thành module
`automation` với database, preload, IPC namespace và cửa sổ riêng; chỉ có service
và giao diện được port, không có app/tray/single-instance thứ hai — nhờ vậy hai
app lớn kết hợp mà không giẫm lên nhau.**
