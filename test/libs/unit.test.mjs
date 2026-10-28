// Test nhanh (không trình duyệt): khoá thư viện mới + bí danh, HTML thư viện của cảnh chỉ có khoá cũ không đổi một byte so với bản gốc,
// els.expand không đụng job cũ, kiểm tra trường / file / giới hạn cỡ, hợp đồng anim mới, es-render.json của HyperFrames.
//   node --test test/libs/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import * as LIBS2 from '../../libs.mjs';
import * as EL from '../../els.mjs';
import * as ANIM from '../../anim.mjs';
import { REPO, EX, tmpDir } from './lib.mjs';

const BASE = process.env.BASE_REF || 'd0ec723'; // origin/main trước khi thêm thư viện mới
const git = (...a) => { try { return execFileSync('git', ['-C', REPO, ...a], { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch (e) { return null; } };
// khối thư viện của render.mjs (GSAP_PLUGINS … libsFor) chạy riêng, với LIBS2 / work thật
function libBlock(src, work) {
  const a = src.indexOf('const GSAP_PLUGINS'); const b = src.indexOf('const seedTag', a);
  const code = src.slice(a, b) + '\nreturn { libKey, libsFor, LIBS };';
  return new Function('path', 'fs', 'LIBS2', 'work', code.replace(/import\.meta\.url/g, 'META_URL').replace(/^/, 'const META_URL = ' + JSON.stringify('file://' + path.join(REPO, 'render.mjs')) + ';\n'))(path, fs, LIBS2, work);
}
const OLD_SCENES = [[], ['gsap'], ['anime'], ['lottie'], ['three'], ['splittext'], ['drawSVG', 'MorphSVGPlugin', 'customBounce'], ['animejs', 'lottie-web', 'gsap', 'flip'], ['unknownlib', 'gsap'], ['motionpath', 'text', 'easepack', 'physics2d']]
  .map((libs) => ({ elements: [{ type: 'html', html: '<div></div>', libs }] }));

test('old library keys resolve as before and their scene HTML is byte-identical to the base commit', (t) => {
  const base = git('show', BASE + ':render.mjs'); if (!base) { t.skip('base commit ' + BASE + ' not in this clone'); return; }
  const work = tmpDir('unit'); const A = libBlock(base, work); const B = libBlock(fs.readFileSync(path.join(REPO, 'render.mjs'), 'utf8'), work);
  for (const s of OLD_SCENES) assert.equal(B.libsFor(s), A.libsFor(s), JSON.stringify(s.elements[0].libs));
  for (const k of ['gsap', 'anime', 'animejs', 'lottie', 'lottieweb', 'three', 'splittext', 'SplitTextPlugin', 'drawsvg', 'nope']) assert.equal(B.libKey(k), A.libKey(k), k);
  assert.ok(OLD_SCENES.every((s) => !B.libsFor(s).includes('ES.wait')), 'no new preamble for old keys');
});
test('new keys and aliases map to the new libraries, in a fixed order after the old ones', () => {
  const work = tmpDir('unit'); const B = libBlock(fs.readFileSync(path.join(REPO, 'render.mjs'), 'utf8'), work);
  for (const [n, k] of [['anime4', 'anime4'], ['animejs-v4', 'anime4'], ['anime v4', 'anime4'], ['motion', 'motion'], ['framer-motion', 'motion'], ['dotlottie', 'dotlottie'], ['dotlottie-web', 'dotlottie'], ['rive', 'rive'], ['@rive-app', 'rive']]) assert.equal(B.libKey(n), k, n);
  const h = B.libsFor({ elements: [{ libs: ['rive', 'gsap'] }, { libs: ['anime4', 'anime'] }] });
  assert.ok(h.indexOf('gsap.min.js') < h.indexOf('ES.wait') && h.indexOf('anime.min.js') < h.indexOf('anime.umd.min.js') && h.indexOf('anime.umd.min.js') < h.indexOf('canvas_advanced_single.mjs'));
  assert.ok(fs.existsSync(path.join(work, 'wasm-dotlottie.js')) === false);
  B.libsFor({ elements: [{ libs: ['dotlottie'] }] }); assert.ok(fs.existsSync(path.join(work, 'wasm-dotlottie.js')), 'dotLottie wasm written next to the scene, not fetched from a CDN');
  for (const k of Object.keys(LIBS2.EXTRA)) { assert.ok(fs.existsSync(LIBS2.fileOf(k)), k); assert.match(LIBS2.version(k), /^\d+\.\d+\.\d+$/); }
});
test('package.json pins every dependency exactly and the lockfile matches', () => {
  const p = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')); const lock = JSON.parse(fs.readFileSync(path.join(REPO, 'package-lock.json'), 'utf8'));
  for (const [k, v] of Object.entries(p.dependencies)) { assert.match(v, /^(npm:[\w@/.-]+@)?\d+\.\d+\.\d+$/, k + ' ' + v); const real = v.replace(/^npm:.*@/, ''); assert.equal(lock.packages['node_modules/' + k].version, real, k); }
});
test('the old-key lint is silent, WAAPI / Worker usage in new-key html is flagged', () => {
  assert.deepEqual(LIBS2.lint('<script>gsap.to(".a",{x:1})</script>'), []);
  assert.equal(LIBS2.lint('anime4.waapi.animate(el,{x:1})').length, 1); assert.equal(LIBS2.lint('new Worker("x.js")').length, 1);
});

test('els.expand leaves a job without dotlottie / rive untouched (same objects, null result)', async () => {
  const el = { type: 'html', html: '<b>x</b>', libs: ['gsap'] }; const scenes = [{ i: 0, elements: [el, { type: 'anim', src: 'x.html' }] }];
  const copy = structuredClone(scenes); const r = await EL.expand(scenes, { work: tmpDir('unit') });
  assert.equal(r, null); assert.equal(scenes[0].elements[0], el); assert.deepEqual(scenes, copy);
});
test('els.expand turns dotlottie / rive into an html element with libs, canvas, asset file and copied layout fields', async () => {
  const work = tmpDir('unit'); const logs = [];
  const scenes = [{ i: 0, elements: [
    { type: 'dotlottie', src: 'multi_themes.lottie', theme: 'dark', slots: { bg_color: '#ff0000' }, x: 10, y: 20, width: 300, height: 200, start: 0.5, duration: 2, 'z-index': 3, 'fade-in': 0.2, animation: 'pop' },
    { type: 'rive', src: EX('rive-hello', 'fallback_fonts_test.riv'), inputs: [], speed: 2, keyframes: [{ time: 0, x: 0 }] }] }];
  const r = await EL.expand(scenes, { jobPath: EX('dotlottie-hello', 'job.json'), work, W: 640, H: 360, log: (...a) => logs.push(a.join(' ')) });
  assert.equal(r.elements, 2); assert.equal(r.assets, 2);
  const [a, b] = scenes[0].elements;
  assert.equal(a.type, 'html'); assert.deepEqual(a.libs, ['dotlottie']); assert.equal(a.width, 300); assert.equal(a['z-index'], 3); assert.equal(a.animation, 'pop'); assert.equal(a['fade-in'], 0.2);
  assert.match(a.html, /<canvas id="e0c" width="300" height="200"/); assert.match(a.html, /"slots":\{"bg_color":\[1,0,0,1\]\}/); assert.match(a.html, /"st":0\.5,"end":2\.5/);
  assert.deepEqual(b.libs, ['rive']); assert.equal(b.width, 640); assert.equal(b.height, 360); assert.match(b.html, /"speed":2/);
  assert.equal(fs.readdirSync(work).filter((f) => /^asset-[0-9a-f]{8}\.js$/.test(f)).length, 2);
});
test('els.validate / expand report clear error codes', async () => {
  const codes = (e) => EL.validate(e).errors.map((x) => x.code);
  assert.deepEqual(codes({ type: 'rive' }), ['E_EL_SRC_MISSING']);
  assert.deepEqual(codes({ type: 'rive', src: 'a.lottie' }), ['E_EL_SRC_TYPE']);
  assert.deepEqual(codes({ type: 'dotlottie', src: 'a.lottie', segment: [5, 2] }), ['E_EL_FIELD']);
  assert.deepEqual(codes({ type: 'rive', src: 'a.riv', inputs: [{ time: 1, name: 'x', value: 'jump' }] }), ['E_EL_FIELD']);
  assert.deepEqual(codes({ type: 'dotlottie', src: 'ftp://x/a.lottie' }), ['E_EL_SRC_REMOTE']);
  assert.deepEqual(codes({ type: 'rive', src: 'a.riv', fit: 'cover', alignment: 'topLeft', inputs: [{ time: 0, name: 'go', value: 'fire' }, { time: 1, name: 'n', value: 3 }] }), []);
  assert.equal(EL.validate({ type: 'rive', src: 'a.riv', volume: 1 }).warnings[0].code, 'W_FIELD');
  const work = tmpDir('unit');
  await assert.rejects(EL.expand([{ i: 0, elements: [{ type: 'rive', src: 'missing.riv' }] }], { work, jobPath: path.join(work, 'j.json') }), /E_EL_SRC_NOT_FOUND/);
  const big = path.join(work, 'big.lottie'); fs.writeFileSync(big, Buffer.alloc(EL.MAX_ASSET + 1));
  await assert.rejects(EL.expand([{ i: 0, elements: [{ type: 'dotlottie', src: big }] }], { work }), /E_ASSET_TOO_BIG/);
  // file quá ngắn / rỗng: lỗi có vị trí + mã (không RangeError), "on-error": "hide" vẫn áp dụng; file quá lớn bị loại trước khi đọc
  for (const n of [0, 2]) { const f = path.join(work, 'tiny' + n + '.lottie'); fs.writeFileSync(f, Buffer.alloc(n));
    await assert.rejects(EL.expand([{ i: 0, elements: [{ type: 'dotlottie', src: f }] }], { work }), /^Error: scene 1 element e0 \(dotlottie\): E_DOTLOTTIE_LOAD: .*không phải file \.lottie/);
    const sc = [{ i: 0, elements: [{ type: 'dotlottie', src: f, 'on-error': 'hide' }] }]; await EL.expand(sc, { work }); assert.match(sc[0].elements[0].html, /"bad":"không phải file \.lottie/); }
  const rf = fs.readFileSync; let reads = 0; fs.readFileSync = (f, ...a) => { if (String(f) === big) reads++; return rf(f, ...a); };
  try { await assert.rejects(EL.expand([{ i: 0, elements: [{ type: 'dotlottie', src: big }] }], { work }), /E_ASSET_TOO_BIG/); } finally { fs.readFileSync = rf; } assert.equal(reads, 0);
  // tải http(s): download nhận giới hạn 8 MB, lỗi quá cỡ giữ nguyên mã E_ASSET_TOO_BIG
  let cap = null; await assert.rejects(EL.expand([{ i: 0, elements: [{ type: 'rive', src: 'https://x.example/a.riv' }] }], { work, download: async (u, d, tries, max) => { cap = max; throw new Error('E_ASSET_TOO_BIG: ' + u + ' > 8 MB'); } }),
    /e0 \(rive\): E_ASSET_TOO_BIG: https/); assert.equal(cap, EL.MAX_ASSET);
});

test('anim "contract": validated, default keeps the old work copy byte for byte, other values add the shim only', async () => {
  assert.deepEqual(ANIM.validate({ type: 'anim', src: 'a.html', contract: 'seek' }).errors, []);
  assert.equal(ANIM.validate({ type: 'anim', src: 'a.html', contract: 'auto' }).errors[0].code, 'E_ANIM_FIELD');
  const src = '<!doctype html><html><body><svg viewBox="0 0 10 10"></svg><script>window.seek=(t)=>{}</script></body></html>';
  const now = ANIM.workCopy(src, { vclock: '<script>const D0=Date.now()</script>' }).html;
  assert.equal(ANIM.workCopy(src, { vclock: '<script>const D0=Date.now()</script>', contract: 'anim' }).html, now);
  const base = git('show', BASE + ':anim.mjs');
  if (base) { const d = tmpDir('unit'); fs.writeFileSync(path.join(d, 'anim.mjs'), base); const OLD = await import(path.join(d, 'anim.mjs')); assert.equal(OLD.workCopy(src, { vclock: '<script>const D0=Date.now()</script>' }).html, now); }
  for (const c of ['seek', 'render', 'renderFrame']) assert.match(ANIM.workCopy(src, { contract: c }).html, new RegExp('const C="' + c + '"'));
  assert.deepEqual(ANIM.stageSize('<canvas width="640" height="480">').size, [1920, 1080]); // trang anim cũ: như trước
  assert.deepEqual(ANIM.stageSize('<canvas width="640" height="480">', { canvas: true }).size, [640, 480]);
});

test('hf.mjs: es-render.json must pin an exact HyperFrames version (no npx call when it is invalid)', () => {
  const d = tmpDir('unit'); const proj = path.join(d, 'p'); fs.mkdirSync(proj); fs.writeFileSync(path.join(proj, 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(proj, 'es-render.json'), JSON.stringify({ hyperframes: 'latest' }));
  const r = spawnSync(process.execPath, [path.join(REPO, 'hf.mjs'), proj, path.join(d, 'out')], { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent' } });
  const res = JSON.parse(fs.readFileSync(path.join(d, 'out', 'p.result.json'), 'utf8'));
  assert.equal(res.status, 'error'); assert.match(res.message, /x\.y\.z/); assert.equal(res.hyperframes, '0.8.181'); assert.notEqual(r.status, 0);
});
