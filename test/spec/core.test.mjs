// Port nguyên văn test/core.test.mjs của es-editor (cùng core.cjs) — chỉ đổi đường dẫn; bỏ test so với engine/ (chỉ có ở es-editor).
// node --test test/core.test.mjs — es.creative/1.1 (editor/spec/core.cjs): schema, budgets from the estimator, the v1 lint codes, owner mode, prompt. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ESC from '../../spec/core.cjs';

const EXD = new URL('../../spec/examples/', import.meta.url).pathname;
const ex = (f) => JSON.parse(fs.readFileSync(EXD + f + '.json', 'utf8'));
// FACTS each example was written against (its facts_used cite FACTS#1)
const FACTS = { 'explainer.en': ['Test shop: 50 reviews turned into an FAQ in 2 minutes (measured 10/2026)'], 'explainer.vi': ['Quán thử nghiệm ES Invoice: làm xong một hoá đơn trong 28 giây (đo thật, 10/2026)'] };
const good = ex('explainer.en');
const codes = (list) => [...new Set(list.map((x) => x.code))];
const clone = (o) => JSON.parse(JSON.stringify(o));
const vi = (say, extra = {}) => ({ lang: 'vi', voice: 'namminh', hook: { say: 'Cuối tháng còn gõ hoá đơn bằng tay?', text: 'Một tấm ảnh là xong' },
  scenes: [{ role: 'context', layout: 'title_card', say: 'Gõ từng dòng tên khách, số tiền, ngày hẹn, sai một chỗ là làm lại cả tờ.', text: 'Mất cả buổi tối' },
    { role: 'point', layout: 'list_steps', say, text: 'Ba bước', items: ['Mở app', 'Chụp tờ đơn', 'Kiểm tra lại'] },
    { role: 'payoff', layout: 'title_card', say: 'Bấm gửi, khách nhận một đường link và tự xem hoá đơn trên điện thoại.', text: 'Không cần in giấy' }],
  cta: { action: 'save', say: 'Lưu lại video này để làm theo nhé.', text: 'Lưu lại để làm theo' }, ...extra });

test('the 4 shipped examples are lint-clean (0 errors, 0 warnings) and the inline fallback equals explainer.en', () => {
  for (const f of ['list.vi', 'list.en', 'explainer.vi', 'explainer.en']) {
    const s = ex(f); const r = ESC.check(s, { facts: FACTS[f] });
    assert.equal(r.ok, true, f + ' ' + JSON.stringify(r.errors)); assert.deepEqual(codes(r.warnings), [], f);
    assert.equal(r.spec.version, 'es.creative/1.1'); assert.equal(r.spec.lang, f.split('.')[1]); assert.equal(r.spec.genre, f.split('.')[0]);
    assert.ok(r.estimate.total >= 35 && r.estimate.total <= 55 && r.estimate.hook_end <= 2.6, f + ' ' + r.estimate.total + ' ' + r.estimate.hook_end);
    assert.equal(ESC.claims(r.spec, { facts: FACTS[f] }).filter((c) => !c.cited).length, 0, f + ' has an unsupported claim');
  }
  assert.deepEqual(ESC.EXAMPLE, good);
  assert.equal(ESC.VERSION, 'es.creative/1.1'); assert.equal(ESC.CORE, '1.1.0'); assert.equal(ESC.TIME.wps.vi, 3.4);
});

test('strict LLM schema: closed objects, every key required, no length keywords, NO "" inside any enum; 1.1 fields present; Gemini variant open', () => {
  const sch = ESC.llmSchema({ strict: true }); const bad = [];
  (function walk(o, p) { if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) if (/^(minLength|maxLength|minItems|maxItems|minimum|maximum|pattern|format|default)$/.test(k)) bad.push(p + '.' + k);
    if (Array.isArray(o.enum) && o.enum.includes('')) bad.push(p + ' "" enum');
    if (o.type === 'object') { if (o.additionalProperties !== false) bad.push(p + ' open'); if (JSON.stringify(Object.keys(o.properties).sort()) !== JSON.stringify([...o.required].sort())) bad.push(p + ' required'); }
    for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') walk(v, p + '.' + k); })(sch, '$');
  assert.deepEqual(bad, []);
  for (const k of ['genre', 'structure', 'facts_used']) assert.ok(sch.properties[k], k);
  assert.deepEqual(Object.keys(sch.properties.facts_used.items.properties), ['claim', 'source']);
  assert.ok(sch.properties.hook.properties.visual_kind);
  for (const k of ['visual_kind', 'visual_hint', 'sfx_cue']) assert.ok(sch.properties.scenes.items.properties[k], k);
  assert.ok(sch.properties.scenes.items.properties.icon.enum.includes('none'));
  assert.equal(JSON.stringify(ESC.llmSchema({ strict: false })).includes('additionalProperties'), false);
  assert.ok(JSON.stringify(sch).length < 6000, 'schema size ' + JSON.stringify(sch).length);
});

test('1.1 fields survive normalize; normalize is idempotent; hash ignores id / production / est; strict "none" icon means no icon', () => {
  const a = ESC.normalize(good).spec; assert.deepEqual(ESC.normalize(a).spec, a);
  assert.equal(a.genre, 'explainer'); assert.equal(a.structure, 'result_first'); assert.equal(a.facts_used[0].source, 'FACTS#1');
  assert.equal(a.scenes[3].visual_kind, 'motion'); assert.equal(a.scenes[3].sfx_cue, 'hit'); assert.equal(a.scenes[0].visual_hint, 'one bold line on the brand background');
  assert.equal(a.scenes[0].icon, undefined, '"none" icon dropped'); assert.equal(a.scenes[3].icon, 'shield');
  assert.equal(ESC.specHash({ ...a, id: 'X', production: { mode: 'make' }, est: { total: 1 } }), ESC.specHash(a));
  const loose = ESC.normalize({ ...clone(good), genre: 'tutorial', structure: 'steps', facts_used: [{ claim: 'x', source: 'facts#2' }, { claim: 'y', source: 'none' }] }).spec;
  assert.equal(loose.genre, 'explainer'); assert.equal(loose.structure, 'list'); assert.deepEqual(loose.facts_used, [{ claim: 'x', source: 'FACTS#2' }]);
  const def = ESC.normalize({ hook: { say: 'Three prompts run my inbox.' }, scenes: [{ say: 'a b c d e' }] }).spec;
  assert.equal(def.genre, 'explainer'); assert.equal(def.scenes[0].visual_kind, 'code'); assert.equal(def.format, '9:16');
  assert.equal(ESC.normalize(good, { format: '16:9' }).spec.format, '16:9');
});

test('budgetFor(): caps derived from the estimator; a spec with EVERY part at its cap passes E_HOOK_SLOW / E_SCENE_SLOW (EN + VI, rates 0 / +6 / +10 %)', () => {
  assert.deepEqual([ESC.budgetFor('en', 6).hook, ESC.budgetFor('en', 6).body, ESC.budgetFor('en', 6).cta], [[2, 7, 6], [4, 20, 14], [3, 7, 5]]);
  assert.deepEqual([ESC.budgetFor('vi', 6).hook, ESC.budgetFor('vi', 6).body, ESC.budgetFor('vi', 6).cta], [[2, 10, 8], [5, 28, 19], [4, 10, 7]]);
  for (const lang of ['en', 'vi']) for (const rate of [0, 6, 10]) {
    const B = ESC.budgetFor(lang, rate); const w = lang === 'vi' ? 'ngày' : 'word';
    // worst case the budget allows: a body line with one comma and one inner full stop, on the longest-held role (payoff)
    const line = (n, comma, stop) => { const a = Array.from({ length: n }, () => w); if (stop) a[Math.floor(n / 2) - 1] += '.'; if (comma) a[Math.floor(n / 4)] += ','; return a.join(' ') + '.'; };
    const sp = { lang, voice: { id: lang === 'vi' ? 'namminh' : 'andrew', rate }, hook: { say: line(B.hook[1]), text: 'Head line' },
      scenes: [1, 2, 3, 4].map((i) => ({ role: i === 4 ? 'payoff' : 'demo', layout: 'title_card', say: line(B.body[1], true, true), text: 'Card' })), cta: { action: 'save', say: line(B.cta[1]), text: 'Save' } };
    const r = ESC.check(sp);
    assert.deepEqual(r.errors.map((e) => e.code).filter((c) => /HOOK_SLOW|SCENE_SLOW|HOOK_LONG|SAY_LONG|CTA_LONG/.test(c)), [], lang + ' +' + rate + '%');
    assert.ok(r.estimate.hook_end <= 3.0 && Math.max(...r.estimate.parts.slice(1, -1).map((p) => p.d)) <= 9, lang + ' ' + JSON.stringify(r.estimate.parts.map((p) => p.d)));
    sp.hook.say = line(B.hook[1] + 1); assert.ok(ESC.check(sp).errors.some((e) => e.code === 'E_HOOK_LONG'), lang + ' cap + 1');
  }
});

test('VI hook of 11 syllables fails (10 passes); the old caps (EN 8 words) fail', () => {
  const s10 = vi('Giờ chỉ cần mở app, chụp tờ đơn, app tự đọc tên khách và số tiền.'); s10.hook.say = 'Hoá đơn này làm xong chỉ trong đúng ba bước.'; // 10
  const r10 = ESC.check(s10); assert.equal(r10.errors.some((e) => /^E_HOOK/.test(e.code)), false, JSON.stringify(r10.errors)); assert.ok(r10.estimate.hook_end <= 3);
  s10.hook.say = 'Hoá đơn này làm xong chỉ trong đúng có ba bước.'; // 11
  const r11 = ESC.check(s10); assert.ok(r11.errors.some((e) => e.code === 'E_HOOK_LONG')); assert.ok(r11.estimate.hook_end > 3, 'estimate ' + r11.estimate.hook_end);
  const en = clone(good); en.hook.say = 'Your old reviews already wrote your FAQ page.'; // 8 words
  assert.ok(ESC.check(en).errors.some((e) => e.code === 'E_HOOK_LONG'));
});

test('E_CLAIM_NO_FACT: VI + EN, digits and spelled numbers, hook / scenes / CTA → error for the AI, ⚠️ for the owner, passes when facts_used cites FACTS#n', () => {
  const claims = ['Tiết kiệm 2 giờ mỗi tuần, nhanh hơn 10 lần.', 'Giờ chỉ còn năm phút, nhanh hơn hai mươi lần.'];
  for (const c of claims) {
    const s = vi(c); const ai = ESC.check(s, { facts: '' });
    assert.ok(ai.errors.some((e) => e.code === 'E_CLAIM_NO_FACT' && e.path.startsWith('/scenes/1')), c);
    const own = ESC.check(s, { owner: true });
    assert.equal(own.ok, true); assert.ok(own.warnings.some((w) => w.code === 'E_CLAIM_NO_FACT'), 'owner: warning only');
  }
  const cited = vi(claims[0], { facts_used: [{ claim: claims[0], source: 'FACTS#1' }] });
  assert.equal(ESC.check(cited, { facts: ['Khách thử thật: tiết kiệm 2 giờ mỗi tuần, nhanh hơn 10 lần'] }).errors.some((e) => e.code === 'E_CLAIM_NO_FACT'), false);
  assert.ok(ESC.check(cited, { facts: ['Khách thử thật: tiết kiệm 3 giờ mỗi tuần'] }).errors.some((e) => e.code === 'E_CLAIM_NO_FACT'), 'FACTS#1 does not hold those numbers');
  assert.ok(ESC.check(cited, { facts: '' }).errors.some((e) => e.code === 'E_CLAIM_NO_FACT'), 'FACTS#1 cited but no FACTS given');
  const spelled = vi(claims[1], { facts_used: [{ claim: 'chỉ còn năm phút', source: 'FACTS#1' }] });
  assert.equal(ESC.check(spelled, { facts: 'Một hoá đơn còn 5 phút, nhanh hơn 20 lần' }).errors.some((e) => e.code === 'E_CLAIM_NO_FACT'), false, 'năm ↔ 5, hai mươi ↔ 20');
  const owner = vi('Nhanh hơn 10 lần so với gõ tay, anh chị cứ thử.', { facts_used: [{ claim: 'nhanh hơn 10 lần', source: 'owner' }] });
  assert.equal(ESC.check(owner, { ownerText: 'app này nhanh hơn 10 lần' }).errors.some((e) => e.code === 'E_CLAIM_NO_FACT'), false, 'owner said it');
  // the hook and the CTA are checked too; EN equivalents
  const en = clone(good); en.facts_used = []; en.hook.say = 'Save 2 hours a week, 10 times faster.';
  assert.ok(ESC.check(en).errors.some((e) => e.code === 'E_CLAIM_NO_FACT' && e.path.startsWith('/hook')));
  const en2 = clone(good); en2.facts_used = []; en2.cta.say = 'Now it takes five minutes, twenty times faster.';
  assert.ok(ESC.check(en2).errors.some((e) => e.code === 'E_CLAIM_NO_FACT' && e.path.startsWith('/cta')));
  // NOT claims: counting steps, "một hoá đơn", "bấm một lần", meeting 3 customers, a year
  for (const ok of ['Ba bước, xong một hoá đơn.', 'Bấm một lần là xong, khách tự xem.', 'Gặp 3 khách mỗi ngày, ai cũng hỏi giống nhau.', 'Năm 2026 rồi mà vẫn gõ tay từng tờ hoá đơn.'])
    assert.equal(ESC.check(vi(ok), { facts: '' }).errors.some((e) => e.code === 'E_CLAIM_NO_FACT'), false, ok);
  // invented customer counts and money are claims even without a result verb
  for (const bad of ['Đã có 1.200 khách đang dùng app này mỗi ngày.', 'Chỉ $500 một tháng cho cả cửa hàng của anh.', '73% khách mở link ngay trong ngày đầu tiên.'])
    assert.ok(ESC.check(vi(bad), { facts: '' }).errors.some((e) => e.code === 'E_CLAIM_NO_FACT'), bad);
});

test('E_CLICHE (AI error, owner warning), W_GENERIC ignores brand names, W_NO_FACTS only when FACTS were given and empty', () => {
  const c1 = vi('Hãy cùng tìm hiểu cách mở app, chụp tờ đơn, app tự đọc tên khách.');
  assert.ok(ESC.check(c1).errors.some((e) => e.code === 'E_CLICHE')); assert.ok(ESC.check(c1, { owner: true }).warnings.some((w) => w.code === 'E_CLICHE'));
  const c2 = clone(good); c2.scenes[0].say = 'This prompt will unlock answers that already sit in your reviews.';
  assert.ok(ESC.check(c2).errors.some((e) => e.code === 'E_CLICHE' && /unlock/.test(e.msg)));
  const c3 = clone(good); c3.hook.say = 'Xin chào các bạn, hôm nay nói về FAQ.'; c3.lang = 'vi'; c3.voice = 'namminh';
  assert.ok(ESC.check(c3).errors.some((e) => e.code === 'E_CLICHE'), 'greeting opener (VI)');
  // brand / product names are not concrete facts
  const brand = vi('Mở ES Invoice trên iPhone, chụp tờ đơn, ES Invoice tự đọc tên khách.');
  assert.ok(ESC.check(brand).warnings.some((w) => w.code === 'W_GENERIC'));
  const conc = vi('Mở app, chụp tờ đơn số 12, app tự đọc tên khách và 3 dòng hàng.');
  assert.equal(ESC.check(conc).warnings.some((w) => w.code === 'W_GENERIC'), false);
  assert.ok(ESC.check(conc, { facts: '' }).warnings.some((w) => w.code === 'W_NO_FACTS' && /số: …/.test(w.vi)));
  assert.equal(ESC.check(conc).warnings.some((w) => w.code === 'W_NO_FACTS'), false, 'FACTS unknown → no line');
  assert.equal(ESC.check(conc, { facts: '', owner: true }).warnings.some((w) => w.code === 'W_NO_FACTS'), false, 'not for his own script');
});

test('W_TEXT_ECHO (> 50 %), W_READ_FAST (captions counted only where they show), W_CTA_EARLY', () => {
  const e1 = clone(good); e1.scenes[0].text = 'Answers already in your reviews';
  assert.ok(ESC.check(e1).warnings.some((w) => w.code === 'W_TEXT_ECHO' && w.path === '/scenes/0/text'));
  const e2 = clone(good); delete e2.scenes[0].text; // derived from the line by normalize → not an echo the owner wrote
  assert.equal(ESC.check(e2, { owner: true }).warnings.some((w) => w.code === 'W_TEXT_ECHO'), false);
  const r1 = clone(good); r1.scenes[3].say = 'But the last step builds trust.'; r1.scenes[3].text = 'The one step most shops skip';
  assert.ok(ESC.check(r1).warnings.some((w) => w.code === 'W_READ_FAST' && w.path === '/scenes/3'));
  const r2 = clone(good); r2.scenes[4].say = 'Quote one real review under each answer.'; // checklist: captions hidden → only its own words count
  assert.equal(ESC.check(r2).warnings.some((w) => w.code === 'W_READ_FAST' && w.path === '/scenes/4'), false);
  const c = clone(good); c.scenes[1].say = 'Step one: follow me, then export your latest reviews into one file.';
  assert.ok(ESC.check(c).warnings.some((w) => w.code === 'W_CTA_EARLY' && w.path === '/scenes/1/say'));
  const v = vi('Bình luận ngay, rồi mở app, chụp tờ đơn, app tự đọc tên khách.');
  assert.ok(ESC.check(v).warnings.some((w) => w.code === 'W_CTA_EARLY'));
});

test('owner mode: only structural codes block (his words are never refused for length, speed, hype or claims); nothing is salvaged', () => {
  const s = vi('Mở app, chụp tờ đơn.'); s.hook.say = 'Anh chị ơi, cuối tháng này mà còn ngồi gõ từng tờ hoá đơn bằng tay thì mệt lắm đó.';
  const ai = ESC.check(s); assert.equal(ai.ok, false); assert.ok(codes(ai.errors).includes('E_HOOK_LONG') && codes(ai.errors).includes('E_TOO_SHORT'));
  const own = ESC.check(s, { owner: true, attempt: 3, max: 3 });
  assert.equal(own.ok, true); assert.deepEqual(own.errors, []); assert.equal(own.salvaged, null);
  assert.ok(codes(own.warnings).includes('E_HOOK_LONG') && codes(own.warnings).includes('E_TOO_SHORT')); assert.equal(own.spec.hook.say, s.hook.say, 'not trimmed');
  for (const [bad, code] of [[{ ...vi('a b c d e'), hook: { say: '' } }, 'E_HOOK_MISSING'], [{ ...vi('x'), scenes: [{ say: '', text: 'Chỉ có chữ' }] }, 'E_SAY_MISSING']]) {
    const r = ESC.check(bad, { owner: true }); assert.equal(r.ok, false, code); assert.ok(codes(r.errors).includes(code), code + ' ' + JSON.stringify(r.errors));
  }
  const none = ESC.check({ hook: { say: 'Chỉ có một dòng này thôi.' }, scenes: [] }, { owner: true }); assert.equal(none.ok, false, 'no body line at all blocks');
});

test('Vietnamese CTA: action read from VI words, keyword from "Bình luận X / Comment X", VI brand default when missing; every default fits the budget', () => {
  const s = vi('Mở app, chụp tờ đơn, app tự đọc tên khách và số tiền.'); delete s.cta;
  const r = ESC.check(s); assert.equal(r.errors.some((e) => e.code === 'E_LANG'), false); assert.match(r.spec.cta.say, /Telegram Lab/); assert.equal(r.spec.cta.action, 'lab');
  assert.equal(ESC.normalize({ ...s, cta: { say: 'Lưu lại để làm theo nhé.' } }).spec.cta.action, 'save');
  assert.equal(ESC.normalize({ ...s, cta: { say: 'Theo dõi để xem mẹo mới.' } }).spec.cta.action, 'follow');
  const kw = ESC.normalize({ ...s, cta: { say: 'Comment MẪU, mình gửi template.' } }).spec.cta; assert.equal(kw.action, 'comment'); assert.equal(kw.keyword, 'MẪU');
  for (const [lang, D] of [['en', ESC.CTA_DEF], ['vi', ESC.CTA_DEF_VI]]) for (const [k, v] of Object.entries(D)) {
    assert.ok(ESC.units(v.say.replace('{KW}', 'TOOL')) <= ESC.budgetFor(lang, 6).cta[1], lang + ' ' + k); assert.ok(v.text.replace('{KW}', 'TOOL').length <= ESC.LIM.cta_text_chars, lang + ' ' + k + ' text');
  }
});

test('prompt 1.1: budgets printed from budgetFor, FACTS numbered (or the no-FACTS rule), hook lab with RECENT, beat sheets, retry block, example of the same genre + language', () => {
  const p = ESC.prompt({ topic: 'app hoá đơn', lang: 'vi', target: 45, facts: '1.200 khách đang dùng\nthử thật 28 giây/hoá đơn', recent: ['question', 'number'], genre: 'list', example: ex('list.vi'),
    retry: { attempt: 2, max: 3, feedback: 'FIX THIS', prev: { a: 1 } } });
  const B = ESC.budgetFor('vi', 6);
  assert.match(p.user, new RegExp('hook\\.say ' + B.hook[0] + '–' + B.hook[1] + ' \\(aim ' + B.hook[2] + '\\)'));
  assert.match(p.user, new RegExp('each scene say ' + B.body[0] + '–' + B.body[1])); assert.match(p.user, new RegExp('cta\\.say ' + B.cta[0] + '–' + B.cta[1]));
  assert.match(p.user, /FACTS#1: 1\.200 khách đang dùng/); assert.match(p.user, /FACTS#2: thử thật 28 giây/);
  assert.match(p.user, /HOOK LAB: write 3 hooks of 3 DIFFERENT hook_type \(none of question, number/);
  assert.match(p.user, /list: hook \(number/); assert.match(p.user, /write natively/); assert.match(p.user, /ATTEMPT 2 of 3/); assert.match(p.user, /YOUR PREVIOUS JSON/);
  assert.match(p.user, /EXAMPLE of a valid answer \(list, vi/); assert.ok(p.user.includes(JSON.stringify(ex('list.vi'))));
  assert.match(p.user, /trong thời đại 4\.0/); assert.equal(p.temperature, 0.4); assert.equal(p.budget.hook[1], B.hook[1]);
  const q = ESC.prompt({ topic: 'x' }); assert.match(q.user, /FACTS: none → no statistics/); assert.match(q.user, /hook\.say 2–7 \(aim 6\)/);
  assert.ok(q.prompt.length < 16000, 'prompt ' + q.prompt.length + ' chars');
});

test('AI wrappers (Gemini / OpenAI / Anthropic / prose / trailing comma) parse to the same spec; feedback carries exact numbers', () => {
  const s = JSON.stringify(good);
  for (const v of [{ content: { parts: [{ text: '```json\n' + s + '\n```' }] } }, { choices: [{ message: { content: s } }] }, { content: [{ type: 'text', text: s }] }, { output: 'Here:\n' + s + '\nok' }, s.replace(/\}$/, ',}')]) {
    const r = ESC.check(v); assert.equal(r.ok, true, JSON.stringify(r.errors.slice(0, 2))); assert.equal(r.hash, ESC.check(good).hash);
  }
  assert.equal(ESC.check({ text: 'Sorry, I cannot help with that.' }).errors[0].code, 'E_PARSE');
  const bad = clone(good); bad.hook.say = 'Here are five steps to write seven clear product descriptions in under one minute';
  const r = ESC.check(bad); assert.match(r.feedback, /E_HOOK_LONG \/hook\/say\] hook\.say has \d+ spoken words \(allowed 2–7\)/);
});

// es-render: bản chung với es-editor (editor/spec/core.cjs) — phép so từng byte nằm ở test/core.test.mjs của es-editor (engine/ → es-render)
test('spec/core.cjs là bản 1.1.0 dùng chung với es-editor', () => {
  assert.equal(ESC.CORE, '1.1.0'); assert.equal(ESC.VERSION, 'es.creative/1.1');
  assert.deepEqual([ESC.STANDARD.name, ESC.STANDARD.min, ESC.STANDARD.max, ESC.STANDARD.hook_max], ['es-short/1', 30, 60, 3]);
});

test('chữ tự lấy từ lời (hook / bìa / thẻ) không kết thúc bằng hư từ treo: "… dưới", "… có"', () => {
  const s = { lang: 'vi', voice: 'namminh', hook: { say: 'Mẹo nhỏ nằm dưới bảng tính của bạn đấy, xem nhé.' },
    scenes: [{ role: 'context', layout: 'title_card', say: 'Ai cũng có thể có được kết quả này trong năm phút thôi.' }, { role: 'payoff', layout: 'title_card', say: 'Bấm gửi là xong.', text: 'Xong' }],
    cta: { action: 'save', say: 'Lưu lại video này để làm theo nhé.', text: 'Lưu lại' } };
  const r = ESC.check(s, { owner: true }); const dangling = /\s(có|dưới|trên|của|và|là|thì|cho|với)$/u;
  for (const t of [r.spec.hook.text, r.spec.cover.title, r.spec.scenes[0].text]) { assert.ok(t && t.split(' ').length >= 2, t); assert.doesNotMatch(t, dangling, t); }
  assert.equal(r.spec.hook.text, 'Mẹo nhỏ nằm'); assert.equal(r.spec.scenes[0].text, 'Ai cũng có thể');
});
