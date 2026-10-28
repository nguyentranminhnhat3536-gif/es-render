// Hạ tầng test cho libs.mjs / els.mjs: dựng job thật bằng `node render.mjs` (TMPDIR riêng → giữ được thư mục work/ với scene*.html
// và asset-*.js đã sinh), mở lại trang cảnh đã sinh trong Chromium để tua theo thứ tự tuỳ ý. Không mạng: mọi yêu cầu http(s) bị chặn và đếm.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RENDER = fs.readFileSync(path.join(REPO, 'render.mjs'), 'utf8');
export const FLAGS = (0, eval)('[' + RENDER.match(/const opts = \{ args: \[([^\]]+)\]/)[1] + ']');
export const EX = (...p) => path.join(REPO, 'examples', ...p);
export const FIX = (...p) => path.join(REPO, 'test', 'fixtures', ...p);

const TMP = [];
export function tmpDir(tag) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'esr-libs-' + tag + '-')); TMP.push(d); return d; }
process.on('exit', () => { if (process.env.LIBS_KEEP === '1') return; for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (x) { /* */ } } });
export const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

// dựng movie (object) bằng render.mjs → { code, log, result, mp4, work (thư mục esr-* của lần dựng) }
let N = 0;
export function render(dir, name, movie, env = {}) {
  const job = path.join(dir, name + '.json'); fs.writeFileSync(job, JSON.stringify(movie));
  const out = path.join(dir, 'out-' + name + '-' + N); const tmp = path.join(dir, 'tmp-' + name + '-' + N++); fs.mkdirSync(tmp, { recursive: true });
  return new Promise((res) => {
    let log = ''; const p = spawn(process.execPath, [path.join(REPO, 'render.mjs'), job, out], { cwd: dir, env: { ...process.env, RENDER_FPS: '30', RENDER_CONCURRENCY: '2', TMPDIR: tmp, ...env } });
    p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
    p.on('close', (code) => { let result = null; try { result = JSON.parse(fs.readFileSync(path.join(out, name + '.result.json'), 'utf8')); } catch (x) { /* */ }
      const w = fs.readdirSync(tmp).filter((f) => f.startsWith('esr-')).map((f) => path.join(tmp, f))[0] || null;
      res({ code, log, result, mp4: path.join(out, name + '.mp4'), work: w }); });
  });
}
export const md5 = (mp4) => execFileSync('ffmpeg', ['-v', 'error', '-i', mp4, '-map', '0:v:0', '-f', 'framemd5', '-'], { maxBuffer: 1 << 26 }).toString().split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop().trim());
// khung idx của mp4 → RGB thô w×h
export function frame(mp4, idx, w, h) {
  return execFileSync('ffmpeg', ['-v', 'error', '-i', mp4, '-vf', 'select=eq(n\\,' + idx + '),scale=' + w + ':' + h + ':flags=area', '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1 << 26 });
}
export const px = (buf, w, x, y) => { const i = (y * w + x) * 3; return [buf[i], buf[i + 1], buf[i + 2]]; };

export async function launch() { const { chromium } = await import('playwright'); return chromium.launch({ args: FLAGS }); }
// mở trang cảnh đã sinh (work/sceneK.html) như render.mjs: ready() rồi seek(t); chặn mạng; đếm Worker / getRandomValues / setInterval
export async function openScene(browser, file, { W, H }) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const net = [];
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (/^(file|data|blob):/.test(u)) return r.continue(); net.push(u); return r.abort(); });
  await ctx.addInitScript(() => {
    const c = window.__esCount = { worker: 0, shared: 0, offscreen: 0, rnd: 0, interval: 0 };
    const wrap = (o, k, n) => { const f = o[k]; if (typeof f !== 'function') return; o[k] = function (...a) { c[n]++; return f.apply(this, a); }; };
    if (window.Worker) { const W0 = window.Worker; window.Worker = function (...a) { c.worker++; return new W0(...a); }; }
    if (window.SharedWorker) { const S0 = window.SharedWorker; window.SharedWorker = function (...a) { c.shared++; return new S0(...a); }; }
    wrap(HTMLCanvasElement.prototype, 'transferControlToOffscreen', 'offscreen'); wrap(crypto, 'getRandomValues', 'rnd'); wrap(window, 'setInterval', 'interval');
  });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 60000 });
  const ready = await page.evaluate(() => window.ready().then((r) => ({ ok: true, r }), (e) => ({ ok: false, err: String(e.message || e) })));
  const shot = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } })).data, 'base64');
  return { page, ctx, net, errors, ready, shot, seek: (t) => page.evaluate((t) => window.seek(t), t), at: async (t) => { await page.evaluate((t) => window.seek(t), t); return sha(await shot()); }, close: () => ctx.close() };
}
