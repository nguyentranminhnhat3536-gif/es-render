// rm.mjs (dự án Remotion, opt-in): `npm run test:rm`.
// Lần đầu cần mạng một lần để rm.mjs `npm ci` vào examples/remotion-hello/node_modules (~270 MB, gitignore); sau đó mọi lần dựng chạy
// không mạng: nếu có `unshare -n` (Linux, root) thì lệnh dựng chạy trong network namespace trống (chỉ có lo) — Remotion không tải gì.
// Dựng mẫu 2 lần → framemd5 bằng nhau; result.json đúng dạng; composition sai → E_RM_NO_COMPOSITION; thiếu lockfile / ghim lỏng → lỗi rõ ràng.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EX = path.join(REPO, 'examples', 'remotion-hello');
const RM = path.join(REPO, 'rm.mjs');
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'esr-rm-'));
process.on('exit', () => { if (process.env.RM_KEEP !== '1') fs.rmSync(TMP, { recursive: true, force: true }); });
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers', TMPDIR: TMP };

// bật lo trong namespace mới (không cần gói iproute2): ioctl SIOCGIFFLAGS / SIOCSIFFLAGS
const LO_UP = "import socket,fcntl,struct\ns=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)\nf=struct.unpack('16sH14s',fcntl.ioctl(s,0x8913,struct.pack('16sH14s',b'lo',0,bytes(14))))[1]\nfcntl.ioctl(s,0x8914,struct.pack('16sH14s',b'lo',f|1,bytes(14)))";
const CAN_OFFLINE = process.platform === 'linux' && spawnSync('unshare', ['-n', 'python3', '-I', '-c', LO_UP], { stdio: 'ignore' }).status === 0;

function rm(dir, out, { offline = false } = {}) {
  const cmd = offline && CAN_OFFLINE ? ['unshare', ['-n', 'sh', '-c', 'python3 -I -c "$0" && exec "$@"', LO_UP, process.execPath, RM, dir, out]] : [process.execPath, [RM, dir, out]];
  const r = spawnSync(cmd[0], cmd[1], { cwd: REPO, env, encoding: 'utf8', timeout: 600000 });
  let result = null; try { result = JSON.parse(fs.readFileSync(path.join(out, path.basename(dir) + '.result.json'), 'utf8')); } catch (e) { /* */ }
  return { code: r.status, log: (r.stdout || '') + (r.stderr || ''), result, mp4: path.join(out, path.basename(dir) + '.mp4') };
}
const md5 = (mp4) => execFileSync('ffmpeg', ['-v', 'error', '-i', mp4, '-map', '0:v:0', '-f', 'framemd5', '-'], { maxBuffer: 1 << 26 }).toString().split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop().trim());
// bản sao nhỏ của mẫu (không chép node_modules: trỏ symlink về node_modules của mẫu)
function copyEx(name, edit = {}) {
  const d = path.join(TMP, name); fs.cpSync(EX, d, { recursive: true, filter: (s) => !s.includes(path.sep + 'node_modules') });
  if (fs.existsSync(path.join(EX, 'node_modules'))) fs.symlinkSync(path.join(EX, 'node_modules'), path.join(d, 'node_modules'));
  for (const [f, v] of Object.entries(edit)) { if (v === null) fs.rmSync(path.join(d, f)); else fs.writeFileSync(path.join(d, f), typeof v === 'string' ? v : JSON.stringify(v)); }
  return d;
}

test('cài (lần đầu cần mạng) + dựng mẫu không mạng → result.json đúng dạng, 9:16, 3 s', { timeout: 900000 }, () => {
  const stamp = path.join(EX, 'node_modules', '.es-rm-lock');
  if (!fs.existsSync(stamp)) { const r0 = rm(EX, path.join(TMP, 'out0')); assert.equal(r0.code, 0, r0.log.slice(-3000)); }
  const r = rm(EX, path.join(TMP, 'out1'), { offline: true });
  if (!CAN_OFFLINE) test.diagnostic?.('unshare -n không dùng được: dựng có mạng (vẫn không gọi mạng nếu node_modules đã cài)');
  assert.equal(r.code, 0, r.log.slice(-3000));
  assert.doesNotMatch(r.log, /npm ci/, 'đã cài rồi thì không npm ci lại');
  const j = r.result;
  assert.equal(j.status, 'done'); assert.equal(j.id, 'remotion-hello'); assert.equal(j.engine, 'remotion'); assert.equal(j.remotion, '4.0.539');
  assert.equal(j.width, 1080); assert.equal(j.height, 1920); assert.equal(j.fps, 30); assert.equal(j.frames, 90); assert.equal(j.duration, 3);
  assert.equal(j.file, 'remotion-hello.mp4'); assert.equal(j.composition, 'Main'); assert.equal(j.has_audio, true);
  assert.match(j.chrome, /\d+\.\d+/); for (const k of ['render_seconds', 'install_seconds']) assert.equal(typeof j[k], 'number');
  const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt,color_space', '-of', 'json', r.mp4]).toString()).streams[0];
  assert.equal(p.pix_fmt, 'yuv420p'); assert.equal(p.color_space, 'bt709');
  // dựng lại → từng khung y hệt
  const r2 = rm(EX, path.join(TMP, 'out2'), { offline: true }); assert.equal(r2.code, 0, r2.log.slice(-3000));
  assert.deepEqual(md5(r2.mp4), md5(r.mp4));
});

test('composition không có → E_RM_NO_COMPOSITION, kể tên composition có thật', { timeout: 600000 }, () => {
  if (!fs.existsSync(path.join(EX, 'node_modules', '.es-rm-lock'))) return test.skip?.('chưa cài examples/remotion-hello (chạy test đầu trước)');
  const d = copyEx('rm-nocomp', { 'remotion.json': { entry: 'src/index.ts', composition: 'Nope' } });
  const r = rm(d, path.join(TMP, 'out3'), { offline: true });
  assert.equal(r.code, 1); assert.equal(r.result.status, 'error'); assert.equal(r.result.code, 'E_RM_NO_COMPOSITION');
  assert.match(r.result.message, /"Nope"/); assert.match(r.result.message, /có: Main/);
  assert.equal(fs.existsSync(r.mp4), false);
});

test('lỗi cấu hình: thiếu lockfile, ghim lỏng, lệch bản, không phải Remotion, remotion.json sai', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(EX, 'package.json'), 'utf8'));
  const cases = [
    ['E_RM_NO_LOCK', { 'package-lock.json': null }],
    ['E_RM_VERSION', { 'package.json': { ...pkg, dependencies: { ...pkg.dependencies, remotion: '^4.0.539' } } }],
    ['E_RM_VERSION', { 'package.json': { ...pkg, dependencies: { ...pkg.dependencies, '@remotion/cli': '4.0.538' } } }],
    ['E_RM_NOT_REMOTION', { 'package.json': { name: 'x', dependencies: { react: '19.2.0' } } }],
    ['E_RM_CONFIG', { 'remotion.json': { composition: 'Main', concurrency: 0 } }],
    ['E_RM_CONFIG', { 'remotion.json': { entry: '../../etc/passwd' } }],
  ];
  cases.forEach(([code, edit], i) => {
    const d = copyEx('rm-bad' + i, edit); const r = rm(d, path.join(TMP, 'outb' + i));
    assert.equal(r.code, 1, code + ': ' + r.log); assert.equal(r.result?.status, 'error'); assert.equal(r.result.code, code, r.result.message);
    assert.equal(r.result.engine, 'remotion');
  });
});
