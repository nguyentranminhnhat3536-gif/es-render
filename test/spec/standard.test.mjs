// node --test test/spec/standard.test.mjs — qa-standard.mjs (chuẩn es-short/1) + cover.mjs trên MP4 nhỏ do ffmpeg tạo (không mạng; Chromium chỉ cho bìa "designed").
// Tiêu đề hook giả = các khối trắng (màu ink) trong hộp tiêu đề y 380–1330, như compile báo trong result.hook.box.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { standard } from '../../qa-standard.mjs';
import { ROOT } from './fx.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esstd-'));
const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
// headline: 3 khối trắng; enable = biểu thức thời gian ffmpeg; dy = dời xuống (px) — "tiêu đề nhảy chỗ" trước khi hook nói xong
const head = (enable = '1', dy = 0) => [[90, 470, 900, 150], [90, 650, 640, 150], [90, 830, 760, 110]].map(([x, y, w, h]) => 'drawbox=x=' + x + ':y=' + (y + dy) + ':w=' + w + ':h=' + h + ':color=white:t=fill:enable=\'' + enable + '\'').join(',');
function mp4(name, { dur, w = 1080, h = 1920, vf = '', black0 = false }) {
  const f = path.join(dir, name + '.mp4');
  // nền tối + một khối màu chạy ngang (có chuyển động cho S5 / S7) + tiêu đề
  const base = 'color=c=0x140a24:s=' + w + 'x' + h + ':r=30:d=' + dur + ',format=yuv420p,drawbox=x=\'mod(t*400\\,' + (w - 200) + ')\':y=' + Math.round(h * 0.82) + ':w=200:h=120:color=0xff2e93:t=fill';
  ff(['-f', 'lavfi', '-i', base + (vf ? ',' + vf : '') + (black0 ? ',drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable=\'lt(t,0.2)\'' : ''), '-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=' + dur,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-c:a', 'aac', '-shortest', f]);
  return f;
}
const hook = { box: { x: 0, y: 380, w: 1080, h: 950 }, ink: '#FFFFFF', accent: '#FF2E93', bg: '#0B0510' };
const res = (o = {}) => ({ id: 'x', kind: 'spec', duration: 35, width: 1080, height: 1920, scenes: [{ t: 0, d: 2.6 }, { t: 2.6, d: 6 }], hook, voice_track: [{ scene: 0, start: 0.14, end: 2.4, words: 6 }, { scene: 1, start: 2.8, end: 8, words: 14 }], ...o });
const byId = (s, id) => s.checks.find((c) => c.id === id);
const cover = (input) => spawnSync(process.execPath, [ROOT + '/cover.mjs', input, dir], { encoding: 'utf8' });

test('35 s, hook nói xong 2.4 s, tiêu đề ở khung 0, đủ 3 ảnh bìa → đạt (S1 S2 S4 S4b S8 đều ok)', () => {
  const f = mp4('good', { dur: 35, vf: head() }); fs.writeFileSync(path.join(dir, 'good.result.json'), JSON.stringify(res({ id: 'good' })));
  const c = cover(path.join(dir, 'good.result.json')); assert.equal(c.status, 0, c.stderr);
  const r = JSON.parse(fs.readFileSync(path.join(dir, 'good.result.json'), 'utf8')); assert.equal(r.cover.mode, 'auto'); assert.equal(r.cover.thumb_offset_ms, 2400);
  const s = standard(f, r, { outDir: dir });
  return s.then((x) => { assert.equal(x.pass, true, JSON.stringify(x.failed));
    for (const id of ['S1', 'S2', 'S4', 'S4b', 'S8']) assert.equal(byId(x, id).ok, true, id + ' ' + JSON.stringify(byId(x, id)));
    assert.deepEqual(byId(x, 'S8').value, ['1080,1920', '1080,1440', '1080,1080']); assert.ok(byId(x, 'S4b').value.contrast >= 3 && byId(x, 'S4b').value.keep >= 60); });
});
test('25 s, khung 0 đen, hook 3.4 s → S1, S2, S4, S4b là lỗi; thiếu bìa → S8 lỗi', async () => {
  const f = mp4('bad', { dur: 25, vf: head(), black0: true });
  const x = await standard(f, res({ id: 'bad', duration: 25, voice_track: [{ scene: 0, start: 0.5, end: 3.4, words: 9 }] }), { outDir: dir });
  assert.equal(x.pass, false); for (const id of ['S1', 'S2', 'S4', 'S4b', 'S8']) assert.ok(x.failed.includes(id), id + ' phải lỗi: ' + x.failed.join(','));
  assert.equal(byId(x, 'S4b').note, 'headline missing on frame 0');
});
test('S4b: tiêu đề hiện muộn (1 s) → lỗi; tiêu đề bay đi trước khi hook nói xong → lỗi; job cũ không có hộp → không chấm S4b', async () => {
  const late = await standard(mp4('late', { dur: 35, vf: head('gte(t,1)') }), res({ id: 'late' }), { outDir: dir });
  assert.equal(byId(late, 'S4b').ok, false); assert.equal(byId(late, 'S4b').note, 'headline missing on frame 0'); assert.equal(byId(late, 'S4').ok, true, 'S4 (toàn khung) không bắt được lỗi này');
  const gone = await standard(mp4('gone', { dur: 35, vf: head('lt(t,1.5)') + ',' + head('gte(t,1.5)', 330) }), res({ id: 'gone' }), { outDir: dir });
  assert.equal(byId(gone, 'S4b').ok, false, JSON.stringify(byId(gone, 'S4b'))); assert.equal(byId(gone, 'S4b').note, 'headline moves / disappears before the hook ends');
  const legacy = await standard(mp4('legacy', { dur: 35, vf: head() }), { duration: 35, scenes: [] }, { outDir: dir, report_only: true });
  assert.equal(byId(legacy, 'S4b'), undefined); assert.equal(legacy.report_only, true); assert.equal(byId(legacy, 'S2').ok, false, 'không có voice_track → S2 không đạt (chỉ báo)');
});
test('cover.mjs auto: khung ngang → 16:9 + 1:1 giữa; khung vuông → 1:1; không biết cảnh → giây min(2.5, nửa độ dài)', () => {
  mp4('land', { dur: 4, w: 1920, h: 1080 }); fs.writeFileSync(path.join(dir, 'land.result.json'), JSON.stringify({ id: 'land', status: 'done', duration: 4, engine: 'hyperframes' }));
  let c = cover(path.join(dir, 'land.result.json')); assert.equal(c.status, 0, c.stderr); let r = JSON.parse(fs.readFileSync(path.join(dir, 'land.result.json'), 'utf8'));
  assert.equal(r.cover.thumb_offset_ms, 2000); assert.equal(r.cover.w + 'x' + r.cover.h, '1920x1080'); assert.ok(fs.existsSync(path.join(dir, r.cover.file_1x1)) && !r.cover.file_3x4);
  mp4('sq', { dur: 3, w: 1080, h: 1080 }); fs.writeFileSync(path.join(dir, 'sq.result.json'), JSON.stringify({ id: 'sq', status: 'done', duration: 3 }));
  c = cover(path.join(dir, 'sq.result.json')); assert.equal(c.status, 0, c.stderr); r = JSON.parse(fs.readFileSync(path.join(dir, 'sq.result.json'), 'utf8'));
  assert.equal(r.cover.w + 'x' + r.cover.h, '1080x1080'); assert.equal(r.cover.file_1x1, r.cover.file);
  assert.equal(cover(path.join(dir, 'missing.result.json')).status !== 0, true, 'không có MP4 / result → exit ≠ 0 (render.yml: || true)');
});
test('cover.mjs designed: movie.cover.html (Chromium) → 9:16 + 3:4 + 1:1 + bản B', () => {
  const html = (t) => '<!doctype html><body style="margin:0;width:1080px;height:1920px;background:#0B0510;color:#fff;font:900 160px sans-serif"><div style="position:absolute;top:600px;left:80px">' + t + '</div></body>';
  fs.writeFileSync(path.join(dir, 'des.json'), JSON.stringify({ id: 'des', movie: { width: 1080, height: 1920, scenes: [], cover: { title: 'A', html: html('A'), alt_title: 'B', alt_html: html('B'), thumb_t: 1.2 } } }));
  fs.writeFileSync(path.join(dir, 'des.result.json'), JSON.stringify({ id: 'des', status: 'done', duration: 35 }));
  const c = cover(path.join(dir, 'des.json')); assert.equal(c.status, 0, c.stderr); const r = JSON.parse(fs.readFileSync(path.join(dir, 'des.result.json'), 'utf8'));
  assert.equal(r.cover.mode, 'designed'); assert.equal(r.cover.thumb_offset_ms, 1200); assert.ok(r.cover.alt && fs.existsSync(path.join(dir, r.cover.alt.file)));
  for (const k of ['file', 'file_3x4', 'file_1x1']) assert.ok(fs.existsSync(path.join(dir, r.cover[k])), k);
  assert.ok(!fs.readdirSync(dir).some((f) => /^des\.cover.*\.(png|html)$/.test(f)), 'không để lại file tạm');
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
