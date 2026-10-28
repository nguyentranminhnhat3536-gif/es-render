// Tuỳ chọn mới qua render.mjs: "contract" của phần tử anim (seek / render / renderFrame), loudnorm 2 lượt, thông số ducking nhạc.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/libs/opt.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EX, render, md5, tmpDir } from './lib.mjs';
const D = tmpDir('opt');
test('anim "contract": seek / render / renderFrame pages render through the shim, all moving, twice the same', async () => {
  const movie = JSON.parse(fs.readFileSync(EX('anim-contracts', 'anim-contracts.json'), 'utf8')); movie.width = 540; movie.height = 960;
  movie.scenes[0].duration = 1; movie.scenes[0].elements.forEach((e, i) => Object.assign(e, { src: EX('anim-contracts', e.src), x: 110, y: i * 320, width: 320, height: 320 }));
  const [a, b] = await Promise.all([render(D, 'c1', movie), render(D, 'c2', movie)]);
  assert.equal(a.code, 0, a.log); assert.deepEqual(a.result.anims.map((x) => x.ok), [true, true, true]); assert.deepEqual(a.result.anims.map((x) => x.dur), [4, 4, 4]);
  assert.ok(a.result.anims.every((x) => !x.warnings.some((w) => /W_FIXED_LAYOUT|W_ASPECT/.test(w))), 'canvas size read from <canvas width height>');
  const h = md5(a.mp4); assert.deepEqual(md5(b.mp4), h); assert.ok(new Set(h).size >= 25);
  // không có "contract" → trang không theo hợp đồng anim báo lỗi như trước (không data-ready / không window.anim)
  const bad = JSON.parse(JSON.stringify(movie)); delete bad.scenes[0].elements[0].contract; bad.scenes[0].elements = [{ ...bad.scenes[0].elements[0], timeout: 2 }];
  const c = await render(D, 'c3', bad); assert.notEqual(c.code, 0); assert.match(c.result.message, /E_ANIM_NOT_READY|E_ANIM_NO_CONTRACT/);
});
function media() {
  const vid = path.join(D, 'talk.mp4'); const mus = path.join(D, 'music.wav');
  if (!fs.existsSync(vid)) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=#203040:size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3,volume=0.5', '-t', '3', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', vid]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=d=4:c=pink:a=0.3', mus]);
  }
  return { vid, mus };
}
const movie = (audio, duck) => { const { vid, mus } = media(); return { width: 320, height: 180, creative: 'off', ...(audio ? { audio } : {}), elements: [{ type: 'audio', src: mus, volume: 0.5, ...(duck ? { duck } : {}) }],
  scenes: [{ duration: 3, elements: [{ type: 'video', src: vid, x: 0, y: 0, width: 320, height: 180 }] }] }; };
function ebu(mp4) { const p = execFileSync('sh', ['-c', 'ffmpeg -hide_banner -nostats -i "' + mp4 + '" -af ebur128 -f null - 2>&1 | grep -E "^\\s+I:" | tail -1']).toString(); return Number((p.match(/(-?[\d.]+) LUFS/) || [])[1]); }
test('movie.audio.loudnorm "2pass": measures then normalises linearly; default stays one pass', async () => {
  const [a, b] = await Promise.all([render(D, 'l1', movie(null)), render(D, 'l2', movie({ loudnorm: '2pass' }))]);
  assert.equal(a.code, 0, a.log); assert.equal(b.code, 0, b.log);
  assert.ok(!/loudnorm 2pass/.test(a.log)); assert.match(b.log, /loudnorm 2pass: đo -?[\d.]+ LUFS/);
  assert.ok(!/measured_I/.test(fs.readFileSync(path.join(a.work, 'af.txt'), 'utf8'))); assert.match(fs.readFileSync(path.join(b.work, 'af.txt'), 'utf8'), /measured_I=-?[\d.]+:.*linear=true/);
  const L = ebu(b.mp4); assert.ok(Math.abs(L - -14) < 1.5, '2-pass integrated loudness ' + L);
});
test('music.duck: custom threshold / ratio / release and voice_band filter only the sidechain key; default graph unchanged', async () => {
  const [a, b] = await Promise.all([render(D, 'd1', movie(null)), render(D, 'd2', movie(null, { threshold: 0.05, ratio: 8, release: 250, voice_band: true }))]);
  const fa = fs.readFileSync(path.join(a.work, 'af.txt'), 'utf8'); const fb = fs.readFileSync(path.join(b.work, 'af.txt'), 'utf8');
  assert.match(fa, /\[vox\]asplit=2\[voxm\]\[voxk\];\[mus0\]\[voxk\]sidechaincompress=threshold=0\.025:ratio=4:attack=20:release=400\[mus\]/);
  assert.match(fb, /\[vox\]asplit=2\[voxm\]\[voxk0\];\[voxk0\]highpass=f=120,lowpass=f=6000\[voxk\];\[mus0\]\[voxk\]sidechaincompress=threshold=0\.05:ratio=8:attack=20:release=250\[mus\]/);
  assert.equal(b.code, 0, b.log);
});
