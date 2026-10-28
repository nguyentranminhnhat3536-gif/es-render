// node --test test/spec/presynth.test.mjs — giọng đọc sẵn trong render.mjs (K3): phần tử voice có src file://…/x.mp3 + x.words.json
// chỉ được dùng thẳng khi file nằm trong ES_PRESYNTH_DIR (spec/run.mjs đặt = thư mục làm việc của nó). Job thường (kể cả job đẩy lên jobs/
// có src file://) vẫn đọc TTS như cũ. TTS giả: PYTHON = script ghi lại lần gọi và tạo mp3 + words.json (không mạng). Cần ffmpeg + Chromium.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { ROOT } from './fx.mjs';

const D = fs.mkdtempSync(path.join(os.tmpdir(), 'espre-'));
const pre = path.join(D, 'work'); fs.mkdirSync(path.join(pre, 'tts'), { recursive: true });
const mk = (base) => { execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=500:r=24000:d=1.2', '-c:a', 'libmp3lame', base + '.mp3']);
  fs.writeFileSync(base + '.words.json', JSON.stringify([{ t: 0.1, d: 0.4, w: 'Hello' }, { t: 0.6, d: 0.5, w: 'there' }])); };
mk(path.join(pre, 'tts', 'line')); const outside = path.join(D, 'elsewhere'); fs.mkdirSync(outside); mk(path.join(outside, 'line'));
// TTS giả: ghi "called" rồi tạo đúng cặp file mà tts.py tạo
const fake = path.join(D, 'fake-python.mjs');
fs.writeFileSync(fake, "#!/usr/bin/env node\nconst fs=require('fs');const {execFileSync}=require('child_process');const jobs=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));fs.appendFileSync(process.env.FAKE_TTS_LOG,jobs.length+'\\n');"
  + "for(const j of jobs){execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=f=700:r=24000:d=1','-c:a','libmp3lame',j.out+'.mp3']);fs.writeFileSync(j.out+'.words.json',JSON.stringify([{t:0.1,d:0.5,w:'fake'}]));}\n");
fs.renameSync(fake, fake.replace(/\.mjs$/, '.cjs')); const FAKE = fake.replace(/\.mjs$/, '.cjs'); fs.chmodSync(FAKE, 0o755);
const job = (src) => { const f = path.join(D, 'pre-' + Math.random().toString(36).slice(2, 8) + '.json');
  fs.writeFileSync(f, JSON.stringify({ width: 360, height: 640, creative: 'off', scenes: [{ elements: [{ type: 'html', html: '<div style="width:360px;height:640px;background:#123"></div>', x: 0, y: 0, width: 360, height: 640 }, { type: 'voice', text: 'Hello there', src }] }] })); return f; };
function render(src, env) {
  const log = path.join(D, 'tts-' + Math.random().toString(36).slice(2, 8) + '.log'); fs.writeFileSync(log, ''); const f = job(src); const out = path.join(D, 'out-' + path.basename(f, '.json'));
  const r = spawnSync(process.execPath, [ROOT + '/render.mjs', f, out], { encoding: 'utf8', env: { ...process.env, PYTHON: FAKE, FAKE_TTS_LOG: log, RENDER_CONCURRENCY: '1', ES_PRESYNTH_DIR: '', ...env } });
  assert.equal(r.status, 0, r.stdout + r.stderr); return { calls: fs.readFileSync(log, 'utf8').trim(), res: JSON.parse(fs.readFileSync(path.join(out, path.basename(f, '.json') + '.result.json'), 'utf8')) };
}
test('file:// trong ES_PRESYNTH_DIR → dùng thẳng (không gọi TTS), mốc từ = words.json đọc sẵn', () => {
  const r = render('file://' + path.join(pre, 'tts', 'line.mp3'), { ES_PRESYNTH_DIR: pre });
  assert.equal(r.calls, '', 'không gọi TTS'); assert.equal(r.res.voice_track.length, 1); assert.equal(r.res.voice_track[0].words, 2); assert.equal(r.res.voice_track[0].end, 1.1);
});
test('file:// NGOÀI ES_PRESYNTH_DIR, hoặc không đặt ES_PRESYNTH_DIR → đọc TTS như cũ', () => {
  assert.equal(render('file://' + path.join(outside, 'line.mp3'), { ES_PRESYNTH_DIR: pre }).calls, '1');
  assert.equal(render('file://' + path.join(pre, 'tts', 'line.mp3'), {}).calls, '1', 'job thường không có ES_PRESYNTH_DIR');
  assert.equal(render('file://' + pre + '/tts/../../elsewhere/line.mp3', { ES_PRESYNTH_DIR: pre }).calls, '1', '../ ra khỏi thư mục không lọt');
});
test.after(() => fs.rmSync(D, { recursive: true, force: true }));
