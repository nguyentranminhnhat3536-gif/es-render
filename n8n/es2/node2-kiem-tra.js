// ===== n8n Code node "ES Short · Kiểm tra CreativeSpec" · Mode: Run Once for All Items · CreativeSpec es.creative/1.1 · chuẩn es-short/1 =====
// VÀO: câu trả lời của node AI, dạng nào cũng được (Gemini node content.parts · HTTP Gemini candidates · OpenAI message / choices · Anthropic content[] ·
//      AI Agent / Basic LLM Chain output / text · JSON thẳng · chuỗi có ```json); ngữ cảnh es { job_id, attempt, facts … } lấy từ node "ES Short · Soạn prompt quy chuẩn".
// RA (1 item): route = "push" | "retry" | "stop", ok, job_id, job_path, job_content (chuỗi JSON cho node GitHub "Create file"), commit_message,
//      spec, estimate { total, hook_end, words }, errors[], warnings[], summary_vi, feedback, alert_vi, es { …, attempt, pushed_at, spec_hash }
//   push  → "Spec đạt?" → GitHub tạo jobs/<job_id>.json trên es-render → chờ → đọc results/<job_id>.json → "Render xong?"
//   retry → quay lại "Soạn prompt quy chuẩn" (AI chỉ sửa đúng các lỗi trong feedback, lần thử + 1)
//   stop  → báo Sở Chỉ Huy (alert_vi). Lần thử cuối: tự sửa (salvage: cắt hook, bỏ cảnh dài, rút chữ — không bao giờ bịa nội dung) trước khi dừng;
//           chỉ sai luật thương hiệu (từ "hype", mở đầu chào hỏi) thì vẫn dựng nhưng gắn review → "Render xong?" ra 👀 Cần duyệt, không tự đăng.
const PROMPT_NODE = 'ES Short · Soạn prompt quy chuẩn'; // đổi tên node đó thì sửa ở đây
const ctxOf = (i) => { try { const m = $(PROMPT_NODE).itemMatching(i); if (m && m.json && m.json.es) return m.json; } catch (e) { /* item không ghép cặp được */ } try { return $(PROMPT_NODE).first().json || {}; } catch (e) { return {}; } };
let memo = null; try { memo = $getWorkflowStaticData('global'); } catch (e) { /* chạy thử: không có bộ nhớ workflow */ }
const out = [];
for (const [i, item] of $input.all().entries()) {
  const ctx = ctxOf(i);
  const es = { attempt: 1, max_attempts: 3, ...(ctx.es || {}) }; if (!es.job_id) { es.job_base = 'ES-000-' + Date.now(); es.job_id = es.job_base; }
  const attempt = Number(es.attempt) || 1; const max = Number(es.max_attempts) || 3;
  // không bao giờ tìm câu trả lời trong ngữ cảnh / prompt của chính mình (prompt có cả JSON mẫu)
  const { es: _es, prompt: _p, system: _s, user: _u, schema: _sc, schema_json: _sj, gemini_body: _g, temperature: _t, ...answer } = item.json || {};
  // facts: luôn là mảng — facts == null thì core nhận MỌI "FACTS#n" (AI bịa FACTS#1 vẫn qua), nên không bao giờ để undefined
  const facts = Array.isArray(es.facts) ? es.facts : [];
  const r = ESC.check(answer, { attempt, max, recent: es.recent, id: es.job_id, lang: es.lang, facts });
  const est = r.estimate ? { total: r.estimate.total, hook_end: r.estimate.hook_end, words: r.estimate.words } : null;
  const base = { ok: r.ok, job_id: es.job_id, attempt, errors: r.errors, warnings: r.warnings, estimate: est, summary_vi: ESC.summaryVi(r), core: ESC.CORE };
  if (r.ok) {
    const now = new Date().toISOString();
    const job = { id: es.job_id, kind: 'spec', standard: ESC.STANDARD.name, core: ESC.CORE, spec_hash: r.hash, spec: { ...r.spec, id: es.job_id }, // spec_hash: CI echoes it in results/<id>.json, "Render xong?" ignores a result whose hash is not this push's (stale file)
      meta: { source: 'n8n ES Short', tid: es.tid || '', attempt, max_attempts: max, facts, review: r.review, salvaged: r.salvaged || [], estimate: est,
        warnings: r.warnings.map((w) => w.code + ' ' + w.path).slice(0, 30), created_at: es.created_at || now, pushed_at: now },
      client: (() => { const c = { ...(es.card || {}) }; return JSON.stringify(c).length > 8000 ? { tid: es.tid || '' } : c; })() };
    if (memo) memo.es_recent = [{ hook_type: r.spec.hook.hook_type, layouts: r.spec.scenes.map((s) => s.layout), id: es.job_id, at: now }]
      .concat([].concat(memo.es_recent || []).filter((x) => x && x.id !== es.job_id)).slice(0, 12); // "Soạn prompt quy chuẩn" tránh lặp kiểu hook
    out.push({ json: { ...base, route: 'push', review: r.review, salvaged: r.salvaged || [], spec: job.spec, job_path: 'jobs/' + es.job_id + '.json', job_content: JSON.stringify(job, null, 1),
      commit_message: 'job ' + es.job_id + ' (CreativeSpec ~' + Math.round(est.total) + 's, lần ' + attempt + ')', es: { ...es, spec_hash: r.hash, pushed_at: now } }, pairedItem: { item: i } });
  } else if (attempt < max) {
    out.push({ json: { ...base, route: 'retry', feedback: r.feedback, spec: r.spec, es: { ...es, attempt: attempt + 1, feedback: r.feedback, prev: r.spec || String(answer.output || answer.text || '').slice(0, 4000) } }, pairedItem: { item: i } });
  } else {
    const alert_vi = '⚠️ ES·2: AI viết CreativeSpec sai chuẩn ' + attempt + ' lần cho "' + String(es.topic || '').slice(0, 80) + '" (job ' + es.job_id + '). Lỗi: '
      + r.errors.slice(0, 4).map((e) => e.vi || e.msg).join(' | ') + '. Video KHÔNG được dựng hôm nay; bài chữ vẫn đăng bình thường.';
    out.push({ json: { ...base, route: 'stop', feedback: r.feedback, alert_vi, es }, pairedItem: { item: i } });
  }
}
return out;
