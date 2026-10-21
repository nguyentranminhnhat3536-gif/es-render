#!/usr/bin/env node
// QA: kiểm tra video đã dựng trước khi giao — khung đen, đứng hình, không tiếng, sai kích thước/độ dài, độ to, im lặng dài, chuẩn màu.
//   node qa.mjs out/<id>.mp4 out/<id>.result.json   (ghi kết quả vào trường "qa" của result)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FFMPEG = process.env.FFMPEG || 'ffmpeg'; const FFPROBE = process.env.FFPROBE || 'ffprobe';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const run = (cmd, args) => new Promise((res, rej) => { const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; p.stderr.on('data', (d) => { err += d; }); p.on('close', (c) => (c === 0 ? res(err) : rej(new Error(cmd + ' exit ' + c)))); });
function probe(file) {
  const j = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());
  const v = (j.streams || []).find((s) => s.codec_type === 'video'); const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  return { dur: Number(j.format?.duration) || 0, w: Number(v?.width) || 0, h: Number(v?.height) || 0, hasVideo: !!v, hasAudio: !!a, matrix: v?.color_space || '', pix: v?.pix_fmt || '' };
}

export async function check(file, { duration, width, height, speech = false } = {}) {
  const issues = []; const add = (level, msg) => issues.push({ level, msg });
  const p = probe(file);
  if (!p.hasVideo) return { pass: false, score: 0, issues: [{ level: 'error', msg: 'file không có hình' }] };
  if (!p.hasAudio) add('error', 'video không có âm thanh');
  if (p.matrix && p.matrix !== 'bt709') add('warn', 'màu chưa theo chuẩn BT.709 (' + p.matrix + ') — điện thoại có thể hiện lệch màu');
  if (p.pix && p.pix !== 'yuv420p') add('warn', 'định dạng điểm ảnh ' + p.pix + ' (mạng xã hội cần yuv420p)');
  if (width && height && (p.w !== width || p.h !== height)) add('error', 'sai kích thước khung: ' + p.w + 'x' + p.h + ' (cần ' + width + 'x' + height + ')');
  if (duration) { const d = Math.abs(p.dur - duration); if (d > 2) add('error', 'độ dài lệch ' + d.toFixed(1) + 's so với kế hoạch'); else if (d > 0.5) add('warn', 'độ dài lệch ' + d.toFixed(1) + 's'); }
  const err = await run(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-vf', 'scale=270:-2,blackdetect=d=0.4:pix_th=0.08,freezedetect=n=0.003:d=3',
    ...(p.hasAudio ? ['-af', 'ebur128=peak=true:framelog=verbose,silencedetect=n=-50dB:d=1.5'] : ['-an']), '-f', 'null', '-']);
  for (const m of err.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)) {
    const d = Number(m[3]); add(d >= 1 ? 'error' : 'warn', 'khung đen ' + d.toFixed(1) + 's tại ' + Number(m[1]).toFixed(1) + 's');
  }
  for (const m of err.matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g)) add('warn', 'hình đứng yên ' + Number(m[2]).toFixed(1) + 's tại ' + Number(m[1]).toFixed(1) + 's');
  const lufs = Number((err.match(/I:\s+(-?[\d.]+) LUFS/) || [])[1]); const peak = Number((err.match(/Peak:\s+(-?[\d.]+) dBFS/) || [])[1]);
  if (p.hasAudio && Number.isFinite(lufs) && (lufs < -17 || lufs > -11)) add('warn', 'độ to ' + lufs.toFixed(1) + ' LUFS (chuẩn mạng xã hội -14)');
  if (Number.isFinite(peak) && peak > -0.5) add('warn', 'đỉnh âm ' + peak.toFixed(1) + ' dBFS, có thể vỡ tiếng');
  if (speech) for (const m of err.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_duration: ([\d.]+)/g)) add('warn', 'im lặng ' + Number(m[2]).toFixed(1) + 's tại ' + Number(m[1]).toFixed(1) + 's');
  const score = Math.max(0, 10 - 4 * issues.filter((i) => i.level === 'error').length - issues.filter((i) => i.level === 'warn').length);
  return { pass: !issues.some((i) => i.level === 'error'), score, lufs: Number.isFinite(lufs) ? +lufs.toFixed(1) : null, issues };
}

// chạy từ dòng lệnh: bổ sung "qa" vào result
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, resFile] = process.argv.slice(2);
  const res = resFile && fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')) : {};
  check(file, { duration: res.duration, width: res.width, height: res.height }).then((q) => {
    log('QA', path.basename(file), q.pass ? 'đạt' : 'LỖI', q.score + '/10', q.issues.map((i) => i.msg).join('; '));
    if (resFile) fs.writeFileSync(resFile, JSON.stringify({ ...res, qa: q }, null, 1));
  }).catch((e) => { console.error('QA lỗi:', e.message); });
}
