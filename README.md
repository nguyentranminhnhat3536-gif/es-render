# es-render

Bộ dựng video miễn phí cho hệ thống ETHAN STUDIO (n8n · ES · 2). Không giới hạn độ dài, không watermark.

**Luồng:** n8n tạo kịch bản (Gemini) → node *Dựng video* xuất `movie` (định dạng JSON2Video) → n8n đẩy `jobs/<id>.json` lên repo này → GitHub Actions chạy `render.mjs` (Chromium vẽ từng khung hình + ffmpeg ghép, giọng Microsoft Neural qua `edge-tts`, phụ đề karaoke, nhạc tự hạ dưới giọng, chuẩn hoá -14 LUFS) → MP4 lên Release `videos-YYYY-MM` → `results/<id>.json` có `url` để n8n đăng bài.

Chạy thử trên máy: `npm ci && pip install edge-tts && node render.mjs jobs/<id>.json out` (`npm ci` cài đúng phiên bản trong `package-lock.json`)

Biến môi trường: `LOUDNORM` (`2pass` = chuẩn hoá 2 lượt cho mọi job), `RENDER_FPS` (30), `RENDER_CONCURRENCY`, `TARGET_LUFS` (-14), `CHROME_PATH`, `FFMPEG`, `PYTHON`, `RENDER_CREATIVE` (bold), `RENDER_LOOK` (none), `RENDER_ANIM_TIMEOUT` (20 s, cổng chờ trang anim), `RENDER_ANIM_GSAP` (`page` = giữ GSAP CDN của trang anim thay vì bản trong `node_modules`). Mỗi video dựng xong được `qa.mjs` kiểm tra (kết quả ở `results/<id>.json` → `qa`).

## Sáng tạo

Mặc định bộ dựng tự làm "đạo diễn" cho mọi job, không cần sửa n8n:

- **Chuyển cảnh đa dạng theo vai trò cảnh** (đọc từ `comment` của cảnh, vd `s02 item · badge_grid`): `fade` mặc định được đổi sang kiểu hợp cảnh, không lặp kiểu liền trước. Cảnh `item` → zoom xuyên / whip-up / smoothup / circleopen…, `feature` → whip / smoothleft / coverleft / hblur…, `offer` → zoom / circleopen, `end_card` → fadewhite / circleclose. Kiểu khác `fade` mà kịch bản chọn sẵn thì giữ nguyên.
- **Máy quay sống**: mỗi cảnh đẩy vào / kéo ra / trôi nhẹ (tối đa ~4%, không lộ mép).
- **Nhấn theo SFX**: audio có comment `boom`/`hit`/`impact` → giật zoom + rung đúng `peakAt`; `riser` → đẩy dần tới đỉnh.
- **Phụ đề `pop`**: từ đang đọc đổi màu + nảy, từ khoá trong `settings.keywords` được tô màu, ngắt dòng theo dấu câu / chỗ ngắt hơi thay vì cắt đều số từ, font tải đúng độ đậm từ Google Fonts.

Cùng một job dựng lại luôn ra cùng một video (ngẫu nhiên theo `seed`, mặc định là id job).

Điều chỉnh bằng `movie.creative` (hoặc env `RENDER_CREATIVE`):

```json
"creative": "subtle"
"creative": "off"
"creative": { "level": "bold", "seed": "lan-2", "transitions": "auto", "camera": true, "beats": true, "subtitles": "boxed-word", "look": "film" }
```

| Khoá | Giá trị |
|---|---|
| `level` | `bold` (mặc định) · `subtle` (chuyển cảnh êm, chuyển động một nửa, không rung) · `off` (giống hệt bản cũ) |
| `transitions` | `auto` (đổi `fade` mặc định) · `keep` (giữ đúng kịch bản) |
| `camera` / `beats` | `true` / `false` |
| `subtitles` | ghi đè kiểu phụ đề, xem bên dưới |
| `look` | `none` · `film` (hạt + vignette) · `glow` (toả sáng) · `vivid` · `warm` · `cool` · `noir` |
| `seed` | chuỗi bất kỳ, đổi để ra phương án khác |

### Thêm cho bộ tạo kịch bản

- `transition.style`: mọi kiểu xfade của ffmpeg (`smoothleft`, `circleopen`, `coverup`, `revealleft`, `hblur`, `fadewhite`, `radial`…), thêm `zoom`, `whip`, `whip-up` (dựng bằng máy quay, có nhoè chuyển động), `auto` (để đạo diễn chọn), `none`/`cut` (cắt thẳng).
- `subtitles.settings.style`: `classic` (karaoke tô dần) · `pop` · `one-word` (từng từ to giữa màn) · `progressive` (chữ hiện dần theo giọng) · `boxed-word` (khung màu sau từ đang đọc) · `boxed-line` (khung tối sau cả dòng). Màu thêm: `keyword-color`, `box-color`, `box-text-color`.
- Phần tử `html`/`image`: `"animation": "pop"` hoặc `{ "in": "rise", "out": "fade", "duration": 0.45 }` với `fade` `pop` `zoom` `rise` `drop` `slide-left` `slide-right` `slide-up` `slide-down` `blur` `spin` `elastic` `flip`.
- `keyframes`: thêm thuộc tính `blur` (px); `easing` thêm `ease-out-elastic`, `ease-out-bounce`, `spring`, `ease-in-out-expo`, `*-quart`, `*-circ`, `hold`, `cubic-bezier(x1,y1,x2,y2)`.

- Phần tử `video`: `src`, `seek`, `duration`, `fit` (`cover` · `contain` · `blur` — video ngang trong khung dọc có nền mờ), `muted`, `audio` (file âm thanh thay thế cùng mốc thời gian), `words` (mốc từng từ → phụ đề). Ảnh cũng dùng được làm `video` (tĩnh, có fit + keyframes).

## Thư viện chuyển động và QA

- **GSAP / Anime.js / Lottie / Three.js** trong phần tử `html`: thêm `"libs": ["gsap"]` (nhúng từ `node_modules`, phiên bản cố định trong `package.json`). Trang dựng chạy *đồng hồ ảo* — `requestAnimationFrame`, `performance.now()`, `Date.now()` đi theo thời gian cảnh — nên mọi animation khớp từng khung; WebGL chạy SwiftShader (CPU). Điều khiển chính xác: `ES.onSeek.push((t) => tl.seek(t))`. Plugin GSAP (SplitText, ScrambleText, DrawSVG, MorphSVG, MotionPath, CustomEase/Bounce/Wiggle, Flip, Physics2D…) cũng chỉ cần thêm tên vào `libs` — tự nạp và đăng ký. `Math.random()` cố định theo seed → dựng lại ra y hệt.
- **Trang anim.seek (motion2code) làm cảnh hoặc lớp phủ**: phần tử `{ "type": "anim", "src": "<id>/<tên>.html" }` nhúng một trang theo hợp đồng `window.anim = { duration, seek(t) }` + `<html data-ready="1">` (trang do skill `motion2code` tạo). Thay cho `src` có thể viết cả trang thẳng trong job: `"html": "<!doctype html>…"` (đường dẫn tương đối trong trang tính từ thư mục chứa file job JSON). render tự chờ trang sẵn sàng (`data-ready`, mọi font khai báo và ảnh, tới hết `timeout`, mặc định 20 s) rồi tua `anim.seek` đúng từng khung theo đồng hồ của cảnh; `seek`, `speed`, `loop` (+ `until` để dừng ở một giây), `fit` (contain|cover), `background: "transparent"` + `hide: ["#bg"]` cho lớp phủ. Trong trang, `Date.now()`, `new Date()`, `performance.now()`, `requestAnimationFrame` và `Math.random` cố định theo đồng hồ của render; `setTimeout`/`setInterval` và `gsap.ticker.add` thì không (cảnh báo `W_BOOT_TIMERS`, `W_TIMERS`, `W_TICKER`) — mọi chuyển động phải đi qua `anim.seek(t)`. Trang hỏng hợp đồng → job lỗi (hoặc `"on-error": "hide"` để bỏ phần tử: hỏng ở lần chạy thử → bỏ ở mọi cảnh, hỏng lúc dựng một cảnh → chỉ bỏ ở cảnh đó); `result.json` có `anims` (kết quả từng phần tử). Code ở `anim.mjs`, ví dụ: `node render.mjs examples/anim-hello/anim-hello.json out`. es-editor kiểm tra engine có hỗ trợ bằng `node render.mjs --features` → `{"features":["anim","dotlottie","rive","lib:anime4","lib:motion","anim-contract"]}` (bản cũ chỉ có `"anim"`).
- **Thư viện và phần tử mới** (chỉ nạp khi job xin; job cũ dựng ra y hệt từng điểm ảnh — có test so với bản trước):
  - `"libs": ["anime4"]` — anime.js **v4.5.0** ở `window.anime4` (`createTimeline({ autoplay: false })` + `tl.seek(ms)` trong `ES.onSeek`); `"anime"` vẫn là v3.2.2, hai bản chạy chung một cảnh được.
  - `"libs": ["motion"]` — [Motion](https://motion.dev) **14.7.1** bản vanilla, bật `useManualTiming` (không WAAPI): toán thuần `Motion.spring(…).next(ms)` hoặc `ES.motion(Motion.animate(…), start)`. React (`motion/react`) không chạy trong `html`.
  - Phần tử **`dotlottie`** — file `.lottie` (theme, slot đổi màu thương hiệu, segment, nhiều animation) hoặc Lottie JSON, trình phát ThorVG wasm của [dotlottie-web](https://github.com/LottieFiles/dotlottie-web) 0.81.0, `setFrame` theo giây phần tử.
  - Phần tử **`rive`** (thử nghiệm) — file `.riv` (artboard, state machine, timeline, `inputs` theo mốc: bool / số / `"fire"`), runtime canvas của [rive-wasm](https://github.com/rive-app/rive-wasm) 2.48.0, bước cố định 60 Hz theo đồng hồ ảo (30 hay 60 fps ra cùng tư thế), tua lùi thì dựng lại từ đầu. Khung vẽ hỏng (lỗi khi vẽ, canvas mất ngữ cảnh, canvas trống bất thường) → `E_RIVE_DRAW`: render tua lại khung đó tối đa 2 lần, vẫn hỏng thì job lỗi.
  - Phần tử `anim` nhận thêm **`"contract"`**: `"seek"` (`window.seek(t)`), `"render"` (`window.render(t)`), `"renderFrame"` (`window.renderFrame(t, canvas, 0)`) — trang của các skill product-launch-motion, charlie947, animate, web-sims dựng được mà không sửa; mặc định `"anim"` như cũ.
  - Cách hoạt động: `els.mjs` đổi `dotlottie` / `rive` thành phần tử `html` thường (canvas + script) trước khi tính thời lượng, nên vị trí, `start`/`duration`, `fade-in/out`, `keyframes`, `animation`, `z-index` dùng như mọi phần tử; file đọc bằng Node (≤ 8 MB / file, ≤ 24 MB / job), trang không bao giờ lên mạng (wasm lấy từ `node_modules`, không CDN). `libs.mjs` nạp thư viện mới sau các thư viện cũ; cảnh có thư viện mới thì `Date.now()` / `new Date()` đóng băng về 2026-01-01 + giây ảo, `window.ready()` chờ `ES.wait` (hạn = `timeout` lớn nhất, mặc định 20 s), `window.seek()` chờ `ES.busy`. Lỗi rõ ràng: `E_DOTLOTTIE_LOAD/THEME/SLOT`, `E_RIVE_LOAD/UNSUPPORTED/DRAW`, `E_EL_FIELD`, `E_EL_SRC_NOT_FOUND`, `E_ASSET_TOO_BIG`, `E_EL_TIMEOUT`, `E_LIB_MISSING`; `"on-error": "hide"` để bỏ phần tử. Tên thư viện + phiên bản ghi trong log của cảnh (không vào `result.json`).
  - Ví dụ: `examples/anime4-hello.json`, `examples/motion-hello.json`, `examples/dotlottie-hello/`, `examples/rive-hello/`, `examples/anim-contracts/` (`node render.mjs <file job> out`).
- **Kiểm thử** (không cần mạng, không gọi API trả phí): `npm test` (thuần + trình duyệt, ~4 phút; gồm `test/libs/`: khoá thư viện, dựng hai lần ra cùng khung, tua xuôi/ngược/lộn xộn, Rive 30 = 60 fps, không đồng hồ thật / Worker / mạng, cổng chờ, file hỏng) và `npm run test:render` (dựng thật qua `render.mjs`, so với `render_anim.py` / `frame_diff.py` của motion2code, trang treo, và so khung với `render.mjs` trước thay đổi, ~5 phút; `test/libs/regress.test.mjs` dựng bộ job tổng hợp — GSAP + plugin, anime v3, CSS animation, keyframes, ảnh, video, máy quay + chuyển cảnh, lottie-web, three 0.160, `anim`, nhạc + SFX + ducking — bằng bản gốc `d0ec723` và bản hiện tại: khung, tiếng, `result.json` và HTML từng cảnh phải trùng hoàn toàn; `BASE_REF` để đổi bản gốc; `test/libs/rive-stress.test.mjs` dựng `examples/rive-hello` ≥ 5 lần, một phần song song, phải ra một framemd5, và một khung Rive hỏng phải được thử lại / làm job lỗi `E_RIVE_DRAW`, không bao giờ "done" với khung sai; `RIVE_STRESS_N` để tăng số lần). Cần Chromium của Playwright + ffmpeg; phần so với motion2code cần thêm `uv`. `ANIM_NET=1` bật các ca cần Google Fonts / cdnjs.
- **QA** (`qa.mjs`): khung đen, đứng hình, không tiếng, sai kích thước/độ dài, độ to lệch -14 LUFS, chớp hình (1–2 khung lạc), khựng hình ở chỗ nối cảnh (mốc nối ở `result.scenes`).
- **Skill Claude Code** `.claude/skills/es-video`: mở repo trong Claude Code rồi nói "làm video 60s giới thiệu …".

## HyperFrames (HTML → video, xem trực tiếp khi đang sửa)

[HyperFrames](https://github.com/heygen-com/hyperframes) (HeyGen, Apache 2.0) cũng dựng video từ HTML + GSAP bằng Chrome + FFmpeg như `render.mjs`, nhưng có **studio xem trực tiếp**: sửa file là trình duyệt tự cập nhật. Repo này nhận dự án HyperFrames và dựng chúng trên GitHub Actions như job thường.

### Xem trực tiếp trên máy (không cần tải repo này về)

Cần: [Node.js 22+](https://nodejs.org), [FFmpeg](https://ffmpeg.org/download.html), Claude Code (app desktop hoặc dòng lệnh, gói Pro là đủ).

1. Mở Claude Code trong một thư mục trống bất kỳ, cài plugin HyperFrames (một lần):
   ```
   claude plugin marketplace add heygen-com/hyperframes
   claude plugin install hyperframes@hyperframes
   ```
2. Tạo dự án (có thể kèm video gốc): `npx hyperframes init video-cua-toi --resolution portrait --video raw.mp4`
3. Mở xem trực tiếp: `cd video-cua-toi && npx hyperframes preview` → trình duyệt mở studio ở `http://localhost:3002`.
4. Nói với Claude hiệu ứng muốn có, ví dụ *"Dùng /hyperframes: thêm phụ đề nhảy chữ, zoom nhẹ ở câu hook, chuyển cảnh whip"* — mỗi lần Claude sửa file, studio tự tải lại để bạn xem ngay.
5. Xuất file: `npx hyperframes render` (MP4 nằm trong `renders/`).

Xem lại một dự án đã đẩy lên GitHub mà không clone cả repo: `npx giget@latest gh:nguyentranminhnhat3536-gif/es-render/jobs/<tên> <tên>` rồi `cd <tên> && npx hyperframes preview`.

### Dựng trên GitHub

Đẩy cả thư mục dự án vào `jobs/<tên>/` (phải có `index.html`) — bằng git, hoặc trên web GitHub: **Add file → Upload files**, kéo thả thư mục, sửa đường dẫn thành `jobs/<tên>/`. Workflow `render` dựng bằng `hf.mjs` (HyperFrames phiên bản cố định 0.8.181 — `HF_VERSION` trong `render.yml`; dự án mới muốn bản mới hơn thì thêm `jobs/<tên>/es-render.json` `{ "hyperframes": "0.8.210" }`, chỉ dự án đó đổi; mặc định chỉ được nâng trong một PR riêng sau khi so `framemd5` các dự án cũ trên hai bản), chạy QA, đưa MP4 lên Release và ghi `results/<tên>.json` (`url`, `qa`). Thư mục dự án được giữ lại: sửa rồi đẩy lại là dựng lại. Mẫu: `examples/hyperframes-hello/`.

Dựng thử trên máy: `node hf.mjs examples/hyperframes-hello out` → `out/hyperframes-hello.mp4`.

Mẹo: `data-motion-blur` (nhoè chuyển động, tuỳ chọn), `npx hyperframes add <block>` (khối có sẵn được chép vào dự án nên dựng lại vẫn y hệt), skill `remotion-to-hyperframes` của plugin để chuyển code Remotion sang HyperFrames. Phần media (TTS, tách nền…) chỉ dùng công cụ miễn phí chạy trên máy, không gọi dịch vụ HeyGen trả phí.

`.claude/settings.json` khai báo sẵn plugin HyperFrames (ghim tag `v0.8.181`, cùng bản với lúc dựng): mở repo này bằng Claude Code trên máy (và tin cậy thư mục) là có skill HyperFrames. Job tự động từ n8n vẫn dùng movie JSON + `render.mjs` như cũ.

## Âm thanh: tuỳ chọn mới (mặc định không đổi)

- `"audio": { "loudnorm": "2pass" }` ở cấp movie (hoặc env `LOUDNORM=2pass`): đo độ to một lượt rồi chuẩn hoá tuyến tính theo số đo (`measured_*` + `linear=true`) — sát -14 LUFS hơn, ít "bơm" hơn. Mặc định vẫn 1 lượt như trước.
- Nhạc nền `{ "type": "audio", …, "duck": { "threshold": 0.025, "ratio": 4, "attack": 20, "release": 400, "voice_band": true } }`: chỉnh mức hạ nhạc dưới giọng; `voice_band` lọc 120 Hz – 6 kHz trên tín hiệu điều khiển (nhạc chỉ hạ khi có tiếng nói, không hạ vì tiếng trống). Không khai báo = đúng như trước.
- Workflow ghi `runner:` (bản Ubuntu) và phiên bản ffmpeg vào log để biết máy nào đã dựng.

## Dự án Remotion (chưa dựng trong es-render)

Remotion **không phải mã nguồn mở**. Giấy phép Remotion miễn phí cho cá nhân, công ty có tối đa 3 nhân viên, tổ chức phi lợi nhuận và để dùng thử (kể cả làm video thương mại);
công ty từ 4 người trở lên phải mua Company License tại [remotion.pro](https://remotion.pro). Bản 5.0 sẽ đổi giấy phép. es-render không chứa mã Remotion và hiện chưa có trình dựng
dự án Remotion (`rm.mjs` chỉ làm khi chủ kênh xác nhận cần). Điều kiện miễn phí tính theo người/công ty chạy render: ai fork es-render (repo công khai) phải tự xét giấy phép của mình;
dựng tự động trên máy chủ/CI cho khách hàng của một công ty lớn hơn 3 người cũng cần Company License. Đọc lại `LICENSE.md` của đúng bản Remotion trước khi dùng.
Skill Remotion chính thức ([remotion-dev/skills](https://github.com/remotion-dev/skills), không có file giấy phép riêng) chỉ cài cho tài khoản của mình: `npx skills add -g remotion-dev/skills` —
không chép vào `.claude/skills` của repo. Các skill MIT dùng Remotion (whaleyxbt, haidrrrry) không cấp giấy phép Remotion. Muốn chuyển một dự án Remotion sang thứ es-render dựng được:
skill `remotion-to-hyperframes` của HyperFrames.

## Dự án fframes (Rust)

[fframes](https://github.com/dmtrKovalenko/fframes) (Dmitriy Kovalenko, MIT) dựng video bằng code Rust: mỗi khung là một cây SVG (`svgr!`), chuyển động bằng `timeline!` và lò xo, âm thanh đặt bằng `AudioMap`, Skia vẽ (GPU Vulkan/Metal hoặc CPU), ffmpeg mã hoá. Hợp với motion graphics cần chính xác từng khung (logo động, đồ thị, chữ chạy, thẻ số liệu), dựng nhanh và lặp lại y hệt. Skill `.claude/skills/fframes-video` là bản chép nguyên văn của skill mà `npx skills add https://fframes.studio` cài (nguồn, commit và giấy phép ở `SOURCE`, `LICENSE`).

### Làm trên máy

1. Cài [Rust](https://rustup.rs) và thư viện: Ubuntu `sudo apt-get install -y yasm nasm pkg-config clang libclang-dev ninja-build libx264-dev libx265-dev libopus-dev libvpx-dev libasound2-dev` · macOS `brew install pkg-config ffmpeg x264 x265 opus nasm ninja`.
   **Ubuntu 24.04** (x264 bản 164): chạy `export FFMPEG_FORCE_BUILD=1` trước mọi lệnh `cargo` (cả `cargo run -- preview`), vì FFmpeg dựng sẵn cần x264 bản 163 — thiếu biến này sẽ hỏng lúc liên kết với `undefined symbol: x264_encoder_open_163`. Lần build đầu lâu thêm ~12 phút. `ff.mjs` tự bật biến này.
2. Tạo dự án: `cargo install --locked cargo-fframes` rồi `cargo fframes new video-cua-toi --format portrait --yes` (**9:16**, 1080×1920) hoặc `--format landscape` (**16:9**, 1920×1080).
3. Mở Claude Code trong thư mục đó, nói *"Dùng skill fframes-video: …"*. Xem trực tiếp có tiếng: `cargo run --release -- preview` (máy có GPU); kiểm tra không cần xem: `strip`, `frame`, `inspect --pops`, `audio analyze`.
4. Dựng giống trên GitHub: `node ff.mjs <thư mục> out` → `out/<tên>.mp4` + `out/<tên>.result.json`, rồi `node qa.mjs out/<tên>.mp4 out/<tên>.result.json`.

### Dựng trên GitHub

Đẩy cả thư mục vào `jobs/<tên>/` (có `Cargo.toml`, `src/`, `media/`, nên kèm `Cargo.lock`; **không** đẩy `target/`). Workflow `render` nhận thư mục có `Cargo.toml` mà không có `index.html` → `ff.mjs` (cargo build --release + lệnh `render -o` của chính dự án) → `qa.mjs` → MP4 lên Release, `results/<tên>.json` như job thường; thư mục được giữ lại để sửa và đẩy lại.

- **Lần build đầu ~15–25 phút**: Actions chạy Ubuntu 24.04 có x264 bản 164, còn FFmpeg dựng sẵn của fframes 1.3.0 liên kết bản 163, nên `ff.mjs` tự bật `FFMPEG_FORCE_BUILD=1` và dựng FFmpeg từ mã nguồn (Skia vẫn tải bản dựng sẵn). Kết quả nằm trong cache Actions (`~/.cargo` + `~/ff-target`, khoá theo bản Ubuntu + bản Rust + `Cargo.lock`): các lần sau chỉ build lại phần của dự án (~1–2 phút) rồi render vài giây. Rust stable ra bản mới (~6 tuần/lần) hay image Ubuntu đổi thì lần chạy kế tiếp lại build từ đầu một lần (cargo build lại mọi crate khi rustc đổi) rồi lưu cache mới.
- **Không có GPU**: Skia chạy Vulkan bằng lavapipe (`mesa-vulkan-drivers`, CPU). Mẫu 165 khung 1080×1920 dựng trong ~6–11 s trên 4 nhân. Dự án gọi `.renderers(SkiaRenderers::gpu(..))` như mẫu thì lỗi Vulkan sẽ tự dựng lại bằng `--renderer skia-cpu`, rồi `cpu`.
- **Khổ 9:16 hay 16:9**: chọn lúc tạo bằng `--format portrait|landscape`. Muốn đổi lúc dựng thì khai báo feature như `examples/fframes-hello` (`landscape = []`, `WIDTH`/`HEIGHT` theo `cfg!(feature = "landscape")`), rồi chạy tay workflow (**Actions → render → Run workflow**, `job: jobs/<tên>`, `format: landscape`) hoặc `FF_FORMAT=landscape node ff.mjs …` (nhận cả `9:16` / `16:9`). Dự án không có feature đó mà video ra khổ khác thì vẫn `done` nhưng `results/<tên>.json` có `format_ignored` để n8n/bot báo lại.
- Biến môi trường của `ff.mjs`: `FF_FORMAT`, `FF_FEATURES`, `FF_RENDERER` (`gpu` · `skia-cpu` · `cpu`), `FF_TIMEOUT` (render, mặc định 1800 s), `FF_BUILD_TIMEOUT` (3600 s), `CARGO_TARGET_DIR` (mặc định `~/.cache/es-fframes-target`, dùng chung mọi dự án), `FFMPEG_FORCE_BUILD`.
- QA: đặt `color_matrix: fframes::pix_fmt::YuvMatrix::Bt709` trong `EncoderOptions` (như mẫu) để không bị cảnh báo màu; video không có tiếng bị tính lỗi.

Mẫu: `examples/fframes-hello/` — khung 9:16 tự vẽ, nút chọn trượt sang 16:9 thì khung đổi dạng theo, *"Dọc hay ngang, bạn chọn."*, 5,5 s, tiếng sinh bằng code. Dựng thử: `node ff.mjs examples/fframes-hello out` (thêm `FF_FORMAT=landscape` cho bản 16:9).

## Nguồn & giấy phép

Thư viện dùng lúc dựng (cài từ npm, phiên bản ghim trong `package.json` + `package-lock.json`, không chép mã vào repo):

| tên | tác giả | phiên bản | giấy phép | dùng ở đâu |
|---|---|---|---|---|
| [GSAP](https://github.com/greensock/GSAP) + plugin | GreenSock (Webflow) | 3.15.0 | [GSAP Standard License](https://gsap.com/standard-license) — giấy phép riêng, miễn phí kể cả thương mại, cấm dùng trong sản phẩm cạnh tranh với trình dựng trực quan của Webflow (không phải trường hợp này); giữ nguyên chú thích đầu file `.min.js` | `libs: ["gsap", …]`, trang `anim` |
| [anime.js](https://github.com/juliangarnier/anime) v3 / v4 | Julian Garnier | 3.2.2 / 4.5.0 | MIT | `libs: ["anime"]` / `["anime4"]` |
| [lottie-web](https://github.com/airbnb/lottie-web) | Airbnb | 5.12.2 | MIT | `libs: ["lottie"]` |
| [three.js](https://github.com/mrdoob/three.js) | mrdoob và cộng sự | 0.160.0 | MIT | `libs: ["three"]` |
| [Motion](https://github.com/motiondivision/motion) | Motion B.V. | 14.7.1 | MIT | `libs: ["motion"]` |
| [dotlottie-web](https://github.com/LottieFiles/dotlottie-web) | LottieFiles | 0.81.0 | MIT | phần tử `dotlottie` |
| [rive-wasm](https://github.com/rive-app/rive-wasm) (`@rive-app/canvas-advanced-single`) | Rive | 2.48.0 | MIT | phần tử `rive` |
| [Playwright](https://github.com/microsoft/playwright) | Microsoft | 1.56.1 | Apache-2.0 | Chromium dựng khung |
| [HyperFrames](https://github.com/heygen-com/hyperframes) | HeyGen | 0.8.181 (mặc định) | Apache-2.0 | `hf.mjs` (qua `npx`), plugin Claude Code |
| [FFmpeg](https://ffmpeg.org) | FFmpeg | bản apt của runner | LGPL-2.1+ / GPL (x264) | ghép, mã hoá, âm thanh (dùng như chương trình, không nhúng) |

Skill Claude Code chép vào `.claude/skills/` (mỗi thư mục có `LICENSE` + `SOURCE` hoặc `UPSTREAM.md`: repo, commit, ngày, phần đã đổi / bỏ ra):

| skill | nguồn @ commit | giấy phép |
|---|---|---|
| `gsap-core`, `gsap-timeline`, `gsap-utils`, `gsap-plugins`, `gsap-performance` | [greensock/gsap-skills](https://github.com/greensock/gsap-skills) @ aed9cfd | MIT © GreenSock |
| `motion-design` | [LottieFiles/motion-design-skill](https://github.com/LottieFiles/motion-design-skill) @ f9a8a04 | MIT © LottieFiles |
| `fframes-video` | [dmtrKovalenko/fframes](https://github.com/dmtrKovalenko/fframes) @ 69174f0 | MIT © Dmitriy Kovalenko |
| `product-launch-motion` | [AbubakrChan/product-launch-motion](https://github.com/AbubakrChan/product-launch-motion) @ edbfb10 | MIT © Abubakr Chan (+ `NOTICE`: phim mẫu, logo, nhạc không thuộc MIT, không chép) |
| `motion-effects`, `animated-chart`, `milestone-reveal`, `launch-video`, `vox-explainer`, `title-sequence-3d`, `loop-cover`, `motion-prompt-writer`, `reference-to-motion` | [charlie947/motion-graphics-skills](https://github.com/charlie947/motion-graphics-skills) @ 229022e | MIT © Charlie Hills |
| `animate` | [cth9191/animate](https://github.com/cth9191/animate) @ 7e5eb56 | MIT © cth9191 |
| `web-sims`, `review-loop` | [whaleyxbt/claude-motion](https://github.com/whaleyxbt/claude-motion) @ e627941 | MIT © whaleyxbt (dự án gốc dùng Remotion — giấy phép riêng, không đi kèm) |
| `film-styles` (mục lục của es-render + 20 STYLE.md) | [lemomo-ai/lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar) @ 413a6bd | MIT © LemoLab (phim mẫu CC BY 4.0, không chép) |
| `motion2code` | skill của Lovis Odin, đưa vào repo ở commit a703c89 (2026-10-21; xem `SOURCE`) | MIT © 2026 Lovis Odin |
| `es-video` | của ETHAN STUDIO | — |

File thử / ví dụ: `.lottie` và Lottie JSON từ dotlottie-web (MIT © LottieFiles), `.riv` từ rive-wasm (MIT © Rive) — xem `CREDITS.md` trong `examples/dotlottie-hello`, `examples/rive-hello`, `test/fixtures`.
File `.riv`, `.lottie`, model 3D, font, nhạc có giấy phép riêng; người làm job phải có quyền dùng.

Chỉ tham khảo (link, ghi chú viết lại bằng lời của mình, không chép chữ): [remotion-dev/skills](https://github.com/remotion-dev/skills) và [Remotion](https://github.com/remotion-dev/remotion) (giấy phép Remotion, xem trên),
[motiondivision/ai-kit](https://github.com/motiondivision/ai-kit) (ý lò xo CSS `linear()`), [howseen-ai/claude-motion-design](https://github.com/howseen-ai/claude-motion-design) (bảng triệu chứng → cách sửa),
[haidrrrry/claude-remotion-skill](https://github.com/haidrrrry/claude-remotion-skill) (dùng Remotion — Remotion không "miễn phí / mã nguồn mở" như README đó viết), [vercel/satori](https://github.com/vercel/satori) (MPL-2.0),
[Vanilagy/mediabunny](https://github.com/Vanilagy/mediabunny) (MPL-2.0: nếu sau này dùng thì dùng gói npm nguyên bản và giữ thông báo giấy phép), [motion-canvas/motion-canvas](https://github.com/motion-canvas/motion-canvas) (MIT).

### Đã xem nhưng không dùng

- [goldfire/howler.js](https://github.com/goldfire/howler.js) — phát âm thanh theo đồng hồ AudioContext thật; es-render trộn âm thanh bằng ffmpeg, ngoài trình duyệt, chính xác từng mẫu.
- [199-biotechnologies/motion-dev-animations-skill](https://github.com/199-biotechnologies/motion-dev-animations-skill) — về giao diện web tương tác (cử chỉ, cuộn) với Motion v11; đã có ghi chú Motion riêng và skill chính thức ai-kit.
- Nâng three.js tại chỗ (0.160 → bản mới) — sẽ đổi hình của job cũ dùng `libs: ["three"]`; giữ 0.160.
- [vercel/satori](https://github.com/vercel/satori) — Chromium đã vẽ thẻ / ảnh bìa với đủ CSS và dấu tiếng Việt.
- [motion-canvas/motion-canvas](https://github.com/motion-canvas/motion-canvas) — có editor riêng để làm trên máy; không có lệnh dựng không giao diện chính thức để chạy trong CI.
- [Vanilagy/mediabunny](https://github.com/Vanilagy/mediabunny) — mã hoá video trong trình duyệt; không thay được chụp CDP + x264 của es-render (ứng viên cho OpenFilm Studio sau này).
- Gói 3D React (react-three-fiber, drei, react-three-rapier, react-postprocessing) — đã lên kế hoạch thành bộ `es3d` dựng sẵn (phần tử `3d`), chưa làm trong lần này; 3D hiện dùng `libs: ["three"]`.
