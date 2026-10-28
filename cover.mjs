#!/usr/bin/env node
// Ảnh bìa cho MỌI video (render.yml gọi sau render.mjs / hf.mjs / ff.mjs / rm.mjs, trước qa.mjs; lỗi bìa không bao giờ làm hỏng video):
//   node cover.mjs <jobs/<id>.json | out/compiled/<id>.json | out/<id>.result.json> [out]
// designed: movie.cover.html (spec/compile.mjs dựng từ brand kit + layout của hook) → Chromium chụp 1080×1920
// auto:     job movie cũ / HyperFrames / fframes / Remotion → khung hình của video: min(2.5 s, cảnh 1 − 0.2 s) khi biết cảnh,
//           không biết cảnh (hf / ff / rm) → min(2.5 s, nửa độ dài); khung ngang → 16:9 + 1:1 giữa; khung vuông → 1:1
// Ra: out/<id>.cover.jpg (9:16) + .cover-3x4.jpg (1080×1440) + .cover-1x1.jpg (1080×1080) [+ .cover-b*.jpg khi có alt_html]
//     và trường "cover" trong out/<id>.result.json (render.yml thêm url, url_3x4, url_1x1 sau khi đưa lên Release).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const [inArg, outArg = 'out'] = process.argv.slice(2);
if (!inArg) { console.error('usage: node cover.mjs <job.json|result.json> [out]'); process.exit(2); }
const outDir = path.resolve(outArg); fs.mkdirSync(outDir, { recursive: true });
const id = path.basename(inArg).replace(/\.result\.json$|\.json$/, '');
const input = JSON.parse(fs.readFileSync(inArg, 'utf8')); const movie = input.movie || (input.scenes && input.width ? input : null);
const resFile = path.join(outDir, id + '.result.json'); const res = fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')) : input.status ? input : {};
const mp4 = path.join(outDir, id + '.mp4');
// vùng cắt: tiêu đề bìa luôn nằm trong y 470–1440 (brand kit safe.cover_title_y) nên cả 2 khung cắt đều giữ được
const CROPS = { '3x4': 'crop=1080:1440:0:240', '1x1': 'crop=1080:1080:0:420' };
const ff = (args) => execFileSync(FFMPEG, ['-v', 'error', '-y', ...args]);
// landscape legacy / HyperFrames / fframes videos keep their 16:9 frame (+ a centre 1:1); portrait → 9:16 + 3:4 + 1:1
function crops(png, base) {
  const files = { file: base + '.jpg' }; const [w, h] = execFileSync(process.env.FFPROBE || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', png]).toString().trim().split(',').map(Number);
  if (w === h) { ff(['-i', png, '-vf', 'scale=1080:1080', '-q:v', '2', path.join(outDir, base + '.jpg')]); files.file_1x1 = base + '.jpg'; return files; }
  if (w > h) { ff(['-i', png, '-vf', 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080', '-q:v', '2', path.join(outDir, base + '.jpg')]); ff(['-i', path.join(outDir, base + '.jpg'), '-vf', 'crop=1080:1080:420:0', '-q:v', '2', path.join(outDir, base + '-1x1.jpg')]); files.file_1x1 = base + '-1x1.jpg'; return files; }
  ff(['-i', png, '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920', '-q:v', '2', path.join(outDir, base + '.jpg')]);
  for (const [k, vf] of Object.entries(CROPS)) { ff(['-i', path.join(outDir, base + '.jpg'), '-vf', vf, '-q:v', '2', path.join(outDir, base + '-' + k + '.jpg')]); files['file_' + k] = base + '-' + k + '.jpg'; }
  return files;
}
async function shoot(html, png) {
  let pw; try { pw = await import('playwright'); } catch (e) { pw = await import('playwright-core'); }
  const b = await (pw.chromium || pw.default.chromium).launch({ args: ['--font-render-hinting=none', '--disable-web-security'], ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const pg = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    const f = png.replace(/\.png$/, '.html'); fs.writeFileSync(f, html);
    await pg.goto('file://' + f, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await pg.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 8000))]));
    await pg.screenshot({ path: png, clip: { x: 0, y: 0, width: 1080, height: 1920 } });
  } finally { await b.close(); }
}
async function main() {
  const c = movie && movie.cover; let cover;
  if (c && c.html) {
    const png = path.join(outDir, id + '.cover.png'); await shoot(c.html, png);
    cover = { mode: 'designed', title: c.title || '', style: c.style || '', ...crops(png, id + '.cover') };
    if (c.alt_html) { const pb = path.join(outDir, id + '.cover-b.png'); await shoot(c.alt_html, pb); cover.alt = { title: c.alt_title || '', ...crops(pb, id + '.cover-b') }; }
    cover.thumb_offset_ms = Math.round(1000 * (Number(c.thumb_t) || 0));
  } else {
    if (!fs.existsSync(mp4)) throw new Error('no ' + mp4 + ' for an auto cover');
    const sc = (res.scenes || [])[0]; const dur = Number(res.duration) || Number(execFileSync(process.env.FFPROBE || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString().trim()) || 3;
    const t = Math.max(0, Math.min(2.5, sc && sc.d ? sc.d - 0.2 : dur / 2, dur - 0.1));
    const png = path.join(outDir, id + '.cover.png'); ff(['-ss', String(t), '-i', mp4, '-frames:v', '1', png]);
    cover = { mode: 'auto', title: '', style: 'frame', ...crops(png, id + '.cover'), thumb_offset_ms: Math.round(t * 1000) };
  }
  { const pr = execFileSync(process.env.FFPROBE || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(outDir, cover.file)]).toString().trim().split(',').map(Number); cover.w = pr[0]; cover.h = pr[1]; }
  for (const f of fs.readdirSync(outDir).filter((x) => x.startsWith(id + '.cover') && x.endsWith('.png'))) fs.rmSync(path.join(outDir, f));
  for (const f of fs.readdirSync(outDir).filter((x) => x.startsWith(id + '.cover') && x.endsWith('.html'))) fs.rmSync(path.join(outDir, f));
  fs.writeFileSync(resFile, JSON.stringify({ ...res, id: res.id || id, cover }, null, 1));
  console.log('cover', cover.mode, cover.file, cover.thumb_offset_ms + 'ms');
}
main().catch((e) => { console.error('cover lỗi:', e.message); process.exitCode = 1; });
