// anim.mjs — phần tử "anim": nhúng một trang anim.seek (hợp đồng motion2code: window.anim = { duration, seek(t) },
// <html data-ready="1">, ?external=1 không tự chạy) vào cảnh của render.mjs, làm cả cảnh hoặc lớp phủ, tua đúng từng khung
// theo đồng hồ của cảnh.
//   { "type": "anim", "src": "<id>/<tên>.html", "start", "duration", "seek", "speed", "loop", "until", "x", "y", "width",
//     "height", "fit": "contain"|"cover", "background": "page"|"transparent", "hide": ["#bg"], "timeout", "on-error": "fail"|"hide" }
//   "html": "<!doctype html>…" thay cho "src" (cả trang viết thẳng trong job; đường dẫn tương đối tính từ thư mục chứa file job JSON)
// Mỗi phần tử là một <iframe> trỏ tới BẢN SAO của trang trong work/ (không bao giờ sửa trang gốc): đồng hồ ảo VCLOCK của
// render.mjs chèn ngay sau doctype (mốc Date.now cố định, new Date() không đối số cũng theo đồng hồ ảo), Math.random theo seed
// của job + nội dung trang, GSAP CDN → node_modules; setTimeout/setInterval được đếm từ đầu trang (W_BOOT_TIMERS).
// Cổng chờ trong window.ready() (PAGE_JS): data-ready, hợp đồng, mọi font khai báo, ảnh (tới hết "timeout"), rồi mới chụp khung
// đầu. Trang hỏng hợp đồng → job lỗi (mặc định) hoặc bỏ phần tử ("on-error": "hide"; lần chạy thử hỏng → bỏ ở mọi cảnh, hỏng
// lúc dựng một cảnh → chỉ bỏ ở cảnh đó, mỗi cảnh tự quyết, không phụ thuộc thứ tự dựng song song). Trang treo → chó canh (watch).
// Chạy thử mỗi trang một lần trước TTS (prepare: đọc anim.duration, tua thử 5 mốc).
// Không dùng API Node ≥ 21: es-editor chạy engine này bằng Node 20.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const FEATURES = ['anim'];
export const EPOCH = 1767225600000; // 2026-01-01T00:00:00Z: Date.now() trong trang = EPOCH + mili giây của trang
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GSAP_DIR = path.join(HERE, 'node_modules', 'gsap', 'dist');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const has = (v) => v !== undefined && v !== null;
const isNum = (v) => (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
const short = (s, n = 80) => { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; };

export const isAnim = (e) => !!e && (e.type === 'anim' || e.type === 'motion2code');
// live = đã qua prepare và lần chạy thử không hỏng (page.dead chỉ đặt trong prepare, trước khi dựng cảnh nào → kết quả không
// phụ thuộc RENDER_CONCURRENCY; hỏng lúc dựng một cảnh chỉ bỏ phần tử ở cảnh đó; "on-error": "fail" vẫn dựng để tự báo lỗi)
export const isLive = (e) => isAnim(e) && !!e._anim && !(e._anim.page.dead && e._anim.policy === 'hide');

// ---------- thời gian: giây của phần tử → giây của trang (thuần, cũng được chèn vào trang bằng toString) ----------
// lt = giây của cảnh − start của phần tử; m = { seek, speed, loop, dur, until? }
export function mapTime(lt, m) {
  let u = m.seek + Math.max(0, lt) * m.speed;
  u = Math.round(u * 1e6) / 1e6; // 4.999999999 → 5 → 0 khi lặp: không rung ở mối nối vì sai số float
  if (!(m.dur > 0)) return u;
  if (m.loop) { const r = Math.round((u % m.dur) * 1e6) / 1e6; return r < 0 ? r + m.dur : r >= m.dur ? 0 : r; } // frame(D) == frame(0) theo hợp đồng
  return Math.min(u, m.until > 0 ? Math.min(m.until, m.dur) : m.dur); // loop:false → đứng ở until (mặc định D)
}

// ---------- kiểm tra job (thuần) ----------
const KNOWN = new Set(['type', 'src', 'html', 'start', 'duration', 'seek', 'speed', 'loop', 'until', 'x', 'y', 'width', 'height', 'fit', 'background',
  'hide', 'z-index', 'fade-in', 'fade-out', 'keyframes', 'animation', 'rotate', 'zoom', 'timeout', 'on-error', 'comment', 'id']);
const SOUND = new Set(['volume', 'muted', 'audio']);
const REMOTE = /^(?!file:)(?:[a-z][a-z0-9+.-]+:|\/\/)/i; // http(s):, data:, //host… (một chữ cái + ":" là ổ đĩa Windows, không tính)
const ENUMS = { fit: ['contain', 'cover'], background: ['page', 'transparent'], 'on-error': ['fail', 'hide'] };

// e = phần tử anim; ctx = { W, H, stage?: [w,h] (cho W_ASPECT), dur?: anim.duration (cho until ≤ D, sau lần chạy thử) }
// → { errors: [{code,msg}], warnings: [{code,msg}] }
export function validate(e, ctx = {}) {
  const errors = []; const warnings = [];
  const E = (code, msg) => errors.push({ code, msg }); const Wn = (code, msg) => warnings.push({ code, msg });
  const hasSrc = typeof e.src === 'string' && e.src.trim() !== ''; const hasHtml = typeof e.html === 'string' && e.html.trim() !== '';
  if (hasSrc === hasHtml) E('E_ANIM_SRC_MISSING', 'give exactly one of "src" (page file) or "html" (inline document)');
  else if (hasSrc && REMOTE.test(e.src.trim())) E('E_ANIM_SRC_REMOTE', 'src must be a local page file, not "' + short(e.src) + '" (pages run with --disable-web-security)');
  const n = (k, ok, rule) => {
    if (!has(e[k])) return;
    if (!isNum(e[k])) { E('E_ANIM_FIELD', k + ' must be a number (got ' + short(JSON.stringify(e[k]), 40) + ')'); return; }
    if (ok && !ok(Number(e[k]))) E('E_ANIM_FIELD', k + ' ' + rule + ' (got ' + e[k] + ')');
  };
  n('start'); n('x'); n('y');
  n('duration', (v) => v > 0, 'must be > 0');
  n('seek', (v) => v >= 0, 'must be ≥ 0');
  n('speed', (v) => v > 0 && v <= 16, 'must be > 0 and ≤ 16');
  n('width', (v) => v > 0, 'must be > 0'); n('height', (v) => v > 0, 'must be > 0');
  n('timeout', (v) => v >= 1 && v <= 120, 'must be between 1 and 120 s');
  if (has(e.loop) && typeof e.loop !== 'boolean') E('E_ANIM_FIELD', 'loop must be true or false (got ' + short(JSON.stringify(e.loop), 40) + ')');
  if (has(e.until)) {
    const seek = isNum(e.seek) ? Number(e.seek) : 0;
    if (!isNum(e.until)) E('E_ANIM_FIELD', 'until must be a number (got ' + short(JSON.stringify(e.until), 40) + ')');
    else if (e.loop !== false) E('E_ANIM_FIELD', 'until only works with "loop": false (page second where the element stops and holds)');
    else if (Number(e.until) <= seek) E('E_ANIM_FIELD', 'until must be > seek (' + seek + ') (got ' + e.until + ')');
    else if (ctx.dur > 0 && Number(e.until) > ctx.dur + 1e-9) E('E_ANIM_FIELD', 'until must be ≤ the page duration ' + ctx.dur + ' s (got ' + e.until + ')');
  }
  for (const [k, list] of Object.entries(ENUMS)) if (has(e[k]) && !list.includes(e[k])) E('E_ANIM_FIELD', k + ' must be one of ' + list.join(' | ') + ' (got ' + short(JSON.stringify(e[k]), 40) + ')');
  if (has(e.hide)) {
    // mỗi selector một <style> riêng (một selector sai không kéo theo các luật khác); cấm { } < > ; và chú thích /* */
    if (!Array.isArray(e.hide) || e.hide.length > 20 || e.hide.some((s) => typeof s !== 'string' || !s.trim() || /[{}<>;]|\/\*|\*\//.test(s)))
      E('E_ANIM_FIELD', 'hide must be a list of at most 20 CSS selectors without { } < > ; /* */ (got ' + short(JSON.stringify(e.hide), 60) + ')');
  }
  for (const k of Object.keys(e)) {
    if (k.startsWith('_') || KNOWN.has(k)) continue;
    Wn('W_FIELD', SOUND.has(k) ? '"' + k + '" ignored: an anim element never makes sound' : 'unknown field "' + k + '" ignored');
  }
  if (e.fit === 'cover' && Array.isArray(e.keyframes) && e.keyframes.some((f) => f && (has(f.width) || has(f.height))))
    Wn('W_COVER_RESIZE', 'fit "cover" with width/height keyframes: the page size is computed once and does not follow them');
  if (ctx.stage && (e.fit || 'contain') === 'contain') {
    const w = isNum(e.width) ? Number(e.width) : ctx.W; const h = isNum(e.height) ? Number(e.height) : ctx.H;
    if (w > 0 && h > 0 && Math.abs((w / h) / (ctx.stage[0] / ctx.stage[1]) - 1) > 0.01)
      Wn('W_ASPECT', 'box ' + w + 'x' + h + ' and page stage ' + ctx.stage.join('x') + ' differ in aspect: the page letterboxes (fit "contain")');
  }
  return { errors, warnings };
}
export function validateMovie(movie) {
  const errors = [];
  (movie && Array.isArray(movie.elements) ? movie.elements : []).forEach((e, i) => {
    if (isAnim(e)) errors.push({ code: 'E_ANIM_PLACEMENT', msg: 'anim elements go inside scenes[].elements (found in movie.elements[' + i + '])' });
  });
  return { errors, warnings: [] };
}

// src → { file } hoặc { error: {code,msg} }. Tương đối: thư mục chứa file job trước, rồi thư mục đang chạy (gốc repo trên CI).
export function resolveSrc(src, o = {}) {
  const s = String(src || '').trim(); const cwd = o.cwd || process.cwd();
  if (REMOTE.test(s)) return { error: { code: 'E_ANIM_SRC_REMOTE', msg: 'src must be a local page file, not "' + short(s) + '" (pages run with --disable-web-security)' } };
  let cands;
  if (/^file:/i.test(s)) { try { cands = [fileURLToPath(s)]; } catch (x) { return { error: { code: 'E_ANIM_SRC_NOT_FOUND', msg: 'bad file URL "' + short(s) + '"' } }; } }
  else if (path.isAbsolute(s)) cands = [s];
  else cands = [...new Set([o.jobDir, cwd].filter(Boolean).map((d) => path.resolve(d, s)))];
  const file = cands.find((f) => fs.existsSync(f));
  if (!file) return { error: { code: 'E_ANIM_SRC_NOT_FOUND', msg: '"' + short(s) + '" not found (tried ' + cands.join(', ') + ')' } };
  if (!/\.html?$/i.test(file) || !fs.statSync(file).isFile()) return { error: { code: 'E_ANIM_SRC_TYPE', msg: 'src must be an .html file: "' + short(s) + '"' } };
  // render.yml coi thư mục jobs/<x>/ có index.html là dự án HyperFrames → không được đặt trang anim ở đó
  for (const r of new Set([o.repo || HERE, cwd])) {
    const rel = path.relative(r, file).split(path.sep).join('/');
    if (/^jobs\/[^/]+\/index\.html$/i.test(rel)) return { error: { code: 'E_ANIM_SRC_HF_ROUTE', msg: rel + ' would be rendered as a HyperFrames project (render.yml); rename it, e.g. jobs/' + rel.split('/')[1] + '/intro.html' } };
  }
  return { file };
}

// cỡ sân khấu: viewBox của <svg id="stage"> (mẫu motion2code), rồi <svg viewBox> đầu tiên, rồi 1920×1080 + W_FIXED_LAYOUT
const VB = /\bviewBox\s*=\s*["']\s*(-?[\d.eE+-]+)[\s,]+(-?[\d.eE+-]+)[\s,]+([\d.eE+]+)[\s,]+([\d.eE+]+)\s*["']/;
export function stageSize(html) {
  const tags = String(html).replace(/<!--[\s\S]*?-->/g, '').match(/<svg\b[^>]*>/gi) || [];
  const pick = tags.find((t) => /\bid\s*=\s*["']stage["']/i.test(t) && VB.test(t)) || tags.find((t) => VB.test(t));
  if (pick) { const m = pick.match(VB); const w = Number(m[3]); const h = Number(m[4]); if (w > 0 && h > 0) return { size: [w, h], warnings: [] }; }
  return { size: [1920, 1080], warnings: [{ code: 'W_FIXED_LAYOUT', msg: 'the page has no <svg viewBox>: stage assumed 1920x1080 (a page laid out in fixed px may not scale to the box)' }] };
}

// ---------- bản sao trang (thuần trừ việc xem file GSAP có trong node_modules không) ----------
const GSAP_CDN = /https?:\/\/(?:cdnjs\.cloudflare\.com\/ajax\/libs\/gsap\/3\.[\d.]+\/|cdn\.jsdelivr\.net\/npm\/gsap@3[\d.]*\/dist\/|unpkg\.com\/gsap@3[\d.]*\/dist\/)([A-Za-z0-9]+?)(?:\.min)?\.js/g;
const GSAP_VER = /(?:ajax\/libs\/gsap\/|npm\/gsap@|unpkg\.com\/gsap@)(3[\d.]*\d)/;
// doctype (sau BOM, khoảng trắng, chú thích): chèn ngay sau nó → trang giữ chế độ chuẩn (không quirks) dù thiếu thẻ <html>/<head>
const DOCTYPE = /^(﻿?\s*(?:<!--[\s\S]*?-->\s*)*<!doctype[^>]*>)/i;
const ERR_TAG = '<script>window.__esErr=[];addEventListener("error",(e)=>__esErr.push(String(e.message||e)));'
  + 'addEventListener("unhandledrejection",(e)=>__esErr.push("unhandled rejection: "+String(e.reason&&e.reason.message||e.reason)))</script>';
// hẹn giờ lúc khởi động chạy theo giờ thật: đếm lần hẹn giờ chạy SAU data-ready mà đổi DOM (MutationObserver) và setInterval
// còn chạy ở cổng — trạng thái đó tuỳ trang tải nhanh hay chậm → W_BOOT_TIMERS. Hẹn giờ chạy xong trước data-ready là một phần
// của lúc dựng trang; setTimeout dự phòng còn chờ (vd. race với document.fonts.ready) bị cổng huỷ: không tính.
const TIMER_TAG = '<script>(()=>{const st=setTimeout,si=setInterval,ct=clearTimeout,ci=clearInterval;const iv=new Set();let racy=0,mut=0,on=true;'
  + 'const mo=new MutationObserver(()=>{mut++});try{mo.observe(document,{subtree:true,childList:true,attributes:true,characterData:true})}catch(e){}'
  + 'const rd=()=>{const h=document.documentElement;return !!h&&h.dataset.ready==="1"};'
  + 'const mk=(orig,rep)=>function(f,...a){if(typeof f!=="function")return orig.call(this,f,...a);let id;'
  + 'id=orig.call(this,function(){if(!rep)iv.delete(id);if(!on||!rd())return f.apply(this,arguments);mo.takeRecords().length&&mut++;const m0=mut;'
  + 'try{return f.apply(this,arguments)}finally{if(mo.takeRecords().length||mut>m0)racy++}},...a);if(rep)iv.add(id);return id};'
  + 'const cl=(orig)=>function(id){iv.delete(id);return orig.call(this,id)};'
  + 'window.setTimeout=mk(st,false);window.setInterval=mk(si,true);window.clearTimeout=cl(ct);window.clearInterval=cl(ci);'
  + 'window.__esTimers=()=>{on=false;mo.disconnect();return{intervals:iv.size,racy}}})()</script>';
// new Date() không đối số (và Date() gọi như hàm) theo đồng hồ ảo, như Date.now; Date.parse/UTC, instanceof giữ nguyên.
// Chỉ trong bản sao trang: cổng chờ (trang cảnh) vẫn đo giờ thật bằng new Date().
const DATE_TAG = '<script>(()=>{const RD=Date;function D(...a){return new.target?Reflect.construct(RD,a.length?a:[RD.now()],new.target):new RD(RD.now()).toString()}'
  + 'Object.defineProperty(D,"length",{value:7});D.prototype=RD.prototype;D.now=()=>RD.now();D.parse=RD.parse;D.UTC=RD.UTC;'
  + 'Object.defineProperty(RD.prototype,"constructor",{value:D,writable:true,configurable:true});window.Date=D})()</script>';
// o = { vclock, seedTag, baseHref, gsapDir (null = giữ GSAP của trang), gsapVersion, transparent, hide }
// → { html, kept: [URL GSAP không có bản cục bộ], gsap: { page, used }, epochFrozen }
export function workCopy(src, o = {}) {
  src = String(src); const kept = []; let rewrote = false;
  const pv = (src.match(GSAP_VER) || [])[1] || null;
  let html = !o.gsapDir ? src : src.replace(GSAP_CDN, (m, f) => {
    const p = path.join(o.gsapDir, f + '.min.js');
    if (fs.existsSync(p)) { rewrote = true; return pathToFileURL(p).href; }
    kept.push(m); return m;
  });
  let base = o.baseHref || '';
  const own = html.replace(/<!--[\s\S]*?-->/g, '').match(/<base\b[^>]*\bhref\s*=\s*["']([^"']*)["']/i); // <base> riêng của trang: tính theo thư mục gốc
  if (own && base) { try { base = new URL(own[1], base).href; } catch (x) { /* giữ base */ } }
  const vclock = String(o.vclock || '').replace('const D0=Date.now()', 'const D0=' + EPOCH);
  // meta charset trước tiên: phần chèn ~1 KB sẽ đẩy meta charset của trang ra khỏi 1024 byte đầu mà trình duyệt dò mã chữ
  const inj = '<meta charset="utf-8">' + ERR_TAG + TIMER_TAG + vclock + (o.vclock ? DATE_TAG : '') + (o.seedTag || '') + (base ? '<base href="' + base.replace(/"/g, '%22') + '">' : '');
  const m = html.match(DOCTYPE);
  html = m ? m[1] + inj + html.slice(m[1].length) : inj + html;
  const css = '*,*::before,*::after{transition:none!important}' + (o.transparent ? 'html,body{background:transparent!important}' : '');
  // mỗi selector của hide một <style>: chuỗi / ngoặc [ ( chưa đóng trong một selector không nuốt các luật sau nó
  const hide = (o.hide || []).map((s) => '<style data-es-anim>' + s + '{display:none!important}</style>').join('');
  // cuối file (trình duyệt tự đưa vào <body>); tìm </head> có thể trúng chữ trong chú thích / chuỗi script
  return { html: html + '<style data-es-anim>' + css + '</style>' + hide, kept, gsap: { page: pv, used: rewrote ? o.gsapVersion || 'local' : pv }, epochFrozen: !!o.vclock && vclock !== o.vclock };
}

// ---------- thời lượng, SPEC, HTML trong cảnh (thuần) ----------
// giây phần tử chiếm trong cảnh khi cảnh không có duration: duration, hoặc một vòng (loop), hoặc tới until/hết trang
export function span(e, dur = e && e._anim ? e._anim.page.dur : 0) {
  const g = (k, d) => (isNum(e[k]) ? Number(e[k]) : d);
  const du = g('duration', 0); const sp = g('speed', 1) || 1; const sk = g('seek', 0);
  if (du > 0) return du;
  if (e.loop !== false) return dur / sp;
  return Math.max(0.2, (g('until', dur) - sk) / sp);
}
export function spec(e) {
  const A = e._anim; const n = A.n;
  return { src: A.label, seek: n.seek, speed: n.speed, loop: n.loop, until: n.until, dur: A.page.dur, timeout: n.timeout, policy: n.policy, hide: n.hide };
}
// fit cover: iframe đúng tỉ lệ sân khấu, phủ kín hộp, hộp cắt phần thừa (overflow:hidden) — vẫn là vector, không phóng CSS
export function coverRect(w, h, sw, sh) {
  const k = Math.max(w / sw, h / sh); const iw = Math.ceil(sw * k - 1e-6); const ih = Math.ceil(sh * k - 1e-6);
  return { left: Math.floor((w - iw) / 2), top: Math.floor((h - ih) / 2), width: iw, height: ih };
}
const iframeTag = (url, css) => '<iframe class="es-anim" src="' + String(url).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '" loading="eager" scrolling="no" tabindex="-1" aria-hidden="true"'
  + ' style="position:absolute;border:0;display:block;background:transparent;' + css + '"></iframe>';
export function box(e, eid, boxCss, w, h) {
  const A = e._anim; let css = 'left:0;top:0;width:100%;height:100%';
  if (A.n.fit === 'cover') { const r = coverRect(w, h, A.page.stage[0], A.page.stage[1]); css = 'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px'; }
  return '<div id="' + eid + '" style="' + boxCss + 'width:' + w + 'px;height:' + h + 'px;overflow:hidden">' + iframeTag(A.page.url, css) + '</div>';
}

// ---------- chó canh (Node): iframe chạy chung luồng với trang cảnh → trang treo chặn cả cổng chờ lẫn setTimeout trong trang ----------
// ms falsy → trả nguyên promise (cảnh không có anim không đi đường mới)
export function watch(p, ms, what) {
  if (!ms) return p; let id;
  return Promise.race([p, new Promise((_, j) => { id = setTimeout(() => j(new Error('E_ANIM_HUNG: ' + what + ' did not answer within ' + Math.round(ms / 1000) + ' s (a page script never returned)')), ms); })])
    .finally(() => clearTimeout(id));
}
// ngân sách cho window.ready() của một cảnh: timeout lớn nhất (cổng chờ của phần tử kể cả font/ảnh không vượt quá nó) + 40 s
// (font + ảnh của trang cảnh chờ trước), 0 = cảnh không có anim
export function budget(s) {
  const t = s.elements.filter(isLive).map((e) => e._anim.n.timeout);
  return t.length ? Math.max(...t) * 1000 + 40000 : 0;
}

// ---------- mã trong trang cảnh: cổng chờ + tua ----------
export const PAGE_JS = `
window.__esAnim = (() => {
  const mapTime = ${mapTime.toString()};
  const STEP = 25;
  const wall = () => new Date().getTime(); // VCLOCK đóng băng Date.now và performance.now của trang cảnh, new Date() thì không (chỉ bản sao trang có DATE_TAG)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cap = (p, ms) => Promise.race([Promise.resolve(p).then(() => true, () => true), sleep(Math.max(0, ms)).then(() => false)]);
  const msg = (x) => String((x && x.message) || x);
  const items = [];
  // một khung của trang ở giây pt: CSS animation, SMIL, rAF (đồng hồ ảo trong trang), rồi anim.seek sau cùng (quyết định)
  function frame(m, pt) {
    for (const a of m.doc.getAnimations()) { a.pause(); a.currentTime = pt * 1000; }
    if (m.smil) for (const s of m.doc.querySelectorAll('svg')) if (!s.ownerSVGElement) { s.pauseAnimations(); s.setCurrentTime(pt); }
    m.win.__esTick(pt * 1000);
    m.win.anim.seek(pt);
  }
  async function gate(e) {
    const m = e.m2c; const it = { id: e.id, src: m.src, ok: false, ms: 0, dur: 0, problems: [], warnings: [] }; items.push(it);
    const box = document.getElementById(e.id); const fr = box && box.querySelector('iframe.es-anim');
    const t0 = wall(); const deadline = t0 + Math.max(1, m.timeout) * 1000; const left = () => Math.max(0, deadline - wall());
    const doc = () => { try { return fr && fr.contentDocument; } catch (x) { return null; } };
    const fail = (code, text) => { it.ms = wall() - t0; it.problems.push(code + ': ' + text); if (m.policy === 'hide') { e.end = -1e9; it.fallback = 'hide'; } return it; };
    const state = () => { const d = doc(); return !d ? 'no-access' : d.readyState !== 'complete' ? 'loading' : d.documentElement.dataset.ready !== '1' ? 'not-ready' : 'ok'; };
    let st; let na = 0;
    while ((st = state()) !== 'ok' && left() > 0) {
      na = st === 'no-access' ? na + 1 : 0;
      if (na >= 4) break; // sự kiện load của trang cảnh đã chờ iframe: vẫn không đọc được = không bao giờ đọc được
      try { const w0 = fr && fr.contentWindow; if (w0 && typeof w0.__esTick === 'function') w0.__esTick(0); } catch (x) {} // code chờ rAF lúc khởi động chạy được, thời gian vẫn là 0
      await sleep(STEP);
    }
    if (st === 'no-access') return fail('E_ANIM_NO_ACCESS', 'cannot read the page document (page failed to load, or Chromium runs without --disable-web-security)');
    const perr = () => { try { const x = fr.contentWindow.__esErr; return x && x.length ? '; page errors: ' + x.slice(0, 3).join(' | ') : ''; } catch (q) { return ''; } };
    if (st !== 'ok') return fail('E_ANIM_NOT_READY', '<html data-ready="1"> not set within ' + m.timeout + ' s (state: ' + st + perr() + ')');
    const d = doc(); const w = fr.contentWindow;
    if (typeof w.__esTick !== 'function' || !Array.isArray(w.__esErr)) return fail('E_ANIM_INJECT', 'the es-render clock is missing in the page (work copy injection failed)');
    if (!w.anim || typeof w.anim.seek !== 'function') return fail('E_ANIM_NO_CONTRACT', 'window.anim.seek is not a function' + perr());
    const dur = Number(w.anim.duration);
    if (!(Number.isFinite(dur) && dur > 0)) return fail('E_ANIM_BAD_DURATION', 'window.anim.duration must be a number > 0 (got ' + w.anim.duration + ')');
    const loadingAtReady = [...d.fonts].filter((f) => f.status === 'loading').length;
    let pr = null; try { pr = typeof w.anim.ready === 'function' ? w.anim.ready() : w.anim.ready; } catch (x) { return fail('E_ANIM_NOT_READY', 'anim.ready threw: ' + msg(x)); }
    if (pr && typeof pr.then === 'function') {
      let rej = null; const okp = await cap(Promise.resolve(pr).catch((x) => { rej = x || 'rejected'; }), left());
      if (rej) return fail('E_ANIM_NOT_READY', 'anim.ready rejected: ' + msg(rej));
      if (!okp) return fail('E_ANIM_NOT_READY', 'anim.ready did not resolve within ' + m.timeout + ' s');
    }
    // đóng băng: gsap.ticker.sleep() không giữ được (totalTime() của GSAP đánh thức ticker ở lần seek sau) → dừng cả timeline gốc
    try { if (w.anim.pause) w.anim.pause(); } catch (x) {}
    if (w.gsap && w.gsap.globalTimeline) try { w.gsap.globalTimeline.pause(); } catch (x) {}
    try { const bt = typeof w.__esTimers === 'function' ? w.__esTimers() : null;
      if (bt && (bt.intervals || bt.racy)) it.warnings.push('W_BOOT_TIMERS: ' + bt.racy + ' timer callback(s) changed the page after data-ready, ' + bt.intervals
        + ' setInterval(s) still running at the gate (now stopped): the frozen state depends on how long the page took to load; drive it from anim.seek(t)'); } catch (x) {}
    const top = w.setTimeout(() => {}, 0); for (let i = 1; i <= top; i++) { w.clearTimeout(i); w.clearInterval(i); }
    let late = 0; w.setTimeout = w.setInterval = () => { late++; return 0; }; m.late = () => late;
    m.win = w; m.doc = d; m.dur = dur; it.dur = dur;
    m.smil = !!d.querySelector('animate,animateTransform,animateMotion,animateColor,set');
    const p0 = mapTime(0, m);
    // tua lần đầu + layout TRƯỚC khi chờ font, để các font khung đầu dùng bắt đầu tải
    try { frame(m, p0); d.documentElement.getBoundingClientRect(); } catch (x) { m.win = null; return fail('E_ANIM_SEEK_THREW', 'anim.seek(' + p0.toFixed(3) + ') threw at the first seek: ' + msg(x)); }
    // mọi font khai báo (cả @font-face CSS), không chỉ font đã dàn trang: font dùng lần đầu ở giây 3 sẽ tải giữa chừng → chữ trống
    const faces = Promise.all([...d.fonts].map((f) => (f.status === 'unloaded' ? f.load() : f.loaded).catch(() => 0))).then(() => d.fonts.ready);
    // tới hết hạn của phần tử ("timeout"), không cắt ngắn: font tới muộn hơn sẽ đổi giữa cảnh ở khung tuỳ giờ thật
    if (!(await cap(faces, left()))) it.warnings.push('W_FONTS: fonts still loading after the ' + m.timeout + ' s wait');
    m.pendingFaces = [...d.fonts].filter((f) => f.status === 'loading');
    const bad = [...d.fonts].filter((f) => f.status === 'error').map((f) => f.family); if (bad.length) it.warnings.push('W_FONTS: failed to load ' + [...new Set(bad)].join(', '));
    if (loadingAtReady) it.warnings.push('W_LATE_FONTS: ' + loadingAtReady + ' font face(s) still loading at data-ready; page re-seeked after they loaded');
    for (const l of d.querySelectorAll('link[rel~="stylesheet"]')) if (!l.sheet) it.warnings.push('W_STYLESHEET: ' + l.href);
    const imgs = [...d.images].filter((im) => im.src).map((im) => im.decode().catch(() => it.warnings.push('W_IMAGE: ' + im.src)));
    for (const im of d.querySelectorAll('image')) { const h = im.href && im.href.baseVal; if (h) { const x = new w.Image(); x.src = new URL(h, d.baseURI).href; imgs.push(x.decode().catch(() => it.warnings.push('W_IMAGE: ' + h))); } }
    await cap(Promise.all(imgs), left());
    try { frame(m, p0); d.documentElement.getBoundingClientRect(); } catch (x) { m.win = null; return fail('E_ANIM_SEEK_THREW', 'anim.seek(' + p0.toFixed(3) + ') threw at the first seek: ' + msg(x)); }
    if (w.gsap && w.gsap.globalTimeline) try {
      const k = w.gsap.globalTimeline.getChildren(false, true, true).filter((c) => c !== w.anim.tl && c.duration() > 0);
      if (k.length) it.warnings.push('W_STRAY_TWEENS: ' + k.length + ' tween(s)/timeline(s) outside anim.tl stay frozen (they do not follow seek)');
    } catch (x) {}
    // GSAP tự đăng ký đúng 1 hàm ticker; hàm thêm bằng gsap.ticker.add chạy theo rAF tích luỹ (lag smoothing), không theo seek(t)
    try { const L = w.gsap && w.gsap.ticker && w.gsap.ticker._listeners;
      if (Array.isArray(L) && L.length > 1) it.warnings.push('W_TICKER: ' + (L.length - 1) + ' gsap.ticker listener(s) do not follow seek(t) (they drift after a loop wrap or a backward seek)'); } catch (x) {}
    if (m.smil) it.warnings.push('W_SMIL: SVG <animate*> elements are driven by setCurrentTime(page time)');
    for (const sel of m.hide || []) { try { if (!d.querySelector(sel)) it.warnings.push('W_HIDE: "' + sel + '" matches nothing'); } catch (x) { it.warnings.push('W_HIDE: invalid selector "' + sel + '"'); } }
    it.ms = wall() - t0; m.key = ''; it.ok = true; return it;
  }
  return {
    async ready(spec) { await Promise.all(spec.filter((e) => e.m2c).map(gate)); return { ok: items.every((i) => i.ok || i.fallback), items }; },
    // gọi từ window.seek cho phần tử đang hiện; trả mảnh chữ ký khung (cùng khoá 6 chữ số với chỗ bỏ qua khung trùng)
    seek(e, n, t) {
      const m = e.m2c; if (!m || !m.win) return '';
      const pt = mapTime(t - e.st, m); const key = pt.toFixed(6); if (key === m.key) return e.id + '~' + key + ';';
      try { frame(m, pt); } catch (x) {
        const text = 'anim ' + e.id + ' (' + m.src + '): E_ANIM_SEEK_THREW: anim.seek(' + pt.toFixed(3) + ') threw: ' + msg(x);
        if (m.policy !== 'hide') throw new Error(text);
        m.err = text; m.win = null; e.end = -1e9; if (n) n.style.visibility = 'hidden'; return e.id + '!;';
      }
      m.key = key; return e.id + '~' + key + ';';
    },
    report() {
      return items.map((i) => { const x = (window.SPEC || []).find((s) => s.id === i.id); const m = (x && x.m2c) || {};
        const swapped = (m.pendingFaces || []).filter((f) => f.status !== 'loading').map((f) => f.family + ' (' + f.status + ')');
        return Object.assign({}, i, { late_timers: m.late ? m.late() : 0, err: m.err || '', font_swaps: [...new Set(swapped)] }); });
    }
  };
})();
`;

// ---------- chuẩn bị (trước TTS): kiểm tra → bản sao trang → chạy thử từng trang ----------
const sceneTag = (s) => 'anim: scene ' + (s.i + 1) + (s.comment ? ' ("' + short(String(s.comment), 60) + '")' : '');
const fmt = (w) => w.code + ': ' + w.msg;
function normalize(e, W, H, defTimeout) {
  const f = (k, d) => (isNum(e[k]) ? Number(e[k]) : d);
  const n = { seek: f('seek', 0), speed: f('speed', 1), loop: e.loop !== false, until: e.loop === false && isNum(e.until) ? Number(e.until) : 0, duration: f('duration', 0),
    x: f('x', 0), y: f('y', 0), width: f('width', W), height: f('height', H), fit: e.fit || 'contain', background: e.background || 'page',
    hide: Array.isArray(e.hide) ? e.hide.map((s) => String(s).trim()) : [], timeout: f('timeout', defTimeout), policy: e['on-error'] || 'fail' };
  e.x = n.x; e.y = n.y; e.width = n.width; e.height = n.height; // sceneDoc của render.mjs dùng lại code cỡ hộp như html
  return n;
}
function previewDoc(P, vclock) {
  const [w, h] = P.stage.map((v) => Math.max(16, Math.min(4096, Math.round(v))));
  const e = { id: 'e0', st: 0, end: 1e9, m2c: { src: P.label, seek: 0, speed: 1, loop: false, until: 0, dur: 0, timeout: P.timeout, policy: 'fail', hide: P.hide } };
  return { w, h, html: '<!doctype html><html><head><meta charset="utf-8">' + vclock + '<style>html,body{margin:0;padding:0;width:' + w + 'px;height:' + h + 'px;overflow:hidden;background:#000}</style></head><body>'
    + '<div id="e0" style="position:absolute;left:0;top:0;width:' + w + 'px;height:' + h + 'px;overflow:hidden">' + iframeTag(P.url, 'left:0;top:0;width:100%;height:100%') + '</div>'
    + '<script>window.SPEC=' + JSON.stringify([e]).replace(/</g, '\\u003c') + ';' + PAGE_JS + '</script></body></html>' };
}
// lỗi từ page.evaluate → một dòng gọn (bỏ "page.evaluate:", "Error:", dòng stack)
const cleanErr = (x) => String((x && x.message) || x).replace(/^page\.evaluate:\s*/, '').split('\n').filter((l) => !/^\s+at\s/.test(l) && !/^Call log:/.test(l)).join(' ').replace(/^Error:\s*/, '').trim();
async function preflight(browser, P, ctx) {
  const out = { ok: false, dur: 0, ms: 0, problems: [], warnings: [] };
  const doc = previewDoc(P, ctx.vclock); const file = path.join(ctx.work, 'anim' + P.n + '-preflight.html'); fs.writeFileSync(file, doc.html);
  const c = await browser.newContext({ viewport: { width: doc.w, height: doc.h }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  try {
    const page = await c.newPage();
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: P.timeout * 1000 }).catch(() => {});
    const r = await watch(page.evaluate(() => window.__esAnim.ready(window.SPEC)), (P.timeout + 15) * 1000, 'preflight ready()');
    const it = r.items[0]; out.ms = it.ms; out.dur = it.dur; out.warnings.push(...it.warnings); out.problems.push(...it.problems);
    if (it.ok) {
      // tua thử: trang ném lỗi hoặc treo ở giây t nào đó cũng lộ ra trước TTS, không phải giữa lúc dựng
      const D = it.dur; const times = [...new Set([0, D / 4, D / 2, (3 * D) / 4, Math.max(0, D - 1 / (ctx.FPS || 30)), ...P.untils].map((t) => Math.round(t * 1e6) / 1e6))];
      for (const t of times) await watch(page.evaluate((t) => { const e = window.SPEC[0]; return window.__esAnim.seek(e, document.getElementById(e.id), t); }, t), 15000, 'preflight anim.seek(' + t.toFixed(3) + ')');
      out.ok = true;
    }
  } catch (x) {
    const m = cleanErr(x); const a = m.match(/^anim e\d+ \(.*?\): (E_ANIM_\w+: [\s\S]*)$/);
    out.problems.push(a ? a[1] : /^E_ANIM_/.test(m) ? m : 'E_ANIM_NOT_READY: ' + m);
  } finally { await watch(c.close(), 10000, 'close').catch(() => {}); } // đóng được cả khi renderer đang kẹt trong for(;;){}
  return out;
}
// ctx = { jobPath, movie, work, W, H, FPS, log, launch, vclock, seedFor(sha256 nguồn) → thẻ seed }
// Job không có anim: không mở trình duyệt, trả null.
export async function prepare(scenes, ctx) {
  const { jobPath = '.', movie = {}, work, W, H, log = () => {} } = ctx;
  const errors = validateMovie(movie).errors.map((x) => 'anim: ' + x.code + ': ' + x.msg);
  const list = [];
  for (const s of scenes) s.elements.forEach((e, k) => { if (isAnim(e)) list.push({ s, e, k }); });
  if (!list.length) { if (errors.length) throw new Error(errors.join('\n')); return null; }
  const jobDir = path.dirname(path.resolve(jobPath)); const cwd = process.cwd();
  const gsapMode = String(process.env.RENDER_ANIM_GSAP || '').toLowerCase() === 'page' ? 'page' : 'local';
  let gsapVersion = 'local'; try { gsapVersion = JSON.parse(fs.readFileSync(path.join(HERE, 'node_modules', 'gsap', 'package.json'), 'utf8')).version; } catch (x) { /* không có node_modules */ }
  const envT = Number(process.env.RENDER_ANIM_TIMEOUT); const defTimeout = envT >= 1 && envT <= 120 ? envT : 20;
  const pages = new Map();
  for (const { s, e, k } of list) {
    e.type = 'anim'; const where = sceneTag(s) + ' element e' + k;
    const hasSrc = typeof e.src === 'string' && e.src.trim() !== ''; const hasHtml = typeof e.html === 'string' && e.html.trim() !== '';
    let file = null; let rerr = null;
    if (hasSrc && !hasHtml) { const r = resolveSrc(e.src, { jobDir, cwd, repo: HERE }); if (r.error) rerr = r.error; else file = r.file; }
    const text = file ? fs.readFileSync(file, 'utf8') : hasHtml && !hasSrc ? e.html : null;
    const st = text != null ? stageSize(text) : null;
    const v = validate(e, { W, H, stage: st && st.size });
    for (const x of v.errors) errors.push(where + ': ' + x.code + ': ' + x.msg);
    if (rerr && !v.errors.some((x) => x.code.startsWith('E_ANIM_SRC'))) errors.push(where + ': ' + rerr.code + ': ' + rerr.msg);
    if (text == null || v.errors.length || rerr) continue;
    const n = normalize(e, W, H, defTimeout); const label = file ? e.src.trim() : 'inline html';
    const hash = sha256(text); const baseDir = file ? path.dirname(file) : jobDir;
    // cùng nội dung + cùng nền/ẩn/GSAP + cùng thư mục (đường dẫn tương đối) → dùng chung một bản sao
    const key = sha256([hash, n.background, n.hide.join('\n'), gsapMode, baseDir].join('|'));
    let P = pages.get(key);
    if (!P) { P = { n: pages.size, key, hash, label, text, baseDir, stage: st.size, background: n.background, hide: n.hide, timeout: n.timeout, untils: [], users: [], dead: false, why: '', warnings: [], dur: 0, gsap: null, url: '', seen: new Set() }; pages.set(key, P); }
    P.timeout = Math.max(P.timeout, n.timeout); if (n.until) P.untils.push(n.until);
    e._anim = { page: P, label, where, policy: n.policy, n, warnings: [...v.warnings, ...st.warnings].map(fmt), run: null };
    P.users.push({ s, e, k });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  for (const P of pages.values()) {
    const wc = workCopy(P.text, { vclock: ctx.vclock, seedTag: ctx.seedFor ? ctx.seedFor(P.hash) : '', baseHref: pathToFileURL(P.baseDir + path.sep).href,
      gsapDir: gsapMode === 'local' ? GSAP_DIR : null, gsapVersion, transparent: P.background === 'transparent', hide: P.hide });
    if (!wc.epochFrozen) throw new Error('anim: internal error: the VCLOCK epoch replacement did not match (render.mjs VCLOCK changed?)');
    const file = path.join(work, 'anim' + P.n + '.html'); fs.writeFileSync(file, wc.html, 'utf8');
    P.url = pathToFileURL(file).href + '?external=1'; P.gsap = wc.gsap; delete P.text;
    for (const u of wc.kept) P.warnings.push('W_GSAP_KEPT: ' + u + ' (no copy in node_modules/gsap/dist, loaded from the network)');
  }
  const t0 = Date.now(); const browser = await ctx.launch();
  let res;
  try { res = await Promise.all([...pages.values()].map((P) => preflight(browser, P, ctx))); }
  finally { await watch(browser.close(), 15000, 'browser.close()').catch(() => {}); }
  [...pages.values()].forEach((P, i) => {
    const r = res[i]; P.dur = r.dur; P.warnings.push(...r.warnings);
    log('anim', P.label + (P.background === 'transparent' ? ' [transparent]' : '') + (P.hide.length ? ' [hide ' + P.hide.join(' ') + ']' : ''), r.ok ? 'ok' : 'FAILED', 'D ' + P.dur + 's', 'stage ' + P.stage.join('x'), 'gsap ' + (P.gsap.page || '-') + '→' + (P.gsap.used || '-'), r.ms + 'ms',
      ...[...new Set([...P.warnings, ...P.users.flatMap((u) => u.e._anim.warnings)])].map((w) => '\n    ' + w));
    if (!r.ok) {
      const fails = P.users.filter((u) => u.e._anim.policy !== 'hide');
      if (fails.length) errors.push(fails[0].e._anim.where + ' (' + P.label + '): ' + r.problems.join('; ') + (P.users.length > 1 ? ' [page used by ' + P.users.length + ' elements]' : ''));
      else { P.dead = true; P.why = r.problems.join('; '); log('anim', P.label, 'dropped ("on-error": "hide"):', P.why); }
      return;
    }
    for (const u of P.users) { const v = validate(u.e, { dur: P.dur }); for (const x of v.errors) errors.push(u.e._anim.where + ': ' + x.code + ': ' + x.msg); }
  });
  if (errors.length) throw new Error(errors.join('\n'));
  log('anim', pages.size, 'page(s),', list.length, 'element(s), preflight', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  return { pages: pages.size, elements: list.length };
}

// ---------- sau cổng chờ / sau cảnh / result.json ----------
const elOf = (s, id) => s.elements[Number(String(id).slice(1))];
function note(e, w, log) { const P = e._anim.page; if (!P.seen.has(w)) { P.seen.add(w); log('anim', e._anim.label + ':', w); } }
// r = kết quả window.ready() (true khi cảnh không có anim). Lỗi "fail" → ném; "hide" → bỏ phần tử trong cảnh này (không lan sang
// cảnh khác: cảnh nào đã dựng trước hay sau tuỳ RENDER_CONCURRENCY, nên mỗi cảnh tự chạy cổng chờ và tự quyết)
export function afterReady(s, r, log = () => {}) {
  if (!r || r === true || !Array.isArray(r.items)) return;
  const errs = [];
  for (const it of r.items) {
    const e = elOf(s, it.id); if (!e || !e._anim) continue;
    e._anim.run = { ok: it.ok, ms: it.ms, dur: it.dur, problems: [...it.problems], warnings: [...it.warnings], fallback: it.fallback || '' };
    for (const w of it.warnings) note(e, w, log);
    if (!it.problems.length) continue;
    const where = e._anim.where + ' (' + e._anim.label + '): ' + it.problems.join('; ');
    if (it.fallback === 'hide') log(where, '→ hidden in this scene ("on-error": "hide")');
    else errs.push(where);
  }
  if (errs.length) throw new Error(errs.join('\n'));
}
export function afterScene(s, rep, log = () => {}) {
  for (const it of rep || []) {
    const e = elOf(s, it.id); if (!e || !e._anim || !e._anim.run) continue; const R = e._anim.run;
    if (it.late_timers > 0) { const w = 'W_TIMERS: ' + it.late_timers + ' setTimeout/setInterval call(s) after the gate were ignored (timers do not follow seek)'; R.warnings.push(w); note(e, w, log); }
    if (Array.isArray(it.font_swaps) && it.font_swaps.length) { const w = 'W_FONT_SWAPPED_MID_RENDER: ' + it.font_swaps.join(', ') + ' finished loading after the gate (earlier frames use the fallback font; raise "timeout")'; R.warnings.push(w); note(e, w, log); }
    if (it.err) { R.problems.push(it.err.replace(/^anim e\d+ \(.*?\): /, '')); R.fallback = 'hide'; log(e._anim.where + ':', it.err, '→ hidden from that frame on, in this scene only'); }
  }
}
// lỗi trong lúc tua một cảnh → "anim: scene N … element eK (src): E_…" cho lỗi anim, "scene N: …" cho lỗi khác
export function sceneError(s, err) {
  const m = cleanErr(err); const a = m.match(/^anim (e\d+) \((.*?)\): (E_ANIM_\w+: [\s\S]*)$/);
  if (a) return new Error(sceneTag(s) + ' element ' + a[1] + ' (' + a[2] + '): ' + a[3]);
  return new Error((/^E_ANIM_/.test(m) ? sceneTag(s) : 'scene ' + (s.i + 1)) + ': ' + m);
}
// { anims: [{ scene, el, src, ok, dur, stage, gsap, ready_ms, warnings, problems?, fallback? }] } — {} khi job không có anim
export function result(scenes) {
  const out = [];
  for (const s of scenes) s.elements.forEach((e, k) => {
    if (!isAnim(e) || !e._anim) return;
    const A = e._anim; const P = A.page; const R = A.run;
    const row = { scene: s.i + 1, el: 'e' + k, src: A.label, ok: !!(R && R.ok && !R.fallback), dur: P.dur, stage: P.stage, gsap: P.gsap, ready_ms: R ? R.ms : null,
      warnings: [...new Set([...A.warnings, ...P.warnings, ...(R ? R.warnings : [])])] };
    const problems = R ? R.problems : P.dead ? [P.why] : [];
    if (problems.length) row.problems = problems;
    if ((R && R.fallback) || (!R && P.dead)) row.fallback = 'hide';
    out.push(row);
  });
  return out.length ? { anims: out } : {};
}
