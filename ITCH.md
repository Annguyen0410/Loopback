# Loopback on itch.io — nội dung từng ô, copy-paste được

Bản nháp cho trang itch.io của **Loopback 1.5.1**. Phần *in nghiêng* là ghi chú của tôi, phần trong khối code là chữ để bạn dán thẳng vào trang.

---

## Basic info (ô trên cùng của trang)

**Title:** `Loopback`

**Short description / tagline:**

```
Private, offline notes that look like a chat window with one contact: you — plus
screenshots, screen recording and a floating bubble.
```

*Ô này quan trọng hơn tags cho việc tìm kiếm: itch chỉ match keyword ở **title + short description**, còn tags là để phân loại/duyệt theo chủ đề. Nên nhét đủ từ khoá vào đây: notes, offline, private, screenshot, screen recording.*

**Kind of project:** `Tools` (itch gọi là "tool"; đổi "Custom noun" bên dưới thành `app`)

---

## Description

itch.io có **rich text editor**, muốn dán HTML thì bấm nút `<>` (HTML mode) rồi dán phần dưới. Nếu bạn gõ tay trong rich editor thì bỏ hết thẻ, giữ nguyên chữ.

```html
<p><strong>Loopback is a chat window with exactly one contact: you.</strong></p>

<p>No account, no sign-up, no sync service. Open it, type, done — every note lands in a plain JSON file on your own PC that you can read in Notepad and back up with a copy-paste.</p>

<h3>Why a chat window?</h3>
<p>Because every notes app I tried wanted me to sign up before it would let me paste a URL, and that friction is what kills the habit of writing things down. The best capture interface is not a better editor — it is the one you already know. Sending a message is a skill you have had for twenty years, so there is nothing to learn here.</p>

<h3>What is in it</h3>
<ul>
  <li><strong>Catch-all notes</strong> — as many lists as you want, rename / pin / delete, search inside a chat or across every chat.</li>
  <li><strong>Files, images, voice notes, drawings</strong> — attach, paste, drag &amp; drop, or send a whiteboard sketch.</li>
  <li><strong>Screenshots</strong> — drag a region on screen and a small review card opens with the picture and a <em>Download</em> button: one click and it is in your Downloads folder (also Copy, Save as…, Show in folder, Delete, and a minimize that folds the card down to its title bar). Type a note on the card and it is <em>printed into the picture</em>; Copy puts it on the clipboard ready to paste into a page, a document or a chat. Shots are named like a diary — <code>14-10-2026_18-05-09-shot.png</code> — and land in the in-app library too.</li>
  <li><strong>Screen recording</strong> — mic + camera, with a draggable floating camera bubble that gets burned into the recording.</li>
  <li><strong>Floating bar</strong> — hit minimize and the app turns into a tiny always-on-top bubble on the edge of your screen: screenshot, record, open the library, or reopen the chat from it, while you work in something else.</li>
  <li><strong>Runs in the tray</strong> — the icon next to the clock opens the chat, toggles the bubble and quits. Closing every window leaves Loopback running there instead of dying, and <em>Start with Windows</em> is on by default: a reboot brings it back hidden — tray plus chat bubble, no window in your way.</li>
  <li><strong>16 themes</strong>, light and dark, markdown, emoji, reactions, reply, pin, edit, delete.</li>
  <li><strong>Optional World window</strong> — earthquakes, market data and headlines from public feeds (USGS, GDACS, GDELT, NOAA, Open-Meteo, CoinGecko, Polymarket, World Bank, Celestrak). This is the only part of the app that ever touches the internet, and you can ignore it completely.</li>
</ul>

<h3>Install</h3>
<p>Windows 10 / 11 (x64). Two downloads:</p>
<ul>
  <li><strong>Setup</strong> — installs normally and adds a Start-menu shortcut.</li>
  <li><strong>Portable</strong> — one file, no install, no admin rights; run it from a USB stick if you want.</li>
</ul>
<p>The build is not code-signed, so Windows SmartScreen may say "Windows protected your PC": click <em>More info → Run anyway</em>. That warning is about the missing paid certificate, not about what the app does.</p>
<p>First launch puts Loopback in the tray with its chat bubble and turns on <em>Start with Windows</em> (switch it off any time in Settings). From then on it is simply already there after a reboot — no window to close, nothing to remember to open. The portable build unpacks itself into your temporary folder the first time it runs, so it needs roughly 250&nbsp;MB of free space on the drive that holds <code>%TEMP%</code> (the installer needs the same space on your system drive); if it seems to do nothing when double-clicked, that is almost always a nearly full C: drive.</p>

<h3>Where your data lives</h3>
<ul>
  <li><code>%APPDATA%\messenger-self-chat\</code> — <code>messages.json</code>, <code>settings.json</code>, <code>files\</code>, <code>voice\</code>, <code>captures\</code>. Back up the folder by copying it.</li>
  <li>No telemetry, no analytics, no account. Your notes are never uploaded anywhere.</li>
  <li>The chat window's own content-security policy blocks network access outright, so the part you type into cannot phone home even by accident.</li>
  <li>Uninstalling the app does not delete your notes — they are outside the install folder.</li>
</ul>

<h3>Shortcuts worth knowing</h3>
<ul>
  <li><strong>Ctrl+Alt+N</strong> — quick note box on top of anything.</li>
  <li><strong>Ctrl+F</strong> — search in this chat. <strong>Ctrl+Shift+F</strong> — search every chat.</li>
  <li><strong>Esc</strong> — collapse the floating popup back to the bubble, or close whatever is open.</li>
</ul>

<h3>Made by one person</h3>
<p>Source code, build scripts and the test suites ship in the repository: <a href="https://github.com/Annguyen0410/Loopback">github.com/Annguyen0410/Loopback</a>. Twelve Electron test suites (about 360 assertions) check that every window opens and closes, that closing them all leaves the app alive in the tray, that a screenshot really lands in your Downloads folder in one click, that all 16 themes keep WCAG AA contrast, and that your notes survive an upgrade.</p>
<p>Found a bug, or want something that is missing? Say so in the comments — it is one person reading them, and small fixes tend to ship the same week.</p>
```

### Bản chữ thường (nếu bạn muốn gõ trong rich editor thay vì HTML mode)

Dán đoạn dưới vào ô Description (không có thẻ), rồi bôi đen 4 dòng tiêu đề và bấm nút **Heading** trên thanh công cụ, bôi đen các dòng bắt đầu bằng `-` và bấm nút **Bulleted list**. Nếu lười chỉnh thì dùng bản HTML ở trên cho nhanh và đẹp hơn.

```
Loopback is a chat window with exactly one contact: you.

No account, no sign-up, no sync service. Open it, type, done — every note lands in a plain JSON file on your own PC that you can read in Notepad and back up with a copy-paste.

Why a chat window?
Because every notes app I tried wanted me to sign up before it would let me paste a URL, and that friction is what kills the habit of writing things down. The best capture interface is not a better editor — it is the one you already know. Sending a message is a skill you have had for twenty years, so there is nothing to learn here.

What is in it
- Catch-all notes — as many lists as you want, rename / pin / delete, search inside a chat or across every chat.
- Files, images, voice notes, drawings — attach, paste, drag & drop, or send a whiteboard sketch.
- Screenshots — drag a region on screen and a small review card opens with the picture and a Download button: one click and it is in your Downloads folder (also Copy, Save as…, Show in folder, Delete, and a minimize that folds the card down to its title bar). Type a note on the card and it is printed into the picture; Copy puts it on the clipboard ready to paste into a page, a document or a chat. Shots are named like a diary — 14-10-2026_18-05-09-shot.png — and land in the in-app library too.
- Screen recording — mic + camera, with a draggable floating camera bubble that gets burned into the recording.
- Floating bar — hit minimize and the app turns into a tiny always-on-top bubble on the edge of your screen: screenshot, record, open the library, or reopen the chat from it, while you work in something else.
- Runs in the tray — the icon next to the clock opens the chat, toggles the bubble and quits. Closing every window leaves Loopback running there instead of dying, and Start with Windows is on by default: a reboot brings it back hidden — tray plus chat bubble, no window in your way.
- 16 themes, light and dark, markdown, emoji, reactions, reply, pin, edit, delete.
- Optional World window — earthquakes, market data and headlines from public feeds (USGS, GDACS, GDELT, NOAA, Open-Meteo, CoinGecko, Polymarket, World Bank, Celestrak). This is the only part of the app that ever touches the internet, and you can ignore it completely.

Install
Windows 10 / 11 (x64). Two downloads: Setup (installs normally, adds a Start-menu shortcut) or Portable (one file, no install, no admin rights, runs from a USB stick). The build is not code-signed, so Windows SmartScreen may say "Windows protected your PC": click More info → Run anyway. That warning is about the missing paid certificate, not about what the app does.

Where your data lives
- %APPDATA%\messenger-self-chat\ — messages.json, settings.json, files\, voice\, captures\. Back up the folder by copying it.
- No telemetry, no analytics, no account. Your notes are never uploaded anywhere.
- The chat window's own content-security policy blocks network access outright, so the part you type into cannot phone home even by accident.
- Uninstalling the app does not delete your notes — they are outside the install folder.

Shortcuts worth knowing
- Ctrl+Alt+N — quick note box on top of anything.
- Ctrl+F — search in this chat. Ctrl+Shift+F — search every chat.
- Esc — collapse the floating popup back to the bubble, or close whatever is open.

Made by one person
Source code, build scripts and the test suites ship in the repository: github.com/Annguyen0410/Loopback. Twelve Electron test suites (about 360 assertions) check that every window opens and closes, that closing them all leaves the app alive in the tray, that a screenshot really lands in your Downloads folder in one click, that all 16 themes keep WCAG AA contrast, and that your notes survive an upgrade.
Found a bug, or want something that is missing? Say so in the comments — it is one person reading them, and small fixes tend to ship the same week.
```

### Đã kiểm chứng trước khi viết vào mô tả

- `Get-AuthenticodeSignature` trên cả `dist\Loopback Setup 1.5.1.exe` và `dist\Loopback 1.5.1.exe` → **Status: NotSigned** ⇒ câu cảnh báo SmartScreen trong mô tả là đúng, không phải phỏng đoán.
- **Bản build 1.5.1 kiểm bằng hash**: `main.js`, `index.html`, `preload.js`, `review.html`, `review.js`, `review-preload.js` và 4 file `src/renderer/*` trong `app.asar` **SHA-256 trùng từng byte** với working tree (chỉ `package.json` khác vì electron-builder rewrite — version trong asar = **1.5.1**).
- **Tính năng review ảnh đã test thật**: `reviewtest.js` chụp thật một vùng 160×120 → thẻ review hiện đúng ảnh, **một click Download ghi file PNG byte-identical vào thư mục Downloads** (test trỏ Downloads vào thư mục tạm), Copy đưa ảnh 160×120 vào clipboard, chụp lần 2 thay thế thẻ cũ (chỉ còn 1 thẻ), Delete xoá file + đóng thẻ + không sót cửa sổ — **19/19 PASS**.
- **Bản build 1.5.0 chạy thật, có tray**: chạy `dist\win-unpacked\Loopback.exe` với profile vứt đi → 6 tiến trình, cửa sổ `Responding: True`, tự tạo `files/`+`voice/`+`pip.json`, **không có `error.log`**; `Start with Windows` tự đăng ký entry `electron.app.Loopback = "...\Loopback.exe" --autostart` (đã xoá lại sau khi thử). Đo RAM: boot ẩn (tray + bong bóng, **không** cửa sổ chat) **524,7 MB / 6 tiến trình**; mở thêm cửa sổ chat **647,7 MB / 7 tiến trình** ⇒ cửa sổ chat tốn ~**123 MB**, và đó là phần mà chế độ “mở máy là chạy sẵn” không cần nạp.
- **Bản portable kiểm tra riêng**: chạy `dist\Loopback 1.5.0.exe` (bản 1.5.1 dùng đúng code đó, chỉ thêm cửa sổ review) với `TEMP` trỏ sang ổ D: → app lên (3 tiến trình), và login item ghi đúng **đường dẫn file portable** (`dist\Loopback 1.5.1.exe --autostart`), **không** trỏ vào thư mục tạm mà wrapper giải nén ra. Lưu ý thật (đo lại ngay khi đưa 1.5.1 ra desktop): portable tự giải nén vào `%TEMP%` **hai** thư mục (~460 MB + ~300 MB), nên cần khoảng **0,8 GB trống** trên ổ chứa `TEMP` — ở mức **0,34 GB trống thì bấm không lên** (wrapper thoát im lặng), còn **0,87 GB thì lên sau ~12 s**. Nếu người tải báo “bấm không lên” thì hỏi họ còn trống ổ C: không (hoặc chuyển sang bản Setup).
- CSP của `index.html`: `connect-src 'self' local-file:` → cửa sổ chat **không thể** gọi mạng; `src/renderer/` không có `fetch`/`XHR`/`WebSocket` nào. Chỉ `monitor.html` (cửa sổ World tuỳ chọn) có `connect-src https:` và gọi API công khai qua `net.fetch` trong `main.js`.
- Số liệu test: **12 suite** có assertion (`audittest`, `camtest`, `captest`, `combotest`, `hudtest`, `menutest`, `piptest`, `rectest`, `reviewtest`, `searchtest`, `traytest`, `uitest`) với **≈360** lần kiểm tra (`reviewtest` 19, `traytest` 19 + 7 ở chế độ `--autostart`).

---

## Tags (tối đa 10)

**Cách nhập:** đây là ô tokenizer, không phải ô text thường. Gõ một tag → **Enter** (hoặc **dấu phẩy**) → nó biến thành một chip; lặp lại cho từng tag. Gõ vài ký tự thì itch hiện danh sách gợi ý — **nếu thấy tag đó trong gợi ý thì bấm chọn**, vì tag có sẵn trong hệ thống mới có trang Browse riêng để người ta lọc ra; tag tự chế vẫn dùng được nhưng ít lợi hơn.

Nhập lần lượt 10 cái này (đúng thứ tự, Enter sau mỗi cái):

```
productivity
notes
note-taking
journal
privacy
offline
screenshot
screen-recorder
utility
dark-mode
```

Đừng thêm `windows` — itch đã tự gắn nền tảng từ file bạn upload, và nó ghi rõ "avoid duplicating any platforms".

Lý do: 4 tag đầu là thứ người ta gõ khi tìm app ghi chú; `privacy` + `offline` là điểm khác biệt của bạn; `screenshot` + `screen-recorder` là tính năng người dùng tìm riêng; `utility` + `dark-mode` là tag phổ biến để lọt vào danh sách duyệt.

---

## AI generation disclosure → chọn **Yes**

Nói thật và cụ thể:

```
The source code and documentation were written with AI-assisted tooling (Codebuff). The
app itself contains no generative AI features and makes no AI calls at runtime — no model
runs locally, no prompt and no note ever leaves your machine. Only the optional World
window fetches public data feeds, and none of it is sent anywhere.
```

*Đây là ô "contains content produced by generative AI … even if you hand-edited it" — code do AI viết cùng bạn thì thuộc diện Yes. Khai đúng vừa an toàn vừa không mất gì: itch không phạt, chỉ hiển thị nhãn.*

---

## App store links → để trống

Loopback chưa có trên Steam / Apple App Store / Google Play / Amazon / Windows Store. Ô này chỉ để liên kết chéo, bỏ trống là đúng.

---

## Custom noun → `app`

Mặc định là `tool`, đổi thành `app` để câu chữ trên trang đọc tự nhiên ("Download Now", "This app…") hơn là "this tool…".

---

## Community → bật **Comments**, để **Discussion board** tắt

Giai đoạn launch thì comment là kênh feedback rẻ nhất và nó hiện ngay dưới trang, người tải xong là thấy. Discussion board chỉ cần khi có nhiều chủ đề tách bạch — bật sớm chỉ tạo thêm một chỗ trống. Bật lại sau nếu comment bắt đầu rối.

---

## Visibility & access → làm ở **Draft** trước, xong xuôi mới **Public**

itch cho preview draft trước khi công khai. Thứ tự tôi đề nghị: Draft → upload file + dán mô tả + chọn tags + ảnh bìa/screenshot → tự xem lại bằng chính link draft → Public.

---

## Uploads

Hai file đã build sẵn, cùng nền tảng Windows (x64):

| File | Dung lượng | Nhãn hiển thị cho người tải |
| --- | --- | --- |
| `dist\Loopback Setup 1.5.1.exe` | 103.779.765 B (99,0 MB) | `Installer (recommended)` |
| `dist\Loopback 1.5.1.exe` | 103.557.750 B (98,7 MB) | `Portable — no install needed` |

Cách làm (không cần butler):

1. Kéo–thả **cả hai file cùng lúc** vào khung **Uploads**, hoặc bấm `Upload files` rồi chọn 2 file. Giới hạn 1 GB/file nên hai file ~99 MB là thoải mái; itch upload song song được.
2. Chờ từng thanh tiến trình chạy hết. **Đừng rời trang khi đang upload, và nhớ bấm `Save` ở cuối trang** — itch không tự lưu.
3. Với mỗi file, chọn nền tảng **Windows** trong dropdown cạnh tên file. Bỏ trống ô "This file will be played in the browser" (file này là app desktop, không phải game chạy web).
4. Tên file phải **khác nhau** (đúng như itch khuyến nghị, để không ghi đè nhau) — hai file của bạn đã khác tên sẵn.
5. Kéo để sắp thứ tự: **installer lên trên** (thành nút Download chính), portable xuống dưới. Nếu muốn nhãn đẹp hơn tên file thì sửa tên hiển thị của từng upload (không bắt buộc — `Loopback Setup 1.5.1.exe` cũng đã tự giải thích).
6. Lưu trang, rồi tải thử lại chính file đó từ link draft để chắc chắn nút Download hoạt động.

**Có nên up cả 2 file không?** Có — installer cho người muốn shortcut Start Menu, portable cho người không muốn cài / muốn chạy từ USB. Đổi lại: người tải phải chọn 1 trong 2, nên nhãn phải rõ ràng. Nếu muốn gọn cho ngày launch thì chỉ up installer, hôm sau thêm portable; còn đăng cùng lúc cũng không sao, itch hiện 2 nút Download riêng.

*Nếu bạn muốn itch app quản lý patch/auto-update thì mới cần butler: `butler push dist/win-unpacked annguyen0410/loopback:windows`. Cách này đẩy cả thư mục app đã unpack để app launcher của itch chạy `Loopback.exe` trực tiếp — hợp khi bạn phát hành nhiều bản liên tục, còn lần launch đầu thì upload tay là đủ và đơn giản hơn.*

---

## Ảnh bìa & screenshot (ô itch không hỏi nhưng trang nào cũng cần)

- **Cover image:** 630×500 — nên là ảnh chụp cửa sổ chat với vài note thật, kèm floating bar nằm bên mép phải.
- **Screenshots:** 1 ảnh floating bar lúc thu gọn, 1 ảnh media library, 1 ảnh theme picker (nhiều màu), 1 ảnh đang ghi màn hình (có HUD + camera bubble). Đây là 4 thứ trong 10 giây nói được app làm gì.

---

## Không nên viết gì

- Đừng gọi app là "Messenger" — đó là thương hiệu của Meta và sẽ khiến trang bị soi/từ chối.
- Đừng hứa "encrypted / bảo mật cấp ngân hàng": sự thật mạnh hơn — app **không có server** để mà rò rỉ, và CSP của cửa sổ chat chặn mạng hoàn toàn. Cứ nói đúng như thế.
- Đừng ghi "AI-powered": app không có tính năng AI nào.
