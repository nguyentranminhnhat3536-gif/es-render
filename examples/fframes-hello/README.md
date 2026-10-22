# fframes-hello

Video mẫu 5,5 s làm bằng [fframes](https://github.com/dmtrKovalenko/fframes) (Rust, mỗi khung là một cây SVG, ffmpeg mã hoá):
một khung 9:16 tự vẽ viền, nút chọn trượt sang 16:9 thì khung đổi dạng theo, rồi dòng chữ *"Dọc hay ngang, bạn chọn."*
và chữ ký ETHAN STUDIO. Tạo bằng `cargo fframes new fframes-hello --format portrait --yes` rồi thay toàn bộ nội dung mẫu.

| file | là gì |
| --- | --- |
| `src/lib.rs` | video: bố cục theo khổ, timeline chuyển động, bản đồ âm thanh (mốc lấy từ các hằng `T_*`, nhịp 120 BPM) |
| `src/main.rs` | dòng lệnh `fframes::cli` (render, frame, strip, inspect, audio, preview) |
| `media/` | nhúng vào binary: font Be Vietnam Pro (OFL, xem `FONTS-OFL.txt`) và âm thanh `*.wav` |
| `tools/sounds.mjs` | sinh lại `media/*.wav` bằng toán (`node tools/sounds.mjs`), không dùng file của ai |

## Khổ 9:16 hay 16:9

Mặc định dọc **1080×1920 (9:16)**. Bản ngang **1920×1080 (16:9)** bật bằng feature `landscape` — bố cục tự đổi
(dọc: xếp chồng giữa màn; ngang: khung bên trái, chữ bên phải):

```sh
cargo run --release -- render -o doc.mp4                          # 9:16
cargo run --release --features landscape -- render -o ngang.mp4   # 16:9
FF_FORMAT=landscape node ../../ff.mjs . ../../out                 # qua ff.mjs của es-render
```

Dự án mới tạo bằng `cargo fframes new <tên> --format portrait|landscape|square --yes` thì khổ nằm cố định trong
`WIDTH`/`HEIGHT` của `src/lib.rs`; muốn chọn lúc dựng thì thêm feature như ở đây.

## Làm việc với nó

Ubuntu 24.04 (x264 bản 164): chạy `export FFMPEG_FORCE_BUILD=1` trước mọi lệnh `cargo` dưới đây — FFmpeg dựng sẵn cần
x264 bản 163, thiếu biến này sẽ lỗi liên kết `undefined symbol: x264_encoder_open_163`; lần build đầu lâu thêm ~12 phút.
`ff.mjs` tự bật biến này.

```sh
cargo run --release -- timeline            # thời lượng, các track âm thanh
cargo run --release -- inspect --pops      # thiếu font/glyph, chữ tràn khung, phần tử nhảy cóc
cargo run --release -- strip -n 12         # strip.png: 12 khung trong một ảnh
cargo run --release -- frame 1.6s,4.2s     # PNG cỡ thật trong frames/
cargo run --release -- audio analyze       # độ to (LUFS), đỉnh, im lặng
cargo run --release -- preview 1s          # cửa sổ xem trực tiếp có tiếng (máy có GPU)
cargo run --release -- render              # out.mp4
```

Máy không có GPU: thêm `--renderer skia-cpu` (Skia trên CPU) hoặc `--renderer cpu` (tiny-skia). Trên GitHub Actions
Vulkan chạy bằng lavapipe (`mesa-vulkan-drivers`) nên không cần cờ này.
