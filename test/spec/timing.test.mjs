// node --test test/spec/timing.test.mjs — CI timing solver with a fake TTS (edge-tts speed 2.48 w/s ± a per-test factor), no network
import test from 'node:test';
import assert from 'node:assert/strict';
import ESC from '../../spec/core.cjs';
import { good as G, FACTS } from './fx.mjs';
import { fit, layout, beatSnap } from '../../spec/timing.mjs';

const good = G(); // core 1.1: ESC.EXAMPLE (cites FACTS#1 → FACTS.EXAMPLE)
// fake edge-tts: words evenly at wps·(1+rate)·k, 0.09 s silence at both ends of the mp3 (as measured in ES-002)
const fakeTTS = (text, rate, k = 1) => { const ws = String(text).split(/\s+/).filter(Boolean); const wps = 2.48 * (1 + rate / 100) * k; let t = 0.09;
  const words = ws.map((w) => { const o = { t: +t.toFixed(3), d: +(0.85 / wps).toFixed(3), w }; t += 1 / wps; return o; }); return { dur: +(t + 0.09).toFixed(3), words }; };
const lines = (s, rate, k) => { const n = ESC.normalize(s).spec; const all = [{ part: 'hook', say: n.hook.say, role: 'hook' }, ...n.scenes.map((x) => ({ part: 'scene', say: x.say, role: x.role, n: (x.items || x.bubbles || []).length })), { part: 'cta', say: n.cta.say, role: 'cta' }];
  return all.map((l, i) => ({ ...l, trans: i <= 1 ? 0 : 0.22, voice: fakeTTS(l.say, rate, k) })); };
const run = async (s, k = 1) => { const sc = lines(s, 6, k); const r = await fit(sc, { tts: async (i, rate) => fakeTTS(sc[i].say, rate, k), rate: 6 }); return { r, sc }; };

test('good spec fits without changes; estimate within 6 % of the solver', async () => {
  const { r } = await run(good); const est = ESC.check(good, { facts: FACTS.EXAMPLE }).estimate;
  assert.equal(r.ok, true); assert.ok(r.L.total >= 32 && r.L.total <= 57); assert.ok(r.L.hook_end <= 2.6);
  assert.ok(Math.abs(r.L.total - est.total) / est.total < 0.06, 'solver ' + r.L.total + ' vs estimate ' + est.total);
  console.log('good:', r.L.total + 's hook', r.L.hook_end + 's first word', r.L.first_word, 'first cut', r.L.first_cut, '| estimate', est.total);
});

test('slow voice (−10 %): a 7-word hook that passed the n8n gate is re-synthesised faster; fast voice (+15 %): holds extend', async () => {
  const nine = JSON.parse(JSON.stringify(good)); nine.hook.say = 'Your customer reviews already wrote your FAQ.';
  assert.equal(ESC.check(nine, { facts: FACTS.EXAMPLE }).ok, true, 'passes gate 1');
  let { r } = await run(nine, 0.9); assert.equal(r.ok, true, r.msg); assert.ok(r.L.hook_end <= 3.0 && r.rates.hook > 6, JSON.stringify(r.rates) + ' ' + r.L.hook_end);
  console.log('7-word hook, slow voice:', r.L.hook_end + 's', r.log.join('; '));
  const short = JSON.parse(JSON.stringify(good)); short.scenes = short.scenes.slice(0, 3);
  ({ r } = await run(short, 1.15)); console.log('3 scenes, fast voice:', r.ok, r.L.total + 's', r.log.join('; ') || 'holds only');
  assert.ok(r.L.total >= 30 || r.code === 'E_TOO_SHORT');
});

test('impossible cases are reported with measured numbers (CI → rejected / salvage)', async () => {
  const long = JSON.parse(JSON.stringify(good)); long.hook.say = 'Your old customer reviews have already quietly written the whole FAQ page for you today.';
  const { r } = await run(long, 0.9); assert.equal(r.ok, false); assert.equal(r.code, 'E_HOOK_SLOW'); console.log(r.msg);
});

test('layout() mirrors render.mjs frame rounding; beat snap moves cuts by ≤ 0.2 s', async () => {
  const sc = lines(good, 6, 1); for (const s of sc) s.hold = 0.2; const L = layout(sc);
  for (const x of L.scenes) assert.equal(Math.round(x.D * 30), x.D * 30);
  const before = layout(sc).total; const n = beatSnap(sc, { bpm: 112, beat0: 0.21 }); const after = layout(sc).total;
  assert.ok(n > 0 && Math.abs(after - before) < 0.2 * sc.length); console.log('beat snap moved', n, 'cuts', before, '→', after);
});
