// T1: phần thuần của anim.mjs (không trình duyệt), T6: trang mẫu qua check_anim.py của motion2code.
//   node --test test/anim/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ANIM, REPO, VCLOCK, FLAGS, GSAP_DIR, SAMPLE, SAMPLE_FILE, tmpDir } from './lib.mjs';

const m = (o = {}) => ({ seek: 0, speed: 1, loop: true, dur: 0, until: 0, ...o });
const codes = (r) => r.errors.map((x) => x.code);
const wcodes = (r) => r.warnings.map((x) => x.code);

test('mapTime: design table, holds, wrap and float noise', () => {
  const T = [[0, {}, 0], [6, { dur: 5 }, 1], [7.5, { dur: 5 }, 2.5], [5, { dur: 5 }, 0], [2, { seek: 4, dur: 5 }, 1], [9, { loop: false, dur: 5 }, 5],
    [1, { speed: 2, seek: 1, dur: 5 }, 3], [-1, { dur: 5 }, 0], [4.999999999, { dur: 5 }, 0], [9, { loop: false, dur: 5, until: 3.2 }, 3.2], [7.2, { dur: 2.4 }, 0],
    [2, { loop: false, dur: 5 }, 2], [2, { loop: false, dur: 5, until: 3.2 }, 2], [4, { speed: 0.5, dur: 5 }, 2], [1, { seek: 12, dur: 5 }, 3], [3, { loop: false, seek: 4, dur: 5, until: 4.5 }, 4.5]];
  for (const [lt, o, want] of T) assert.equal(ANIM.mapTime(lt, m(o)), want, JSON.stringify([lt, o]));
  // dur chưa biết → không quấn
  assert.equal(ANIM.mapTime(7, m()), 7);
});

test('validate: one case per error code, warnings, clean example', () => {
  const ok = { type: 'anim', src: 'a.html' };
  assert.deepEqual(codes(ANIM.validate(ok)), []);
  assert.deepEqual(codes(ANIM.validate({ type: 'anim' })), ['E_ANIM_SRC_MISSING']);
  assert.deepEqual(codes(ANIM.validate({ type: 'anim', src: 'a.html', html: '<p>' })), ['E_ANIM_SRC_MISSING']);
  for (const u of ['https://x.com/a.html', 'http://x/a.html', 'data:text/html,<p>', '//cdn/x.html']) assert.deepEqual(codes(ANIM.validate({ type: 'anim', src: u })), ['E_ANIM_SRC_REMOTE'], u);
  const F = (o) => codes(ANIM.validate({ ...ok, ...o }));
  for (const o of [{ start: 'x' }, { duration: 0 }, { duration: -2 }, { seek: -1 }, { speed: 0 }, { speed: 17 }, { width: 0 }, { height: -5 }, { timeout: 0.5 }, { timeout: 121 },
    { loop: 'yes' }, { fit: 'fill' }, { background: 'black' }, { 'on-error': 'skip' }, { hide: '#bg' }, { hide: ['#bg{x}'] }, { hide: ['a;b'] }, { hide: ['<x>'] }, { hide: [''] }, { hide: ['#x/*'] }, { hide: ['a*/'] },
    { hide: Array.from({ length: 21 }, (_, i) => '#a' + i) }, { x: null, y: 'abc' }, { until: 3 }, { loop: true, until: 3 }, { loop: false, seek: 3, until: 2 }, { loop: false, until: 'z' }])
    assert.deepEqual(F(o), ['E_ANIM_FIELD'], JSON.stringify(o));
  // until > D chỉ kiểm được sau lần chạy thử (ctx.dur)
  assert.deepEqual(codes(ANIM.validate({ ...ok, loop: false, until: 6 })), []);
  assert.deepEqual(codes(ANIM.validate({ ...ok, loop: false, until: 6 }, { dur: 5 })), ['E_ANIM_FIELD']);
  assert.deepEqual(codes(ANIM.validate({ ...ok, loop: false, until: 5 }, { dur: 5 })), []);
  // số dạng chuỗi được nhận như render.mjs
  assert.deepEqual(F({ start: '0.5', speed: '2', width: '960' }), []);
  // cảnh báo
  assert.deepEqual(wcodes(ANIM.validate({ ...ok, volume: 1, muted: true, foo: 1 })), ['W_FIELD', 'W_FIELD', 'W_FIELD']);
  assert.deepEqual(wcodes(ANIM.validate({ ...ok, fit: 'cover', keyframes: [{ time: 0, width: 100 }] })), ['W_COVER_RESIZE']);
  assert.deepEqual(wcodes(ANIM.validate({ ...ok }, { W: 1080, H: 1920, stage: [1920, 1080] })), ['W_ASPECT']);
  assert.deepEqual(wcodes(ANIM.validate({ ...ok, width: 960, height: 540 }, { W: 1080, H: 1920, stage: [1920, 1080] })), []);
  assert.deepEqual(wcodes(ANIM.validate({ ...ok, fit: 'cover' }, { W: 1080, H: 1920, stage: [1920, 1080] })), []);
  // movie.elements
  assert.deepEqual(codes(ANIM.validateMovie({ elements: [{ type: 'audio' }, { type: 'anim', src: 'a.html' }] })), ['E_ANIM_PLACEMENT']);
  assert.match(ANIM.validateMovie({ elements: [{ type: 'motion2code' }] }).errors[0].msg, /movie\.elements\[0\]/);
  // ví dụ trong repo: sạch
  const ex = JSON.parse(fs.readFileSync(path.join(REPO, 'examples', 'anim-hello', 'anim-hello.json'), 'utf8'));
  for (const s of ex.scenes) for (const e of s.elements) if (ANIM.isAnim(e)) assert.deepEqual(codes(ANIM.validate(e, { W: ex.width, H: ex.height })), []);
  assert.deepEqual(codes(ANIM.validateMovie(ex)), []);
});

test('resolveSrc: job dir first, cwd second, file://, absolute, remote, HF route, missing', () => {
  const d = tmpDir('src'); const job = path.join(d, 'jobdir'); const cwd = path.join(d, 'cwd'); fs.mkdirSync(job); fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(job, 'p.html'), 'a'); fs.writeFileSync(path.join(cwd, 'p.html'), 'b'); fs.writeFileSync(path.join(cwd, 'q.html'), 'c'); fs.writeFileSync(path.join(cwd, 'x.svg'), '<svg/>');
  assert.equal(ANIM.resolveSrc('p.html', { jobDir: job, cwd }).file, path.join(job, 'p.html'));
  assert.equal(ANIM.resolveSrc('q.html', { jobDir: job, cwd }).file, path.join(cwd, 'q.html'));
  assert.equal(ANIM.resolveSrc(pathToFileURL(path.join(cwd, 'q.html')).href, { jobDir: job, cwd }).file, path.join(cwd, 'q.html'));
  assert.equal(ANIM.resolveSrc(path.join(cwd, 'q.html'), { jobDir: job, cwd }).file, path.join(cwd, 'q.html'));
  assert.equal(ANIM.resolveSrc('https://x.com/p.html', { jobDir: job, cwd }).error.code, 'E_ANIM_SRC_REMOTE');
  assert.equal(ANIM.resolveSrc('x.svg', { jobDir: job, cwd }).error.code, 'E_ANIM_SRC_TYPE');
  const miss = ANIM.resolveSrc('nope.html', { jobDir: job, cwd }).error;
  assert.equal(miss.code, 'E_ANIM_SRC_NOT_FOUND'); assert.ok(miss.msg.includes(path.join(job, 'nope.html')) && miss.msg.includes(path.join(cwd, 'nope.html')), miss.msg);
  fs.mkdirSync(path.join(d, 'jobs', 'demo', 'deep'), { recursive: true }); fs.writeFileSync(path.join(d, 'jobs', 'demo', 'index.html'), 'x'); fs.writeFileSync(path.join(d, 'jobs', 'demo', 'deep', 'index.html'), 'x');
  const hf = ANIM.resolveSrc('jobs/demo/index.html', { jobDir: path.join(d, 'jobs'), cwd: d, repo: d });
  assert.equal(hf.error.code, 'E_ANIM_SRC_HF_ROUTE'); assert.match(hf.error.msg, /jobs\/demo\/intro\.html/);
  assert.ok(ANIM.resolveSrc('jobs/demo/deep/index.html', { cwd: d, repo: d }).file, 'deeper index.html is fine');
});

test('workCopy: injection order right after the doctype, GSAP rewrite, style block last, source untouched', () => {
  const before = SAMPLE;
  const wc = ANIM.workCopy(SAMPLE, { vclock: VCLOCK, seedTag: '<script>SEED</script>', baseHref: 'file:///src/dir/', gsapDir: GSAP_DIR, gsapVersion: '3.15.0', transparent: true, hide: ['#bg', '.x .y'] });
  assert.equal(SAMPLE, before);
  const h = wc.html;
  assert.ok(h.startsWith('<!doctype html><meta charset="utf-8"><script>window.__esErr=[]'), h.slice(0, 80));
  const order = ['<meta charset="utf-8">', 'window.__esErr', 'window.__esTimers', 'window.__esTick', 'window.Date=D', 'SEED', '<base href="file:///src/dir/">', '<html lang="en">'].map((s) => h.indexOf(s));
  assert.ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), 'order ' + order);
  assert.ok(h.includes('const D0=' + ANIM.EPOCH) && !h.includes('const D0=Date.now()') && wc.epochFrozen);
  assert.ok(h.includes(pathToFileURL(path.join(GSAP_DIR, 'gsap.min.js')).href) && !h.includes('cdnjs.cloudflare.com/ajax/libs/gsap'));
  assert.deepEqual(wc.gsap, { page: '3.12.5', used: '3.15.0' });
  // mỗi selector của hide một <style> riêng: "/*" hay "[" chưa đóng không nuốt luật sau
  assert.ok(h.endsWith('<style data-es-anim>*,*::before,*::after{transition:none!important}html,body{background:transparent!important}</style><style data-es-anim>#bg{display:none!important}</style><style data-es-anim>.x .y{display:none!important}</style>'), h.slice(-200));
  // BOM + chú thích trước doctype; trang không có <html>/<head>; trang không có doctype
  const b = ANIM.workCopy('﻿<!-- hi -->\n<!DOCTYPE html>\n<p>x', { vclock: VCLOCK }).html;
  assert.ok(b.startsWith('﻿<!-- hi -->\n<!DOCTYPE html><meta charset="utf-8">'), JSON.stringify(b.slice(0, 50)));
  assert.ok(ANIM.workCopy('<!doctype html>\n<meta charset="utf-8"><svg></svg>', { vclock: VCLOCK }).html.startsWith('<!doctype html><meta charset="utf-8"><script>'));
  assert.ok(ANIM.workCopy('<html><body>x', { vclock: VCLOCK }).html.startsWith('<meta charset="utf-8"><script>window.__esErr'));
  // jsdelivr + plugin + tệp không có → giữ và báo
  const g = ANIM.workCopy('<!doctype html><script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/MorphSVGPlugin.min.js"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/NoSuchThing.min.js"></script>', { vclock: VCLOCK, gsapDir: GSAP_DIR, gsapVersion: '3.15.0' });
  assert.ok(g.html.includes(pathToFileURL(path.join(GSAP_DIR, 'gsap.min.js')).href) && g.html.includes(pathToFileURL(path.join(GSAP_DIR, 'MorphSVGPlugin.min.js')).href));
  assert.deepEqual(g.kept, ['https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/NoSuchThing.min.js']);
  assert.deepEqual(g.gsap, { page: '3.12.5', used: '3.15.0' });
  // RENDER_ANIM_GSAP=page → gsapDir null: giữ nguyên
  const p = ANIM.workCopy(SAMPLE, { vclock: VCLOCK, gsapDir: null });
  assert.ok(p.html.includes('https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js')); assert.deepEqual(p.kept, []); assert.deepEqual(p.gsap, { page: '3.12.5', used: '3.12.5' });
  // <base> riêng của trang tính theo thư mục nguồn
  assert.ok(ANIM.workCopy('<!doctype html><base href="assets/">', { vclock: VCLOCK, baseHref: 'file:///src/dir/' }).html.includes('<base href="file:///src/dir/assets/">'));
  assert.equal(ANIM.workCopy('<p>', { vclock: 'no clock here' }).epochFrozen, false);
});

test('seed comes from the page text only (same page at two paths, two hide sets → same seed input)', () => {
  // prepare() gọi seedFor(sha256(nội dung trang)); đường dẫn, hide, nền không vào seed → kiểm bằng prepare trên hai thư mục
  const d = tmpDir('seed'); const seen = [];
  for (const sub of ['a', 'b']) { fs.mkdirSync(path.join(d, sub)); fs.writeFileSync(path.join(d, sub, 'p.html'), SAMPLE); }
  const scenes = [{ i: 0, elements: [{ type: 'anim', src: path.join(d, 'a', 'p.html') }, { type: 'anim', src: path.join(d, 'b', 'p.html'), hide: ['#bg'], background: 'transparent' }] }];
  return ANIM.prepare(scenes, { jobPath: path.join(d, 'j.json'), work: d, W: 960, H: 540, FPS: 30, vclock: VCLOCK, seedFor: (k) => { seen.push(k); return ''; },
    launch: async () => { throw new Error('stop before the browser'); } }).then(() => assert.fail('should stop'), (e) => {
    assert.match(e.message, /stop before the browser/); assert.equal(seen.length, 2); assert.equal(seen[0], seen[1]);
  });
});

test('stageSize: #stage first, commas, decimals, fallback', () => {
  assert.deepEqual(ANIM.stageSize(SAMPLE).size, [1920, 1080]);
  assert.deepEqual(ANIM.stageSize('<svg viewBox="0 0 24 24"></svg><svg id="stage" viewBox="0,0,1080,1920"></svg>').size, [1080, 1920]);
  assert.deepEqual(ANIM.stageSize('<svg viewBox=" 0 0 1280.5 720 "></svg>').size, [1280.5, 720]);
  assert.deepEqual(ANIM.stageSize('<!-- <svg id="stage" viewBox="0 0 5 5"> --><svg viewBox="0 0 800 600">').size, [800, 600]);
  const f = ANIM.stageSize('<div>no svg</div>'); assert.deepEqual(f.size, [1920, 1080]); assert.equal(f.warnings[0].code, 'W_FIXED_LAYOUT');
});

test('box: contain fills the box, cover math 1920x1080 into 1080x1920 → 3414x1920 at -1167,0', () => {
  assert.deepEqual(ANIM.coverRect(1080, 1920, 1920, 1080), { left: -1167, top: 0, width: 3414, height: 1920 });
  assert.deepEqual(ANIM.coverRect(960, 540, 1920, 1080), { left: 0, top: 0, width: 960, height: 540 });
  const e = (fit) => ({ _anim: { n: { fit }, page: { url: 'file:///w/anim0.html?external=1&x="1"', stage: [1920, 1080] } } });
  const c = ANIM.box(e('cover'), 'e3', 'position:absolute;', 1080, 1920);
  assert.match(c, /^<div id="e3" style="position:absolute;width:1080px;height:1920px;overflow:hidden"><iframe class="es-anim" src="file:\/\/\/w\/anim0\.html\?external=1&amp;x=&quot;1&quot;" loading="eager"/);
  assert.match(c, /left:-1167px;top:0px;width:3414px;height:1920px/);
  assert.match(ANIM.box(e('contain'), 'e0', '', 960, 540), /left:0;top:0;width:100%;height:100%/);
});

test('span: duration, one loop, until / end of page', () => {
  assert.equal(ANIM.span({ duration: 4 }, 5), 4);
  assert.equal(ANIM.span({}, 5), 5);
  assert.equal(ANIM.span({ speed: 2 }, 5), 2.5);
  assert.equal(ANIM.span({ loop: false, seek: 1 }, 5), 4);
  assert.equal(ANIM.span({ loop: false, seek: 1, until: 3.2 }, 5), 2.2);
  assert.equal(ANIM.span({ loop: false, seek: 6 }, 5), 0.2);
  assert.equal(ANIM.span({ _anim: { page: { dur: 3 } } }), 3);
});

test('watch: same promise when ms is 0, E_ANIM_HUNG on timeout, timer cleared when the promise settles first', async () => {
  const p = Promise.resolve(1); assert.equal(ANIM.watch(p, 0, 'x'), p);
  await assert.rejects(ANIM.watch(new Promise(() => {}), 50, 'scene 1 frame 3'), /^Error: E_ANIM_HUNG: scene 1 frame 3 did not answer within 0 s/);
  const t0 = Date.now(); assert.equal(await ANIM.watch(new Promise((r) => setTimeout(() => r(7), 20)), 5000, 'x'), 7);
  assert.ok(Date.now() - t0 < 1000); // timer 5 s đã được huỷ: node:test sẽ treo nếu không
});

test('budget, isLive, result: only for anim jobs', () => {
  const P = { dead: false, dur: 5, stage: [1920, 1080], gsap: { page: null, used: null }, warnings: [] };
  const a = { type: 'anim', _anim: { page: P, policy: 'hide', label: 'a.html', n: { timeout: 7 }, warnings: [], run: null } };
  const b = { type: 'anim', _anim: { page: P, policy: 'fail', label: 'a.html', n: { timeout: 3 }, warnings: [], run: null } };
  const s = { i: 0, elements: [{ type: 'html' }, a, b] };
  assert.equal(ANIM.budget({ elements: [{ type: 'html' }] }), 0);
  assert.equal(ANIM.budget(s), 47000);
  P.dead = true; P.why = 'E_ANIM_NOT_READY: x';
  assert.equal(ANIM.isLive(a), false); assert.equal(ANIM.isLive(b), true); // "hide" bỏ hẳn, "fail" vẫn dựng để tự báo lỗi
  assert.deepEqual(ANIM.result([{ i: 0, elements: [{ type: 'html' }] }]), {});
  const r = ANIM.result([s]).anims;
  assert.equal(r.length, 2); assert.equal(r[0].fallback, 'hide'); assert.deepEqual(r[0].problems, ['E_ANIM_NOT_READY: x']);
});

test('on-error hide at render time stays in that scene: later scenes keep the element whatever the scheduling', () => {
  const P = { dead: false, why: '', dur: 5, stage: [1920, 1080], gsap: { page: null, used: null }, warnings: [], seen: new Set() };
  const mk = () => ({ type: 'anim', _anim: { page: P, policy: 'hide', label: 'a.html', where: 'w', n: { timeout: 7 }, warnings: [], run: null } });
  const s1 = { i: 0, elements: [mk()] }; const s2 = { i: 1, elements: [mk()] };
  ANIM.afterReady(s1, { ok: true, items: [{ id: 'e0', ok: false, ms: 5, dur: 0, problems: ['E_ANIM_NOT_READY: x'], warnings: [], fallback: 'hide' }] });
  assert.equal(P.dead, false); assert.equal(ANIM.isLive(s2.elements[0]), true);
  ANIM.afterScene(s1, [{ id: 'e0', late_timers: 0, err: 'anim e0 (a.html): E_ANIM_SEEK_THREW: boom', font_swaps: [] }]);
  assert.equal(P.dead, false); assert.equal(ANIM.isLive(s2.elements[0]), true);
  const r = ANIM.result([s1, s2]).anims; assert.equal(r[0].fallback, 'hide'); assert.equal(r[1].fallback, undefined);
});

test('sceneError: anim errors get scene + element + page, others get the scene', () => {
  const s = { i: 1, comment: 's02 item' };
  assert.equal(ANIM.sceneError(s, new Error('page.evaluate: Error: anim e1 (pages/a (1).html): E_ANIM_SEEK_THREW: anim.seek(2.500) threw: boom\n    at Object.seek (eval)')).message,
    'anim: scene 2 ("s02 item") element e1 (pages/a (1).html): E_ANIM_SEEK_THREW: anim.seek(2.500) threw: boom');
  assert.equal(ANIM.sceneError(s, new Error('E_ANIM_HUNG: frame 4 did not answer within 30 s')).message, 'anim: scene 2 ("s02 item"): E_ANIM_HUNG: frame 4 did not answer within 30 s');
  assert.equal(ANIM.sceneError({ i: 0 }, new Error('page.evaluate: TypeError: x is null')).message, 'scene 1: TypeError: x is null');
});

test('render.mjs wiring: flags keep --disable-web-security, VCLOCK has the epoch hook, --features', () => {
  assert.ok(FLAGS.includes('--disable-web-security'), FLAGS.join(' '));
  assert.ok(VCLOCK.includes('const D0=Date.now()'));
  assert.equal(execFileSync(process.execPath, [path.join(REPO, 'render.mjs'), '--features']).toString().trim(), '{"features":["anim","dotlottie","rive","lib:anime4","lib:motion","anim-contract"]}');
});

test('T6: the example page passes motion2code check_anim.py (static)', { skip: spawnSync('python3', ['--version']).status !== 0 && 'python3 missing' }, () => {
  const r = spawnSync('python3', ['-B', path.join(REPO, '.claude/skills/motion2code/scripts/check_anim.py'), SAMPLE_FILE], { encoding: 'utf8' }); // -B: no __pycache__ in the vendored skill
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /\[ok\]/);
});
