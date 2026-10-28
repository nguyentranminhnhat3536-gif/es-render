// Chromium: mỗi runtime mới (anime4, motion, dotlottie, rive) — dựng qua render.mjs hai lần ra cùng khung, khung thật sự đổi khi hình chạy,
// tua xuôi / ngược / lộn xộn ra cùng ảnh (rive: chạy tuần tự = nhảy thẳng, tua lùi dựng lại đúng, 30 fps = 60 fps), không đồng hồ thật
// (WAAPI, Worker, OffscreenCanvas, getRandomValues, setInterval, Date thật), không mạng, ES.busy được chờ trước khi chụp.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/libs/page.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, EX, render, md5, frame, px, launch, openScene, tmpDir, sha } from './lib.mjs';
import { EPOCH } from '../../libs.mjs';

const W = 360; const H = 360; const D = tmpDir('page');
const box = (c, extra = '') => '<div id="b" style="position:absolute;left:20px;top:140px;width:80px;height:80px;border-radius:16px;background:' + c + extra + '"></div>';
const SC = {
  anime4: { libs: ['anime4'], html: box('#ff4d6d') + '<script>(()=>{const tl=anime4.createTimeline({autoplay:false}).add("#b",{x:[0,240],rotate:[0,180],duration:1000,ease:"inOutQuad"});ES.onSeek.push((t)=>tl.seek(t*1000))})()</script>' },
  anime3: { libs: ['anime'], html: '<div id="c" style="position:absolute;left:20px;top:260px;width:60px;height:60px;background:#c77dff"></div><script>(()=>{const a=anime({targets:"#c",translateX:[0,260],duration:1000,easing:"linear",autoplay:false});ES.onSeek.push((t)=>a.seek(t*1000))})()</script>' },
  motion: { libs: ['motion'], html: box('#7b5cff') + '<div id="d" style="position:absolute;left:20px;top:260px;width:60px;height:60px;background:#ffd24a"></div><script>(()=>{const M=Motion;'
    + 'ES.motion(M.animate("#b",{x:[0,240],opacity:[0.2,1]},{type:"spring",bounce:0.4,visualDuration:0.6}),0.1);const sp=M.spring({keyframes:[0,260],bounce:0.5,visualDuration:0.5});'
    + 'ES.onSeek.push((t)=>{document.getElementById("d").style.transform="translateX("+sp.next(t*1000).value.toFixed(3)+"px)"})})()</script>' },
  busy: { libs: ['motion'], html: box('#808080') + '<script>(()=>{const b=document.getElementById("b");ES.onSeek.push((t)=>{ES.busy.push(new Promise((r)=>setTimeout(()=>{b.style.background=t>=0.5?"rgb(0,255,0)":"rgb(255,0,0)";r()},200)))})})()</script>' },
};
const html = (k, extra = {}) => ({ type: 'html', libs: SC[k].libs, html: SC[k].html, x: 0, y: 0, width: W, height: H, ...extra });
const MOVIE = { width: W, height: H, creative: 'off', scenes: [
  { duration: 1, 'background-color': '#101018', elements: [html('anime4'), html('anime3')] },
  { duration: 1, 'background-color': '#101018', elements: [html('motion')] },
  { duration: 1, 'background-color': '#101018', elements: [{ type: 'dotlottie', src: EX('dotlottie-hello', 'multi_themes.lottie'), theme: 'dark', width: W, height: H }] },
  { duration: 1, 'background-color': '#22242c', elements: [{ type: 'rive', src: EX('rive-hello', 'fallback_fonts_test.riv'), width: W, height: H, speed: 1.5 }] },
  { duration: 1, 'background-color': '#101018', elements: [html('busy')] }] };
const NAMES = ['anime4', 'motion', 'dotlottie', 'rive', 'busy'];
let R1; let R2; let browser;
before(async () => { [R1, R2] = await Promise.all([render(D, 'p1', MOVIE), render(D, 'p2', MOVIE)]); browser = await launch(); });
after(async () => { if (browser) await browser.close(); });
const scene = (i) => path.join(R1.work, 'scene' + i + '.html');
const seg = (h, i) => h.slice(i * 30, (i + 1) * 30);

test('render.mjs renders the new-runtime job, twice to identical frames, and moving scenes really change frame to frame', () => {
  assert.equal(R1.code, 0, R1.log.slice(-2000)); assert.equal(R2.code, 0, R2.log.slice(-2000));
  assert.match(R1.log, /libs anime4@4\.5\.0/); assert.match(R1.log, /libs rive@/);
  const a = md5(R1.mp4); const b = md5(R2.mp4); assert.equal(a.length, 150); assert.deepEqual(b, a, 'same job → same frames');
  for (const [i, n] of NAMES.slice(0, 4).entries()) { const u = new Set(seg(a, i)).size; assert.ok(u >= 10, n + ': only ' + u + ' distinct frames out of 30 (runtime not redrawing / lagging?)'); }
  assert.ok(!('libs' in R1.result) && !('anims' in R1.result), 'result.json keeps its old shape');
});
for (const [i, n] of [[0, 'anime4'], [1, 'motion'], [2, 'dotlottie']]) {
  test(n + ': frames sampled in order, in reverse and shuffled are identical (stateless seek)', async () => {
    const T = [0.1, 0.3, 0.5, 0.7, 0.9]; const res = {};
    for (const [name, order] of [['fwd', T], ['rev', [...T].reverse()], ['mix', [0.5, 0.1, 0.9, 0.3, 0.7]]]) {
      const p = await openScene(browser, scene(i), { W, H }); assert.ok(p.ready.ok, p.ready.err);
      const h = {}; for (const t of order) h[t] = await p.at(t); res[name] = T.map((t) => h[t]);
      assert.deepEqual(p.net, [], 'no network'); assert.deepEqual(p.errors, []); await p.close();
    }
    assert.deepEqual(res.rev, res.fwd); assert.deepEqual(res.mix, res.fwd); assert.equal(new Set(res.fwd).size, 5, 'each sampled time looks different');
  });
}
test('rive: sequential = straight jump, backward seek replays, 30 fps and 60 fps give the same pose (60 Hz fixed step)', async () => {
  const p1 = await openScene(browser, scene(3), { W, H }); assert.ok(p1.ready.ok, p1.ready.err);
  for (let f = 0; f <= 27; f++) await p1.seek(f / 30); const seq = await p1.at(0.9); const back = await p1.at(0.3); await p1.close();
  const p2 = await openScene(browser, scene(3), { W, H }); const jump = await p2.at(0.9); const fresh3 = await p2.at(0.3); await p2.close();
  const p3 = await openScene(browser, scene(3), { W, H }); for (let f = 0; f <= 54; f++) await p3.seek(f / 60); const s60 = await p3.at(0.9); const fresh = await openScene(browser, scene(3), { W, H }); const only3 = await fresh.at(0.3);
  await p3.close(); await fresh.close();
  assert.equal(seq, jump); assert.equal(s60, jump); assert.equal(back, only3); assert.equal(fresh3, only3); assert.notEqual(jump, only3);
});
test('no real clock in new-runtime scenes: no WAAPI, workers, OffscreenCanvas, getRandomValues, setInterval; Date frozen to the virtual clock', async () => {
  for (let i = 0; i < 4; i++) {
    const p = await openScene(browser, scene(i), { W, H }); assert.ok(p.ready.ok, NAMES[i] + ' ' + p.ready.err);
    await p.seek(0.75);
    const r = await p.page.evaluate(() => ({ anims: document.getAnimations().length, c: window.__esCount, now: Date.now(), d: new Date().getTime(), lib: [typeof window.anime, typeof (window.anime4 && window.anime4.animate)] }));
    assert.equal(r.anims, 0, NAMES[i] + ' WAAPI'); assert.deepEqual(r.c, { worker: 0, shared: 0, offscreen: 0, rnd: 0, interval: 0 }, NAMES[i]);
    assert.equal(r.now, EPOCH + 750, NAMES[i] + ' Date.now'); assert.equal(r.d, EPOCH + 750, NAMES[i] + ' new Date()');
    if (i === 0) assert.deepEqual(r.lib, ['function', 'function'], 'anime v3 and v4 side by side');
    assert.deepEqual(p.net, []); await p.close();
  }
});
test('ES.busy: a runtime promise that resolves 200 ms later (real time) is awaited before the frame is captured', () => {
  const at = (f) => px(frame(R1.mp4, 120 + f, W, H), W, 60, 180);
  const red = at(6); const green = at(24);
  assert.ok(red[0] > 180 && red[1] < 80, 'frame at t=0.2 shows the resolved red state, got ' + red);
  assert.ok(green[1] > 180 && green[0] < 80, 'frame at t=0.8 shows the resolved green state, got ' + green);
});
test('a scene without new keys has no ES.wait / frozen Date / WAIT_JS', () => {
  const d = tmpDir('page'); fs.mkdirSync(d, { recursive: true });
  const s = fs.readFileSync(scene(0), 'utf8'); assert.match(s, /E\.wait=E\.wait\|\|\[\]/); assert.match(s, /window\.ready = async \(\) => \{ const E = window\.ES/);
  return render(d, 'plain', { width: 200, height: 200, creative: 'off', scenes: [{ duration: 0.2, elements: [{ type: 'html', libs: ['gsap'], html: '<b>x</b>', width: 200, height: 200 }] }] }).then((r) => {
    assert.equal(r.code, 0, r.log); const h = fs.readFileSync(path.join(r.work, 'scene0.html'), 'utf8');
    assert.ok(!/ES\.wait|E\.wait|ES\.busy|1767225600000/.test(h)); assert.ok(!/ libs /.test(r.log));
  });
});
// lỗi vẽ Rive không được lọt qua im lặng (VCLOCK nuốt lỗi của ES.onSeek): seek() ném E_RIVE_DRAW, lần tua sau dựng lại từ 0 ra đúng hình
const err = (p, t) => p.seek(t).then(() => null, (e) => String(e.message || e));
test('rive: a throwing frame check, a canvas that stops drawing and a lost context fail the frame with E_RIVE_DRAW, then recover to the clean pose', async () => {
  const ref = await openScene(browser, scene(3), { W, H }); assert.ok(ref.ready.ok, ref.ready.err); await ref.seek(0.5); const clean6 = await ref.at(0.6); const clean7 = await ref.at(0.7); await ref.close();
  const p = await openScene(browser, scene(3), { W, H }); assert.ok(p.ready.ok, p.ready.err); await p.seek(0.5);
  // 1) bước kiểm tra sau khi vẽ ném lỗi một lần (lỗi ném ra từ trong wasm của Rive thì runtime giữ lỗi đó → không dùng để thử)
  await p.page.evaluate(() => { const P = CanvasRenderingContext2D.prototype; const r0 = P.getImageData; P.getImageData = function () { P.getImageData = r0; throw new Error('boom'); }; });
  assert.match(await err(p, 0.6) || '', /E_RIVE_DRAW: .*boom/); assert.equal(await p.at(0.6), clean6, 'retry rebuilds → clean pose');
  // 2) canvas không vẽ được nữa (fill / fillRect / stroke thành no-op): trống bất thường → tính lại từ 0 vẫn trống → thử tô không được → lỗi
  await p.page.evaluate(() => { const P = CanvasRenderingContext2D.prototype; window.__keep = {}; for (const k of ['fill', 'fillRect', 'stroke', 'drawImage']) { const f = P[k]; window.__keep[k] = f;
    P[k] = function (...a) { return this.canvas.id === 'e0c' ? undefined : f.apply(this, a); }; } });
  assert.match(await err(p, 0.7) || '', /E_RIVE_DRAW: .*không vẽ được/);
  await p.page.evaluate(() => { Object.assign(CanvasRenderingContext2D.prototype, window.__keep); });
  assert.equal(await p.at(0.7), clean7);
  // 3) mất ngữ cảnh: seek chờ khôi phục rồi vẽ lại; không khôi phục trong 5 s → lỗi
  await p.page.evaluate(() => document.getElementById('e0c').dispatchEvent(new Event('contextlost')));
  const pend = p.seek(0.6); await p.page.evaluate(() => new Promise((r) => setTimeout(r, 200))); await p.page.evaluate(() => document.getElementById('e0c').dispatchEvent(new Event('contextrestored')));
  await pend; assert.equal(sha(await p.shot()), clean6);
  await p.page.evaluate(() => document.getElementById('e0c').dispatchEvent(new Event('contextlost')));
  assert.match(await err(p, 0.7) || '', /E_RIVE_DRAW: .*mất ngữ cảnh/);
  assert.deepEqual(p.net, []); await p.close();
});
