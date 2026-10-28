// node --test test/outcome.test.mjs — the CI → n8n contract: which `outcome` a result gets
import test from 'node:test';
import assert from 'node:assert/strict';
import { outcome } from '../../spec/outcome.mjs';

const done = { status: 'done', duration: 41.3, hook: { voice_end: 2.5 }, spec: { title: 'Your reviews already wrote your FAQ' }, qa: { pass: true, score: 9, issues: [] }, standard: { pass: true, checks: [] } };
test('clean render → post', () => { const o = outcome(done); assert.equal(o.outcome, 'post'); assert.equal(o.publishable, true); assert.match(o.summary_vi, /^✅ .*41s.*hook 2.5s.*QA 9\/10/); });
test('standard error / QA error / low score / brand review → review (rendered, human decides)', () => {
  const std = { pass: false, checks: [{ id: 'S1', level: 'error', ok: false }] };
  assert.equal(outcome({ ...done, duration: 63, standard: std }).outcome, 'review'); assert.match(outcome({ ...done, duration: 63, standard: std }).summary_vi, /^👀 .*độ dài/);
  assert.equal(outcome({ ...done, qa: { pass: false, score: 5, issues: [{ level: 'error', msg: 'khung đen 1.2s tại 3s' }] } }).outcome, 'review');
  assert.equal(outcome({ ...done, qa: { pass: true, score: 6, issues: [] } }).outcome, 'review');
  assert.equal(outcome(done, { review: true }).outcome, 'review');
});
test('rejected by CI: retry while attempts remain, fail on the last attempt (no endless loop)', () => {
  const rej = { status: 'rejected', errors: [{ code: 'E_HOOK_SLOW', msg: 'hook ends at 3.21 s (measured)', vi: 'hook đọc xong 3.21s (đo thật)' }] };
  assert.equal(outcome(rej, { attempt: 1, max_attempts: 3 }).outcome, 'retry'); assert.equal(outcome(rej, { attempt: 2, max_attempts: 3 }).outcome, 'retry');
  const last = outcome(rej, { attempt: 3, max_attempts: 3 }); assert.equal(last.outcome, 'fail'); assert.match(last.summary_vi, /lần cuối/);
});
test('error → fail; unknown → fail', () => { assert.equal(outcome({ status: 'error', message: 'edge-tts: no audio' }).outcome, 'fail'); assert.equal(outcome({}).outcome, 'fail'); });
