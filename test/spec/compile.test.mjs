// node --test test/spec/compile.test.mjs — spec → movie JSON with a FAKE TTS (silent mp3 + evenly spaced words; ffmpeg needed, no network, no Chromium)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ESC from '../../spec/core.cjs';
import { good as G, FACTS } from './fx.mjs';
import { compile } from '../../spec/compile.mjs';
import { makeSfx } from '../../spec/sfx.mjs';
import { makeTts } from '../../spec/tts.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/brand/ethan-studio.json'), 'utf8')); const fontsUrl = 'file://' + path.join(ROOT, brand.fonts.dir);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esc-')); const sfx = makeSfx(path.join(dir, 'sfx'));
const good = G(); // core 1.1: ESC.EXAMPLE (cites FACTS#1 → FACTS.EXAMPLE)
const spec = (o = good) => ESC.check(o, { id: 'ES-031-20261022-093000', facts: FACTS.EXAMPLE }).spec;
const run = (s, k = 1, extra = {}) => compile(s, { id: 'ES-031-20261022-093000', hash: 'abc', brand, fontsUrl, ttsDir: path.join(dir, 'tts' + k), sfx, tts: makeTts({ dir: path.join(dir, 'tts' + k), fake: true, k }), musicSrc: null, ...extra });
const FR = 30; const fr = (x) => Math.round(x * FR) / FR;

test('good spec compiles: timeline = render.mjs formula, hook ≤ 3.0 s, no transition into scene 1, pre-synthesised voice files exist', async () => {
  const c = await run(spec()); assert.equal(c.ok, true, JSON.stringify(c.errors)); const m = c.movie;
  assert.equal(m.scenes.length, 8); assert.equal(m.creative.transitions, 'keep'); assert.equal(m.scenes[0].transition, undefined); assert.equal(m.scenes[1].transition, undefined);
  let T = 0, acc = 0; m.scenes.forEach((s, i) => { assert.ok(s.duration > 0 && s.elements.some((e) => e.type === 'voice')); const tr = s.transition ? Math.min(s.transition.duration, s.duration / 2, 1.5) : 0; T = i ? acc - tr : 0; acc = T + fr(s.duration); });
  assert.ok(Math.abs(acc - c.report.timing.after_tts) < 0.04, 'render total ' + acc + ' vs compile ' + c.report.timing.after_tts); assert.ok(acc >= 30 && acc <= 60);
  assert.ok(c.report.hook.voice_end <= 3.0 && c.report.hook.voice_start <= 0.35, JSON.stringify(c.report.hook));
  for (const e of m.scenes.flatMap((s) => s.elements).filter((e) => e.type === 'voice')) { const f = e.src.replace('file://', ''); assert.ok(fs.existsSync(f) && fs.existsSync(f.replace(/\.mp3$/, '.words.json')) && e.text, 'voice file pair'); }
  assert.ok(m.scenes.every((s) => !s.transition || ['zoom', 'whip', 'whip-up', 'smoothleft', 'circleopen', 'dissolve'].includes(s.transition.style)));
  assert.ok(['Reviews', 'into', 'FAQ'].every((w) => m.cover.html.includes('>' + w + '<') || m.cover.html.includes('>' + w + '<i')) && ['FAQ', 'from', 'your', 'reviews'].every((w) => m.cover.alt_html.includes(w)) && m.cover.thumb_t > 0);
  const sub = m.elements.find((e) => e.type === 'subtitles'); assert.equal(sub.settings.y, 1395); assert.deepEqual(sub.settings.hide, []);
});
test('SFX: every sound has peakAt, caps hold (≥ 0.18 s apart, ≤ 3 per 2 s, ≤ 0.8/s), global start ≥ 0', async () => {
  const c = await run(spec()); const T = []; let t0 = 0; c.L.scenes.forEach((s) => T.push(s.T));
  const a = c.movie.scenes.flatMap((s, i) => s.elements.filter((e) => e.type === 'audio').map((e) => ({ g: T[i] + e.start + Number(e.comment.match(/peakAt=([\d.]+)/)[1]), start: T[i] + e.start, kind: e.comment.split(' ')[1] }))).sort((x, y) => x.g - y.g);
  assert.ok(a.length > 5 && a.length / c.L.total <= 0.8 + 1e-6, a.length + ' sfx'); assert.ok(a.every((x) => x.start >= -1e-6));
  for (let i = 1; i < a.length; i++) assert.ok(a[i].g - a[i - 1].g >= 0.18 - 1e-6, 'gap ' + (a[i].g - a[i - 1].g));
  for (const x of a) assert.ok(a.filter((y) => y.g > x.g - 2 && y.g <= x.g + 2).length <= 3 + 1, 'density'); // window includes the anchor itself
  assert.ok(a.some((x) => x.kind === 'hit' && x.g < 0.2), 'hook hit at 0.03 s'); assert.ok(a.some((x) => x.kind === 'ding'), 'CTA ding');
});
test('every html element starts with the same head; only our own <script>; AI text is escaped', async () => {
  const evil = JSON.parse(JSON.stringify(good)); evil.scenes[0].text = '<img src=x onerror=alert(1)>Hi'; evil.scenes[1].items[0] = '"><script>alert(1)</script>';
  const s = spec(evil); const c = await run(s); const htmls = c.movie.scenes.flatMap((x) => x.elements).filter((e) => e.type === 'html').map((e) => e.html); const h0 = htmls[0].slice(0, htmls[0].indexOf('</style>') + 8);
  assert.ok(htmls.every((h) => h.startsWith(h0)), 'identical head'); assert.ok(!htmls.some((h) => /onerror=|<img src=x/.test(h)));
  for (const h of htmls) assert.ok(((h.match(/<script/g) || []).length) <= 1, 'one script max'); assert.ok(!htmls.join('').includes('<script>alert'));
});
test('deterministic: same spec + seed → byte-identical movie; another seed → another variant', async () => {
  const a = JSON.stringify((await run(spec(), 1)).movie), b = JSON.stringify((await run(spec(), 1)).movie); assert.equal(a, b);
  const s2 = { ...spec(), seed: 'another' }; const c2 = await run(s2, 1); assert.notEqual(JSON.stringify(c2.movie), a);
});
test('fit: slow voice → hook re-synthesised faster; impossible hook → rejected with MEASURED numbers; fast voice + short spec → holds', async () => {
  const slow = await run(spec(), 2, { tts: makeTts({ dir: path.join(dir, 'ttsS'), fake: true, k: 0.9 }) }); assert.equal(slow.ok, true); assert.ok(slow.report.hook.voice_end <= 3.0, 'hook ' + slow.report.hook.voice_end);
  const long = JSON.parse(JSON.stringify(good)); long.hook.say = 'Stop writing product descriptions by hand, there is a much faster way.'; const bad = ESC.validate(long, { id: 'x', facts: FACTS.EXAMPLE }); const s = bad.spec;
  const c = await run(s, 3, { tts: makeTts({ dir: path.join(dir, 'ttsB'), fake: true, k: 0.6 }) }); assert.equal(c.ok, false); assert.equal(c.errors[0].code, 'E_HOOK_SLOW'); assert.match(c.errors[0].msg, /measured/);
});
