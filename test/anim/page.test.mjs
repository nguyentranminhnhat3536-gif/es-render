// T2 cổng chờ + chế độ hỏng, T3 tất định (thứ tự tua không đổi kết quả). Trang chủ = VCLOCK của render.mjs + ANIM.box + ANIM.PAGE_JS,
// Chromium với đúng cờ của render.mjs. Không mạng (trừ ca "good" khi ANIM_NET=1).
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/anim/page.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { ANIM, FLAGS, NET, variants, mini, work, launch, openHost, hostDoc, rgb, mad, sha, px, refShots, tmpDir } from './lib.mjs';

let browser; let dir;
before(async () => { browser = await launch(); dir = tmpDir('page'); });
after(async () => { await browser.close(); });
const one = (file, m2c = {}, o = {}) => [{ id: 'e0', file, m2c, ...o }];
const TTF = ['/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'].find((f) => fs.existsSync(f));
async function server(handler) { const s = http.createServer(handler); await new Promise((r) => s.listen(0, '127.0.0.1', r)); return { s, port: s.address().port, close: () => new Promise((r) => { s.closeAllConnections?.(); s.close(r); }) }; }

test('herm: gate ok, in-process iframe, frames equal the page rendered by itself, offset + wrap', async (t) => {
  const f = work(dir, variants.herm());
  const h = await openHost(browser, dir, one(f));
  const g = await h.gate();
  assert.equal(g.ok, true, JSON.stringify(g.items)); assert.equal(g.items[0].dur, 5); assert.deepEqual(g.items[0].problems, []);
  assert.ok(g.wall < 1000, 'gate ' + g.wall + ' ms');
  const targets = (await h.cdp.send('Target.getTargets')).targetInfos.filter((x) => x.type === 'iframe').length;
  assert.equal(targets, 0, 'file:// iframe must stay in the scene renderer process (paint after seek is synchronous)');
  const TIMES = [0, 0.5, 0.8, 1.5, 1.8, 2.5, 3.6, 4.6, 4.8, 4.9667];
  const ref = await refShots(browser, dir, TIMES);
  const rows = [];
  for (const tt of TIMES) { const d = mad(rgb(await h.at(tt)), rgb(ref[tt])); rows.push(tt + ':' + d.toFixed(3)); assert.ok(d < 0.5, 't=' + tt + ' mad ' + d); }
  await h.close();
  // phần tử start 1.0 + seek 4.0 + loop: cảnh 2.0 → trang 5.0 → 0.0; 2.5 → 0.5; 1.8 → 4.8
  const h2 = await openHost(browser, dir, one(f, { seek: 4 }, { st: 1.0 })); await h2.gate();
  for (const [tt, want] of [[2.0, 0], [2.5, 0.5], [1.8, 4.8]]) {
    const s = rgb(await h2.at(tt)); const best = TIMES.map((r) => [r, mad(s, rgb(ref[r]))]).sort((a, b) => a[1] - b[1])[0];
    assert.equal(best[0], want, 'scene ' + tt + ' → best page time ' + best[0]); assert.ok(best[1] < 0.5);
  }
  await h2.close();
  t.diagnostic('gate ' + g.wall + ' ms, load ' + h.load + ' ms; mad ' + rows.join(' '));
});

test('good (Google Fonts kept): ok, fonts loaded or W_STYLESHEET/W_FONTS', { skip: !NET && 'set ANIM_NET=1 (needs fonts.googleapis.com)' }, async (t) => {
  const h = await openHost(browser, dir, one(work(dir, variants.good()))); const g = await h.gate(); await h.close();
  assert.equal(g.ok, true); t.diagnostic('load ' + h.load + ' ms, gate ' + g.wall + ' ms, warnings ' + JSON.stringify(g.items[0].warnings));
});

test('slow (boot +1.5 s): the gate waits, frame 0 equals the fast page; without the gate frame 0 differs', async (t) => {
  const a = await openHost(browser, dir, one(work(dir, variants.herm()))); await a.gate(); const f0 = rgb(await a.at(0)); await a.close();
  const sf = work(dir, variants.slow());
  const b = await openHost(browser, dir, one(sf)); const g = await b.gate(); const s0 = rgb(await b.at(0)); await b.close();
  assert.equal(g.ok, true); assert.ok(g.wall >= 1400, 'gate waited ' + g.wall + ' ms');
  assert.ok(mad(f0, s0) < 0.5, 'frame 0 mad ' + mad(f0, s0));
  const c = await openHost(browser, dir, one(sf));
  await c.page.evaluate(() => { document.getElementById('e0').style.visibility = 'visible'; });
  const n0 = rgb(await c.shot()); await c.close();
  assert.ok(mad(f0, n0) > 2, 'without the gate frame 0 is half-built (mad ' + mad(f0, n0).toFixed(2) + ')');
  t.diagnostic('gate waited ' + g.wall + ' ms; no-gate frame 0 mad ' + mad(f0, n0).toFixed(2));
});

test('never ready (timeout 2): E_ANIM_NOT_READY within ≈2 s', async (t) => {
  const t0 = Date.now(); const h = await openHost(browser, dir, one(work(dir, variants.never()), { timeout: 2 })); const g = await h.gate(); await h.close();
  assert.equal(g.ok, false); assert.match(g.items[0].problems[0], /^E_ANIM_NOT_READY: <html data-ready="1"> not set within 2 s \(state: not-ready\)/);
  assert.ok(g.wall < 3000 && g.wall >= 1900, 'gate ' + g.wall); t.diagnostic('gate ' + g.wall + ' ms, wall ' + (Date.now() - t0) + ' ms');
});

test('boot crash: the page error is quoted', async () => {
  const h = await openHost(browser, dir, one(work(dir, variants.crash()), { timeout: 2 })); const g = await h.gate(); await h.close();
  assert.match(g.items[0].problems[0], /^E_ANIM_NOT_READY: .*page errors: .*undefinedThing is not defined/);
});

test('no contract / zero duration: fail fast', async (t) => {
  const a = await openHost(browser, dir, one(work(dir, variants.nocontract()))); const ga = await a.gate(); await a.close();
  assert.match(ga.items[0].problems[0], /^E_ANIM_NO_CONTRACT: window\.anim\.seek is not a function/); assert.ok(ga.wall < 1000, ga.wall + ' ms');
  const b = await openHost(browser, dir, one(work(dir, variants.zero()))); const gb = await b.gate(); await b.close();
  assert.match(gb.items[0].problems[0], /^E_ANIM_BAD_DURATION: window\.anim\.duration must be a number > 0 \(got 0\)/);
  t.diagnostic('no-contract gate ' + ga.wall + ' ms');
});

test('seek throws: policy fail rejects with element + page, policy hide hides the element and keeps the error', async () => {
  const f = work(dir, variants.throws());
  const a = await openHost(browser, dir, one(f)); await a.gate(); await a.at(1);
  await assert.rejects(a.seek(2.5), /anim e0 \(x\.html\): E_ANIM_SEEK_THREW: anim\.seek\(2\.500\) threw: boom at 2\.5/); await a.close();
  const b = await openHost(browser, dir, one(f, { policy: 'hide' })); await b.gate(); await b.at(1);
  assert.equal(await b.seek(2.5), 'e0!;'); assert.equal(await b.seek(2.6), '');
  assert.equal(await b.page.evaluate(() => document.getElementById('e0').style.visibility), 'hidden');
  const rep = await b.page.evaluate(() => window.__esAnim.report()); await b.close();
  assert.match(rep[0].err, /E_ANIM_SEEK_THREW: anim\.seek\(2\.500\) threw: boom at 2\.5/);
});

test('slowfont: a face used by frame 0 delays load, so frame 0 is already final', { skip: !TTF && 'no TTF on this machine' }, async (t) => {
  const ttf = fs.readFileSync(TTF); const DELAY = 3000;
  const srv = await server((q, r) => setTimeout(() => { r.writeHead(200, { 'content-type': 'font/ttf', 'access-control-allow-origin': '*' }); r.end(ttf); }, q.url.startsWith('/slow') ? DELAY : 0));
  const page = (u) => mini({ head: '<style>@font-face{font-family:F;src:url(http://127.0.0.1:' + srv.port + u + ') format("truetype");font-display:block}</style>', body: '<text x="40" y="300" font-size="150" fill="#fff" font-family="F, monospace">Wgx 0</text>' });
  const a = await openHost(browser, dir, one(work(dir, page('/fast.ttf')))); await a.gate(); const ref = rgb(await a.at(0)); await a.close();
  const t0 = Date.now(); const b = await openHost(browser, dir, one(work(dir, page('/slow.ttf')))); const g = await b.gate(); const wall = Date.now() - t0; const s0 = rgb(await b.at(0)); await b.close(); await srv.close();
  assert.equal(g.ok, true); assert.ok(wall >= DELAY - 100, 'goto + gate ' + wall + ' ms'); assert.ok(mad(ref, s0) < 0.5, 'frame 0 mad ' + mad(ref, s0));
  t.diagnostic('goto+gate ' + wall + ' ms (load ' + b.load + ', gate ' + g.wall + '), warnings ' + JSON.stringify(g.items[0].warnings));
});

test('lateface: a face first used at t ≥ 1 s is loaded by the gate (no blank text mid-render)', { skip: !TTF && 'no TTF on this machine' }, async (t) => {
  const ttf = fs.readFileSync(TTF);
  const srv = await server((q, r) => setTimeout(() => { r.writeHead(200, { 'content-type': 'font/ttf' }); r.end(ttf); }, 1200));
  const f = work(dir, mini({ dur: 3, head: '<style>@font-face{font-family:Late;src:url(http://127.0.0.1:' + srv.port + '/late.ttf) format("truetype");font-display:block}</style>',
    body: '<text id="late" x="40" y="300" font-size="150" fill="#fff" font-family="Late, monospace" display="none">Wgx late</text>',
    seek: 'document.getElementById("late").setAttribute("display",t>=1?"inline":"none");' }));
  const h = await openHost(browser, dir, one(f)); const g = await h.gate(); await h.seek(0);
  const a = rgb(await h.at(1.5)); await new Promise((r) => setTimeout(r, 1500)); await h.seek(1.6); const b = rgb(await h.at(1.5)); await h.close(); await srv.close();
  assert.ok(mad(a, b) < 0.5, 'first use vs settled mad ' + mad(a, b)); t.diagnostic('gate ' + g.wall + ' ms; mad ' + mad(a, b).toFixed(3));
});

test('rafready: data-ready set inside two nested requestAnimationFrame → ok quickly (rAF pumped at time 0)', async (t) => {
  const h = await openHost(browser, dir, one(work(dir, variants.rafready()), { timeout: 2 })); const g = await h.gate(); await h.close();
  assert.equal(g.ok, true, JSON.stringify(g.items[0].problems)); assert.ok(g.wall < 1000, g.wall + ' ms'); t.diagnostic('gate ' + g.wall + ' ms');
});

test('smil: same t captured 0.7 s apart is identical, W_SMIL', async () => {
  const f = work(dir, mini({ body: '<rect x="380" y="170" width="200" height="200" fill="#ffcc00"><animateTransform attributeName="transform" type="rotate" from="0 480 270" to="360 480 270" dur="2s" repeatCount="indefinite"/></rect>' }));
  const h = await openHost(browser, dir, one(f)); const g = await h.gate();
  const a = rgb(await h.at(0.5)); await new Promise((r) => setTimeout(r, 700)); await h.seek(0.7); const b = rgb(await h.at(0.5)); await h.close();
  assert.equal(mad(a, b), 0); assert.ok(g.items[0].warnings.some((w) => w.startsWith('W_SMIL')));
});

test('stray tween outside anim.tl: frozen (forward = backward), W_STRAY_TWEENS', async () => {
  const f = work(dir, variants.stray()); const TS = [0.5, 1.0, 1.5, 2.0, 2.5];
  const order = async (ts) => { const h = await openHost(browser, dir, one(f)); const g = await h.gate(); const o = {}; for (const tt of ts) o[tt] = sha(rgb(await h.at(tt), 480, 270)); await h.close(); return { o, w: g.items[0].warnings }; };
  const a = await order(TS); const b = await order([...TS].reverse());
  assert.equal(TS.filter((tt) => a.o[tt] !== b.o[tt]).length, 0); assert.ok(a.w.some((w) => w.startsWith('W_STRAY_TWEENS')), JSON.stringify(a.w));
});

test('nohead: injection after the doctype keeps standards mode', async () => {
  const f = work(dir, '<!doctype html>\n<meta charset="utf-8"><svg viewBox="0 0 960 540"></svg><script>window.anim={duration:2,seek(){},play(){},pause(){}};document.documentElement.dataset.ready="1"</script>');
  const h = await openHost(browser, dir, one(f)); const g = await h.gate();
  const mode = await h.page.evaluate(() => document.querySelector('iframe').contentDocument.compatMode); await h.close();
  assert.equal(g.ok, true); assert.equal(mode, 'CSS1Compat');
});

test('badhide + transparent: valid selectors still hide, W_HIDE for invalid / unmatched, scene shows through', async () => {
  const hide = ['#bg', ':nope(1)', '#nothing'];
  const f = work(dir, variants.herm(), { hide, transparent: true });
  const h = await openHost(browser, dir, one(f, { hide }, { w: 480, h: 270 })); const g = await h.gate(); const img = rgb(await h.at(0), 960, 540);
  const bg = await h.page.evaluate(() => getComputedStyle(document.querySelector('iframe').contentDocument.getElementById('bg')).display); await h.close();
  assert.equal(bg, 'none');
  assert.deepEqual(g.items[0].warnings.filter((w) => w.startsWith('W_HIDE')), ['W_HIDE: invalid selector ":nope(1)"', 'W_HIDE: "#nothing" matches nothing']);
  assert.deepEqual(px(img, 960, 20, 20), [0x20, 0x40, 0x20]);
});

test('noaccess (Chromium without --disable-web-security): E_ANIM_NO_ACCESS fast', async (t) => {
  const b2 = await launch(FLAGS.filter((a) => a !== '--disable-web-security'));
  const h = await openHost(b2, dir, one(work(dir, variants.herm()))); const g = await h.gate(); await h.close(); await b2.close();
  assert.match(g.items[0].problems[0], /^E_ANIM_NO_ACCESS/); assert.ok(g.wall < 1500, g.wall + ' ms'); t.diagnostic('gate ' + g.wall + ' ms');
});

test('budget: data-ready at 1.2 s + anim.ready 0.6 s + an image that never answers, timeout 2 → gate bounded by ≈2 s', async (t) => {
  const srv = await server(() => {}); // không bao giờ trả lời
  const f = work(dir, mini({ ready: "setTimeout(()=>{const i=document.createElement('img');i.src='http://127.0.0.1:" + srv.port + "/never.png';document.body.appendChild(i);document.documentElement.dataset.ready='1'},1200);", js: 'window.anim.ready=()=>new Promise((r)=>setTimeout(r,600));' }));
  const h = await openHost(browser, dir, one(f, { timeout: 2 })); const g = await h.gate(); await h.close(); await srv.close();
  assert.ok(g.wall <= 2600, 'gate ' + g.wall + ' ms'); t.diagnostic('gate ' + g.wall + ' ms, ok=' + g.ok + ' ' + JSON.stringify(g.items[0].warnings));
});

test('epoch: Date.now() in the page = EPOCH + page ms', async () => {
  const h = await openHost(browser, dir, one(work(dir, mini({ body: '<text id="clock" x="10" y="50" fill="#fff">x</text>' })))); await h.gate(); await h.seek(1.25);
  const v = await h.page.evaluate(() => document.querySelector('iframe').contentDocument.getElementById('clock').textContent); await h.close();
  assert.equal(v, String(ANIM.EPOCH + 1250));
});

test('timers: setTimeout after the gate is ignored and counted (W_TIMERS source), frames identical across runs', async () => {
  const f = work(dir, mini({ body: '<rect id="r" x="10" y="10" width="100" height="100" fill="#f0f"/>', seek: 'setTimeout(()=>{document.getElementById("r").setAttribute("x",String(10+Math.random()*800))},0);',
    js: 'setInterval(()=>{document.getElementById("r").setAttribute("x","700")},1000);' }));
  const run = async () => { const h = await openHost(browser, dir, one(f)); await h.gate(); const out = []; for (const tt of [0.1, 0.5, 1.2]) { out.push(sha(rgb(await h.at(tt), 480, 270))); await new Promise((r) => setTimeout(r, 400)); } const rep = await h.page.evaluate(() => window.__esAnim.report()); await h.close(); return { out, late: rep[0].late_timers }; };
  const a = await run(); const b = await run();
  assert.ok(a.late >= 3, 'late timers ' + a.late); assert.deepEqual(a.out, b.out);
});

test('forever: a page that never returns is caught by the Node watchdog (E_ANIM_HUNG), the context closes, the browser keeps working', async (t) => {
  const b2 = await launch(); const d = tmpDir('forever');
  const f = work(d, variants.forever());
  const doc = d + '/host.html'; fs.writeFileSync(doc, hostDoc(one(f)));
  const ctx = await b2.newContext({ viewport: { width: 960, height: 540 } }); const page = await ctx.newPage();
  await page.goto('file://' + doc, { waitUntil: 'load', timeout: 3000 }).catch(() => {});
  const t0 = Date.now();
  await assert.rejects(ANIM.watch(page.evaluate(() => window.__esAnim.ready(window.SPEC)), 3000, 'scene 1: ready()'), /^Error: E_ANIM_HUNG: scene 1: ready\(\) did not answer within 3 s/);
  const hung = Date.now() - t0; const c0 = Date.now(); await ctx.close(); const closeMs = Date.now() - c0;
  const h = await openHost(b2, d, one(work(d, variants.herm()))); const g = await h.gate(); await h.close(); await b2.close();
  assert.equal(g.ok, true); assert.ok(hung < 4500, hung + ' ms'); t.diagnostic('hung after ' + hung + ' ms, ctx.close ' + closeMs + ' ms, next page gate ok');
});

// ---------- T3: tất định ----------
const TS = Array.from({ length: 31 }, (_, i) => Math.round(i * 0.2 * 1e6) / 1e6); // 0 … 6 s, qua mốc quấn 5 s
const shuffled = (() => { let a = 12345; const r = () => ((a = (a * 16807) % 2147483647) / 2147483647); const x = [...TS]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; })();
async function orders(src, m2c = {}, list = { fwd: TS, bwd: [...TS].reverse(), rnd: shuffled }) {
  const f = work(dir, src); const res = {}; const raw = {};
  for (const [name, ts] of Object.entries(list)) {
    const h = await openHost(browser, dir, one(f, m2c, { w: 480, h: 270 }), { W: 480, H: 270 }); const g = await h.gate(); assert.equal(g.ok, true);
    res[name] = {}; raw[name] = {}; for (const tt of ts) { const x = rgb(await h.at(tt), 480, 270); res[name][tt] = sha(x); raw[name][tt] = x; } await h.close();
  }
  const names = Object.keys(list); const differing = TS.filter((tt) => names.some((n) => res[n][tt] !== res[names[0]][tt])).length;
  const maxMad = Math.max(...TS.map((tt) => Math.max(...names.map((n) => mad(raw[n][tt], raw[names[0]][tt])))));
  return { differing, maxMad };
}
const SMIL = mini({ dur: 2, body: '<rect x="380" y="170" width="200" height="200" fill="#ffcc00"><animateTransform attributeName="transform" type="rotate" from="0 480 270" to="360 480 270" dur="2s" repeatCount="indefinite"/></rect><circle r="40" fill="#0cf"><animateMotion dur="3s" repeatCount="indefinite" path="M100,100 L860,440"/></circle>' });
for (const [name, src] of [['herm', variants.herm], ['stray', variants.stray], ['smil', () => SMIL]]) {
  test('T3 determinism ' + name + ': forward, backward and shuffled seek orders give identical frames (31 times)', async () => {
    assert.equal((await orders(src())).differing, 0);
  });
}
// CSS transform animation: the freeze path (currentTime = page time) holds. Inside the iframe Chromium sometimes anti-aliases a
// few edge pixels differently from run to run once a transform animation exists (also between two forward runs; a plain scene
// page with the same animation is exact). Measured over 93 pairs at 192x108: max 25 levels, mean 0.05. A one-frame (40 ms) CSS
// clock error: max ≥ 155, mean ≥ 0.19. Bound: max ≤ 64 and mean ≤ 0.1, and the test checks that a one-frame error breaks it.
const stat = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return { max: d, mad: mad(a, b) }; };
test('T3 determinism cssanim: orders agree within AA noise (max ≤ 64, mean ≤ 0.1 at 192x108); a one-frame CSS clock error does not', async (t) => {
  const f = work(dir, variants.cssanim()); const res = {};
  for (const [name, ts] of Object.entries({ fwd: TS, bwd: [...TS].reverse(), rnd: shuffled })) {
    const h = await openHost(browser, dir, one(f, {}, { w: 480, h: 270 }), { W: 480, H: 270 }); assert.equal((await h.gate()).ok, true);
    res[name] = {}; for (const tt of ts) res[name][tt] = rgb(await h.at(tt)); await h.close();
  }
  let max = 0; let worst = 0;
  for (const tt of TS) for (const o of ['bwd', 'rnd']) { const s = stat(res.fwd[tt], res[o][tt]); max = Math.max(max, s.max); worst = Math.max(worst, s.mad); }
  assert.ok(max <= 64 && worst <= 0.1, 'across orders: max ' + max + ', mean ' + worst);
  const h = await openHost(browser, dir, one(f, {}, { w: 480, h: 270 }), { W: 480, H: 270 }); await h.gate();
  const a = rgb(await h.at(2.4)); await h.page.evaluate(() => { const d = document.querySelector('iframe').contentDocument; for (const x of d.getAnimations()) x.currentTime += 40; });
  const e = stat(a, rgb(await h.shot())); await h.close();
  assert.ok(e.max > 64 && e.mad > 0.1, 'one-frame CSS error: ' + JSON.stringify(e));
  t.diagnostic('across orders: max ' + max + ', mean ' + worst.toFixed(4) + '; one-frame CSS clock error: max ' + e.max + ', mean ' + e.mad.toFixed(3));
});
test('T3 negative control: an impure seek (depends on the previous seek) is detected', async () => {
  const n = (await orders(variants.impure())).differing; assert.ok(n >= 25, n + '/31 differing');
});
