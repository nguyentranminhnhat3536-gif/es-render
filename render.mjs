#!/usr/bin/env node
// ES Render — dựng video từ "movie JSON" (định dạng JSON2Video mà node "Dựng video" của n8n tạo ra), không giới hạn độ dài.
//   node render.mjs jobs/<id>.json [out_dir]
// Cần: Chromium (Playwright), ffmpeg có libass, python3 + edge-tts (giọng Microsoft Neural miễn phí).
// Hỗ trợ: html / image / video (vị trí, start, duration, fade-in/out, z-index, keyframes x/y + easing, rotate, zoom, animation),
//         anim (trang anim.seek / motion2code làm cảnh hoặc lớp phủ: src, seek, speed, loop, until, fit, nền trong suốt — anim.mjs),
//         voice (TTS + phụ đề karaoke / pop / one-word / progressive / boxed), video (cắt seek/duration, fit cover/contain/blur,
//         âm thanh gốc hoặc file thay thế, words → phụ đề), audio (seek, duration, volume, fade-out, loop),
//         nhạc nền cấp movie, mọi chuyển cảnh xfade của ffmpeg, ducking nhạc dưới giọng, chuẩn hoá -14 LUFS / -1.5 dBTP.
// Sáng tạo (movie.creative / RENDER_CREATIVE, mặc định "bold"): tự đa dạng chuyển cảnh theo vai trò cảnh, máy quay
//         đẩy/trôi nhẹ, nhấn hình theo SFX boom/hit/riser, phụ đề nảy chữ + tô từ khoá, look màu (film/glow/vivid…).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import * as ANIM from './anim.mjs';
import * as LIBS2 from './libs.mjs';
import * as EL from './els.mjs';

const FPS = Number(process.env.RENDER_FPS || 30);
const CONC = Math.max(1, Number(process.env.RENDER_CONCURRENCY || Math.min(3, os.cpus().length - 1 || 1)));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const PY = process.env.PYTHON || 'python3';
const LUFS = Number(process.env.TARGET_LUFS || -14);

const jobPath = process.argv[2];
// es-editor: engine có phần tử / thư viện nào (anim; dotlottie, rive; lib:anime4, lib:motion; anim-contract)
if (jobPath === '--features') { console.log(JSON.stringify({ features: [...ANIM.FEATURES, ...EL.FEATURES] })); process.exit(0); }
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

// ---------- sáng tạo ----------
// movie.creative: "bold" | "subtle" | "off" hoặc { level, seed, transitions: "auto"|"keep", camera, beats, subtitles, look }
const CR = (() => {
  let c = movie.creative ?? process.env.RENDER_CREATIVE ?? 'bold';
  if (!c || typeof c !== 'object') c = { level: c === false ? 'off' : c === true ? 'bold' : String(c) };
  const level = ['off', 'subtle', 'bold'].includes(c.level) ? c.level : 'bold'; const on = level !== 'off';
  return { level, on, k: level === 'subtle' ? 0.5 : 1, seed: String(c.seed ?? job.id ?? id), transitions: c.transitions || (on ? 'auto' : 'keep'),
    camera: c.camera ?? on, beats: c.beats ?? on, subtitles: c.subtitles || '', look: c.look || process.env.RENDER_LOOK || 'none' };
})();
// số ngẫu nhiên cố định theo seed → cùng job dựng lại vẫn ra cùng một video
function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
const pick = (r, list, prev) => { const o = list.filter((x) => x !== prev); return o.length ? o[Math.floor(r() * o.length)] : list[0]; };

function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'pipe'], ...opts });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(cmd + ' exit ' + c + ': ' + err.slice(-1500)))));
  });
}
const probeDur = (f) => num(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim(), 0);
// màu video nguồn: { codec_name, width, height, color_space, color_transfer, color_primaries } (lỗi → {})
const probeColor = (f) => { try { return Object.fromEntries(execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,color_space,color_transfer,color_primaries', '-of', 'default=nw=1', f]).toString().trim().split('\n').map((l) => l.split('='))); } catch (e) { return {}; } };
// tone map HDR cần zscale (libzimg, có sẵn trong ffmpeg apt của Ubuntu); bản ffmpeg thiếu → bỏ tone map (màu nhạt) thay vì hỏng cả job
let zs; const hasZscale = () => { if (zs === undefined) { try { zs = /\bzscale\b/.test(execFileSync(FFMPEG, ['-hide_banner', '-filters']).toString()); } catch (e) { zs = false; } if (!zs) log('ffmpeg thiếu zscale → video HDR/BT.2020 không được tone map'); } return zs; };

// max > 0 (phần tử dotlottie / rive): quá max byte → lỗi E_ASSET_TOO_BIG ngay, không tải hết, không thử lại
async function download(url, dest, tries = 4, max = 0) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 es-render' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (max > 0) { const big = () => Object.assign(new Error('E_ASSET_TOO_BIG: ' + url + ' > ' + (max / 1048576).toFixed(0) + ' MB'), { big: true });
        if (Number(r.headers.get('content-length')) > max) { try { await r.body.cancel(); } catch (x) { /* */ } throw big(); }
        const parts = []; let n = 0; const rd = r.body.getReader();
        for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > max) { try { await rd.cancel(); } catch (x) { /* */ } throw big(); } parts.push(value); }
        fs.writeFileSync(dest, Buffer.concat(parts)); return dest; }
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      return dest;
    } catch (e) { if (e.big) throw e; if (i >= tries - 1) throw new Error('download failed ' + url + ': ' + e.message); await new Promise((s) => setTimeout(s, 1500 * (i + 1))); }
  }
}
const cache = new Map();
// URL http(s) → tải về work; file:// hoặc đường dẫn tuyệt đối → dùng thẳng (job dựng từ footage cục bộ)
async function fetchAudio(url) {
  if (/^file:\/\//.test(url)) return decodeURIComponent(new URL(url).pathname);
  if (path.isAbsolute(url)) return url;
  if (cache.has(url)) return cache.get(url);
  const ext = (url.split('?')[0].match(/\.(wav|mp3|m4a|ogg|aac|flac|mp4|mov|webm|mkv)$/i) || [, 'bin'])[1];
  const p = download(url, path.join(work, 'a' + cache.size + '.' + ext));
  cache.set(url, p);
  return p;
}
const hasAudio = (f) => { try { return !!execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', f]).toString().trim(); } catch (e) { return false; } };

// ---------- 1. giọng đọc ----------
const W = num(movie.width, 1080); const H = num(movie.height, 1920);
const scenes = (movie.scenes || []).map((s, i) => ({ ...s, i, elements: s.elements || [] }));
const voices = [];
const PRESYNTH = process.env.ES_PRESYNTH_DIR ? path.resolve(process.env.ES_PRESYNTH_DIR) : '';
scenes.forEach((s) => s.elements.forEach((e, k) => {
  if (e.type === 'voice' && String(e.text || '').trim()) {
    const sp = num(e.speed, 1); const pct = Math.round((sp - 1) * 100);
    // giọng đã đọc sẵn (spec/run.mjs): src = file:///…/x.mp3 cạnh x.words.json → không gọi edge-tts lần nữa, mốc thời gian đúng như lúc compile.
    // Chỉ nhận file nằm trong ES_PRESYNTH_DIR (thư mục làm việc do spec/run.mjs đặt) — job thường đẩy lên jobs/ vẫn đọc TTS như cũ
    const pre = PRESYNTH && /^file:\/\//.test(String(e.src || '')) ? path.resolve(decodeURIComponent(new URL(e.src).pathname)) : '';
    if (pre && pre.startsWith(PRESYNTH + path.sep) && /\.mp3$/i.test(pre) && fs.existsSync(pre) && fs.existsSync(pre.slice(0, -4) + '.words.json')) { e._out = pre.slice(0, -4); e._rate = pct; return; }
    e._out = path.join(work, 'v' + s.i + '_' + k); e._rate = pct;
    voices.push({ text: String(e.text), voice: e.voice || 'en-US-AndrewMultilingualNeural', rate: (pct >= 0 ? '+' : '') + pct + '%', out: e._out });
  }
}));

async function main() {
  const t0 = Date.now();
  log('job', id, W + 'x' + H, scenes.length, 'scenes,', voices.length, 'voice lines, concurrency', CONC);
  // trang anim.seek: kiểm tra + chạy thử trước TTS (lỗi hợp đồng báo sớm, đọc anim.duration cho thời lượng cảnh); job không có anim → bỏ qua
  await ANIM.prepare(scenes, { jobPath, movie, work, W, H, FPS, log, launch: loadChromium, vclock: VCLOCK,
    seedFor: (k) => seedTag(Math.floor(rng(CR.seed + ':anim:' + k)() * 4294967296)) });
  // phần tử dotlottie / rive → html + libs (els.mjs); job không có thì không làm gì
  await EL.expand(scenes, { jobPath, work, W, H, log, download });
  for (const s of scenes) for (const e of s.elements) if (e.type === 'html' && extraKeys([e]).length) for (const w of LIBS2.lint(e.html)) log('scene', s.i + 1 + ':', w);
  if (voices.length) {
    fs.writeFileSync(path.join(work, 'tts.json'), JSON.stringify(voices));
    await run(PY, [path.join(path.dirname(new URL(import.meta.url).pathname), 'tts.py'), path.join(work, 'tts.json')]);
  }
  for (const s of scenes) for (const e of s.elements) if (e._out) { e._dur = probeDur(e._out + '.mp3'); e._words = JSON.parse(fs.readFileSync(e._out + '.words.json', 'utf8')); }
  // video có sẵn mốc từ (lời đã chép của footage) → phụ đề như giọng TTS
  for (const s of scenes) for (const e of s.elements) if (e.type === 'video' && Array.isArray(e.words) && e.words.length) { e._words = e.words; e._dur = num(e.duration, 0); if (!e.text) e.text = e.words.map((w) => w.w + (w.p || '')).join(' '); }

  // ---------- 2. thời lượng cảnh + mốc toàn cục ----------
  for (const s of scenes) {
    let D = num(s.duration, 0);
    if (!(D > 0)) {
      for (const e of s.elements) {
        const st = num(e.start, 0);
        if (e.type === 'voice' && e._out) D = Math.max(D, st + e._dur + num(e['extra-time'], 0));
        else if (e.type === 'audio' && !e.spill && num(e.duration, -1) > 0) D = Math.max(D, st + num(e.duration));
        else if ((e.type === 'html' || e.type === 'image' || e.type === 'video') && num(e.duration, -2) > 0) D = Math.max(D, st + num(e.duration));
        else if (ANIM.isLive(e)) D = Math.max(D, st + ANIM.span(e));
      }
    }
    s.frames = Math.max(Math.round(FPS * 0.2), Math.round((D > 0 ? D : 3) * FPS)); // jump cut có thể < 1s
    s.D = s.frames / FPS;
    const tr = s.i > 0 && s.transition && !/^(none|cut)$/i.test(s.transition.style || '') ? s.transition : null;
    s.trans = tr ? { style: tr.style || 'fade', d: Math.min(num(tr.duration, 0.3), s.D / 2, 1.5) } : null;
  }
  direct();
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
  if (subEl) { const st = subEl.settings || {}; assFile = path.join(work, 'subs.ass'); fs.writeFileSync(assFile, buildAss(st)); await fetchFont(st['font-family'] || 'Poppins', fontsDir, st['font-weight'] || 700); }
  const vid = path.join(work, 'video.mp4');
  await joinScenes(vid, assFile, fontsDir);

  // ---------- 5. âm thanh ----------
  const aud = path.join(work, 'audio.wav');
  await mixAudio(aud, TOTAL);

  // ---------- 6. xuất ----------
  const out = path.join(outDir, id + '.mp4');
  await run(FFMPEG, ['-y', '-v', 'error', '-i', vid, '-i', aud, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out]);
  const dur = probeDur(out);
  const res = { id, status: 'done', duration: r3(dur), width: W, height: H, file: path.basename(out), render_seconds: Math.round((Date.now() - t0) / 1000), creative: CR.level,
    scenes: scenes.map((s) => ({ t: r3(s.T), d: r3(s.D), ...(s.trans ? { trans: s.trans.style, td: r3(s.trans.d) } : {}) })), // mốc nối cảnh cho QA
    ...ANIM.result(scenes), // anims: [...] chỉ khi job có phần tử anim
    // lời đọc đo được (giọng TTS + lời của footage): qa-standard.mjs (chuẩn es-short/1) đọc hook xong lúc nào
    voice_track: scenes.flatMap((s) => s.elements.filter((e) => e._words && e._words.length).map((e) => { const st = s.T + num(e.start, 0); const lw = e._words[e._words.length - 1];
      return { scene: s.i, start: r3(st + num(e._words[0].t, 0)), end: r3(st + num(lw.t, 0) + num(lw.d, 0)), words: e._words.length, dur: r3(num(e._dur, 0)), ...(e.type === 'voice' ? { voice: e.voice || 'en-US-AndrewMultilingualNeural', rate: num(e._rate, 0) } : { source: true }) }; })),
    fps: FPS, finished_at: new Date().toISOString() };
  fs.writeFileSync(path.join(outDir, id + '.result.json'), JSON.stringify(res, null, 1));
  log('done', out, res.duration + 's in', res.render_seconds + 's');
}

// ---------- đạo diễn: chuyển cảnh + máy quay theo vai trò cảnh ----------
// tên chuyển cảnh lấy thẳng từ ffmpeg đang cài (6.1 có ~57 kiểu: smoothleft, circleopen, coverup, hblur, fadewhite…)
const XFADE = (() => {
  try { return new Set([...execFileSync(FFMPEG, ['-hide_banner', '-h', 'filter=xfade']).toString().matchAll(/^\s+([a-z]+)\s+\d+\s+\.\.FV/gm)].map((m) => m[1])); } catch (e) { return new Set(['fade', 'dissolve', 'slideleft', 'slideright', 'slideup', 'slidedown', 'wipeleft', 'wiperight', 'circleopen', 'fadeblack', 'fadewhite', 'smoothleft']); }
})();
// chuyển cảnh riêng: máy quay trong Chromium tạo đà (zoom xuyên / lia nhanh có nhoè chuyển động), ffmpeg chỉ ghép bằng xfade nền
// (không dùng xfade "zoomin" của ffmpeg: phóng kiểu nearest nên vỡ hạt)
// whip: hai cảnh cùng lao theo một hướng (máy quay) và hoà vào nhau qua nhoè — không dùng slide (lộ đường ghép giữa hai khung)
const CUSTOM = { zoom: { xf: 'fade', k: 'z' }, whip: { xf: 'hblur', k: 'x' }, 'whip-up': { xf: 'fade', k: 'y' } };
const okT = (x) => XFADE.has(x) || (!!CUSTOM[x] && XFADE.has(CUSTOM[x].xf));
// vai trò lấy từ comment "s02 item · badge_grid"; thiếu thì đoán theo vị trí
function role(s) {
  const m = String(s.comment || '').toLowerCase().match(/^\s*s?\d+\s+([a-z_]+)/); const r = m ? m[1] : s.i === 0 ? 'hook' : s.i === scenes.length - 1 ? 'end' : 'feature';
  return /^(hook|intro)/.test(r) ? 'hook' : /^(item|step)/.test(r) ? 'item' : /^(offer|cta)/.test(r) ? 'offer' : /^(end|outro)/.test(r) ? 'end' : 'feature';
}
const TRANS = {
  bold: { item: ['zoom', 'whip-up', 'smoothup', 'circleopen', 'coverup'], feature: ['whip', 'smoothleft', 'coverleft', 'revealleft', 'hblur', 'dissolve'], offer: ['zoom', 'circleopen'], end: ['fadewhite', 'circleclose', 'fadeblack'] },
  subtle: { item: ['smoothup', 'dissolve', 'fadeblack'], feature: ['fade', 'smoothleft', 'hblur', 'dissolve'], offer: ['dissolve', 'fadewhite'], end: ['fadeblack', 'fade'] },
};
const MOVES = { hook: ['push'], item: ['push', 'rise'], feature: ['push', 'pull', 'left', 'right', 'rise'], offer: ['push'], end: ['pull'] };
// SFX có "boom/hit…" → giật hình (zoom + rung), "riser" → đẩy dần tới đỉnh; mốc = start + peakAt trong comment
function sfxBeat(e) {
  const c = String(e.comment || '').toLowerCase(); const t = num(e.start, 0) + num((c.match(/peakat=([\d.]+)/) || [])[1], 0);
  const hard = /\b(hit|impact|slam)\b/.test(c);
  if (hard || /\b(boom|thud|bass|drop|punch)\b/.test(c)) return { k: 'p', t, a: (hard ? 0.045 : 0.03) * CR.k, sh: CR.level === 'bold' ? (hard ? 12 : 7) : 0, ph: t * 7.3 };
  if (/\b(riser|swell)\b/.test(c)) return { k: 'r', t, t0: num(e.start, 0), a: 0.03 * CR.k };
  return null;
}
function direct() {
  const rt = rng(CR.seed + ':t'); const rc = rng(CR.seed + ':c'); let pt = ''; let pc = ''; const lv = CR.level === 'subtle' ? 'subtle' : 'bold';
  for (const s of scenes) {
    s.role = role(s);
    if (s.trans) {
      // "fade" là mặc định của bộ tạo kịch bản → coi như chưa chọn, đổi sang kiểu hợp vai trò cảnh (không lặp kiểu liền trước)
      let st = String(s.trans.style).toLowerCase(); const pal = (TRANS[lv][s.role] || TRANS[lv].item).filter(okT);
      if (st === 'auto' || (CR.transitions === 'auto' && st === 'fade')) st = pal.length ? pick(rt, pal, pt) : 'fade';
      s.trans.style = okT(st) ? st : 'fade'; pt = s.trans.style;
    }
    const mv = CR.camera ? pick(rc, MOVES[s.role], pc) : 'still'; pc = mv; const z = 0.04 * CR.k; const d = 14 * CR.k;
    const [s0, s1, x0, x1, y0, y1] = { still: [1, 1, 0, 0, 0, 0], push: [1, 1 + z, 0, 0, 0, 0], pull: [1 + z, 1, 0, 0, 0, 0], left: [1 + z * 0.75, 1 + z * 0.75, d, -d, 0, 0], right: [1 + z * 0.75, 1 + z * 0.75, -d, d, 0, 0], rise: [1 + z * 0.75, 1 + z * 0.75, 0, 0, d * 1.3, -d * 1.3] }[mv];
    s.cam = { mv, s0, s1, x0, x1, y0, y1, D: s.D, beats: CR.beats ? s.elements.filter((e) => e.type === 'audio').map(sfxBeat).filter(Boolean) : [] };
  }
  scenes.forEach((s, i) => { const c = s.trans && s.trans.d > 0.02 && CUSTOM[s.trans.style]; if (c) s.cam.in = scenes[i - 1].cam.out = { k: c.k, d: s.trans.d }; });
  for (const s of scenes) if (s.cam.mv === 'still' && !s.cam.beats.length && !s.cam.in && !s.cam.out) s.cam = null;
  if (CR.on) log('creative', CR.level, '| transitions:', scenes.filter((s) => s.trans).map((s) => s.trans.style).join(' '), '| camera:', scenes.map((s) => (s.cam ? s.cam.mv : '-')).join(' '));
}

// ---------- hình ----------
function sharedHead() {
  for (const s of scenes) for (const e of s.elements) if (e.type === 'html') { const m = String(e.html).match(/^((?:<link[^>]*>)*<style>[\s\S]*?<\/style>)/); if (m) return m[1]; }
  return '';
}
// thư viện chuyển động nhúng từ node_modules (không phụ thuộc CDN): phần tử khai báo "libs": ["gsap","anime","lottie","three"]
// + plugin GSAP (miễn phí từ 3.13): "splittext", "drawsvg", "morphsvg", "motionpath", "scrambletext", "text", "customease",
//   "custombounce", "customwiggle", "easepack", "flip", "physics2d", "physicsprops" — tự nạp gsap trước và tự registerPlugin
const GSAP_PLUGINS = { customease: ['CustomEase'], custombounce: ['CustomBounce'], customwiggle: ['CustomWiggle'], easepack: ['EasePack', 'ExpoScaleEase', 'RoughEase', 'SlowMo'],
  splittext: ['SplitText'], drawsvg: ['DrawSVGPlugin'], morphsvg: ['MorphSVGPlugin'], motionpath: ['MotionPathPlugin'], scrambletext: ['ScrambleTextPlugin'], text: ['TextPlugin'],
  flip: ['Flip'], physics2d: ['Physics2DPlugin'], physicsprops: ['PhysicsPropsPlugin'] };
const LIBS = { gsap: 'gsap/dist/gsap.min.js', anime: 'animejs/lib/anime.min.js', lottie: 'lottie-web/build/player/lottie.min.js', three: 'three/build/three.min.js',
  ...Object.fromEntries(Object.entries(GSAP_PLUGINS).map(([k, [g]]) => [k, 'gsap/dist/' + g + '.min.js'])) };
const libKey = (n) => { const k = String(n).toLowerCase().replace(/[^a-z0-9]/g, ''); return LIBS[k] ? k : LIBS[k.replace(/plugin$/, '')] ? k.replace(/plugin$/, '') : k === 'animejs' ? 'anime' : k === 'lottieweb' ? 'lottie' : LIBS2.key(k); };
// khoá mới (libs.mjs: anime4, motion, dotlottie, rive) — nạp sau các khoá cũ; cảnh không có khoá mới → HTML như cũ từng byte
const extraKeys = (els) => [...new Set(els.flatMap((e) => (Array.isArray(e.libs) ? e.libs : [])).map(libKey).filter(LIBS2.isExtra))];
const libTag = (name) => { const f = LIBS[name] && path.join(path.dirname(new URL(import.meta.url).pathname), 'node_modules', LIBS[name]); return f && fs.existsSync(f) ? '<script src="file://' + f + '"></script>' : ''; };
function libsFor(s) {
  const extra = extraKeys(s.elements);
  const want = new Set(s.elements.flatMap((e) => (Array.isArray(e.libs) ? e.libs : [])).map(libKey).filter((k) => LIBS[k]));
  if (want.has('custombounce') || want.has('customwiggle')) want.add('customease');
  const plugins = [...want].filter((k) => GSAP_PLUGINS[k]); if (plugins.length) want.add('gsap');
  // thứ tự nạp: gsap → thư viện khác → CustomEase (CustomBounce / CustomWiggle cần nó) → các plugin còn lại
  const rank = (k) => (k === 'gsap' ? 0 : !GSAP_PLUGINS[k] ? 1 : k === 'customease' ? 2 : 3);
  const reg = plugins.length ? '<script>if(window.gsap)try{gsap.registerPlugin(...' + JSON.stringify(plugins.flatMap((k) => GSAP_PLUGINS[k])) + '.map((n)=>window[n]).filter(Boolean))}catch(e){}</script>' : '';
  return [...want].sort((a, b) => rank(a) - rank(b)).map(libTag).join('') + reg + (extra.length ? LIBS2.tags(extra, { work }) : '');
}
// số ngẫu nhiên cố định theo seed của job + số thứ tự cảnh (Math.random trong html / thư viện) → dựng lại ra y hệt
const seedTag = (n) => '<script>Math.random=(()=>{let a=' + (n >>> 0) + ';return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}})()</script>';
// đồng hồ ảo: requestAnimationFrame / performance.now / Date.now chạy theo thời gian cảnh mà render.mjs tua tới
// → GSAP, Anime.js, Lottie, Three.js… (mọi thứ chạy bằng rAF) khớp tuyệt đối từng khung, dù chụp chậm bao nhiêu
const VCLOCK = '<script>(()=>{let now=0;const q=[];let id=0;const D0=Date.now();performance.now=()=>now;Date.now=()=>D0+Math.round(now);'
  + 'window.requestAnimationFrame=(cb)=>{q.push([++id,cb]);return id};window.cancelAnimationFrame=(i)=>{const k=q.findIndex((x)=>x[0]===i);if(k>=0)q.splice(k,1)};'
  + 'window.ES={time:0,onSeek:[],ready:[]};window.__esTick=(ms)=>{now=ms;window.ES.time=ms/1000;const run=q.splice(0);for(const [,cb] of run){try{cb(now)}catch(e){}}'
  + 'for(const f of window.ES.onSeek){try{f(ms/1000)}catch(e){}}return run.length+window.ES.onSeek.length}})()</script>';
function sceneDoc(s, head) {
  const els = []; let html = '';
  s.elements.forEach((e, k) => {
    if (e.type !== 'html' && e.type !== 'image' && e.type !== 'video' && !ANIM.isLive(e)) return;
    const eid = 'e' + k; const st = num(e.start, 0);
    const dur = num(e.duration, -2); const end = dur > 0 ? st + dur : s.D + 1;
    const w = num(e.width, 0); const h = num(e.height, -1);
    const kf = (e.keyframes || []).map((f) => ({ t: num(f.time, 0), x: f.x, y: f.y, width: f.width, height: f.height, opacity: f.opacity, scale: f.scale, rotate: f.rotate, blur: f.blur, easing: f.easing || '' })).sort((a, b) => a.t - b.t);
    // animation: "pop" hoặc { in: "rise", out: "fade", duration: 0.45 } — kiểu vào/ra có sẵn, xem ANIM trong PAGE_JS
    const an = e.animation ? (typeof e.animation === 'string' ? { in: e.animation } : e.animation) : null;
    els.push({ id: eid, st, end, fi: num(e['fade-in'], 0), fo: num(e['fade-out'], 0), x: num(e.x, 0), y: num(e.y, 0), w, h, kf, rot: e.rotate ? { a: num(e.rotate.angle, 0), s: num(e.rotate.speed, 1) } : null, zoom: num(e.zoom, 0),
      an: an ? { in: String(an.in || ''), out: String(an.out || ''), d: Math.max(0.05, num(an.duration, 0.45)) } : null, vf: e._vf || null, ...(ANIM.isLive(e) ? { m2c: ANIM.spec(e) } : {}) });
    const z = num(e['z-index'], 0);
    const box = 'position:absolute;left:0;top:0;visibility:hidden;transform-origin:center center;z-index:' + (z * 100 + k) + ';';
    if (ANIM.isLive(e)) html += ANIM.box(e, eid, box, w, h); // <iframe> trỏ tới bản sao trang trong work/
    else if (e.type === 'html') {
      let inner = String(e.html || ''); if (head && inner.startsWith(head)) inner = inner.slice(head.length);
      html += '<div id="' + eid + '" style="' + box + 'width:' + w + 'px;height:' + (h > 0 ? h + 'px' : 'auto') + ';overflow:hidden">' + inner + '</div>';
    } else if (e.type === 'video') {
      html += '<img id="' + eid + '" src="file://' + e._vf.dir + '/00001.jpg" style="' + box + 'width:' + w + 'px;height:' + (h > 0 ? h + 'px' : 'auto') + '">';
    } else {
      html += '<img id="' + eid + '" referrerpolicy="no-referrer" src="' + String(e.src).replace(/"/g, '&quot;') + '" style="' + box + 'width:' + w + 'px;height:' + (h > 0 ? h + 'px' : 'auto') + '">';
    }
  });
  const bg = s['background-color'] || '#000000';
  const libs = libsFor(s); const seed = Math.floor(rng(CR.seed + ':r' + scenes.indexOf(s))() * 4294967296);
  return '<!doctype html><html><head><meta charset="utf-8">' + VCLOCK + seedTag(seed) + libs + head
    + '<style>html,body{margin:0;padding:0;width:' + W + 'px;height:' + H + 'px;overflow:hidden;background:' + bg + '}#stage{position:relative;isolation:isolate;z-index:0;width:' + W + 'px;height:' + H + 'px;overflow:hidden;background:' + bg + '}'
    + '#cam{position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px;isolation:isolate;transform-origin:center center}</style></head><body>'
    + '<svg width="0" height="0" style="position:absolute"><filter id="mb" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB"><feGaussianBlur id="mbg" stdDeviation="0" edgeMode="duplicate"/></filter></svg>'
    + '<div id="stage"><div id="cam">' + html + '</div></div>'
    + '<script>window.SPEC=' + JSON.stringify(els).replace(/</g, '\\u003c') + ';window.CAM=' + JSON.stringify(s.cam || null) + ';window.WH=[' + W + ',' + H + '];window.FPS=' + FPS + ';' + PAGE_JS + (s.elements.some(ANIM.isLive) ? ANIM.PAGE_JS : '') + (extraKeys(s.elements).length ? LIBS2.WAIT_JS : '') + '</script></body></html>';
}
const PAGE_JS = `
const c1 = 1.70158, c3 = c1 + 1, c4 = (2 * Math.PI) / 3;
const bounce = (t) => { const n = 7.5625, d = 2.75; return t < 1 / d ? n * t * t : t < 2 / d ? n * (t -= 1.5 / d) * t + .75 : t < 2.5 / d ? n * (t -= 2.25 / d) * t + .9375 : n * (t -= 2.625 / d) * t + .984375; };
const EF = { linear: (t) => t, ease: (t) => t * t * (3 - 2 * t), 'ease-in': (t) => t * t, 'ease-out': (t) => 1 - (1 - t) * (1 - t), 'ease-in-out': (t) => t * t * (3 - 2 * t),
  'ease-in-quad': (t) => t * t, 'ease-out-quad': (t) => 1 - (1 - t) * (1 - t), 'ease-in-out-quad': (t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  'ease-in-cubic': (t) => t * t * t, 'ease-out-cubic': (t) => 1 - Math.pow(1 - t, 3), 'ease-in-out-cubic': (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  'ease-in-quart': (t) => t * t * t * t, 'ease-out-quart': (t) => 1 - Math.pow(1 - t, 4), 'ease-in-out-quart': (t) => (t < .5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  'ease-out-quint': (t) => 1 - Math.pow(1 - t, 5), 'ease-in-circ': (t) => 1 - Math.sqrt(1 - t * t), 'ease-out-circ': (t) => Math.sqrt(1 - Math.pow(t - 1, 2)),
  'ease-in-sine': (t) => 1 - Math.cos((t * Math.PI) / 2), 'ease-out-sine': (t) => Math.sin((t * Math.PI) / 2), 'ease-in-out-sine': (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  'ease-in-back': (t) => c3 * t * t * t - c1 * t * t, 'ease-out-back': (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  'ease-in-out-back': (t) => { const c2 = c1 * 1.525; return t < .5 ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2 : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2; },
  'ease-out-expo': (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)), 'ease-in-expo': (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  'ease-in-out-expo': (t) => (t === 0 || t === 1 ? t : t < .5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
  'ease-out-elastic': (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - .75) * c4) + 1), 'ease-in-elastic': (t) => (t === 0 || t === 1 ? t : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4)),
  'ease-out-bounce': bounce, 'ease-in-bounce': (t) => 1 - bounce(1 - t), spring: (t) => (t >= 1 ? 1 : 1 - Math.exp(-6.5 * t) * Math.cos(t * Math.PI * 3.2)),
  hold: (t) => (t < 1 ? 0 : 1), 'step-start': (t) => (t > 0 ? 1 : 0), 'step-end': (t) => (t < 1 ? 0 : 1) };
// cubic-bezier(x1,y1,x2,y2) như CSS (chia đôi tìm t theo x)
const bez = (a, b, c, d) => (x) => { let lo = 0, hi = 1, t = x; for (let i = 0; i < 22; i++) { const cx = 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * c + t * t * t; if (cx < x) lo = t; else hi = t; t = (lo + hi) / 2; } return 3 * (1 - t) * (1 - t) * t * b + 3 * (1 - t) * t * t * d + t * t * t; };
const BZ = {};
const EASE = (n) => { n = String(n || 'linear').toLowerCase().replace(/\\s+/g, ''); if (EF[n]) return EF[n];
  const m = n.match(/^cubic-bezier\\(([-\\d.]+),([-\\d.]+),([-\\d.]+),([-\\d.]+)\\)$/); if (m) return BZ[n] || (BZ[n] = bez(+m[1], +m[2], +m[3], +m[4]));
  return EF.linear; };
// kiểu vào/ra cho "animation" (u: 0 → 1 khi vào; khi ra chạy ngược)
const ANIM = { fade: (u) => ({ o: u }),
  pop: (u) => ({ o: Math.min(1, u * 3), s: .4 + .6 * EF['ease-out-back'](u) }), zoom: (u) => ({ o: u, s: 1.4 - .4 * EF['ease-out-cubic'](u) }),
  rise: (u) => ({ o: Math.min(1, u * 2), y: 90 * (1 - EF['ease-out-cubic'](u)) }), drop: (u) => ({ o: Math.min(1, u * 4), y: -160 * (1 - bounce(u)) }),
  'slide-left': (u) => ({ o: Math.min(1, u * 2), x: 220 * (1 - EF['ease-out-expo'](u)) }), 'slide-right': (u) => ({ o: Math.min(1, u * 2), x: -220 * (1 - EF['ease-out-expo'](u)) }),
  'slide-up': (u) => ({ o: Math.min(1, u * 2), y: 220 * (1 - EF['ease-out-expo'](u)) }), 'slide-down': (u) => ({ o: Math.min(1, u * 2), y: -220 * (1 - EF['ease-out-expo'](u)) }),
  blur: (u) => ({ o: u, b: 26 * (1 - u), s: 1.1 - .1 * EF['ease-out-cubic'](u) }), spin: (u) => ({ o: Math.min(1, u * 2), r: -25 * (1 - EF['ease-out-back'](u)), s: .6 + .4 * EF['ease-out-back'](u) }),
  elastic: (u) => ({ o: Math.min(1, u * 4), s: Math.max(0, EF['ease-out-elastic'](u)) }), flip: (u) => ({ o: Math.min(1, u * 2), rx: 85 * (1 - EF['ease-out-cubic'](u)) }) };
// máy quay cả khung: đẩy/kéo/trôi theo cảnh + giật theo SFX + đà chuyển cảnh zoom/whip; không bao giờ lộ mép (dịch ≤ phần phóng to)
const camAt = (t) => { const c = window.CAM; if (!c) return null;
  const q = EF['ease-in-out-sine'](Math.max(0, Math.min(1, t / c.D)));
  let sc = c.s0 + (c.s1 - c.s0) * q, x = c.x0 + (c.x1 - c.x0) * q, y = c.y0 + (c.y1 - c.y0) * q, bx = 0, by = 0;
  for (const b of c.beats) { const d = t - b.t;
    if (b.k === 'p') { sc += b.a * (d < -.05 ? 0 : d < 0 ? (d + .05) / .05 : Math.exp(-d * 9));
      if (b.sh && d >= 0 && d < .4) { const f = b.sh * Math.exp(-d * 14); x += f * Math.sin(d * 56 + b.ph); y += f * Math.cos(d * 47 + b.ph * 1.7); } }
    else if (t >= b.t0) sc += b.a * (d < 0 ? Math.pow((t - b.t0) / Math.max(.05, b.t - b.t0), 2) : Math.exp(-d * 14)); }
  // cảnh trước tăng tốc ra (u: 0 → 1 ở đuôi cảnh), cảnh sau lao vào rồi dừng (u: 1 → 0 ở đầu cảnh)
  // whip: phóng nhẹ để có lề rồi trượt cùng hướng (cảnh trước trượt đi, cảnh sau trượt tới rồi dừng) + nhoè chuyển động
  for (const [tl, u, dir] of [[c.out, c.out ? 1 - (c.D - t) / c.out.d : 0, -1], [c.in, c.in ? 1 - t / c.in.d : 0, 1]]) if (tl && u > 0) {
    const e = Math.min(1, u) ** 2;
    if (tl.k === 'z') { sc *= 1 + .3 * e; bx += 9 * e; by += 9 * e; }
    else { sc *= 1 + .12 * e; if (tl.k === 'x') { x += dir * .06 * WH[0] * e; bx += 32 * e; } else { y += dir * .06 * WH[1] * e; by += 32 * e; } } }
  const mx = (sc - 1) * WH[0] / 2, my = (sc - 1) * WH[1] / 2; x = Math.max(-mx, Math.min(mx, x)); y = Math.max(-my, Math.min(my, y));
  return { tf: 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px) scale(' + sc.toFixed(5) + ')', b: bx > .3 || by > .3 ? bx.toFixed(1) + ' ' + by.toFixed(1) : '' }; };
const val = (kf, p, lt, base) => { const tr = kf.filter((k) => k[p] !== undefined && k[p] !== null); if (!tr.length) return base;
  if (lt <= tr[0].t) return Number(tr[0][p]);
  for (let i = 1; i < tr.length; i++) { const a = tr[i - 1], b = tr[i]; if (lt <= b.t) { const u = b.t === a.t ? 1 : (lt - a.t) / (b.t - a.t); return Number(a[p]) + (Number(b[p]) - Number(a[p])) * EASE(b.easing)(Math.max(0, Math.min(1, u))); } }
  return Number(tr[tr.length - 1][p]); };
window.seek = async (t) => { let sig = ''; const wait = []; for (const e of SPEC) { const n = document.getElementById(e.id); if (!n) continue;
  if (t < e.st - 1e-6 || t >= e.end) { if (n.style.visibility !== 'hidden') n.style.visibility = 'hidden'; continue; }
  if (e.anims && e.anims.length) { const ms = Math.max(0, t - e.st) * 1000; let moving = false;
    for (const a of e.anims) { a.currentTime = ms; const tm = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null; if (!tm || !(ms >= tm.endTime)) moving = true; }
    if (moving) sig += e.id + '@' + Math.round(ms) + ';'; }
  const lt = t - e.st;
  if (e.vf) { const f = Math.max(1, Math.min(e.vf.n, Math.floor(lt * FPS + 1e-6) + 1)); sig += e.id + '#' + f + ';';
    if (n.dataset.f !== String(f)) { n.dataset.f = String(f); n.src = 'file://' + e.vf.dir + '/' + String(f).padStart(5, '0') + '.jpg'; wait.push(n.decode().catch(() => 0)); } }
  let op = 1; if (e.fi > 0) op = Math.min(op, lt / e.fi); if (e.fo > 0) op = Math.min(op, (e.end - t) / e.fo);
  op = Math.max(0, Math.min(1, op)) * val(e.kf, 'opacity', lt, 1);
  let x = val(e.kf, 'x', lt, e.x), y = val(e.kf, 'y', lt, e.y);
  const w = val(e.kf, 'width', lt, e.w), h = val(e.kf, 'height', lt, e.h);
  let sc = val(e.kf, 'scale', lt, 1); if (e.zoom) sc *= 1 + e.zoom * 0.03 * Math.min(1, lt / Math.max(0.5, e.end - e.st));
  let rot = val(e.kf, 'rotate', lt, 0); if (e.rot) rot += e.rot.a * Math.min(1, lt / Math.max(0.01, e.rot.s));
  let bl = val(e.kf, 'blur', lt, 0), rx = 0;
  if (e.an) for (const [nm, u] of [[e.an.in, lt / e.an.d], [e.an.out, (e.end - t) / e.an.d]]) if (nm && u < 1) {
    const p = (ANIM[nm] || ANIM.fade)(Math.max(0, u)); op *= p.o ?? 1; x += p.x || 0; y += p.y || 0; sc *= p.s ?? 1; rot += p.r || 0; bl += p.b || 0; rx += p.rx || 0; }
  n.style.visibility = 'visible'; n.style.opacity = op; n.style.left = x + 'px'; n.style.top = y + 'px';
  if (w > 0) n.style.width = w + 'px'; if (h > 0) n.style.height = h + 'px';
  n.style.transform = (rx ? 'perspective(900px) rotateX(' + rx + 'deg) ' : '') + (sc !== 1 ? 'scale(' + sc + ') ' : '') + (rot ? 'rotate(' + rot + 'deg)' : '');
  n.style.filter = bl > 0.05 ? 'blur(' + bl.toFixed(2) + 'px)' : '';
  if (e.m2c) sig += window.__esAnim.seek(e, n, t); // trang anim.seek: tua tới giây của trang (anim.mjs)
  sig += e.id + ':' + op.toFixed(3) + ',' + Math.round(x * 2) + ',' + Math.round(y * 2) + ',' + Math.round(w) + ',' + Math.round(h) + ',' + sc.toFixed(4) + ',' + rot.toFixed(2) + ',' + bl.toFixed(2) + ',' + rx.toFixed(2) + ';'; }
  if (window.__esTick && window.__esTick(t * 1000)) sig += 'raf' + Math.round(t * 1000) + ';'; // có thư viện đang chạy → khung đổi
  const cm = camAt(t); if (cm) { const n = document.getElementById('cam'); n.style.transform = cm.tf;
    if (cm.b) document.getElementById('mbg').setAttribute('stdDeviation', cm.b); n.style.filter = cm.b ? 'url(#mb)' : ''; sig += cm.tf + cm.b; }
  await Promise.all(wait); return sig; };
window.ready = async () => { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 8000))]);
  // cổng chờ chung: ES.ready.push(promise | () => promise) — tối đa 10 s rồi dựng tiếp (trang không đẩy gì → không đợi)
  const rdy = (window.ES && window.ES.ready || []).map((f) => { try { return Promise.resolve(typeof f === 'function' ? f() : f).catch(() => 0); } catch (e) { return 0; } });
  if (rdy.length) await Promise.race([Promise.all(rdy), new Promise((r) => setTimeout(r, 10000))]);
  await Promise.all([...document.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 20000); }))));
  // CSS animation (vẽ nét, trôi nền, nhấp nháy…) dừng lại và tua theo thời gian của từng phần tử
  for (const e of SPEC) { const n = document.getElementById(e.id); if (!n) continue; e.anims = n.getAnimations({ subtree: true }); e.anims.forEach((a) => a.pause()); }
  // trang anim.seek: cổng chờ (data-ready, hợp đồng, font, ảnh) — khung đầu không bao giờ là trang dựng dở
  return window.__esAnim ? window.__esAnim.ready(SPEC) : true; };
`;

async function loadChromium() {
  let pw;
  try { pw = await import('playwright'); } catch (e) { pw = await import('playwright-core'); }
  // WebGL chạy bằng SwiftShader (CPU) để cảnh Three.js vẽ được trên máy không có GPU
  const opts = { args: ['--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--font-render-hinting=none', '--disable-web-security', '--hide-scrollbars'] };
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
// video: tách sẵn từng khung đúng fps (đã cắt seek/duration, scale theo fit) → trang chỉ đổi ảnh theo thời gian, khớp khung tuyệt đối
async function localizeVideos() {
  let k = 0;
  for (const s of scenes) for (const e of s.elements) {
    if (e.type !== 'video' || !e.src) continue;
    const src = await fetchAudio(e.src); const w = num(e.width, 0) > 0 ? num(e.width) : W; const h = num(e.height, -1) > 0 ? num(e.height) : H;
    e.width = w; e.height = h; const st = num(e.start, 0); const dur = num(e.duration, -1) > 0 ? num(e.duration) : s.D - st;
    const dir = path.join(work, 'vf' + k++); fs.mkdirSync(dir, { recursive: true });
    const sz = w + ':' + h; const fit = String(e.fit || 'cover');
    const still = /\.(png|jpe?g|webp|gif|bmp)$/i.test(src); // ảnh → lặp thành video tĩnh (vẫn được fit cover/blur + keyframes)
    // HDR (iPhone HLG / Dolby Vision, PQ) và gam BT.2020 → tuyến tính, đổi gam BT.709, tone map mobius (trắng tham chiếu 203 nit ≈ 90% trắng SDR, chừa chỗ cho vùng sáng tới 1000 nit) → hết xám bệt, tối
    const c = still ? {} : probeColor(src); const ok = (v) => v && v !== 'unknown'; const hdr = /^(smpte2084|arib-std-b67)$/.test(c.color_transfer || ''); const wide = (hdr || c.color_primaries === 'bt2020') && hasZscale();
    const tm = !wide ? '' : ',zscale=t=linear:npl=203:p=709' + (ok(c.color_transfer) ? '' : ':tin=709') + (ok(c.color_primaries) ? '' : ':pin=2020') + (ok(c.color_space) ? '' : ':min=2020_ncl')
      + ',format=gbrpf32le' + (hdr ? ',tonemap=mobius:param=0.6:desat=0:peak=' + r3(1000 / 203) : '') + ',zscale=t=709:m=709:r=tv,format=yuv420p';
    // Chrome đọc khung JPEG theo BT.601 full range → đổi ma trận nguồn sang BT.601 (giữ BT.709 thì lệch màu ~22/255); chưa gắn nhãn: HD coi là BT.709, SD là BT.601
    // — trừ VP8/VP9 (webm quay màn hình / webcam bằng trình duyệt): không gắn nhãn mà vẫn là BT.601
    const inM = wide ? 'bt709' : ok(c.color_space) ? 'auto' : /^vp[89]$/.test(c.codec_name || '') ? 'bt601' : num(c.width) >= 1280 || num(c.height) > 576 ? 'bt709' : 'bt601';
    const vf = 'fps=' + FPS + ',' + (fit === 'contain' ? 'scale=' + sz + ':force_original_aspect_ratio=decrease,pad=' + sz + ':(ow-iw)/2:(oh-ih)/2:color=black'
      : fit === 'blur' ? 'split[a][b];[a]scale=' + sz + ':force_original_aspect_ratio=increase,crop=' + sz + ',boxblur=28:2,eq=brightness=-0.06[bg];[b]scale=' + sz + ':force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2'
        : 'scale=' + sz + ':force_original_aspect_ratio=increase,crop=' + sz) + (e.flip ? ',hflip' : '') + tm
      + ',scale=in_color_matrix=' + inM + ':out_color_matrix=bt601:out_range=pc,format=yuvj420p';
    await run(FFMPEG, ['-y', '-v', 'error', ...(still ? ['-loop', '1'] : ['-ss', String(r3(Math.max(0, num(e.seek, 0))))]), '-i', src, '-t', String(r3(dur + 2 / FPS)), '-vf', vf, '-q:v', '3', '-frames:v', String(Math.ceil(dur * FPS) + 1), path.join(dir, '%05d.jpg')]);
    const n = fs.readdirSync(dir).length; if (!n) throw new Error('video không có khung hình: ' + e.src);
    e._vf = { dir, n };
  }
}
// chụp khung; CDP đôi khi báo "Unable to capture screenshot" (máy quá tải) → thử lại tối đa 2 lần sau 250 / 500 ms (lần hỏng không có ảnh nên không đổi khung của lần chạy tốt)
async function capture(cdp, f) {
  for (let k = 0; ; k++) {
    try { return (await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, optimizeForSpeed: true, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } })).data; }
    catch (err) { if (k >= 2 || !/captureScreenshot|Unable to capture/i.test(String(err && err.message))) throw err; log('frame', f, 'captureScreenshot lỗi → thử lại:', String(err.message).slice(0, 120)); await new Promise((r) => setTimeout(r, 250 * (k + 1))); }
  }
}
async function renderScenes() {
  await localizeImages();
  await localizeVideos();
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
      const wd = ANIM.budget(s); // > 0 chỉ khi cảnh có phần tử anim: chó canh trang treo (iframe chạy chung luồng với trang cảnh)
      fs.writeFileSync(docPath, sceneDoc(s, head));
      await page.goto('file://' + docPath, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
      ANIM.afterReady(s, await ANIM.watch(page.evaluate(() => window.ready()), wd, 'ready()').catch((err) => { throw ANIM.sceneError(s, err); }), log);
      const xk = extraKeys(s.elements); // thư viện mới: ghi tên@phiên bản vào log (không vào result.json)
      s.file = path.join(work, 'seg' + String(s.i).padStart(3, '0') + '.mp4');
      const ff = spawn(FFMPEG, ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-vf', TO709, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', ...TAG709, '-r', String(FPS), s.file], { stdio: ['pipe', 'inherit', 'inherit'] });
      const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg scene ' + s.i + ' exit ' + c)))));
      // khung hình không đổi (đoạn giữ hình) → dùng lại ảnh trước, đỡ chụp lại
      let prevSig = null; let prevBuf = null; let shots = 0;
      for (let f = 0; f < s.frames; f++) {
        // E_RIVE_DRAW (khung Rive vẽ hỏng, els.mjs): tua lại khung đó tối đa 2 lần (Rive dựng lại từ 0 → cùng hình); vẫn hỏng → job lỗi, không bao giờ nhận khung sai
        const seekF = () => ANIM.watch(page.evaluate((t) => window.seek(t), f / FPS), wd && 30000, 'frame ' + f);
        let sig; for (let k = 0; ; k++) { try { sig = await seekF(); break; } catch (err) {
          if (!(xk.length && k < 2 && /E_RIVE_DRAW/.test(String(err && err.message)))) throw ANIM.sceneError(s, err);
          log('scene', s.i + 1 + ':', 'frame', f, String(err.message).split('\n')[0].replace(/^.*?(E_RIVE_DRAW)/, '$1'), '→ thử lại'); await new Promise((r) => setTimeout(r, 300)); } }
        let buf = prevBuf;
        if (sig !== prevSig || !buf) {
          const data = await capture(cdp, f);
          buf = Buffer.from(data, 'base64'); prevBuf = buf; prevSig = sig; shots++;
        }
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      }
      s.shots = shots;
      if (wd) ANIM.afterScene(s, await page.evaluate(() => window.__esAnim.report()), log);
      if (xk.length) for (const w of await page.evaluate(() => window.__esElWarn || [])) log('scene', s.i + 1 + ':', w); // dotlottie / rive "on-error": "hide"
      ff.stdin.end();
      await done;
      log('scene', s.i + 1 + '/' + scenes.length, s.D.toFixed(2) + 's', s.frames, 'frames,', s.shots, 'shots', ((Date.now() - t0) / 1000).toFixed(1) + 's', ...(xk.length ? ['libs', xk.map((k) => k + '@' + LIBS2.version(k)).join(' ')] : []));
    }
    await ctx.close();
  };
  await Promise.all(Array.from({ length: Math.min(CONC, scenes.length) }, worker));
  await browser.close();
}

// màu chuẩn BT.709 (video HD): ảnh chụp JPEG (BT.601) đổi ma trận màu + gắn nhãn, để điện thoại / web / TikTok hiện đúng màu
const TO709 = 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p';
const TAG709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const LOOKS = {
  film: 'eq=contrast=1.05:saturation=1.06,vignette=angle=PI/5,noise=c0s=6:c0f=t+u',
  glow: 'split[g0][g1];[g1]gblur=sigma=28,format=gbrp[g2];[g0]format=gbrp[g3];[g3][g2]blend=all_mode=screen:all_opacity=0.22,format=yuv420p',
  vivid: 'eq=contrast=1.06:saturation=1.22,unsharp=5:5:0.4',
  warm: 'colorbalance=rs=0.05:gs=0.01:bs=-0.05:rm=0.03:bm=-0.03,eq=saturation=1.06',
  cool: 'colorbalance=rs=-0.04:bs=0.06:rm=-0.02:bm=0.04,eq=saturation=1.04',
  noir: 'hue=s=0,eq=contrast=1.18,vignette=angle=PI/4,noise=c0s=8:c0f=t+u',
};
async function joinScenes(out, assFile, fontsDir) {
  const args = ['-y', '-v', 'error'];
  scenes.forEach((s) => args.push('-i', s.file));
  // cùng timebase cho mọi đoạn: concat (cắt thẳng) và xfade (chuyển cảnh) xen kẽ nhau mới ghép được
  let f = scenes.map((s, i) => '[' + i + ':v]settb=AVTB[s' + i + '];').join(''); let last = '[s0]';
  for (let i = 1; i < scenes.length; i++) {
    const s = scenes[i]; const lab = '[x' + i + ']';
    if (s.trans && s.trans.d > 0.02) f += last + '[s' + i + ']xfade=transition=' + (CUSTOM[s.trans.style] ? CUSTOM[s.trans.style].xf : s.trans.style) + ':duration=' + r3(s.trans.d) + ':offset=' + r3(s.T) + lab + ';';
    else f += last + '[s' + i + ']concat=n=2:v=1:a=0' + lab + ';';
    last = lab;
  }
  // look màu toàn video (trước phụ đề để chữ vẫn sạch)
  const look = LOOKS[String(CR.look).toLowerCase()];
  if (look) { f += last + look + '[lk];'; last = '[lk]'; }
  // phụ đề vẽ trên RGB (libass trộn màu trên YUV theo BT.601 → lệch màu chữ trong video BT.709)
  if (assFile) { f += last + 'scale=in_color_matrix=bt709:in_range=tv:flags=accurate_rnd+full_chroma_int,format=rgb24,ass=' + path.basename(assFile) + ':fontsdir=' + path.relative(work, fontsDir) + '[sb];'; last = '[sb]'; }
  f += last + TO709 + '[vout]'; // look đi qua RGB có thể trả về BT.601 → đưa về BT.709 lần cuối
  fs.writeFileSync(path.join(work, 'vf.txt'), f);
  args.push('-filter_complex_script', 'vf.txt', '-map', '[vout]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', ...TAG709, '-r', String(FPS), '-movflags', '+faststart', out);
  await run(FFMPEG, args, { cwd: work });
}

// ---------- phụ đề karaoke (ASS) ----------
function assColor(hex, alphaOverride) {
  const h = String(hex || '#FFFFFF').replace('#', ''); const rr = h.slice(0, 2) || 'FF', gg = h.slice(2, 4) || 'FF', bb = h.slice(4, 6) || 'FF';
  let a = h.length >= 8 ? 255 - parseInt(h.slice(6, 8), 16) : 0; if (alphaOverride != null) a = alphaOverride;
  return '&H' + a.toString(16).padStart(2, '0').toUpperCase() + bb.toUpperCase() + gg.toUpperCase() + rr.toUpperCase();
}
function assTime(t) { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return h + ':' + String(m).padStart(2, '0') + ':' + s.toFixed(2).padStart(5, '0'); }
// settings.style: classic (karaoke tô dần) | pop (từ đang đọc đổi màu + nảy) | one-word (từng từ to giữa màn) | progressive (chữ hiện dần theo giọng)
//   | boxed-word (khung màu sau từ đang đọc) | boxed-line (khung sau cả dòng); nhận cả tên JSON2Video classic-one-word / classic-progressive.
// creative bật: "classic" (mặc định của bộ tạo kịch bản) → creative.subtitles hoặc "pop"; ngắt dòng theo dấu câu / chỗ nghỉ giọng; tô settings.keywords.
const SUB_STYLES = ['classic', 'pop', 'one-word', 'progressive', 'boxed-word', 'boxed-line'];
const STOP = new Set('the a an and or of to in on for with at by from is are be your you it its this that our we my'.split(' '));
const norm = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const light = (hex) => { const h = String(hex).replace('#', ''); return (0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16)) / 255 > 0.6; }; // nền sáng → chữ tối
function subStyle(st) {
  const s = String(CR.subtitles || (CR.on && /^classic$/i.test(st.style || 'classic') ? 'pop' : st.style || 'classic')).toLowerCase().replace(/^classic-/, '');
  return SUB_STYLES.includes(s) ? s : 'classic';
}
// cụm chữ trên một dòng: creative tắt → cắt đều theo max-words-per-line; bật → ngắt ở cuối câu, dấu phẩy, chỗ ngắt hơi, không để 1 từ mồ côi
function phrases(e, per) {
  const ws = e._words; const out = [];
  if (!CR.on) { for (let i = 0; i < ws.length; i += per) out.push(ws.slice(i, i + per)); return out; }
  const text = String(e.text || ''); const lo = text.toLowerCase(); let c = 0;
  for (const w of ws) { const k = lo.indexOf(String(w.w).toLowerCase(), c); if (k >= 0) { c = k + String(w.w).length; w.p = (text.slice(c, c + 3).match(/^["'”’)\]]*([.!?…,;:—–])/) || [])[1] || ''; } }
  let cur = [];
  ws.forEach((w, i) => {
    cur.push(w); const nx = ws[i + 1];
    if (!nx || cur.length >= per || /[.!?…]/.test(w.p || '') || (cur.length >= 2 && (w.p || nx.t - (w.t + w.d) > 0.35))) { out.push(cur); cur = []; }
  });
  for (let i = out.length - 1; i > 0; i--) if (out[i].length === 1 && out[i - 1].length < per && !/[.!?…]/.test(out[i - 1][out[i - 1].length - 1].p || '')) { out[i - 1].push(...out[i]); out.splice(i, 1); }
  return out;
}
function buildAss(st) {
  const font = st['font-family'] || 'Poppins'; const size = num(st['font-size'], 64); const per = Math.max(1, num(st['max-words-per-line'], 4));
  const x = num(st.x, W / 2), y = num(st.y, H * 0.78); const X = Math.round(x), Y = Math.round(y);
  const bold = num(st['font-weight'], 700) >= 600 ? -1 : 0;
  const shadow = num(st['shadow-offset'], 3); const outline = num(st['outline-width'], 0);
  const style = subStyle(st); const WC = st['word-color'] || '#FFD24A'; const LC = st['line-color'] || '#FFFFFF'; const KC = st['keyword-color'] || WC;
  const OC = st['outline-color'] || '#000000'; const SC = st['shadow-color'] || '#00000099'; const BC = st['box-color'] || (style === 'boxed-line' ? '#000000B3' : WC);
  const c = (hex) => '&H' + assColor(hex).slice(4) + '&'; const al = (hex) => '&H' + assColor(hex).slice(2, 4) + '&';
  // từ khoá khớp cả dạng số nhiều / chia động từ (Outline → outlines, outlined)
  const kws = (st.keywords || []).map(norm).filter((k) => k.length > 2 && !STOP.has(k)); const isKw = (w) => { const n = norm(w.w); return kws.some((k) => n.startsWith(k) && /^(s|es|ed|d|ing)?$/.test(n.slice(k.length))); };
  const base = (w) => c(CR.on && isKw(w) ? KC : LC);
  let out = '[Script Info]\nScriptType: v4.00+\nPlayResX: ' + W + '\nPlayResY: ' + H + '\nWrapStyle: 2\nScaledBorderAndShadow: yes\nYCbCr Matrix: TV.709\n\n[V4+ Styles]\n'
    + 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
    + 'Style: Cap,' + font + ',' + size + ',' + assColor(WC) + ',' + assColor(LC) + ',' + assColor(OC) + ',' + assColor(SC) + ',' + bold + ',0,0,0,100,100,0,0,1,' + outline + ',' + shadow + ',5,40,40,40,1\n'
    + 'Style: Box,' + font + ',' + size + ',' + assColor(LC) + ',' + assColor(LC) + ',' + assColor(BC) + ',&H00000000,' + bold + ',0,0,0,100,100,0,0,3,' + Math.round(size * 0.16) + ',0,5,40,40,40,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  // settings.hide: [[t0,t1],…] — dòng bắt đầu trong khoảng thì bỏ, đang chạy thì cắt ngắn (giữ đúng mốc \t bên trong)
  const hide = (st.hide || []).map((h) => [num(h[0], 0), num(h[1], 0)]);
  const dlg = (layer, a, b, sty, txt) => { for (const [h0, h1] of hide) { if (a >= h0 - 0.05 && a < h1) return ''; if (a < h0 && b > h0) b = h0; } return b - a < 0.08 ? '' : 'Dialogue: ' + layer + ',' + assTime(a) + ',' + assTime(b) + ',' + sty + ',,0,0,0,,' + txt + '\n'; };
  const up = /upper/i.test(st['text-transform'] || ''); const word = (w) => { const t = String(w.w).replace(/[{}\\]/g, ''); return up ? t.toLocaleUpperCase() : t; };
  const enter = '{\\an5\\move(' + X + ',' + (Y + 18) + ',' + X + ',' + Y + ',0,140)\\fad(90,0)}';
  for (const s of scenes) for (const e of s.elements) {
    if (!e._words || !e._words.length) continue;
    const g = s.T + num(e.start, 0); const vEnd = g + e._dur; const ch = phrases(e, style === 'one-word' ? 1 : per);
    ch.forEach((cw, ci) => {
      const last = cw[cw.length - 1]; const nextStart = ci + 1 < ch.length ? g + ch[ci + 1][0].t : vEnd;
      const a = g + cw[0].t; const b = Math.max(Math.min(nextStart, g + last.t + last.d + 0.25), Math.min(a + 0.3, nextStart));
      const ms = (t) => Math.max(0, Math.round((g + t - a) * 1000));
      const off = (k) => (k + 1 < cw.length ? ms(cw[k + 1].t) : null); // hết "đang đọc" khi từ kế tiếp bắt đầu; từ cuối giữ tới hết dòng
      if (style === 'classic') {
        const txt = cw.map((w, k) => { const nx = k + 1 < cw.length ? cw[k + 1].t : w.t + w.d; return '{\\k' + Math.max(1, Math.round((nx - w.t) * 100)) + '}' + word(w); }).join(' ');
        out += dlg(0, a, b, 'Cap', '{\\an5\\pos(' + X + ',' + Y + ')}' + txt);
      } else if (style === 'one-word') {
        out += dlg(0, a, b, 'Cap', '{\\an5\\pos(' + X + ',' + Y + ')\\fs' + Math.round(size * 1.4) + '\\c' + base(cw[0]) + '\\fscx70\\fscy70\\t(0,70,\\fscx110\\fscy110)\\t(70,150,\\fscx100\\fscy100)}' + word(cw[0]));
      } else if (style === 'pop' || style === 'progressive') {
        const pv = style === 'progressive';
        const txt = cw.map((w, k) => { const t0 = ms(w.t); const t1 = off(k);
          return '{\\c' + base(w) + (pv ? '\\1a&HFF&\\3a&HFF&\\4a&HFF&' : '') + '\\fscx100\\fscy100\\t(' + t0 + ',' + (t0 + 70) + ',' + (pv ? '\\1a' + al(WC) + '\\3a' + al(OC) + '\\4a' + al(SC) : '') + '\\c' + c(WC)
            + (pv ? ')' : '\\fscx114\\fscy114)\\t(' + (t0 + 70) + ',' + (t0 + 170) + ',\\fscx100\\fscy100)') + (t1 != null ? '\\t(' + t1 + ',' + (t1 + 90) + ',\\c' + base(w) + ')' : '') + '}' + word(w); }).join(' ');
        out += dlg(1, a, b, 'Cap', enter + txt);
      } else {
        // khung: BorderStyle 3 vẽ khung theo từng đoạn chữ → boxed-word chỉ bật khung (\3a) của từ đang đọc, chữ vẽ ở lớp trên
        const bw = style === 'boxed-word'; const act = c(st['box-text-color'] || (bw ? (light(BC) ? '#111111' : '#FFFFFF') : WC));
        const sw = (k, on, offv) => '\\t(' + on + ',' + (on + 1) + ',' + offv[0] + ')' + (off(k) != null ? '\\t(' + off(k) + ',' + (off(k) + 1) + ',' + offv[1] + ')' : '');
        if (bw) out += dlg(0, a, b, 'Box', enter + cw.map((w, k) => '{\\1a&HFF&\\3a&HFF&' + sw(k, ms(w.t), ['\\3a' + al(BC), '\\3a&HFF&']) + '}' + word(w)).join('{\\3a&HFF&} '));
        out += dlg(1, a, b, bw ? 'Cap' : 'Box', enter + cw.map((w, k) => '{\\c' + base(w) + sw(k, ms(w.t), ['\\c' + act, '\\c' + base(w)]) + '}' + word(w)).join(' '));
      }
    });
  }
  return out;
}
async function fetchFont(family, dir, weight) {
  // Google Fonts trả TTF tĩnh đúng độ đậm (user-agent không phải trình duyệt) → phụ đề đậm thật thay vì libass làm đậm giả bản variable
  try {
    const css = await (await fetch('https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') + ':wght@' + Math.round(num(weight, 700)), { headers: { 'user-agent': 'es-render' } })).text();
    const u = (css.match(/url\((https:[^)]+\.ttf)\)/) || [])[1];
    if (u) { await download(u, path.join(dir, family.replace(/\s+/g, '') + '-' + Math.round(num(weight, 700)) + '.ttf'), 2); return; }
  } catch (e) { /* thử kho google/fonts */ }
  const key = family.toLowerCase().replace(/[^a-z0-9]/g, ''); const file = family.replace(/\s+/g, '') + '-Bold.ttf';
  const names = [file, family.replace(/\s+/g, '') + '[wght].ttf', family.replace(/\s+/g, '') + '[opsz,wght].ttf', family.replace(/\s+/g, '') + '-Regular.ttf'];
  for (const lic of ['ofl', 'apache', 'ufl']) for (const nm of names) {
    try { await download('https://raw.githubusercontent.com/google/fonts/main/' + lic + '/' + key + '/' + encodeURIComponent(nm), path.join(dir, nm.replace(/[\[\],]/g, '_')), 1); return; } catch (e) { /* thử tên khác */ }
  }
  // cuối cùng mới tới font kèm repo (assets/fonts, OFL): chỉ khi mạng hỏng cả hai nguồn trên — job cũ có mạng vẫn dùng đúng file như trước
  try { const own = path.join(path.dirname(new URL(import.meta.url).pathname), 'assets', 'fonts'); const fk = family.replace(/\s+/g, '');
    const f = fs.existsSync(own) && fs.readdirSync(own).find((x) => x.startsWith(fk + '-' + Math.round(num(weight, 700)) + '.') || x.startsWith(fk + '['));
    if (f) { fs.copyFileSync(path.join(own, f), path.join(dir, f.replace(/[\[\],]/g, '_'))); log('font từ assets/fonts (mạng lỗi):', f); return; } } catch (e) { /* bỏ qua */ }
  log('font not found, libass dùng font mặc định:', family);
}

// ---------- âm thanh ----------
async function mixAudio(out, TOTAL) {
  const clips = []; // {file, start, seek, dur, vol, fo, bus}
  for (const s of scenes) for (const e of s.elements) {
    const st = s.T + num(e.start, 0);
    if (e.type === 'voice' && e._out) clips.push({ file: e._out + '.mp3', start: st, seek: 0, dur: e._dur, vol: num(e.volume, 1), fo: num(e['fade-out'], 0), bus: 'vox' });
    // âm thanh của video: file thay thế (vd giọng đã làm sạch, cùng mốc thời gian) hoặc tiếng gốc; vào bus giọng để nhạc tự hạ
    if (e.type === 'video' && e.src && !e.muted && num(e.volume, 1) > 0) {
      const file = await fetchAudio(e.audio || e.src); const dur = num(e.duration, -1) > 0 ? num(e.duration) : s.D - num(e.start, 0);
      if (hasAudio(file)) clips.push({ file, start: st, seek: Math.max(0, num(e.seek, 0)), dur, vol: num(e.volume, 1), fi: 0.012, fo: Math.max(0.012, num(e['fade-out'], 0)), bus: e.voice === false ? 'fx' : 'vox' });
    }
    if (e.type === 'audio' && e.src) {
      const file = await fetchAudio(e.src); const len = probeDur(file); const seek = Math.max(0, num(e.seek, 0));
      let dur = num(e.duration, -1); if (dur === -2) dur = s.D - num(e.start, 0); if (!(dur > 0)) dur = Math.max(0.05, len - seek);
      if (!e.spill) dur = Math.min(dur, s.D - num(e.start, 0) + (s.i < scenes.length - 1 ? 0.3 : 0)); // spill: SFX đặt theo thời gian toàn cục, được ngân qua cảnh sau
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
      + (c.fi > 0 ? ',afade=t=in:d=' + r3(c.fi) : '') + (c.fo > 0 ? ',afade=t=out:st=' + r3(Math.max(0, d - c.fo)) + ':d=' + r3(c.fo) : '') + ',adelay=' + ms + ':all=1[c' + n + '];';
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
    const mseek = Math.max(0, num(music.seek, 0)); // music.seek (tuỳ chọn): nhạc vào thẳng đoạn đã "lên"; 0 → chuỗi lọc y như cũ
    f += '[' + n + ':a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=' + (mseek > 0 ? 'start=' + r3(mseek) + ':' : '') + 'duration=' + TOTAL + ',asetpts=PTS-STARTPTS,volume=' + num(music.volume, 0.3) + (stops ? ',' + stops : '') + (fo > 0 ? ',afade=t=out:st=' + r3(Math.max(0, TOTAL - fo)) + ':d=' + r3(fo) : '') + '[mus0];';
    n++; hasMus = true;
    // music.duck (tuỳ chọn): { threshold, ratio, attack, release, voice_band } — mặc định đúng như trước (0.025 / 4 / 20 / 400, không lọc dải)
    const dk = music.duck && typeof music.duck === 'object' ? music.duck : {}; const dv = (k, d, lo, hi) => { const v = num(dk[k], d); return Math.min(hi, Math.max(lo, v)); };
    const key = dk.voice_band === true ? '[voxk0];[voxk0]highpass=f=120,lowpass=f=6000[voxk]' : '[voxk]'; // dải giọng chỉ trên tín hiệu khoá, không đổi tiếng giọng
    if (hasVox) { f += '[vox]asplit=2[voxm]' + key + ';[mus0][voxk]sidechaincompress=threshold=' + dv('threshold', 0.025, 0.000976563, 1) + ':ratio=' + dv('ratio', 4, 1, 20) + ':attack=' + dv('attack', 20, 0.01, 2000) + ':release=' + dv('release', 400, 0.01, 9000) + '[mus];'; } else f += '[mus0]anull[mus];';
  }
  const parts = []; if (hasVox) parts.push(hasMus ? '[voxm]' : '[vox]'); if (hasFx) parts.push('[fx]'); if (hasMus) parts.push('[mus]');
  if (!parts.length) { f += 'anullsrc=r=48000:cl=stereo,atrim=duration=' + TOTAL + '[aout]'; }
  else f += parts.join('') + (parts.length > 1 ? 'amix=inputs=' + parts.length + ':normalize=0:dropout_transition=0,' : '') + 'apad=whole_dur=' + TOTAL + ',atrim=duration=' + TOTAL + ',loudnorm=I=' + LUFS + ':TP=-1.5:LRA=11,aresample=48000[aout]';
  // movie.audio.loudnorm: "2pass" (hoặc env LOUDNORM=2pass): đo một lần rồi chuẩn hoá tuyến tính theo số đo — mặc định vẫn 1 lượt như trước
  const LN = 'loudnorm=I=' + LUFS + ':TP=-1.5:LRA=11';
  if (String((movie.audio && movie.audio.loudnorm) || process.env.LOUDNORM || '').toLowerCase() === '2pass' && f.includes(LN + ',aresample')) {
    fs.writeFileSync(path.join(work, 'af1.txt'), f.replace(LN + ',aresample', LN + ':print_format=json,aresample'));
    const err = await runErr(FFMPEG, [...args.map((a) => (a === '-v' ? '-v' : a === 'error' ? 'info' : a)), '-filter_complex_script', path.join(work, 'af1.txt'), '-map', '[aout]', '-f', 'null', '-']);
    const m = JSON.parse((err.match(/\{\s*"input_i"[\s\S]*?\}/) || ['{}'])[0]); const ok = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'].every((k) => Number.isFinite(Number(m[k])));
    if (ok) { f = f.replace(LN + ',aresample', LN + ':measured_I=' + m.input_i + ':measured_TP=' + m.input_tp + ':measured_LRA=' + m.input_lra + ':measured_thresh=' + m.input_thresh + ':offset=' + m.target_offset + ':linear=true,aresample'); log('loudnorm 2pass: đo', m.input_i, 'LUFS', m.input_tp, 'dBTP'); }
    else log('loudnorm 2pass: không đọc được số đo → 1 lượt');
  }
  fs.writeFileSync(path.join(work, 'af.txt'), f);
  args.push('-filter_complex_script', path.join(work, 'af.txt'), '-map', '[aout]', '-ac', '2', '-ar', '48000', out);
  await run(FFMPEG, args);
}
// như run(), trả về stderr (số đo loudnorm)
function runErr(cmd, args) {
  return new Promise((res, rej) => { const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; p.stderr.on('data', (d) => { err += d; if (err.length > 200000) err = err.slice(-200000); });
    p.on('close', (c) => (c === 0 ? res(err) : rej(new Error(cmd + ' exit ' + c + ': ' + err.slice(-1500))))); });
}

main().catch((e) => {
  console.error(e);
  fs.writeFileSync(path.join(outDir, id + '.result.json'), JSON.stringify({ id, status: 'error', message: String(e.message || e).slice(0, 1500) }, null, 1));
  process.exit(1);
});
