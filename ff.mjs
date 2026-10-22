#!/usr/bin/env node
// Dựng một dự án fframes (Rust: thư mục có Cargo.toml, tạo bằng `cargo fframes new`) thành MP4 + result.json giống job ES,
// để render.yml đưa lên Release và qa.mjs kiểm tra như video thường.
//   node ff.mjs jobs/<id> out        → out/<id>.mp4 + out/<id>.result.json
// cargo build --release (CARGO_TARGET_DIR dùng chung cho mọi dự án → cache giữa các job), rồi chạy CLI của chính dự án: `render -o`.
// Env: FF_FORMAT=portrait|landscape (bật feature cùng tên nếu Cargo.toml có), FF_FEATURES (thêm feature, cách nhau dấu phẩy),
//      FF_RENDERER=gpu|skia-cpu|cpu, FF_BUILD_TIMEOUT / FF_TIMEOUT (giây), CARGO_TARGET_DIR, FFMPEG_FORCE_BUILD.
// Khổ xin mà dự án không làm được (không có feature, code cố định khổ khác) → vẫn done nhưng result có format_ignored.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const FFPROBE = process.env.FFPROBE || 'ffprobe';
const CARGO = process.env.FF_CARGO || (fs.existsSync(path.join(os.homedir(), '.cargo/bin/cargo')) ? path.join(os.homedir(), '.cargo/bin/cargo') : 'cargo');
const BUILD_TIMEOUT = Number(process.env.FF_BUILD_TIMEOUT || 3600); const RENDER_TIMEOUT = Number(process.env.FF_TIMEOUT || 1800);
// FFmpeg dựng sẵn của ffmpeg-sys-fframes 9.0.0 liên kết x264 bản 163 (Ubuntu 22.04); máy có x264 khác (Ubuntu 24.04: 164) phải tự dựng FFmpeg
const X264_PREBUILT = process.env.FF_X264_PREBUILT || '163';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const [dirArg, outArg = 'out'] = process.argv.slice(2);
if (!dirArg) { console.error('dùng: node ff.mjs <thư mục dự án fframes> [out]'); process.exit(2); }
const dir = path.resolve(dirArg); const outDir = path.resolve(outArg); const id = path.basename(dir);
fs.mkdirSync(outDir, { recursive: true });
const mp4 = path.join(outDir, id + '.mp4'); const resFile = path.join(outDir, id + '.result.json');
let version = '';
const write = (r) => fs.writeFileSync(resFile, JSON.stringify({ id, engine: 'fframes', ...(version ? { fframes: version } : {}), ...r }, null, 1));
const clean = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

// chạy lệnh, giữ đuôi log để báo lỗi; quá giờ thì giết cả nhóm tiến trình (cargo sinh nhiều rustc con)
function run(cmd, args, { cwd, env, timeout, onOut }) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let tail = ''; let killed = false; let buf = '';
    const t = setTimeout(() => { killed = true; try { process.kill(-p.pid, 'SIGKILL'); } catch (e) { p.kill('SIGKILL'); } }, timeout * 1000);
    p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onOut?.(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    p.stderr.on('data', (d) => { const s = String(d); process.stdout.write(s); tail = (tail + s).slice(-8000); });
    p.on('error', (e) => { clearTimeout(t); res({ code: 'spawn', tail: clean(tail + '\n' + e.message) }); }); // không chạy được lệnh: không chờ 'close'
    p.on('close', (code) => { clearTimeout(t); if (buf) onOut?.(buf); res({ code: killed ? 'timeout' : code, tail: clean(tail) }); });
  });
}

function features(toml) {
  // tên các feature khai báo trong [features] của dự án
  const sec = (toml.match(/^\[features\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m) || [])[1] || '';
  return [...sec.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=/gm)].map((m) => m[1]);
}

function x264Build() {
  for (const f of ['/usr/include/x264.h', '/usr/local/include/x264.h', '/opt/homebrew/include/x264.h']) {
    try { const m = fs.readFileSync(f, 'utf8').match(/X264_BUILD\s+(\d+)/); if (m) return m[1]; } catch (e) { /* không có file này */ }
  }
  return '';
}

async function main() {
  const tomlFile = path.join(dir, 'Cargo.toml');
  if (!fs.existsSync(tomlFile)) throw new Error('thư mục ' + dirArg + ' không có Cargo.toml (dự án fframes, tạo bằng `cargo fframes new <tên> --yes`)');
  const toml = fs.readFileSync(tomlFile, 'utf8');
  try { version = (fs.readFileSync(path.join(dir, 'Cargo.lock'), 'utf8').match(/name = "fframes"\nversion = "([^"]+)"/) || [])[1] || ''; } catch (e) { /* chưa có Cargo.lock: cargo tự tạo */ }
  if (!version) version = (toml.match(/^fframes\s*=\s*\{[^}]*version\s*=\s*"=?([^"]+)"/m) || [])[1] || (/^fframes\s*=\s*\{[^}]*git\s*=/m.test(toml) ? 'git' : '');
  try { execFileSync(CARGO, ['--version'], { stdio: 'ignore' }); } catch (e) { throw new Error('chưa cài Rust (không chạy được cargo) — cài từ https://rustup.rs rồi chạy lại'); }

  const have = features(toml); const want = (process.env.FF_FEATURES || '').split(',').map((s) => s.trim()).filter(Boolean);
  const f0 = (process.env.FF_FORMAT || '').trim().toLowerCase(); const fmt = { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square' }[f0] || f0;
  if (fmt && have.includes(fmt)) want.push(fmt);
  else if (fmt) log('FF_FORMAT=' + fmt + ': dự án không có feature "' + fmt + '" → giữ khổ khai báo trong code (WIDTH/HEIGHT)');
  const env = { ...process.env, CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || path.join(os.homedir(), '.cache', 'es-fframes-target'), CARGO_TERM_COLOR: 'never', CARGO_INCREMENTAL: '0' };
  const xb = x264Build();
  if (process.platform === 'linux' && env.FFMPEG_FORCE_BUILD === undefined && xb && xb !== X264_PREBUILT) {
    env.FFMPEG_FORCE_BUILD = '1'; log('x264 của máy là bản ' + xb + ' (FFmpeg dựng sẵn cần ' + X264_PREBUILT + ') → tự dựng FFmpeg từ mã nguồn: lần build đầu lâu thêm ~12 phút, sau đó nằm trong cache');
  }

  // 1. build — lấy đường dẫn binary từ tin nhắn JSON của cargo thay vì đoán tên
  const t0 = Date.now(); const bins = [];
  log('fframes', version || '?', id, want.length ? '(feature: ' + want.join(',') + ')' : '', '· target', env.CARGO_TARGET_DIR);
  const b = await run(CARGO, ['build', '--release', '--message-format=json-render-diagnostics', ...(want.length ? ['--features', want.join(',')] : [])], {
    cwd: dir, env, timeout: BUILD_TIMEOUT,
    onOut: (line) => { try { const m = JSON.parse(line); if (m.reason === 'compiler-artifact' && m.executable && m.target?.kind?.includes('bin')) bins.push({ name: m.target.name, exe: m.executable }); } catch (e) { /* dòng không phải JSON */ } },
  });
  const buildSec = Math.round((Date.now() - t0) / 1000);
  if (b.code !== 0) {
    const hint = /x264_encoder_open_\d+/.test(b.tail) ? ' — FFmpeg dựng sẵn lệch bản x264 với máy: chạy lại với FFMPEG_FORCE_BUILD=1'
      : /ffmpeg-sys|nasm|pkg-config|libclang/i.test(b.tail) ? ' — thiếu thư viện hệ thống (xem bước 1 skill fframes-video: nasm, pkg-config, libx264-dev, libclang-dev…)' : '';
    // từ lỗi đầu tiên của rustc (thường là lỗi thật), bỏ dòng tiến độ và lệnh liên kết dài hàng chục KB
    const ls = b.tail.trim().split('\n').filter((l) => !/^\s*(Compiling|Downloaded|Downloading|Blocking|Locking|Updating)\b/.test(l)).map((l) => (l.length > 600 ? l.slice(0, 200) + ' …' : l));
    const i = ls.findIndex((l) => /^error/.test(l)); const body = ls.slice(i >= 0 ? i : Math.max(0, ls.length - 30)).join('\n');
    throw new Error('cargo build lỗi (' + (b.code === 'timeout' ? 'quá ' + BUILD_TIMEOUT + 's' : 'exit ' + b.code) + ')' + hint + ':\n' + (body.length > 1500 ? body.slice(0, 1300) + '\n…\n' + ls[ls.length - 1] : body));
  }
  const pkg = (toml.match(/^\[package\][\s\S]*?^name\s*=\s*"([^"]+)"/m) || [])[1];
  const bin = bins.find((x) => x.name === pkg) || bins[0];
  if (!bin) throw new Error('cargo build xong nhưng không thấy chương trình (thiếu src/main.rs với fframes::cli?)');
  log('build xong', buildSec + 's →', bin.exe);

  // 2. render bằng CLI của dự án; lỗi GPU (máy không có Vulkan) thì thử lại trên CPU nếu dự án hỗ trợ --renderer
  const tries = process.env.FF_RENDERER ? [process.env.FF_RENDERER] : ['', 'skia-cpu', 'cpu'];
  let r; let used = ''; const t1 = Date.now();
  for (const rr of tries) {
    fs.rmSync(mp4, { force: true }); used = rr;
    if (rr) log('dựng lại với --renderer', rr);
    r = await run(bin.exe, ['render', '-o', mp4, ...(rr ? ['--renderer', rr] : [])], { cwd: dir, env, timeout: RENDER_TIMEOUT, onOut: (l) => l.trim() && log(l.trim()) });
    if (r.code === 0 && fs.existsSync(mp4)) break;
    if (process.env.FF_RENDERER || !/vulkan|gpu|device|surface|skia|metal/i.test(r.tail)) break;
  }
  // exit 0 mà không có file: main.rs không dùng fframes::cli (bỏ qua `render -o`) hoặc ghi ra chỗ khác
  if (r.code === 0 && !fs.existsSync(mp4)) throw new Error('chương trình chạy xong nhưng không tạo ' + path.basename(mp4) + ' (src/main.rs có gọi fframes::cli để nhận lệnh `render -o <file>`?)' + (r.tail.trim() ? ':\n' + r.tail.trim().slice(-600) : ''));
  if (r.code !== 0 || !fs.existsSync(mp4)) throw new Error('fframes render lỗi (' + (r.code === 'timeout' ? 'quá ' + RENDER_TIMEOUT + 's' : 'exit ' + r.code) + '): ' + r.tail.trim().slice(-1500));
  let j;
  try { j = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4], { stdio: ['ignore', 'pipe', 'pipe'] }).toString()); }
  catch (e) { throw new Error(e.code === 'ENOENT' ? 'chưa cài ffprobe (gói ffmpeg)' : 'file MP4 hỏng/không đọc được (render dừng giữa chừng?): ' + clean(e.stderr || e.message).trim().slice(-300)); }
  const v = (j.streams || []).find((s) => s.codec_type === 'video') || {}; const hasAudio = (j.streams || []).some((s) => s.codec_type === 'audio');
  const W = Number(v.width) || 0; const H = Number(v.height) || 0;
  // đơn 16:9 mà ra 9:16 thì phải báo, không được im lặng coi là xong
  const orient = W > H ? 'landscape' : H > W ? 'portrait' : 'square'; const fmtMiss = fmt && !want.includes(fmt) && orient !== fmt ? fmt : '';
  if (fmtMiss) log('CẢNH BÁO: xin khổ ' + fmt + ' nhưng video ra ' + W + '×' + H + ' (dự án không có feature "' + fmt + '")');
  write({ status: 'done', duration: +Number(j.format?.duration || 0).toFixed(3), width: W, height: H, file: path.basename(mp4), has_audio: hasAudio, render_seconds: Math.round((Date.now() - t1) / 1000), build_seconds: buildSec, ...(used ? { renderer: used } : {}), ...(want.length ? { features: want } : {}), ...(fmtMiss ? { format_ignored: fmtMiss } : {}) });
  log('done', mp4);
}
main().catch((e) => { console.error(e.message); write({ status: 'error', message: String(e.message || e).slice(0, 1800) }); process.exitCode = 1; });
