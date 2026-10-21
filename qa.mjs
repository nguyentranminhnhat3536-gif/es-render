#!/usr/bin/env node
// QA: kiểm tra video đã dựng trước khi giao — khung đen, đứng hình, không tiếng, sai kích thước/độ dài, độ to, im lặng dài, chuẩn màu,
// chớp hình (1–2 khung lạc), khựng hình ở chỗ nối cảnh.
//   node qa.mjs out/<id>.mp4 out/<id>.result.json   (ghi kết quả vào trường "qa" của result)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FFMPEG = process.env.FFMPEG || 'ffmpeg'; const FFPROBE = process.env.FFPROBE || 'ffprobe';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const run = (cmd, args) => new Promise((res, rej) => { const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; p.stderr.on('data', (d) => { err += d; }); p.on('close', (c) => (c === 0 ? res(err) : rej(new Error(cmd + ' exit ' + c)))); });
const runOut = (cmd, args) => new Promise((res, rej) => { const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }); const out = []; let err = ''; p.stdout.on('data', (d) => out.push(d)); p.stderr.on('data', (d) => { err = (err + d).slice(-4000); }); p.on('close', (c) => (c === 0 ? res(Buffer.concat(out)) : rej(new Error(cmd + ' exit ' + c + ': ' + err)))); });

// chớp hình / khựng: mỗi khung thu về 24×24 màu, so khung liền nhau (d = chênh lệch trung bình 0–255).
// - chớp: 1–2 khung lạc giữa hai cú đổi hình lớn, mà không nằm "giữa" khung trước và sau (khác với chuyển cảnh hoà / quét:
//   ở đó mỗi điểm ảnh đi một chiều từ cảnh cũ sang cảnh mới). Khung một màu (chớp trắng / tối dần cố ý) bỏ qua.
// - khựng: khung lặp y hệt khung trước trong lúc hình đang chuyển động, ngay chỗ nối cảnh (joins: [{ t, d, td }] từ result.scenes);
//   khung một màu (đỉnh chớp trắng của fadewhite) không tính.
export async function temporal(file, { fps = 30, joins = [], maxDur = 900 } = {}) {
  const S = 24, P = S * S * 3;
  const buf = await runOut(FFMPEG, ['-v', 'error', '-t', String(maxDur), '-i', file, '-an', '-vf', `scale=${S}:${S}:flags=area,format=rgb24`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-']);
  const N = Math.floor(buf.length / P); const F = (i) => buf.subarray(i * P, (i + 1) * P);
  const diff = (a, b) => { let s = 0; for (let k = 0; k < P; k++) s += Math.abs(a[k] - b[k]); return s / P; };
  const sd = (f) => { let s = 0, s2 = 0; for (let k = 0; k < P; k++) { s += f[k]; s2 += f[k] * f[k]; } const m = s / P; return Math.sqrt(Math.max(0, s2 / P - m * m)); };
  const d = new Float32Array(N); for (let i = 1; i < N; i++) d[i] = diff(F(i - 1), F(i));
  const med = (a, b, skip = -9) => { const v = []; for (let q = Math.max(1, a); q < Math.min(N, b); q++) if (Math.abs(q - skip) > 2) v.push(d[q]); v.sort((x, y) => x - y); return v.length ? v[v.length >> 1] : 0; };
  const cut = (i) => i >= 1 && i < N && d[i] > 14 && d[i] > 3.5 * med(i - 15, i + 17, i) + 4;
  // vùng chuyển cảnh (± 1 khung) và chỗ nối (± 2 khung) tính bằng số khung
  const tw = joins.filter((j) => j.td > 0).map((j) => [Math.floor(j.t * fps) - 1, Math.ceil((j.t + j.td) * fps) + 1]);
  const jw = joins.filter((j, k) => k > 0 || j.t > 0).map((j) => [Math.floor(j.t * fps) - 2, Math.ceil((j.t + (j.td || 0)) * fps) + 2]);
  const inW = (w, a, b) => w.some(([x, y]) => b >= x && a <= y);
  const flicker = []; const hitch = [];
  for (let i = 1; i < N - 1; i++) {
    if (!cut(i)) continue;
    for (const L of [1, 2]) {
      const k = i + L; if (k >= N || !cut(k)) continue;
      let path = 0; for (let q = i; q <= k; q++) path += d[q];
      const back = diff(F(i - 1), F(k)); const flat = sd(F(i)) < 15 && sd(F(k - 1)) < 15;
      // biết chỗ chuyển cảnh → bỏ qua trong đó; không biết → chỉ báo khi rất rõ
      if (!flat && back < (joins.length ? 0.6 : 0.3) * path && !inW(tw, i, k - 1)) flicker.push({ t: +(i / fps).toFixed(2), frames: L });
      i = k - 1; break;
    }
  }
  if (jw.length) for (let i = 3; i < N - 3; i++) {
    if (!inW(jw, i, i)) continue;
    const m = Math.min(med(i - 3, i), med(i + 1, i + 4));
    if (m > 1.5 && d[i] < 0.12 * m && sd(F(i)) >= 15) { hitch.push({ t: +(i / fps).toFixed(2) }); i += 3; }
  }
  return { frames: N, flicker, hitch };
}
function probe(file) {
  const j = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());
  const v = (j.streams || []).find((s) => s.codec_type === 'video'); const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  const fr = String(v?.avg_frame_rate || '0/1').split('/');
  return { dur: Number(j.format?.duration) || 0, w: Number(v?.width) || 0, h: Number(v?.height) || 0, fps: Number(fr[0]) / Math.max(1, Number(fr[1]) || 1), hasVideo: !!v, hasAudio: !!a, matrix: v?.color_space || '', pix: v?.pix_fmt || '' };
}

export async function check(file, { duration, width, height, speech = false, scenes = [], needAudio = true } = {}) {
  const issues = []; const add = (level, msg) => issues.push({ level, msg });
  const p = probe(file);
  if (!p.hasVideo) return { pass: false, score: 0, issues: [{ level: 'error', msg: 'file không có hình' }] };
  if (!p.hasAudio) add(needAudio ? 'error' : 'warn', 'video không có âm thanh');
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
  try {
    const tq = await temporal(file, { fps: p.fps > 1 && p.fps <= 120 ? p.fps : 30, joins: Array.isArray(scenes) ? scenes : [] });
    const list = (arr, say) => { for (const x of arr.slice(0, 3)) add('warn', say(x)); if (arr.length > 3) add('warn', '… và ' + (arr.length - 3) + ' chỗ tương tự'); };
    list(tq.flicker, (x) => 'chớp hình ' + x.frames + ' khung tại ' + x.t + 's (khung lạc giữa hai cảnh)');
    list(tq.hitch, (x) => 'khựng hình (khung lặp) ở chỗ nối cảnh tại ' + x.t + 's');
  } catch (e) { log('QA chớp/khựng lỗi (bỏ qua):', String(e.message).slice(0, 160)); }
  const score = Math.max(0, 10 - 4 * issues.filter((i) => i.level === 'error').length - issues.filter((i) => i.level === 'warn').length);
  return { pass: !issues.some((i) => i.level === 'error'), score, lufs: Number.isFinite(lufs) ? +lufs.toFixed(1) : null, issues };
}

// chạy từ dòng lệnh: bổ sung "qa" vào result
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, resFile] = process.argv.slice(2);
  const res = resFile && fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')) : {};
  check(file, { duration: res.duration, width: res.width, height: res.height, scenes: res.scenes, needAudio: res.engine !== 'hyperframes' }).then((q) => {
    log('QA', path.basename(file), q.pass ? 'đạt' : 'LỖI', q.score + '/10', q.issues.map((i) => i.msg).join('; '));
    if (resFile) fs.writeFileSync(resFile, JSON.stringify({ ...res, qa: q }, null, 1));
  }).catch((e) => { console.error('QA lỗi:', e.message); });
}
