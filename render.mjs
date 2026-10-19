#!/usr/bin/env node
// ES Render — dựng video từ "movie JSON" (định dạng JSON2Video mà node "Dựng video" của n8n tạo ra), không giới hạn độ dài.
//   node render.mjs jobs/<id>.json [out_dir]
// Cần: Chromium (Playwright), ffmpeg có libass, python3 + edge-tts (giọng Microsoft Neural miễn phí).
// Hỗ trợ: html / image (vị trí, start, duration, fade-in/out, z-index, keyframes x/y + easing, rotate, zoom),
//         voice (TTS + phụ đề karaoke), audio (seek, duration, volume, fade-out, loop), nhạc nền cấp movie,
//         chuyển cảnh fade / dissolve / slideleft, ducking nhạc dưới giọng, chuẩn hoá -14 LUFS / -1.5 dBTP.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';

const FPS = Number(process.env.RENDER_FPS || 30);
const CONC = Math.max(1, Number(process.env.RENDER_CONCURRENCY || Math.min(3, os.cpus().length - 1 || 1)));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const PY = process.env.PYTHON || 'python3';
const LUFS = Number(process.env.TARGET_LUFS || -14);

const jobPath = process.argv[2];
const outDir = path.resolve(process.argv[3] || 'out');
if (!jobPath) { console.error('usage: node render.mjs jobs/<id>.json [out_dir]'); process.exit(2); }
const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
const movie = job.movie || job;
const id = String(path.basename(jobPath, '.json') || job.id || 'video').replace(/[^\w.-]/g, '_'); // trùng tên file job để workflow GitHub tìm đúng kết quả
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'esr-'));
fs.mkdirSync(outDir, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const r3 = (x) => Math.round(x * 1000) / 1000;

function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'pipe'], ...opts });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(cmd + ' exit ' + c + ': ' + err.slice(-1500)))));
  });
}
const probeDur = (f) => num(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim(), 0);

async function download(url, dest, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 es-render' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      return dest;
    } catch (e) { if (i >= tries - 1) throw new Error('download failed ' + url + ': ' + e.message); await new Promise((s) => setTimeout(s, 1500 * (i + 1))); }
  }
}
const cache = new Map();
async function fetchAudio(url) {
  if (cache.has(url)) return cache.get(url);
  const ext = (url.split('?')[0].match(/\.(wav|mp3|m4a|ogg|aac|flac)$/i) || [, 'bin'])[1];
  const p = download(url, path.join(work, 'a' + cache.size + '.' + ext));
  cache.set(url, p);
  return p;
}

// ---------- 1. giọng đọc ----------
const W = num(movie.width, 1080); const H = num(movie.height, 1920);
const scenes = (movie.scenes || []).map((s, i) => ({ ...s, i, elements: s.elements || [] }));
const voices = [];
scenes.forEach((s) => s.elements.forEach((e, k) => {
  if (e.type === 'voice' && String(e.text || '').trim()) {
    const sp = num(e.speed, 1); const pct = Math.round((sp - 1) * 100);
    e._out = path.join(work, 'v' + s.i + '_' + k);
    voices.push({ text: String(e.text), voice: e.voice || 'en-US-AndrewMultilingualNeural', rate: (pct >= 0 ? '+' : '') + pct + '%', out: e._out });
  }
}));

async function main() {
  const t0 = Date.now();
  log('job', id, W + 'x' + H, scenes.length, 'scenes,', voices.length, 'voice lines, concurrency', CONC);
  if (voices.length) {
    fs.writeFileSync(path.join(work, 'tts.json'), JSON.stringify(voices));
    await run(PY, [path.join(path.dirname(new URL(import.meta.url).pathname), 'tts.py'), path.join(work, 'tts.json')]);
  }
  for (const s of scenes) for (const e of s.elements) if (e._out) { e._dur = probeDur(e._out + '.mp3'); e._words = JSON.parse(fs.readFileSync(e._out + '.words.json', 'utf8')); }

  // ---------- 2. thời lượng cảnh + mốc toàn cục ----------
  for (const s of scenes) {
    let D = num(s.duration, 0);
    if (!(D > 0)) {
      for (const e of s.elements) {
        const st = num(e.start, 0);
        if (e.type === 'voice' && e._out) D = Math.max(D, st + e._dur + num(e['extra-time'], 0));
        else if (e.type === 'audio' && num(e.duration, -1) > 0) D = Math.max(D, st + num(e.duration));
        else if ((e.type === 'html' || e.type === 'image') && num(e.duration, -2) > 0) D = Math.max(D, st + num(e.duration));
      }
    }
    s.frames = Math.max(FPS, Math.round(Math.max(1, D || 3) * FPS));
    s.D = s.frames / FPS;
    const tr = s.i > 0 && s.transition ? s.transition : null;
    s.trans = tr ? { style: tr.style || 'fade', d: Math.min(num(tr.duration, 0.3), s.D / 2, 1.5) } : null;
  }
  let acc = 0;
  scenes.forEach((s, i) => { if (i === 0) s.T = 0; else { s.T = acc - (s.trans ? s.trans.d : 0); } acc = s.T + s.D; });
  const TOTAL = r3(acc);
  log('timeline', TOTAL + 's');

  // ---------- 3. dựng hình từng cảnh (Chromium) ----------
  await renderScenes();

  // ---------- 4. ghép cảnh + phụ đề ----------
  const fontsDir = path.join(work, 'fonts'); fs.mkdirSync(fontsDir, { recursive: true });
  const subEl = (movie.elements || []).find((e) => e.type === 'subtitles');
  let assFile = '';
  if (subEl) { assFile = path.join(work, 'subs.ass'); fs.writeFileSync(assFile, buildAss(subEl.settings || {})); await fetchFont((subEl.settings || {})['font-family'] || 'Poppins', fontsDir); }
  const vid = path.join(work, 'video.mp4');
  await joinScenes(vid, assFile, fontsDir);

  // ---------- 5. âm thanh ----------
  const aud = path.join(work, 'audio.wav');
  await mixAudio(aud, TOTAL);

  // ---------- 6. xuất ----------
  const out = path.join(outDir, id + '.mp4');
  await run(FFMPEG, ['-y', '-v', 'error', '-i', vid, '-i', aud, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out]);
  const dur = probeDur(out);
  const res = { id, status: 'done', duration: r3(dur), width: W, height: H, file: path.basename(out), render_seconds: Math.round((Date.now() - t0) / 1000) };
  fs.writeFileSync(path.join(outDir, id + '.result.json'), JSON.stringify(res, null, 1));
  log('done', out, res.duration + 's in', res.render_seconds + 's');
}

// ---------- hình ----------
function sharedHead() {
  for (const s of scenes) for (const e of s.elements) if (e.type === 'html') { const m = String(e.html).match(/^((?:<link[^>]*>)*<style>[\s\S]*?<\/style>)/); if (m) return m[1]; }
  return '';
}
function sceneDoc(s, head) {
  const els = []; let html = '';
  s.elements.forEach((e, k) => {
    if (e.type !== 'html' && e.type !== 'image') return;
    const eid = 'e' + k; const st = num(e.start, 0);
    const dur = num(e.duration, -2); const end = dur > 0 ? st + dur : s.D + 1;
    const w = num(e.width, 0); const h = num(e.height, -1);
    const kf = (e.keyframes || []).map((f) => ({ t: num(f.time, 0), x: f.x, y: f.y, width: f.width, height: f.height, opacity: f.opacity, scale: f.scale, rotate: f.rotate, easing: f.easing || '' })).sort((a, b) => a.t - b.t);
    els.push({ id: eid, st, end, fi: num(e['fade-in'], 0), fo: num(e['fade-out'], 0), x: num(e.x, 0), y: num(e.y, 0), w, h, kf, rot: e.rotate ? { a: num(e.rotate.angle, 0), s: num(e.rotate.speed, 1) } : null, zoom: num(e.zoom, 0) });
    const z = num(e['z-index'], 0);
    const box = 'position:absolute;left:0;top:0;visibility:hidden;transform-origin:center center;z-index:' + (z * 100 + k) + ';';
    if (e.type === 'html') {
      let inner = String(e.html || ''); if (head && inner.startsWith(head)) inner = inner.slice(head.length);
      html += '<div id="' + eid + '" style="' + box + 'width:' + w + 'px;height:' + (h > 0 ? h + 'px' : 'auto') + ';overflow:hidden">' + inner + '</div>';
    } else {
      html += '<img id="' + eid + '" referrerpolicy="no-referrer" src="' + String(e.src).replace(/"/g, '&quot;') + '" style="' + box + 'width:' + w + 'px;height:' + (h > 0 ? h + 'px' : 'auto') + '">';
    }
  });
  const bg = s['background-color'] || '#000000';
  return '<!doctype html><html><head><meta charset="utf-8">' + head
    + '<style>html,body{margin:0;padding:0;width:' + W + 'px;height:' + H + 'px;overflow:hidden;background:' + bg + '}#stage{position:relative;isolation:isolate;z-index:0;width:' + W + 'px;height:' + H + 'px;overflow:hidden;background:' + bg + '}</style></head><body><div id="stage">' + html + '</div>'
    + '<script>window.SPEC=' + JSON.stringify(els).replace(/</g, '\\u003c') + ';' + PAGE_JS + '</script></body></html>';
}
const PAGE_JS = `
const EASE = (n) => { n = String(n || 'linear').toLowerCase();
  const c1 = 1.70158, c3 = c1 + 1;
  const f = { linear: (t) => t, ease: (t) => t * t * (3 - 2 * t), 'ease-in': (t) => t * t, 'ease-out': (t) => 1 - (1 - t) * (1 - t), 'ease-in-out': (t) => t * t * (3 - 2 * t),
    'ease-in-quad': (t) => t * t, 'ease-out-quad': (t) => 1 - (1 - t) * (1 - t), 'ease-in-out-quad': (t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    'ease-in-cubic': (t) => t * t * t, 'ease-out-cubic': (t) => 1 - Math.pow(1 - t, 3), 'ease-in-out-cubic': (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    'ease-in-sine': (t) => 1 - Math.cos((t * Math.PI) / 2), 'ease-out-sine': (t) => Math.sin((t * Math.PI) / 2), 'ease-in-out-sine': (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    'ease-in-back': (t) => c3 * t * t * t - c1 * t * t, 'ease-out-back': (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
    'ease-in-out-back': (t) => { const c2 = c1 * 1.525; return t < .5 ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2 : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2; },
    'ease-out-expo': (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)), 'ease-in-expo': (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)) };
  return f[n] || f.linear; };
const val = (kf, p, lt, base) => { const tr = kf.filter((k) => k[p] !== undefined && k[p] !== null); if (!tr.length) return base;
  if (lt <= tr[0].t) return Number(tr[0][p]);
  for (let i = 1; i < tr.length; i++) { const a = tr[i - 1], b = tr[i]; if (lt <= b.t) { const u = b.t === a.t ? 1 : (lt - a.t) / (b.t - a.t); return Number(a[p]) + (Number(b[p]) - Number(a[p])) * EASE(b.easing)(Math.max(0, Math.min(1, u))); } }
  return Number(tr[tr.length - 1][p]); };
window.seek = (t) => { let sig = ''; for (const e of SPEC) { const n = document.getElementById(e.id); if (!n) continue;
  if (t < e.st - 1e-6 || t >= e.end) { if (n.style.visibility !== 'hidden') n.style.visibility = 'hidden'; continue; }
  if (e.anims && e.anims.length) { const ms = Math.max(0, t - e.st) * 1000; let moving = false;
    for (const a of e.anims) { a.currentTime = ms; const tm = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null; if (!tm || !(ms >= tm.endTime)) moving = true; }
    if (moving) sig += e.id + '@' + Math.round(ms) + ';'; }
  const lt = t - e.st; let op = 1; if (e.fi > 0) op = Math.min(op, lt / e.fi); if (e.fo > 0) op = Math.min(op, (e.end - t) / e.fo);
  op = Math.max(0, Math.min(1, op)) * val(e.kf, 'opacity', lt, 1);
  const x = val(e.kf, 'x', lt, e.x), y = val(e.kf, 'y', lt, e.y);
  const w = val(e.kf, 'width', lt, e.w), h = val(e.kf, 'height', lt, e.h);
  let sc = val(e.kf, 'scale', lt, 1); if (e.zoom) sc *= 1 + e.zoom * 0.03 * Math.min(1, lt / Math.max(0.5, e.end - e.st));
  let rot = val(e.kf, 'rotate', lt, 0); if (e.rot) rot += e.rot.a * Math.min(1, lt / Math.max(0.01, e.rot.s));
  n.style.visibility = 'visible'; n.style.opacity = op; n.style.left = x + 'px'; n.style.top = y + 'px';
  if (w > 0) n.style.width = w + 'px'; if (h > 0) n.style.height = h + 'px';
  n.style.transform = (sc !== 1 ? 'scale(' + sc + ') ' : '') + (rot ? 'rotate(' + rot + 'deg)' : '');
  sig += e.id + ':' + op.toFixed(3) + ',' + Math.round(x * 2) + ',' + Math.round(y * 2) + ',' + Math.round(w) + ',' + Math.round(h) + ',' + sc.toFixed(4) + ',' + rot.toFixed(2) + ';'; }
  return sig; };
window.ready = async () => { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 8000))]);
  await Promise.all([...document.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 20000); }))));
  // CSS animation (vẽ nét, trôi nền, nhấp nháy…) dừng lại và tua theo thời gian của từng phần tử
  for (const e of SPEC) { const n = document.getElementById(e.id); if (!n) continue; e.anims = n.getAnimations({ subtree: true }); e.anims.forEach((a) => a.pause()); }
  return true; };
`;

async function loadChromium() {
  let pw;
  try { pw = await import('playwright'); } catch (e) { pw = await import('playwright-core'); }
  const opts = { args: ['--disable-gpu', '--font-render-hinting=none', '--disable-web-security', '--hide-scrollbars'] };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  if (process.env.RENDER_PROXY) opts.proxy = { server: process.env.RENDER_PROXY };
  return (pw.chromium || pw.default.chromium).launch(opts);
}
// tải trước mọi ảnh (Drive trả application/octet-stream → Chrome chặn ORB nếu nạp trực tiếp) → dùng file cục bộ
async function localizeImages() {
  const map = new Map(); let k = 0;
  for (const s of scenes) for (const e of s.elements) {
    if (e.type !== 'image' || !e.src || /^(file|data):/.test(e.src)) continue;
    if (!map.has(e.src)) {
      const dest = path.join(work, 'img' + (k++));
      map.set(e.src, download(e.src, dest).then(() => {
        const b = fs.readFileSync(dest).subarray(0, 12); const ext = b[0] === 0x89 ? '.png' : b[0] === 0xff ? '.jpg' : b.toString('ascii', 0, 4) === 'RIFF' ? '.webp' : b.toString('ascii', 0, 3) === 'GIF' ? '.gif' : /<svg|<\?xml/i.test(fs.readFileSync(dest, 'utf8').slice(0, 200)) ? '.svg' : '.png';
        fs.renameSync(dest, dest + ext); return 'file://' + dest + ext;
      }).catch((err) => { log('ảnh lỗi:', e.src.slice(0, 80), err.message); return e.src; }));
    }
    e._srcP = map.get(e.src);
  }
  for (const s of scenes) for (const e of s.elements) if (e._srcP) e.src = await e._srcP;
}
async function renderScenes() {
  await localizeImages();
  const head = sharedHead();
  const browser = await loadChromium();
  let next = 0;
  const worker = async () => {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    while (next < scenes.length) {
      const s = scenes[next++];
      const t0 = Date.now();
      const docPath = path.join(work, 'scene' + s.i + '.html');
      fs.writeFileSync(docPath, sceneDoc(s, head));
      await page.goto('file://' + docPath, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
      await page.evaluate(() => window.ready());
      s.file = path.join(work, 'seg' + String(s.i).padStart(3, '0') + '.mp4');
      const ff = spawn(FFMPEG, ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), s.file], { stdio: ['pipe', 'inherit', 'inherit'] });
      const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg scene ' + s.i + ' exit ' + c)))));
      // khung hình không đổi (đoạn giữ hình) → dùng lại ảnh trước, đỡ chụp lại
      let prevSig = null; let prevBuf = null; let shots = 0;
      for (let f = 0; f < s.frames; f++) {
        const sig = await page.evaluate((t) => window.seek(t), f / FPS);
        let buf = prevBuf;
        if (sig !== prevSig || !buf) {
          const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, optimizeForSpeed: true, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
          buf = Buffer.from(data, 'base64'); prevBuf = buf; prevSig = sig; shots++;
        }
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      }
      s.shots = shots;
      ff.stdin.end();
      await done;
      log('scene', s.i + 1 + '/' + scenes.length, s.D.toFixed(2) + 's', s.frames, 'frames,', s.shots, 'shots', ((Date.now() - t0) / 1000).toFixed(1) + 's');
    }
    await ctx.close();
  };
  await Promise.all(Array.from({ length: Math.min(CONC, scenes.length) }, worker));
  await browser.close();
}

async function joinScenes(out, assFile, fontsDir) {
  const XF = { fade: 'fade', dissolve: 'dissolve', slideleft: 'slideleft', slideright: 'slideright', slideup: 'slideup', slidedown: 'slidedown', wipeleft: 'wipeleft', wiperight: 'wiperight', circleopen: 'circleopen', fadeblack: 'fadeblack', fadewhite: 'fadewhite', smoothleft: 'smoothleft' };
  const args = ['-y', '-v', 'error'];
  scenes.forEach((s) => args.push('-i', s.file));
  let f = ''; let last = '[0:v]';
  for (let i = 1; i < scenes.length; i++) {
    const s = scenes[i]; const lab = '[x' + i + ']';
    if (s.trans && s.trans.d > 0.02) f += last + '[' + i + ':v]xfade=transition=' + (XF[s.trans.style] || 'fade') + ':duration=' + r3(s.trans.d) + ':offset=' + r3(s.T) + lab + ';';
    else f += last + '[' + i + ':v]concat=n=2:v=1:a=0' + lab + ';';
    last = lab;
  }
  if (assFile) f += last + 'ass=' + path.basename(assFile) + ':fontsdir=' + path.relative(work, fontsDir) + '[vout]';
  else f += last + 'null[vout]';
  fs.writeFileSync(path.join(work, 'vf.txt'), f);
  args.push('-filter_complex_script', 'vf.txt', '-map', '[vout]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', out);
  await run(FFMPEG, args, { cwd: work });
}

// ---------- phụ đề karaoke (ASS) ----------
function assColor(hex, alphaOverride) {
  const h = String(hex || '#FFFFFF').replace('#', ''); const rr = h.slice(0, 2) || 'FF', gg = h.slice(2, 4) || 'FF', bb = h.slice(4, 6) || 'FF';
  let a = h.length >= 8 ? 255 - parseInt(h.slice(6, 8), 16) : 0; if (alphaOverride != null) a = alphaOverride;
  return '&H' + a.toString(16).padStart(2, '0').toUpperCase() + bb.toUpperCase() + gg.toUpperCase() + rr.toUpperCase();
}
function assTime(t) { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return h + ':' + String(m).padStart(2, '0') + ':' + s.toFixed(2).padStart(5, '0'); }
function buildAss(st) {
  const font = st['font-family'] || 'Poppins'; const size = num(st['font-size'], 64); const per = Math.max(1, num(st['max-words-per-line'], 4));
  const x = num(st.x, W / 2), y = num(st.y, H * 0.78);
  const bold = num(st['font-weight'], 700) >= 600 ? -1 : 0;
  const shadow = num(st['shadow-offset'], 3); const outline = num(st['outline-width'], 0);
  let out = '[Script Info]\nScriptType: v4.00+\nPlayResX: ' + W + '\nPlayResY: ' + H + '\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\n'
    + 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
    + 'Style: Cap,' + font + ',' + size + ',' + assColor(st['word-color'] || '#FFD24A') + ',' + assColor(st['line-color'] || '#FFFFFF') + ',' + assColor(st['outline-color'] || '#000000') + ',' + assColor(st['shadow-color'] || '#00000099') + ',' + bold + ',0,0,0,100,100,0,0,1,' + outline + ',' + shadow + ',5,40,40,40,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  for (const s of scenes) for (const e of s.elements) {
    if (!e._words || !e._words.length) continue;
    const g = s.T + num(e.start, 0); const ws = e._words; const vEnd = g + e._dur;
    for (let i = 0; i < ws.length; i += per) {
      const chunk = ws.slice(i, i + per); const nextStart = i + per < ws.length ? g + ws[i + per].t : vEnd;
      const a = g + chunk[0].t; const b = Math.min(nextStart, g + chunk[chunk.length - 1].t + chunk[chunk.length - 1].d + 0.25);
      const txt = chunk.map((w, k) => { const nx = k + 1 < chunk.length ? chunk[k + 1].t : w.t + w.d; return '{\\k' + Math.max(1, Math.round((nx - w.t) * 100)) + '}' + String(w.w).replace(/[{}\\]/g, ''); }).join(' ');
      out += 'Dialogue: 0,' + assTime(a) + ',' + assTime(Math.max(b, a + 0.3)) + ',Cap,,0,0,0,,{\\an5\\pos(' + Math.round(x) + ',' + Math.round(y) + ')}' + txt + '\n';
    }
  }
  return out;
}
async function fetchFont(family, dir) {
  const key = family.toLowerCase().replace(/[^a-z0-9]/g, ''); const file = family.replace(/\s+/g, '') + '-Bold.ttf';
  const names = [file, family.replace(/\s+/g, '') + '[wght].ttf', family.replace(/\s+/g, '') + '[opsz,wght].ttf', family.replace(/\s+/g, '') + '-Regular.ttf'];
  for (const lic of ['ofl', 'apache', 'ufl']) for (const nm of names) {
    try { await download('https://raw.githubusercontent.com/google/fonts/main/' + lic + '/' + key + '/' + encodeURIComponent(nm), path.join(dir, nm.replace(/[\[\],]/g, '_')), 1); return; } catch (e) { /* thử tên khác */ }
  }
  log('font not found, libass dùng font mặc định:', family);
}

// ---------- âm thanh ----------
async function mixAudio(out, TOTAL) {
  const clips = []; // {file, start, seek, dur, vol, fo, bus}
  for (const s of scenes) for (const e of s.elements) {
    const st = s.T + num(e.start, 0);
    if (e.type === 'voice' && e._out) clips.push({ file: e._out + '.mp3', start: st, seek: 0, dur: e._dur, vol: num(e.volume, 1), fo: num(e['fade-out'], 0), bus: 'vox' });
    if (e.type === 'audio' && e.src) {
      const file = await fetchAudio(e.src); const len = probeDur(file); const seek = Math.max(0, num(e.seek, 0));
      let dur = num(e.duration, -1); if (dur === -2) dur = s.D - num(e.start, 0); if (!(dur > 0)) dur = Math.max(0.05, len - seek);
      dur = Math.min(dur, s.D - num(e.start, 0) + (s.i < scenes.length - 1 ? 0.3 : 0));
      const cm = String(e.comment || ''); const pm = cm.match(/pan=(-?[\d.]+)/); const km = cm.match(/peakAt=([\d.]+)/);
      clips.push({ file, start: st, seek, dur, vol: num(e.volume, 1), fo: num(e['fade-out'], 0), bus: 'fx', pan: pm ? Math.max(-1, Math.min(1, Number(pm[1]))) : 0, peak: st + (km ? Number(km[1]) : 0), stop: /\bstop\b/.test(cm) });
    }
  }
  const music = (movie.elements || []).find((e) => e.type === 'audio' && e.src);
  const args = ['-y', '-v', 'error']; let f = ''; let n = 0; const bus = { vox: [], fx: [] };
  for (const c of clips) {
    args.push('-i', c.file);
    const d = Math.max(0.05, c.dur); const ms = Math.round(c.start * 1000);
    const gl = c.pan ? Math.cos((c.pan + 1) * Math.PI / 4) * Math.SQRT2 : 1; const gr = c.pan ? Math.sin((c.pan + 1) * Math.PI / 4) * Math.SQRT2 : 1;
    f += '[' + n + ':a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=start=' + r3(c.seek) + ':duration=' + r3(d) + ',asetpts=PTS-STARTPTS,volume=' + c.vol
      + (c.pan ? ',pan=stereo|c0=' + gl.toFixed(3) + '*c0|c1=' + gr.toFixed(3) + '*c1' : '')
      + (c.fo > 0 ? ',afade=t=out:st=' + r3(Math.max(0, d - c.fo)) + ':d=' + r3(c.fo) : '') + ',adelay=' + ms + ':all=1[c' + n + '];';
    bus[c.bus].push('[c' + n + ']'); n++;
  }
  const mix = (labels, name) => { if (!labels.length) return false; f += labels.join('') + (labels.length > 1 ? 'amix=inputs=' + labels.length + ':normalize=0:dropout_transition=0' : 'anull') + ',apad=whole_dur=' + TOTAL + ',atrim=duration=' + TOTAL + '[' + name + '];'; return true; };
  const hasVox = mix(bus.vox, 'vox'); const hasFx = mix(bus.fx, 'fx0');
  if (hasFx) f += '[fx0]' + (hasVox ? 'equalizer=f=2500:t=q:w=1.2:g=-3,' : '') + 'anull[fx];';
  let hasMus = false;
  if (music) {
    const mf = await fetchAudio(music.src); args.push('-stream_loop', '-1', '-i', mf);
    const fo = num(music['fade-out'], 1);
    const stops = clips.filter((c) => c.stop).map((c) => "volume=enable='between(t," + r3(Math.max(0, c.peak - 0.45)) + ',' + r3(c.peak) + ")':volume=0.12").join(',');
    f += '[' + n + ':a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=' + TOTAL + ',asetpts=PTS-STARTPTS,volume=' + num(music.volume, 0.3) + (stops ? ',' + stops : '') + (fo > 0 ? ',afade=t=out:st=' + r3(Math.max(0, TOTAL - fo)) + ':d=' + r3(fo) : '') + '[mus0];';
    n++; hasMus = true;
    if (hasVox) { f += '[vox]asplit=2[voxm][voxk];[mus0][voxk]sidechaincompress=threshold=0.025:ratio=4:attack=20:release=400[mus];'; } else f += '[mus0]anull[mus];';
  }
  const parts = []; if (hasVox) parts.push(hasMus ? '[voxm]' : '[vox]'); if (hasFx) parts.push('[fx]'); if (hasMus) parts.push('[mus]');
  if (!parts.length) { f += 'anullsrc=r=48000:cl=stereo,atrim=duration=' + TOTAL + '[aout]'; }
  else f += parts.join('') + (parts.length > 1 ? 'amix=inputs=' + parts.length + ':normalize=0:dropout_transition=0,' : '') + 'apad=whole_dur=' + TOTAL + ',atrim=duration=' + TOTAL + ',loudnorm=I=' + LUFS + ':TP=-1.5:LRA=11,aresample=48000[aout]';
  fs.writeFileSync(path.join(work, 'af.txt'), f);
  args.push('-filter_complex_script', path.join(work, 'af.txt'), '-map', '[aout]', '-ac', '2', '-ar', '48000', out);
  await run(FFMPEG, args);
}

main().catch((e) => {
  console.error(e);
  fs.writeFileSync(path.join(outDir, id + '.result.json'), JSON.stringify({ id, status: 'error', message: String(e.message || e).slice(0, 1500) }, null, 1));
  process.exit(1);
});
