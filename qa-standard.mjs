// qa-standard.mjs — chuẩn es-short/1 đo trên video ĐÃ DỰNG (không tin số của bộ dựng):
//   export async function standard(file, res, { outDir, report_only }) → { standard, pass, report_only, checks: [{ id, level, ok, value, limit, note? }], failed }
// S1 độ dài 30–60 s · S2 hook nói xong ≤ 3.0 s (+1 khung, từ voice_track) · S3 giọng vào ngay · S4 khung 0 không trống
// · S4b tiêu đề hook đọc được ở khung 0 (chỉ job spec: vùng tiêu đề do compile báo) · S5 chuyển động trong 0.5 s · S6 cảnh đầu · S7 không đứng hình
// · S8 đủ ảnh bìa · S13 bìa giống khung hook. Mức error quyết định `pass` (job spec); job cũ (movie / HyperFrames / fframes / Remotion) chỉ báo (report_only).
//   node qa-standard.mjs out/<id>.mp4 out/<id>.result.json   (in ra JSON, không ghi file)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FFMPEG = process.env.FFMPEG || 'ffmpeg'; const FFPROBE = process.env.FFPROBE || 'ffprobe';
const LIM = { min: 30, max: 60, hookEnd: 3.0, voiceStart: 0.35, voiceStartErr: 0.6, f0sd: 10, motion: 1.0, firstCut: 3.6, dead: 2.5, deadDiff: 0.35, parity: 32, inkShare: 0.04, contrast: 3, keep: 0.6 }; // parity: same composition ≈ 8–27 (the cover title may differ from the hook headline), unrelated scenes ≈ 45+
const raw = (args) => execFileSync(FFMPEG, ['-v', 'error', ...args, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const stat = (b) => { let s = 0, s2 = 0; for (const v of b) { s += v; s2 += v * v; } const m = s / b.length; return { mean: m, sd: Math.sqrt(Math.max(0, s2 / b.length - m * m)) }; };
const r2 = (x) => Math.round(x * 100) / 100;

export async function standard(file, res = {}, { outDir = path.dirname(file), report_only = false } = {}) {
  const checks = []; const add = (id, level, ok, value, limit, note = '') => checks.push({ id, level, ok: !!ok, value, limit, ...(note ? { note } : {}) });
  const dur = Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim()) || 0;
  add('S1', 'error', dur >= LIM.min && dur <= LIM.max, r2(dur), LIM.min + '–' + LIM.max + ' s');
  const vt = Array.isArray(res.voice_track) ? res.voice_track : []; const first = vt.filter((v) => v.scene === 0).sort((a, b) => a.start - b.start)[0];
  const hookEnd = first ? first.end : null; const visualHook = !first && res.hook && res.hook.voice_mode === 'none';
  add('S2', 'error', visualHook || (hookEnd != null && hookEnd <= LIM.hookEnd + 1 / 30), hookEnd, '≤ ' + LIM.hookEnd + ' s', first ? '' : visualHook ? 'silent visual hook' : 'no speech in scene 1');
  if (res.hook && res.hook.voice_end != null && hookEnd != null && Math.abs(res.hook.voice_end - hookEnd) > 1 / 30 + 1e-3) add('S2b', 'warn', false, hookEnd, 'compile ' + res.hook.voice_end + ' ± 1 frame', 'render timeline differs from compile');
  const vs = vt.length ? Math.min(...vt.map((v) => v.start)) : null;
  add('S3', vs == null || vs <= LIM.voiceStartErr ? 'warn' : 'error', vs != null && vs <= LIM.voiceStart, vs, '≤ ' + LIM.voiceStart + ' s');
  const g0 = stat(raw(['-i', file, '-frames:v', '1', '-vf', 'scale=108:192:flags=area,format=gray']));
  add('S4', 'error', g0.sd >= LIM.f0sd && g0.mean > 8 && g0.mean < 247, { sd: r2(g0.sd), mean: r2(g0.mean) }, 'sd ≥ ' + LIM.f0sd + ', not black/white');
  // S4b (K6): trong hộp tiêu đề hook (res.hook.box, đã bỏ dải phụ đề) ở khung 0: (a) ≥ 4 % điểm ảnh mang màu chữ (ink / accent của palette),
  // (b) tương phản chữ : nền ≥ 3 : 1, (c) lúc hook nói xong, ≥ 60 % điểm chữ của khung 0 vẫn là chữ (± 2 điểm ảnh ở 1/4 cỡ: máy quay đẩy nhẹ vẫn đạt)
  // → tiêu đề nằm yên từ khung 0; nội dung MỚI hiện thêm trong hộp (dòng tick, gạch chân) không bị tính là lỗi. MAD cả hộp chỉ để tham khảo.
  const hk = res.hook || {};
  if (hk.box && hk.ink) {
    const [vw, vh] = execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',').map(Number);
    const bx = { x: Math.max(0, Math.round(hk.box.x)), y: Math.max(0, Math.round(hk.box.y)) }; bx.w = Math.max(8, Math.min(vw - bx.x, Math.round(hk.box.w))); bx.h = Math.max(8, Math.min(vh - bx.y, Math.round(hk.box.h)));
    const sw = Math.max(8, Math.round(bx.w / 4)), shh = Math.max(8, Math.round(bx.h / 4));
    const crop = (t) => raw([...(t > 0 ? ['-ss', t.toFixed(3)] : []), '-i', file, '-frames:v', '1', '-vf', 'crop=' + bx.w + ':' + bx.h + ':' + bx.x + ':' + bx.y + ',scale=' + sw + ':' + shh + ':flags=area,format=rgb24']);
    const rgb = (h) => { const m = /^#?([0-9a-f]{6})/i.exec(String(h || '')); const n = m ? parseInt(m[1], 16) : 0xffffff; return [n >> 16, (n >> 8) & 255, n & 255]; };
    const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const inks = [rgb(hk.ink), ...(hk.accent ? [rgb(hk.accent)] : [])]; const f0 = crop(0); const n = f0.length / 3;
    const isInk = (buf, i) => inks.some((c) => Math.hypot(buf[3 * i] - c[0], buf[3 * i + 1] - c[1], buf[3 * i + 2] - c[2]) < 72);
    let ink = 0; const il = []; const bl = []; const m0 = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const L = lum(f0[3 * i], f0[3 * i + 1], f0[3 * i + 2]); if (isInk(f0, i)) { ink++; m0[i] = 1; il.push(L); } else bl.push(L); }
    const med = (a) => { if (!a.length) return 0; const v = [...a].sort((x, y) => x - y); return v[v.length >> 1]; };
    const li = med(il), lb = med(bl); const contrast = (Math.max(li, lb) + 0.05) / (Math.min(li, lb) + 0.05);
    const tEnd = Math.max(0.1, Math.min(hookEnd != null ? hookEnd : hk.voice_end || 2, (res.scenes && res.scenes[1] ? res.scenes[1].t : dur) - 0.1, dur - 0.1));
    const gray = (b) => { const o = new Float32Array(b.length / 3); for (let i = 0; i < o.length; i++) o[i] = 0.299 * b[3 * i] + 0.587 * b[3 * i + 1] + 0.114 * b[3 * i + 2]; return o; };
    const fe = crop(tEnd); const drift = mad(gray(f0), gray(fe)); const share = ink / Math.max(1, n);
    const me = new Uint8Array(n); for (let i = 0; i < n; i++) me[i] = isInk(fe, i) ? 1 : 0;
    let kept = 0; for (let i = 0; i < n; i++) { if (!m0[i]) continue; const x = i % sw, y = (i / sw) | 0; let hit = false;
      for (let dy = -2; dy <= 2 && !hit; dy++) for (let dx = -2; dx <= 2 && !hit; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < sw && yy < shh && me[yy * sw + xx]) hit = true; }
      if (hit) kept++; }
    const keep = ink ? kept / ink : 0;
    add('S4b', 'error', share >= LIM.inkShare && contrast >= LIM.contrast && keep >= LIM.keep, { ink: r2(share * 100), contrast: r2(contrast), keep: r2(keep * 100), drift: r2(drift), at: r2(tEnd) },
      'chữ ≥ ' + LIM.inkShare * 100 + ' %, tương phản ≥ ' + LIM.contrast + ':1, giữ ≥ ' + LIM.keep * 100 + ' %', share < LIM.inkShare ? 'headline missing on frame 0' : contrast < LIM.contrast ? 'low contrast' : keep < LIM.keep ? 'headline moves / disappears before the hook ends' : '');
  }
  // one pass at 24×42 rgb for S5 / S7 (same cost order as qa.mjs temporal())
  const P = 24 * 42 * 3; const buf = raw(['-i', file, '-an', '-vf', 'scale=24:42:flags=area,format=rgb24']); const N = Math.floor(buf.length / P); const F = (i) => buf.subarray(i * P, (i + 1) * P);
  const fps = 30; const d = []; for (let i = 1; i < N; i++) d.push(mad(F(i - 1), F(i)));
  const early = d.slice(0, 15); const m05 = early.length ? early.reduce((a, b) => a + b, 0) / early.length : 0;
  add('S5', 'warn', m05 >= LIM.motion, r2(m05), '≥ ' + LIM.motion);
  const cut = (res.scenes || [])[1]; add('S6', 'warn', !cut || cut.t <= LIM.firstCut, cut ? cut.t : null, '≤ ' + LIM.firstCut + ' s');
  let run = 0, worst = 0, at = null; d.forEach((x, i) => { run = x < LIM.deadDiff ? run + 1 : 0; if (run > worst) { worst = run; at = (i + 1 - run) / fps; } });
  add('S7', 'warn', worst / fps < LIM.dead, r2(worst / fps), '< ' + LIM.dead + ' s still', at != null && worst / fps >= LIM.dead ? 'from ' + r2(at) + ' s' : '');
  const cv = res.cover || null; const need = cv ? [cv.file, cv.file_3x4, cv.file_1x1].filter(Boolean) : [];
  const dims = need.map((f) => { const p = path.join(outDir, f); if (!fs.existsSync(p) || fs.statSync(p).size > 8e6) return null; return execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', p]).toString().trim(); });
  add('S8', 'error', need.length >= 2 && !dims.includes(null) && dims[0] === '1080,1920', dims, '9:16 (+ 3:4 + 1:1) jpg < 8 MB');
  if (cv && cv.mode === 'designed' && cv.file) {
    // band y 380–1300 (captions band + brand mark excluded), best match over the hook scene: designed cover must show the same composition
    const band = (args) => raw([...args, '-vf', 'crop=1080:920:0:380,scale=54:46:flags=area,format=rgb24']);
    const c = band(['-i', path.join(outDir, cv.file), '-frames:v', '1']); const end = res.scenes && res.scenes[1] ? res.scenes[1].t : Math.min(3, dur);
    let best = 1e9; for (let t = 0; t < end - 0.05; t += 1 / 6) best = Math.min(best, mad(band(['-ss', t.toFixed(3), '-i', file, '-frames:v', '1']), c));
    add('S13', 'info', best <= LIM.parity, r2(best), '≤ ' + LIM.parity + ' (unrelated scenes ≈ 45+)');
  }
  // S13 chỉ ghi số đo (level info): bìa được phép khác chữ hook (W_COVER_ECHO) nên không tính là cảnh báo
  const fails = checks.filter((c) => !c.ok && c.level !== 'info'); const errors = fails.filter((c) => c.level === 'error');
  return { standard: 'es-short/1', pass: !errors.length, report_only, checks, failed: fails.map((c) => c.id) };
}

if (process.argv[1] && process.argv[1].endsWith('qa-standard.mjs') && process.argv[2]) {
  const [file, resFile] = process.argv.slice(2); const res = JSON.parse(fs.readFileSync(resFile, 'utf8'));
  standard(file, res).then((s) => { console.log(JSON.stringify(s, null, 1)); });
}
