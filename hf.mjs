#!/usr/bin/env node
// Dựng một dự án HyperFrames (thư mục có index.html, tạo bằng `npx hyperframes init`) thành MP4 + result.json giống job ES,
// để render.yml đưa lên Release và qa.mjs kiểm tra như video thường.
//   node hf.mjs jobs/<id> out        → out/<id>.mp4 + out/<id>.result.json
// Phiên bản HyperFrames cố định (HF_VERSION, mặc định 0.8.181) cho dựng lại ra y hệt; Chrome dùng bản Playwright đã cài nếu có.
// Dự án mới muốn bản mới hơn: jobs/<id>/es-render.json { "hyperframes": "0.8.210" } (chỉ dự án đó; không sửa hyperframes.json — file cấu hình
// riêng của HyperFrames có schema). Mặc định chỉ đổi trong một PR riêng sau khi chủ kênh xem framemd5 của các dự án cũ trên cả hai bản.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const HF_DEFAULT = process.env.HF_VERSION || '0.8.181';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const [dirArg, outArg = 'out'] = process.argv.slice(2);
if (!dirArg) { console.error('dùng: node hf.mjs <thư mục dự án HyperFrames> [out]'); process.exit(2); }
const dir = path.resolve(dirArg); const outDir = path.resolve(outArg); const id = path.basename(dir);
// phiên bản riêng của dự án (opt-in): chỉ nhận số phiên bản x.y.z, không nhận "latest" (dựng lại phải ra y hệt)
function projectVersion(d, def = HF_DEFAULT) {
  let v; try { v = JSON.parse(fs.readFileSync(path.join(d, 'es-render.json'), 'utf8')).hyperframes; } catch (e) { return def; }
  if (v === undefined) return def;
  if (!/^\d+\.\d+\.\d+$/.test(String(v))) throw new Error('es-render.json: "hyperframes" phải là số phiên bản x.y.z (got ' + JSON.stringify(v) + ')');
  return String(v);
}
let HF_VERSION = HF_DEFAULT;
fs.mkdirSync(outDir, { recursive: true });
const mp4 = path.join(outDir, id + '.mp4'); const resFile = path.join(outDir, id + '.result.json');
const write = (r) => fs.writeFileSync(resFile, JSON.stringify({ id, engine: 'hyperframes', hyperframes: HF_VERSION, ...r }, null, 1));

async function chromePath() {
  if (process.env.HYPERFRAMES_CHROME_PATH) return process.env.HYPERFRAMES_CHROME_PATH;
  try { const { chromium } = await import('playwright'); const p = chromium.executablePath(); if (p && fs.existsSync(p)) return p; } catch (e) { /* không có Playwright → HyperFrames tự tải Chrome */ }
  return '';
}

async function main() {
  if (!fs.existsSync(path.join(dir, 'index.html'))) throw new Error('thư mục ' + dirArg + ' không có index.html (dự án HyperFrames)');
  HF_VERSION = projectVersion(dir);
  if (HF_VERSION !== HF_DEFAULT) await new Promise((res) => spawn('npx', ['-y', 'hyperframes@' + HF_VERSION, 'telemetry', 'disable'], { cwd: dir, stdio: 'ignore' }).on('close', res));
  const t0 = Date.now(); const chrome = await chromePath();
  const env = { ...process.env, HYPERFRAMES_SKIP_SKILLS: '1', CI: process.env.CI || '1', ...(chrome ? { HYPERFRAMES_CHROME_PATH: chrome } : {}) };
  log('hyperframes', HF_VERSION, id, chrome ? '(Chrome: ' + chrome + ')' : '');
  let tail = '';
  const code = await new Promise((res) => {
    const p = spawn('npx', ['-y', 'hyperframes@' + HF_VERSION, 'render', '.', '-o', mp4, '-q', process.env.HF_QUALITY || 'delivery'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = (d) => { const s = String(d); if (!/^@hf-progress|\[INFO\]/m.test(s)) process.stdout.write(s); tail = (tail + s).slice(-6000); };
    p.stdout.on('data', keep); p.stderr.on('data', keep); p.on('close', res);
  });
  if (code !== 0 || !fs.existsSync(mp4)) {
    const msg = (tail.match(/✗[\s\S]*$/) || [tail])[0].replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-1500);
    throw new Error('HyperFrames render lỗi (exit ' + code + '): ' + msg);
  }
  const j = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4]).toString());
  const v = (j.streams || []).find((s) => s.codec_type === 'video') || {}; const hasAudio = (j.streams || []).some((s) => s.codec_type === 'audio');
  write({ status: 'done', duration: +Number(j.format?.duration || 0).toFixed(3), width: Number(v.width) || 0, height: Number(v.height) || 0, file: path.basename(mp4), has_audio: hasAudio, render_seconds: Math.round((Date.now() - t0) / 1000) });
  log('done', mp4);
}
main().catch((e) => { console.error(e.message); write({ status: 'error', message: String(e.message || e).slice(0, 1800) }); process.exitCode = 1; });
