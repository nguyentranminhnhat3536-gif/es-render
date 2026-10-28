---
name: film-styles
description: Chọn phong cách hình cho một video trước khi dựng — 20 "style prompt" chi tiết (vật liệu, màu, chuyển động, chữ, âm thanh, lỗi hay gặp) từ thư viện lemo-opuscar của LemoLab: swiss grid, risograph, hồ sơ halftone, montage tư liệu, bản tin truyền hình, biểu đồ kể chuyện, isometric, pop-up giấy, cắt giấy đỏ, anime 80s, pixel RPG, tranh thuỷ mặc, bản vẽ kỹ thuật, HUD hologram, sản phẩm thuỷ tinh, keynote tối, tin tức có phụ đề lớn, một nét bút, pictogram, phim câm. Dùng khi người dùng hỏi "phong cách nào", "làm giống kiểu …", muốn một look rõ ràng cho explainer / promo / tin tức, hoặc khi brief chưa có hướng hình.
---

# Chọn phong cách (film-styles)

Mỗi thư mục `styles/<tên>/STYLE.md` là một bản mô tả phong cách đầy đủ (tiếng Anh, giữ nguyên bản gốc MIT của LemoLab — xem `UPSTREAM.md`).
Skill này chỉ là mục lục tiếng Việt + cách dùng trong es-render.

## Cách dùng

1. Đọc brief (chủ đề, khán giả, độ dài, khung 9:16 hay 16:9). Chọn 1–2 phong cách trong bảng; nếu người dùng chưa chọn, đưa 2 lựa chọn kèm một câu lý do.
2. Đọc **toàn bộ** `styles/<tên>/STYLE.md` đã chọn trước khi viết code: phần "what it is not", bảng màu, nhịp chuyển động và danh sách lỗi là luật.
3. Dựng theo đường của es-render (skill `es-video` quyết định): movie JSON + `html` (GSAP / anime4 / Motion), trang `anim` (motion2code,
   `"contract": "seek"` / `"render"` / `"renderFrame"`), hoặc dự án HyperFrames. Bản gốc nhắm khung 1920×1080: video dọc 1080×1920 thì giữ
   ngữ pháp (lưới, màu, nhịp), dàn lại bố cục theo chiều dọc.
4. Giọng đọc: phần tử `voice` (edge-tts miễn phí) của es-render; chỗ STYLE.md nhắc Kokoro là TTS cục bộ của bản gốc, không bắt buộc.
5. Tên thương hiệu, poster, logo thật: STYLE.md chỉ mô tả ngữ pháp hình — không chép bố cục một tác phẩm cụ thể, không dùng logo của người khác.

## Mục lục

| phong cách | hợp với | thư mục |
|---|---|---|
| Swiss grid, một màu tín hiệu, chuyển động khớp nhịp | brand, số liệu gọn, giới thiệu dịch vụ | `styles/swiss-motion` |
| Risograph: 2–3 mực in chồng, hạt, lệch bản | explainer trẻ trung, văn hoá | `styles/risograph` |
| Hồ sơ halftone cũ, tem đóng dấu | điều tra, "sự thật về…", lịch sử | `styles/halftone-dossier` |
| Montage tư liệu một màu đỏ, cắt theo nhịp máy | lịch sử, tuyên ngôn, kể chuyện mạnh | `styles/kino-montage` |
| Bản tin truyền hình: sting, rundown, lower third | tin tức, tổng hợp tuần | `styles/news-package` |
| Biểu đồ kể chuyện vẽ bằng bút chì đỏ–xanh | số liệu, báo cáo, so sánh | `styles/dataviz` |
| Isometric ba tông, nhãn mảnh, mở ra thấy bên trong | quy trình, hệ thống, "cách X hoạt động" | `styles/iso-infographic` |
| Sách pop-up trên bàn thật | kể chuyện thiếu nhi, quà tặng | `styles/paper-popup` |
| Cắt giấy đỏ (song hỷ, hoa cửa sổ) | Tết, lễ hội, văn hoá Á Đông | `styles/papercut-red` |
| Anime cel thập niên 80, neon | nhạc, game, hoài cổ | `styles/cel-anime-80s` |
| Game RPG pixel 320×180 | tutorial vui, hành trình, gamification | `styles/pixel-rpg` |
| Thuỷ mặc trên giấy dó | thiên nhiên, triết lý, thơ | `styles/ink-wash` |
| Bản vẽ kỹ thuật cyanotype | sản phẩm, kỹ thuật, "bên trong máy" | `styles/blueprint` |
| HUD hologram quét vật thể | công nghệ, phân tích sản phẩm | `styles/hologram-hud` |
| Sản phẩm thuỷ tinh, ánh sáng studio | ra mắt sản phẩm cao cấp | `styles/glass-product` |
| Keynote tối, giao diện là nhân vật chính | ra mắt phần mềm / app (đi cùng skill `product-launch-motion`) | `styles/dark-keynote` |
| Tin mạng xã hội đọc không cần tiếng, chữ to | tin nóng dọc 9:16 | `styles/caption-news` |
| Một nét bút không nhấc | logo, ý tưởng, chuyển cảnh biến hình | `styles/one-line` |
| Pictogram lưới vuông, thẻ chớp theo nhịp | quảng cáo nhịp nhanh, nhạc | `styles/pictogram-motion` |
| Phim câm khắc gỗ, intertitle | hài, lịch sử, kể chuyện cổ | `styles/silent-film` |

Thư viện gốc có thêm ~35 phong cách và phim mẫu cho từng phong cách: [lemomo-ai/lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar)
(phim mẫu CC BY 4.0 — ghi công LemoLab nếu dùng lại; ba giọng đọc trong phim mẫu không theo giấy phép đó). Phim mẫu không được chép vào đây.
