---
name: es-video
description: Make a video with this repo (es-render) from a plain request — "làm video 60s giới thiệu X", motion graphics, explainer, product promo, kinetic typography, list/tutorial video with AI voice and captions. Use whenever the user asks for a video, a scene, or an animation to export as MP4, or a render job in this repo.
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
- **Phần tử**: `html`, `image`, `video` (`src`, `seek`, `duration`, `fit`: cover|contain|blur, `muted`, `words` → phụ đề), `voice` (edge-tts; giọng Việt: `vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural`; Anh: `en-US-AndrewMultilingualNeural`), `audio`.
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

- Lottie: `lottie.loadAnimation({ container, renderer: 'svg', autoplay: true, animationData })`. Three.js: vòng `requestAnimationFrame` bình thường, dùng `performance.now()/1000` làm thời gian; WebGL chạy SwiftShader (CPU) nên giữ cảnh nhẹ (≤ vài nghìn tam giác, canvas ≤ 1080px).
- SFX: dùng file âm thanh của mình (`audio` + comment `sfx <loại> peakAt=<giây>`).

## 2. Luôn kiểm tra trước khi giao

1. Render xong **xem khung hình** (đừng giao khi chưa nhìn):
   `for t in 0.5 2 4 6; do ffmpeg -v error -y -ss $t -i out/<id>.mp4 -frames:v 1 -vf scale=270:-1 f$t.png; done; ffmpeg -v error -y $(for t in 0.5 2 4 6; do echo -i f$t.png; done) -filter_complex hstack=4 strip.png` rồi đọc `strip.png`.
2. `node qa.mjs out/<id>.mp4 out/<id>.result.json` → khung đen, đứng hình, độ to (-14 LUFS), sai kích thước/độ dài.
3. Lỗi hay gặp: chữ tràn khung (giảm cỡ / tăng `height`), font chưa tải (dùng Google Fonts trong `<link>`), animation không chạy (quên `libs`, hoặc dùng `setTimeout` — đồng hồ ảo chỉ điều khiển rAF), phần tử biến mất (đặt `duration` cho cảnh), chữ đè phụ đề (dời `y` phụ đề hoặc `hide`).
