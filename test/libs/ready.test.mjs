// Cổng chờ của thư viện / phần tử mới: tài nguyên chậm vẫn cho khung đầu đúng, file hỏng báo mã lỗi rõ ("on-error": "hide" thì ẩn),
// hết hạn ES.wait báo lỗi chứ không treo, .riv có ảnh nhúng / input không có bị từ chối.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/libs/ready.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EX, FIX, render, md5, frame, px, tmpDir } from './lib.mjs';

const D = tmpDir('ready'); const W = 200; const H = 200;
const one = (els, d = 0.3) => ({ width: W, height: H, creative: 'off', scenes: [{ duration: d, 'background-color': '#000000', elements: els }] });
const paint = (delay) => '<div id="b" style="width:200px;height:200px;background:#333"></div><script>ES.wait.push(new Promise((r)=>{const go=()=>{document.getElementById("b").style.background="#00c8ff";r()};'
  + (delay ? 'setTimeout(go,' + delay + ')' : 'go()') + '}))</script>';
const bad = (name, bytes) => { const f = path.join(D, name); fs.writeFileSync(f, bytes); return f; };

test('a slow runtime (ES.wait resolves after 1 s of real time) still gives a correct first frame, equal to the instant one', async () => {
  const [a, b] = await Promise.all([render(D, 'slow', one([{ type: 'html', libs: ['motion'], html: paint(1000), width: W, height: H }])), render(D, 'fast', one([{ type: 'html', libs: ['motion'], html: paint(0), width: W, height: H }]))]);
  assert.equal(a.code, 0, a.log); assert.equal(b.code, 0, b.log);
  assert.deepEqual(md5(a.mp4), md5(b.mp4)); const c = px(frame(a.mp4, 0, W, H), W, 100, 100); assert.ok(c[2] > 200 && c[0] < 60, 'first frame painted, got ' + c);
});
test('corrupt .lottie / .riv → E_DOTLOTTIE_LOAD / E_RIVE_LOAD; "on-error": "hide" renders without the element', async () => {
  const L = bad('broken.lottie', Buffer.from('PK\x03\x04 not really a zip')); const R = bad('broken.riv', Buffer.from('RIVE garbage garbage garbage'));
  const [l, r, h] = await Promise.all([render(D, 'bl', one([{ type: 'dotlottie', src: L }])), render(D, 'br', one([{ type: 'rive', src: R }])),
    render(D, 'bh', one([{ type: 'rive', src: R, 'on-error': 'hide' }, { type: 'dotlottie', src: L, 'on-error': 'hide' }, { type: 'html', html: '<div style="width:50px;height:50px;background:#fff"></div>', width: 50, height: 50 }]))]);
  assert.notEqual(l.code, 0); assert.match(l.result.message, /E_DOTLOTTIE_LOAD: broken\.lottie/);
  assert.notEqual(r.code, 0); assert.match(r.result.message, /E_RIVE_LOAD: broken\.riv/);
  assert.equal(h.code, 0, h.log); assert.equal(h.result.status, 'done'); assert.match(h.log, /→ ẩn phần tử|E_RIVE_LOAD/);
});
test('ES.wait that never resolves → E_EL_TIMEOUT after the element budget, not a hang', async () => {
  const t0 = Date.now(); const r = await render(D, 'never', one([{ type: 'html', libs: ['anime4'], html: '<script>ES.waitMs=1500;ES.wait.push(new Promise(()=>{}))</script>', width: W, height: H }]));
  assert.notEqual(r.code, 0); assert.match(r.result.message, /E_EL_TIMEOUT/); assert.ok(Date.now() - t0 < 30000);
});
test('rive: embedded raster image → E_RIVE_UNSUPPORTED; unknown input name → E_RIVE_LOAD listing the inputs', async () => {
  const [a, b] = await Promise.all([render(D, 'img', one([{ type: 'rive', src: FIX('embedded_png_asset.riv') }])),
    render(D, 'inp', one([{ type: 'rive', src: EX('rive-hello', 'fallback_fonts_test.riv'), inputs: [{ time: 0.1, name: 'wave', value: true }] }]))]);
  assert.match(a.result.message, /E_RIVE_UNSUPPORTED/); assert.match(b.result.message, /E_RIVE_LOAD: .*input "wave"/);
});
test('dotlottie: unknown theme / slot are errors; plain Lottie JSON loads', async () => {
  const [a, b, c] = await Promise.all([render(D, 'th', one([{ type: 'dotlottie', src: EX('dotlottie-hello', 'multi_themes.lottie'), theme: 'nope' }])),
    render(D, 'sl', one([{ type: 'dotlottie', src: EX('dotlottie-hello', 'multi_themes.lottie'), slots: { nope: '#ff0000' } }])),
    render(D, 'js', one([{ type: 'dotlottie', src: FIX('waves.json'), width: W, height: H }], 0.5))]);
  assert.match(a.result.message, /E_DOTLOTTIE_THEME: .*dark/); assert.match(b.result.message, /E_DOTLOTTIE_SLOT: .*bg_color/);
  assert.equal(c.code, 0, c.log); assert.ok(new Set(md5(c.mp4)).size > 3, 'json animation moves');
});
