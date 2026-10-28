// libs.mjs — thư viện mới, chỉ nạp khi phần tử khai báo trong "libs": anime4 (anime.js v4), motion (Motion, vanilla), dotlottie, rive.
// Khoá cũ (gsap, anime = v3, lottie, three, plugin GSAP) vẫn do render.mjs lo y như trước: cảnh không xin khoá mới → HTML không đổi một byte.
// Cảnh có khoá mới thì thêm:
//   - PRE (trong <head>, trước thư viện mới): ES.wait / ES.busy, Date đóng băng (Date.now = EPOCH + giây ảo, new Date() không đối số cũng vậy)
//   - WAIT_JS (cuối PAGE_JS): window.ready() chờ ES.wait (có hạn), window.seek() chờ ES.busy (promise do runtime đẩy vào) trước khi chụp
// Quy tắc: thư viện chỉ chạy theo ES.onSeek(t) / đồng hồ ảo VCLOCK — không WAAPI, không worker, không CDN, không giờ thật.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const NM = path.join(HERE, 'node_modules');
export const EPOCH = 1767225600000; // 2026-01-01T00:00:00Z, như anim.mjs
// đường dẫn trong node_modules; "esm": nạp bằng <script type="module"> (gói không có bản UMD)
export const EXTRA = {
  anime4: { file: 'animejs4/dist/bundles/anime.umd.min.js', pkg: 'animejs4' },
  motion: { file: 'motion/dist/motion.js', pkg: 'motion' },
  dotlottie: { file: '@lottiefiles/dotlottie-web/dist/index.js', pkg: '@lottiefiles/dotlottie-web', esm: true },
  rive: { file: '@rive-app/canvas-advanced-single/canvas_advanced_single.mjs', pkg: '@rive-app/canvas-advanced-single', esm: true },
};
// tên gọi khác (đã chuẩn hoá: chữ thường, bỏ ký tự không phải chữ/số như libKey của render.mjs)
export const ALIAS = { animev4: 'anime4', animejs4: 'anime4', animejsv4: 'anime4', framermotion: 'motion', motionjs: 'motion', motiondev: 'motion',
  lottiedot: 'dotlottie', dotlottieweb: 'dotlottie', riveapp: 'rive', rivecanvas: 'rive' };
export const key = (k) => (EXTRA[k] ? k : ALIAS[k] || k);
export const isExtra = (k) => !!EXTRA[k];
export const fileOf = (k) => path.join(NM, EXTRA[k].file);
export function version(k) { try { return JSON.parse(fs.readFileSync(path.join(NM, EXTRA[k].pkg, 'package.json'), 'utf8')).version; } catch (e) { return '?'; } }

export const PRE = '<script>(()=>{const E=window.ES;E.wait=E.wait||[];E.busy=E.busy||[];E.waitMs=E.waitMs||0;E._libs=E._libs||{};E.lib=(k)=>E._libs[k];'
  + 'const RD=Date,T0=' + EPOCH + ';RD.now=()=>T0+Math.round(performance.now());'
  + 'function D(...a){return new.target?Reflect.construct(RD,a.length?a:[RD.now()],new.target):new RD(RD.now()).toString()}'
  + 'Object.defineProperty(D,"length",{value:7});D.prototype=RD.prototype;D.now=RD.now;D.parse=RD.parse;D.UTC=RD.UTC;'
  + 'Object.defineProperty(RD.prototype,"constructor",{value:D,writable:true,configurable:true});window.Date=D})()</script>';

// thẻ nạp từng khoá mới (theo thứ tự cố định). Thiếu file → lỗi E_LIB_MISSING (khoá cũ thì im lặng như trước).
const TAG = {
  // anime v4 đè window.anime → v4 luôn ở window.anime4; cảnh cũng xin "anime" (v3) thì window.anime vẫn là v3, không thì là v4
  anime4: (u) => '<script>window.__a3=window.anime</script><script src="' + u + '"></script>'
    + '<script>window.anime4=window.anime;if(window.__a3)window.anime=window.__a3;delete window.__a3;try{anime4.engine.pauseOnDocumentHidden=false}catch(e){}</script>',
  // Motion: useManualTiming → giá trị đi qua frameloop JS (không WAAPI). ES.motion(c, start): c.time = giây phần tử rồi xả frameloop
  // ngay trong lượt tua (không thì giá trị trễ một khung: VCLOCK chạy rAF trước ES.onSeek).
  motion: (u) => '<script src="' + u + '"></script><script>(function(M){if(!M||!M.MotionGlobalConfig||!M.frameSteps)throw new Error("E_MOTION_CONFIG: Motion UMD thiếu MotionGlobalConfig/frameSteps");'
    + 'M.MotionGlobalConfig.useManualTiming=true;M.MotionGlobalConfig.skipAnimations=false;const L=[];'
    + 'const flush=()=>{const S=M.frameSteps;for(const k of Object.keys(S))try{S[k].process(M.frameData)}catch(e){}};'
    + 'ES.motion=(c,st)=>{try{c.pause()}catch(e){}L.push([c,+st||0]);return c};ES.motionFlush=flush;'
    + 'ES.onSeek.push((t)=>{if(!L.length)return;for(const [c,st] of L)c.time=Math.max(0,t-st);flush()})})(window.Motion)</script>',
  // ESM: module chạy sau script thường → ES.lib("dotlottie") / ES.lib("rive") là promise; ready() chờ nạp xong
  // dotLottie: wasm của gói (không phải CDN) qua blob: — setWasmUrl trước khi tạo player đầu tiên, nếu không player tự tải từ jsdelivr/unpkg
  dotlottie: (u, o) => '<script src="' + wasmJs(o, 'dotlottie', '@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm') + '"></script>'
    + esm('dotlottie', 'import { DotLottie } from "' + u + '";', 'const b = Uint8Array.from(atob(window.__esWasm.dotlottie), (c) => c.charCodeAt(0)); delete window.__esWasm.dotlottie;'
      + ' DotLottie.setWasmUrl(URL.createObjectURL(new Blob([b], { type: "application/wasm" }))); window.DotLottie = DotLottie; done(DotLottie);'),
  // Rive (bản canvas "single": wasm nằm sẵn trong .mjs) → ES.lib("rive") = runtime đã khởi tạo; tải file luôn với enableRiveAssetCDN = false
  rive: (u) => esm('rive', 'import RiveCanvas from "' + u + '";', 'window.RiveCanvas = RiveCanvas; RiveCanvas().then(done, (e) => window.__esLib_rive[1](e));'),
};
// import phải ở cấp ngoài cùng của module; import hỏng → module không chạy → ready() báo E_EL_TIMEOUT
const esm = (k, imp, body) => '<script>ES._libs.' + k + '=new Promise((ok,no)=>{window.__esLib_' + k + '=[ok,no]});ES.wait.push(ES._libs.' + k + ')</script>'
  + '<script type="module">' + imp + ' const done = (x) => window.__esLib_' + k + '[0](x); try { ' + body + ' } catch (e) { window.__esLib_' + k + '[1](e) }</script>';
const ORDER = ['anime4', 'motion', 'dotlottie', 'rive'];
// wasm → file .js nhỏ trong work/ (window.__esWasm[k] = base64), nạp bằng <script> thường: fetch(file://) bị Chromium chặn
function wasmJs(o, k, rel) {
  const f = path.join(NM, rel); if (!fs.existsSync(f)) throw new Error('E_LIB_MISSING ' + k + ': ' + rel + ' không có trong node_modules (npm ci)');
  const out = path.join(o.work, 'wasm-' + k + '.js');
  if (!fs.existsSync(out)) fs.writeFileSync(out, '(window.__esWasm||(window.__esWasm={})).' + k + '="' + fs.readFileSync(f).toString('base64') + '"');
  return pathToFileURL(out).href;
}
// o = { work } (thư mục tạm của job: file wasm-*.js)
export function tags(keys, o = {}) {
  const ks = ORDER.filter((k) => keys.includes(k)); if (!ks.length) return '';
  return PRE + ks.map((k) => { const f = fileOf(k); if (!fs.existsSync(f)) throw new Error('E_LIB_MISSING ' + k + ': ' + EXTRA[k].file + ' không có trong node_modules (npm ci)'); return TAG[k](pathToFileURL(f).href, o); }).join('');
}
// cuối PAGE_JS khi cảnh có khoá mới: cổng chờ ES.wait (hạn = timeout lớn nhất của phần tử, mặc định 20 s) + seek chờ ES.busy
export const WAIT_JS = `
(() => { const r0 = window.ready, s0 = window.seek;
  window.ready = async () => { const E = window.ES; const ms = E.waitMs > 0 ? E.waitMs : 20000; let id;
    if (E.wait.length) await Promise.race([Promise.all(E.wait), new Promise((_, j) => { id = setTimeout(() => j(new Error('E_EL_TIMEOUT: phần tử / thư viện chưa sẵn sàng sau ' + Math.round(ms / 1000) + ' s')), ms); })]).finally(() => clearTimeout(id));
    return r0(); };
  window.seek = async (t) => { const r = await s0(t); const E = window.ES; if (E.busy.length) await Promise.all(E.busy.splice(0)); return r; };
})();
`;
// cảnh báo khi html dùng thứ chạy theo đồng hồ trình duyệt (WAAPI) thay vì đồng hồ ảo
export function lint(html) {
  const s = String(html || ''); const w = [];
  if (/anime4\.waapi|\bwaapi\.animate\b/.test(s)) w.push('W_WAAPI: anime4.waapi chạy theo đồng hồ trình duyệt, không theo đồng hồ ảo → dùng anime4.animate/createTimeline({ autoplay: false }) + seek');
  if (/new\s+(Shared)?Worker\s*\(|transferControlToOffscreen/.test(s)) w.push('W_WORKER: worker / OffscreenCanvas chạy ngoài đồng hồ ảo');
  return w;
}
