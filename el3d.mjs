// el3d.mjs — phần tử "3d" (bundle vendor/es3d.min.js: React + @react-three/fiber + drei + @react-three/rapier + @react-three/postprocessing, three 0.186 bên trong).
// els.mjs đổi phần tử thành "html" (canvas + script, libs: ["es3d"]) như dotlottie / rive. Ở đây: kiểm tra trường, chuẩn hoá cấu hình (mặc định theo preset),
// kiểm tra file trong Node (.glb tự chứa, không nén Draco / meshopt / KTX2; ảnh png / jpg / webp) và mã chạy trong trang.
//   { "type": "3d", "preset": "product-hero" | "logo-spin", "model": "<id>/product.glb", "image": "<id>/label.png",
//     "colors": { "bg": "#0b0b10" | "transparent", "primary": "#f4f4f6", "accent": "#ff3b30", "accent2": "#ffd60a" },
//     "camera": { "fov": 35, "from": [0, 1.55, 6.4], "to": [0, 0.95, 0], "orbit": 0.22, "dolly": 0.1 },
//     "fx": { "bloom": 0.9, "threshold": 1.2, "vignette": 0.35, "dof": { "focus": 6, "range": 3, "bokeh": 2 } },
//     "physics": { "gravity": -9.81, "restitution": 0.35 } | false, "seed": 7, "product": [1, 1.4, 0.7], "spin": 0.9, "bits": 14, … }
// Đồng hồ: ES.onSeek(t) → ES3D seek(giây phần tử × speed): vật lý bước cố định 60 Hz (không theo FPS của job), tư thế = hàm thuần của t,
// advance(t) vẽ đồng bộ. Tua lùi khi có vật lý → dựng lại cây vật lý và chạy lại từ bước 0 (promise vào ES.busy, seek() chờ trước khi chụp).
export const TYPE = '3d';
export const PRESETS = ['product-hero', 'logo-spin'];
// hạn ready() mặc định (s): 3 trang 3D khởi động song song (RENDER_CONCURRENCY=3: parse bundle 3,2 MB + WASM Rapier + shader SwiftShader)
// chậm ~10× một trang (đo 17–24 s mỗi trang trên máy bận) → 20 s như dotlottie / rive là quá sát
export const TIMEOUT = 60;
// ước lượng giây CPU mỗi khung (SwiftShader, bloom + bóng): ~1,5–3 s ở 1080×1920, ~0,3 s ở 270×480
export const frameCost = (w, h) => 0.25 + 2.5 * (w * h) / (1080 * 1920);
const COMMON = ['type', 'start', 'duration', 'x', 'y', 'width', 'height', 'z-index', 'fade-in', 'fade-out', 'keyframes', 'animation', 'rotate', 'zoom', 'on-error', 'timeout', 'comment', 'id', 'speed'];
export const FIELDS = [...COMMON, 'preset', 'model', 'image', 'colors', 'camera', 'fx', 'physics', 'seed', 'product', 'spin', 'turns', 'bits', 'drop', 'spread', 'shadow', 'aa', 'env', 'fog'];
const DEF = {
  'product-hero': { camera: { fov: 35, from: [0, 1.55, 6.4], to: [0, 0.95, 0], orbit: 0.22, dolly: 0.1 }, physics: true, spin: 0.9 },
  'logo-spin': { camera: { fov: 32, from: [0, 1.4, 6], to: [0, 1.4, 0], orbit: 0, dolly: 0.08 }, physics: false, spin: 0.35 },
};
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim());
const num = (v, d) => (isNum(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

// kiểm tra (thuần) → { errors: [{code,msg}], warnings }
export function validate(e) {
  const errors = []; const warnings = []; const E = (m) => errors.push({ code: 'E_3D_FIELD', msg: m });
  const preset = e.preset === undefined ? 'product-hero' : e.preset;
  if (!PRESETS.includes(preset)) errors.push({ code: 'E_3D_PRESET', msg: 'preset phải là một trong ' + PRESETS.join(' | ') + ' (got "' + String(preset).slice(0, 40) + '")' });
  for (const k of ['model', 'image']) if (e[k] !== undefined && (typeof e[k] !== 'string' || !e[k].trim())) E(k + ' phải là đường dẫn file');
  if (typeof e.model === 'string' && !/\.glb(\?|$)/i.test(e.model)) E('model phải là .glb (glTF nhị phân tự chứa)');
  if (typeof e.image === 'string' && !/\.(png|jpe?g|webp)(\?|$)/i.test(e.image)) E('image phải là .png / .jpg / .webp');
  for (const k of ['model', 'image']) if (typeof e[k] === 'string' && /^[a-z][a-z0-9+.-]+:/i.test(e[k].trim()) && !/^(https?|file):/i.test(e[k].trim())) E(k + ' chỉ nhận file cục bộ hoặc http(s)://');
  for (const k of ['start', 'x', 'y']) if (e[k] !== undefined && !Number.isFinite(Number(e[k]))) E(k + ' phải là số');
  for (const k of ['duration', 'width', 'height']) if (e[k] !== undefined && !(Number(e[k]) > 0)) E(k + ' phải là số > 0');
  if (e.speed !== undefined && !(Number(e.speed) > 0 && Number(e.speed) <= 16)) E('speed phải > 0 và ≤ 16');
  if (e.timeout !== undefined && !(Number(e.timeout) >= 1 && Number(e.timeout) <= 120)) E('timeout phải từ 1 đến 120 s');
  if (e['on-error'] !== undefined && !['fail', 'hide'].includes(e['on-error'])) E('on-error phải là fail | hide');
  if (e.colors !== undefined) {
    if (!e.colors || typeof e.colors !== 'object' || Array.isArray(e.colors)) E('colors phải là { bg, primary, accent, accent2 }');
    else for (const [k, v] of Object.entries(e.colors)) { if (!['bg', 'primary', 'accent', 'accent2'].includes(k)) warnings.push({ code: 'W_FIELD', msg: 'colors.' + k + ' không dùng' }); else if (!(isHex(v) || (k === 'bg' && v === 'transparent'))) E('colors.' + k + ' phải là "#rrggbb"' + (k === 'bg' ? ' hoặc "transparent"' : '')); }
  }
  if (e.camera !== undefined) {
    const c = e.camera; if (!c || typeof c !== 'object' || Array.isArray(c)) E('camera phải là { fov, from, to, orbit, dolly }');
    else {
      if (c.fov !== undefined && !(isNum(c.fov) && c.fov >= 10 && c.fov <= 100)) E('camera.fov phải từ 10 đến 100');
      for (const k of ['from', 'to']) if (c[k] !== undefined && !isVec(c[k])) E('camera.' + k + ' phải là [x, y, z]');
      if (c.orbit !== undefined && !(isNum(c.orbit) && Math.abs(c.orbit) <= 6.3)) E('camera.orbit (rad/s) phải trong ±6.3');
      if (c.dolly !== undefined && !(isNum(c.dolly) && c.dolly > -1 && c.dolly < 0.9)) E('camera.dolly phải trong (−1, 0.9)');
    }
  }
  if (e.fx !== undefined) {
    const f = e.fx; if (!f || typeof f !== 'object' || Array.isArray(f)) E('fx phải là { bloom, threshold, vignette, dof }');
    else {
      if (f.noise !== undefined) E('fx.noise không hỗ trợ: hạt nhiễu của postprocessing cộng dồn delta → khung phụ thuộc lịch sử tua');
      for (const k of ['bloom', 'vignette']) if (f[k] !== undefined && !(isNum(f[k]) && f[k] >= 0 && f[k] <= 5)) E('fx.' + k + ' phải từ 0 đến 5');
      if (f.threshold !== undefined && !(isNum(f.threshold) && f.threshold >= 0 && f.threshold <= 1.5)) E('fx.threshold phải từ 0 đến 1.5');
      if (f.dof !== undefined && f.dof !== null && f.dof !== false && !(typeof f.dof === 'object' && ['focus', 'range', 'bokeh'].every((k) => f.dof[k] === undefined || (isNum(f.dof[k]) && f.dof[k] >= 0)))) E('fx.dof phải là { focus, range, bokeh } (số ≥ 0)');
      for (const k of Object.keys(f)) if (!['bloom', 'threshold', 'vignette', 'dof', 'noise'].includes(k)) warnings.push({ code: 'W_FIELD', msg: 'fx.' + k + ' không hỗ trợ, bỏ qua (chỉ bloom, vignette, dof: hiệu ứng không theo thời gian)' });
    }
  }
  if (e.physics !== undefined && e.physics !== null && typeof e.physics !== 'boolean') {
    const p = e.physics; if (typeof p !== 'object' || Array.isArray(p)) E('physics phải là true | false | { gravity, restitution }');
    else {
      if (p.gravity !== undefined && !(isNum(p.gravity) && p.gravity >= -50 && p.gravity <= 0)) E('physics.gravity phải từ −50 đến 0');
      if (p.restitution !== undefined && !(isNum(p.restitution) && p.restitution >= 0 && p.restitution <= 1)) E('physics.restitution phải từ 0 đến 1');
    }
  }
  if (preset === 'logo-spin' && e.physics) warnings.push({ code: 'W_3D_PHYSICS', msg: 'logo-spin không dùng vật lý, bỏ qua "physics"' });
  if (preset === 'logo-spin' && e.model) warnings.push({ code: 'W_FIELD', msg: 'logo-spin không dùng "model" (ảnh logo: "image")' });
  if (e.seed !== undefined && !(Number.isInteger(e.seed) && e.seed >= 0 && e.seed < 2 ** 31)) E('seed phải là số nguyên ≥ 0');
  if (e.product !== undefined && !(isVec(e.product) && e.product.every((v) => v > 0.05 && v <= 3))) E('product phải là [rộng, cao, sâu] trong 0.05–3');
  for (const [k, lo, hi] of [['spin', -6.3, 6.3], ['turns', 0, 8], ['drop', 0, 8], ['spread', 0, 20], ['shadow', 0, 1], ['env', 0, 4]]) if (e[k] !== undefined && !(isNum(e[k]) && e[k] >= lo && e[k] <= hi)) E(k + ' phải từ ' + lo + ' đến ' + hi);
  if (e.bits !== undefined && !(Number.isInteger(e.bits) && e.bits >= 0 && e.bits <= 60)) E('bits phải là số nguyên 0–60');
  if (e.aa !== undefined && ![0, 2, 4, 8].includes(e.aa)) E('aa (multisampling) phải là 0 | 2 | 4 | 8');
  if (e.fog !== undefined && !(Array.isArray(e.fog) && e.fog.length === 2 && e.fog.every(isNum) && e.fog[1] > e.fog[0] && e.fog[0] >= 0)) E('fog phải là [gần, xa] với xa > gần ≥ 0');
  for (const k of Object.keys(e)) if (!k.startsWith('_') && !FIELDS.includes(k) && k !== 'libs') warnings.push({ code: 'W_FIELD', msg: 'trường "' + k + '" không dùng, bỏ qua' + (k === 'text' || k === 'font' ? ' (chữ: dùng phần tử text / html phủ lên)' : '') });
  return { errors, warnings };
}

// .glb: header "glTF" v2 + chunk JSON; từ chối nén (worker / CDN decoder) và file ngoài → { msg } hoặc null
const PACKED = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression', 'KHR_texture_basisu'];
export function checkGlb(buf) {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'glTF') return 'không phải file .glb (thiếu "glTF")';
  if (buf.readUInt32LE(4) !== 2) return '.glb phải là glTF 2.0';
  const len = buf.readUInt32LE(12); if (buf.readUInt32LE(16) !== 0x4E4F534A || 20 + len > buf.length) return '.glb hỏng (chunk JSON)';
  let j; try { j = JSON.parse(buf.toString('utf8', 20, 20 + len)); } catch (x) { return '.glb hỏng (JSON)'; }
  const ext = [...new Set([...(j.extensionsUsed || []), ...(j.extensionsRequired || [])])].filter((x) => PACKED.includes(x));
  if (ext.length) return 'E_3D_UNSUPPORTED: .glb nén bằng ' + ext.join(', ') + ' (cần worker / decoder tải từ CDN) — hãy xuất .glb không nén';
  const ext2 = [...(j.buffers || []), ...(j.images || [])].filter((b) => b && typeof b.uri === 'string' && !/^data:/i.test(b.uri));
  if (ext2.length) return 'E_3D_UNSUPPORTED: .glb trỏ ra file ngoài (' + ext2.map((b) => b.uri).slice(0, 3).join(', ') + ') — hãy xuất .glb tự chứa';
  if (!(j.meshes || []).length) return '.glb không có mesh nào';
  return null;
}
export function imageType(buf) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504E47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// cấu hình cho ES3D.mount (đã gộp mặc định của preset). w, h = cỡ canvas; D = giây phần tử (cho dolly); assets = { model, image, imageType }
export function spec(e, { w, h, D, assets }) {
  const preset = e.preset || 'product-hero'; const d = DEF[preset]; const c = e.camera || {}; const f = e.fx || {}; const col = e.colors || {};
  const physOn = preset === 'logo-spin' ? false : e.physics === undefined || e.physics === null ? d.physics : e.physics !== false;
  const p = typeof e.physics === 'object' && e.physics ? e.physics : {};
  return {
    preset, W: w, H: h, D: Math.max(0.5, D),
    colors: { bg: col.bg || '#0b0b10', primary: col.primary || '#f2f2f5', accent: col.accent || '#ff3b30', accent2: col.accent2 || '' },
    camera: { fov: num(c.fov, d.camera.fov), from: c.from || d.camera.from, to: c.to || d.camera.to, orbit: num(c.orbit, d.camera.orbit), dolly: num(c.dolly, d.camera.dolly) },
    fx: { bloom: num(f.bloom, 0.9), threshold: num(f.threshold, 1.2), vignette: num(f.vignette, 0.35),
      dof: f.dof && typeof f.dof === 'object' ? { focus: num(f.dof.focus, 6), range: num(f.dof.range, 3), bokeh: num(f.dof.bokeh, 2) } : null },
    physics: physOn ? { gravity: num(p.gravity, -9.81), restitution: num(p.restitution, 0.35) } : null,
    seed: Number.isInteger(e.seed) ? e.seed : 7, product: e.product || [1, 1.4, 0.7], spin: num(e.spin, d.spin), turns: num(e.turns, 1),
    bits: Number.isInteger(e.bits) ? e.bits : 14, drop: num(e.drop, 2.6), spread: num(e.spread, 3), shadow: num(e.shadow, 0.55), shadowScale: 9,
    aa: e.aa === undefined ? 4 : e.aa, envIntensity: num(e.env, 1), fog: e.fog || [6, 16], assets,
  };
}

// mã trong trang (sau BOOT của els.mjs: E, C, u8, fail, vis). C.spec = spec(); ảnh / glb ở window.__esAsset[sha8]
export const JS = `E.wait.push((async()=>{let h;if(C.bad)return fail("E_3D_LOAD",C.bad);
  const code=(x,d)=>{const m=String((x&&x.message)||x);const c=(m.match(/^(E_3D_[A-Z_]+):\\s*/)||[])[1];return fail(c||d,c?m.slice(c.length+2):m)};
  try{if(!window.ES3D)throw new Error("vendor/es3d.min.js chưa nạp");
    h=ES3D.mount(document.getElementById(C.id+"c"),C.spec,{bytes:(s)=>{const a=window.__esAsset&&window.__esAsset[s];if(!a)throw new Error("asset "+s+" chưa nạp");return u8(a)}});
    const ms=Math.max(500,C.timeout*1000-1000);let id;
    await Promise.race([h.ready,new Promise((_,j)=>{id=setTimeout(()=>j(new Error("E_3D_TIMEOUT: cảnh 3D chưa sẵn sàng sau "+(ms/1000)+" s (WASM vật lý, ảnh, model hay shader)")),ms)})]).finally(()=>clearTimeout(id));
  }catch(x){return code(x,"E_3D_LOAD")}
  // lỗi khi vẽ không được lọt qua im lặng (VCLOCK nuốt lỗi của ES.onSeek): promise bị từ chối trong ES.busy → seek() ném E_3D_DRAW
  const oops=(x)=>{const p=Promise.reject(new Error("E_3D_DRAW: "+C.label+": "+((x&&x.message)||x)));p.catch(()=>{});E.busy.push(p)};
  E.onSeek.push((t)=>{if(!vis(t))return;try{const p=h.seek(Math.max(0,t-C.st)*C.speed);if(p){const q=p.catch((x)=>{throw new Error("E_3D_DRAW: "+C.label+": "+((x&&x.message)||x))});q.catch(()=>{});E.busy.push(q)}}catch(x){oops(x)}});
})());`;
