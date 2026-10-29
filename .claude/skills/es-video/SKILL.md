---
name: es-video
description: Make a video with this repo (es-render) from a plain request — "làm video 60s giới thiệu X", motion graphics, explainer, product promo, 3D product shot / logo spin (3d element: React Three Fiber + physics + bloom), kinetic typography, list/tutorial video with AI voice and captions, or embedding a motion2code / anim.seek page (window.anim.seek) as a scene or overlay. Use whenever the user asks for a video, a scene, or an animation to export as MP4, or a render job in this repo. Default for every video in this repo (n8n jobs, AI voice + captions, HyperFrames projects, Remotion projects via rm.mjs with its licence note); hand off to the fframes-video skill only when the user names fframes/Rust or a jobs/<name>/ folder has a Cargo.toml.
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
- **Thư viện mới** (chỉ nạp khi xin): `"libs": ["anime4"]` (anime.js v4 ở `window.anime4`, v3 vẫn là `anime`), `["motion"]` (Motion vanilla, `ES.motion(Motion.animate(…), start)`),
  `["dotlottie"]` / `["rive"]` (runtime cho code tự viết; thường dùng phần tử `dotlottie` / `rive` bên dưới). Cách viết + lỗi hay gặp: `references/new-libs.md`.
  Không WAAPI (`el.animate`, `anime4.waapi`), không Worker / OffscreenCanvas, không CDN, không giờ thật: mọi chuyển động là hàm của `t` trong `ES.onSeek`.
- Lottie: `lottie.loadAnimation({ container, renderer: 'svg', autoplay: true, animationData })`. Three.js: vòng `requestAnimationFrame` bình thường, dùng `performance.now()/1000` làm thời gian; WebGL chạy SwiftShader (CPU) nên giữ cảnh nhẹ (≤ vài nghìn tam giác, canvas ≤ 1080px).
- SFX: dùng file âm thanh của mình (`audio` + comment `sfx <loại> peakAt=<giây>`).

### Phần tử dotlottie / rive (rive: thử nghiệm — lỗi vẽ báo `E_RIVE_DRAW`, xem `references/new-libs.md`)

- `{ "type": "dotlottie", "src": "<id>/logo.lottie", "theme": "dark", "slots": { "bg_color": "#E50914" }, "segment": [0, 90], "loop": true, "speed": 1, "fit": "contain" }`
  — file `.lottie` (theme, slot đổi màu thương hiệu, nhiều animation: `animation-id`) hoặc Lottie `.json`. JSON Lottie thường đang dùng `libs: ["lottie"]` thì cứ giữ (hai engine vẽ hơi khác nhau).
- `{ "type": "rive", "src": "<id>/mascot.riv", "state-machine": "State Machine 1", "inputs": [ { "time": 1.2, "name": "wave", "value": true }, { "time": 3, "name": "jump", "value": "fire" } ], "fit": "contain", "alignment": "center" }`
  — hoặc `"animation": "<tên timeline>"`. Bước cố định 60 Hz theo đồng hồ ảo (30 hay 60 fps ra cùng tư thế), `time` của input tính bằng giây phần tử (trước `speed`).
  `.riv` có ảnh nhúng / tài nguyên ngoài → `E_RIVE_UNSUPPORTED` (xuất lại chỉ vector + font nhúng); âm thanh trong `.riv` bị bỏ (dùng `audio`).
- Chung với `html`: `x y width height start duration fade-in fade-out z-index keyframes animation`, `"on-error": "hide"`, `"timeout"` (s). File ≤ 8 MB, cả job ≤ 24 MB;
  đặt cạnh job (`jobs/<id>/…`; trên CI file ngoài thư mục job / repo → `E_EL_SRC_OUTSIDE`). Mẫu: `examples/dotlottie-hello/`, `examples/rive-hello/`. File `.riv` / `.lottie` có giấy phép riêng — chỉ dùng file mình có quyền.

### Phần tử 3d (bundle es3d: React Three Fiber + drei + rapier + postprocessing — chi tiết `references/3d.md`)

- `{ "type": "3d", "preset": "product-hero", "image": "<id>/label.png", "colors": { "bg": "#0b0b10", "accent": "#ff3b30" }, "fx": { "bloom": 0.9, "vignette": 0.35 }, "physics": { "restitution": 0.35 }, "width": 1080, "height": 1920 }`
  — sản phẩm (hộp có nhãn `image`, hoặc `model` `.glb` không nén) rơi có vật lý xuống bệ xoay + hạt nảy + viền phát sáng; `"preset": "logo-spin"` = đồng xu logo quay. Mẫu `examples/3d-hello/`.
- Vật lý bước cố định 60 Hz, tư thế là hàm của `t`, hậu kỳ chỉ bloom / vignette / DOF (`fx.noise` bị từ chối). Không có chữ 3D: phủ `text` / `html`. Chậm (SwiftShader ~1,5–3 s / khung 1080×1920): giữ cảnh 3D ngắn (≤ 6–8 s), `aa: 0` để nhanh hơn.

### Trang anim.seek (motion2code) làm cảnh / lớp phủ

Trang HTML theo hợp đồng motion2code (`window.anim = { duration, seek(t) }`, `<html data-ready="1">`, `?external=1` không tự chạy) nhúng thẳng vào cảnh:
`{ "type": "anim", "src": "<id>/<tên>.html", "start": 0, "duration": 5, "seek": 0, "speed": 1, "loop": true, "fit": "contain" }`
- Thay cho `src` có thể viết cả trang thẳng trong job: `"html": "<!doctype html>…"` (đường dẫn tương đối trong trang tính từ thư mục chứa file job JSON); trang dài thì nên để file riêng.
- Lưu trang ở `jobs/<id>/<tên>.html` (**không** đặt tên `index.html` — workflow sẽ coi là dự án HyperFrames), đẩy cùng commit với `jobs/<id>.json`; `src` tính từ thư mục chứa file JSON. Không dùng URL http(s).
- Mặc định cả khung (x 0, y 0, width/height = khung video), `fit: contain` (trang 16:9 trong khung dọc có viền màu nền trang — đặt `background-color` cảnh trùng màu); `cover` để lấp kín (cắt hai bên).
- Lớp phủ trong suốt: `"background": "transparent", "hide": ["#bg"]` (`#bg` là hình nền của mẫu motion2code).
- Thời gian: giây của animation = `seek + (giây cảnh − start) × speed`, `loop: true` quay vòng theo `anim.duration` (mẫu motion2code liền mạch). `loop: false` chạy một lần rồi đứng ở `until` (giây của animation, mặc định hết animation — với trang motion2code khung cuối **chính là khung mở đầu**, nên muốn dừng ở cao trào thì đặt `"until": 3.2`). Không có tiếng. Cảnh không có `duration` thì dài bằng một vòng của trang (hoặc tới `until`).
- render chờ trang sẵn sàng (≤ `timeout`, mặc định 20 s: `data-ready`, mọi font khai báo, ảnh — font tới sau hạn đó sẽ đổi giữa cảnh, có cảnh báo `W_FONTS` / `W_FONT_SWAPPED_MID_RENDER`: tăng `timeout`) rồi mới chụp khung đầu; trang hỏng hợp đồng hoặc treo → job lỗi kèm tên cảnh/phần tử/lý do (báo trước khi đọc giọng), hoặc `"on-error": "hide"` để bỏ phần tử và ghi cảnh báo trong `result.anims` (hỏng ở lần chạy thử trước TTS → bỏ ở mọi cảnh; hỏng lúc dựng một cảnh → chỉ bỏ ở cảnh đó, các cảnh khác tự chạy cổng chờ riêng). Chỉ đặt phần tử `anim` trong `scenes[].elements`.
- Trong trang: GSAP CDN được thay bằng bản 3.15 trong `node_modules` (`result.anims[].gsap` ghi cả hai bản), `requestAnimationFrame`/`Date.now`/`new Date()`/`performance.now`/`Math.random` cố định theo đồng hồ của render, CSS animation và SVG `<animate>` cũng tua theo; `setTimeout`/`setInterval` chạy theo giờ thật tới cổng chờ (hẹn giờ đổi trang sau `data-ready` hoặc `setInterval` còn chạy → `W_BOOT_TIMERS`), sau đó bị bỏ qua (`W_TIMERS`); hàm `gsap.ticker.add` không theo tua (`W_TICKER`) — mọi chuyển động phải đi qua `anim.seek(t)`.
- Trang của skill khác (không có `window.anim`): `"contract": "seek"` (`window.seek(t)` + `DURATION`/`DUR`/`data-duration` + `READY`), `"render"` (`window.render(t)`),
  `"renderFrame"` (`window.renderFrame(t, canvas, 0)` + `TIMELINE.duration` + `ASSETS_READY`, kit của skill `animate`). Biến thời lượng phải nằm trên `window`
  (`var DUR = 4`, không `const`). Mẫu: `examples/anim-contracts/`.
- Trước khi đẩy: `python3 .claude/skills/motion2code/scripts/check_anim.py jobs/<id>/<tên>.html` (kiểm tra hợp đồng, 0,1 s). Ví dụ đầy đủ: `examples/anim-hello/` (`node render.mjs examples/anim-hello/anim-hello.json out`).

### Dự án HyperFrames (tuỳ chọn)

Khi người dùng muốn **xem trực tiếp lúc sửa** hoặc tự làm trên máy bằng HyperFrames: tạo dự án `npx hyperframes init <tên> --resolution portrait`, xem bằng `npx hyperframes preview` (studio `localhost:3002`, tự tải lại), dựng bằng `node hf.mjs <thư mục> out`. Đẩy thư mục vào `jobs/<tên>/` (có `index.html`) → Actions dựng lên Release như job JSON. Composition: `data-composition-id` / `data-start` / `data-duration` / `data-track-index`, phần tử `class="clip"`, timeline GSAP `paused` đăng ký `window.__timelines["main"]`. Chi tiết: `npx hyperframes docs` hoặc plugin HyperFrames (khai báo trong `.claude/settings.json`). Job tự động (n8n) vẫn dùng movie JSON ở trên.
Phiên bản dựng mặc định **0.8.181** (dự án cũ ra y hệt); dự án mới muốn bản mới hơn: `jobs/<tên>/es-render.json` `{ "hyperframes": "0.8.210" }`.
Khối có sẵn: `npx hyperframes add <block>` (chép vào dự án nên dựng lại vẫn y hệt). `remotion-to-hyperframes` (skill của plugin) chuyển code Remotion sang HyperFrames
mà không cần giấy phép Remotion. Phần media của HyperFrames: chỉ công cụ miễn phí, không gọi dịch vụ HeyGen trả phí.

### Chọn công cụ nào

| yêu cầu | công cụ |
|---|---|
| video từ prompt, kinetic type, list/tutorial, AI voice + phụ đề | movie JSON + `html` (GSAP) |
| hoạt ảnh nhân vật / UI có state machine (`.riv`) | phần tử `rive` |
| file `.lottie`, đổi màu thương hiệu bằng theme / slot | phần tử `dotlottie` (JSON Lottie thường: `libs: ["lottie"]`) |
| code viết cho anime.js v4 / Motion | `libs: ["anime4"]` / `libs: ["motion"]` + `ES.onSeek` (`references/new-libs.md`) |
| sản phẩm 3D rơi có vật lý, bệ xoay, bloom; logo 3D xoay (preset) | phần tử `3d` (`product-hero`, `logo-spin`) |
| 3D tự viết (khối, hạt, shader riêng) | `html` + `libs: ["three"]` (three 0.160, SwiftShader) |
| phim ra mắt sản phẩm | skill `product-launch-motion` → `anim` (`"contract": "seek"`) hoặc dự án HF |
| hiệu ứng / biểu đồ / mốc số liệu / explainer kiểu Vox / title 3D / ảnh bìa lặp | skill `motion-effects`, `animated-chart`, `milestone-reveal`, `vox-explainer`, `title-sequence-3d`, `loop-cover` → `anim` (`seek`) |
| viết prompt motion từ brand / video tham khảo | `motion-prompt-writer`, `reference-to-motion` |
| explainer minh hoạ (cắt giấy, riso, pixel, isometric…) | skill `animate` → `anim` (`"contract": "renderFrame"`) |
| mô phỏng (bầy đàn, hạt, máy 3D bay xuyên) | skill `web-sims` → `anim` |
| chọn phong cách hình | skill `film-styles` |
| xem lại khung trước khi giao | skill `review-loop` + `qa.mjs` |
| dựng lại video AI thành code | `motion2code` |
| dự án HTML xem trực tiếp khi sửa | HyperFrames `jobs/<id>/index.html` |
| người dùng nhắc Remotion / có dự án Remotion (React, `useCurrentFrame`) | `rm.mjs` — `jobs/<id>/` có `package.json` (dep `remotion`) + `package-lock.json`; **nói giấy phép Remotion trước** (mục dưới) |
| Rust / fframes | `fframes-video` |

### Chọn công cụ: movie JSON, HyperFrames hay fframes

Mặc định — job từ n8n, video có giọng đọc AI + phụ đề karaoke, cảnh HTML/GSAP, ảnh/video nguồn — dùng **movie JSON + `render.mjs`**. Người dùng muốn **xem trực tiếp khi sửa** bằng HTML trên máy → **HyperFrames** (`hf.mjs`). Người dùng nhắc fframes/Rust, hoặc thư mục `jobs/<tên>/` có `Cargo.toml` → **dự án fframes** (motion graphics thuần code chính xác từng khung, dựng lại y hệt — logo động, đồ thị, chữ động, thẻ số liệu, intro/outro — thì có thể *gợi ý* fframes, nhưng hỏi trước): làm theo skill `fframes-video`, tạo bằng `cargo fframes new <tên> --format portrait --yes` (9:16) hay `--format landscape` (16:9), dựng bằng `node ff.mjs <thư mục> out`, đẩy thư mục vào `jobs/<tên>/` (có `Cargo.toml`) để Actions dựng; mẫu `examples/fframes-hello` (feature `landscape` + `FF_FORMAT` để chọn khổ lúc dựng). fframes không có TTS/phụ đề tự động: giọng đọc phải là file trong `media/`, và lần build đầu trên Actions mất ~15–25 phút (sau đó có cache).

### Dự án Remotion (`rm.mjs`)

Chỉ dùng khi người dùng nhắc Remotion hoặc đưa dự án Remotion có sẵn; không tự chọn Remotion thay cho movie JSON / HyperFrames.
**Giấy phép (nói rõ với người dùng trước khi làm):** Remotion không phải mã nguồn mở — miễn phí cho cá nhân, công ty tối đa 3 nhân viên, tổ chức phi lợi nhuận
(kể cả video thương mại); công ty từ 4 người trở lên cần Company License (remotion.pro). Tính theo người/công ty chạy render (cả khi dựng trên CI cho khách).
Bản 5.0 đổi giấy phép. Không chép mã Remotion vào repo; skill Remotion chính thức chỉ cài cho tài khoản: `npx skills add -g remotion-dev/skills`.
Muốn tránh giấy phép: skill `remotion-to-hyperframes` → HyperFrames.

- Bắt đầu từ `examples/remotion-hello/` (9:16, 3 s, 30 khung/s) hoặc `npx create-video@4.0.539`; ghim **đúng** `remotion`, `@remotion/cli` (mọi `@remotion/*` cùng bản, mặc định 4.0.539),
  chạy `npm install` để có `package-lock.json`, xem bằng `npx remotion studio`.
- `remotion.json` (tuỳ chọn): `{ "entry": "src/index.ts", "composition": "Main", "concurrency": 1, "props": {…} }`.
- Dựng: `node rm.mjs <thư mục> out` (giống CI: `npm ci --ignore-scripts`, Chromium headless shell của Playwright, H.264 yuv420p BT.709) rồi `node qa.mjs`.
  Đẩy thư mục (không kèm `node_modules/`) vào `jobs/<id>/` → Actions dựng lên Release.
- Lỗi: `E_RM_NO_LOCK` (thiếu/lệch lockfile), `E_RM_VERSION` (ghim lỏng / lệch bản), `E_RM_NO_COMPOSITION` (sai id — thông báo kể id có thật), `E_RM_CONFIG`, `E_RM_INSTALL` (`npm ci` lỗi / thiếu CLI), `E_RM_NO_CHROME`, `E_RM_RENDER`, `E_RM_TIMEOUT` (quá `RM_TIMEOUT`, mặc định 1800 s).
- Dựng lại y hệt: chỉ tính từ `useCurrentFrame()`, `random(seed)` thay `Math.random`, không `Date`, không trạng thái mang qua khung; `@remotion/three` lái bằng frame, không bằng delta `useFrame`.
  Không có TTS/phụ đề tự động của es-render: giọng đọc là file trong `public/` (`<Audio>`).

## 1b. Video ngắn chuẩn ES Short: job CreativeSpec (`kind: "spec"`)

Video 30–60 s cho mạng xã hội (tip / list / tool drop) thì **không viết movie JSON** — viết CreativeSpec và để `spec/run.mjs` dựng:
- Luật duy nhất: `spec/core.cjs` (core 1.1.0, dùng chung với es-editor). `ESC.prompt({ topic, facts, lang, target })` cho đề bài, `ESC.check(spec, { facts })` kiểm tra; ví dụ đúng ở `spec/examples/`.
- Con số / kết quả chỉ được lấy từ FACTS (job `meta.facts`), trích trong `facts_used` (`FACTS#n`). Không có FACTS → kể các bước, không nêu số.
- Job: `{ "kind": "spec", "standard": "es-short/1", "core": "1.1.0", "spec": {…}, "meta": { "facts": [...] } }` đẩy vào `jobs/<id>.json`.
- CI đo giọng thật: hook nói xong ≤ 3.0 s, tổng 30–60 s, tiêu đề hook đọc được ngay khung 0 (S4b), đủ ảnh bìa 9:16 / 3:4 / 1:1. Kết quả có `outcome` (post / review / retry / fail).
- Thử không mạng: `SPEC_FAKE_TTS=1 SPEC_MUSIC_SRC= node spec/run.mjs jobs/<id>.json out`; xem `out/<id>.result.json` → `standard`, `hook.voice_end`, `outcome`.

## 2. Luôn kiểm tra trước khi giao

1. Render xong **xem khung hình** (đừng giao khi chưa nhìn):
   `for t in 0.5 2 4 6; do ffmpeg -v error -y -ss $t -i out/<id>.mp4 -frames:v 1 -vf scale=270:-1 f$t.png; done; ffmpeg -v error -y $(for t in 0.5 2 4 6; do echo -i f$t.png; done) -filter_complex hstack=4 strip.png` rồi đọc `strip.png`.
2. `node qa.mjs out/<id>.mp4 out/<id>.result.json` → khung đen, đứng hình, độ to (-14 LUFS), sai kích thước/độ dài, chớp hình 1–2 khung, khựng ở chỗ nối cảnh.
3. Lỗi hay gặp: chữ tràn khung (giảm cỡ / tăng `height`), font chưa tải (dùng Google Fonts trong `<link>`), animation không chạy (quên `libs`, hoặc dùng `setTimeout` — đồng hồ ảo chỉ điều khiển rAF), phần tử biến mất (đặt `duration` cho cảnh), chữ đè phụ đề (dời `y` phụ đề hoặc `hide`).
