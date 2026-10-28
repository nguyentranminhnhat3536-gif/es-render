// T4: end-to-end qua `node render.mjs` (RENDER_CONCURRENCY=3 như CI) + so với chính renderer của motion2code (render_anim.py /
// frame_diff.py), và các chế độ hỏng qua dòng lệnh (hết giờ, trang treo, "on-error": "hide"). Không mạng (trang hermetic).
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/anim/render.test.mjs      (~2 phút)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import http from 'node:http';
import { REPO, GSAP_DIR, NET, SAMPLE, variants, mini, launch, refShots, rgb, mad, tmpDir } from './lib.mjs';

const FPS = 30; const W = 960; const H = 540;
const D = tmpDir('e2e');
const page = (name, src) => { fs.writeFileSync(path.join(D, name), src); return name; };
function render(name, movie, env = {}) {
  const job = path.join(D, name + '.json'); fs.writeFileSync(job, JSON.stringify(movie));
  const out = path.join(D, 'out-' + name); fs.rmSync(out, { recursive: true, force: true });
  return new Promise((res) => {
    const t0 = Date.now(); let log = '';
    const p = spawn(process.execPath, [path.join(REPO, 'render.mjs'), job, out], { cwd: D, env: { ...process.env, RENDER_FPS: String(FPS), RENDER_CONCURRENCY: '3', ...env } });
    p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
    p.on('close', (code) => { let result = null; try { result = JSON.parse(fs.readFileSync(path.join(out, name + '.result.json'), 'utf8')); } catch (x) { /* */ }
      res({ code, ms: Date.now() - t0, log, result, mp4: path.join(out, name + '.mp4') }); });
  });
}
// khung số idx của mp4 → RGB thô (cắt rồi thu nhỏ bằng area, như _m2c.py)
function frames(mp4, idxs, { crop = null, w = W, h = H } = {}) {
  const sel = 'select=' + idxs.map((i) => 'eq(n\\,' + i + ')').join('+');
  // RGB trước khi cắt: crop trên yuv420p làm tròn toạ độ lẻ (y 135 → 134)
  const vf = [sel, 'format=rgb24', crop ? 'crop=' + crop.join(':') : null, 'scale=' + w + ':' + h + ':flags=area'].filter(Boolean).join(',');
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', mp4, '-vf', vf, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1 << 28 });
  const n = w * h * 3; const out = {}; [...idxs].sort((a, b) => a - b).forEach((i, k) => { out[i] = buf.subarray(k * n, (k + 1) * n); }); return out;
}
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const pix = (buf, w, x, y) => { const i = (y * w + x) * 3; return [buf[i], buf[i + 1], buf[i + 2]]; };
const wrap = (t) => Math.round((((t % 5) + 5) % 5) * 1e6) / 1e6;
const chromeCount = () => { const r = spawnSync('pgrep', ['-fc', 'headless_shell|chrome-linux'], { encoding: 'utf8' }); return Number(r.stdout.trim() || 0); };
// Chromium killed by render.mjs's exit takes a moment to disappear: poll instead of sampling once
async function settles(before, ms = 8000) { const t0 = Date.now(); while (chromeCount() > before && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 250)); return chromeCount() - before; }

const herm = variants.herm();
let REF = {}; let REF_BOX = {};
const PT = [0, 0.5, 1.5, 4.0, 4.5, 0.5, 3.2];
const TIMES = [...new Set(PT.flatMap((t) => [wrap(t - 1 / FPS), t, wrap(t + 1 / FPS)]).concat([2.6, 3.1667, 3.2333]))];
before(async () => {
  page('seek-loop.html', herm); fs.copyFileSync(path.join(GSAP_DIR, 'gsap.min.js'), path.join(D, 'gsap.min.js'));
  const b = await launch(); const rd = tmpDir('ref'); REF = await refShots(b, rd, TIMES, { W, H }); REF_BOX = await refShots(b, rd, TIMES, { W: 480, H: 270 }); await b.close();
});
const bestOf = (img, refs, t, size) => { const c = [wrap(t - 1 / FPS), t, wrap(t + 1 / FPS)].map((x) => [x, mad(img, rgb(refs[x], size[0], size[1]))]); return c.sort((a, b) => a[1] - b[1])[0]; };

const MAIN = {
  width: W, height: H, creative: 'off',
  scenes: [
    { comment: 's01 hook', duration: 2, 'background-color': '#14142B', elements: [{ type: 'anim', src: 'seek-loop.html' }] },
    { comment: 's02 item', duration: 3, elements: [
      { type: 'html', html: '<div style="width:960px;height:540px;background:#204020"></div>', x: 0, y: 0, width: 960, height: 540 },
      { type: 'anim', src: 'seek-loop.html', x: 0, y: 135, width: 480, height: 270, start: 0.5, seek: 4.0, duration: 2.5, 'z-index': 1 },
      { type: 'anim', src: 'seek-loop.html', x: 480, y: 135, width: 480, height: 270, background: 'transparent', hide: ['#bg'], 'z-index': 1 }] },
    { comment: 's03 end', duration: 2, 'background-color': '#14142B', elements: [{ type: 'motion2code', src: 'seek-loop.html', loop: false, seek: 2.6, until: 3.2, duration: 5 }] }] };
// dựng một lần, dùng chung: các test sau gọi mainJob() nên chạy riêng lẻ được (--test-name-pattern)
let mainP;
const mainJob = () => (mainP ||= render('anim-e2e', MAIN));

test('T4 main job (3 scenes, 4 anim elements, RENDER_CONCURRENCY=3): done, report, frame-exact, wrap, transparency, until hold', async (t) => {
  const main = await mainJob();
  assert.equal(main.code, 0, main.log.slice(-3000)); assert.equal(main.result.status, 'done');
  const A = main.result.anims; assert.equal(A.length, 4, JSON.stringify(A));
  for (const a of A) { assert.equal(a.ok, true); assert.equal(a.dur, 5); assert.deepEqual(a.stage, [1920, 1080]); assert.deepEqual(a.gsap, { page: '3.12.5', used: '3.15.0' }); }
  assert.deepEqual(A.map((a) => a.scene + a.el), ['1e0', '2e1', '2e2', '3e0']);
  // 1. cả khung: cảnh 1 khung 0, 15, 45 → giây trang 0, 0.5, 1.5
  const f1 = frames(main.mp4, [0, 15, 45]); const f1s = frames(main.mp4, [0, 15, 45], { w: 192, h: 108 }); const rows = [];
  for (const [i, pt] of [[0, 0], [15, 0.5], [45, 1.5]]) {
    const d = mad(f1s[i], rgb(REF[pt])); const best = bestOf(f1[i], REF, pt, [W, H]); rows.push('f' + i + ' pt ' + pt + ' mad ' + d.toFixed(2) + ' best ' + best[0]);
    assert.ok(d <= 3.0, 'frame ' + i + ' mad ' + d); assert.equal(best[0], pt, 'frame ' + i + ' best match ' + best[0]);
  }
  // 2. hộp A (start 0.5, seek 4.0): khung 15, 30, 45, 60 của cảnh 2 → 4.0, 4.5, 0.0 (quấn), 0.5
  const idx = [75, 90, 105, 120]; const fa = frames(main.mp4, idx, { crop: [480, 270, 0, 135], w: 480, h: 270 }); const fas = frames(main.mp4, idx, { crop: [480, 270, 0, 135], w: 192, h: 108 });
  for (const [i, pt] of [[75, 4.0], [90, 4.5], [105, 0], [120, 0.5]]) {
    const d = mad(fas[i], rgb(REF_BOX[pt])); const best = bestOf(fa[i], REF_BOX, pt, [480, 270]); rows.push('A' + i + ' pt ' + pt + ' mad ' + d.toFixed(2) + ' best ' + best[0]);
    assert.ok(d <= 3.0, 'box A frame ' + i + ' mad ' + d); assert.equal(best[0], pt, 'box A frame ' + i + ' best ' + best[0]);
  }
  // 3. hộp B trong suốt + hide #bg: chỗ chỉ có nền trang → thấy nền cảnh #204020
  const fb = frames(main.mp4, [90]); const p = pix(fb[90], W, 490, 145); rows.push('B px ' + p);
  assert.ok(near(p, [0x20, 0x40, 0x20], 6), 'transparent box pixel ' + p);
  // 4. until: loop false, seek 2.6, until 3.2 → đứng từ giây 0.6 của cảnh 3; dùng lại JPEG (shots < frames), khung đứng = trang ở 3.2
  const m = main.log.match(/scene 3\/3 [\d.]+s (\d+) frames, (\d+) shots/); assert.ok(m, main.log);
  assert.ok(Number(m[2]) <= 20 && Number(m[2]) < Number(m[1]), 'scene 3 shots ' + m[2] + ' / ' + m[1]);
  const hold = frames(main.mp4, [170, 185, 209]); assert.ok(mad(hold[170], hold[209]) < 0.2 && mad(hold[185], hold[209]) < 0.2);
  const best = bestOf(hold[185], REF, 3.2, [W, H]); assert.equal(best[0], 3.2); rows.push('hold best ' + best[0] + ' shots ' + m[2] + '/' + m[1]);
  t.diagnostic(main.ms + ' ms; ' + rows.join(' | '));
});

test('T4 motion2code render_anim.py / frame_diff.py agree with es-render (≤ 3.0)', { skip: spawnSync('uv', ['--version']).status !== 0 && 'uv missing' }, async (t) => {
  const main = await mainJob(); assert.ok(main.code === 0, 'main job must have rendered');
  const ref = path.join(D, 'ref'); fs.mkdirSync(ref, { recursive: true }); fs.writeFileSync(path.join(ref, 'seek-loop.html'), variants.ref()); fs.copyFileSync(path.join(GSAP_DIR, 'gsap.min.js'), path.join(ref, 'gsap.min.js'));
  const py = (script, args) => spawnSync('uv', ['run', '--no-project', '--with', 'playwright==1.56.0', 'python', '-B', path.join(REPO, '.claude/skills/motion2code/scripts', script), ...args], { encoding: 'utf8', timeout: 300000 });
  const r1 = py('render_anim.py', [path.join(ref, 'seek-loop.html'), '--png', '0', '0.5', '1.5', '--frames-dir', path.join(ref, 'm2c'), '--size', '960x540']);
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  for (const pt of [0, 0.5, 1.5]) { const f = path.join(ref, 'm2c', 'code_t' + pt.toFixed(3).padStart(7, '0') + '.png'); assert.ok(mad(rgb(fs.readFileSync(f)), rgb(REF[pt])) < 0.5, 'render_anim.py vs es-render reference at ' + pt); }
  const diff = path.join(D, 'diff');
  const r2 = py('frame_diff.py', [main.mp4, path.join(ref, 'seek-loop.html'), '--at', '0', '0.5', '1.5', '--size', '960x540', '-o', diff]);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  const rows = JSON.parse(fs.readFileSync(path.join(diff, 'diff.json'), 'utf8')).rows;
  for (const r of rows) assert.ok(r.diff <= 3.0, JSON.stringify(r));
  t.diagnostic('frame_diff.py rows: ' + rows.map((r) => r.t + '→' + r.diff).join(' '));
});

test('T4 GSAP drift: es-render (local 3.15.0) vs the unmodified page (CDN 3.12.5)', { skip: !NET && 'set ANIM_NET=1 (needs cdnjs)' }, async (t) => {
  const main = await mainJob(); assert.ok(main.code === 0, 'main job must have rendered');
  const ref = path.join(D, 'ref-cdn'); fs.mkdirSync(ref, { recursive: true }); fs.writeFileSync(path.join(ref, 'seek-loop.html'), SAMPLE);
  const r = spawnSync('uv', ['run', '--no-project', '--with', 'playwright==1.56.0', 'python', '-B', path.join(REPO, '.claude/skills/motion2code/scripts/frame_diff.py'), main.mp4, path.join(ref, 'seek-loop.html'), '--at', '0', '0.5', '1.5', '--size', '960x540', '-o', path.join(D, 'diff-cdn')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rows = JSON.parse(fs.readFileSync(path.join(D, 'diff-cdn', 'diff.json'), 'utf8')).rows; for (const x of rows) assert.ok(x.diff <= 3.0, JSON.stringify(x));
  t.diagnostic(rows.map((x) => x.t + '→' + x.diff).join(' '));
});

const ONE = (src, extra = {}, bg = '#336699') => ({ width: W, height: H, creative: 'off', scenes: [{ comment: 's01 hook', duration: 1, 'background-color': bg, elements: [{ type: 'anim', src, ...extra }] }] });

test('T4 gate timeout through the CLI: preflight error names scene, element, page, reason; "hide" renders the background', async (t) => {
  page('seek-loop-never.html', variants.never());
  const a = await render('never', ONE('seek-loop-never.html', { timeout: 2 }));
  assert.equal(a.code, 1); assert.ok(a.ms < 15000, a.ms + ' ms'); assert.equal(a.result.status, 'error');
  for (const s of ['E_ANIM_NOT_READY', 'scene 1', 'element e0', 'seek-loop-never.html', '2 s']) assert.ok(a.result.message.includes(s), s + ' in ' + a.result.message);
  assert.ok(!/scene 1\/1/.test(a.log), 'no frame was rendered (error came from the preflight)');
  const b = await render('never-hide', ONE('seek-loop-never.html', { timeout: 2, 'on-error': 'hide' }));
  assert.equal(b.code, 0, b.log.slice(-2000)); assert.equal(b.result.anims[0].fallback, 'hide'); assert.equal(b.result.anims[0].ok, false);
  const f = frames(b.mp4, [0], { w: 192, h: 108 }); assert.ok(near(pix(f[0], 192, 96, 54), [0x33, 0x66, 0x99], 6), 'background ' + pix(f[0], 192, 96, 54));
  t.diagnostic('fail ' + a.ms + ' ms: ' + a.result.message);
});

test('T4 slow page through the CLI: frame 0 is the page at t = 0, not half-built', async () => {
  page('seek-loop-slow.html', variants.slow());
  const r = await render('slow', { ...ONE('seek-loop-slow.html'), scenes: [{ duration: 1, 'background-color': '#14142B', elements: [{ type: 'anim', src: 'seek-loop-slow.html' }] }] });
  assert.equal(r.code, 0, r.log.slice(-2000));
  const f = frames(r.mp4, [0]); assert.equal(bestOf(f[0], REF, 0, [W, H])[0], 0); assert.ok(mad(frames(r.mp4, [0], { w: 192, h: 108 })[0], rgb(REF[0])) <= 3.0);
});

test('T4 hung pages: boot loop and seek loop at t > 1 fail fast with E_ANIM_HUNG (preflight), no Chromium left; "hide" renders', async (t) => {
  page('seek-loop-forever.html', variants.forever()); page('seek-loop-seekhang.html', variants.seekhang());
  const before = chromeCount();
  const a = await render('forever', ONE('seek-loop-forever.html', { timeout: 2 }));
  assert.equal(a.code, 1); assert.ok(a.ms < 30000, a.ms + ' ms'); assert.match(a.result.message, /E_ANIM_HUNG/);
  const left = await settles(before); assert.ok(left <= 0, 'Chromium processes left: ' + left);
  const b = await render('seekhang', ONE('seek-loop-seekhang.html', { timeout: 2 }));
  assert.equal(b.code, 1); assert.match(b.result.message, /E_ANIM_HUNG: preflight anim\.seek\(1\.250\)/); assert.ok(!/scene 1\/1/.test(b.log));
  const c = await render('forever-hide', ONE('seek-loop-forever.html', { timeout: 2, 'on-error': 'hide' }));
  assert.equal(c.code, 0, c.log.slice(-2000)); assert.equal(c.result.anims[0].fallback, 'hide');
  t.diagnostic('forever ' + a.ms + ' ms: ' + a.result.message + ' | seekhang ' + b.ms + ' ms | hide ' + c.ms + ' ms');
});

test('T4 validation errors arrive before any browser work, all at once', async () => {
  const r = await render('bad', { width: W, height: H, elements: [{ type: 'anim', src: 'x.html' }], scenes: [{ duration: 1, elements: [{ type: 'anim', src: 'https://x/y.html' }, { type: 'anim', src: 'seek-loop.html', speed: 0, fit: 'fill' }, { type: 'anim', src: 'missing.html' }] }] });
  assert.equal(r.code, 1); const m = r.result.message;
  for (const s of ['E_ANIM_PLACEMENT', 'element e0: E_ANIM_SRC_REMOTE', 'element e1: E_ANIM_FIELD: speed', 'element e1: E_ANIM_FIELD: fit', 'element e2: E_ANIM_SRC_NOT_FOUND']) assert.ok(m.includes(s), s + ' in ' + m);
  assert.ok(r.ms < 5000, r.ms + ' ms');
});

test('T4 page that hangs mid-scene (at a time the preflight probes miss): the per-frame watchdog fails the job with E_ANIM_HUNG', async (t) => {
  // probes at 0, 1.25, 2.5, 3.75, 4.967 s; the page spins only for 2.0 ≤ t < 2.1 → caught at frame 60 by the 30 s watchdog
  page('seek-loop-midhang.html', herm.replace('seek(t) { t = clamp(t, 0, DUR);', 'seek(t) { if (t >= 2.0 && t < 2.1) for (;;) {} t = clamp(t, 0, DUR);'));
  const before = chromeCount();
  const r = await render('midhang', { ...ONE('seek-loop-midhang.html', { 'on-error': 'hide' }), scenes: [{ comment: 's01 hook', duration: 3, elements: [{ type: 'anim', src: 'seek-loop-midhang.html', 'on-error': 'hide' }] }] });
  assert.equal(r.code, 1); assert.ok(r.ms < 60000, r.ms + ' ms');
  assert.match(r.result.message, /^anim: scene 1 \("s01 hook"\): E_ANIM_HUNG: frame 60 did not answer within 30 s/);
  const left = await settles(before); assert.ok(left <= 0, 'Chromium processes left: ' + left);
  t.diagnostic(r.ms + ' ms: ' + r.result.message);
});

test('T4 sticky "hide": a page host that stalls after the preflight costs one timeout, later scenes drop the element', async (t) => {
  let n = 0; const srv = http.createServer((q, res) => { n++; if (n === 1) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end("document.documentElement.dataset.ready='1'"); } });
  await new Promise((x) => srv.listen(0, '127.0.0.1', x));
  // data-ready comes from a script added after load (does not hold the load event): 1st request answers (preflight), later ones stall
  page('stall.html', mini({ ready: "addEventListener('load',()=>{const s=document.createElement('script');s.src='http://127.0.0.1:" + srv.address().port + "/boot.js';document.head.appendChild(s)});" }));
  const el = { type: 'anim', src: 'stall.html', timeout: 2, 'on-error': 'hide' };
  const r = await render('stall', { width: W, height: H, creative: 'off', scenes: [1, 2, 3].map((i) => ({ comment: 's0' + i + ' item', duration: 1, 'background-color': '#336699', elements: [{ ...el }] })) }, { RENDER_CONCURRENCY: '1' });
  srv.closeAllConnections?.(); srv.close();
  assert.equal(r.code, 0, r.log.slice(-2000)); assert.equal(n, 2, 'requests: preflight + scene 1 only');
  const A = r.result.anims; assert.equal(A.length, 3); assert.ok(A.every((a) => a.fallback === 'hide' && !a.ok));
  assert.match(A[0].problems[0], /^E_ANIM_NOT_READY: <html data-ready="1"> not set within 2 s/); assert.equal((r.log.match(/→ hidden/g) || []).length, 1);
  t.diagnostic(r.ms + ' ms, ' + n + ' page requests; ' + JSON.stringify(A.map((a) => a.scene + a.el + ':' + a.fallback)));
});
