// Hạ tầng test cho anim.mjs: trình duyệt với đúng cờ của render.mjs, trang chủ giống trang cảnh (VCLOCK + hộp + ANIM.PAGE_JS),
// các biến thể trang lấy từ examples/anim-hello/seek-loop.html bằng phép thay chuỗi (chỉ một trang mẫu phải giữ).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ANIM from '../../anim.mjs';

export { ANIM };
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RENDER = fs.readFileSync(path.join(REPO, 'render.mjs'), 'utf8');
// lấy thẳng từ render.mjs: test luôn chạy đúng đồng hồ ảo và đúng cờ Chromium của bộ dựng
export const VCLOCK = (0, eval)(RENDER.match(/const VCLOCK = ('[\s\S]*?<\/script>');/)[1]);
export const FLAGS = (0, eval)('[' + RENDER.match(/const opts = \{ args: \[([^\]]+)\]/)[1] + ']');
export const GSAP_DIR = path.join(REPO, 'node_modules', 'gsap', 'dist');
export const SAMPLE_FILE = path.join(REPO, 'examples', 'anim-hello', 'seek-loop.html');
export const SAMPLE = fs.readFileSync(SAMPLE_FILE, 'utf8');
export const NET = process.env.ANIM_NET === '1';

export function tmpDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'esr-anim-' + tag + '-')); }
// không mạng: bỏ Google Fonts (GSAP CDN thì workCopy đổi sang node_modules)
export const hermetic = (s) => s.replace(/<link[^>]+fonts\.(googleapis|gstatic)[^>]*>\s*/g, '');
const H = hermetic(SAMPLE);
const sub = (s, a, b) => { if (!s.includes(a)) throw new Error('fixture anchor missing: ' + a.slice(0, 60)); return s.replace(a, b); };
export const variants = {
  good: () => SAMPLE,
  herm: () => H,
  slow: () => sub(H, 'fontsReady.then(() => {', 'fontsReady.then(() => new Promise((r) => setTimeout(r, 1500))).then(() => {'),
  never: () => sub(H, "document.documentElement.dataset.ready = '1';", ''),
  nocontract: () => sub(H, '\nwindow.anim = {', '\nwindow.notanim = {').replace(/(^|[^.\w])anim\.seek\(/g, '$1notanim.seek('),
  zero: () => sub(H, 'const DUR = 5;', 'const DUR = 0;'),
  crash: () => sub(H, 'build();\n  anim.seek(0);', 'build();\n  undefinedThing();'),
  throws: () => sub(H, 'seek(t) { t = clamp(t, 0, DUR);', "seek(t) { if (t > 2) throw new Error('boom at ' + t); t = clamp(t, 0, DUR);"),
  impure: () => sub(H, 'seek(t) { t = clamp(t, 0, DUR);', 'seek(t) { const p = window.__p ?? t; window.__p = t; t = clamp((t + p) / 2, 0, DUR);'),
  stray: () => sub(H, "document.documentElement.dataset.ready = '1';", "gsap.to('#square', { x: '+=600', duration: 3, ease: 'none' }); document.documentElement.dataset.ready = '1';"),
  cssanim: () => sub(sub(H, '</style>', '@keyframes spin{to{transform:rotate(360deg)}}#spinner{animation:spin 2s linear infinite;transform-box:fill-box;transform-origin:center}</style>'),
    '<g id="dots"></g>', '<g id="dots"></g><rect id="spinner" x="200" y="100" width="160" height="160" fill="#FFFFFF"/>'),
  rafready: () => sub(H, "document.documentElement.dataset.ready = '1';", "requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = '1'; }));"),
  forever: () => sub(H, "document.documentElement.dataset.ready = '1';", "document.documentElement.dataset.ready = '1'; setTimeout(() => { for (;;) {} }, 0);"),
  seekhang: () => sub(H, 'seek(t) { t = clamp(t, 0, DUR);', 'seek(t) { if (t > 1) for (;;) {} t = clamp(t, 0, DUR);'),
  // trang mẫu dùng GSAP từ thư mục bên cạnh (mở trực tiếp qua http như _m2c.py của motion2code)
  ref: () => H.replace(/https:\/\/cdnjs[^"]+gsap\.min\.js/, 'gsap.min.js'),
};
// trang tối thiểu theo hợp đồng (cho các ca SMIL, font muộn, đồng hồ…)
export const mini = ({ body = '', js = '', ready = "document.documentElement.dataset.ready='1';", head = '', dur = 2, seek = '' } = {}) =>
  '<!doctype html>\n<html><head><meta charset="utf-8">' + head + '<style>html,body{margin:0;height:100%;background:#112233;overflow:hidden}svg{position:absolute;inset:0;width:100%;height:100%;display:block}</style></head><body>'
  + '<svg id="stage" viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg">' + body + '</svg>'
  + '<script>window.anim={duration:' + dur + ',seek(t){window.__t=t;' + seek + 'var c=document.getElementById("clock");if(c)c.textContent=String(Date.now());},play(){},pause(){}};' + js + ready + '</script></body></html>';

let N = 0;
// bản sao trang như prepare() làm (VCLOCK, GSAP cục bộ, base về thư mục nguồn) → đường dẫn file
export function work(dir, src, o = {}) {
  const wc = ANIM.workCopy(src, { vclock: VCLOCK, seedTag: o.seedTag || '', baseHref: pathToFileURL(dir + path.sep).href, gsapDir: GSAP_DIR, gsapVersion: '3.15.0', ...o });
  const f = path.join(dir, 'work' + N++ + '.html'); fs.writeFileSync(f, wc.html); return f;
}
const m2c = (o = {}) => ({ src: 'x.html', seek: 0, speed: 1, loop: true, until: 0, dur: 0, timeout: 20, policy: 'fail', hide: [], ...o });
// trang chủ = phần của trang cảnh render.mjs mà anim dùng: VCLOCK, hộp + iframe (ANIM.box), SPEC, ANIM.PAGE_JS, seekAll ~ window.seek
export function hostDoc(els, { W = 960, H: Hh = 540, bg = '#204020' } = {}) {
  const spec = els.map((e) => ({ id: e.id, st: e.st || 0, end: e.end ?? 1e9, m2c: m2c(e.m2c) }));
  const boxes = els.map((e) => ANIM.box({ _anim: { n: { fit: e.fit || 'contain' }, page: { url: pathToFileURL(e.file).href + '?external=1', stage: e.stage || [1920, 1080] } } },
    e.id, 'position:absolute;left:' + (e.x || 0) + 'px;top:' + (e.y || 0) + 'px;visibility:hidden;', e.w || W, e.h || Hh)).join('');
  return '<!doctype html><html><head><meta charset="utf-8">' + VCLOCK + '<style>html,body{margin:0;width:' + W + 'px;height:' + Hh + 'px;overflow:hidden;background:' + bg + '}</style></head><body>'
    + boxes + '<script>window.SPEC=' + JSON.stringify(spec) + ';' + ANIM.PAGE_JS
    + 'window.seekAll=(t)=>{let s="";for(const e of SPEC){const n=document.getElementById(e.id);if(t<e.st-1e-6||t>=e.end){n.style.visibility="hidden";continue}n.style.visibility="visible";s+=__esAnim.seek(e,n,t)}window.__esTick(t*1000);return s};</script></body></html>';
}
export async function launch(flags = FLAGS) {
  const { chromium } = await import('playwright');
  return chromium.launch({ args: flags });
}
export async function openHost(browser, dir, els, o = {}) {
  const W = o.W || 960; const Hh = o.H || 540;
  const doc = path.join(dir, 'host' + N++ + '.html'); fs.writeFileSync(doc, hostDoc(els, { W, H: Hh, bg: o.bg }));
  const ctx = await browser.newContext({ viewport: { width: W, height: Hh }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  const t0 = Date.now(); await page.goto(pathToFileURL(doc).href, { waitUntil: 'load', timeout: 60000 }).catch(() => {}); const load = Date.now() - t0;
  const shot = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: Hh, scale: 1 } })).data, 'base64');
  const gate = async () => { const t = Date.now(); const r = await page.evaluate(() => window.__esAnim.ready(window.SPEC)); return { wall: Date.now() - t, ...r }; };
  return { page, ctx, cdp, load, shot, gate, seek: (t) => page.evaluate((t) => window.seekAll(t), t), at: async (t) => { await page.evaluate((t) => window.seekAll(t), t); return shot(); }, close: () => ctx.close() };
}
// ảnh → RGB thô (ffmpeg); so sánh điểm ảnh đã giải mã, không so byte PNG (CDP và page.screenshot cho byte khác nhau dù cùng điểm ảnh)
export const rgb = (img, w = 192, h = 108) => execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-vf', 'scale=' + w + ':' + h + ':flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: img, maxBuffer: 1 << 28 });
export const mad = (a, b) => { if (a.length !== b.length) return Infinity; let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
export const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
export const px = (buf, w, x, y) => { const i = (y * w + x) * 3; return [buf[i], buf[i + 1], buf[i + 2]]; };
// ảnh tham chiếu: trang mở một mình (?external=1), seek, 2×rAF, chụp — như _m2c.seek_shot của motion2code
export async function refShots(browser, dir, times, { W = 960, H: Hh = 540 } = {}) {
  fs.copyFileSync(path.join(GSAP_DIR, 'gsap.min.js'), path.join(dir, 'gsap.min.js'));
  const f = path.join(dir, 'ref.html'); fs.writeFileSync(f, variants.ref());
  const ctx = await browser.newContext({ viewport: { width: W, height: Hh }, deviceScaleFactor: 1 }); const page = await ctx.newPage();
  await page.goto(pathToFileURL(f).href + '?external=1', { waitUntil: 'load' }); await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  const out = {};
  for (const t of times) { await page.evaluate((t) => window.anim.seek(t), t); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); out[t] = await page.screenshot({ type: 'png' }); }
  await ctx.close(); return out;
}
