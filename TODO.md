# Cleanup & Verification Log

## v1.4.0 — Vòng sửa UI: nút floating bar, section kéo co giãn, theme

### Bối cảnh (bạn yêu cầu)
1. Mở lại màn hình từ floating bar: mấy nút dễ bấm nhầm (thu nhỏ / tắt) và cảm giác “mất luôn floating bar” → cần tooltip nói rõ từng nút, và trừ nút tắt ra thì các nút khác phải luôn để lại floating bar; đã tắt thì vào app bấm nút floating bar vẫn dựng lại được.
2. Nút tròn “Show chats” vẫn hiện cả khi danh sách chat đang mở → khi section mở thì không hiện nút đó.
3. Các section phải kéo ra/vô được tuỳ ý.
4. Theme phải đẹp hơn.

### Đã sửa
- **Tooltip tự viết** (`src/renderer/tip.js`): `data-tip` (câu mô tả đầy đủ) hoặc `title` → hiện bong bóng giải thích sau 200ms, tự lật lên/xuống, luôn nằm trong cửa sổ; khi hiện thì **ẩn `title` gốc** rồi trả lại y nguyên lúc rời chuột (hudtest đọc `title` của 5 nút bubble nên không được xoá). Trong bubble thu gọn (56px) **không** hiện tooltip — ở đó để `title` cho OS vẽ ra ngoài cửa sổ. Gắn mô tả cho **38 nút**: 8 nút header popup, 5 nút bubble, 7 nút rail, composer, sidebar, header panel.
- **Nút ✕ là nút duy nhất “phá” floating bar**: `#btnPipClose` được tô đỏ khi hover (`.danger-btn`), và 6 handler trong `main.js` (`pip:collapse`, `pip:expand`, `pip:resize`, `pip:dock`, `pip:flip`, `pip:maximize`) giờ **dựng lại bar nếu cửa sổ đã bị đóng** thay vì im lặng không làm gì → “thu nhỏ” không bao giờ là cú click chết; đóng thì `pip:close` vẫn đưa cửa sổ chat về như cũ.
- **Nguyên nhân thật của “mất luôn floating bar”**: các panel (Media library / Recording / Settings) và whiteboard nằm **ngoài `.app`** (z-index 250) nên khi cửa sổ thu về 56×248, panel vẫn phủ lên trên → nhìn như bar biến mất. Nay `collapsePip()` và `pip:state = collapsed` **đóng hết panel trước**, kèm CSS chặn cứng `body.pip-mode.pip-collapsed .settings-panel/.canvas-panel{display:none!important}`.
- **Nút “Show chats”** (`sidebar.js`): thêm class `sidebar-open` tính từ trạng thái thật (`MutationObserver` trên class của `body` + `matchMedia(720px)`) thay vì chỉ dựa vào `sidebar-collapsed`; CSS `body.sidebar-open .sb-reopen{display:none!important}` → nút chỉ còn khi danh sách chat **không** hiện, kể cả trong popup nổi (nơi danh sách tự hiện từ 720px).
- **Kéo co giãn section** (`src/renderer/panelsize.js` + grip trong `index.html`/`styles.css`): sidebar (tay phải), Media library / Recording / Settings (tay trái). Kéo bằng pointer (không cần OS edge-drag), clamp theo cửa sổ, lưu vào `settings.json` (`sidebarWidth`, `mediaPanelWidth`, `miniPanelWidth`, `settingsPanelWidth`), double-click tay kéo = về mặc định, resize cửa sổ thì tự clamp lại. Kích thước đặt bằng CSS var (`--sb-w`, `--w-media`…) chứ không inline để `body.sidebar-collapsed` và media query 440px vẫn thắng.
- **Theme** (`styles.css`): 16 theme có bubble gradient **đậm/rực hơn** (mọi stop đều ≥4.6:1 với chữ trắng — đã đo trước khi chọn màu) + **wallpaper cho cả 16 theme ở cả light lẫn dark** (glow theo hue theme + gradient nền), wallpaper dời từ cột `.messages` (780px) sang nguyên `.chat` nên nền chạy hết chiều ngang; thêm bóng bubble, header kính mờ, shadow panel theo accent, viền tab active.
- **Hai bug thật phát hiện trong lúc sửa**: `--chat-wall` và `--focus-ring` từng khai báo ở `:root` nhưng lại tham chiếu `var(--accent)` (định nghĩa ở `body`) → custom property đó **compute thành guaranteed-invalid và mất trắng**: theme mặc định (blue) không có wallpaper, và **focus ring bàn phím không hề hiện**. Đã dời cả hai sang block `body` (nơi có `--accent`).

### Kiểm chứng (đều chạy thật)
- [x] `uitest.js` (suite mới, 25 check): tooltip hiện/đúng vị trí/trả lại `title`; nút Show chats ẩn-hiện đúng theo trạng thái; kéo sidebar 300→390 và media panel 360→440, cả hai ghi vào `settings.json`; minimize khi đang mở panel → bar 56×248 + panel đã đóng; close là nút duy nhất làm mất bar; **`pip:collapse` sau khi đã close vẫn dựng lại bar**; 32 tổ hợp theme/mode đều có wallpaper 2 lớp; cột tin nhắn trong suốt; focus ring vẽ ra thật → **RESULT PASS**.
- [x] `audittest.js` PASS: 32 tổ hợp theme giữ contrast (xấu nhất `onSolid` 4.51, bubble 4.6), 106 id DOM đều tồn tại, 65 đường `api.*` đều có trên bridge, 0 console error, không `error.log`.
- [x] `piptest.js` PASS toàn bộ (drag, expand, collapse cùng tick, resize/flip giữ tâm, minimize → bar, mở lại app).
- [x] `combotest.js` **RESULT PASS** (không có dòng FAIL nào). `hudtest.js`, `menutest.js` PASS (5 nút bubble vẫn đủ `title`, panel 320×420 vẫn không cắt chữ).
- [x] **Build 1.4.0 + đẩy lên GitHub** (bạn yêu cầu “build cho tui exe mới xóa exe cũ đi đồng thời push lên github lun”):
  - `package.json` **1.3.9 → 1.4.0**; `npx electron-builder --win` → `dist\Loopback Setup 1.4.0.exe` (103.773.638 B), `dist\Loopback 1.4.0.exe` (103.551.522 B), blockmap + `latest.yml` version **1.4.0**.
  - **Asar bản build:** 86 entry (86 file), **62/62 file `src/*.js` đọc được**, hash SHA-256 **SAME** với working tree cho `src/renderer/tip.js`, `src/renderer/panelsize.js`, `src/renderer/main.js`, `main.js`, `index.html`, `styles.css`, `preload.js`; `package.json` trong asar = **1.4.0**.
  - **Dọn `dist/`:** xoá `Loopback 1.3.9.exe`, `Loopback Setup 1.3.9.exe`, blockmap 1.3.9 và `win-unpacked` → **198M**, chỉ còn bộ 1.4.0.
  - **Chạy thử bản portable 1.4.0** với profile vứt đi (`%LOCALAPPDATA%\Temp\lb-portable-140`): 7 tiến trình, cửa sổ `Loopback` `Responding: True`, tự tạo `files/`+`voice/`+`captures/`+`pip.json`, **không có `error.log`**; tắt riêng bản portable — **không đụng** app 1.3.9 đang chạy của bạn (vẫn đủ 7 tiến trình sau đó).
  - **Push:** commit `632953b` → `github.com/Annguyen0410/Loopback` nhánh `main` (`15ccb02..632953b`, không cần force).
  - **Chưa cài đè** lên bản 1.3.9 đang chạy (bạn chỉ yêu cầu build + xoá exe cũ + push). App đang mở vẫn là 1.3.9; muốn lên 1.4.0 thì: tắt app → chạy `dist\Loopback Setup 1.4.0.exe` (appId giữ nguyên nên cài đè tại chỗ, dữ liệu trong `%APPDATA%\messenger-self-chat` không đổi).

## v1.3.9 — Đổi tên app: *Messenger Self-Chat* → **Loopback**

### Bối cảnh (bạn yêu cầu)
“nên đổi tên app thành gì nhỉ hmmm chứ messenger self chat hơi kì để launch trên product hunt” → chốt **Loopback**, làm ngay (đổi nhãn + build + cài + verify).

### Vì sao Loopback
- 1 từ, 8 ký tự, không dấu không gạch nối, đọc được cả tiếng Việt lẫn tiếng Anh. *loopback* = gói tin được định tuyến vòng về chính máy đã gửi — đúng nghĩa đen của app “chat với chính mình”.
- Đã tra trùng trước khi chốt: `Monologue` (Every.to), `Murmur`, `Cairn`, `Outpost` đều đã có chủ; `Confidant` chồng vùng với các app AI journal. `Loopback` chỉ trùng tên framework Node.js *LoopBack* của IBM/StrongLoop — khác ngành hoàn toàn.
- Bỏ hẳn chữ “Messenger” (thương hiệu Meta) khỏi appId / tiêu đề cửa sổ / shortcut.

### Đổi nhãn — những gì đã sửa
- `package.json`: `productName` + `nsis.shortcutName` → `Loopback`, `appId` `com.messenger.selfchat` → **`com.loopback.desktop`**, `description`/`keywords`, version **1.3.9**.
- `index.html`: `<title>Loopback</title>` + chữ trong bubble PiP (`pip-bubble-text`).
- `src/renderer/settings.js` (toast “start with Windows”), `src/renderer/main.js` (log khởi tạo).
- `README.md`: tiêu đề + tên exe/thư mục cài + mục giải thích vụ đổi `appId`.
- **Cố ý giữ nguyên `name: "messenger-self-chat"`** trong `package.json` → thư mục dữ liệu `%APPDATA%\messenger-self-chat` không đổi → đổi thương hiệu mà **không thể mất dữ liệu**.

### Kiểm chứng (không đoán, đều chạy thật)
- [x] `npx electron-builder --win` → `dist\Loopback Setup 1.3.9.exe` + `dist\Loopback 1.3.9.exe`, `latest.yml` version **1.3.9**.
- [x] **Asar bản build:** 84 entry = 80 file (17 root + 61 `src/` + 2 `assets/`) + 4 entry thư mục. Script tạm diff asar ↔ working tree: `only in asar: none`, `only on disk: none` (2 mục “thừa” trước đó chỉ là entry thư mục `src/monitor`, `src/renderer`). `package.json` trong asar = **1.3.9**; title / bubble / toast / log đều đã là `Loopback`, **không còn chuỗi `Messenger` cũ** trong UI.
- [x] **Backup dữ liệu trước khi gỡ bản cũ:** `%TEMP%\loopback-backup-20260929-130331` (33MB, có cả `captures/`).
- [x] **Đổi `appId` nên KHÔNG cài đè tại chỗ được như các bản trước** (electron-builder coi appId khác là app khác → sẽ cài song song). Nên: tắt app (6 tiến trình) → chạy `Uninstall Messenger Self-Chat.exe /S` → **exit 0**, thư mục `%LOCALAPPDATA%\Programs\Messenger Self-Chat` biến mất sau **1s**.
- [x] Hash SHA-256 của `messages.json` / `settings.json` / `pip.json` / `data.json` **y hệt** sau khi gỡ (`files/`, `voice/`, `captures/` vẫn còn) → uninstall không đụng dữ liệu.
- [x] Cài `Loopback Setup 1.3.9.exe /S` → **exit code 0**. `%LOCALAPPDATA%\Programs\Loopback\Loopback.exe` → **ProductVersion 1.3.9.0**, ProductName `Loopback`; asar đã cài khớp đúng bản build.
- [x] Shortcut: Start Menu `Loopback.lnk`, Desktop (`C:\Users\nguye\OneDrive\Desktop`) `Loopback.lnk`; Add/Remove Programs chỉ còn **`Loopback 1.3.9`** — không còn dấu vết “Messenger Self-Chat”.
- [x] **Mở app thật:** 7 tiến trình `Loopback.exe`, cửa sổ tiêu đề **`Loopback`**, `Responding: True`, **không có `error.log`**; hash 4 file dữ liệu + `files/` + `voice/` + `captures/` vẫn y hệt baseline.
- [x] **Dọn `dist/`:** xoá 1.3.8 (installer, portable, blockmap) + `win-unpacked` → chỉ còn bản 1.3.9 (**198M**).

### Ghi chú cho lần sau
- **Đừng bao giờ đổi `name` trong `package.json`** — đổi là app trỏ sang thư mục dữ liệu mới và người dùng tưởng mất hết tin. Đổi thương hiệu chỉ cần `productName` + `appId` + `nsis.shortcutName` + chuỗi chữ trong UI.
- Từ 1.3.9 trở đi thì `appId` giữ nguyên → các bản sau lại **cài đè tại chỗ** được. Bản cài: `%LOCALAPPDATA%\Programs\Loopback\`; bản portable: `dist\Loopback 1.3.9.exe`.
- Backup dữ liệu tạm ở `%TEMP%\loopback-backup-20260929-130331` — xoá được sau khi bạn dùng thử vài ngày thấy ổn.

## v1.3.8 — Build lại exe mới (nguồn bị xoá khỏi working tree, khôi phục từ asar 1.3.7)

### Bối cảnh (bạn yêu cầu)
“hiện tại tạo luôn phiên bản mới của app nha kiểu build exe file mới xóa mấy cái exe cũ đi á”

### Phát hiện trước khi build (kiểm tra bằng `ls` / `git status`, không đoán)
- [x] `package.json` và `main.js` **không còn trong thư mục dự án** (`git status`: ` D` cho cả hai) → `npm run build` không thể chạy. Ba file `app.js`, `renderer.js`, `monitor.js` cũng ở trạng thái đã xoá, nhưng đó là bản monolith cũ — đúng như refactor sang `src/renderer` + `src/monitor`.
- [x] **Khôi phục `main.js`** (78.950 byte) từ asar 1.3.7 đã giải nén sẵn ở `_asarcheck/`, rồi **đối chiếu trước khi tin**: 10/10 file html/css/js của `_asarcheck` **giống hệt từng byte** bản trong working tree (`cmp` → SAME), `diff -rq src _asarcheck/src` → identical → file khôi phục đúng là bản nguồn đang chạy trong app đã cài, không phải bản cũ nào khác. `node --check main.js` OK.
- [x] **Tạo lại `package.json`** với đúng danh sách file mà electron-builder 1.3.7 đã pack (lấy từ `dist/builder-debug.yml` của chính bản build cũ, không tự bịa), version **1.3.8**, giữ nguyên `appId` / `productName` / `nsis` / `buildResources: assets`.

### Kiểm chứng
- [x] `npx electron-builder --win` → `Messenger Self-Chat Setup 1.3.8.exe` (NSIS) + `Messenger Self-Chat 1.3.8.exe` (portable).
- [x] **Asar trong bản build kiểm tra thật:** 84 entry; **61/61 file `src/` có mặt**; 25 file mẫu (`main.js`, `preload.js`, 4 html, css, quick/cam/shot overlay, `assets/icon.*`, `src/renderer/main.js`, `src/renderer/capture.js`, `src/renderer/gallery.js`, `src/monitor/{main,net,finance}.js`, `news-sources.json`) **hash SHA-256 khớp từng byte** với working tree; `package.json` trong asar = `1.3.8`.
- [x] `audittest.js` với profile vứt đi (`AUDITTEST_USERDATA`) → **RESULT PASS** (mọi cửa sổ mở/đóng được, 16 theme đạt tương phản, popup thu về bar đúng 56×248, 0 console error, **không ghi `error.log`**, không sót cửa sổ nào).
- [x] **Dọn `dist/`:** xoá `Messenger Self-Chat 1.3.6.exe` + 1.3.7 (installer, portable, blockmap) và thư mục `win-unpacked` → **952M → 198M**, chỉ còn bản 1.3.8.
### Cài đè 1.3.8 (theo đúng quy trình các bản trước)
- [x] **Baseline dữ liệu trước khi cài** (để chứng minh không mất gì): `messages.json` 3.243 byte, 3 chat / 13 tin, `files/` 3, `voice/` 1, `captures/` 12, không có `error.log`.
- [x] **Bản portable 1.3.8 chạy thử thật** (profile tạm `--user-data-dir`): tiến trình lên, tự tạo `files/` + `voice/` + `captures/` + `pip.json`, **cửa sổ hiện ra thật** (tiêu đề `Messenger`, `Responding: True`), không `error.log`; sau đó tắt sạch, không sót tiến trình nào và không để rác trong `%TEMP%`.
- [x] Đóng app 1.3.7 đang chạy (bạn mở lúc 11:13) → mở cài đặt **NSIS silent** → **installer exit code 0**.
- [x] Bản đã cài: `%LOCALAPPDATA%\Programs\Messenger Self-Chat\Messenger Self-Chat.exe` → **ProductVersion 1.3.8.0**.
- [x] **Asar đã cài kiểm tra thật** (không đoán): `version: 1.3.8`, 84 entry, **61/61 file `src/`**, **25/25 file mẫu hash SHA-256 khớp từng byte** với working tree, và 3 fix của 1.3.7 vẫn còn nguyên trong bản đã cài (`polymarket` trong main.js, `loadCrypto`+`loadFearGreed`+`polymarket` trong `finance.js`, `DIRECT_BLOCKED`+`THROTTLED` trong `net.js`).
- [x] **Dữ liệu người dùng nguyên vẹn sau khi cài**: `messages.json` vẫn 3.243 byte – 3 chat / 13 tin, `files/` 3, `voice/` 1, `captures/` 12, không có `error.log`.
- [x] Mở lại app → tiến trình chạy đúng exe **đã cài** (không phải bản portable), cửa sổ `Messenger` hiện ra, vẫn **không có `error.log`**.

## v1.3.7 — World Monitor real-time hoá: hết thời chỉ load 1 lần lúc mở, thêm Polymarket live, sửa bug nuốt feed

### Bối cảnh (bạn yêu cầu)
“Mấy cái đó có cập nhật theo real time không dị, chứ đừng có chỉ có thông tin đó mỗi ngày — phải theo real time. Và sửa bug típ.”

### Audit real-time (kết luận: phần lớn đã real-time, 3 chỗ không)
- [x] **Đã real-time sẵn (kiểm tra từng vòng poll, không đoán):** động đất USGS 20s (hub chính) / 60s, tin tức 30s (19 nguồn RSS thật), chứng khoán/hàng hoá/FX 30s, GDACS 60s, GDELT 60s, thời tiết 2–3 phút, chất lượng không khí 5 phút, space weather 5 phút, máy bay OpenSky 45s, ISS 10s, thời tiết cảng INFRA 5 phút, network I/O 1s, CPU/MEM 2s, đồng hồ 1s, day/night 60s, mặt trăng 1 giờ. ĐÃ có push-hub ở main process: poll trong main → gửi `monitor:live` vào cửa sổ đang mở, chỉ gửi khi dữ liệu THAY ĐỔI (signature), chống chồng poll.
- [x] **KHÔNG real-time (đã sửa hết):** tab FINANCE chỉ load ĐÚNG 1 LẦN lúc mở tab — crypto / Fear & Greed đóng băng cả buổi, World Bank cả năm không thấy bản mới; tab INFRA thời tiết cảng cũng render 1 lần rồi thôi (mở qua đêm là gió “hiện tại” thành gió hôm qua); GDP macro chỉ refresh khi mở tab.

### Đã làm — real-time hoá
- [x] **FINANCE tự cập nhật khi tab đang mở:** crypto + global stats mỗi 3 phút, Fear & Greed mỗi 5 phút, World Bank macro mỗi 60 phút. Timer chỉ bắn khi tab Finance đang active (không poll mù khi đang xem tab khác).
- [x] **INFRA tự cập nhật:** thời tiết cảng re-poll mỗi 5 phút khi tab INFRA đang mở (cadence khớp update interval của Open-Meteo). Cable catalog + World Bank energy là dữ liệu tĩnh nên không poll (tránh đốt băng thông vô ích).
- [x] **NGUỒN LIVE MỚI — Prediction Markets qua Polymarket gamma API (free, không key):** trước đây ô này ghi cứng “No free live source” trong khi API công khai vẫn chạy. Giờ: top 8 thị trường mở theo volume 24h (≥ $100k), xác suất leading outcome [%] live, tooltip đầy đủ (side, volume, ngày hết hạn), refresh mỗi 2 phút. Thêm host vào allowlist proxy (main.js) + CSP connect-src (monitor.html).

### Bug thật tìm ra và sửa trong v1.3.7
- [x] **`net.js` tự triệt hạ canh CORS của chính nó — mọi feed “healthy” bị ép đi qua proxy vĩnh viễn.** Điều kiện thử direct là `!DIRECT_OK.has(host) && !THROTTLED.has(host) && !DIRECT_BLOCKED.has(host)`: host đã trả lời direct thành công MỘT LẦN sẽ bị `!DIRECT_OK` chặn đường direct từ lần sau → 100% poll sau đó đi vòng qua main-process proxy, tăng độ trễ (đo được: 195ms direct vs chậm hơn qua proxy) và tải cho proxy chỉ vì dấu `!` thừa. Fix: chỉ skip direct khi host 429 (`THROTTLED`) hoặc đã fail CORS (`DIRECT_BLOCKED`). Cái này ảnh hưởng TẤT CẢ feed (quakes, weather, IODA, airq, cables, worldbank, satnogs…) — test bắt được khi panel cảng INFRA báo “Open-Meteo unreachable” dù API trả 200 trực tiếp.
- [x] **1 feed chết xoá sạch cả tab Finance.** `loadLiveFinance()` bọc TẤT CẢ trong một try/catch: CoinGecko lỗi (429 rất hay xảy ra) → catch rơi vào → commodities + currencies + yield + Fear & Greed bị ghi đè hết thành “OFFLINE” dù những nguồn đó có trong tay. Giờ tách thành loader riêng từng section (`loadCrypto`, `loadFearGreed`, prediction markets) — mỗi cái tự chịu trạng thái OFFLINE của chính nó, chết nguồn nào tối ô đó.
- [x] **GDACS/GDELT/IODA unreachable hiển thị thành “thế giới yên tĩnh”.** Fetcher trả `null` khi feed không gọi được nhưng renderer chỉ check `!items.length` → hiện “No recent GDACS alerts” / “No GDELT events” / “No major outages” — diễn đạt SAI sự thật (bão đang ngoài kia mà panel bảo không có). Giờ phân biệt rõ: `null` → “GDACS/GDELT/IODA unreachable — retrying…”, `[]` → “No … alerts” thật. Kèm sửa render ở main.js không còn nuốt lỗi bằng `.catch(()=>{})`-style.
- [x] **Ngày GDELT in ra rác `20260929T0`.** `a.seendate.slice(0,10)` nhưng định dạng thật là `20260929T041500Z` (không phải ISO) → cột ngày thành 10 ký tự vô nghĩa đầu chuỗi. Đã parse đúng `seenDateMs()` → `2026-09-29`.
- [x] **Conflict events vào log thiếu timestamp riêng** (dùng giờ poll thay giờ báo chí đưa tin) → truyền `time` từ seendate.
- [x] **Threat log lệch múi giờ với events log.** Cột phải ghi `getHours()` (giờ local), events log ghi UTC → 2 panel cạnh nhau chênh 7h (VN), nhìn như lỗi dữ liệu. Thống nhất UTC.

### Kiểm chứng
- [x] **`monitortest.js` mới — 32/32 PASS, 0 console error** (8 nhóm): không xoá chéo tab khi 1 nguồn chết (render đúng từng ô), 4 timer finance đúng cadence 3m/5m/2m/60m, prediction markets render % live từ payload thật, timer cảng 5m + bảng cảng render được, GDACS reachable hiện item thật / GDELT+IODA unreachable hiện đúng trạng thái (không còn “No alerts” giả), seendate → ngày thật, threat log = UTC giờ hiện tại, main.js giữ poll 20s/30s + allowlist polymarket.
- [x] `monitor-test.js` (bộ cũ): map layers đầy đủ — 400 máy bay thật, ISS live, 60 hazard, 22 cảng, 10 chokepoint… 0 console error → không hồi quy sau khi sửa `net.js`.
- [x] Build + cài đè **1.3.7** (NSIS silent), xác minh asar đã cài chứa cả 3 fix (net.js, finance polling + polymarket, unreachable states), dữ liệu người dùng nguyên vẹn.

## v1.3.6 — Test tổ hợp: dùng nhiều thứ cùng lúc, sửa nốt bug, build lại exe“Dưới tâm thế là tester, test tất cả mọi thứ trong app, test cực kỳ, **test tổ hợp** để tránh lỗi khi dùng nhiều thứ cùng một lúc, sửa xong thì build lại app exe sẵn sàng cho việc làm.”

### Trả lời trước về ảnh crash bạn gửi lại
- [x] **Ảnh đó là ảnh CŨ (từ 1.3.2), không phải lỗi mới.** Bằng chứng: `%APPDATA%\messenger-self-chat\error.log` **không tồn tại** (lưới an toàn `uncaughtException` sẽ ghi file này nếu main process còn crash), và trong bản cài 1.3.5 dòng `main.js:1695` chỉ là **dấu `}` đóng hàm `createWindow`** — không thể ném lỗi ở đó (ở 1.3.2, dòng 1695 cột 54 đúng là `win.isMinimized()`). Đã kiểm tra bằng cách giải nén asar đã cài, không đoán.

### Bộ test tổ hợp mới: `combotest.js` — **54 check**
Các bộ cũ mỗi bộ chứng minh **một** tính năng chạy đúng. Bộ này bắt app dùng **nhiều thứ cùng lúc**:
- [x] **A.** Cửa sổ chat + popup nổi + **cả 3 panel cùng lúc** (Settings, Media, Recording) + popup ghi nhanh + cửa sổ monitor — mở cùng nhau, không cái nào đóng cái nào.
- [x] **B.** Gửi tin từ **popup → hiện ở cửa sổ chat** và ngược lại; hai cửa sổ thống nhất chat đang mở; **gửi dồn 10 tin liên tiếp** → đủ 10, không trùng, không mất, render ở cả hai cửa sổ.
- [x] **C.** Đổi theme ở cửa sổ chat → popup theo ngay; **đo lại tương phản ngay trong popup** sau khi đổi (17.5:1 / 18.9:1); **Esc** khi popup đang mở → thu về bubble, cửa sổ không chết.
- [x] **D.** Trong lúc mọi thứ đang mở: **6 lần thu/mở liên tiếp**, lật dọc↔ngang 2 lần (phải về đúng hướng cũ), phóng to/rrestore (đúng bằng work area), dock, thu gọn — không cửa sổ nào bị destroy, không cửa sổ nào nửa sống nửa chết.
- [x] **E.** **Ghi màn hình thật** (thiết bị giả lập như `rectest`) **từ bubble đã thu gọn**, rồi trong lúc đang ghi: **thu app vào bar**, **mở + huỷ khung chọn vùng chụp ảnh**, **đổi theme**, **bung popup** — frame vẫn chạy liên tục, HUD vẫn còn, camera bubble vẫn sống, và cuối cùng **dừng ghi → lưu được file thật**.
- [x] **F.** Chụp ảnh vùng khi có **cả bubble lẫn camera bubble** trên màn hình: cả hai được **đẩy ra ngoài khung hình** (không bị chụp vào ảnh), **`pip.json` không bị ghi đè**, và sau khi huỷ cả hai **về đúng chỗ cũ**.
- [x] **G.** Thư viện media + **tìm kiếm trong chat trong lúc thư viện đang mở** (không ăn mất chữ đang gõ dở) + **mở preview video vừa ghi** + **xoá file khi thư viện đang mở** (có hỏi trước, xoá thật, lưới + empty state vẫn nhất quán).
- [x] **H.** Thu app vào bar khi các cửa sổ khác đã đóng, mở app lần nữa (second-instance) để cửa sổ chat hiện lại, nút rail khi bar đang mở → bung thành popup, đóng bar → **cửa sổ chat vẫn còn trên màn hình**.
- [x] **I.** Không cửa sổ nào bắn lỗi console trong suốt chuyến đi, **không ghi `error.log`**, không sót cửa sổ nào trên màn hình.

### Bug thật tìm ra và sửa trong v1.3.6
- [x] **Popup chat nổi được sinh ra với kích thước bong bóng (56×248) nhưng tự nhận là “đã bung”.** `openPip()` đặt `pipCollapsed = false` rồi tạo cửa sổ ở **cỡ pill**; điều kiện auto-expand (`if (pipAutoExpand && pipCollapsed)`) vì thế **không bao giờ chạy**, nên khi mở “floating chat” bạn nhận được… thanh bookmark tí hon, toàn bộ chat bị nhét vào cửa sổ 56px. Nay popup **được sinh ra ngay ở kích thước mở rộng, canh giữa màn hình** (`expandedBoundsOn(wa)` tính trước khi cửa sổ tồn tại), và khi bar đã tồn tại thì `pip:open` **bung nó** thay vì để nguyên. Kèm theo: renderer **pull** trạng thái một lần (`pip:getState()`), vì `pip:state` được gửi lúc `did-finish-load` — **có thể tới trước khi listener đăng ký xong**, và popup sẽ nằm mãi ở trạng thái pill (đúng cái đã xảy ra khi tôi thử bản sửa đầu tiên; test bắt được ngay).
- [x] **Khung chọn vùng chụp ảnh ngắn hơn màn hình đúng 48px.** Windows **kẹp cửa sổ mới vào work area** (trừ taskbar), nên overlay tạo với `height = display.bounds.height` (1080) bị co còn **1032** → **không thể chọn dải dưới cùng màn hình** (taskbar), và overlay lệch với đúng ảnh chụp mà nó đang cắt. Nay `shotWin.setBounds(displayBounds)` được áp lại ngay sau khi tạo (đã đo thực nghiệm: setBounds **sau** khi tạo thì Windows tôn trọng, `enableLargerThanScreen`/`resizable`/`fullscreen` đều không giải quyết). Test tổ hợp đo được overlay **1920×1080 = màn hình**.

### Kiểm tra thêm (không phải bug, ghi lại để khỏi nghi ngờ)
- [x] **Ghi âm phát lại được**: mở preview clip vừa ghi trong thư viện → `duration 1.979s`, `readyState 4`, `seekable` 1 đoạn, bấm play là chạy (nhờ `local-file://` trả **206 + accept-ranges**). Trước đây tôi nghi file webm của MediaRecorder thiếu duration trong header — đo trực tiếp thì **không phải vấn đề**.
- [x] **HUD ghi âm nằm gọn trong bubble 56×248**: 5 nút (pause / mic / cam / discard / stop) đều nằm trong viewport (`outside: []`), tức thu app lại vẫn **dừng được ghi âm**.
- [x] `pip.json` thật của bạn là `{"x":-13,"y":369,"vertical":true}` — **không phải bug**: bong bóng được kéo tự do và chỉ cần giữ ≥24px trên màn hình là hợp lệ.

### Kiểm chứng
- [x] **`combotest.js` 54/54**, `audittest.js` **36/36**, `piptest.js` **31/31** (+1 check hồi quy cho bug popup), `menutest.js` **59/59**, `camtest.js` **55/55**, `hudtest.js` **31/31**, `rectest.js` **14/14**, `captest.js` **13/13**, `searchtest.js` **19/19** → **312 check, 0 fail**.
- [x] Build + cài đè **1.3.6** (NSIS silent), mở lại app, kiểm tra asar đã cài chứa bản sửa, dữ liệu cũ nguyên vẹn, **không có `error.log`**.

## v1.3.5 — Nút "thu app lại thành floating bubble"

### Bối cảnh (bạn hỏi)
“Khi để floating bubble mở, rồi mở app lại, sao không có nút thu app lại làm floating bubble?” — đúng: nút rail (`#btnPip`) trước đây gọi `pip:toggle`, tức là **bung bubble thành popup / thu popup về bar**, nên khi thanh đã mở sẵn thì **không có cách nào thu cửa sổ chat xuống chỉ còn bubble**.

### Đã làm
- [x] IPC mới **`app:tuckIntoBar`** (bạn chọn kiểu “ẩn hẳn”): **ẩn cửa sổ chat** (mất luôn khỏi taskbar — app chỉ còn bubble), và đảm bảo thanh floating ở trạng thái **đã thu gọn + dock một bên**; nếu thanh chưa có thì mở luôn, nếu đang là popup thì thu về bar.
- [x] Nút rail `#btnPip` giờ mang đúng nghĩa đó, tooltip đổi thành *“Minimize into the floating bar — the chat window hides and the bar stays on the side”*. `togglePip` cũ vẫn giữ cho các chỗ khác.
- [x] **Chỉ đường về**: sau khi thu, main gửi `pip:hint` để **bubble tự hiện toast** *“Tap the bubble to chat — reopen the app from its shortcut”* (không để bạn bơ vơ không biết mở lại thế nào).
- [x] **Lưới an toàn**: `pip:close` giờ kiểm tra — nếu cửa sổ chat đang ẩn mà bạn đóng thanh bar thì **cửa sổ chat tự hiện lại**, tránh trường hợp app không còn gì trên màn hình.
- [x] Ba đường mở lại cửa sổ chat: (1) bấm bubble → chat popup, (2) mở app lần nữa bằng shortcut/Start menu (`second-instance` → `createWindow`), (3) đóng bar.

### Kiểm chứng
- [x] `audittest.js` thêm **4 check**: nút rail **ẩn cửa sổ + để lại bar**, thứ còn trên màn hình là **bar đã thu gọn** (không phải popup), **mở app lần nữa thì cửa sổ chat hiện lại**, và thu app khi đang mở popup thì **vẫn về bar**. Tổng `audittest` **36/36**.
- [x] Đủ 8 bộ: `piptest` 30, `menutest` 59, `camtest` 55, `hudtest` 31, `rectest` 14, `captest` 13, `searchtest` 19 — **257 check, 0 fail**.
- [x] Build + cài đè **1.3.5** (NSIS silent), chạy lại app, dữ liệu nguyên vẹn.

## v1.3.4 — Audit tổng quát: app không còn lỗi "chết UI" và đọc được ở mọi theme

### Bối cảnh (bạn yêu cầu)
“Kiểm tra tổng quát app coi lỗi và bug, sau đó chắc chắn app không gặp bug hay lỗi gì mà hoạt động như một ứng dụng ready to use.”

### Bộ test audit mới: `audittest.js` (24 check, tất cả PASS)
Thay vì kiểm tra từng tính năng, bộ này quét **toàn bộ app**:
- [x] Mở **và đóng** mọi cửa sổ: panel Settings / Recording / Media, thanh floating ở **mọi trạng thái** (thu gọn → mở rộng → toàn màn hình → restore → thu gọn → đóng), cửa sổ monitor toàn màn hình, popup ghi nhanh, và khung chọn vùng chụp.
- [x] **Không cửa sổ nào bắn lỗi ra console** trong suốt chuyến đi đó.
- [x] **Không có API chết**: 62 đường dẫn `api.*` trong code renderer đều tồn tại thật trên bridge (so preload ↔ main: 0 kênh IPC nào lệch).
- [x] **Không có selector chết**: 106 id DOM mà renderer tìm đều có trong trang.
- [x] Theme trong picker và trong `styles.css` khớp **đúng 16/16**, không theme nào mồ côi.
- [x] Độ đọc được của **cả 32 tổ hợp theme × sáng/tối** (chữ chính, chữ phụ, chữ trên nút accent, chữ trên thanh floating, **chữ trong bong bóng tin nhắn**).
- [x] Không gì được ghi vào `error.log` và **không cửa sổ nào bị bỏ lại** trên màn hình.

### Bug thật đã tìm ra và sửa
- [x] **Khối chào “Your Notes” (`#emptyState`) tự xoá chính nó.** Nó nằm trong `#messages` theo markup, mà `render()` lại `innerHTML = ""` để vẽ lại danh sách → node bị xoá khỏi DOM ngay lần render đầu, rồi `$("emptyState")` trả về `null` mãi mãi. Hệ quả: hội thoại trống **không bao giờ** hiện lời chào, chỉ là một khoảng trắng. Nay node được giữ lại và gắn lại khi danh sách rỗng (audit bắt được vì check “id renderer tìm phải tồn tại” báo `emptyState` thiếu).
- [x] **Huỷ chụp màn hình giữa lúc khung chọn đang mở** trả về `ERR_FAILED (-2) loading file:///…` → toast đỏ *“Screenshot failed: ERR_FAILED…”* cho một thao tác huỷ bình thường. Nay `openScreenshotOverlay()` phân biệt **cancel vs lỗi thật** (cờ `shotCancelled` + cửa sổ đã chết) và trả `{ok:false,canceled:true}`; renderer **không toast lỗi** khi là cancel.
- [x] **Chữ trắng trên bong bóng tin nhắn không đọc được ở 14/16 theme** (tệ nhất: ocean **2.51:1**, sunset 2.60, aurora 2.78, **forest 3.21**). Đây là chữ được đọc nhiều nhất trong app. Đã tối hoá các điểm dừng gradient (giữ **nguyên hue**, chỉ giảm sáng) đến khi đạt **≥4.6:1**: ví dụ forest `#6a9a80 → #567e68`, ocean `#6aadc0 → #4c7c8a`, sunset cả hai đầu `#bc7a68/#bd9a7d → #9f6758/#8a705b`. Kết quả: theme tệ nhất từ **2.51 → 4.58**.
- [x] **Chữ trên nút accent/thanh floating cũng dưới chuẩn**: đo được green **2.89**, teal 3.16, sunset 3.41, orange 3.42 (trắng trên nền accent) — không đọc nổi. Nay mỗi theme chọn cặp token riêng: `--on-accent` (mực đậm `#0a0c0f` cho 12 theme sáng màu, trắng cho mono/coffee/red), `--accent-solid` (nền nút; red được tối nhẹ để đủ 4.5), `--pill-shift` (hướng gradient của thanh bar — **luôn ngược màu chữ** để không đầu nào mất tương phản). Icon trong pill (`#btnBubbleChat`, 4 nút tool) đổi theo `--on-accent` nên vẫn rõ trên nền sáng.
- [x] Nút VIDEO trong thư viện media: `#ef4444` → `#c93a3a` (3.76 → 4.9:1). Avatar tin nhắn bớt chói (#0084ff → #0074e0) để chữ trắng đạt 4.6:1.
- [x] **Bản sửa của chính tôi cũng có bug và đã bị bắt**: `let overlayUp` khai báo bên trong block `try` nên `catch` không nhìn thấy → `ReferenceError`; đã khai báo ở ngoài `try`.

### Một check cũ flaky đã được làm chắc
- [x] `menutest.js` — 2 check “menu bám theo tin nhắn khi cuộn / đóng khi tin nhắn ra khỏi tầm nhìn” **thỉnh thoảng FAIL** (~50%): khi app đang tự cuộn mượt, một lệnh `scrollTop` có thể dừng đúng vị trí mà **trình duyệt không phát sự kiện scroll**, nên menu (và cả listener của test) không hề biết. Thêm helper `__scrollTo` trong test: cuộn → chờ sự kiện → nếu không có thì nudge 8px để tạo thay đổi thật rồi về đích; kèm chẩn đoán (`follow:{settled,events,tries}`) để lần sau mà lỗi thì biết ngay nguyên nhân. 3/3 lần chạy đều PASS.

### Kiểm chứng (toàn bộ đều xanh)
- [x] **`audittest.js` 32/32**, `piptest.js` **30/30**, `menutest.js` **59/59**, `camtest.js` **55/55**, `hudtest.js` **31/31**, `rectest.js` **14/14**, `captest.js` **13/13**, `searchtest.js` **19/19** — tổng **253 check, 0 fail**.
- [x] Đã build + cài đè **1.3.4** (NSIS silent) và chạy lại app, dữ liệu `messages.json` / `settings.json` / `pip.json` nguyên vẹn.

## v1.3.3 — Sửa crash "Object has been destroyed" khi mở app lần thứ hai

### Bối cảnh (bạn gửi ảnh chụp)
Ảnh `27.09.2026_19.36.05_REC.png`: hộp thoại **"A JavaScript error occurred in the main process — TypeError: Object has been destroyed, at main.js:1695:54"**. Bấm OK thì app vẫn còn thanh floating nhưng **không mở lại được cửa sổ chat**.

### Tìm ra đúng dòng gây lỗi (không đoán)
- [x] File build ra asar giữ nguyên `main.js`, nên `1695:54` **chính là dòng trong source**: `app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } })` — cột 54 là chỗ **đọc thuộc tính `win.isMinimized`**. Electron ném "Object has been destroyed" ngay khi **chạm vào** một `BrowserWindow` đã bị huỷ, không phải khi gọi xong.
- [x] Điều kiện xảy ra: **đóng cửa sổ chat trong khi thanh floating vẫn mở** → `window-all-closed` không chạy (còn cửa sổ) nên app không thoát, nhưng biến `win` vẫn đang trỏ vào cửa sổ **đã chết** (trước đây không có `closed` handler). **Mở app lần nữa** (shortcut / Start menu) → `second-instance` → chạm vào cửa sổ đã chết → hộp thoại crash. Lỗi cũ ở `activate` cũng cùng gốc: điều kiện cũ đếm *mọi* cửa sổ, kể cả thanh bar, nên **không bao giờ dựng lại cửa sổ chat**.

### Đã sửa
- [x] `win.on("closed")` → **`win = null`** (có chốt `if (win === w)`), và `createWindow()` nay dùng biến cục bộ `w` cho mọi sự kiện — sự kiện muộn của cửa sổ cũ **không thể** chạm vào cửa sổ mới.
- [x] `createWindow()` thành **idempotent**: cửa sổ đang sống thì `restore + show + focus`; đã chết/mất thì dựng mới.
- [x] `second-instance` và `activate` đều gọi `createWindow()` (có `try/catch`) → mở app lần thứ hai **luôn** đưa cửa sổ chat lên trước, kể cả khi chỉ còn thanh floating.
- [x] Thêm helper `alive(w)` và soi lại **mọi** chỗ dùng `win` / `monitorWin` / `camWin` / `quickWin` / `shotWin`: dialog chọn file & lưu file giờ tự bỏ cửa sổ cha nếu nó đã chết (`askOpen`/`askSave` — truyền `null` sẽ bị Electron hiểu là options), `monitor:open` / `monitor:close` kiểm tra trước khi `focus()` / `close()`.
- [x] **Lưới an toàn cuối**: `process.on("uncaughtException")` + `unhandledRejection` → ghi vào `userData/error.log` (tự cắt khi > 256 KB) và **app tiếp tục chạy**, không còn hộp thoại "A JavaScript error occurred in the main process" làm bạn hoảng.

### Kiểm chứng (đã chứng minh test bắt được lỗi)
- [x] `piptest.js` **30/30** — thêm 2 check regression: *đóng cửa sổ chat khi còn thanh bar → `second-instance` (đúng thao tác "mở app lần nữa") → dựng lại cửa sổ chat, không có lỗi destroyed-object* và *cửa sổ dựng lại đã load xong, dùng được*.
- [x] **Chạy lại test với code cũ** (tạm bỏ `win = null` + trả handler cũ) → `FAIL ... {"crash":"Object has been destroyed","revived":false}` — đúng lỗi trong ảnh của bạn, rồi khôi phục code mới. Test **không phải test hình thức**.
- [x] `menutest.js` **59/59**, `camtest.js` **55/55**, `hudtest.js` **31/31**, `rectest.js` **14/14**, `captest.js` **13/13** — không hồi quy.

## v1.3.2 — Panel thẳng hàng & dễ đọc · thu nhỏ là ra thanh floating · toàn màn hình · màu trầm hơn

### Bối cảnh (bạn yêu cầu)
- Màn hình **Settings** (và các panel khác) dù bị **compress nhỏ** vẫn phải **thẳng hàng, dễ nhìn** — "khó nhìn chớt".
- Cho phép **mở toàn màn hình / thu nhỏ** cửa sổ như một app thật.
- Bấm **thu nhỏ là hiện thanh floating ngay**, không cần qua "màn hình thu nhỏ" rồi bấm thêm nút compress.
- Thanh floating **khởi động ngay khi mở máy**, hiện **một bên** liền.
- **Màu sắc trầm hơn**.

### Đã làm — panel thẳng hàng & dễ đọc khi bị nén nhỏ
- [x] `styles.css`: mọi panel dùng **một khung chung** (`.settings-panel` / `.media-panel` / `.mini-panel`) với `width:min(340–360px,100vw)` → không bao giờ tràn ngang, hẹp thì tự full-bleed.
- [x] `.settings-row` đổi từ flex sang **grid 2 cột** (`minmax(0,1fr) auto`): nhãn bên trái, control bên phải, `align-items:center`; thêm `justify-self:end` cho control nên **mọi toggle/seg kết thúc ở đúng một mép phải** (trước đây mép phải lệch nhau và nhãn dài bóp nát control).
- [x] **Lỗi thật đã sửa**: `.seg-btn{width:30px}` làm chữ **"30 fps" / "60 fps" tràn khỏi nút** (width cứng, không có `overflow`) — đúng kiểu "khó nhìn". Giờ `width:auto;min-width:32px;padding:0 9px;white-space:nowrap`, và các nhóm chọn (Quality / fps / Media tabs) dùng `.seg.wide` để **chia đều hết bề ngang panel**.
- [x] Hint 12px (trước 11.5px) + `line-height:1.5`, hàng có đường kẻ mảnh phân cách, `@media(max-width:440px)` siết lại padding/font nhưng **giữ nguyên 2 cột**; `≤360px` thì lưới media về 1 cột.
- [x] Viết lại phần chữ trong panel cho ngắn, đúng trọng tâm; thêm nhóm **Floating Bar** (Dock to Left/Right, Show the bar when the app starts, Minimizing shows the bar, Start with Windows).
- [x] Đo bằng số thay vì cảm giác: test mới đo **mép trái nhãn, mép phải control, khoảng cách nhãn↔control**, chữ trong `.seg-btn` có bị cắt (`scrollWidth > clientWidth`) không, hint có tràn không, và **độ tương phản WCAG AA** (hint 7.55:1, nhãn 13.67:1 — đều thoải mái trên ngưỡng 4.5:1) ở đúng 380×300 *và* 320×420, trên nền `dark + theme-forest` mà bạn đang dùng.

### Đã làm — toàn màn hình / thu nhỏ như app thật
- [x] IPC mới `pip:maximize`: lưu bounds cũ → phóng kín **work area**, tắt always-on-top và **có mặt trên taskbar** (giống cửa sổ app bình thường) → bấm lần nữa trả về **đúng kích thước cũ**. Bubble không khung nên không có nút maximize của Windows — nay có nút **⤢ trên header** và **double-click vào header**.
- [x] Body nhận class `pip-max` (đổi icon nút, **ẩn tay nắm resize** khi đang toàn màn hình).
- [x] Tay nắm resize góc phóng to hơn (30px) cho dễ nắm.

### Đã làm — thu nhỏ là ra thanh floating ngay
- [x] `pip:collapse` **bỏ hoàn toàn animation 150ms** và `setBounds` thẳng trong cùng một tick — trước đây cửa sổ chạy qua **mọi kích thước trung gian**, nên bạn thấy "màn hình thu nhỏ" thay vì thanh bar. Test mới kiểm tra ngay **trong cùng tick** bounds đã là 56×248.
- [x] Vẫn re-assert mục tiêu sau 60ms (Windows đôi khi bỏ một lần resize đi kèm đổi style `setResizable`).
- [x] `pip:expand` / `pip:collapse` giờ **idempotent**: kể cả khi hai bên lệch trạng thái thì lần bấm vẫn cho ra đúng thứ người dùng muốn, không cần bấm lại.
- [x] **Thu nhỏ cửa sổ app → hiện thanh floating ngay** (`win.on("minimize")` → `pip:openbar`), toggle "Minimizing shows the bar" trong Settings.
- [x] Nút thu nhỏ trên header bubble đổi thành icon **—** với tooltip "Minimize — straight to the floating bar".

### Đã làm — thanh floating khởi động sẵn, một bên
- [x] IPC `pip:openbar`: mở **thanh đã thu gọn**, **dock sát mép màn hình** (cách 6px, canh giữa theo chiều dọc) — dùng cho **khởi động app** và cho **thu nhỏ app**.
- [x] `settings.pipOnStartup` (mặc định **BẬT**): mở app là thanh bar đã nằm sẵn một bên. `settings.pipDock` = `left|right` (mặc định **right**) đổi được trong Settings → dock ngay lập tức.
- [x] `settings.startAtLogin` → `app.setLoginItemSettings` — **Start with Windows** ngay trong Settings, và main **tự đăng ký lại mỗi lần chạy** để bản cài mới (đổi đường dẫn exe) không bị mất.
- [x] An toàn cho test: cờ `IS_TEST_BOOT` (khi main.js bị `require("./main.js")` từ file test thì **bỏ qua** login item + thanh bar khởi động) nên 7 bộ test vẫn cô lập, còn test tự gọi `pip:openbar` để kiểm tra.

### Đã làm — màu trầm hơn
- [x] Mỗi theme giữ **đúng hue** trong `--accent-key`, còn `--accent` **được suy ra một chỗ duy nhất**: `color-mix(in srgb, var(--accent-key) 64–68%, #6f7681)` → **16 theme trầm đi cùng lúc**, màu hover/pressed cũng tự tính lại từ màu đã trầm.
- [x] Hạ bão hoà đo được: xanh dương 1.00 → **0.68**, forest 0.672 → **0.412**, purple 0.91 → **0.516** (test mới chốt luôn con số này).
- [x] Nền/viền/đổ bóng dịu hơn (light `#f0f2f5 → #fbfbfc/#f1f2f4`, rail `#1c1e21 → #25272b`, dark `#18191a → #1a1b1d`, shadow nhẹ hơn), gradient bong bóng tin nhắn bớt chói.
- [x] Thanh floating đổi từ **màu đặc** sang **gradient nhạt dần** (`color-mix` với xám) + đổ bóng mềm hơn — nhìn "trầm" hơn hẳn khi ở trên desktop.

### Kiểm chứng v1.3.2
- [x] **`menutest.js` 59/59** (thêm 30 check panel: 3 panel × 2 kích thước × 5 tiêu chí — nằm trong cửa sổ, thẳng hàng/không đè, một mép phải & một mép trái, không cắt chữ/không tràn, đủ tương phản AA; thêm 2 check bảng màu).
- [x] **`piptest.js` 28/28** (thêm 8 check: maximize kín work area, layout khớp cửa sổ sau khi maximize, restore về đúng kích thước cũ, thu gọn tức thì trong cùng tick, mở thanh bar theo yêu cầu, bar mở ra là **đã thu gọn + dock sát mép phải**, và **thu nhỏ cửa sổ app → thanh bar hiện ngay**).
- [x] `hudtest.js` **31/31**, `rectest.js` **14/14**, `captest.js` **13/13**, `camtest.js` **55/55**, `searchtest.js` **19/19** (`camtest` có 1 check đọc chữ trong hint Settings; đổi `Drag the (live )?camera preview` cho khớp câu chữ mới).

## v1.3.1 — Floating menu dọc 5 nút + không dính nút vào ảnh chụp

### Bối cảnh (bạn yêu cầu)
- Floating menu cho **hướng vertical, 5 nút thẳng hàng**.
- **Chụp hình mà khung chọn có dính nút thì nút phải biến mất** khỏi ảnh.
- Xoá các bản exe cũ, build bản mới.

### Đã làm — pill dọc 5 nút
- [x] Nút chat (icon đầu pill) giờ là **hình tròn 30px giống hệt 4 nút tool** → 5 nút: **chat / chụp / quay / media / ⚙ settings**, xếp **một cột thẳng** (`flex-wrap:nowrap`, bỏ luôn đường kẻ ngăn cách và bỏ label dọc vốn không đọc được ở bề ngang 56px).
- [x] `pipScale < 1` (bạn đang để 0.75 → cửa sổ 42×186) thì nút co lại **26px, gap 4**: pill còn 34×160 trong khung 42×186 — trước đây cửa sổ nhỏ đi mà CSS px thì không, nút cuối sẽ tràn ra ngoài.
- [x] Giữ `#btnBubbleChat` **không** phải `.pip-tool` để gesture vẫn bubble lên pill: kéo vẫn kéo, bấm vẫn mở chat (nếu cho nó thành `.pip-tool` thì pill sẽ bỏ qua cú bấm đó và nút chat chết).
- [x] Tiện thể sửa lỗi test mới phát hiện: bubble **42×186** không đủ chỗ cho HUD (≈158px) *và* toast → toast bị vẽ đè lên nút pause/discard/stop. Giờ khi HUD đang hiện trong bubble thấp (≤140px rộng & ≤200px cao) thì toast **tự ẩn** (trạng thái mic/cam/pause đã hiện trên nút HUD rồi).

### Đã làm — nút nổi không còn dính vào ảnh chụp
- [x] `openScreenshotOverlay()` **park bubble + camera bubble ra ngoài mọi màn hình** (`x < minX - width`, `y < minY - height` tính theo `screen.getAllDisplays()`) trước khi `desktopCapturer` chụp, chờ 80ms cho compositor cập nhật, rồi **trả về đúng chỗ cũ** khi overlay đóng (dù Done / Cancel / Esc / overlay tự chết).
- [x] Dùng **di chuyển** chứ không dùng `hide()`/`showInactive()`: đo được rằng hide + show để lại pipeline resize của Chromium phía sau — lần expand kế tiếp renderer layout theo viewport **444×363** trong khi cửa sổ đã **960×516** (test mới `the expanded popup lays out for its real window size` bắt được; grip resize cũng ra số sai). Park chỉ đổi vị trí nên viewport không lệch.
- [x] Thêm cờ `shotStowing`: khi đang park thì **không** ghi vị trí mới vào `pip.json` (`persistBubblePos`) và **không** báo `cam:moved` cho cửa sổ đang quay — nếu không, vị trí off-screen sẽ bị lưu lại và lần sau bubble mở ra ở chỗ không thấy được.

### Kiểm chứng v1.3.1
- [x] **`piptest.js` 20/20** (thêm 4 check): park rời khỏi **mọi** màn hình khi picker mở; trả về đúng chỗ + viewport khớp cửa sổ; popup expand layout đúng kích thước thật; và **bằng chứng pixel**: dựng một cửa sổ nền **magenta** đặc phía sau bubble, chụp thật đúng vùng đó qua app rồi đọc PNG → **magenta 13888/13888 = 100%**, không có vết tích gì của pill.
- [x] **`hudtest.js` 31/31** (thêm case `pipScale 0.75` 42×186 và check "5 nút tròn xếp một cột thẳng": cùng `l`, `t` tăng dần, còn trong cửa sổ, ≥22px, có `title`).
- [x] `rectest.js` **14/14**, `captest.js` **13/13**, `camtest.js` **55/55**, `menutest.js` **27/27**, `searchtest.js` **19/19** (chạy sau khi tắt app nên phím tắt `Ctrl+Alt+N` đăng ký được).

## v1.3.0 — Màn hình mini trong floating menu + video mượt hơn

### Bối cảnh (bạn gửi ảnh ScreenRec)
- Muốn floating menu có thêm **màn hình mini để chỉnh trực tiếp** (như ScreenRec: webcam / mic / chất lượng / cursor).
- Và **video mượt hơn**.

### Đã làm — màn hình mini (⚙ trong floating menu)
- [x] Panel `#miniPanel` mở từ nút **⚙ trên pill** (nút thứ 4) và **⚙ trong header bubble mở rộng**. Nội dung: **Quality SD / HD / FHD**, **30 / 60 fps**, **Show mouse cursor**, **Camera** + **Microphone** (dropdown theo `enumerateDevices`, có nút ↻ làm mới, tự cập nhật khi `devicechange`), và mục Controls nhắc phím/luồng bấm.
- [x] Lựa chọn lưu vào `settings.json` (`recQuality`, `recFps`, `recCursor`, `camDeviceId`, `micDeviceId`) và **broadcast sang các cửa sổ khác** — đổi ở bubble thì cửa sổ chat dùng ngay, và ngược lại (`syncRecPrefsUi` khi nhận `settings:changed`).
- [x] Mở từ pill thu gọn thì **bubble lớn lên trước** (dùng chung helper `pip.js` với Gallery) — panel 330px không bao giờ đè lên cửa sổ 56px.
- [x] `Esc` đóng panel (thêm vào `closeEscapeTargets`).
- [x] **Lỗi layout bị test bắt được:** thêm nút thứ 4 làm pill dọc vượt `max-height:90vh`, flex-wrap đẩy 4 nút sang **cột thứ hai nằm ngoài cửa sổ** (`tools` ở `l:66` khi window rộng 56) → nhìn như mất hết nút. Sửa: ẩn label dọc `.pip-bubble-text` trong tab dọc, bốn nút 30px xếp một cột — pill còn 40×184, nằm gọn trong 56×248.

### Đã làm — video mượt hơn
- [x] **Vòng vẽ đổi từ `requestAnimationFrame` sang `setInterval`** theo đúng fps (`1000/fps`). Đây là nguyên nhân chính của "giật": Chromium throttle/pause rAF khi cửa sổ bị che khuất hoặc thu nhỏ — đúng lúc người dùng đang làm việc ở app khác.
- [x] **Cửa sổ quay không bị throttle và màn hình không ngủ khi đang quay:** IPC mới `capture:recordingActive` → `webContents.setBackgroundThrottling(false)` cho cửa sổ đang quay + `powerSaveBlocker.start('prevent-display-sleep')`; tự nhả khi Stop/Discard/lỗi (đếm theo `Set` số cửa sổ đang giữ).
- [x] **Preset đổi cả độ phân giải:** canvas = màn hình scale xuống theo chiều cao preset (SD 480 / HD 720 / FHD 1080), kích thước chẵn cho encoder. Ít pixel hơn mỗi frame → 30/60 fps giữ đều hơn.
- [x] **Bitrate theo preset × fps** (SD 2.5 / HD 6 / FHD 11 Mbps ở 30fps, gấp đôi ở 60fps) thay cho 4 Mbps cứng.
- [x] `canvas.captureStream(fps)` + `contentHint = "motion"` để encoder dồn bit vào chuyển động (mượt hơn khi xem lại) thay vì chi tiết tĩnh.
- [x] `getDisplayMedia` nhận `frameRate: {ideal, max}` và `cursor: 'always' | 'never'` theo lựa chọn.
- [x] `camera.js` có `camVideoConstraint(deviceId)`: chọn camera cụ thể thì bỏ `facingMode` và dùng `deviceId: {exact}`; mic cũng chọn được device.

### Kiểm chứng v1.3.0
- [x] **`rectest.js` mới** (`RECTEST_USERDATA=<dir> npx electron rectest.js`) → **14/14 PASS**, chạy đúng pipeline thật với device giả (màn hình 1280×720 có nội dung di chuyển):
  - ⚙ trên pill 56×248 → bubble lên 960×516, panel 330 nằm trọn trong khung, nút đóng trong khung;
  - mặc định HD / 30 fps / cursor bật; chọn SD + 60 fps + tắt cursor → ghi đúng vào `settings.json`;
  - **`requestAnimationFrame` bị vô hiệu hoá hoàn toàn** mà frame vẫn đổi (chữ ký frame khác nhau sau 600ms) → chứng minh pump không còn phụ thuộc rAF;
  - frame ghi ra **854×480** (SD, đúng tỉ lệ 16:9), `captureStream` nhận **60**, `videoBitsPerSecond` = **5.000.000** (2.5M × 60/30), `getDisplayMedia` nhận `frameRate.ideal 60` + `cursor 'never'`;
  - `recordingActive` giữ rồi nhả đúng (`holders` 1 → 0); quay xong lưu file `rec-*.webm` thật và HUD tắt.
- [x] `hudtest.js` → **19/19** (thêm 2 check mới: pill + cả 4 tool phải nằm trong cửa sổ, ≥22px, có `title`) — cũng sửa luôn việc test để sót class `pip-vertical` khi đo case ngang.
- [x] `camtest.js` **55/55** (profile sạch), `piptest.js` **16/16**, `menutest.js` **27/27**, `captest.js` **13/13**, `searchtest.js` **18/19** (check phím tắt `Ctrl+Alt+N` fail vì chính app đang chạy của bạn giữ phím đó).

## v1.2.9 — Sửa floating button: bubble đen xì + chụp/quay im lặng

### Bối cảnh (bạn báo)
- Bong bóng nổi (pill 56×248, 3 nút chụp / quay / media) **thành ô đen đặc**, không thấy chữ hay icon.
- Bấm nút chụp hoặc quay trong floating button thì **im lặng, không có gì hiện ra**.
- App đang chạy là bản **đã cài** — kiểm tra `resources/app.asar`: `package.json` ghi `1.2.6`, **0 lần** `cam.html` → thiếu hẳn camera nổi của 1.2.8 (capture.js 513 dòng so với 773 dòng hiện tại).

### Nguyên nhân thật (đã đo được)
- [x] **`pipWin.setContentProtection(true)` được set vĩnh viễn ngay lúc tạo bubble.** Trên Windows, `SetWindowDisplayAffinity` khi không loại được cửa sổ khỏi capture sẽ rơi về `WDA_MONITOR` → cửa sổ bị vẽ thành **ô đen đặc**. Đo thật trong repo này (A/B cùng một cửa sổ):
  - pill không bảo vệ: **57.4% pixel màu accent**, avg `[19,94,163]`;
  - bật `setContentProtection(true)`: **100% đen**, avg `[10,10,10]`;
  - tắt lại: về đúng 57.4% → nhân quả rõ ràng, không phải đoán.
  - Cửa sổ **đục** (chat chính) cũng vậy: 0.2% đen → **99.3% đen** → 0.2% khi tắt. Tức là tính năng "ẩn app khỏi video" không làm app vô hình mà biến nó thành hộp đen.
- [x] Vì protection được set **lúc tạo cửa sổ và không bao giờ được gỡ khi không quay**, bubble đen **ngay từ lúc mở**, chưa cần quay. Đây là lý do "tự nhiên chuyển đen xì": lần quay trước đó đặt cờ, cửa sổ không bao giờ được trả lại.
- [x] Bấm nút mà không thấy gì: pill đen đặc nên 3 nút tool vô hình; thêm nữa `startShot()` **return im lặng** khi thiếu `window.api.capture`, và overlay chụp khi không lưu được cũng **không báo gì** (chỉ `console.error`).

### Đã sửa
- [x] **Không bao giờ content-protect cửa sổ lúc tạo.** `openPip` giờ chỉ áp cờ `recHideActive` (đang quay hay không). Việc "ẩn khỏi video" chỉ do `capture:setContentProtection` làm, đúng như setting "Hide this window from recordings".
- [x] **Không để cờ bị kẹt:** `releaseContentProtection()` gỡ protection trên `win` + `pipWin` + `camWin` khi dừng quay, và thêm lưới an toàn — cửa sổ đang quay bị huỷ giữa chừng (`camOwner` destroyed) cũng gỡ ngay, trước đây protection sẽ kẹt vĩnh viễn cho tới lần quay sau.
- [x] `capture:setContentProtection` giờ phủ cả cửa sổ camera nổi.
- [x] **Chụp không còn im lặng:** main gửi `shot:failed` (kèm lý do + bản ngắn cho bubble) khi selection quá nhỏ / crop lỗi / không có ảnh → renderer toast. `preload` expose `capture.onFailed`, `capture.js` đăng ký và hiện toast.
- [x] `startShot()` thiếu bridge → toast "Capture bridge unavailable" thay vì `return` im lặng.
- [x] Mở lại overlay khi nó đang mở → trả `{ok:true, already:true}` thay vì `undefined` (trước đây bị báo nhầm "Screenshot failed").
- [x] **Overlay chụp không bao giờ kẹt đen toàn màn hình:** nếu ảnh màn hình không tới hoặc lỗi decode trong 2.5s thì tự `shot:cancel`; `<img>` báo `error` cũng đóng luôn.
- [x] **Sửa map toạ độ crop sai:** overlay tính `scaleX/scaleY` theo `innerWidth/innerHeight` thật thay vì theo `w`/`h` trong query string. Đo trên máy này: cửa sổ yêu cầu cao 1080 nhưng `innerHeight` chỉ **1032** → trước đây crop lệch; lệch đủ nhiều thì `shot:done` từ chối selection và **không lưu gì cả**.
- [x] Hint trong Settings → Screen Recording nói rõ: trên bản Windows không loại được cửa sổ khỏi capture, app sẽ bị vẽ đen thay vì ẩn — tắt toggle nếu bubble đen khi đang quay.

### Gallery trên bubble thu gọn cũng ra hộp đen (bạn báo tiếp)
- [x] **Nguyên nhân đo được:** bấm nút Media trên pill 56×248 → panel mở ra nhưng cửa sổ **không đổi kích thước**: `panelRect = {left:-304, width:360}` → chỉ còn dải 56px của panel phủ kín cửa sổ, che luôn cái pill (pill vẫn nằm dưới nhưng z-index 250 đè lên). Dark mode → `--bg-primary:#18191a` → **ô đen đặc**, nút đóng và grid nằm ngoài tầm với.
- [x] **Sửa:** `openGallery()` gỡ `pip-collapsed` và phát `pip:expand` trước khi mở panel — bubble lớn lên rồi mới hiện thư viện (cũng là trạng thái duy nhất đủ chỗ cho grid).
- [x] Thêm `@media(max-width:400px){.settings-panel,.media-panel{width:100%}}` để panel 320/360px không bao giờ thò ra ngoài một cửa sổ hẹp.
- [x] Đo lại sau khi sửa: pill 56×248 → cửa sổ **956×515**, panel 360 nằm trọn trong khung, nút đóng trong khung, grid rộng 319.

### Kiểm chứng v1.2.9
- [x] `npx electron piptest.js` → **PASS** (thêm 3 check mới): bubble **không** bị content-protect khi idle, bật/tắt qua IPC rồi gỡ sạch, và **gallery làm bubble lớn lên thay vì phủ ô đen** (56×248 → 956×515, panel + nút đóng nằm trong khung).
- [x] `npx electron searchtest.js` → 18/19 khi app đang chạy (phím tắt `Ctrl+Alt+N` bị chính app đang mở giữ — chạy lại lúc app tắt là 19/19).
- [x] `npx electron camtest.js` với profile sạch (`CAMTEST_USERDATA`) → **PASS 55/55**; `hudtest 17/17`; `menutest 27/27`; `captest 13/13`.
- [x] Đo trực tiếp pixel: pill trước/sau khi sửa (57% accent ⇄ 100% đen) và cửa sổ chat chính (0.2% ⇄ 99.3% đen).

### Đóng gói
- [x] Bump `package.json` → **1.2.9**, `npm run build` (electron-builder 26.15.3, electron 43.0.0) → `dist\Messenger Self-Chat Setup 1.2.9.exe` (NSIS, per-user) + `dist\Messenger Self-Chat 1.2.9.exe` (portable).
- [x] Kiểm tra `dist/win-unpacked/resources/app.asar` của bản build: `version: 1.2.9`, `cam.html` ×4, `shot:failed` ×2, `releaseContentProtection` ×3, `recHideActive` ×5, overlay dùng `innerHeight` thật, pip dùng `setContentProtection(recHideActive)`.
- [x] **Dọn dist:** xoá `Messenger Self-Chat 1.2.8.exe`, `Setup 1.2.8.exe`, `Setup 1.2.8.exe.blockmap` và thư mục build `win-unpacked` → **754M → 198M** (giải phóng ~556MB), chỉ còn bản 1.2.9.

### Cài đè lên bản đang dùng
- [x] Bản cài cũ là **1.2.6** (asar 22/09 18:04, 552.806 byte, không có `cam.html`) → nhiều lỗi "từa lưa" đã sửa từ 1.2.7 (quay ra file 0 byte → "Nothing to save" vì audio track không nguồn) mà bản cài chưa có.
- [x] Đóng app đang chạy (`taskkill //T` báo "can only be terminated forcefully" → phải `//F //T`), chạy `dist\Messenger Self-Chat Setup 1.2.9.exe /S` → im lặng, exit 0, ghi đè tại chỗ.
- [x] Kiểm tra sau khi cài: `Messenger Self-Chat.exe` ProductVersion **1.2.9.0**, `resources/app.asar` 592.337 byte (17:10) ghi `version: 1.2.9` và có đủ 7 dấu hiệu fix (bubble không protect lúc tạo, releaseContentProtection, shot:failed, overlay dùng innerHeight thật, gallery expand, panel full-bleed, cam.html).
- [x] Mở lại app (6 tiến trình). Dữ liệu giữ nguyên: `%APPDATA%\messenger-self-chat` vẫn còn `messages.json` 3.243 byte, `settings.json` (`darkMode:true`, `theme:forest`, `pipScale:0.75`), `files/`, `voice/`, `captures/`.
- [x] Shortcut vẫn còn ở Start Menu và Desktop (`Messenger Self-Chat.lnk`).
- [ ] `camtest.js` giữ `camPos` trong profile thật, nên chạy lặp lại nhiều lần sẽ trôi vị trí camera và fail vài check hình học. Chạy bằng `CAMTEST_USERDATA=<dir>` cho kết quả xác định.

## v1.2.8 — Quay từ FLOATING BAR: bong bóng camera nổi, kéo đi đâu cũng được

### Bối cảnh (bạn nói rõ)
- Lúc quay video là **bấm nút quay ở floating bar** (bubble 56×248 hoặc mini-chat mở rộng), **không phải** chạy trong cửa sổ app. Trước đó preview bị CSS ẩn trong pip-mode nên **không thấy/không kéo được camera**, và toạ độ cam lại tính theo cửa sổ (quá nhỏ) → không có cách nào đặt cam.

### Đã làm
- [x] **Cửa sổ bong bóng camera nổi** (`cam.html` + `cam-overlay.js` + `cam-preload.js`): khi quay từ floating bar (thu gọn **hoặc** mở rộng), app mở một cửa sổ nhỏ always-on-top, kéo được **khắp màn hình**, có badge **S/M/L** để đổi cỡ, hiện chữ "Camera off" khi tắt cam.
- [x] **Vị trí cam = vị trí thật trên desktop**: main tính toạ độ chuẩn hoá từ `getBounds()` của cửa sổ cam so với display chứa nó (`getDisplayMatching`), gửi về cửa sổ đang quay (`cam:moved`) → `settings.camPos` → bong bóng burn-in trong video **trùng khít** cửa sổ cam (test đo được lệch ≤ 6px, thực tế 456.5 vs 457).
- [x] **Hình ảnh live trong cửa sổ cam**: frame JPEG ~8fps được đẩy từ cửa sổ đang quay (nó đã giữ camera) sang qua IPC — **không mở camera lần hai** nên đèn webcam chỉ sáng một lần, và không có xung đột thiết bị.
- [x] **Cửa sổ cam không bao giờ lọt vào video**: đặt `setContentProtection(true)` ngay khi tạo (giống bubble chat), nên người xem chỉ thấy màn hình + bong bóng cam được đốt vào frame.
- [x] Ẩn preview trong app khi dùng cửa sổ cam (`body.cam-overlay .cam-preview`) — không hiện hai bản preview cùng lúc; đổi cỡ trong cửa sổ cam cũng cập nhật `settings.camScale`.
- [x] Đóng/mở đúng lúc: quay từ floating bar → mở; tắt cam → chuyển thành chip "Camera off" (frames dừng, vị trí giữ nguyên để khỏi mất chỗ); bật lại → frames chạy tiếp; dừng quay/đóng cửa sổ quay → đóng cửa sổ cam.

### Kiểm chứng v1.2.8
- [x] `npx electron camtest.js` → **PASS 55/55**, thêm nguyên một phần chạy **đúng luồng bạn dùng**: mở cửa sổ bubble 56×248 với stub màn hình/camera, bấm nút quay **trong bubble**, rồi kiểm tra: cửa sổ camera nổi mở ra (176×132, always-on-top) và có frame `data:image/jpeg`; bong bóng xanh trong frame **đúng chỗ cửa sổ cam** (456.5 vs 457 ngang, 222.5 vs 223.3 dọc); **kéo** cửa sổ cam → bong bóng trong video đi theo (đúng toạ độ mong đợi theo display) + lưu vào `settings.json`; bấm **S/M/L** → cửa sổ 232→144 và bong bóng burn-in 188→102 (khớp tỉ lệ); tắt cam → track `ended`, không còn pixel camera, chip "Camera off" hiện; dừng quay → cửa sổ cam đóng, file `rec-*.webm` vẫn lưu; và bubble **mở rộng** cũng có cửa sổ cam còn preview trong app vẫn ẩn.
- [x] `menutest 27/27` · `hudtest 17/17` · `captest 13/13` · `piptest 13/13` → tổng **125 check**, 0 lỗi console (menutest có 1 lần chạy nhanh bị miss event scroll của chính test — chạy lại 2 lần đều 27/27).

## v1.2.7 — Camera trong lúc quay (di chuyển được, tắt là tắt đèn, có Pause)

### Messenger — Camera khi quay
- [x] **Camera hiện cho người xem thấy**: bong bóng camera được vẽ thẳng vào frame (burn-in) trong `camera.js` (`camRect` + `drawCamBubble`), cập nhật mỗi frame nên đổi vị trí/kích thước là video đổi ngay.
- [x] **Di chuyển camera quanh**: preview live (`#camPreview`) giờ kéo được (`pointer` events, `pointer-events:auto`, `cursor:grab`) — toạ độ chuẩn hoá (tâm 0..1) lưu trong `settings.camPos`, recording đọc đúng giá trị đó nên **preview ở đâu thì trong video ở đó**; tự clamp để không bị cắt nửa bong bóng. Double-click (hoặc nút S/M/L ở góc preview) đổi cỡ, lưu `settings.camScale`.
- [x] **Tắt camera là tắt thật** (không sáng đèn nữa): trước đây chỉ `track.enabled = false` → thiết bị vẫn mở, đèn webcam vẫn sáng. Giờ `camera.release()` **stop() track** và gỡ `<video>`, bật lại thì `camera.acquire()` mở thiết bị **giữa lúc đang quay**; `setToggleUi` hiển thị trạng thái theo `isLive()` chứ không chỉ theo ý người dùng.
- [x] **Camera bị tắt từ máy tính / rút ra giữa chừng**: theo dõi `ended` của track + `devicechange` (không còn `videoinput` nào) → app tự chuyển sang camera-off, ẩn preview, bỏ bong bóng khỏi frame, có toast — trước đây sẽ treo/hiện frame chết.
- [x] **Pause/Resume** trên HUD: `MediaRecorder.pause()/resume()`, đồng hồ đứng yên khi pause, dot chuyển vàng, nút đổi icon/label Pause ⇄ Resume.
- [x] **App tự ẩn khỏi video** (mặc định BẬT, tắt được trong Settings → Screen Recording): khi bắt đầu quay gọi IPC `capture:setContentProtection` → `setContentProtection(true)` trên cửa sổ chat + bubble (Windows `WDA_EXCLUDEFROMCAPTURE`, macOS `NSWindowSharingNone`) và tắt lại khi dừng. Nhờ vậy người xem chỉ thấy màn hình + bong bóng camera, không thấy floating bar/HUD/preview.
- [x] Preview không còn hiện trong bubble thu gọn (56×248 / 280×52) nhưng vẫn hiện khi bubble mở rộng >400px.

### Lỗi thật phát hiện qua test
- [x] **Audio track không có nguồn làm file quay rỗng**: nếu không có mic (hoặc `AudioContext` không chạy), `createMediaStreamDestination()` vẫn cho 1 track im lặng → WebM muxer phát blob **0 byte** → "Nothing to save". Giờ chỉ mix audio khi **có nguồn thật**, và nếu AudioContext không `running` thì fallback về track gốc.

### Kiểm chứng v1.2.7
- [x] Tạo `camtest.js` (`npx electron camtest.js`) — không cần phần cứng: stub `getDisplayMedia`/`getUserMedia` bằng canvas stream và bắt canvas ghi hình qua `captureStream`, rồi chạy **đúng pipeline thật** của app (startRec, nút HUD, kéo preview, MediaRecorder, IPC save): **PASS 36/36**.
  - đọc pixel thật trong frame: bong bóng xanh 137×102 đúng chỗ preview, phần còn lại là màu màn hình giả;
  - kéo preview → tâm bong bóng trong video dịch theo; vị trí lưu vào `settings.json`;
  - double-click → bong bóng to ra (137 → 190 px);
  - tắt cam → `track.readyState === 'ended'` (đèn tắt), preview mất, **không còn pixel camera nào** trong frame, recording vẫn chạy; bật lại → `getUserMedia` gọi lần 2, camera về đúng chỗ cũ;
  - giả lập OS tắt camera (`track` bắn `ended`) → app về camera-off, recording sống sót;
  - Pause: đồng hồ đứng yên (00:06 → 00:06), Resume chạy tiếp (00:09);
  - Stop: camera released, HUD tắt, file `rec-*.webm` được lưu và `local-file://` trả 200 `video/webm`.
- [x] `npx electron hudtest.js` → **PASS 17/17** (HUD 5 nút vẫn nằm gọn trong bubble 56×248 và 280×52), `menutest.js` **27/27**, `captest.js` **13/13**, `piptest.js` **13/13** → tổng **106/106**, 0 lỗi console.

## v1.2.6 — Xem lại capture + kéo bubble + dọn dung lượng

### Messenger — Xem lại ảnh chụp / video quay (lỗi "không hoạt động")
- [x] **Nguyên nhân**: protocol `local-file://` dùng chuỗi `||` nên luôn dừng ở `files/<tên>` (resolve được, file không tồn tại) và **chưa bao giờ thử `captures/`** → mọi ảnh chụp/ghi hình trả 404: thumbnail trống, bấm xem không phát được.
- [x] **Sửa**: tìm tên trong `files/`, `voice/`, `captures/` và chọn thư mục **thực sự có file**; thêm **byte range** (206 + `content-range` + `accept-ranges`) vì webm từ MediaRecorder không có duration trong header nên không tua/phát ổn nếu thiếu range; nhận cả hai dạng URL (`local-file:///tên` của renderer và `local-file://tên/` do net.fetch chuẩn hoá).
- [x] CSP cho phép `connect-src local-file:` (renderer fetch được byte đã lưu nếu cần).

### Messenger — Kéo bubble không còn tự bật app
- [x] **Nguyên nhân**: Chrome vẫn bắn `click` sau khi kéo (mousedown + mouseup cùng element) → handler dự phòng `click` mở luôn cửa sổ chat.
- [x] **Sửa**: nhớ gesture (`dragMoved`, toạ độ `screen` lúc pointerdown, chặn click trong 600ms sau khi kéo) và coi "vị trí cuối khác vị trí đầu" là kéo.
- [x] **Sửa luôn `piptest.js`** (đã chết từ v1.7): nhận diện cửa sổ PiP theo URL `pip=1` (không còn lọc `width < 500` vì từ v1.7 nó mở rộng 50% màn hình), tự collapse trước khi test kéo/click, thêm check "kéo thì vẫn collapsed".

### Dọn dung lượng
- [x] Xoá installer/portable/blockmap cũ trong `dist/` (1.0.0, 1.2.0 → 1.2.5) + thư mục `win-unpacked`: **1.9G → 198M** (giải phóng ~1.7GB), chỉ giữ bản 1.2.6.
- [x] Build 1.2.6, cài đè lên bản đang dùng (`/S`, per-user, không cần admin), mở lại app.

### Kiểm chứng v1.2.6
- [x] `npx electron captest.js` → **PASS 13/13**: quay thật bằng MediaRecorder (25KB) + lưu PNG thật qua IPC của app, `local-file://` trả 200 + `image/png` + `accept-ranges`, range trả 206 đúng slice, tên lạ vẫn 404, `<img>` từ `captures/` render được, media library preview **video phát được** (`readyState=1`, không lỗi).
- [x] `npx electron piptest.js` → **PASS 13/13** (kéo di chuyển + vẫn collapsed, click mới mở, mở rộng giữa màn hình, grip resize, đổi hướng).
- [x] `npx electron menutest.js` → **PASS 27/27**, `npx electron hudtest.js` → **PASS 17/17**.

## v1.9 — Menu nổi cho tin nhắn (không còn bị che / cắt)

### Messenger — Menu thao tác tin nhắn (chuột phải hoặc nút ⋯)
- [x] **Đặt menu theo kích thước thật**: thêm `placePopup()` trong `dom.js` — đo element sau khi lọc item, tự **lật sang phía đối diện** rồi **clamp lề 10px**. Trước đây toạ độ cứng (`innerWidth-180`, `innerHeight-250`) không khớp kích thước thật nên menu 8 mục bị cắt cụt ở mép dưới/phải cửa sổ.
- [x] **Không còn bị các panel khác che**: `z-index` của menu nâng 200 → **600**, nằm trên settings/media panel (250), modal (300), dialog (350), HUD ghi hình (400), emoji bay (500) — trước đây menu chui xuống dưới panel đang mở.
- [x] **Chuột phải trên tin nhắn mở menu** (trước chỉ có nút ⋯ khi hover); menu neo vào nút ⋯ hoặc con trỏ, item nào không áp dụng thì ẩn (Copy/Edit chỉ khi có chữ, Save File chỉ khi có file).
- [x] **Menu đi theo tin nhắn khi cuộn** (kể cả auto-scroll tới tin mới) và tự đóng khi tin nhắn đó cuộn ra khỏi khung — trước đây menu đứng yên một chỗ rồi trôi khỏi tin nhắn.
- [x] **Dùng được bằng bàn phím**: `↓`/`↑` di chuyển highlight, `Enter`/`Space` chạy mục đang chọn, `Esc` đóng (không còn kéo PiP thu nhỏ oan). Hover chuột cũng chuyển highlight.
- [x] **Menu "mạnh" hơn**: icon cho từng mục, dòng phân cách, mục Delete tô đỏ, hiện icon nút ⋯ của tin nhắn khi menu mở, `max-height:calc(100vh - 20px)` + scroll để cửa sổ nhỏ (PiP 380x300) vẫn bấm được mục cuối.
- [x] Menu ⋯ của chat trong sidebar dùng chung `placePopup` + **giữ icon** (chỉ đổi phần chữ Pin/Unpin), đóng khi cuộn/resize.

### Messenger — Bubble nổi: HUD ghi hình + thông báo không còn bị cắt
- [x] **Nguyên nhân**: bubble thu gọn là cửa sổ thật chỉ **56×248** (dọc) hoặc **280×52** (ngang), còn HUD ghi hình rộng ~350px căn giữa `left:50%` → phần nhìn thấy chỉ là khoảng giữa (đúng chỗ nút Cam), còn mic/Stop/Discard và toast bị cắt hai bên.
- [x] **HUD tự thu gọn theo bề rộng cửa sổ**: dưới 400px → chế độ **icon-only** (ẩn chữ Mic/Cam/Discard/Stop nhưng giữ `title`), giảm padding/gap, canh giữa; dưới 140px (bubble dọc) → xếp **dọc**, mỗi nút một hàng nên cả 4 nút đều thấy và bấm được; cửa sổ thấp ≤120px → mỏng thêm để HUD và toast không chồng nhau.
- [x] **Toast luôn nằm trong cửa sổ**: `max-width:calc(100vw - …)`, tự xuống dòng (`overflow-wrap:anywhere`), font/padding nhỏ hơn; HUD ở trên, toast ở dưới nên không đè nhau.
- [x] `toast(msg, short)` — bản ngắn tự dùng khi cửa sổ nhỏ: "Screenshot saved" → "Saved ✓", "Recording saved" → "Saved ✓", "Mic muted" → "Mic off", "Camera off" → "Cam off", "Drag to select a region" → "Drag to select", "Recording (screen + cam + mic)" → "REC started"…
- [x] Thêm icon cho nút **Discard**/**Stop** để chế độ icon-only vẫn rõ nghĩa.

### Đóng gói
- [x] `npm run build` (electron-builder) → `dist\Messenger Self-Chat Setup 1.2.5.exe` (NSIS, cài per-user nên **ghi đè bản đang cài** tại `%LOCALAPPDATA%\Programs\Messenger Self-Chat`, dữ liệu trong `%APPDATA%\messenger-self-chat` giữ nguyên) + bản portable `dist\Messenger Self-Chat 1.2.5.exe`.
- [x] **Cài đè lên app đang dùng**: tắt app đang chạy → chạy `dist\Messenger Self-Chat Setup 1.2.5.exe /S` (im lặng) → `%LOCALAPPDATA%\Programs\Messenger Self-Chat\Messenger Self-Chat.exe` báo `ProductVersion 1.2.5.0`; `resources\app.asar` (17:45) chứa đủ cả hai bản sửa (`placePopup` ×7, `ctx-label` ×14, `rec-hud-text` ×5); app mở lại chạy bình thường (6 tiến trình Electron).
- [x] Kiểm tra `app.asar` của bản build: đủ 17 module `src/renderer` (có `dom.js` với `placePopup`), 34 module `src/monitor`, `index.html`/`styles.css` mới (menu có `ctx-label`/icon), `assets/icon.ico|png`.

### Kiểm chứng
- [x] `npx electron hudtest.js` → **PASS 17/17**: dựng đúng hai cửa sổ bubble 56×248 và 280×52, bật HUD + toast rồi đo — HUD, từng thành phần và từng nút đều nằm trong cửa sổ (không cắt), nút ≥16px + có `title`, toast không đè HUD, không lỗi console.
- [x] `npx electron menutest.js` → **PASS 27/27**: mở từ nút ⋯ và từ chuột phải, lật + clamp đúng ở góc dưới-phải, không cắt mục Delete, lọc item theo loại tin nhắn, `↓/↑/Enter/Esc`, menu đi theo khi cuộn rồi tự đóng khi tin nhắn ra khỏi khung, z-index trên panel + HUD, menu sidebar, và cửa sổ PiP 380x300. Không có lỗi console.
- [ ] (Có sẵn từ trước) `npx electron piptest.js` đang FAIL ở check đầu: từ v1.7 cửa sổ PiP tự mở rộng ~50% màn hình (960x516) nên `findPip()` lọc `width < 500` không tìm thấy nữa — test cũ chưa cập nhật, không liên quan thay đổi lần này.

## v1.8 — Tìm kiếm toàn bộ + Quick note (ghi nhanh)

### Messenger — tìm kiếm
- [x] **Tìm toàn bộ tin nhắn mọi chat** ngay trong ô search ở sidebar (không chỉ tìm tên chat như trước): kết quả là từng tin nhắn kèm tên chat, thời gian và đoạn trích quanh chỗ khớp.
- [x] **Không phân biệt dấu tiếng Việt**: gõ `gio` ra `giờ`, `tuong` ra `tưởng`, `cafe` ra `café` (fold NFD + `đ→d`, có bảng ánh xạ index để highlight đúng ký tự gốc).
- [x] **Nhảy tới tin nhắn**: click hoặc ↑/↓ + Enter → mở đúng chat, cuộn tới tin nhắn và nhấp nháy (`.msg-flash`) để mắt bắt ngay.
- [x] Tìm cả **tên file đính kèm**; lọc chat theo tên vẫn chạy song song (có nhãn "Chats") và **cũng bỏ dấu** cho nhất quán.
- [x] `Ctrl/Cmd+Shift+F` focus ô tìm nhanh; `Esc` xoá truy vấn; giữ bộ lọc khi tin nhắn mới tới.
- [x] **Sửa lỗi tìm trong chat**: trước đây highlight bằng cách ghi lại `innerHTML` nên xoá sạch markdown (bảng, code, in đậm) trong tin nhắn. Giờ dùng `Range.surroundContents` bọc `<mark>` trên từng text node → markdown giữ nguyên.

### Messenger — Quick note (ghi nhanh)
- [x] **Phím tắt toàn cục `Ctrl+Alt+N`** (đăng ký best-effort, có unregister khi thoát): bung popup nhỏ luôn-nổi trên cùng ở bất kỳ app nào.
- [x] Popup `quick.html`: chip chọn chat, textarea, `Enter` lưu / `Shift+Enter` xuống dòng / `Esc` hoặc click ra ngoài thì ẩn (cửa sổ được giữ lại để mở tức thì).
- [x] Ghi thẳng qua main process (`quick:append`) rồi replay state sang mọi cửa sổ → cửa sổ chính cập nhật ngay, không thể bị ghi đè bởi state cũ.
- [x] Chọn chat đích theo thứ tự: chat đang mở trong app → chat ghi gần nhất (`quick.json`) → chat đầu tiên.
- [x] Nút **⚡ Quick note** ở rail cho ai không nhớ phím tắt.
- [x] Thêm cờ `body.app-ready` sau khi renderer wire xong để test khởi động nguội không bị flaky.

### Kiểm chứng
- [x] `npx electron searchtest.js` → **PASS 19/19**: tìm xuyên chat, tìm không dấu, nhảy + nháy tin nhắn, markdown sống sót sau highlight, layout sidebar (chat + kết quả xếp chồng), popup mở/ghi/đồng bộ/ẩn, phím tắt đã đăng ký. Test tự backup & khôi phục `messages.json`/`settings.json`/`quick.json`.
- [x] `npx electron piptest.js` → **PASS** (không hồi quy sau khi đổi cấu trúc sidebar).

## v1.7 — Floating bars: free drag + centered expand

### Messenger — Floating chat bubble (PiP)
- [x] **Kéo thả tự do**: kéo được bằng chính cái pill (JS pointer + IPC `pip:dragto`, thay cho `-webkit-app-region` vốn không hoạt động trên cửa sổ frameless/transparent — trước đây pill bị `no-drag` nên kéo không được). Không còn hút vào cạnh màn hình (bỏ edge-snap), để được ở bất kỳ chỗ nào.
- [x] **Nhớ vị trí**: vị trí bubble được lưu vào `pip.json`, lần chạy sau mở lại đúng chỗ cũ (có clamp tránh mất khỏi màn hình).
- [x] **Nhấn vào → mở CHÍNH GIỮA + 50% màn hình**: chat mở ra cỡ ~50% work area (floor 360x440 để chữ không bị nhỏ) và căn giữa màn hình.
- [x] **Hết bị "mất chữ" khi mở popup**: nguyên nhân là sidebar 150px + window 430px → chat chỉ còn 280px. Giờ sidebar ẩn khi popup hẹp, chỉ hiện lại khi window đủ rộng (≥720px) để cả hai đều thoáng; chat luôn chiếm trọn phần còn lại.
- [x] **Resize tự do (compress/expand)**: thêm grip góc phải dưới (JS pointer + IPC `pip:resizeto`, clamp 360x440 → work area), kéo để thu nhỏ/phóng to popup tùy ý.
- [x] Thu lại → bubble quay về đúng chỗ đã để; đổi size/orientation giữ nguyên tâm (không nhảy chỗ).

### Monitor — Layer bar
- [x] **Kéo thả tự do**: thanh MAP LAYERS kéo được đi bất kỳ đâu trên màn hình, vị trí lưu trong `localStorage` (khóa width khi kéo để không bị re-wrap làm nhảy).
- [x] **Nhấn vào thanh → tự canh giữa màn hình**: bỏ lệch do sidebar shift (trước đây bar bị đẩy +160px khi mở sidebar). Click đơn vào vùng trống của bar là về chính giữa.

## v1.3.0 — Messenger look-and-feel + Monitor fixes

### Messenger
- [x] Composer dạng pill giống Messenger: textarea tự giãn, Shift+Enter xuống dòng, 👍→send khi nhập.
- [x] Sidebar kiểu Messenger: header "Chats" + nút compose, preview cập nhật live, tìm kiếm hoạt động.
- [x] Bubble có timestamp nằm trong bong bóng + avatar của bạn cạnh mỗi tin nhắn.
- [x] Preview sidebar loại bỏ ký tự markdown thô.
- [x] **Multi-chat**: seed 3 chat (Notes to Self / Ideas / Tasks), tạo/đổi tên/xóa/pin từng chat qua nút ⋯.
- [x] Migrate data cũ (flat messages) → fold vào chat "Notes to Self", không mất ghi chú.
- [x] Search trong chat + pin message + meta giờ chỉ tính trong chat đang mở.

### Monitor (fix)
- [x] Base layer switcher (Dark/Light/Sat) bị thiếu UI → đã thêm vào layer bar và wire lại.
- [x] Timeline slider giờ thực sự scrub lịch sử động đất (trước chỉ đổi label).
- [x] Click lên bản đồ → mở modal country risk của quốc gia gần nhất (trước callback rỗng).
- [x] Space weather Kp bị crash vì `toFixed` trên string → parseFloat an toàn.
- [x] Modal country risk không có nút đóng → đã wire nút X và click ra ngoài.
- [x] Header giờ hiện "Updated HH:MM:SS" mỗi lần quake feed load.
- [x] UI: font base 12px, scrollbar chung, layer bar wrap, giãn cột widget bên phải tránh chồng nhau.

### Monitor v1.4 — command-center layout + realtime
- [x] Layout có hệ thống: cột phải auto-stack (KPI grid + status panels, scroll), bottom dock (World Events + Threat Log), timeline + ticker riêng.
- [x] Sửa timeline slider không có CSS positioning (trước vô hình/trôi lạc).
- [x] **World Events log** realtime: hợp nhất động đất / thiên tai / xung đột / sự cố internet / alert với timestamp UTC + severity, dedup theo poll.
- [x] Threat level giờ tính từ dữ liệu thật (động đất lớn, xung đột, red alerts) thay vì random walk.
- [x] Alert counter giờ đếm sự kiện warn/crit thật (bỏ số giả ngẫu nhiên).
- [x] Header thêm ngày tháng; ticker/timeline/dock tự dịch khi thu sidebar.

### Monitor v1.5 — realtime tracking mở rộng
- [x] **Máy bay thật** qua OpenSky ADS-B (fallback mock khi bị rate-limit).
- [x] **ISS thật** qua wheretheiss.at (vị trí + altitude + velocity, refresh 5s).
- [x] **Thiên tai thật** qua NASA EONET (cháy rừng, núi lửa, bão… 60 markers live).
- [x] **Chokepoints hàng hải**: layer bản đồ + panel 10 điểm nghẽn (Kerch, Hormuz, Suez…).
- [x] **Tin tức đa nguồn realtime**: BBC + Al Jazeera + France 24 + Guardian + Top Signals panel.
- [x] **EARTH CAM**: ảnh Trái Đất trực tiếp Himawari-8 (10 phút/khung) + time-lapse play.
- [x] **Command palette Ctrl+K**: tìm tab/layer/quốc gia/widget (~90 lệnh).
- [x] **Instability Index Top 5** trong tab INTEL.

### Monitor v1.6 — geospatial layers + live day/night
- [x] **Day/Night terminator**: vẽ vùng tối + đường ranh giới + ☀/☾ tính live theo vị trí Mặt Trời (không cần API), refresh mỗi phút.
- [x] **AI data centers**: 24 trung tâm dữ liệu toàn cầu trên bản đồ.
- [x] **Nuclear facilities**: 22 nhà máy hạt nhân (Zaporizhzhia, Chernobyl, Fukushima…).
- [x] **Military bases**: 25 căn cứ quân sự lớn (Ramstein, Diego Garcia, Yokosuka…).
- [x] **Spaceports**: 16 sân bay vũ trụ (Cape Canaveral, Baikonur, Kourou, Starbase…).
- [x] **GPS jamming zones**: 9 vùng nhiễu GPS editorial (Kaliningrad, Crimea, Biển Đen…).
- [x] **CII đủ 31 nước Tier-1** (thêm TW/IL/IQ/YE/CU/LB/QA).
- [x] Wire layer toggles mới vào layer bar + command palette + layerState.

## v1.2.0 — World Monitor overhaul + Messenger features

## v1.2.0 — World Monitor overhaul + Messenger features

### New Features
- [x] **World Monitor**: Thêm feed trạng thái LIVE/STALE/OFFLINE cho mọi stream (bypass CORS qua proxy main.js).
- [x] **INTEL tab** bên trái: GDACS disasters, GDELT conflicts, IODA internet outages, OpenAQ air quality.
- [x] **Timeline slider** — scrub 24 giờ qua lại, play/pause animation.
- [x] **Alert Rules & Sound**: báo động khi có động đất M≥6 trong 1 giờ qua (có âm thanh beep).
- [x] **Base Layer Switcher**: Dark / Light / Satellite (ArcGIS World Imagery).
- [x] **Space Weather** panel: Kp-index, solar wind, protons, magnetic field (NOAA mock).
- [x] **Moon Phase** widget: hiển thị chu kỳ trăng chính xác theo thời gian thực.
- [x] **News Ticker**: chuyển sang CryptoCompare real news (không phải dòng giả).
- [x] **Messenger**: Paste ảnh từ clipboard (Ctrl+V) vào ô soạn tin.
- [x] **Messenger**: Markdown trong tin nhắn (code block, bold, list, link...).
- [x] **Messenger**: Lightbox xem ảnh full-size khi click ảnh.
- [x] **Messenger**: Thêm nút **Export Backup** (JSON) và **Open Data Folder**.
- [x] **Messenger**: Chuột phải -> **Save File** cho tin nhắn có attachment.
- [x] **Messenger**: Lightbox ảnh bấm ra ngoài hoặc nút X để đóng.
- [x] **Messenger**: Tự resize ảnh >8MB trước khi đính kèm.

### Fixed
- [x] Yahoo Finance API batch v7 chết (401) → chuyển sang v8/chart song song (parallel) với fallback.
- [x] Bỏ polling delay 700ms trong Yahoo fetch (làm chậm ticker).
- [x] CSP siết chặt hơn: loại bỏ `https:` wildcard, chỉ cho phép domain cụ thể.
- [x] Xóa file renderer.js cũ còn lại và file log rác (`hs_err_pid*`).
- [x] Sửa lỗi logic `app.js` (file chết) gọi window.messenger không tồn tại.
- [x] Kéo thả file bây giờ dùng `webUtils.getPathForFile` (API Electron fix lỗi `File.path` bị xóa).
- [x] Deleting message xóa cả file gốc trên ổ cứng (không còn file rác).

### To Verify
- [ ] Mở Monitor (`/world`), chuyển tab sang INTEL, đợi 5 giây để feed load.
- [ ] Kéo timeline slider để xem lịch sử động đất.
- [ ] Nghe alert beep khi có M≥6 (nếu may mắn).
- [ ] Paste ảnh screenshot vào Messenger input.
- [ ] Gõ `**bold**` và `# Heading` trong Messenger.
- [ ] Click vào ảnh trong chat để xem Lightbox.
