// node --test test/spec/fonts.test.mjs — phụ đề libass và font kèm repo (K2): assets/fonts chỉ là phương án CUỐI.
//  1. có mạng: render.mjs mới và render.mjs của BASE_REF (mặc định 24edb84) ra khung hình y hệt (cùng file font tải từ Google Fonts)
//  2. chặn mạng (fetch lỗi): bản mới dùng assets/fonts/InterTight-800.ttf (log), bản cũ rơi về font mặc định của libass
// Job: một cảnh video tĩnh có "words" (phụ đề không cần TTS). Cần ffmpeg + Chromium; phần 1 cần mạng (không có → bỏ qua).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { ROOT } from './fx.mjs';

const BASE = process.env.BASE_REF || '24edb84';
const D = fs.mkdtempSync(path.join(os.tmpdir(), 'esfont-'));
const src = path.join(D, 'bg.mp4');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x223344:s=540x960:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=300:r=48000:d=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', src]);
const words = [{ t: 0.1, d: 0.4, w: 'Fonts' }, { t: 0.6, d: 0.4, w: 'stay' }, { t: 1.1, d: 0.5, w: 'identical' }];
const job = path.join(D, 'subs-job.json');
fs.writeFileSync(job, JSON.stringify({ width: 540, height: 960, creative: 'off', elements: [{ type: 'subtitles', settings: { style: 'classic', 'font-family': 'Inter Tight', 'font-weight': 800, 'font-size': 48 } }],
  scenes: [{ duration: 2, elements: [{ type: 'video', src: 'file://' + src, duration: 2, words }] }] }));
const block = path.join(D, 'block.mjs'); // fetch lỗi như khi mất mạng (Google Fonts + google/fonts)
fs.writeFileSync(block, "const f = globalThis.fetch; globalThis.fetch = (u, o) => (/fonts\\.googleapis|raw\\.githubusercontent/.test(String(u)) ? Promise.reject(new Error('blocked')) : f(u, o));\n");
let N = 0;
function render(engine, { offline = false } = {}) {
  const out = path.join(D, 'out' + N++); const r = spawnSync(process.execPath, [...(offline ? ['--import', block] : []), engine, job, out], { encoding: 'utf8', env: { ...process.env, RENDER_FPS: '30', RENDER_CONCURRENCY: '1' } });
  assert.equal(r.status, 0, r.stdout + r.stderr); return { log: r.stdout + r.stderr, mp4: path.join(out, 'subs-job.mp4') };
}
const md5 = (f) => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-map', '0:v:0', '-f', 'framemd5', '-']).toString().split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop().trim());
let baseEngine = null;
test.before(() => { try { const d = path.join(D, 'base'); fs.mkdirSync(d);
  for (const f of ['render.mjs', 'anim.mjs', 'libs.mjs', 'els.mjs', 'el3d.mjs']) { try { fs.writeFileSync(path.join(d, f), execFileSync('git', ['-C', ROOT, 'show', BASE + ':' + f], { stdio: ['ignore', 'pipe', 'ignore'] })); } catch (e) { if (f === 'render.mjs') throw e; } }
  for (const x of ['node_modules', 'tts.py', 'vendor', 'vendor-src']) if (fs.existsSync(path.join(ROOT, x))) fs.symlinkSync(path.join(ROOT, x), path.join(d, x));
  baseEngine = path.join(d, 'render.mjs'); } catch (e) { baseEngine = null; } });

test('chặn mạng: bản mới lấy InterTight-800.ttf trong assets/fonts; bản cũ rơi về font mặc định', () => {
  const a = render(path.join(ROOT, 'render.mjs'), { offline: true }); assert.match(a.log, /font từ assets\/fonts \(mạng lỗi\): InterTight-800\.ttf/);
  // (khung hình không so ở đây: máy có font "Inter" cài sẵn thì libass có thể chọn cùng một font cho cả hai — trên runner Ubuntu thì không)
  if (baseEngine) { const b = render(baseEngine, { offline: true }); assert.match(b.log, /font not found/); assert.doesNotMatch(b.log, /assets\/fonts/); }
});
test('có mạng: bản mới = bản ' + BASE + ' từng khung (cùng font Google Fonts, assets/fonts không được dùng)', async (t) => {
  try { const r = await fetch('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@800', { headers: { 'user-agent': 'es-render' } }); if (!r.ok) throw new Error('HTTP ' + r.status); } catch (e) { t.skip('không có mạng: ' + e.message); return; }
  if (!baseEngine) { t.skip('không có ' + BASE); return; }
  const a = render(path.join(ROOT, 'render.mjs')); const b = render(baseEngine);
  assert.doesNotMatch(a.log, /assets\/fonts/); assert.deepEqual(md5(a.mp4), md5(b.mp4));
});
test.after(() => fs.rmSync(D, { recursive: true, force: true }));
