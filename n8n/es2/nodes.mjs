// n8n/es2/nodes.mjs — NGUỒN của nhánh "ES Short" (CreativeSpec es.creative/1.1, chuẩn es-short/1) trong n8n: 3 node quy chuẩn + node nối.
//   3 node quy chuẩn: ES Short · Soạn prompt quy chuẩn (Code, node1-soan-prompt.js) · ES Short · Kiểm tra CreativeSpec (Code, node2-kiem-tra.js)
//                     · ES Short · Render xong? (Switch 5 ngả, đọc results/<id>.json của es-render)
//   node nối: AI viết CreativeSpec · Spec đạt? · Đẩy job lên es-render · Chờ render · Đọc kết quả render · Báo Sở Chỉ Huy · ➡️ Đăng bài · 2 ghi chú
// Dùng chung cho build.mjs (bản dán, credential để trống) và build-ops.mjs (thao tác update_workflow trên workflow đang chạy, credential lấy từ đó).
// Repo công khai: không có id credential, chat id hay token nào trong file này.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

export const DIR = path.dirname(new URL(import.meta.url).pathname);
export const ROOT = path.resolve(DIR, '../..');
export const ESC = createRequire(import.meta.url)(path.join(ROOT, 'spec/core.cjs'));
// tên node: tiền tố "ES Short · " vì workflow ES · 1 Boss đang chạy đã có "Soạn prompt quy chuẩn", "Kiểm tra CreativeSpec", "Spec đạt?",
// "Chờ render", "Render xong?" của bộ SaaS Motion cũ (JSON2Video / Dựng video) — trùng tên thì $('…') trỏ nhầm node
export const N = {
  guide: 'ES Short · Hướng dẫn', prompt: 'ES Short · Soạn prompt quy chuẩn', ai: 'ES Short · AI viết CreativeSpec', aiNote: 'ES Short · Ghi chú node AI',
  check: 'ES Short · Kiểm tra CreativeSpec', ok: 'ES Short · Spec đạt?', push: 'ES Short · Đẩy job lên es-render', wait: 'ES Short · Chờ render',
  read: 'ES Short · Đọc kết quả render', done: 'ES Short · Render xong?', alert: 'ES Short · Báo Sở Chỉ Huy', post: 'ES Short · ➡️ Đăng bài (nối nhánh đăng)',
};
export const OWNER = 'nguyentranminhnhat3536-gif'; export const REPO = 'es-render';
const lib = () => fs.readFileSync(path.join(ROOT, 'spec/core.cjs'), 'utf8').replace(/\nif \(typeof module[^\n]*\n?$/, '\n');
export const code = (f) => '// ⚠️ Sinh tự động: es-render spec/core.cjs (core ' + ESC.CORE + ') + n8n/es2/' + f + ' — đừng sửa ở đây: sửa trong repo, chạy node n8n/es2/build.mjs, dán lại.\n'
  + lib() + '\n' + fs.readFileSync(path.join(DIR, f), 'utf8');
export const uid = (name) => { const h = crypto.createHash('sha1').update('es2-standard:' + name).digest('hex'); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32); };
const cond = (id, left) => ({ options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
  conditions: [{ id: uid(id), leftValue: left, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' });
const rule = (key, left) => ({ conditions: cond('rule:' + key, left), renameOutput: true, outputKey: key });
// result có thể là file đã parse (mặc định) hoặc cả HTTP response { body }
const R = '($json.body && typeof $json.body === "object" ? $json.body : $json)';
const CK = "$('" + N.check + "').first().json";
const EXPECT = '(' + CK + '.es || {}).spec_hash'; // hash của spec vừa đẩy (lần chạy MỚI NHẤT của node kiểm tra)
const FRESH = '(!' + R + '.spec_hash || ' + R + '.spec_hash === ' + EXPECT + ')'; // CI trả lại job.spec_hash; kết quả của spec khác (trùng id) bị bỏ qua
const SINCE_PUSH = '(Date.now() - (Date.parse((' + CK + '.es || {}).pushed_at) || Date.now()))';
const TIMEOUT = '$runIndex >= 45 || ' + SINCE_PUSH + ' > 45 * 60000';
// "Render xong?" chỉ tin `outcome` của job kind "spec": kết quả cũ (movie JSON / HyperFrames…) không có outcome → không bao giờ tự đăng (K5)
export const RENDER_RULES = [
  ['✅ Đăng', '={{ ' + R + '.kind === "spec" && ' + R + '.outcome === "post" && !!' + R + '.url && ' + FRESH + ' }}'],
  ['👀 Cần duyệt', '={{ (' + R + '.outcome === "review" || (' + R + '.status === "done" && !' + R + '.outcome)) && ' + FRESH + ' }}'],
  ['🔁 Viết lại spec', '={{ ' + R + '.outcome === "retry" && ' + FRESH + ' }}'],
  ['❌ Lỗi', '={{ ' + TIMEOUT + ' || ((' + R + '.outcome === "fail" || ["error", "rejected"].includes(' + R + '.status)) && ' + FRESH + ') }}'],
];
export const RENDER_FALLBACK = '⏳ Chưa xong';

// opts: { gh, tg, ai: { type, typeVersion, credentials, parameters } | null, chatId, origin: [x, y] }
export function standardNodes(opts = {}) {
  const [ox, oy] = opts.origin || [0, 0]; const at = (x, y) => [ox + x, oy + y];
  const GH = opts.gh || { githubApi: { id: '', name: 'GitHub account' } };
  const TG = opts.tg || { telegramApi: { id: '', name: 'Telegram account' } };
  const node = (name, type, typeVersion, position, parameters, extra = {}) => ({ parameters, id: uid(name), name, type, typeVersion, position, ...extra });
  const switchNode = (name, pos, rules, fallback) => node(name, 'n8n-nodes-base.switch', 3.2, pos, { mode: 'rules', rules: { values: rules }, options: { fallbackOutput: 'extra', renameFallbackOutput: fallback } });
  const sticky = (name, pos, content, width, height, color) => node(name, 'n8n-nodes-base.stickyNote', 1, pos, { content, width, height, color });
  const ai = opts.ai ? node(N.ai, opts.ai.type, opts.ai.typeVersion, at(240, 0), opts.ai.parameters, { ...(opts.ai.credentials ? { credentials: opts.ai.credentials } : {}), retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 })
    : node(N.ai, 'n8n-nodes-base.httpRequest', 4.2, at(240, 0), {
      method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
      authentication: 'predefinedCredentialType', nodeCredentialType: 'googlePalmApi', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.gemini_body) }}', options: { timeout: 120000 } },
    { credentials: { googlePalmApi: { id: '', name: 'Google Gemini(PaLM) Api account' } }, retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 });
  const nodes = [
    sticky(N.guide, at(-560, -460), '## ES Short (CreativeSpec 1.1 · chuẩn es-short/1: 30–60 s, hook ≤ 3 s, ảnh bìa)\n'
      + '1. Nối node tạo **card** (chủ đề / hook / ý chính / **dữ kiện** — mỗi dòng dữ kiện là FACTS#n, nguồn duy nhất cho con số) → **' + N.prompt + '**. Mỗi lần chạy 1 card.\n'
      + '2. Node AI: **' + N.ai + '** (system `{{ $json.system }}`, message `{{ $json.user }}`, chỉ 1 ô thì `{{ $json.prompt }}`, bật JSON output).\n'
      + '3. Credential GitHub (repo es-render: Contents đọc/ghi) cho **' + N.push + '** + **' + N.read + '**; Telegram cho **' + N.alert + '**.\n'
      + '4. Khi `video_paused` còn bật: ✅ chỉ báo Sở Chỉ Huy. Bật đăng: nối ✅ vào nhánh đăng — video `{{ $json.url }}`, ảnh bìa `{{ $json.cover_url }}` (3:4 `{{ $json.cover_3x4_url }}`), card `{{ $json.client }}`.\n\n'
      + 'AI viết sai chuẩn → tự sửa (≤ 3 lần, lần 3 tự cắt gọt, không bịa). Câu có con số không trích FACTS → không dựng. Dựng ~5–8 phút; quá 45 phút → ❌.', 680, 440, 4),
    node(N.prompt, 'n8n-nodes-base.code', 2, at(0, 0), { mode: 'runOnceForAllItems', jsCode: code('node1-soan-prompt.js') }),
    ai,
    sticky(N.aiNote, at(180, -230), '### 🤖 Node AI (thay được)\nGemini / OpenAI / Claude / AI Agent đều được — "' + N.check + '" tự tìm JSON trong mọi dạng trả lời.\nNhiệt độ: `{{ $json.temperature }}` (0.8 lần đầu, 0.4 khi sửa).', 320, 200, 6),
    node(N.check, 'n8n-nodes-base.code', 2, at(480, 0), { mode: 'runOnceForAllItems', jsCode: code('node2-kiem-tra.js') }),
    switchNode(N.ok, at(720, 0), [rule('đạt', '={{ $json.route === "push" }}'), rule('viết lại', '={{ $json.route === "retry" }}')], 'dừng'),
    node(N.push, 'n8n-nodes-base.github', 1, at(960, -120), { resource: 'file', operation: 'create', owner: { __rl: true, mode: 'name', value: OWNER }, repository: { __rl: true, mode: 'name', value: REPO },
      filePath: '={{ $json.job_path }}', fileContent: '={{ $json.job_content }}', commitMessage: '={{ $json.commit_message }}' },
    { credentials: GH, retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, onError: 'continueErrorOutput' }),
    node(N.wait, 'n8n-nodes-base.wait', 1.1, at(1200, -120), { resume: 'timeInterval', amount: '={{ $json.commit ? 4 : 1 }}', unit: 'minutes' }, { webhookId: uid('wait-render') }),
    node(N.read, 'n8n-nodes-base.httpRequest', 4.2, at(1440, -120), {
      url: '=https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/results/{{ ' + CK + '.job_id }}.json',
      authentication: 'predefinedCredentialType', nodeCredentialType: 'githubApi', sendQuery: true, queryParameters: { parameters: [{ name: 'ref', value: 'main' }] },
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github.raw+json' }, { name: 'X-GitHub-Api-Version', value: '2022-11-28' }] },
      options: { response: { response: { neverError: true, responseFormat: 'json' } }, timeout: 30000 } },
    { credentials: GH, retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, onError: 'continueRegularOutput' }),
    switchNode(N.done, at(1680, -120), RENDER_RULES.map(([k, e]) => rule(k, e)), RENDER_FALLBACK),
    node(N.alert, 'n8n-nodes-base.telegram', 1.2, at(1960, -320), { chatId: opts.chatId || '-100XXXXXXXXXX',
      text: '={{ $json.alert_vi || ' + R + '.summary_vi || ' + R + ".message || ('⚠️ Video ES Short ' + (" + CK + ".job_id || '') + ': chưa có kết quả sau 45 phút hoặc không đẩy được job lên GitHub') }}\n{{ " + R + '.url || ' + R + ".run || '' }}",
      additionalFields: { appendAttribution: false, disable_web_page_preview: true } },
    { credentials: TG, onError: 'continueRegularOutput' }),
    node(N.post, 'n8n-nodes-base.noOp', 1, at(1960, -120), {}),
  ];
  const to = (n, i = 0) => [{ node: n, type: 'main', index: i }];
  // ✅ → Sở Chỉ Huy (video_paused: chỉ báo) + chỗ nối nhánh đăng (noOp, chủ tự nối khi bật đăng)
  const connections = {
    [N.prompt]: { main: [to(N.ai)] }, [N.ai]: { main: [to(N.check)] }, [N.check]: { main: [to(N.ok)] },
    [N.ok]: { main: [to(N.push), to(N.prompt), to(N.alert)] },
    [N.push]: { main: [to(N.wait), to(N.alert)] }, [N.wait]: { main: [to(N.read)] }, [N.read]: { main: [to(N.done)] },
    [N.done]: { main: [[...to(N.alert), ...to(N.post)], to(N.alert), to(N.prompt), to(N.alert), to(N.wait)] },
  };
  const names = new Set(nodes.map((n) => n.name)); const bad = Object.entries(connections).flatMap(([k, v]) => [k, ...v.main.flat().map((t) => t.node)]).filter((n) => !names.has(n));
  if (bad.length) throw new Error('bad links: ' + bad.join(', '));
  for (const n of nodes.filter((x) => x.type === 'n8n-nodes-base.code')) new Function('$input', '$', '$getWorkflowStaticData', 'return (async () => { ' + n.parameters.jsCode + ' })()'); // biên dịch như n8n chạy
  return { nodes, connections };
}
