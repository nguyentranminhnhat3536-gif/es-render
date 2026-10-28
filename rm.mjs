#!/usr/bin/env node
// Dựng một dự án Remotion (thư mục có package.json với dependency "remotion" + package-lock.json) thành MP4 + result.json giống job ES,
// để render.yml đưa lên Release và qa.mjs kiểm tra như video thường.
//   node rm.mjs jobs/<id> out        → out/<id>.mp4 + out/<id>.result.json
// Cấu hình (tuỳ chọn): jobs/<id>/remotion.json { "entry": "src/index.ts", "composition": "Main", "concurrency": 1, "props": { … } }.
// Phiên bản: "remotion" và "@remotion/cli" trong package.json phải ghim đúng x.y.z và bằng nhau (mọi gói @remotion/* cùng bản);
// mặc định RM_VERSION (4.0.539) — dự án ghim bản khác thì dùng bản của dự án (ghi vào log + result.json).
// Chrome: Chromium headless shell của Playwright (không tải Chrome của Remotion); RM_CHROME=<đường dẫn> để chỉ định,
// RM_BROWSER_DOWNLOAD=1 để cho Remotion tự tải Chrome Headless Shell của nó (cần mạng).
// GIẤY PHÉP: Remotion không phải mã nguồn mở — miễn phí cho cá nhân, công ty tối đa 3 người, tổ chức phi lợi nhuận;
// công ty lớn hơn cần Company License (remotion.pro). es-render không chứa mã Remotion; mỗi dự án tự cài qua npm. Xem README.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';

const RM_DEFAULT = process.env.RM_VERSION || '4.0.539';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const TIMEOUT = Math.max(60, Number(process.env.RM_TIMEOUT) || 1800) * 1000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const [dirArg, outArg = 'out'] = process.argv.slice(2);
if (!dirArg) { console.error('dùng: node rm.mjs <thư mục dự án Remotion> [out]'); process.exit(2); }
const dir = path.resolve(dirArg); const outDir = path.resolve(outArg); const id = path.basename(dir);
fs.mkdirSync(outDir, { recursive: true });
const mp4 = path.join(outDir, id + '.mp4'); const resFile = path.join(outDir, id + '.result.json');
let RM = RM_DEFAULT;
const write = (r) => fs.writeFileSync(resFile, JSON.stringify({ id, engine: 'remotion', remotion: RM, ...r }, null, 1));
class RmError extends Error { constructor(code, msg) { super(code + ': ' + msg); this.code = code; } }
const fail = (code, msg) => { throw new RmError(code, msg); };
const readJson = (f, code) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fail(code, path.basename(f) + ' không đọc được (' + e.message + ')'); } };
const EXACT = /^\d+\.\d+\.\d+$/;

// package.json + package-lock.json → bản Remotion (đã kiểm tra ghim chính xác, các gói @remotion/* cùng bản, lockfile khớp)
function checkProject(d, def = RM_DEFAULT) {
  const pf = path.join(d, 'package.json');
  if (!fs.existsSync(pf)) fail('E_RM_NOT_REMOTION', 'thư mục ' + path.basename(d) + ' không có package.json (dự án Remotion)');
  const pkg = readJson(pf, 'E_RM_NOT_REMOTION'); const deps = { ...(pkg.devDependencies || {}), ...(pkg.dependencies || {}) };
  if (!(pkg.dependencies || {}).remotion) fail('E_RM_NOT_REMOTION', 'package.json không có "remotion" trong dependencies');
  if (!deps['@remotion/cli']) fail('E_RM_VERSION', 'thiếu "@remotion/cli" trong package.json (rm.mjs dựng bằng CLI của chính dự án)');
  const rm = Object.entries(deps).filter(([k]) => k === 'remotion' || k.startsWith('@remotion/'));
  for (const [k, v] of rm) if (!EXACT.test(String(v))) fail('E_RM_VERSION', '"' + k + '" phải ghim đúng phiên bản x.y.z (got ' + JSON.stringify(v) + '); dựng lại phải ra y hệt');
  const ver = String(deps.remotion);
  const off = rm.filter(([, v]) => v !== ver);
  if (off.length) fail('E_RM_VERSION', 'mọi gói Remotion phải cùng bản ' + ver + ' (lệch: ' + off.map(([k, v]) => k + '@' + v).join(', ') + ')');
  const lf = path.join(d, 'package-lock.json');
  if (!fs.existsSync(lf)) fail('E_RM_NO_LOCK', 'thiếu package-lock.json — chạy `npm install` trong dự án rồi đẩy cả lockfile (npm ci cần nó)');
  const lock = readJson(lf, 'E_RM_NO_LOCK'); const lp = lock.packages || {};
  for (const [k] of rm) {
    const got = lp['node_modules/' + k]?.version;
    if (got !== ver) fail('E_RM_NO_LOCK', 'package-lock.json không khớp package.json (' + k + ': ' + (got || 'không có') + ' ≠ ' + ver + ') — chạy lại `npm install`');
  }
  return { ver, pkg, lockHash: crypto.createHash('sha256').update(fs.readFileSync(lf)).digest('hex'), isDefault: ver === def };
}

// remotion.json (tuỳ chọn) → { entry, composition, concurrency, props }
function readConfig(d) {
  const f = path.join(d, 'remotion.json'); const c = fs.existsSync(f) ? readJson(f, 'E_RM_CONFIG') : {};
  if (c === null || typeof c !== 'object' || Array.isArray(c)) fail('E_RM_CONFIG', 'remotion.json phải là một object');
  let entry = c.entry;
  if (entry === undefined) entry = ['src/index.ts', 'src/index.tsx', 'src/index.js', 'src/index.jsx'].find((p) => fs.existsSync(path.join(d, p)));
  if (typeof entry !== 'string' || !entry) fail('E_RM_CONFIG', 'không tìm thấy entry (src/index.ts …); khai báo "entry" trong remotion.json');
  if (path.isAbsolute(entry) || path.relative(d, path.resolve(d, entry)).startsWith('..')) fail('E_RM_CONFIG', '"entry" phải nằm trong thư mục dự án (got ' + JSON.stringify(entry) + ')');
  if (!fs.existsSync(path.join(d, entry))) fail('E_RM_CONFIG', 'entry ' + entry + ' không tồn tại');
  const composition = c.composition === undefined ? 'Main' : c.composition;
  if (typeof composition !== 'string' || !/^[A-Za-z0-9À-ɏ-]+$/.test(composition)) fail('E_RM_CONFIG', '"composition" phải là id của <Composition> (chữ, số, dấu -) (got ' + JSON.stringify(c.composition) + ')');
  const concurrency = c.concurrency === undefined ? 1 : c.concurrency;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) fail('E_RM_CONFIG', '"concurrency" phải là số nguyên 1–16 (got ' + JSON.stringify(c.concurrency) + ')');
  if (c.props !== undefined && (c.props === null || typeof c.props !== 'object' || Array.isArray(c.props))) fail('E_RM_CONFIG', '"props" phải là một object (inputProps của composition)');
  return { entry, composition, concurrency, props: c.props };
}

// Chromium headless shell của Playwright (cùng bản render.mjs dùng); không có thì Chromium đầy đủ của Playwright
async function chromePath() {
  if (process.env.RM_CHROME) { if (!fs.existsSync(process.env.RM_CHROME)) fail('E_RM_NO_CHROME', 'RM_CHROME=' + process.env.RM_CHROME + ' không tồn tại'); return process.env.RM_CHROME; }
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(process.env.HOME || '', '.cache', 'ms-playwright')].filter(Boolean);
  for (const r of roots) {
    let ds = []; try { ds = fs.readdirSync(r).filter((x) => /^chromium_headless_shell-\d+$/.test(x)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])); } catch (e) { /* */ }
    for (const x of ds) for (const sub of ['chrome-linux/headless_shell', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-mac/headless_shell']) { const p = path.join(r, x, sub); if (fs.existsSync(p)) return p; }
  }
  try { const { chromium } = await import('playwright'); const p = chromium.executablePath(); if (p && fs.existsSync(p)) return p; } catch (e) { /* */ }
  return '';
}

const lockStamp = (d) => path.join(d, 'node_modules', '.es-rm-lock');
function installed(d, info) {
  try {
    if (fs.readFileSync(lockStamp(d), 'utf8').trim() !== info.lockHash) return false;
    return ['remotion', '@remotion/cli'].every((k) => JSON.parse(fs.readFileSync(path.join(d, 'node_modules', k, 'package.json'), 'utf8')).version === info.ver);
  } catch (e) { return false; }
}

function run(cmd, args, opts, { quiet } = {}) {
  return new Promise((res) => {
    let tail = ''; let killed = false;
    const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => { killed = true; p.kill('SIGKILL'); }, TIMEOUT);
    const keep = (d) => { const s = String(d); if (!quiet && !/^(Rendered|Encoded|Bundling|Bundled|Getting composition|Composition) /m.test(s)) process.stdout.write(s); tail = (tail + s).slice(-8000); };
    p.stdout.on('data', keep); p.stderr.on('data', keep);
    p.on('error', (e) => { tail += '\n' + e.message; });
    p.on('close', (code) => { clearTimeout(t); res({ code: killed ? 'timeout' : code, tail: tail.replace(/\x1b\[[0-9;]*m/g, '') }); });
  });
}

async function main() {
  const info = checkProject(dir); RM = info.ver;
  const cfg = readConfig(dir);
  log('remotion', RM, id, info.isDefault ? '' : '(bản riêng của dự án; mặc định ' + RM_DEFAULT + ')');
  log('Remotion có giấy phép riêng (không phải mã nguồn mở): miễn phí cho cá nhân, công ty ≤ 3 người, tổ chức phi lợi nhuận; còn lại cần Company License — xem README');
  const t0 = Date.now();
  if (!installed(dir, info)) {
    log('npm ci --ignore-scripts', id);
    const r = await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, env: process.env });
    if (r.code !== 0) fail('E_RM_INSTALL', 'npm ci lỗi (exit ' + r.code + '): ' + r.tail.trim().slice(-1200));
    fs.writeFileSync(lockStamp(dir), info.lockHash + '\n');
  }
  const installSec = Math.round((Date.now() - t0) / 1000);
  const cli = path.join(dir, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
  if (!fs.existsSync(cli)) fail('E_RM_INSTALL', 'không thấy node_modules/@remotion/cli sau khi cài');
  const chrome = await chromePath();
  if (!chrome && process.env.RM_BROWSER_DOWNLOAD !== '1') fail('E_RM_NO_CHROME', 'không thấy Chromium của Playwright (npx playwright install chromium) — hoặc đặt RM_CHROME, hoặc RM_BROWSER_DOWNLOAD=1 để Remotion tự tải Chrome');
  let chromeVer = '';
  if (chrome) { try { chromeVer = execFileSync(chrome, ['--version'], { timeout: 20000 }).toString().trim(); } catch (e) { chromeVer = path.basename(path.dirname(path.dirname(chrome))); } }
  log('Chrome:', chrome || '(Remotion tự tải)', chromeVer ? '— ' + chromeVer : '');
  const args = [cli, 'render', cfg.entry, cfg.composition, mp4, '--codec=h264', '--pixel-format=yuv420p', '--color-space=bt709', '--enforce-audio-track', '--concurrency=' + cfg.concurrency, '--log=error', '--overwrite'];
  if (chrome) args.push('--browser-executable=' + chrome);
  let propsFile = '';
  if (cfg.props) { propsFile = path.join(outDir, '.' + id + '.props.json'); fs.writeFileSync(propsFile, JSON.stringify(cfg.props)); args.push('--props=' + propsFile); }
  try { fs.rmSync(mp4, { force: true }); } catch (e) { /* */ }
  const t1 = Date.now();
  // thư mục tạm riêng cho mỗi lần dựng (bundle webpack, hồ sơ Chrome): Remotion để lại khi lỗi → xoá hết sau khi xong
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'esr-rm-'));
  const r = await run(process.execPath, args, { cwd: dir, env: { ...process.env, TMPDIR: tmp } });
  if (propsFile) fs.rmSync(propsFile, { force: true });
  if (process.env.RM_KEEP_TMP !== '1') fs.rmSync(tmp, { recursive: true, force: true });
  if (r.code !== 0 || !fs.existsSync(mp4)) {
    const miss = r.tail.match(/Could not find composition with ID ([^\s.]+)\.?\s*(?:Available compositions:\s*([^\n]*))?/);
    if (miss) fail('E_RM_NO_COMPOSITION', 'không có composition "' + cfg.composition + '" trong ' + cfg.entry + (miss[2] ? ' (có: ' + miss[2].trim() + ')' : '') + ' — sửa "composition" trong remotion.json');
    if (r.code === 'timeout') fail('E_RM_TIMEOUT', 'Remotion render quá ' + TIMEOUT / 1000 + ' s (RM_TIMEOUT)');
    const msg = (r.tail.match(/Error[\s\S]*$/) || [r.tail])[0].split('\n').filter((l) => !/^\s+at /.test(l)).join('\n').trim().slice(-1500);
    fail('E_RM_RENDER', 'Remotion render lỗi (exit ' + r.code + '): ' + msg);
  }
  const j = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4]).toString());
  const v = (j.streams || []).find((s) => s.codec_type === 'video') || {}; const hasAudio = (j.streams || []).some((s) => s.codec_type === 'audio');
  const [fn, fd] = String(v.r_frame_rate || '0/1').split('/').map(Number);
  write({
    status: 'done', duration: +Number(v.duration || j.format?.duration || 0).toFixed(3), width: Number(v.width) || 0, height: Number(v.height) || 0,
    fps: fd ? +(fn / fd).toFixed(3) : 0, frames: Number(v.nb_frames) || 0, file: path.basename(mp4), has_audio: hasAudio,
    composition: cfg.composition, entry: cfg.entry, concurrency: cfg.concurrency, chrome: chromeVer || (chrome ? path.basename(chrome) : 'remotion-download'),
    render_seconds: Math.round((Date.now() - t1) / 1000), install_seconds: installSec,
  });
  log('done', mp4);
}

main().catch((e) => { console.error(e.message); write({ status: 'error', ...(e.code ? { code: e.code } : {}), message: String(e.message || e).slice(0, 1800) }); process.exitCode = 1; });
