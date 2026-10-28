// node n8n/es2/build-ops.mjs <workflow.json (mcp__n8n__get_workflow_details, MỚI TẢI)> <tên node card> <ra ops.json> [--connect] [--chat-id <biểu thức>]
// Sinh tham số cho MỘT lần gọi mcp__n8n__update_workflow: thêm 12 node "ES Short · …" (nodes.mjs) cạnh workflow đang chạy, nối chúng với nhau,
// KHÔNG đụng node / kết nối nào đang có. Không gọi n8n, không ghi gì ngoài file ra (ops.json + ops-manifest.json cạnh nó).
//   credential: lấy từ workflow đang chạy theo kiểu (githubApi, telegramApi) — đúng 1 credential mỗi kiểu, không thì DỪNG
//   node AI: chép kiểu node + credential (+ modelId) của node AI mà card ĐANG nối tới (đi xuôi kết nối từ card) — không đoán model
//   chat id báo: --chat-id, mặc định ={{ $('<card>').first().json.chat_id }}
//   --connect: nối card (ngả 0) → "ES Short · Soạn prompt quy chuẩn". Mặc định KHÔNG nối: card đang chạy nhánh video cũ, nối cả hai = gọi AI / dựng 2 lần.
//   ✅ Đăng chỉ tới Sở Chỉ Huy + node noOp "➡️ Đăng bài" (video_paused: không bao giờ tự đăng).
// DỪNG (exit 1, "DỪNG: …"): thiếu card, đã có node trùng tên (đã áp rồi / trùng nhánh cũ), thiếu credential, không thấy node AI.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { N, ESC, standardNodes } from './nodes.mjs';

const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
const chatArg = flag('--chat-id'); const connect = bool('--connect');
const [wfFile, cardName, outFile] = args;
const fail = (m) => { console.error('DỪNG: ' + m); process.exit(1); };
if (!wfFile || !cardName || !outFile) { console.error('usage: node n8n/es2/build-ops.mjs workflow.json "<card node>" ops.json [--connect] [--chat-id <expr>]'); process.exit(2); }
const raw = JSON.parse(fs.readFileSync(wfFile, 'utf8')); const wf = raw.workflow || raw.data || raw;
if (!Array.isArray(wf.nodes) || !wf.connections) fail('file không phải workflow n8n (thiếu nodes / connections)');
const byName = new Map(wf.nodes.map((n) => [n.name, n]));
const card = byName.get(cardName) || fail('không thấy node card "' + cardName + '" trong workflow ' + (wf.name || wf.id || ''));
const dup = Object.values(N).filter((n) => byName.has(n)); if (dup.length) fail('workflow đã có node ' + dup.map((d) => '"' + d + '"').join(', ') + ' — đã áp rồi? (gỡ 12 node ES Short trước khi áp lại)');

// —— credential theo kiểu: đúng một credential (id) mỗi kiểu ——
const credOf = (type) => { const seen = new Map(); for (const n of wf.nodes) { const c = n.credentials && n.credentials[type]; if (c && c.id) seen.set(c.id, c); }
  if (!seen.size) fail('workflow chưa có credential ' + type + ' nào (node ES Short cần nó)');
  if (seen.size > 1) fail('workflow có ' + seen.size + ' credential ' + type + ' khác nhau (' + [...seen.values()].map((c) => c.name).join(', ') + ') — chọn tay bằng bản dán');
  const c = [...seen.values()][0]; return { [type]: { id: c.id, name: c.name } }; };
const gh = credOf('githubApi'); const tg = credOf('telegramApi');

// —— node AI mà card đang nối tới (đi xuôi kết nối main, BFS ≤ 10 bước) ——
const isAI = (n) => n.type === '@n8n/n8n-nodes-langchain.googleGemini' || (n.type === 'n8n-nodes-base.httpRequest' && /generativelanguage\.googleapis\.com/.test(String(n.parameters && n.parameters.url)));
let aiLive = null; { const q = [[cardName, 0]]; const seen = new Set([cardName]);
  while (q.length && !aiLive) { const [nm, d] = q.shift(); const outs = ((wf.connections[nm] || {}).main || []).flat().filter(Boolean);
    for (const t of outs) { if (seen.has(t.node)) continue; seen.add(t.node); const n = byName.get(t.node); if (!n) continue; if (isAI(n)) { aiLive = n; break; } if (d < 10) q.push([t.node, d + 1]); } } }
if (!aiLive) fail('không thấy node AI (Gemini) nào sau card "' + cardName + '" — dùng bản dán es2-standard-nodes.json và chọn node AI bằng tay');
if (!aiLive.credentials || !Object.keys(aiLive.credentials).length) fail('node AI "' + aiLive.name + '" không có credential');
const ai = aiLive.type === '@n8n/n8n-nodes-langchain.googleGemini'
  ? { type: aiLive.type, typeVersion: aiLive.typeVersion, credentials: aiLive.credentials,
    parameters: { modelId: aiLive.parameters.modelId, messages: { values: [{ content: '={{ $json.user }}' }] }, jsonOutput: true, builtInTools: {},
      options: { systemMessage: '={{ $json.system }}', temperature: '={{ $json.temperature }}', maxOutputTokens: 16384 } } }
  : { type: aiLive.type, typeVersion: aiLive.typeVersion, credentials: aiLive.credentials,
    parameters: { method: 'POST', url: aiLive.parameters.url, authentication: 'predefinedCredentialType', nodeCredentialType: aiLive.parameters.nodeCredentialType || Object.keys(aiLive.credentials)[0],
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.gemini_body) }}', options: { timeout: 120000 } } };

// —— chỗ đặt: dưới mọi node đang có, thẳng cột card ——
const maxY = Math.max(...wf.nodes.map((n) => (Array.isArray(n.position) ? n.position[1] : 0)));
const origin = [Array.isArray(card.position) ? card.position[0] : 0, Math.round(maxY + 900)];
const chatId = chatArg || "={{ $('" + cardName + "').first().json.chat_id }}";
const { nodes, connections } = standardNodes({ gh, tg, ai, chatId, origin });
const ops = nodes.map(({ id, ...node }) => ({ type: 'addNode', node }));
for (const [source, v] of Object.entries(connections)) v.main.forEach((outs, sourceIndex) => (outs || []).forEach((t) => ops.push({ type: 'addConnection', source, target: t.node, sourceIndex, targetIndex: t.index || 0, connectionType: 'main' })));
if (connect) ops.push({ type: 'addConnection', source: cardName, target: N.prompt, sourceIndex: 0, targetIndex: 0, connectionType: 'main' });
if (ops.length > 100) fail('quá 100 thao tác');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const call = { workflowId: wf.id || '', versionName: 'ES Short: 3 node quy chuẩn CreativeSpec ' + ESC.CORE + (connect ? ' (đã nối card)' : ' (chưa nối card)'),
  versionDescription: 'Thêm 12 node "ES Short · …" (es-render n8n/es2, core ' + ESC.CORE + '): Soạn prompt quy chuẩn → AI (' + aiLive.type.split('.').pop() + ', như "' + aiLive.name + '") → Kiểm tra CreativeSpec → Spec đạt? → Đẩy job kind "spec" lên es-render → Chờ → Đọc kết quả → Render xong? (✅ chỉ báo Sở Chỉ Huy). '
    + (connect ? 'Card "' + cardName + '" đã nối vào.' : 'Chưa nối card "' + cardName + '" (nối tay khi bật).') + ' Không đổi node / kết nối nào đang có. Bản trước: ' + (wf.versionId || '?'),
  operations: ops };
fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(call, null, 1));
const manifest = { base_versionId: wf.versionId || '', base_nodes: wf.nodes.length, add_nodes: nodes.length, add_connections: ops.filter((o) => o.type === 'addConnection').length, connect, card: cardName, ai_from: aiLive.name, ai_type: aiLive.type,
  credentials: { githubApi: gh.githubApi.name, telegramApi: tg.telegramApi.name, ai: Object.values(aiLive.credentials).map((c) => c.name).join(', ') }, core: ESC.CORE,
  sha256_16: Object.fromEntries(nodes.filter((n) => n.parameters.jsCode).map((n) => [n.name, sha(n.parameters.jsCode)])) };
fs.writeFileSync(path.join(path.dirname(path.resolve(outFile)), 'ops-manifest.json'), JSON.stringify(manifest, null, 1));
console.log('ops:', ops.length, '(' + nodes.length + ' node, ' + manifest.add_connections + ' kết nối' + (connect ? ', có nối card' : ', chưa nối card') + ') →', outFile, '| nền versionId', wf.versionId || '?', '| AI như "' + aiLive.name + '"');
