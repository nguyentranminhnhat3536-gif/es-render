# es-render

Bộ dựng video miễn phí cho hệ thống ETHAN STUDIO (n8n · ES · 2). Không giới hạn độ dài, không watermark.

**Luồng:** n8n tạo kịch bản (Gemini) → node *Dựng video* xuất `movie` (định dạng JSON2Video) → n8n đẩy `jobs/<id>.json` lên repo này → GitHub Actions chạy `render.mjs` (Chromium vẽ từng khung hình + ffmpeg ghép, giọng Microsoft Neural qua `edge-tts`, phụ đề karaoke, nhạc tự hạ dưới giọng, chuẩn hoá -14 LUFS) → MP4 lên Release `videos-YYYY-MM` → `results/<id>.json` có `url` để n8n đăng bài.

Chạy thử trên máy: `npm install && pip install edge-tts && node render.mjs jobs/<id>.json out`

Biến môi trường: `RENDER_FPS` (30), `RENDER_CONCURRENCY`, `TARGET_LUFS` (-14), `CHROME_PATH`, `FFMPEG`, `PYTHON`, `RENDER_CREATIVE` (bold), `RENDER_LOOK` (none), `RENDER_ANIM_TIMEOUT` (20 s, cổng chờ trang anim), `RENDER_ANIM_GSAP` (`page` = giữ GSAP CDN của trang anim thay vì bản trong `node_modules`). Mỗi video dựng xong được `qa.mjs` kiểm tra (kết quả ở `results/<id>.json` → `qa`).

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
- **Trang anim.seek (motion2code) làm cảnh hoặc lớp phủ**: phần tử `{ "type": "anim", "src": "<id>/<tên>.html" }` nhúng một trang theo hợp đồng `window.anim = { duration, seek(t) }` + `<html data-ready="1">` (trang do skill `motion2code` tạo). render tự chờ trang sẵn sàng (font, ảnh, `data-ready`) rồi tua `anim.seek` đúng từng khung theo đồng hồ của cảnh; `seek`, `speed`, `loop` (+ `until` để dừng ở một giây), `fit` (contain|cover), `background: "transparent"` + `hide: ["#bg"]` cho lớp phủ. Trang hỏng hợp đồng → job lỗi (hoặc `"on-error": "hide"` để bỏ phần tử); `result.json` có `anims` (kết quả từng phần tử). Code ở `anim.mjs`, ví dụ: `node render.mjs examples/anim-hello/anim-hello.json out`. es-editor kiểm tra engine có hỗ trợ bằng `node render.mjs --features` → `{"features":["anim"]}`.
- **Kiểm thử** (không cần mạng, không gọi API trả phí): `npm test` (thuần + trình duyệt, ~2 phút) và `npm run test:render` (dựng thật qua `render.mjs`, so với `render_anim.py` / `frame_diff.py` của motion2code, trang treo, và so khung với `render.mjs` trước thay đổi, ~3 phút). Cần Chromium của Playwright + ffmpeg; phần so với motion2code cần thêm `uv`. `ANIM_NET=1` bật các ca cần Google Fonts / cdnjs.
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

Đẩy cả thư mục dự án vào `jobs/<tên>/` (phải có `index.html`) — bằng git, hoặc trên web GitHub: **Add file → Upload files**, kéo thả thư mục, sửa đường dẫn thành `jobs/<tên>/`. Workflow `render` dựng bằng `hf.mjs` (HyperFrames phiên bản cố định 0.8.181), chạy QA, đưa MP4 lên Release và ghi `results/<tên>.json` (`url`, `qa`). Thư mục dự án được giữ lại: sửa rồi đẩy lại là dựng lại. Mẫu: `examples/hyperframes-hello/`.

Dựng thử trên máy: `node hf.mjs examples/hyperframes-hello out` → `out/hyperframes-hello.mp4`.

`.claude/settings.json` khai báo sẵn plugin HyperFrames: mở repo này bằng Claude Code trên máy (và tin cậy thư mục) là có skill HyperFrames. Job tự động từ n8n vẫn dùng movie JSON + `render.mjs` như cũ.

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
