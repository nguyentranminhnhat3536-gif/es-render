// els.mjs — phần tử mới "dotlottie" (.lottie / Lottie JSON qua ThorVG wasm: theme, slot, segment) và "rive" (.riv, state machine + inputs theo mốc).
// Trước TTS, mỗi phần tử được đổi thành một phần tử "html" thường (canvas + script) có "libs" → vị trí, start/duration, fade, keyframes,
// animation, z-index… của render.mjs dùng y nguyên. Job không có hai kiểu này: expand() không đụng tới gì (trả null).
//   { "type": "dotlottie", "src": "<id>/logo.lottie", "animation-id", "theme", "slots": { "bg_color": "#E50914", "size": 40 },
//     "speed": 1, "loop": true, "segment": [0, 90], "fit": "contain", "align": [0.5, 0.5], "background": "#00000000", … }
//   { "type": "rive", "src": "<id>/mascot.riv", "artboard", "state-machine", "animation", "speed": 1, "fit": "contain", "alignment": "center",
//     "inputs": [ { "time": 1.2, "name": "wave", "value": true }, { "time": 3, "name": "jump", "value": "fire" } ], … }
//   chung: start, duration, x, y, width, height, z-index, fade-in, fade-out, keyframes, animation, "on-error": "fail"|"hide", "timeout" (s, mặc định 20)
// Tua: chỉ theo ES.onSeek(t) với giây của phần tử (t − start). dotLottie: setFrame vẽ đồng bộ. Rive: bước cố định 60 Hz (không theo FPS của job),
// tua lùi → dựng lại từ 0 rồi chạy tới; inputs áp ở đúng bước. File (src) đọc bằng Node → work/asset-<sha8>.js; trang không bao giờ lên mạng.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const TYPES = ['dotlottie', 'rive'];
// tên tính năng cho `node render.mjs --features` (cùng "anim" của anim.mjs) — es-editor dò engine trước khi dùng
export const FEATURES = [...TYPES, 'lib:anime4', 'lib:motion', 'anim-contract'];
export const MAX_ASSET = 8 * 1024 * 1024; export const MAX_JOB = 24 * 1024 * 1024;
const COMMON = ['type', 'src', 'start', 'duration', 'x', 'y', 'width', 'height', 'z-index', 'fade-in', 'fade-out', 'keyframes', 'animation', 'rotate', 'zoom', 'on-error', 'timeout', 'comment', 'id', 'speed', 'fit'];
const FIELDS = { dotlottie: [...COMMON, 'animation-id', 'theme', 'slots', 'loop', 'segment', 'align', 'background'], rive: [...COMMON, 'artboard', 'state-machine', 'inputs', 'alignment'] };
const EXT = { dotlottie: /\.(lottie|json)$/i, rive: /\.riv$/i };
const FITS = { dotlottie: ['contain', 'cover', 'fill', 'none', 'fit-width', 'fit-height'], rive: ['contain', 'cover', 'fill', 'fitWidth', 'fitHeight', 'none', 'scaleDown'] };
const ALIGNS = ['center', 'topLeft', 'topCenter', 'topRight', 'centerLeft', 'centerRight', 'bottomLeft', 'bottomCenter', 'bottomRight'];
const num = (v, d) => { const n = Number(v); return v !== undefined && v !== null && v !== '' && Number.isFinite(n) ? n : d; };
const isNum = (v) => typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v));
const short = (s, n = 80) => { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; };
export const isEl = (e) => !!e && TYPES.includes(e.type);

// kiểm tra một phần tử (thuần) → { errors: [{code,msg}], warnings }
export function validate(e) {
  const errors = []; const warnings = []; const E = (c, m) => errors.push({ code: c, msg: m });
  const t = e.type;
  if (typeof e.src !== 'string' || !e.src.trim()) E('E_EL_SRC_MISSING', t + ': cần "src" (file ' + (t === 'rive' ? '.riv' : '.lottie hoặc .json') + ')');
  else if (!/^https?:/i.test(e.src) && /^[a-z][a-z0-9+.-]+:/i.test(e.src.trim()) && !/^file:/i.test(e.src)) E('E_EL_SRC_REMOTE', 'src chỉ nhận file cục bộ hoặc http(s)://');
  else if (!EXT[t].test(e.src.split('?')[0])) E('E_EL_SRC_TYPE', t + ': src phải là ' + (t === 'rive' ? '.riv' : '.lottie / .json') + ' (got "' + short(e.src) + '")');
  for (const k of ['start', 'x', 'y']) if (e[k] !== undefined && !isNum(e[k])) E('E_EL_FIELD', k + ' phải là số');
  for (const k of ['duration', 'width', 'height']) if (e[k] !== undefined && !(isNum(e[k]) && Number(e[k]) > 0)) E('E_EL_FIELD', k + ' phải là số > 0');
  if (e.speed !== undefined && !(isNum(e.speed) && Number(e.speed) > 0 && Number(e.speed) <= 16)) E('E_EL_FIELD', 'speed phải > 0 và ≤ 16');
  if (e.timeout !== undefined && !(isNum(e.timeout) && Number(e.timeout) >= 1 && Number(e.timeout) <= 120)) E('E_EL_FIELD', 'timeout phải từ 1 đến 120 s');
  if (e['on-error'] !== undefined && !['fail', 'hide'].includes(e['on-error'])) E('E_EL_FIELD', 'on-error phải là fail | hide');
  if (e.fit !== undefined && !FITS[t].includes(e.fit)) E('E_EL_FIELD', 'fit phải là một trong ' + FITS[t].join(' | '));
  if (t === 'dotlottie') {
    if (e.loop !== undefined && typeof e.loop !== 'boolean') E('E_EL_FIELD', 'loop phải là true / false');
    if (e.segment !== undefined && !(Array.isArray(e.segment) && e.segment.length === 2 && e.segment.every(isNum) && Number(e.segment[1]) > Number(e.segment[0]) && Number(e.segment[0]) >= 0)) E('E_EL_FIELD', 'segment phải là [khung đầu, khung cuối] với cuối > đầu ≥ 0');
    if (e.align !== undefined && !(Array.isArray(e.align) && e.align.length === 2 && e.align.every((v) => isNum(v) && v >= 0 && v <= 1))) E('E_EL_FIELD', 'align phải là [x, y] trong 0–1');
    if (e.slots !== undefined && (typeof e.slots !== 'object' || Array.isArray(e.slots) || e.slots === null)) E('E_EL_FIELD', 'slots phải là object { slotId: giá trị }');
  } else {
    if (e.alignment !== undefined && !ALIGNS.includes(e.alignment)) E('E_EL_FIELD', 'alignment phải là một trong ' + ALIGNS.join(' | '));
    if (e.inputs !== undefined) {
      if (!Array.isArray(e.inputs)) E('E_EL_FIELD', 'inputs phải là danh sách { time, name, value }');
      else e.inputs.forEach((x, i) => { if (!x || !isNum(x.time) || Number(x.time) < 0 || typeof x.name !== 'string' || !['boolean', 'number', 'string'].includes(typeof x.value) || (typeof x.value === 'string' && x.value !== 'fire'))
        E('E_EL_FIELD', 'inputs[' + i + '] phải là { time ≥ 0, name, value: true|false|số|"fire" }'); });
    }
    if (e.animation && typeof e.animation === 'string' && e['state-machine']) warnings.push({ code: 'W_RIVE_BOTH', msg: 'có cả "animation" và "state-machine": dùng animation (timeline), bỏ state machine' });
  }
  for (const k of Object.keys(e)) if (!k.startsWith('_') && !FIELDS[t].includes(k) && k !== 'libs') warnings.push({ code: 'W_FIELD', msg: 'trường "' + k + '" không dùng, bỏ qua' });
  return { errors, warnings };
}
// "animation" của rive là tên timeline (chuỗi) — kiểu vào/ra của render.mjs ("pop", { in, out }) thì dùng "enter" không được: giữ tên rõ ràng
const riveAnim = (e) => (typeof e.animation === 'string' && e.type === 'rive' ? e.animation : '');
function resolveFile(src, o) {
  const s = String(src).trim();
  let cands;
  if (/^file:/i.test(s)) { try { cands = [fileURLToPath(s)]; } catch (x) { return null; } }
  else if (path.isAbsolute(s)) cands = [s];
  else cands = [...new Set([o.jobDir, o.cwd].filter(Boolean).map((d) => path.resolve(d, s)))];
  return cands.find((f) => fs.existsSync(f) && fs.statSync(f).isFile()) || null;
}
const hexColor = (v) => { const m = typeof v === 'string' && v.trim().match(/^#?([0-9a-f]{6})([0-9a-f]{2})?$/i); if (!m) return null; const h = m[1]; const c = [0, 2, 4].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) / 255 * 1e4) / 1e4); return [...c, m[2] ? Math.round(parseInt(m[2], 16) / 255 * 1e4) / 1e4 : 1]; };

// mã chạy trong trang (chuỗi; C = cấu hình của phần tử). Mỗi phần tử đẩy một promise vào ES.wait ngay khi script chạy.
const BOOT = 'const E=window.ES;E.waitMs=Math.max(E.waitMs||0,C.timeout*1000);const u8=(s)=>Uint8Array.from(atob(s),(c)=>c.charCodeAt(0));'
  + 'const bytes=()=>{const a=window.__esAsset&&window.__esAsset[C.sha];if(!a)throw new Error("asset "+C.sha+" chưa nạp");return u8(a)};'
  + 'const fail=(code,m)=>{const msg=code+": "+C.label+": "+m;if(C.policy==="hide"){const s=(window.SPEC||[]).find((x)=>x.id===C.id);if(s)s.end=-1e9;(window.__esElWarn||(window.__esElWarn=[])).push(C.id+" "+msg+" → ẩn phần tử");return}throw new Error(msg)};'
  + 'const within=(p,what)=>Promise.race([p,new Promise((_,j)=>setTimeout(()=>j(new Error(what+" chưa xong sau "+Math.max(0.5,C.timeout-1)+" s (file hỏng hoặc không hỗ trợ)")),Math.max(500,C.timeout*1000-1000)))]);'
  + 'const vis=(t)=>{const s=(window.SPEC||[]).find((x)=>x.id===C.id);return !(s&&s.end<-1e8)&&t>=C.st-1e-6&&t<C.end};';
const DOTLOTTIE_JS = `E.wait.push((async()=>{let d;if(C.bad)return fail("E_DOTLOTTIE_LOAD",C.bad);
  try{const DotLottie=await E.lib("dotlottie");const raw=bytes();
    d=new DotLottie({canvas:document.getElementById(C.id+"c"),data:C.json?new TextDecoder().decode(raw):raw.buffer,autoplay:false,loop:false,useFrameInterpolation:true,
      animationId:C.anim||undefined,backgroundColor:C.bg||undefined,layout:{fit:C.fit,align:C.align},renderConfig:{devicePixelRatio:1,freezeOnOffscreen:false,autoResize:false}});
    await within(new Promise((ok,no)=>{d.addEventListener("load",ok);d.addEventListener("loadError",(ev)=>no(new Error(String((ev&&ev.error&&ev.error.message)||(ev&&ev.error)||"loadError"))))}),"nạp .lottie");
  }catch(x){return fail("E_DOTLOTTIE_LOAD",x.message||x)}
  if(C.theme&&!d.setTheme(C.theme))return fail("E_DOTLOTTIE_THEME","không có theme \\""+C.theme+"\\" (có: "+((d.manifest&&d.manifest.themes)||[]).map((t)=>t.id).join(", ")+")");
  const ids=d.getSlotIds?d.getSlotIds():[];
  for(const [k,v] of Object.entries(C.slots||{})){if(!ids.includes(k))return fail("E_DOTLOTTIE_SLOT","không có slot \\""+k+"\\" (có: "+ids.join(", ")+")");
    const ok=Array.isArray(v)&&v.length>=3&&typeof v[0]==="number"&&d.getSlotType(k)==="color"?d.setColorSlot(k,v):typeof v==="number"?d.setScalarSlot(k,v):(d.setSlots({[k]:v}),true);
    if(ok===false)return fail("E_DOTLOTTIE_SLOT","slot \\""+k+"\\" không nhận giá trị "+JSON.stringify(v))}
  const N=d.totalFrames,fps=N/d.duration,a=C.seg?Math.min(C.seg[0],N-1):0,b=C.seg?Math.min(C.seg[1],N-1):N-1,span=b-a;
  // khung theo giây phần tử: loop = modulo (khung b ≡ khung a), không loop = dừng ở khung b
  const at=(t)=>{const x=Math.max(0,t-C.st)*C.speed*fps;const f=C.loop&&span>0?a+(((x%span)+span)%span):Math.min(a+x,b);return Math.round(f*1000)/1000};
  let last=-1;const draw=(t)=>{const f=at(t);if(f!==last){d.setFrame(f);last=f}};draw(C.st);
  E.onSeek.push((t)=>{if(vis(t))draw(t)});
})());`;
const RIVE_JS = `E.wait.push((async()=>{const HZ=60,DT=1/HZ;let rive,file;const bad=[],audio=[];if(C.bad)return fail("E_RIVE_LOAD",C.bad);
  try{rive=await E.lib("rive");
    const loader=new rive.CustomFileAssetLoader({loadContents:(a,b)=>{const has=!!(b&&b.length);
      if(a.isImage)bad.push("ảnh "+a.name+(has?" (nhúng: giải mã bất đồng bộ, chưa hỗ trợ)":" (ở ngoài file)"));else if(a.isFont&&!has)bad.push("font "+a.name+" (ở ngoài file)");else if(a.isAudio)audio.push(a.name);return false}});
    file=await within(rive.load(bytes(),loader,false),"nạp .riv");
  }catch(x){return fail("E_RIVE_LOAD",x.message||x)}
  if(!file)return fail("E_RIVE_LOAD","file .riv hỏng hoặc sai phiên bản");
  if(bad.length)return fail("E_RIVE_UNSUPPORTED",bad.join(", ")+" — xuất .riv chỉ có vector / font nhúng");
  if(audio.length)console.warn("rive "+C.label+": bỏ qua âm thanh "+audio.join(", ")+" (âm thanh thêm bằng phần tử audio)");
  const cv=document.getElementById(C.id+"c");let R=rive.makeRenderer(cv);let lost=0;cv.addEventListener("contextlost",()=>{lost=1});cv.addEventListener("contextrestored",()=>{lost=2});
  const fit=rive.Fit[C.fit],al=rive.Alignment[C.alignment];let ab,sm,la,inp;
  const mk=()=>{if(sm)sm.delete();if(la)la.delete();if(ab)ab.delete();sm=la=null;
    ab=C.artboard?file.artboardByName(C.artboard):file.defaultArtboard();if(!ab)throw new Error("không có artboard \\""+C.artboard+"\\"");
    if(C.anim){const A=ab.animationByName(C.anim);if(!A)throw new Error("không có animation \\""+C.anim+"\\"");la=new rive.LinearAnimationInstance(A,ab)}
    else{const S=C.sm?ab.stateMachineByName(C.sm):ab.stateMachineCount()?ab.stateMachineByIndex(0):null;if(C.sm&&!S)throw new Error("không có state machine \\""+C.sm+"\\"");
      if(S)sm=new rive.StateMachineInstance(S,ab);else if(ab.animationCount())la=new rive.LinearAnimationInstance(ab.animationByIndex(0),ab)}
    inp={};if(sm)for(let i=0;i<sm.inputCount();i++){const q=sm.input(i);inp[q.name]=q}adv(0)};
  const adv=(dt)=>{if(la){la.advance(dt);la.apply(1)}if(sm)sm.advance(dt);ab.advance(dt)};
  // input áp ở bước n khi time·speed rơi vào [n·DT, (n+1)·DT)
  const steps=(C.inputs||[]).map((x)=>({n:Math.floor(x.time*C.speed*HZ+1e-6),x}));
  const apply=(n)=>{for(const s of steps)if(s.n===n){const q=inp[s.x.name];if(!q)throw new Error("state machine không có input \\""+s.x.name+"\\" (có: "+Object.keys(inp).join(", ")+")");
    if(s.x.value==="fire")q.asTrigger().fire();else if(typeof s.x.value==="boolean")q.asBool().value=s.x.value;else q.asNumber().value=s.x.value}};
  const draw=()=>{R.clear();R.save();R.align(fit,al,{minX:0,minY:0,maxX:cv.width,maxY:cv.height},ab.bounds);ab.draw(R);R.restore();if(R.flush)R.flush();rive.resolveAnimationFrame()};
  let n=0;
  try{mk();if(steps.length&&!sm)throw new Error("inputs cần state machine");for(const x of steps)if(!inp[x.x.name])throw new Error("state machine không có input \\""+x.x.name+"\\" (có: "+(Object.keys(inp).join(", ")||"không có")+")");draw()}catch(x){return fail("E_RIVE_LOAD",x.message||x)}
  // vẽ hỏng không được lọt qua im lặng (VCLOCK nuốt lỗi của ES.onSeek): lỗi → promise bị từ chối trong ES.busy → seek() ném E_RIVE_DRAW
  // (render.mjs thử lại khung đó; lần sau dựng lại từ 0 — cùng chuỗi bước 1/60 s nên cùng hình). Canvas mất ngữ cảnh → chờ khôi phục rồi vẽ lại.
  // Kiểm tra trống: thu canvas về 32×32 (canvas phụ, không đụng canvas thật) — khung trước có hình mà khung này trống hẳn → tính lại từ 0;
  // vẫn trống → thử tô canvas: tô được thì trống là thật (hoạt ảnh tự trống), không tô được → E_RIVE_DRAW.
  const P=32,pc=document.createElement("canvas");pc.width=pc.height=P;const px=pc.getContext("2d",{willReadFrequently:true});
  const cover=()=>{px.clearRect(0,0,P,P);px.drawImage(cv,0,0,P,P);const d=px.getImageData(0,0,P,P).data;let a=0;for(let i=3;i<d.length;i+=4)a+=d[i];return a/(255*P*P)};
  const go=(want,fresh)=>{if(fresh||want<n){mk();n=0}while(n<want){apply(n);adv(DT);n++}draw()};
  const revive=()=>{if(lost!==2)return;try{R.delete&&R.delete()}catch(x){}R=rive.makeRenderer(cv);lost=0;dirty=1};
  let dirty=0,prev=0;const oops=(t,m)=>{dirty=1;prev=0;if(!lost)lost=2;const p=Promise.reject(new Error("E_RIVE_DRAW: "+C.label+": "+m+" (t="+t.toFixed(3)+" s)"));p.catch(()=>{});E.busy.push(p)};
  const frame=(t,want)=>{go(want,dirty);dirty=0;let c=cover();
    if(c===0&&prev>0.002){go(want,1);c=cover();if(c===0){const g=cv.getContext("2d");g.save();g.fillStyle="#fff";g.fillRect(0,0,cv.width,cv.height);g.restore();const ok=cover()>0.9;draw();if(!ok)throw new Error("canvas không vẽ được (khung trống)")}}
    prev=c};
  E.onSeek.push((t)=>{if(!vis(t))return;const want=Math.floor(Math.max(0,t-C.st)*C.speed*HZ+1e-6);
    if(lost===1){dirty=1;E.busy.push(new Promise((ok,no)=>{const id=setTimeout(()=>no(new Error("E_RIVE_DRAW: "+C.label+": canvas mất ngữ cảnh, không khôi phục sau 5 s")),5000);
      cv.addEventListener("contextrestored",()=>{clearTimeout(id);try{revive();frame(t,want);ok()}catch(x){no(new Error("E_RIVE_DRAW: "+C.label+": "+(x.message||x)))}},{once:true})}));return}
    try{revive();frame(t,want)}catch(x){oops(t,x.message||x)}});
})());`;

// ctx = { jobPath, work, W, H, log, download(url, dest) } → null (job không có phần tử mới) | { elements, assets, bytes }
export async function expand(scenes, ctx = {}) {
  const list = [];
  for (const s of scenes) s.elements.forEach((e, k) => { if (isEl(e)) list.push({ s, e, k }); });
  if (!list.length) return null;
  const { work, W = 1080, H = 1920, log = () => {} } = ctx;
  const jobDir = path.dirname(path.resolve(ctx.jobPath || '.')); const cwd = process.cwd();
  const errors = []; const assets = new Map(); let total = 0; let dl = 0;
  for (const { s, e, k } of list) {
    const where = 'scene ' + (s.i + 1) + ' element e' + k + ' (' + e.type + ')';
    const v = validate(e);
    for (const x of v.errors) errors.push(where + ': ' + x.code + ': ' + x.msg);
    for (const x of v.warnings) log(where + ':', x.code + ':', x.msg);
    if (v.errors.length) continue;
    let file;
    if (/^https?:/i.test(e.src)) {
      if (!ctx.download) { errors.push(where + ': E_EL_SRC_REMOTE: không tải được ' + short(e.src)); continue; }
      file = path.join(work, 'el-dl' + dl++ + path.extname(e.src.split('?')[0]));
      try { await ctx.download(e.src, file, 4, MAX_ASSET); } catch (x) { errors.push(where + ': ' + (/^E_ASSET_TOO_BIG/.test(x.message) ? '' : 'E_EL_SRC_NOT_FOUND: ') + x.message); continue; }
    } else file = resolveFile(e.src, { jobDir, cwd });
    if (!file) { errors.push(where + ': E_EL_SRC_NOT_FOUND: "' + short(e.src) + '" không thấy (tìm theo thư mục file job, rồi thư mục đang chạy)'); continue; }
    const size = fs.statSync(file).size; // kiểm tra cỡ trước khi đọc
    if (size > MAX_ASSET) { errors.push(where + ': E_ASSET_TOO_BIG: ' + short(e.src) + ' ' + (size / 1048576).toFixed(1) + ' MB > 8 MB'); continue; }
    const buf = fs.readFileSync(file);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (!assets.has(sha)) {
      total += buf.length; if (total > MAX_JOB) { errors.push(where + ': E_ASSET_TOO_BIG: tổng file của phần tử mới trong job > 24 MB'); continue; }
      const af = path.join(work, 'asset-' + sha.slice(0, 8) + '.js');
      fs.writeFileSync(af, '(window.__esAsset||(window.__esAsset={}))["' + sha.slice(0, 8) + '"]="' + buf.toString('base64') + '"');
      assets.set(sha, af); if (/^https?:/i.test(e.src)) log('el', e.type, short(e.src), 'sha256', sha);
    }
    // kiểm tra nhanh trong Node (file hỏng không phải chờ hết hạn trong trang): .lottie = zip, .json = JSON, .riv bắt đầu bằng "RIVE"
    const isJson = /\.json$/i.test(file); let badMsg = '';
    if (e.type === 'rive' ? buf.subarray(0, 4).toString('latin1') !== 'RIVE' : isJson ? (() => { try { JSON.parse(buf.toString('utf8')); return false; } catch (x) { return true; } })() : buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50)
      badMsg = 'không phải file ' + (e.type === 'rive' ? '.riv' : isJson ? 'Lottie JSON' : '.lottie (zip)') + ' hợp lệ';
    if (badMsg && (e['on-error'] || 'fail') !== 'hide') { errors.push(where + ': ' + (e.type === 'rive' ? 'E_RIVE_LOAD' : 'E_DOTLOTTIE_LOAD') + ': ' + short(String(e.src).split(/[\\/]/).pop(), 60) + ': ' + badMsg); continue; }
    const w = Math.round(num(e.width, W)); const h = Math.round(num(e.height, H)); const st = num(e.start, 0); const du = num(e.duration, 0);
    const eid = 'e' + k;
    const C = { id: eid, label: short(String(e.src).split(/[\\/]/).pop(), 60), sha: sha.slice(0, 8), st, end: du > 0 ? st + du : 1e9, speed: num(e.speed, 1),
      timeout: num(e.timeout, 20), policy: e['on-error'] || 'fail', ...(badMsg ? { bad: badMsg } : {}) };
    let js;
    if (e.type === 'dotlottie') {
      const slots = {}; for (const [sk, sv] of Object.entries(e.slots || {})) slots[sk] = hexColor(sv) || sv;
      Object.assign(C, { json: isJson, anim: e['animation-id'] || '', theme: e.theme || '', slots, loop: e.loop !== false, seg: e.segment ? e.segment.map(Number) : null,
        fit: e.fit || 'contain', align: e.align ? e.align.map(Number) : [0.5, 0.5], bg: typeof e.background === 'string' ? e.background : '' });
      js = DOTLOTTIE_JS;
    } else {
      Object.assign(C, { artboard: e.artboard || '', sm: e['state-machine'] || '', anim: riveAnim(e), fit: e.fit || 'contain', alignment: e.alignment || 'center',
        inputs: (e.inputs || []).map((x) => ({ time: Number(x.time), name: x.name, value: x.value })) });
      js = RIVE_JS;
    }
    const html = '<canvas id="' + eid + 'c" width="' + w + '" height="' + h + '" style="display:block;width:100%;height:100%"></canvas>'
      + '<script src="' + pathToFileURL(assets.get(sha)).href + '"></script>'
      + '<script>(()=>{const C=' + JSON.stringify(C).replace(/</g, '\\u003c') + ';(window.__esEl||(window.__esEl={}))[C.id]=1;' + BOOT + js + '})()</script>'
      // script của phần tử không chạy được (lỗi cú pháp…) → ready() báo lỗi thay vì dựng canvas trống
      + '<script>if(!(window.__esEl&&window.__esEl["' + eid + '"]))ES.wait.push(Promise.reject(new Error("E_EL_SCRIPT: ' + e.type + ' ' + eid + ': script của phần tử không chạy")))</script>';
    const out = { type: 'html', html, libs: [...new Set([...(Array.isArray(e.libs) ? e.libs : []), e.type])], x: num(e.x, 0), y: num(e.y, 0), width: w, height: h };
    for (const f of ['start', 'duration', 'z-index', 'fade-in', 'fade-out', 'keyframes', 'rotate', 'zoom', 'comment']) if (e[f] !== undefined) out[f] = e[f];
    if (e.animation !== undefined && e.type !== 'rive') out.animation = e.animation;
    if (e.type === 'rive' && e.animation && typeof e.animation === 'object') out.animation = e.animation; // { in, out } của render.mjs
    out._el = { type: e.type, src: e.src, sha };
    s.elements[k] = out;
  }
  if (errors.length) throw new Error(errors.join('\n'));
  log('el', list.length, 'element(s):', [...new Set(list.map((x) => x.e.type))].join(', '), '|', assets.size, 'asset(s),', (total / 1024).toFixed(0) + ' KB');
  return { elements: list.length, assets: assets.size, bytes: total };
}
