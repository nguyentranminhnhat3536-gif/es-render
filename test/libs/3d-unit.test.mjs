// Test nhanh (không trình duyệt) cho phần tử "3d" / bundle es3d: bundle đã commit khớp VERSIONS.json (sha256), mọi gói trong bundle có văn bản
// giấy phép, không worker / CDN; preset không đọc giờ thật (getElapsedTime/getDelta), không Noise; kiểm tra trường, .glb (nén / file ngoài bị từ chối),
// els.expand đổi "3d" thành html + libs ["es3d"]; khoá es3d + bí danh; khoá "three" (0.160) không đổi.
//   node --test test/libs/3d-unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as EL from '../../els.mjs';
import * as E3 from '../../el3d.mjs';
import * as LIBS2 from '../../libs.mjs';
import { REPO, EX, tmpDir } from './lib.mjs';
import { glbBox } from './glb.mjs';

const V = (...p) => path.join(REPO, 'vendor', ...p);
const SRC = path.join(REPO, 'vendor-src', 'es3d');

test('committed bundle matches VERSIONS.json and every bundled package has its licence text', () => {
  const js = fs.readFileSync(V('es3d.min.js')); const ver = JSON.parse(fs.readFileSync(V('es3d', 'VERSIONS.json'), 'utf8'));
  assert.equal(crypto.createHash('sha256').update(js).digest('hex'), ver.sha256, 'bundle sha256 = VERSIONS.json (rebuild: cd vendor-src/es3d && npm ci --ignore-scripts && npm run build)');
  assert.equal(js.length, ver.bytes); assert.ok(js.length < 6 * 1048576, 'bundle < 6 MB (else split physics, PLAN 2.5)');
  const lic = fs.readFileSync(V('es3d', 'THIRD_PARTY_LICENSES.txt'), 'utf8');
  for (const p of ver.packages) { assert.ok(lic.includes('\n' + p.name + '@' + p.version + ' — '), 'licence entry for ' + p.name); assert.ok(p.license, p.name); }
  for (const p of ['three', 'react', '@react-three/fiber', '@react-three/drei', '@react-three/rapier', '@dimforge/rapier3d-compat', '@react-three/postprocessing', 'postprocessing']) assert.ok(ver.packages.some((x) => x.name === p), p + ' bundled');
  assert.match(lic, /Apache License\s+Version 2\.0/, 'rapier engine: full Apache-2.0 text'); assert.ok(ver.packages.find((x) => x.name === 'postprocessing').license === 'Zlib');
  assert.equal(ver.packages.find((x) => x.name === 'three').version, '0.186.1');
  // pins = lockfile của vendor-src/es3d
  const pj = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')); const lock = JSON.parse(fs.readFileSync(path.join(SRC, 'package-lock.json'), 'utf8'));
  for (const [k, v] of Object.entries(pj.devDependencies)) { assert.match(v, /^\d+\.\d+\.\d+$/, k); assert.equal(lock.packages['node_modules/' + k].version, v, k); }
  for (const p of ver.packages) if (lock.packages['node_modules/' + p.name]) assert.equal(lock.packages['node_modules/' + p.name].version, p.version, p.name + ' bundled = locked');
  // gốc es-render không kéo các gói dựng es3d (CI dựng không cài 200 MB công cụ dựng)
  const root = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.ok(!root.devDependencies || !Object.keys(root.devDependencies).some((k) => /react|esbuild|rapier|postprocessing/.test(k)));
  assert.equal(root.dependencies.three, '0.160.0', 'global three stays 0.160');
});
test('bundle has no worker, no CDN / network targets; presets never read real time or use Noise', () => {
  const s = fs.readFileSync(V('es3d.min.js'), 'utf8');
  assert.ok(!/\bnew\s+(Shared)?Worker\s*\(/.test(s), 'no new Worker(');
  const urls = [...new Set(s.match(/https?:\/\/[^\s"'`)\\]+/g) || [])];
  const ok = /^https?:\/\/(react\.dev\/errors|github\.com\/|opencollective\.com\/|docs\.pmnd\.rs\/|jcgt\.org\/|www\.w3\.org\/)/;
  assert.deepEqual(urls.filter((u) => !ok.test(u)), [], 'only doc / licence links, no CDN (gstatic draco, jsdelivr, unpkg, HDRI presets…)');
  assert.ok(!/gstatic|jsdelivr|unpkg|githack|raw\.githubusercontent/.test(s));
  for (const f of fs.readdirSync(path.join(SRC, 'src'))) {
    const t = fs.readFileSync(path.join(SRC, 'src', f), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/getElapsedTime|getDelta|performance\.now|Date\.now|Math\.random/.test(t), f + ': no real clock / unseeded random');
    assert.ok(!/\bNoise\b|N8AO|useFrame\s*\(/.test(t), f + ': no Noise / N8AO / self-timed useFrame (poses come from usePose(t))');
  }
});
test('rebuilding the bundle from the lockfile gives the same sha256 (only when build deps are installed)', (t) => {
  if (!fs.existsSync(path.join(SRC, 'node_modules', 'esbuild'))) { t.skip('vendor-src/es3d/node_modules not installed'); return; }
  const r = spawnSync(process.execPath, ['build.mjs', '--check'], { cwd: SRC, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /CHECK OK/);
});
test('es3d key and aliases; old "three" key unchanged; bundle file found', () => {
  for (const k of ['es3d', 'r3f', 'reactthreefiber', 'threefiber']) assert.equal(LIBS2.key(k), 'es3d', k);
  assert.equal(LIBS2.key('three'), 'three'); assert.ok(fs.existsSync(LIBS2.fileOf('es3d'))); assert.equal(LIBS2.version('es3d'), '1.0.0');
  const h = LIBS2.tags(['es3d'], { work: tmpDir('3du') }); assert.match(h, /es3d\.min\.js/); assert.ok(h.includes('E.wait=E.wait||[]'), 'new-key preamble');
  assert.ok(EL.FEATURES.includes('3d'));
});
test('3d field validation: presets, colors, camera, fx (Noise refused), physics, numbers', () => {
  const ok = (e) => EL.validate({ type: '3d', ...e }).errors.map((x) => x.code + ' ' + x.msg);
  assert.deepEqual(ok({}), []); assert.deepEqual(ok({ preset: 'logo-spin', image: 'a/logo.png', colors: { bg: 'transparent' } }), []);
  assert.match(ok({ preset: 'spinny' })[0], /E_3D_PRESET/);
  assert.match(ok({ fx: { noise: 0.04 } })[0], /noise không hỗ trợ/);
  assert.match(ok({ colors: { accent: 'red' } })[0], /colors\.accent/);
  assert.match(ok({ camera: { from: [0, 1] } })[0], /camera\.from/);
  assert.match(ok({ physics: { restitution: 3 } })[0], /restitution/);
  assert.match(ok({ model: 'x.gltf' })[0], /\.glb/); assert.match(ok({ image: 'x.gif' })[0], /png/);
  assert.match(ok({ aa: 3 })[0], /aa/); assert.match(ok({ bits: 2.5 })[0], /bits/); assert.match(ok({ seed: -1 })[0], /seed/);
  const w = EL.validate({ type: '3d', text: 'ETHAN', fx: { ssr: 1 } }).warnings.map((x) => x.msg).join(' | ');
  assert.match(w, /"text" không dùng.*phần tử text/); assert.match(w, /fx\.ssr/);
  assert.match(EL.validate({ type: '3d', preset: 'logo-spin', physics: true }).warnings[0].code, /W_3D_PHYSICS/);
});
test('3d spec defaults per preset; physics on by default for product-hero, never for logo-spin', () => {
  const a = E3.spec({}, { w: 100, h: 200, D: 4, assets: {} }); assert.equal(a.preset, 'product-hero'); assert.deepEqual(a.physics, { gravity: -9.81, restitution: 0.35 });
  assert.equal(E3.spec({ physics: false }, { w: 1, h: 1, D: 1, assets: {} }).physics, null);
  assert.equal(E3.spec({ preset: 'logo-spin', physics: true }, { w: 1, h: 1, D: 1, assets: {} }).physics, null);
  assert.equal(E3.spec({ fx: { dof: { focus: 5 } } }, { w: 1, h: 1, D: 1, assets: {} }).fx.dof.focus, 5);
});
test('.glb checks: self-contained uncompressed ok; Draco / meshopt / KTX2 and external files refused', () => {
  assert.equal(E3.checkGlb(glbBox()), null);
  for (const ext of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu']) assert.match(E3.checkGlb(glbBox({ ext })), /^E_3D_UNSUPPORTED: .*không nén/, ext);
  assert.match(E3.checkGlb(glbBox({ uri: 'box.bin' })), /^E_3D_UNSUPPORTED: .*file ngoài/);
  assert.match(E3.checkGlb(Buffer.from('not a glb at all, sorry')), /glTF/);
  assert.equal(E3.imageType(fs.readFileSync(EX('3d-hello', 'label.png'))), 'image/png'); assert.equal(E3.imageType(Buffer.from('GIF89a........')), null);
});
test('els.expand: 3d → html with canvas, libs ["es3d"], asset files, layout fields copied; Node refuses bad files with clear codes', async () => {
  const work = tmpDir('3du'); const d = tmpDir('3du'); const logs = [];
  fs.writeFileSync(path.join(d, 'box.glb'), glbBox()); fs.writeFileSync(path.join(d, 'draco.glb'), glbBox({ ext: 'KHR_draco_mesh_compression' })); fs.writeFileSync(path.join(d, 'bad.glb'), 'nope');
  const job = path.join(d, 'job.json');
  const scenes = [{ i: 0, duration: 3, elements: [{ type: '3d', model: 'box.glb', image: EX('3d-hello', 'label.png'), x: 5, y: 6, width: 300, height: 500, start: 0.5, 'z-index': 2, 'fade-in': 0.3, speed: 2 }] }];
  const r = await EL.expand(scenes, { jobPath: job, work, W: 640, H: 360, log: (...a) => logs.push(a.join(' ')) });
  assert.equal(r.elements, 1); assert.equal(r.assets, 2);
  const e = scenes[0].elements[0];
  assert.equal(e.type, 'html'); assert.deepEqual(e.libs, ['es3d']); assert.equal(e.width, 300); assert.equal(e.height, 500); assert.equal(e.start, 0.5); assert.equal(e['z-index'], 2); assert.equal(e['fade-in'], 0.3);
  assert.match(e.html, /<canvas id="e0c" width="300" height="500"/); assert.equal((e.html.match(/asset-[0-9a-f]{8}\.js/g) || []).length, 2);
  const C = JSON.parse(e.html.match(/const C=(\{.*?\});\(window\.__esEl/)[1]);
  assert.equal(C.spec.W, 300); assert.equal(C.spec.D, 5, 'D = (scene 3 s − start 0.5) × speed 2'); assert.match(C.spec.assets.model, /^[0-9a-f]{8}$/); assert.equal(C.spec.assets.imageType, 'image/png');
  for (const [file, code] of [['draco.glb', /E_3D_UNSUPPORTED: draco\.glb: .*không nén/], ['bad.glb', /E_3D_LOAD: bad\.glb/], ['missing.glb', /E_EL_SRC_NOT_FOUND: model "missing\.glb"/]]) {
    const sc = [{ i: 0, elements: [{ type: '3d', model: file }] }];
    await assert.rejects(EL.expand(sc, { jobPath: job, work, W: 64, H: 64 }), code, file);
  }
  const hide = [{ i: 0, elements: [{ type: '3d', model: 'bad.glb', 'on-error': 'hide' }] }];
  await EL.expand(hide, { jobPath: job, work, W: 64, H: 64 }); assert.match(hide[0].elements[0].html, /"bad":"không phải file \.glb/);
  const long = [{ i: 0, duration: 50, elements: [{ type: '3d' }] }]; const l2 = [];
  await EL.expand(long, { jobPath: job, work, W: 64, H: 64, log: (...a) => l2.push(a.join(' ')) }); assert.ok(l2.some((x) => /W_3D_SLOW/.test(x)));
});
test('3d defaults: ready timeout 60 s (parallel scene pages start ~10× slower); W_3D_SLOW gives the measured per-frame cost and an estimate', async () => {
  const work = tmpDir('3dt'); const d = tmpDir('3dt'); const job = path.join(d, 'job.json');
  const sc = [{ i: 0, duration: 2, elements: [{ type: '3d' }, { type: '3d', timeout: 5 }] }];
  await EL.expand(sc, { jobPath: job, work, W: 64, H: 64 });
  const C = (e) => JSON.parse(e.html.match(/const C=(\{.*?\});\(window\.__esEl/)[1]);
  assert.equal(E3.TIMEOUT, 60); assert.equal(C(sc[0].elements[0]).timeout, 60); assert.equal(C(sc[0].elements[1]).timeout, 5);
  const logs = []; const big = [{ i: 0, duration: 41, elements: [{ type: '3d' }] }];
  await EL.expand(big, { jobPath: job, work, W: 1080, H: 1920, FPS: 30, log: (...a) => logs.push(a.join(' ')) });
  const w = logs.find((x) => /W_3D_SLOW/.test(x)); assert.ok(w); assert.match(w, /1,5–3 s mỗi khung 1080×1920/); assert.match(w, /ước ~(5[0-9]|6[0-9]) phút/);
  const l2 = []; const huge = [{ i: 0, duration: 70, elements: [{ type: '3d' }] }];
  await EL.expand(huge, { jobPath: job, work, W: 1080, H: 1920, FPS: 30, log: (...a) => l2.push(a.join(' ')) }); assert.ok(l2.some((x) => /GẦN HẠN 120 PHÚT/.test(x)));
  const l3 = []; await EL.expand([{ i: 0, duration: 4, elements: [{ type: '3d' }] }], { jobPath: job, work, W: 270, H: 480, log: (...a) => l3.push(a.join(' ')) }); assert.ok(!l3.some((x) => /W_3D_SLOW/.test(x)));
});
test('ES_CONTAIN_FILES=1 (default on GitHub Actions): local files outside the job folder / repo are refused', async () => {
  const work = tmpDir('3dc'); const d = tmpDir('3dc'); const out = tmpDir('3dc'); const job = path.join(d, 'job.json');
  fs.writeFileSync(path.join(d, 'box.glb'), glbBox()); fs.writeFileSync(path.join(out, 'secret.png'), fs.readFileSync(EX('3d-hello', 'label.png')));
  const old = process.env.ES_CONTAIN_FILES; process.env.ES_CONTAIN_FILES = '1';
  try {
    const cwd = process.cwd(); process.chdir(d);
    try {
      const ok = [{ i: 0, elements: [{ type: '3d', model: 'box.glb' }] }]; await EL.expand(ok, { jobPath: job, work, W: 64, H: 64 }); assert.equal(ok[0].elements[0].type, 'html');
      for (const src of [path.join(out, 'secret.png'), 'file://' + path.join(out, 'secret.png'), path.relative(d, path.join(out, 'secret.png'))])
        await assert.rejects(EL.expand([{ i: 0, elements: [{ type: '3d', image: src }] }], { jobPath: job, work, W: 64, H: 64 }), /E_EL_SRC_OUTSIDE/, src);
    } finally { process.chdir(cwd); }
    process.env.ES_CONTAIN_FILES = '0';
    const off = [{ i: 0, elements: [{ type: '3d', image: path.join(out, 'secret.png') }] }]; await EL.expand(off, { jobPath: job, work, W: 64, H: 64 }); assert.equal(off[0].elements[0].type, 'html');
  } finally { if (old === undefined) delete process.env.ES_CONTAIN_FILES; else process.env.ES_CONTAIN_FILES = old; }
});
