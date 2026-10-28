# Thư viện mới trong es-render: cách viết cho đúng đồng hồ ảo

Quy tắc chung: trang cảnh chạy **đồng hồ ảo** (VCLOCK). render.mjs tua tới giây `t` của cảnh rồi chụp. Một chuyển động đúng là **hàm thuần của t**:
cùng `t` → cùng hình, tua xuôi, ngược hay nhảy cóc đều như nhau. Vì vậy:

- Không WAAPI (`element.animate`, `anime4.waapi`, CSS transition chạy theo giờ trình duyệt), không Worker / SharedWorker / OffscreenCanvas,
  không CDN / fetch mạng, không `setTimeout` / `setInterval` để vẽ, không `crypto.getRandomValues` cho hình. `Math.random` đã có seed theo job.
- Cảnh có thư viện mới (`anime4`, `motion`, `dotlottie`, `rive`) thì `Date.now()` / `new Date()` = 2026-01-01 + giây ảo (không lộ ngày giờ thật).
- `ES.onSeek.push((t) => …)` nhận **giây của cảnh**. Phần tử bắt đầu ở `start` thì tự trừ: `const lt = Math.max(0, t - START)`.
- Việc cần chờ lúc khởi động (nạp font, giải mã ảnh, wasm), chỉ trong cảnh có thư viện mới (cảnh thường không có `ES.wait`; render.mjs đã tự chờ font + ảnh): `ES.wait.push(promise)` — render chờ tối đa `ES.waitMs` (mặc định 20 s) rồi mới chụp khung đầu.
  Việc bất đồng bộ trong một lần tua (hiếm): `ES.busy.push(promise)` — khung chỉ được chụp khi promise xong. Hàm trong `ES.onSeek` phải đồng bộ.

## anime.js v4 — `libs: ["anime4"]`

```html
<script>
const { createTimeline, stagger } = anime4;
const tl = createTimeline({ autoplay: false })
  .add('.sq', { y: [{ to: -160, ease: 'outExpo', duration: 500 }, { to: 0, ease: 'outBounce', duration: 700 }], delay: stagger(120) })
  .add(counter, { v: 2026, duration: 1400, onUpdate: () => (el.textContent = Math.round(counter.v)) }, 300);
ES.onSeek.push((t) => tl.seek(Math.max(0, t - 0.5) * 1000)); // 0.5 = start của phần tử, seek nhận mili giây
</script>
```

Khác v3 (`libs: ["anime"]`, `window.anime`): v4 dùng `animate(target, params)` / `createTimeline()` thay cho `anime({ targets })` / `anime.timeline()`;
`ease: 'outExpo'` thay cho `easing: 'easeOutExpo'`; `autoplay: false` + `seek(ms)` giống nhau. Hai bản chạy chung một cảnh được (`anime` = v3, `anime4` = v4).
Không dùng `anime4.waapi` (WAAPI), `onScroll`, `createDraggable`. Mẫu: `examples/anime4-hello.json`.

## Motion (motion.dev) — `libs: ["motion"]`

Bản vanilla (`window.Motion`). React (`motion/react`, `framer-motion`) **không** chạy trong phần tử `html`.
es-render bật `MotionGlobalConfig.useManualTiming` (giá trị đi qua frameloop JS, không WAAPI).

1. **Toán thuần (khuyên dùng):** tính giá trị ở giây t rồi tự gán.
   ```js
   const sp = Motion.spring({ keyframes: [0, 1], bounce: 0.5, visualDuration: 0.5 });
   ES.onSeek.push((t) => { const v = sp.next(Math.max(0, t - 1) * 1000).value; el.style.transform = `scale(${v})`; });
   ```
   Có thêm `Motion.mix`, `Motion.interpolate`, các hàm ease.
2. **`animate()` + `ES.motion(controls, start)`:** es-render đặt `controls.time` = giây phần tử và xả frameloop ngay trong lượt tua (nếu tự gán `c.time` trong
   `ES.onSeek` mà không xả, hình **trễ một khung**).
   ```js
   ES.motion(Motion.animate('#card', { y: [300, 0], opacity: [0, 1] }, { type: 'spring', bounce: 0.45, visualDuration: 0.8 }), 0);
   ```
Lò xo bằng CSS thuần (ý từ [motiondivision/ai-kit](https://github.com/motiondivision/ai-kit)): `transition-timing-function: linear(…)` với dãy điểm lấy mẫu từ
`Motion.spring` — dùng được cho CSS `@keyframes` (render.mjs tua CSS animation theo thời gian phần tử). Mẫu: `examples/motion-hello.json`.

## dotLottie — phần tử `dotlottie`

- `.lottie` = zip chứa Lottie JSON + theme + slot + nhiều animation. `theme`: id theme có trong file; `slots`: `{ "slotId": "#RRGGBB" | số | giá trị thô }`
  (màu hex tự đổi sang [r, g, b, a] 0–1). Theme / slot không có trong file → lỗi liệt kê những cái có.
- Khung = `segment[0] + (giây phần tử × speed × fps của file)`; `loop: true` quay vòng trong `segment`, `false` dừng ở khung cuối của `segment`.
- Wasm của trình phát nằm trong `node_modules` (không bao giờ tải từ CDN). State machine của dotLottie chưa hỗ trợ (cần chuột / tương tác).

## Rive — phần tử `rive` (thử nghiệm)

- **Thử nghiệm**: từng có 2/19 lần dựng cùng một job ra canvas Rive trống / vẽ dở (máy quá tải, đầy đĩa) mà job vẫn "done". Nay khung vẽ hỏng → `E_RIVE_DRAW` (render thử lại khung đó 2 lần, Rive dựng lại từ 0; vẫn hỏng thì job lỗi, không nhận khung sai). Video quan trọng: xem lại bản dựng, hoặc dùng `dotlottie`.
- Runtime `@rive-app/canvas-advanced-single` (canvas 2D, wasm nằm trong file .mjs). Không dùng lớp `Rive` cấp cao (vòng rAF riêng).
- Bước cố định 1/60 s: giây phần tử 1,5 → đúng 90 bước, ở 30 fps hay 60 fps như nhau. Tua lùi → dựng lại artboard từ 0 rồi chạy tới.
- `inputs`: `{ time, name, value }` — `true/false` (bool), số (number), `"fire"` (trigger); áp ở bước chứa `time × speed`. Tên input sai → lỗi liệt kê input có.
- Không hỗ trợ: ảnh raster trong `.riv` (giải mã bất đồng bộ, chưa chờ được), tài nguyên tải từ CDN của Rive, âm thanh, scripting, data binding động.

## Lỗi hay gặp (triệu chứng → sửa)

Bảng gọn theo kinh nghiệm dựng video bằng trang web; ý tưởng "triệu chứng → cách sửa" và "cắt theo năng lượng dải tần" học từ
[howseen-ai/claude-motion-design](https://github.com/howseen-ai/claude-motion-design) (MIT), viết lại cho es-render:

| triệu chứng | nguyên nhân thường gặp | sửa |
|---|---|---|
| hình đứng yên dù có code animation | animation chạy theo giờ thật (setTimeout, WAAPI, `autoplay: true` không seek) | timeline `paused` / `autoplay: false` + `ES.onSeek` |
| dựng lại hai lần ra khác nhau | `Date`, `crypto`, giá trị tích luỹ theo khung | mọi giá trị là hàm của t; random dùng `Math.random` (đã seed) |
| khung đầu thiếu chữ / ảnh | font hoặc ảnh tới sau | `ES.wait.push(document.fonts.ready)`, `img.decode()` |
| chuyển động giật ở 30 fps | thời gian quá ngắn (< 4 khung) hoặc ease vào/ra cùng chỗ | ≥ 0,25 s cho mỗi chuyển động, ease-out khi vào |
| hình nhảy một khung so với nhịp nhạc | cắt theo giây làm tròn | đặt mốc cắt ở khung gần nhất của beat / đỉnh năng lượng dải trầm (es-editor tính sẵn beat) |
| canvas mờ / vỡ | canvas nhỏ hơn hộp hoặc dpr ≠ 1 | `width/height` canvas = cỡ hộp |

## Đã xem nhưng không dùng trực tiếp

- **Motion Canvas** (MIT): tốt để làm trên máy (editor riêng); es-render không dựng project Motion Canvas (không có CLI dựng không giao diện chính thức).
- **Satori** (Vercel, MPL-2.0): Chromium của es-render đã vẽ thẻ / ảnh bìa với đủ CSS và dấu tiếng Việt.
- **Mediabunny** (MPL-2.0): mã hoá video trong trình duyệt — ứng viên cho xuất bản ngay trong OpenFilm Studio sau này; không thay CDP + x264 của es-render.
- **Remotion**: có giấy phép riêng (xem README "Nguồn & giấy phép"); es-render chưa có trình dựng Remotion.
