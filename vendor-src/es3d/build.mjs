// Dựng vendor/es3d.min.js (IIFE, window.ES3D) + vendor/es3d/VERSIONS.json + vendor/es3d/THIRD_PARTY_LICENSES.txt
//   cd vendor-src/es3d && npm ci --ignore-scripts && npm run build      (CI không bao giờ chạy bước này: bundle đã commit)
// Dựng lại từ cùng lockfile phải ra cùng sha256 (in ra cuối) — chạy hai lần để kiểm tra (npm run build -- --check).
// Mọi gói có trong bundle (theo metafile của esbuild) phải có văn bản giấy phép (LICENSE trong gói, hoặc licenses/<tên>.LICENSE), không thì dừng.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'vendor', 'es3d.min.js'); const META = path.join(ROOT, 'vendor', 'es3d');
const NM = path.join(HERE, 'node_modules');
// gói không ghi "license" trong package.json (giấy phép MIT ở repo gốc pmndrs/react-three-rapier @ ae5c3fe)
const LIC_NAME = { '@react-three/rapier': 'MIT' };
const EXTRA_LIC = { '@react-three/fiber': 'react-three-fiber.LICENSE', '@react-three/rapier': 'react-three-rapier.LICENSE', '@dimforge/rapier3d-compat': 'Apache-2.0.txt' };
// thư mục gói tính từ node_modules gốc, giữ cả chuỗi lồng (three-stdlib/node_modules/fflate): bản lồng là gói riêng, có giấy phép riêng
const pkgOf = (f) => { const m = f.replace(/\\/g, '/').match(/node_modules\/((?:(?:@[^/]+\/)?[^/]+\/node_modules\/)*(?:@[^/]+\/)?[^/]+)\//); return m ? m[1] : null; };
const readPkg = (p) => JSON.parse(fs.readFileSync(path.join(NM, p, 'package.json'), 'utf8'));
const DIRECT = Object.keys(JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8')).devDependencies).filter((k) => k !== 'esbuild');

// @react-three/postprocessing nạp sẵn n8ao (N8AO) và maath (Autofocus) ở cấp module — es3d không dùng hai hiệu ứng đó (N8AO có
// thành phần theo thời gian) → thay bằng module rỗng để chúng không nằm trong bundle
const STUB = { n8ao: 'export class N8AOPostPass { constructor() { throw new Error("N8AO không có trong es3d"); } }', maath: 'export const easing = {};' };
const stub = { name: 'stub', setup(b) {
  b.onResolve({ filter: /^(n8ao|maath)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUB[a.path], loader: 'js' }));
} };
async function bundle(versions) {
  fs.writeFileSync(path.join(HERE, 'VERSIONS.gen.json'), JSON.stringify(versions));
  return esbuild.build({
    entryPoints: [path.join(HERE, 'src', 'entry.js')], bundle: true, format: 'iife', platform: 'browser', target: ['chrome120'],
    minify: true, legalComments: 'eof', write: false, metafile: true, jsx: 'automatic', charset: 'utf8', sourcemap: false,
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning', absWorkingDir: HERE, plugins: [stub],
    banner: { js: '/*! es3d — React + @react-three/fiber + @react-three/drei (một phần) + @react-three/rapier (@dimforge/rapier3d-compat, Apache-2.0) + @react-three/postprocessing (postprocessing, Zlib) + three ' + versions.three + '. Giấy phép đầy đủ: vendor/es3d/THIRD_PARTY_LICENSES.txt */' },
  });
}
// lượt 1: lấy danh sách gói từ metafile; lượt 2: dựng thật với VERSIONS (cùng nội dung) → bundle cố định
const v0 = Object.fromEntries(DIRECT.map((p) => [p, readPkg(p).version]));
let r = await bundle(v0);
// gói thật sự có byte trong bundle (metafile.inputs liệt kê cả file bị tree-shake hết)
const inOut = (m) => [...new Set(Object.entries(Object.values(m.outputs)[0].inputs).filter(([, v]) => v.bytesInOutput > 0).map(([k]) => pkgOf(k)).filter(Boolean))].sort();
const used = inOut(r.metafile);
const versions = Object.fromEntries(used.map((p) => [p, readPkg(p).version]));
r = await bundle(versions);
const used2 = inOut(r.metafile);
if (JSON.stringify(used2) !== JSON.stringify(used)) throw new Error('metafile thay đổi giữa hai lượt');
const lic = []; const list = [];
for (const p of used) {
  const j = readPkg(p); const dir = path.join(NM, p); const nm = j.name || p; // p lồng → đọc package.json + LICENSE của chính bản lồng
  const f = fs.readdirSync(dir).find((x) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(x));
  const text = f ? fs.readFileSync(path.join(dir, f), 'utf8') : EXTRA_LIC[nm] ? fs.readFileSync(path.join(HERE, 'licenses', EXTRA_LIC[nm]), 'utf8') : null;
  if (!text) throw new Error('E_LICENSE: gói ' + p + ' có trong bundle nhưng không có văn bản giấy phép (thêm licenses/<tên>.LICENSE)');
  const bytes = Object.entries(r.metafile.outputs[Object.keys(r.metafile.outputs)[0]].inputs).filter(([k]) => pkgOf(k) === p).reduce((s, [, v]) => s + v.bytesInOutput, 0);
  list.push({ name: nm, ...(nm !== p ? { path: 'node_modules/' + p } : {}), version: j.version, license: typeof j.license === 'string' ? j.license : LIC_NAME[nm] || (() => { throw new Error('E_LICENSE: ' + p + ' không ghi giấy phép'); })(), repository: (j.repository && (j.repository.url || j.repository)) || j.homepage || '', bytes, licenseFile: f || 'licenses/' + EXTRA_LIC[nm] });
  lic.push('='.repeat(78) + '\n' + nm + '@' + j.version + ' — ' + list.at(-1).license + (nm !== p ? ' (node_modules/' + p + ')' : '') + '\n' + '='.repeat(78) + '\n' + text.trim() + '\n');
}
fs.rmSync(path.join(HERE, 'VERSIONS.gen.json'), { force: true }); // tệp tạm của entry.js (cả khi --check)
const js = r.outputFiles[0].contents; const sha = crypto.createHash('sha256').update(js).digest('hex');
if (/\bnew\s+(Shared)?Worker\s*\(/.test(Buffer.from(js).toString('utf8'))) console.warn('cảnh báo: bundle có new Worker( — kiểm tra lại');
const check = process.argv.includes('--check');
if (check) { const old = fs.existsSync(OUT) ? crypto.createHash('sha256').update(fs.readFileSync(OUT)).digest('hex') : ''; console.log(old === sha ? 'CHECK OK: dựng lại ra cùng sha256 ' + sha : 'CHECK KHÁC: commit ' + old + ' ≠ dựng lại ' + sha); process.exit(old === sha ? 0 : 1); }
fs.mkdirSync(META, { recursive: true });
fs.writeFileSync(OUT, js);
fs.writeFileSync(path.join(META, 'VERSIONS.json'), JSON.stringify({ es3d: '1.0.0', sha256: sha, bytes: js.length, esbuild: esbuild.version, node: process.version, packages: list }, null, 2) + '\n');
fs.writeFileSync(path.join(META, 'THIRD_PARTY_LICENSES.txt'), 'Giấy phép của các gói nằm trong vendor/es3d.min.js (es3d ' + '1.0.0' + ', dựng bằng esbuild ' + esbuild.version + ' từ vendor-src/es3d/package-lock.json).\n\n' + lic.join('\n'));
console.log('vendor/es3d.min.js', (js.length / 1048576).toFixed(2) + ' MB', 'sha256', sha, '|', used.length, 'gói:', used.join(', '));
