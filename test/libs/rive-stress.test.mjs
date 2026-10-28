// Rive tất định dưới tải: examples/rive-hello dựng N lần (mặc định 5, RIVE_STRESS_N), một phần chạy song song, RENDER_CONCURRENCY 1 và 3 → một framemd5 duy nhất.
// Và lỗi vẽ không lọt qua im lặng: một khung hỏng một lần → render thử lại, ra đúng khung như bản sạch; hỏng mãi → job lỗi E_RIVE_DRAW (không "done" với khung sai).
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/libs/rive-stress.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EX, render, md5, tmpDir } from './lib.mjs';

const D = tmpDir('rive');
const N = Math.max(5, Number(process.env.RIVE_STRESS_N || 5));
const hello = () => { const m = JSON.parse(fs.readFileSync(EX('rive-hello', 'rive-hello.json'), 'utf8'));
  for (const s of m.scenes) for (const e of s.elements) if (e.type === 'rive') e.src = EX('rive-hello', e.src); return m; };

test('rive-hello rendered ' + N + ' times (parallel, concurrency 1 and 3) → one framemd5, every frame shot', async () => {
  const runs = [];
  for (let i = 0; i < N; i += 3) runs.push(...await Promise.all(Array.from({ length: Math.min(3, N - i) }, (_, k) => render(D, 's' + (i + k), hello(), { RENDER_CONCURRENCY: (i + k) % 2 ? '1' : '3' }))));
  const hs = runs.map((r) => { assert.equal(r.code, 0, r.log.slice(-1500)); assert.doesNotMatch(r.log, /E_RIVE_DRAW/); return md5(r.mp4).join(','); });
  assert.equal(new Set(hs).size, 1, 'same job → same frames (' + N + ' runs)'); assert.equal(hs[0].split(',').length, 201);
});

// phần tử html cùng cảnh làm hỏng bước kiểm tra của Rive (getImageData ném lỗi) ở t ≥ 1 s: một lần, hoặc mãi mãi
const broken = (always) => { const m = hello(); m.scenes = [m.scenes[0]]; m.scenes[0].elements.push({ type: 'html', x: 0, y: 0, width: 10, height: 10,
  html: '<script>ES.onSeek.push((t)=>{if(t<1||window.__x)return;window.__x=1;const P=CanvasRenderingContext2D.prototype,r0=P.getImageData;'
    + 'P.getImageData=function(){' + (always ? '' : 'P.getImageData=r0;') + 'throw new Error("fault-injected")}})</script>' }); return m; };
test('a Rive frame that fails once is retried and matches the clean render; one that keeps failing fails the job with E_RIVE_DRAW', async () => {
  const clean = hello(); clean.scenes = [clean.scenes[0]]; clean.scenes[0].elements.push({ type: 'html', x: 0, y: 0, width: 10, height: 10, html: '<script>ES.onSeek.push(()=>{})</script>' });
  const [a, b, c] = await Promise.all([render(D, 'clean', clean), render(D, 'once', broken(false)), render(D, 'always', broken(true))]);
  assert.equal(a.code, 0, a.log.slice(-1500)); assert.equal(b.code, 0, b.log.slice(-1500));
  assert.match(b.log, /frame 30 E_RIVE_DRAW: .*fault-injected.* → thử lại/); assert.deepEqual(md5(b.mp4), md5(a.mp4));
  assert.notEqual(c.code, 0); assert.match(c.result && c.result.message || c.log, /E_RIVE_DRAW/); assert.equal(c.result && c.result.status, 'error');
});
