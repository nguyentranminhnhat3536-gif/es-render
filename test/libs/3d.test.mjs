// Chromium: phần tử "3d" (es3d) — dựng qua render.mjs hai lần ra cùng khung, RENDER_CONCURRENCY 1 = 3, khung thật sự đổi; vật lý: chạy tuần tự = nhảy thẳng,
// tua lùi (dựng lại cây vật lý + chạy lại từ 0) và tua lộn xộn ra cùng ảnh, 30 fps = 60 fps (bước 60 Hz); không vật lý: tua mọi thứ tự như nhau;
// không mạng / worker / getRandomValues / setInterval / WAAPI, Date đóng băng; three 0.160 toàn cục sống chung với three 0.186 trong bundle;
// cổng ready(): chậm 1 s vẫn ra khung giống hệt, không bao giờ xong → E_3D_TIMEOUT (không treo), .glb hỏng + "on-error": "hide" → ẩn.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/libs/3d.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EX, render, md5, launch, openScene, tmpDir } from './lib.mjs';
import { EPOCH } from '../../libs.mjs';
import { glbBox } from './glb.mjs';

const W = 180; const H = 320; const D = tmpDir('3d');
fs.writeFileSync(path.join(D, 'box.glb'), glbBox({ size: [0.9, 1.3, 0.6] }));
const LABEL = EX('3d-hello', 'label.png');
const el = (x) => ({ type: '3d', width: W, height: H, aa: 0, ...x });
const THREE160 = '<canvas id="c3" width="40" height="40"></canvas><script>window.__t160=THREE.REVISION;const r=new THREE.WebGLRenderer({canvas:document.getElementById("c3"),preserveDrawingBuffer:true});'
  + 'const sc=new THREE.Scene();sc.background=new THREE.Color(0x3355ff);const cam=new THREE.PerspectiveCamera();ES.onSeek.push(()=>r.render(sc,cam));</script>';
const MOVIE = { width: W, height: H, creative: 'off', scenes: [
  { duration: 1.2, 'background-color': '#0b0b10', elements: [el({ image: LABEL, fx: { bloom: 0.9, vignette: 0.3 }, seed: 3 })] },
  { duration: 1, 'background-color': '#0b0b10', elements: [el({ model: 'box.glb', bits: 6, fx: { bloom: 0.6 }, camera: { orbit: 0.5 } })] },
  { duration: 1, 'background-color': '#0b0b10', elements: [el({ preset: 'logo-spin', image: LABEL, fx: { bloom: 0.8, dof: { focus: 6, range: 2, bokeh: 1.5 } } })] },
  { duration: 0.5, 'background-color': '#0b0b10', elements: [{ type: 'html', libs: ['three'], html: THREE160, x: 0, y: 0, width: 40, height: 40, 'z-index': 2 }, el({ preset: 'logo-spin', physics: false, colors: { bg: '#202030' } })] }] };
const FR = [36, 30, 30, 15];
let R1; let R2; let R3; let browser;
before(async () => {
  [R1, R2] = await Promise.all([render(D, 'a', MOVIE, { RENDER_CONCURRENCY: '3' }), render(D, 'b', MOVIE, { RENDER_CONCURRENCY: '3' })]);
  R3 = await render(D, 'c', MOVIE, { RENDER_CONCURRENCY: '1' });
  browser = await launch();
});
after(async () => { if (browser) await browser.close(); });
const scene = (i) => path.join(R1.work, 'scene' + i + '.html');
const segs = (h) => { const out = []; let k = 0; for (const n of FR) { out.push(h.slice(k, k + n)); k += n; } return out; };

test('render.mjs renders 3d scenes twice to identical frames, RENDER_CONCURRENCY 1 = 3, and the picture really moves', () => {
  for (const r of [R1, R2, R3]) assert.equal(r.code, 0, r.log.slice(-3000));
  assert.match(R1.log, /libs es3d@1\.0\.0/);
  const a = md5(R1.mp4); const b = md5(R2.mp4); const c = md5(R3.mp4);
  assert.equal(a.length, FR.reduce((s, n) => s + n, 0));
  assert.deepEqual(b, a, 'same job twice → same frames'); assert.deepEqual(c, a, 'concurrency 1 → same frames as concurrency 3');
  segs(a).forEach((s, i) => { const u = new Set(s).size; assert.ok(u >= s.length - 2, 'scene ' + i + ': only ' + u + ' distinct frames of ' + s.length); });
  assert.ok(!('libs' in R1.result), 'result.json keeps its old shape');
});
test('physics: sequential = straight jump, backward seek replays from 0, shuffled seeks = forward, 30 fps = 60 fps', async () => {
  const T = [0.2, 0.4, 0.6, 0.8, 0.9];
  const p1 = await openScene(browser, scene(0), { W, H }); assert.ok(p1.ready.ok, p1.ready.err);
  for (let f = 0; f <= 26; f++) await p1.seek(f / 30); const seq = await p1.at(0.9); const back = await p1.at(0.3); const again = await p1.at(0.9);
  assert.deepEqual(p1.errors, []); await p1.close();
  const p2 = await openScene(browser, scene(0), { W, H }); const jump = await p2.at(0.9); await p2.close();
  const p3 = await openScene(browser, scene(0), { W, H }); const only = await p3.at(0.3); await p3.close();
  const p4 = await openScene(browser, scene(0), { W, H }); for (let f = 0; f <= 53; f++) await p4.seek(f / 60); const s60 = await p4.at(0.9); await p4.close();
  assert.equal(seq, jump, 'sequential 30 fps = jump to 0.9'); assert.equal(back, only, 'backward seek (remount + replay) = fresh page at 0.3');
  assert.equal(again, jump, 'forward again after the replay'); assert.equal(s60, jump, '60 fps stepping = 30 fps (fixed 60 Hz physics)'); assert.notEqual(jump, only);
  const fw = await openScene(browser, scene(0), { W, H }); const fwd = []; for (const t of T) fwd.push(await fw.at(t)); await fw.close();
  const mx = await openScene(browser, scene(0), { W, H }); const h = {}; for (const t of [0.9, 0.2, 0.6, 0.4, 0.8, 0.2]) h[t] = await mx.at(t);
  assert.deepEqual(mx.net, []); assert.deepEqual(mx.errors, []); await mx.close();
  assert.deepEqual(T.map((t) => h[t]), fwd, 'random-order seeks give the forward frames'); assert.equal(new Set(fwd).size, T.length);
});
test('physics with a .glb model: backward seek after the end replays to the same frame', async () => {
  const p = await openScene(browser, scene(1), { W, H }); assert.ok(p.ready.ok, p.ready.err);
  for (let f = 0; f <= 29; f++) await p.seek(f / 30); const end = await p.at(29 / 30); const mid = await p.at(0.5); await p.close();
  const q = await openScene(browser, scene(1), { W, H }); const mid2 = await q.at(0.5); const end2 = await q.at(29 / 30); await q.close();
  assert.equal(mid, mid2); assert.equal(end, end2);
});
test('no physics (logo-spin + DOF): frames in order, reversed and shuffled are identical', async () => {
  const T = [0.1, 0.3, 0.5, 0.7, 0.9]; const res = {};
  for (const [name, order] of [['fwd', T], ['rev', [...T].reverse()], ['mix', [0.5, 0.1, 0.9, 0.3, 0.7]]]) {
    const p = await openScene(browser, scene(2), { W, H }); assert.ok(p.ready.ok, p.ready.err);
    const h = {}; for (const t of order) h[t] = await p.at(t); res[name] = T.map((t) => h[t]); assert.deepEqual(p.net, []); await p.close();
  }
  assert.deepEqual(res.rev, res.fwd); assert.deepEqual(res.mix, res.fwd); assert.equal(new Set(res.fwd).size, T.length);
});
test('no real clock, workers, randomness or network; global THREE 0.160 and the bundle three 0.186 side by side', async () => {
  for (const i of [0, 3]) {
    const p = await openScene(browser, scene(i), { W, H }); assert.ok(p.ready.ok, p.ready.err); await p.seek(0.4);
    const r = await p.page.evaluate(() => ({ anims: document.getAnimations().length, c: window.__esCount, now: Date.now(), d: new Date().getTime(), t: window.THREE && window.THREE.REVISION, t160: window.__t160, es3d: window.ES3D.three }));
    assert.equal(r.anims, 0); assert.deepEqual(r.c, { worker: 0, shared: 0, offscreen: 0, rnd: 0, interval: 0 }, 'scene ' + i);
    assert.equal(r.now, EPOCH + 400); assert.equal(r.d, EPOCH + 400); assert.equal(r.es3d, '186');
    if (i === 3) { assert.equal(r.t, '160'); assert.equal(r.t160, '160'); }
    assert.deepEqual(p.net, []); assert.deepEqual(p.errors, []); await p.close();
  }
});

// cổng ready(): một phần tử html đặt trước phần tử 3d thay ES3D.mount bằng bản có ready() chậm / không bao giờ xong
const gate = (ms) => ({ type: 'html', html: '<script>(()=>{const L=window.ES3D;window.ES3D={...L,mount:(c,s,o)=>{const h=L.mount(c,s,o);'
  + (ms < 0 ? 'h.ready=new Promise(()=>{});' : 'const r=h.ready;h.ready=r.then((v)=>new Promise((ok)=>setTimeout(()=>ok(v),' + ms + ')));') + 'return h}}})()</script>', width: 1, height: 1 });
const one = (els, d = 0.5) => ({ width: W, height: H, creative: 'off', scenes: [{ duration: d, 'background-color': '#000000', elements: els }] });
test('ready gate: a 3d scene that becomes ready 1 s later (real time) renders the same frames as an instant one', async () => {
  const [s, f] = await Promise.all([render(D, 'slow', one([gate(1000), el({ bits: 4 })])), render(D, 'fast', one([gate(0), el({ bits: 4 })]))]);
  assert.equal(s.code, 0, s.log.slice(-2000)); assert.equal(f.code, 0, f.log.slice(-2000)); assert.deepEqual(md5(s.mp4), md5(f.mp4));
});
test('ready gate: a 3d scene that never becomes ready fails with E_3D_TIMEOUT after its timeout, not a hang; bad .glb with "on-error": "hide" renders without it', async () => {
  fs.writeFileSync(path.join(D, 'broken.glb'), 'glTF but not really');
  const t0 = Date.now();
  const [n, h] = await Promise.all([render(D, 'never', one([gate(-1), el({ timeout: 3 })])), render(D, 'hide', one([el({ model: 'broken.glb', 'on-error': 'hide' })]))]);
  assert.notEqual(n.code, 0); assert.match(n.result.message, /E_3D_TIMEOUT: 3d product-hero: cảnh 3D chưa sẵn sàng sau 2 s/); assert.ok(Date.now() - t0 < 60000);
  assert.equal(h.code, 0, h.log.slice(-2000)); assert.match(h.log, /E_3D_LOAD: 3d product-hero: .*→ ẩn phần tử/);
});
test('ready gate under load: 4 scene pages (one with two 3d elements) starting together at RENDER_CONCURRENCY=3, 25 fps, use the 60 s default and do not time out', async () => {
  const w = 240; const h = 426; const e2 = (x) => ({ type: '3d', width: w, height: h, aa: 0, ...x });
  const job = { width: w, height: h, creative: 'off', scenes: [
    { duration: 0.4, 'background-color': '#0b0b10', elements: [e2({ image: LABEL, fx: { bloom: 0.9 } })] },
    { duration: 0.4, 'background-color': '#0b0b10', elements: [e2({ model: 'box.glb', bits: 6 }), e2({ preset: 'logo-spin', image: LABEL, width: 120, height: 120, x: 60, y: 20, 'z-index': 2 })] },
    { duration: 0.4, 'background-color': '#0b0b10', elements: [e2({ preset: 'logo-spin', image: LABEL, fx: { dof: { focus: 6, range: 2, bokeh: 1.5 } } })] },
    { duration: 0.4, 'background-color': '#0b0b10', elements: [e2({ seed: 9 })] }] };
  const r = await render(D, 'par3', job, { RENDER_CONCURRENCY: '3', RENDER_FPS: '25' });
  assert.equal(r.code, 0, r.log.slice(-3000)); assert.doesNotMatch(r.log, /E_3D_TIMEOUT|E_EL_TIMEOUT/); assert.equal(md5(r.mp4).length, 40);
});
