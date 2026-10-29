// ===== n8n Code node "ES Short · Soạn prompt quy chuẩn" · Mode: Run Once for All Items · CreativeSpec es.creative/1.1 · chuẩn es-short/1 =====
// Tên có tiền tố "ES Short · ": workflow ES · 1 Boss đang chạy đã có node "Soạn prompt quy chuẩn" / "Kiểm tra CreativeSpec" / "Render xong?" của bộ SaaS Motion cũ (khác hẳn).
// VÀO (tên trường linh hoạt, lấy giá trị đầu tiên có nội dung; tìm trong $json và $json.body / .data / .card / .post / .item / .input):
//   chủ đề   topic | idea | subject | title | tool_name | tool | name | headline | chu_de | y_tuong
//   hook     hook | card_hook | hook_line | hook_text            ý chính  points | bullets | steps | items | key_points | tips | outline | script
//   dữ kiện  facts | details | description | source | link (nguồn DUY NHẤT cho con số: mỗi dòng = FACTS#n, đi theo job → CI kiểm lại)   loại  content_type | type | kind | series | pillar | format
//   độ dài   target_duration | target_seconds | duration | seconds | do_dai (30–60, mặc định 45)   lang | language   cta | cta_text | call_to_action
//   ghi chú  notes | brief | instructions | ghi_chu                mã  job_id ; tid | template_id | card_id | post_id | id     playbook (object / chuỗi JSON)
//   tránh lặp hook: recent_hooks (mảng) — không có thì đọc bộ nhớ workflow es_recent do "Kiểm tra CreativeSpec" ghi (chỉ khi workflow chạy thật)
// VÒNG SỬA: (a) item từ "Spec đạt?" → viết lại: { es: { …, feedback, prev } }
//           (b) item từ "Render xong?" → 🔁: results/<id>.json có outcome "retry" → lấy lại ngữ cảnh từ node "Kiểm tra CreativeSpec"
// RA: mọi trường của card + prompt (system+user gộp, cho node AI chỉ có 1 ô), system, user, schema (object), schema_json (chuỗi), gemini_body,
//     temperature, es { job_base, job_id, attempt, max_attempts, tid, lang, target, topic, recent, card, core, created_at, facts[] }
const MAX_ATTEMPTS = 3;
const CHECK_NODE = 'ES Short · Kiểm tra CreativeSpec'; // đổi tên node đó thì sửa ở đây
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const asObj = (v) => { if (isObj(v)) return v; try { const o = JSON.parse(String(v || '')); return isObj(o) ? o : null; } catch (e) { return null; } };
const text = (v) => (Array.isArray(v) ? v.map((x) => (isObj(x) ? x.text || x.title || JSON.stringify(x) : String(x))).join('\n') : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).trim();
const stamp = () => { const d = new Date(Date.now() + 7 * 3600e3).toISOString(); return d.slice(0, 10).replace(/-/g, '') + '-' + d.slice(11, 19).replace(/:/g, ''); }; // giờ Việt Nam, như ES-002-20261020-184141
let memo = []; try { memo = [].concat($getWorkflowStaticData('global').es_recent || []); } catch (e) { /* chạy thử: không có bộ nhớ workflow */ }
const out = [];
for (const [i, item] of $input.all().entries()) {
  let j = item.json || {};
  // (b) CI từ chối spec sau khi đo giọng thật → item là results/<id>.json
  const res = isObj(j.body) ? j.body : j;
  if (!isObj(j.es) && (res.outcome === 'retry' || res.status === 'rejected')) {
    let prev = {}; try { prev = $(CHECK_NODE).first().json || {}; } catch (e) { /* không có → làm lại từ đầu */ }
    const pes = prev.es || {};
    j = { ...(pes.card || {}), es: { ...pes, attempt: Number(res.attempt || pes.attempt || 1) + 1, feedback: res.feedback || ESC.feedback({ errors: res.errors || [] }), prev: prev.spec || null } };
  }
  const retry = isObj(j.es) && j.es.feedback ? j.es : null;
  let es;
  if (retry) es = { ...retry, attempt: Math.min(Number(retry.attempt) || 2, MAX_ATTEMPTS) };
  else {
    const pools = [j, j.body, j.data, j.card, j.post, j.item, j.input].filter(isObj);
    const pick = (...keys) => { for (const p of pools) for (const k of keys) { const v = p[k]; if (v != null && v !== '' && !(Array.isArray(v) && !v.length) && (typeof v !== 'object' || Array.isArray(v))) return v; } return ''; };
    const tid0 = text(pick('tid', 'template_id', 'card_id', 'post_id', 'id')).replace(/[^\w-]/g, '').slice(0, 20);
    const tid = tid0 ? (/^ES-/i.test(tid0) ? tid0 : 'ES-' + tid0) : 'ES-000';
    const given = text(pick('job_id')).replace(/[^\w.-]/g, '');
    const job_base = (given || tid + '-' + stamp()).replace(/-a\d+$/, '');
    // card đi kèm job → results/<id>.json "client" (node đăng bài đọc lại). es-render là repo CÔNG KHAI → bỏ trường giống bí mật / liên lạc riêng
    const card = {}; for (const [k, v] of Object.entries(j)) { if (k === 'es' || k === 'binary' || /token|secret|password|passwd|api_?key|credential|cookie|phone|email|chat_?id|bank/i.test(k)) continue; const s = typeof v === 'string' ? v : JSON.stringify(v); if (s && s.length <= 2000) card[k] = v; }
    const playbook = pools.map((p) => asObj(p.playbook)).find(Boolean) || null;
    const recent = [].concat(pick('recent_hooks') || []).filter(Boolean).length ? [].concat(pick('recent_hooks')) : memo.map((x) => x && x.hook_type).filter(Boolean);
    es = { job_base, attempt: 1, max_attempts: MAX_ATTEMPTS, tid, core: ESC.CORE, created_at: new Date().toISOString(),
      lang: /^vi/i.test(text(pick('lang', 'language'))) ? 'vi' : 'en', target: Math.max(30, Math.min(60, Number(pick('target_duration', 'target_seconds', 'duration', 'seconds', 'do_dai')) || 45)),
      topic: text(pick('topic', 'idea', 'subject', 'title', 'tool_name', 'tool', 'name', 'headline', 'chu_de', 'y_tuong')).slice(0, 300), recent: [...new Set(recent)].slice(0, 3), card,
      brief: { hook_idea: text(pick('hook', 'card_hook', 'hook_line', 'hook_text')).slice(0, 300), points: text(pick('points', 'bullets', 'steps', 'items', 'key_points', 'tips', 'outline', 'script')).slice(0, 2500),
        facts: text(pick('facts', 'details', 'description', 'source', 'link')).slice(0, 2500), content_type: text(pick('content_type', 'type', 'kind', 'series', 'pillar', 'format')),
        cta: text(pick('cta', 'cta_text', 'call_to_action')).slice(0, 300), notes: text(pick('notes', 'brief', 'instructions', 'ghi_chu', 'note')).slice(0, 800), playbook } };
  }
  es.job_id = es.job_base + (es.attempt > 1 ? '-a' + es.attempt : ''); // mỗi lần thử một file jobs/<id>.json mới → không bao giờ đọc nhầm kết quả cũ
  const b = es.brief || {};
  // FACTS: danh sách dòng (core.factList) — node 2 kiểm bằng ĐÚNG danh sách này, job mang theo (meta.facts) để CI kiểm lại; không có → [] (không bao giờ undefined)
  if (!Array.isArray(es.facts)) es.facts = ESC.factList(b.facts || '').slice(0, ESC.LIM.facts);
  const ctype = String(b.content_type || '').toLowerCase().replace(/[\s-]+/g, '_');
  const p = ESC.prompt({ topic: es.topic, facts: es.facts, points: b.points, hook_idea: b.hook_idea, cta: b.cta, notes: b.notes, playbook: b.playbook, lang: es.lang, target: es.target, recent: es.recent,
    content_type: ESC.CONTENT_TYPES.find((k) => ctype.includes(k)) || (/tool/.test(ctype) ? 'tool_drop' : /lab/.test(ctype) ? 'lab_call' : /how/.test(ctype) ? 'how_to' : /list|top/.test(ctype) ? 'list' : /myth/.test(ctype) ? 'myth_fact' : 'tip'),
    retry: retry ? { attempt: es.attempt, max: es.max_attempts, feedback: retry.feedback, prev: retry.prev } : null });
  const { feedback: _f, prev: _p, ...esOut } = es;
  out.push({ json: { ...(es.card || {}), prompt: p.prompt, system: p.system, user: p.user, schema: p.schema, schema_json: JSON.stringify(p.schema), gemini_body: p.gemini_body, temperature: p.temperature, es: esOut }, pairedItem: { item: i } });
}
return out;
