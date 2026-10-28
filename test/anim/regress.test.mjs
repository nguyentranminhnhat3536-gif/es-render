// T5: job KHÔNG có anim dựng ra như trước thay đổi, so render.mjs của BASE_REF với render.mjs hiện tại, cùng máy.
//   - fixture tái lập được (bit-exact khi dựng lại): framemd5 (khung đã giải mã) phải trùng hoàn toàn + result.json trùng
//     (trừ render_seconds).
//   - job không tái lập được ngay cả trước thay đổi (html có CSS @keyframes transform bên trong hộp mà render.mjs cũng biến đổi —
//     "animation" pop + keyframes x/y — Chromium khử răng cưa vài cạnh khác nhau giữa các lần dựng): dựng base 2 lần để đo nhiễu
//     của máy; base-vs-mới phải nằm trong cùng mức nhiễu.
// BASE_REF mặc định: HEAD khi render.mjs còn sửa chưa commit, nếu không thì commit ngay trước commit thêm anim.mjs (không phải
// origin/main: main thiếu thay đổi màu BT.709 của footage mà fixture video đi qua).
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/anim/regress.test.mjs
//   REGRESS_JOBS=a.json,b.json  thêm job có sẵn (không giọng/phụ đề cần mạng; so theo chế độ nhiễu)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { REPO, tmpDir } from './lib.mjs';

const D = tmpDir('regress');
const git = (...a) => execFileSync('git', ['-C', REPO, ...a]).toString().trim();
function baseRef() {
  if (process.env.BASE_REF) return process.env.BASE_REF;
  if (git('status', '--porcelain', '--', 'render.mjs')) return 'HEAD';
  const add = git('log', '--diff-filter=A', '--format=%H', '--', 'anim.mjs').split('\n').filter(Boolean).pop();
  return add ? add + '^' : 'HEAD';
}
const BASE = baseRef(); const baseDir = path.join(D, 'base');
before(() => {
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(path.join(baseDir, 'render.mjs'), git('show', BASE + ':render.mjs') + '\n');
  // render.mjs tìm thư viện cạnh chính nó (node_modules/…) và tts.py
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(baseDir, 'node_modules'));
  fs.symlinkSync(path.join(REPO, 'tts.py'), path.join(baseDir, 'tts.py'));
});
const ENGINE = { base: () => path.join(baseDir, 'render.mjs'), new: () => path.join(REPO, 'render.mjs') };
let runN = 0;
function render(which, job) {
  const out = path.join(D, path.basename(job, '.json') + '-' + which + '-' + runN++); const id = path.basename(job, '.json');
  return new Promise((res, rej) => {
    let log = ''; const p = spawn(process.execPath, [ENGINE[which](), job, out], { cwd: path.dirname(job), env: { ...process.env, RENDER_FPS: '30', RENDER_CONCURRENCY: '3' } });
    p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
    p.on('close', (c) => (c === 0 ? res({ mp4: path.join(out, id + '.mp4'), result: path.join(out, id + '.result.json'), log }) : rej(new Error(which + ' exit ' + c + '\n' + log.slice(-3000)))));
  });
}
const md5 = (mp4) => execFileSync('ffmpeg', ['-v', 'error', '-i', mp4, '-map', '0:v:0', '-f', 'framemd5', '-'], { maxBuffer: 1 << 26 }).toString().split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop().trim());
// khung theo khung ở 1/4 kích thước (area): số khung bit-exact, mean diff của khung tệ nhất, chênh kênh lớn nhất
function stats(a, b) {
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', a]).toString().trim().split(',').map((v) => Math.round(Number(v) / 4));
  const raw = (f) => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-vf', 'scale=' + w + ':' + h + ':flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  const ma = md5(a); const mb = md5(b); const ra = raw(a); const rb = raw(b); const n = w * h * 3; let worst = 0; let at = -1; let mx = 0;
  for (let f = 0; (f + 1) * n <= Math.min(ra.length, rb.length); f++) { let s = 0; for (let i = f * n; i < (f + 1) * n; i++) { const d = Math.abs(ra[i] - rb[i]); s += d; if (d > mx) mx = d; } if (s / n > worst) { worst = s / n; at = f; } }
  return { frames: ma.length, sameCount: ma.length === mb.length, identical: ma.filter((x, i) => x === mb[i]).length, worstMad: +worst.toFixed(4), worstFrame: at, max: mx };
}
const resultOf = (f) => { const r = JSON.parse(fs.readFileSync(f, 'utf8')); delete r.render_seconds; return r; };
const noAnimLog = (log) => assert.ok(!/^\d\d:\d\d:\d\d anim /m.test(log), 'no anim code path may run for a job without anim elements');

async function strict(t, job) {
  const a = await render('base', job); const b = await render('new', job);
  const ha = md5(a.mp4); const hb = md5(b.mp4); const first = ha.findIndex((h, i) => h !== hb[i]);
  if (first >= 0 || ha.length !== hb.length) {
    const a2 = await render('base', job); const reproducible = md5(a2.mp4).every((h, i) => h === ha[i]);
    for (const [r, name] of [[a, 'base'], [b, 'new']]) try { execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', r.mp4, '-vf', 'select=eq(n\\,' + Math.max(0, first) + ')', '-fps_mode', 'passthrough', '-frames:v', '1', path.join(D, 'diff-' + name + '.png')]); } catch (x) { /* */ }
    assert.fail('first differing frame ' + first + ' of ' + ha.length + '/' + hb.length + ' (PNGs in ' + D + '); base rendered again is ' + (reproducible ? 'identical to base → real change' : 'different too → this machine is not reproducible for this job'));
  }
  assert.deepEqual(resultOf(b.result), resultOf(a.result)); noAnimLog(b.log);
  t.diagnostic(ha.length + ' frames pixel-identical (framemd5), result.json identical; base ' + BASE);
}
async function noiseAware(t, job) {
  const a = await render('base', job); const b = await render('new', job);
  if (md5(a.mp4).join() === md5(b.mp4).join()) { assert.deepEqual(resultOf(b.result), resultOf(a.result)); noAnimLog(b.log); t.diagnostic('pixel-identical (framemd5); base ' + BASE); return; }
  const a2 = await render('base', job);
  const noise = stats(a.mp4, a2.mp4); const diff = stats(a.mp4, b.mp4);
  assert.ok(diff.sameCount && diff.frames === noise.frames);
  // nhiễu khử răng cưa: mean diff khung tệ nhất ≤ 2× nhiễu base-vs-base (tối thiểu 0.5), chênh kênh ≤ 2× (tối thiểu 48)
  assert.ok(diff.worstMad <= Math.max(0.5, 2 * noise.worstMad) && diff.max <= Math.max(48, 2 * noise.max), 'base vs new ' + JSON.stringify(diff) + ' outside base vs base noise ' + JSON.stringify(noise));
  assert.deepEqual(resultOf(b.result), resultOf(a.result)); noAnimLog(b.log);
  t.diagnostic('base vs base: ' + JSON.stringify(noise) + ' | base vs new: ' + JSON.stringify(diff) + '; base ' + BASE);
}

const svg = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="90" fill="#ff5a7a"/><rect x="60" y="60" width="80" height="80" fill="#2350ff"/></svg>');
const CSS = '<style>@keyframes wob{0%{transform:translateX(0) rotate(0)}100%{transform:translateX(120px) rotate(40deg)}}.w{width:160px;height:160px;background:#ffc53d;border-radius:24px;animation:wob 1.2s ease-in-out infinite alternate}</style><div class="w"></div>';
const POP = '<div style="width:200px;height:120px;background:#2350ff;border-radius:20px;color:#fff;font:700 40px sans-serif;display:flex;align-items:center;justify-content:center">pop</div>';
const GS = '<div id="g" style="font:800 64px sans-serif;color:#F6EECD;padding:40px">GSAP <span id="s" style="display:inline-block">ES</span></div><script>const tl=gsap.timeline({paused:true});tl.from("#g",{x:-300,opacity:0,duration:.6,ease:"back.out(2)"}).to("#s",{rotation:360,scale:1.4,duration:.8},.4);ES.onSeek.push((t)=>tl.seek(t));</script>';
function fixture(name, scene1) {
  const vid = path.join(D, 'clip.mp4');
  if (!fs.existsSync(vid)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '2', '-pix_fmt', 'yuv420p', vid]);
  const job = { width: 540, height: 960, creative: { level: 'bold', seed: 'regress' }, scenes: [
    { comment: 's01 hook', duration: 1.5, 'background-color': '#14142B', elements: scene1 },
    { comment: 's02 item', duration: 1.5, 'background-color': '#0B0510', transition: { style: 'fade', duration: 0.3 }, elements: [{ type: 'html', libs: ['gsap'], x: 0, y: 200, width: 540, height: 400, html: GS }] },
    { comment: 's03 feature', duration: 1.5, 'background-color': '#204020', transition: { style: 'smoothleft', duration: 0.3 }, elements: [{ type: 'video', src: vid, fit: 'contain', x: 0, y: 300, width: 540, height: 360, muted: true }] }] };
  const f = path.join(D, name + '.json'); fs.writeFileSync(f, JSON.stringify(job)); return f;
}

test('T5 regression (strict): a job with no anim renders pixel-identical frames and an identical result.json', async (t) => {
  // html với CSS @keyframes; html với animation pop + keyframes x/y; ảnh data: SVG; html GSAP + ES.onSeek; video fit contain;
  // camera + chuyển cảnh fade / smoothleft có seed
  await strict(t, fixture('regress', [
    { type: 'html', html: CSS, x: 40, y: 100, width: 400, height: 260 },
    { type: 'html', html: POP, x: 60, y: 400, width: 200, height: 120, animation: 'pop', keyframes: [{ time: 0, x: 60, y: 400 }, { time: 1.4, x: 280, y: 420, easing: 'ease-out-back' }] },
    { type: 'image', src: svg, x: 170, y: 560, width: 200, height: 200, 'fade-in': 0.3 }]));
});

test('T5 regression (noise-aware): CSS transform animation inside a box render.mjs also transforms (not reproducible even before)', async (t) => {
  await noiseAware(t, fixture('regress-noisy', [
    { type: 'html', html: CSS, x: 60, y: 120, width: 400, height: 260, animation: 'pop', keyframes: [{ time: 0, x: 60, y: 120 }, { time: 1.4, x: 100, y: 300, easing: 'ease-out-back' }] },
    { type: 'image', src: svg, x: 170, y: 560, width: 200, height: 200, 'fade-in': 0.3 }]));
});

for (const [i, j] of (process.env.REGRESS_JOBS || '').split(',').filter(Boolean).entries()) {
  test('T5 regression on an existing job: ' + path.basename(j), async (t) => {
    const dst = path.join(D, 'job' + i); fs.mkdirSync(dst, { recursive: true }); const f = path.join(dst, path.basename(j)); fs.copyFileSync(path.resolve(j), f);
    await noiseAware(t, f);
  });
}
