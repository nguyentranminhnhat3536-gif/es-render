# n8n · ES Short — 3 node quy chuẩn CreativeSpec (chưa áp lên n8n)

Nhánh n8n làm video ngắn chuẩn **es-short/1** (30–60 s, hook nói xong ≤ 3 s, tiêu đề đọc được ở khung 0, có ảnh bìa) từ một **card** (chủ đề / hook / ý chính / dữ kiện).
Repo công khai: không có id credential, chat id hay token trong các file này.

| Node | Loại | Làm gì |
|---|---|---|
| **ES Short · Soạn prompt quy chuẩn** | Code (`node1-soan-prompt.js` + `spec/core.cjs`) | đọc card (tên trường linh hoạt), bỏ trường giống bí mật, dữ kiện → danh sách **FACTS#n**, ra prompt / schema / thân Gemini; vòng sửa khi AI hoặc CI từ chối |
| ES Short · AI viết CreativeSpec | Gemini (hoặc node AI bất kỳ) | viết một CreativeSpec JSON |
| **ES Short · Kiểm tra CreativeSpec** | Code (`node2-kiem-tra.js` + `spec/core.cjs`) | kiểm bằng core 1.1 **với đúng FACTS của card** → `push` (job `kind: "spec"` mang `meta.facts`) · `retry` (feedback từng lỗi) · `stop` (báo tiếng Việt); lần 3 tự cắt gọt, không bịa |
| ES Short · Spec đạt? → Đẩy job lên es-render → Chờ render → Đọc kết quả render | Switch / GitHub / Wait / HTTP | đẩy `jobs/<id>.json`, đọc `results/<id>.json` |
| **ES Short · Render xong?** | Switch 5 ngả | ✅ Đăng (chỉ job spec, `outcome: post`, đúng `spec_hash`) · 👀 Cần duyệt · 🔁 Viết lại spec · ❌ Lỗi (hoặc quá 45 phút / 45 lần) · ⏳ Chưa xong |
| ES Short · Báo Sở Chỉ Huy · ➡️ Đăng bài | Telegram / noOp | ✅ chỉ tới Sở Chỉ Huy + chỗ nối nhánh đăng (noOp) — không bao giờ tự đăng khi chưa bật |

**Tên có tiền tố "ES Short · "**: workflow đang chạy (*ES · 1 Boss*, TTQaA7sjSFS6dWyS, bản 28/10) đã có node *Soạn prompt quy chuẩn*, *Kiểm tra CreativeSpec*,
*Spec đạt?*, *Chờ render*, *Render xong?* — đó là bộ **SaaS Motion** cũ (video 1:30–3:00 → *Dựng video* → JSON2Video / GitHub), khác hẳn. Trùng tên thì `$('…')` trỏ nhầm node.

## Hai cách đưa lên n8n (task này KHÔNG làm — chỉ chuẩn bị)

- **Dán**: `node n8n/es2/build.mjs` → `es2-standard-nodes.json` (đã commit) → mở file, copy tất cả, bấm canvas, Ctrl+V; chọn credential GitHub / Telegram / Gemini và chat id.
- **Thao tác update_workflow**: tải workflow mới nhất (`get_workflow_details`) rồi
  `node n8n/es2/build-ops.mjs workflow.json "Nguồn video" ops.json [--connect] [--chat-id <biểu thức>]` → `ops.json` (một lần gọi `update_workflow`, chỉ `addNode` / `addConnection`)
  + `ops-manifest.json`. Credential lấy theo kiểu từ chính workflow (đúng 1 mỗi kiểu, không thì DỪNG); node AI chép kiểu + credential + model của node AI mà card đang
  nối tới; chat id báo mặc định `$('<card>').first().json.chat_id`. DỪNG nếu thiếu card, đã có node "ES Short · …", thiếu credential, không thấy node AI.
  Mặc định **không nối card**: *Nguồn video* đang chạy nhánh video cũ, nối cả hai = gọi Gemini (quota miễn phí) và dựng hai lần. `--connect` khi đã tắt nhánh cũ.

Trên workflow 28/10 (`task10-build/final/live.json`): 28 thao tác (12 node, 16 kết nối), AI như *Gemini · CreativeSpec* (ES Gemini 1), GitHub *ES GitHub*, Telegram *ES Boss Bot*.

## 4 việc của anh khi bật

1. Áp (dán hoặc ops) — giữ `video_paused = true`.
2. Card phải có **dữ kiện** (mỗi dòng một số liệu thật) nếu muốn video nêu con số; không có thì video chỉ kể các bước.
3. Chạy thử 5 card; mỗi video ✅ / 👀 báo về Sở Chỉ Huy kèm link + ảnh bìa.
4. Đạt 5 lần liền thì nối ✅ vào nhánh đăng (video `{{ $json.url }}`, bìa `{{ $json.cover_url }}`, 3:4 `{{ $json.cover_3x4_url }}`) và tắt `video_paused`.

**Gỡ**: `video_paused = true`, xoá 12 node "ES Short · …" (không node cũ nào bị đổi).

Kiểm thử: `node test/spec/n8n-sim.mjs` (chạy bản dán theo cách n8n chạy + build-ops trên workflow giả; `ES2_LIVE_WF=<workflow.json>` chạy thêm trên workflow thật, chỉ sinh file).
