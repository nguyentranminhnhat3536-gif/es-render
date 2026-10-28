---
name: es-video
description: Make a video with this repo (es-render) from a plain request — "làm video 60s giới thiệu X", motion graphics, explainer, product promo, kinetic typography, list/tutorial video with AI voice and captions, or embedding a motion2code / anim.seek page (window.anim.seek) as a scene or overlay. Use whenever the user asks for a video, a scene, or an animation to export as MP4, or a render job in this repo. Default for every video in this repo (n8n jobs, AI voice + captions, HyperFrames projects); hand off to the fframes-video skill only when the user names fframes/Rust or a jobs/<name>/ folder has a Cargo.toml.
---

# es-video — studio dựng video bằng code

Viết **movie JSON** → `node render.mjs <movie.json> out` (MP4 1080×1920, đổi được). Đẩy `jobs/<id>.json` lên `main` → Actions tự dựng, MP4 lên Release, kết quả ở `results/<id>.json` (có `url`, `qa`). Chạy local cần `npm install && pip install edge-tts` và ffmpeg.

## 1. Video từ ý tưởng: viết movie JSON

Quy trình: kịch bản (hook ≤ 3s → nội dung → CTA) → chia cảnh 2–6s → mỗi cảnh: nền + chữ/đồ hoạ + giọng + SFX → render → **xem khung hình** → sửa.

```json
{ "width": 1080, "height": 1920, "creative": "bold",
  "elements": [
    { "type": "audio", "src": "<nhạc>", "volume": 0.18, "fade-out": 1.2 },
    { "type": "subtitles", "settings": { "style": "pop", "font-family": "Inter Tight", "font-weight": 800, "font-size": 72,
      "word-color": "#FF8CC6", "line-color": "#FFFFFF", "max-words-per-line": 3, "x": 540, "y": 1450, "keywords": ["AI"] } } ],
  "scenes": [ { "comment": "s01 hook", "background-color": "#0B0510", "transition": { "style": "zoom", "duration": 0.3 },
    "elements": [
      { "type": "html", "html": "<style>…</style><div>…</div>", "x": 0, "y": 0, "width": 1080, "height": 1920, "libs": ["gsap"] },
      { "type": "voice", "text": "Lời đọc của cảnh", "voice": "vi-VN-HoaiMyNeural", "start": 0.2, "extra-time": 0.4 },
      { "type": "audio", "src": "<sfx>", "start": 0, "duration": 0.9, "volume": 0.4, "comment": "sfx boom peakAt=0.05" } ] } ] }
```

- **Thời lượng cảnh** = giọng đọc + `extra-time` (hoặc `duration` của cảnh). `comment` "sNN <vai trò>" (hook / item / feature / offer / end_card) để đạo diễn chọn chuyển cảnh + máy quay.
- **Phần tử**: `html`, `image`, `video` (`src`, `seek`, `duration`, `fit`: cover|contain|blur, `muted`, `words` → phụ đề), `anim` (trang anim.seek / motion2code, xem bên dưới), `voice` (edge-tts; giọng Việt: `vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural`; Anh: `en-US-AndrewMultilingualNeural`), `audio`.
- Chung: `x y width height start duration fade-in fade-out z-index`, `keyframes` [{time, x, y, scale, rotate, opacity, blur, easing}], `animation`: pop | rise | drop | slide-left/right/up/down | blur | spin | elastic | flip | zoom | fade (hoặc `{in, out, duration}`).
- Easing: linear, ease-*, *-cubic/quart/expo/back/elastic/bounce, spring, hold, `cubic-bezier(…)`.
- Chuyển cảnh: mọi kiểu xfade của ffmpeg + `zoom` `whip` `whip-up`, `none` (cắt thẳng), `auto`.
- Phụ đề `style`: pop · one-word · progressive · boxed-word · boxed-line · classic. `hide: [[t0,t1]]` để ẩn khi có thẻ đồ hoạ.
- `creative`: bold | subtle | off hoặc `{ level, transitions, camera, beats, look: film|glow|vivid|warm|cool|noir }`. SFX có comment `boom|hit` → giật hình đúng `peakAt`.

### HTML và thư viện chuyển động

- Mỗi `html` là một hộp `width×height` ở (x, y). Mọi phần tử nên bắt đầu bằng **cùng một** `<link font><style>…</style>` để render gộp head.
- CSS `@keyframes` tự tua theo **thời gian của phần tử** (giây 0 = lúc phần tử xuất hiện) → dùng `animation-delay` để xếp nhịp.
- `"libs": ["gsap" | "anime" | "lottie" | "three"]` nhúng thư viện từ node_modules (bản cố định). Trang chạy **đồng hồ ảo**: `requestAnimationFrame`, `performance.now()`, `Date.now()` đi theo thời gian **của cảnh** → GSAP/Anime/Lottie/Three tự khớp khung. Animation bắt đầu ngay khi cảnh bắt đầu; phần tử xuất hiện muộn thì thêm `delay` bằng `start`, hoặc tự điều khiển chính xác:

```html
<script>const tl = gsap.timeline({ paused: true }); tl.from('.w', { y: 200, opacity: 0, stagger: .08, ease: 'back.out(2)' });
ES.onSeek.push((t) => tl.seek(t - 1.2)); /* t = giây của cảnh; 1.2 = start của phần tử */</script>
```

- **Plugin GSAP** (miễn phí từ 3.13, đang dùng 3.15): thêm tên vào `libs` — `splittext`, `scrambletext`, `text`, `drawsvg`, `morphsvg`, `motionpath`, `customease`, `custombounce`, `customwiggle`, `easepack`, `flip`, `physics2d`, `physicsprops`. render tự nạp `gsap` trước và tự `registerPlugin`; **không** dùng CDN, **không** dùng ScrollTrigger / ScrollSmoother / Draggable / Observer (không có cuộn / chuột khi dựng).
  - SplitText đo chữ → tách sau khi font tải xong: `document.fonts.ready.then(() => { const sp = SplitText.create('#t', { type: 'chars,words' }); tl.from(sp.chars, {…}); tl.seek(ES.time); })`.
  - Luôn dùng timeline `paused: true` + `ES.onSeek.push((t) => tl.seek(t - start))` cho animation quan trọng; `setTimeout` / `setInterval` không chạy theo đồng hồ ảo.
  - `Math.random()` (và `gsap.utils.random`, `'random(-40,40)'`) cố định theo seed của job + số cảnh → dựng lại ra cùng một video.
  - Nguyên tắc GSAP / chuyển động chi tiết: skill `gsap-core`, `gsap-timeline`, `gsap-plugins`, `gsap-utils`, `gsap-performance`, `motion-design` (chỉ animate `transform` / `opacity` khi được, ease `power2–4.out` cho vào, `.in` cho ra, stagger 0.03–0.08s).
- Lottie: `lottie.loadAnimation({ container, renderer: 'svg', autoplay: true, animationData })`. Three.js: vòng `requestAnimationFrame` bình thường, dùng `performance.now()/1000` làm thời gian; WebGL chạy SwiftShader (CPU) nên giữ cảnh nhẹ (≤ vài nghìn tam giác, canvas ≤ 1080px).
- SFX: dùng file âm thanh của mình (`audio` + comment `sfx <loại> peakAt=<giây>`).

### Trang anim.seek (motion2code) làm cảnh / lớp phủ

Trang HTML theo hợp đồng motion2code (`window.anim = { duration, seek(t) }`, `<html data-ready="1">`, `?external=1` không tự chạy) nhúng thẳng vào cảnh:
`{ "type": "anim", "src": "<id>/<tên>.html", "start": 0, "duration": 5, "seek": 0, "speed": 1, "loop": true, "fit": "contain" }`
- Lưu trang ở `jobs/<id>/<tên>.html` (**không** đặt tên `index.html` — workflow sẽ coi là dự án HyperFrames), đẩy cùng commit với `jobs/<id>.json`; `src` tính từ thư mục chứa file JSON. Không dùng URL http(s).
- Mặc định cả khung (x 0, y 0, width/height = khung video), `fit: contain` (trang 16:9 trong khung dọc có viền màu nền trang — đặt `background-color` cảnh trùng màu); `cover` để lấp kín (cắt hai bên).
- Lớp phủ trong suốt: `"background": "transparent", "hide": ["#bg"]` (`#bg` là hình nền của mẫu motion2code).
- Thời gian: giây của animation = `seek + (giây cảnh − start) × speed`, `loop: true` quay vòng theo `anim.duration` (mẫu motion2code liền mạch). `loop: false` chạy một lần rồi đứng ở `until` (giây của animation, mặc định hết animation — với trang motion2code khung cuối **chính là khung mở đầu**, nên muốn dừng ở cao trào thì đặt `"until": 3.2`). Không có tiếng. Cảnh không có `duration` thì dài bằng một vòng của trang (hoặc tới `until`).
- render chờ trang sẵn sàng (≤ `timeout` 20 s: `data-ready`, mọi font khai báo, ảnh) rồi mới chụp khung đầu; trang hỏng hợp đồng hoặc treo → job lỗi kèm tên cảnh/phần tử/lý do (báo trước khi đọc giọng), hoặc `"on-error": "hide"` để bỏ phần tử và ghi cảnh báo trong `result.anims`. Chỉ đặt phần tử `anim` trong `scenes[].elements`.
- Trong trang: GSAP CDN được thay bằng bản 3.15 trong `node_modules` (`result.anims[].gsap` ghi cả hai bản), `requestAnimationFrame`/`Date.now`/`Math.random` cố định theo đồng hồ của render, CSS animation và SVG `<animate>` cũng tua theo; `setTimeout`/`setInterval` sau khi sẵn sàng bị bỏ qua (cảnh báo `W_TIMERS`) — mọi chuyển động phải đi qua `anim.seek(t)`.
- Trước khi đẩy: `python3 .claude/skills/motion2code/scripts/check_anim.py jobs/<id>/<tên>.html` (kiểm tra hợp đồng, 0,1 s). Ví dụ đầy đủ: `examples/anim-hello/` (`node render.mjs examples/anim-hello/anim-hello.json out`).

### Dự án HyperFrames (tuỳ chọn)

Khi người dùng muốn **xem trực tiếp lúc sửa** hoặc tự làm trên máy bằng HyperFrames: tạo dự án `npx hyperframes init <tên> --resolution portrait`, xem bằng `npx hyperframes preview` (studio `localhost:3002`, tự tải lại), dựng bằng `node hf.mjs <thư mục> out`. Đẩy thư mục vào `jobs/<tên>/` (có `index.html`) → Actions dựng lên Release như job JSON. Composition: `data-composition-id` / `data-start` / `data-duration` / `data-track-index`, phần tử `class="clip"`, timeline GSAP `paused` đăng ký `window.__timelines["main"]`. Chi tiết: `npx hyperframes docs` hoặc plugin HyperFrames (khai báo trong `.claude/settings.json`). Job tự động (n8n) vẫn dùng movie JSON ở trên.

### Chọn công cụ: movie JSON, HyperFrames hay fframes

Mặc định — job từ n8n, video có giọng đọc AI + phụ đề karaoke, cảnh HTML/GSAP, ảnh/video nguồn — dùng **movie JSON + `render.mjs`**. Người dùng muốn **xem trực tiếp khi sửa** bằng HTML trên máy → **HyperFrames** (`hf.mjs`). Người dùng nhắc fframes/Rust, hoặc thư mục `jobs/<tên>/` có `Cargo.toml` → **dự án fframes** (motion graphics thuần code chính xác từng khung, dựng lại y hệt — logo động, đồ thị, chữ động, thẻ số liệu, intro/outro — thì có thể *gợi ý* fframes, nhưng hỏi trước): làm theo skill `fframes-video`, tạo bằng `cargo fframes new <tên> --format portrait --yes` (9:16) hay `--format landscape` (16:9), dựng bằng `node ff.mjs <thư mục> out`, đẩy thư mục vào `jobs/<tên>/` (có `Cargo.toml`) để Actions dựng; mẫu `examples/fframes-hello` (feature `landscape` + `FF_FORMAT` để chọn khổ lúc dựng). fframes không có TTS/phụ đề tự động: giọng đọc phải là file trong `media/`, và lần build đầu trên Actions mất ~15–25 phút (sau đó có cache).

## 2. Luôn kiểm tra trước khi giao

1. Render xong **xem khung hình** (đừng giao khi chưa nhìn):
   `for t in 0.5 2 4 6; do ffmpeg -v error -y -ss $t -i out/<id>.mp4 -frames:v 1 -vf scale=270:-1 f$t.png; done; ffmpeg -v error -y $(for t in 0.5 2 4 6; do echo -i f$t.png; done) -filter_complex hstack=4 strip.png` rồi đọc `strip.png`.
2. `node qa.mjs out/<id>.mp4 out/<id>.result.json` → khung đen, đứng hình, độ to (-14 LUFS), sai kích thước/độ dài, chớp hình 1–2 khung, khựng ở chỗ nối cảnh.
3. Lỗi hay gặp: chữ tràn khung (giảm cỡ / tăng `height`), font chưa tải (dùng Google Fonts trong `<link>`), animation không chạy (quên `libs`, hoặc dùng `setTimeout` — đồng hồ ảo chỉ điều khiển rAF), phần tử biến mất (đặt `duration` cho cảnh), chữ đè phụ đề (dời `y` phụ đề hoặc `hide`).
