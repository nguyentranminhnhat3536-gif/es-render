// node --test test/spec/run.test.mjs — spec/run.mjs: các nhánh dừng sớm (chưa dựng gì, nhanh, không mạng) luôn ghi result + outcome cho n8n.
// Đường dựng đủ (TTS giả → render.mjs → bìa → QA → chuẩn) là "vertical slice" trong README (8 phút) — không chạy ở đây.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ESC from '../../spec/core.cjs';
import { ROOT, FACTS, good } from './fx.mjs';

const D = fs.mkdtempSync(path.join(os.tmpdir(), 'esrun-'));
function run(id, spec, meta) {
  const f = path.join(D, id + '.json'); fs.writeFileSync(f, JSON.stringify({ id, kind: 'spec', standard: 'es-short/1', core: ESC.CORE, spec_hash: 'h-' + id, spec, meta }));
  const r = spawnSync(process.execPath, [ROOT + '/spec/run.mjs', f, path.join(D, 'out')], { encoding: 'utf8', env: { ...process.env, SPEC_FAKE_TTS: '1', SPEC_MUSIC_SRC: '' } });
  return { code: r.status, log: r.stdout + r.stderr, res: JSON.parse(fs.readFileSync(path.join(D, 'out', id + '.result.json'), 'utf8')) };
}
// ~70 s: 8 cảnh, mỗi câu gần trần 20 từ
const long = () => { const s = good(); delete s.facts_used; s.scenes = Array.from({ length: 8 }, (_, i) => ({ role: i === 7 ? 'payoff' : 'point', layout: i % 2 ? 'title_card' : 'icon_point', icon: 'bolt', text: 'Step ' + (i + 1) + ' here',
  say: 'Step ' + ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][i] + ' is to open the review list again and copy every single answer that buyers keep on asking about today.' })); return s; };

test('spec ~70 s → rejected (E_TOO_LONG), outcome retry ở lần 1; exit 0, spec_hash được trả lại', () => {
  const est = ESC.estimate(ESC.normalize(long()).spec).total; assert.ok(est > 60, 'ước lượng ' + est);
  const a = run('ES-901-a', long(), { attempt: 1, max_attempts: 3, facts: [] });
  assert.equal(a.code, 0, a.log); assert.equal(a.res.status, 'rejected'); assert.ok(a.res.errors.some((e) => e.code === 'E_TOO_LONG'), JSON.stringify(a.res.errors.map((e) => e.code)));
  assert.equal(a.res.outcome, 'retry'); assert.equal(a.res.publishable, false); assert.equal(a.res.spec_hash, 'h-ES-901-a'); assert.equal(a.res.kind, 'spec'); assert.match(a.res.feedback, /E_TOO_LONG/); assert.match(a.res.summary_vi, /^🔁/);
  // lần cuối: core tự cắt gọt (salvage) rồi DỰNG — đường đó là vertical slice; 'rejected' ở lần cuối → fail (test/spec/outcome.test.mjs)
});
test('K4: spec trích FACTS#1 mà job không mang facts → CI từ chối (E_CLAIM_NO_FACT); mang đúng facts → qua bước kiểm tra', () => {
  const r = run('ES-902', good(), { attempt: 1, max_attempts: 3 }); // không có meta.facts → [] chứ không phải "chấp nhận mọi FACTS#n"
  assert.equal(r.res.status, 'rejected'); assert.ok(r.res.errors.some((e) => e.code === 'E_CLAIM_NO_FACT')); assert.equal(r.res.stage, 'validate');
  assert.equal(ESC.check(good(), { facts: FACTS.EXAMPLE }).ok, true);
});
test('job hỏng (không đọc được spec) → result vẫn được ghi, status error, outcome fail, exit 0 (không thử lại vô ích)', () => {
  const f = path.join(D, 'ES-903.json'); fs.writeFileSync(f, '{ not json');
  const r = spawnSync(process.execPath, [ROOT + '/spec/run.mjs', f, path.join(D, 'out')], { encoding: 'utf8' }); const res = JSON.parse(fs.readFileSync(path.join(D, 'out', 'ES-903.result.json'), 'utf8'));
  assert.equal(r.status, 0); assert.equal(res.status, 'error'); assert.equal(res.outcome, 'fail'); assert.equal(res.kind, 'spec');
});
test.after(() => fs.rmSync(D, { recursive: true, force: true }));
