# es-render

Bộ dựng video miễn phí cho hệ thống ETHAN STUDIO (n8n · ES · 2). Không giới hạn độ dài, không watermark.

**Luồng:** n8n tạo kịch bản (Gemini) → node *Dựng video* xuất `movie` (định dạng JSON2Video) → n8n đẩy `jobs/<id>.json` lên repo này → GitHub Actions chạy `render.mjs` (Chromium vẽ từng khung hình + ffmpeg ghép, giọng Microsoft Neural qua `edge-tts`, phụ đề karaoke, nhạc tự hạ dưới giọng, chuẩn hoá -14 LUFS) → MP4 lên Release `videos-YYYY-MM` → `results/<id>.json` có `url` để n8n đăng bài.

Chạy thử trên máy: `npm install && pip install edge-tts && node render.mjs jobs/<id>.json out`

Biến môi trường: `RENDER_FPS` (30), `RENDER_CONCURRENCY`, `TARGET_LUFS` (-14), `CHROME_PATH`, `FFMPEG`, `PYTHON`.
