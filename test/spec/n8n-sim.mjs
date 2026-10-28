// node test/spec/n8n-sim.mjs — chạy bản dán n8n/es2/es2-standard-nodes.json theo cách n8n chạy: node Code = thân hàm async với $input / $()
// (lịch sử chạy từng node, first() = lần mới nhất) / itemMatching / $getWorkflowStaticData; Switch = biểu thức n8n với $json / $runIndex / $().
// Phần 2: build-ops.mjs trên một workflow giả nhỏ (thêm 12 node, nối card khi --connect, DỪNG khi trùng tên / thiếu credential / không có node AI).
// ES2_LIVE_WF=<workflow.json tải từ n8n> → chạy thêm build-ops trên workflow thật (chỉ sinh file, không gọi n8n).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import ESC from '../../spec/core.cjs';
import { N, RENDER_RULES } from '../../n8n/es2/nodes.mjs';
import { ROOT, FACTS, good as G } from './fx.mjs';

const B = JSON.parse(fs.readFileSync(ROOT + '/n8n/es2/es2-standard-nodes.json', 'utf8'));
const node = (n) => { const x = B.nodes.find((y) => y.name === n); if (!x) throw new Error('no node ' + n); return x; };
let runs = {}; let staticData = {}; let switchRuns = {};
const $ = (name) => { const r = () => { const a = runs[name]; if (!a || !a.length) throw new Error('node ' + name + ' has not run'); return a; };
  return { first: (b, ri) => ({ json: r()[ri ?? r().length - 1][0].json }), last: () => { const a = r()[r().length - 1]; return { json: a[a.length - 1].json }; },
    all: () => r()[r().length - 1], itemMatching: (i) => ({ json: r()[r().length - 1][i].json }) }; };
const exec = async (name, items) => { const f = new Function('$input', '$', '$getWorkflowStaticData', 'return (async () => { ' + node(name).parameters.jsCode + ' })()');
  const out = await f({ all: () => items.map((json) => ({ json })) }, $, () => staticData); (runs[name] ||= []).push(out); return out.map((o) => o.json); };
const route = (name, json) => { const n = node(name); const ri = (switchRuns[name] = (switchRuns[name] ?? -1) + 1);
  for (const r of n.parameters.rules.values) { const e = r.conditions.conditions[0].leftValue.replace(/^=\{\{\s*|\s*\}\}$/g, ''); if (new Function('$json', '$runIndex', '$', 'return (' + e + ')')(json, ri, $) === true) return r.outputKey; }
  return n.parameters.options.renameFallbackOutput; };
const waitMinutes = (json) => new Function('$json', 'return (' + node(N.wait).parameters.amount.replace(/^=\{\{\s*|\s*\}\}$/g, '') + ')')(json);
const reset = () => { runs = {}; switchRuns = {}; };
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
const P = N.prompt, C = N.check;

const good = G(); // core 1.1 EXAMPLE — cites FACTS#1
const FACT = FACTS.EXAMPLE[0];
// câu trả lời kiểu ES-002 (bản cũ, quá dài): hook 16 từ, 12 cảnh, CTA dài, một câu có con số không nguồn ("clean converting sales")
const es002 = { hook: { say: 'Here are five free AI tools that will completely change how you run your small online shop', text: '5 free tools', layout: 'hook_number', value: '5' },
  scenes: Array.from({ length: 12 }, (_, i) => ({ layout: 'title_card', text: 'Tool ' + (i + 1), say: i === 6 ? 'Tool seven writes product pages that turn visitors into clean converting sales in only ten minutes a day.'
    : 'Tool number ' + (i + 1) + ' helps you write better product descriptions and answer customer questions much faster than doing everything by hand.' })),
  cta: { say: 'Follow us for more free tools every single week and join the lab today.' } };
// quá dài nhưng không có con số: lần 3 tự cắt gọt (salvage) được → push + W_SALVAGED
const long = G(); delete long.facts_used; long.scenes[long.scenes.length - 1].say = 'Now the FAQ answers the questions before buyers even ask them.';
long.scenes.splice(5, 0, { role: 'point', layout: 'title_card', say: 'Then sort the answers by how often buyers ask each question, so the top one sits first.', text: 'Sort by demand' },
  { role: 'point', layout: 'title_card', say: 'Keep every answer short enough to read on a phone screen without scrolling at all.', text: 'Keep it short' },
  { role: 'point', layout: 'title_card', say: 'Add the section near the buy button, where people decide and still have doubts.', text: 'Place it right' });
const gemini = (o) => ({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(o) + '\n```' }], role: 'model' }, finishReason: 'STOP' }] });
const geminiNode = (o) => ({ content: { parts: [{ text: JSON.stringify(o) }], role: 'model' } }); // @n8n/n8n-nodes-langchain.googleGemini
const openai = (o) => ({ message: { role: 'assistant', content: JSON.stringify(o) } });
const agentPassThrough = (o, input) => ({ ...input, output: 'Here you go:\n' + JSON.stringify(o) }); // node AI bật "include input fields"
const card = { tool_name: 'Review-to-FAQ prompt', card_hook: 'Customers ask the same 5 questions every day', bullets: ['export reviews', 'paste into prompt', 'quote a review'], series: 'Tool Drop', tid: 'ES-031',
  facts: FACT, api_key: 'sk-secret', owner_email: 'x@y.z', chat_id: '123' };

// S1 đường thẳng + chờ kết quả
reset(); let p = (await exec(P, [card]))[0];
ok(/^ES-031-\d{8}-\d{6}$/.test(p.es.job_id) && p.es.attempt === 1, 'job id ES-<tid>-<giờ VN>'); ok(/Review-to-FAQ/.test(p.user) && /tool_drop/.test(p.user), 'prompt có chủ đề + loại');
ok(/FACTS#1: Test shop: 50 reviews/.test(p.user) && p.es.facts.length === 1 && p.es.facts[0] === FACT, 'FACTS đánh số trong prompt + mang theo es.facts');
ok(!('api_key' in p.es.card) && !('owner_email' in p.es.card) && !('chat_id' in p.es.card), 'card bỏ trường giống bí mật / liên lạc'); ok(p.schema.additionalProperties === false && p.gemini_body.contents[0].parts[0].text === p.user, 'schema + gemini body');
let c = (await exec(C, [gemini(good)]))[0];
ok(c.route === 'push' && route(N.ok, c) === 'đạt' && c.job_path === 'jobs/' + p.es.job_id + '.json', 'hợp lệ → push');
let job = JSON.parse(c.job_content); ok(job.kind === 'spec' && job.standard === 'es-short/1' && job.spec.id === p.es.job_id && job.client.tool_name && !job.client.api_key && job.meta.review === false, 'file job');
ok(job.spec.version === ESC.VERSION && job.core === '1.1.0' && c.es.pushed_at, 'version + core 1.1.0 + pushed_at');
ok(Array.isArray(job.meta.facts) && job.meta.facts[0] === FACT, 'job.meta.facts (CI kiểm lại bằng đúng danh sách này)');
ok(ESC.check(job.spec, { facts: job.meta.facts }).ok, 'CI (spec/run.mjs) chấp nhận đúng spec đó với job.meta.facts');
ok((await exec(C, [geminiNode(good)]))[0].route === 'push', 'dạng trả lời của node Gemini (langchain) cũng đọc được');
reset(); p = (await exec(P, [card]))[0]; c = (await exec(C, [gemini(good)]))[0];
ok(waitMinutes({ content: {}, commit: { sha: 'abc' } }) === 4, 'chờ 4 phút sau khi đẩy');
ok(route(N.done, { message: 'Not Found', documentation_url: 'x', status: '404' }) === '⏳ Chưa xong', '404 → chờ'); ok(waitMinutes({ message: 'Not Found', status: '404' }) === 1, 'rồi 1 phút');
ok(route(N.done, { error: { message: 'ECONNRESET' } }) === '⏳ Chưa xong', 'lỗi mạng → chờ');
const done = { id: p.es.job_id, kind: 'spec', status: 'done', outcome: 'post', url: 'https://…/x.mp4', cover_url: 'https://…/x.cover.jpg', publishable: true };
ok(route(N.done, done) === '✅ Đăng', 'done + post → ✅'); ok(route(N.done, { body: done }) === '✅ Đăng', 'dạng full response');
ok(route(N.done, { ...done, kind: undefined }) !== '✅ Đăng', 'không phải job spec → không bao giờ ✅');
ok(job.spec_hash === c.es.spec_hash && /^[0-9a-f]{14}$/.test(job.spec_hash), 'job mang spec_hash (CI trả lại)');
ok(route(N.done, { ...done, spec_hash: 'deadbeefdeadbe' }) === '⏳ Chưa xong', 'kết quả của spec KHÁC (file cũ trùng id) → chờ, không đăng');
ok(route(N.done, { ...done, spec_hash: c.es.spec_hash }) === '✅ Đăng', 'đúng spec_hash → ✅');
ok(route(N.done, { status: 'error', outcome: 'fail', spec_hash: 'deadbeefdeadbe' }) === '⏳ Chưa xong', 'lỗi của spec cũ cũng bỏ qua');
ok(route(N.done, { ...done, outcome: 'review', publishable: false }) === '👀 Cần duyệt', 'review → 👀');
ok(route(N.done, { status: 'done', url: 'u', standard: { pass: false } }) === '👀 Cần duyệt', 'kết quả cũ không có outcome (chuẩn chỉ báo) → 👀, không tự đăng');
ok(route(N.done, { status: 'error', outcome: 'fail', message: 'TTS' }) === '❌ Lỗi', 'error → ❌');
// S2 vòng sửa trong n8n (câu trả lời kiểu ES-002)
reset(); p = (await exec(P, [{ ...card, tid: 'ES-032' }]))[0];
c = (await exec(C, [openai(es002)]))[0];
ok(c.route === 'retry' && route(N.ok, c) === 'viết lại' && c.es.attempt === 2 && /E_HOOK_LONG/.test(c.feedback) && /E_TOO_LONG/.test(c.feedback) && /E_CLAIM_NO_FACT/.test(c.feedback), 'ES-002 → retry kèm feedback');
let p2 = (await exec(P, [c]))[0];
ok(p2.es.job_id === p.es.job_base + '-a2' && /ATTEMPT 2 of 3/.test(p2.user) && /YOUR PREVIOUS JSON/.test(p2.user) && p2.temperature === 0.4 && p2.es.card.tid === 'ES-032' && p2.es.facts[0] === FACT, 'prompt sửa giữ ngữ cảnh + FACTS');
c = (await exec(C, [agentPassThrough(good, p2)]))[0];
ok(c.route === 'push' && JSON.parse(c.job_content).spec.id === p.es.job_base + '-a2', 'node AI chuyển tiếp trường đầu vào: JSON mẫu trong prompt bị bỏ qua');
// S3 ES-002 cả 3 lần → dừng (câu số liệu không nguồn không bao giờ tự cắt gọt); spec dài không có số → lần 3 cắt gọt → push
reset(); p = (await exec(P, [{ ...card, tid: 'ES-033', facts: '' }]))[0];
for (let a = 1; a <= 3; a++) { c = (await exec(C, [openai(es002)]))[0]; if (c.route === 'retry') await exec(P, [c]); }
ok(c.route === 'stop' && route(N.ok, c) === 'dừng' && c.errors.some((e) => e.code === 'E_CLAIM_NO_FACT') && /con số chưa có nguồn/.test(c.alert_vi) && /sai chuẩn 3 lần/.test(c.alert_vi), 'ES-002 lần 3 → dừng, báo đúng câu số liệu');
reset(); p = (await exec(P, [{ ...card, tid: 'ES-037', facts: '' }]))[0];
for (let a = 1; a <= 3; a++) { c = (await exec(C, [openai(long)]))[0]; if (c.route === 'retry') await exec(P, [c]); }
ok(c.route === 'push' && c.salvaged.length && c.warnings.some((w) => w.code === 'W_SALVAGED') && c.estimate.total <= 57, 'spec dài không có số: lần 3 cắt gọt → push');
reset(); p = (await exec(P, [{ ...card, tid: 'ES-034' }]))[0];
for (let a = 1; a <= 3; a++) { c = (await exec(C, [{ text: 'Sorry, I cannot help with that.' }]))[0]; if (c.route === 'retry') await exec(P, [c]); }
ok(c.route === 'stop' && /sai chuẩn 3 lần/.test(c.alert_vi), 'trả lời rác 3 lần → dừng + báo tiếng Việt');
// S4 (K4) rửa số liệu: card KHÔNG có dữ kiện, AI vẫn trích "FACTS#1" → không được qua
reset(); p = (await exec(P, [{ ...card, tid: 'ES-038', facts: '' }]))[0]; ok(Array.isArray(p.es.facts) && p.es.facts.length === 0 && /FACTS: none/.test(p.user), 'không có dữ kiện → es.facts = [] + prompt "FACTS: none"');
c = (await exec(C, [gemini(good)]))[0]; ok(c.route === 'retry' && c.errors.some((e) => e.code === 'E_CLAIM_NO_FACT'), 'FACTS#1 bịa → retry (E_CLAIM_NO_FACT), không push');
// S5 CI từ chối sau khi đo giọng thật → 🔁 → node 1 lấy lại ngữ cảnh → lần 2
reset(); p = (await exec(P, [{ ...card, tid: 'ES-035' }]))[0]; c = (await exec(C, [gemini(good)]))[0];
const rejected = { id: c.job_id, kind: 'spec', status: 'rejected', outcome: 'retry', attempt: 1, errors: [{ code: 'E_HOOK_SLOW', path: '/hook/say', msg: 'hook ends at 3.21 s (measured, +20 %)' }], feedback: 'Your previous … [E_HOOK_SLOW /hook/say] hook ends at 3.21 s (measured)' };
ok(route(N.done, rejected) === '🔁 Viết lại spec', 'CI từ chối → 🔁');
p2 = (await exec(P, [rejected]))[0];
ok(p2.es.attempt === 2 && p2.es.job_id === p.es.job_base + '-a2' && /measured/.test(p2.user) && /YOUR PREVIOUS JSON/.test(p2.user) && p2.es.card.tool_name && p2.es.facts[0] === FACT, 'ngữ cảnh lấy lại từ node kiểm tra');
c = (await exec(C, [gemini(good)]))[0]; ok(c.route === 'push' && c.job_id.endsWith('-a2'), 'lần 2 = file job mới');
ok(route(N.done, { ...rejected, outcome: 'fail', attempt: 3 }) === '❌ Lỗi', 'CI từ chối lần cuối → ❌');
// S6 quá giờ
reset(); p = (await exec(P, [card]))[0]; c = (await exec(C, [gemini(good)]))[0];
runs[C][0][0].json.es.pushed_at = new Date(Date.now() - 46 * 60000).toISOString();
ok(route(N.done, { message: 'Not Found', status: '404' }) === '❌ Lỗi', '45 phút sau khi đẩy → ❌');
ok(route(N.done, { id: 'x', kind: 'spec', status: 'done', outcome: 'post', url: 'u', spec_hash: 'old' }) === '❌ Lỗi', 'kết quả cũ + 45 phút → ❌ (không lặp mãi)');
// S7 sai luật thương hiệu ở lần cuối → dựng nhưng gắn review (👀, không tự đăng)
reset(); await exec(P, [{ ...card, tid: 'ES-036' }]);
const hype = G(); hype.scenes[1].say = 'This revolutionary trick exports your last fifty reviews into one plain file.';
for (let a = 1; a <= 3; a++) { c = (await exec(C, [gemini(hype)]))[0]; if (c.route === 'retry') await exec(P, [c]); }
ok(c.route === 'push' && c.review === true && JSON.parse(c.job_content).meta.review === true, 'từ "hype" ở lần 3 → dựng, gắn review');
// S8 nhớ kiểu hook gần đây (static data của workflow)
staticData = {}; for (let k = 0; k < 2; k++) { reset(); await exec(P, [{ ...card, tid: 'ES-04' + k }]); await exec(C, [gemini(good)]); }
reset(); p = (await exec(P, [card]))[0];
ok(staticData.es_recent.length === 2 && /none of result_first/.test(p.user), 'tránh kiểu hook vừa dùng');
// S9 bản dán: 12 node, tên có tiền tố, nối đúng, ✅ không tới node đăng thật
ok(B.nodes.length === 12 && B.nodes.every((n) => n.name.startsWith('ES Short · ')) && B.meta.core === '1.1.0', 'bản dán: 12 node "ES Short · …", core 1.1.0');
ok(node(N.done).parameters.rules.values.map((r) => r.outputKey).join('|') === RENDER_RULES.map((r) => r[0]).join('|'), 'Render xong? = 4 luật + ⏳');
ok(B.connections[N.done].main[0].map((t) => t.node).sort().join('|') === [N.alert, N.post].sort().join('|'), '✅ → Sở Chỉ Huy + noOp đăng');
ok(!/"id":\s*"[A-Za-z0-9]{12,}"/.test(JSON.stringify(B.nodes.map((n) => n.credentials || {}))), 'bản dán không có id credential');

// ---------- build-ops.mjs ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es2ops-'));
const ops = (wf, ...a) => { const f = path.join(tmp, 'wf.json'); fs.writeFileSync(f, JSON.stringify(wf)); const o = path.join(tmp, 'ops.json');
  const r = spawnSync(process.execPath, [ROOT + '/n8n/es2/build-ops.mjs', f, ...a, o], { encoding: 'utf8' }); return { code: r.status, err: r.stderr, out: r.status === 0 ? JSON.parse(fs.readFileSync(o, 'utf8')) : null }; };
const mini = () => ({ id: 'WF1', name: 'ES · test', versionId: 'v1', nodes: [
  { name: 'Card', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0], parameters: { jsCode: 'return [{ json: { topic: "x", chat_id: 1 } }]' } },
  { name: 'Prompt cũ', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200, 0], parameters: { jsCode: '' } },
  { name: 'Gemini cũ', type: '@n8n/n8n-nodes-langchain.googleGemini', typeVersion: 1.2, position: [400, 0], credentials: { googlePalmApi: { id: 'G1', name: 'Gem' } }, parameters: { modelId: { __rl: true, mode: 'id', value: 'models/gemini-x' }, messages: { values: [{ content: 'a' }] } } },
  { name: 'GH', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [600, 0], credentials: { githubApi: { id: 'H1', name: 'GitHub' } }, parameters: {} },
  { name: 'TG', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: [800, 0], credentials: { telegramApi: { id: 'T1', name: 'Bot' } }, parameters: {} }],
  connections: { Card: { main: [[{ node: 'Prompt cũ', type: 'main', index: 0 }]] }, 'Prompt cũ': { main: [[{ node: 'Gemini cũ', type: 'main', index: 0 }]] }, 'Gemini cũ': { main: [[{ node: 'GH', type: 'main', index: 0 }]] } } });
let r = ops(mini(), 'Card'); ok(r.code === 0, 'build-ops chạy: ' + r.err);
const add = r.out.operations.filter((o) => o.type === 'addNode'); const con = r.out.operations.filter((o) => o.type === 'addConnection');
ok(r.out.workflowId === 'WF1' && add.length === 12 && r.out.operations.every((o) => ['addNode', 'addConnection'].includes(o.type)), '12 addNode, chỉ thêm (không sửa / xoá gì)');
ok(con.every((o) => Object.values(N).includes(o.source) && Object.values(N).includes(o.target)), 'mặc định không nối card (nhánh video cũ vẫn chạy một mình)');
const aiN = add.find((o) => o.node.name === N.ai).node; ok(aiN.type === '@n8n/n8n-nodes-langchain.googleGemini' && aiN.credentials.googlePalmApi.id === 'G1' && aiN.parameters.modelId.value === 'models/gemini-x', 'node AI chép kiểu + credential + model của node AI card đang dùng');
ok(add.find((o) => o.node.name === N.push).node.credentials.githubApi.id === 'H1' && add.find((o) => o.node.name === N.alert).node.credentials.telegramApi.id === 'T1', 'credential GitHub / Telegram lấy từ workflow');
ok(add.find((o) => o.node.name === N.alert).node.parameters.chatId === "={{ $('Card').first().json.chat_id }}", 'chat id báo = chat_id của card');
ok(!con.some((o) => o.source === N.done && o.sourceIndex === 0 && !['ES Short · Báo Sở Chỉ Huy', N.post].includes(o.target)), '✅ chỉ tới Sở Chỉ Huy / noOp');
ok(add.every((o) => o.node.position[1] > 0 && !('id' in o.node)), 'đặt dưới mọi node cũ (y > 0), không mang id');
r = ops(mini(), 'Card', '--connect'); ok(r.code === 0 && r.out.operations.filter((o) => o.type === 'addConnection' && o.source === 'Card' && o.target === N.prompt).length === 1, '--connect: đúng 1 kết nối card → node 1');
const dupWf = mini(); dupWf.nodes.push({ name: N.check, type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0], parameters: {} });
r = ops(dupWf, 'Card'); ok(r.code === 1 && /DỪNG: workflow đã có node/.test(r.err), 'đã có node trùng tên → DỪNG');
const noTg = mini(); noTg.nodes = noTg.nodes.filter((n) => n.name !== 'TG'); r = ops(noTg, 'Card'); ok(r.code === 1 && /telegramApi/.test(r.err), 'thiếu credential Telegram → DỪNG');
const twoGh = mini(); twoGh.nodes.push({ name: 'GH2', type: 'n8n-nodes-base.github', typeVersion: 1, position: [0, 0], credentials: { githubApi: { id: 'H2', name: 'GitHub 2' } }, parameters: {} });
r = ops(twoGh, 'Card'); ok(r.code === 1 && /2 credential githubApi/.test(r.err), 'hai credential GitHub khác nhau → DỪNG (không đoán)');
const noAi = mini(); noAi.connections = {}; r = ops(noAi, 'Card'); ok(r.code === 1 && /không thấy node AI/.test(r.err), 'card không nối tới node AI → DỪNG');
r = ops(mini(), 'Không có'); ok(r.code === 1 && /không thấy node card/.test(r.err), 'thiếu card → DỪNG');
if (process.env.ES2_LIVE_WF) {
  const f = process.env.ES2_LIVE_WF; const o = path.join(tmp, 'live-ops.json');
  const x = spawnSync(process.execPath, [ROOT + '/n8n/es2/build-ops.mjs', f, process.env.ES2_LIVE_CARD || 'Nguồn video', o], { encoding: 'utf8' });
  ok(x.status === 0, 'workflow thật: ' + x.stderr); const L = JSON.parse(fs.readFileSync(o, 'utf8')); const live = JSON.parse(fs.readFileSync(f, 'utf8')); const W = live.workflow || live.data || live;
  const names = new Set(W.nodes.map((n) => n.name)); const added = L.operations.filter((q) => q.type === 'addNode');
  ok(added.length === 12 && added.every((q) => !names.has(q.node.name)) && L.workflowId === W.id, 'workflow thật: 12 node mới, không trùng tên node nào đang có (' + W.nodes.length + ' node)');
  ok(L.operations.every((q) => q.type === 'addNode' || (q.type === 'addConnection' && !names.has(q.source))), 'workflow thật: không thêm kết nối nào từ node đang có');
  console.log('live:', W.name, '→', L.operations.length, 'ops |', L.versionName);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('n8n sim: ' + pass + ' checks passed');
