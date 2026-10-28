// T5 mở rộng: job KHÔNG dùng tính năng mới dựng ra như bản gốc (BASE_REF, mặc định d0ec723 = origin/main trước thay đổi), cùng máy:
// khung (framemd5), tiếng (md5 PCM), result.json (trừ render_seconds) và HTML từng cảnh (sau khi thay đường dẫn tạm) trùng hoàn toàn.
// Bộ job tổng hợp phủ các đường dựng có sẵn: GSAP + plugin, anime v3, CSS animation, keyframes + animation, ảnh, video, máy quay +
// chuyển cảnh, lottie-web JSON, three 0.160 (WebGL SwiftShader), phần tử anim, âm thanh (sfx + nhạc + ducking + loudnorm).
// Không mạng: không giọng TTS / phụ đề (font Google), trang anim bỏ link Google Fonts.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/libs/regress.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { REPO, FIX, md5, tmpDir } from './lib.mjs';

const BASE = process.env.BASE_REF || 'd0ec723';
const D = tmpDir('regress'); const baseDir = path.join(D, 'base');
const git = (...a) => execFileSync('git', ['-C', REPO, ...a]).toString();
let HAVE_BASE = true;
before(() => {
  fs.mkdirSync(baseDir, { recursive: true });
  try { for (const f of ['render.mjs', 'anim.mjs']) fs.writeFileSync(path.join(baseDir, f), git('show', BASE + ':' + f)); } catch (e) { HAVE_BASE = false; return; }
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(baseDir, 'node_modules')); fs.symlinkSync(path.join(REPO, 'tts.py'), path.join(baseDir, 'tts.py'));
});
let N = 0;
function run(engineDir, job, env = {}) {
  const id = path.basename(job, '.json'); const out = path.join(D, 'out' + N); const tmp = path.join(D, 'tmp' + N++); fs.mkdirSync(tmp, { recursive: true });
  return new Promise((res, rej) => {
    let log = ''; const p = spawn(process.execPath, [path.join(engineDir, 'render.mjs'), job, out], { cwd: path.dirname(job), env: { ...process.env, RENDER_FPS: '30', RENDER_CONCURRENCY: '3', TMPDIR: tmp, ...env } });
    p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
    p.on('close', (c) => { if (c !== 0) return rej(new Error('exit ' + c + '\n' + log.slice(-3000)));
      const w = path.join(tmp, fs.readdirSync(tmp).find((f) => f.startsWith('esr-')));
      const html = fs.readdirSync(w).filter((f) => /^scene\d+\.html$/.test(f)).sort().map((f) => fs.readFileSync(path.join(w, f), 'utf8').split(w).join('WORK').split(engineDir).join('ROOT'));
      res({ mp4: path.join(out, id + '.mp4'), result: JSON.parse(fs.readFileSync(path.join(out, id + '.result.json'), 'utf8')), log, html }); });
  });
}
const amd5 = (mp4) => execFileSync('ffmpeg', ['-v', 'error', '-i', mp4, '-map', '0:a:0', '-f', 'md5', '-']).toString().trim();
const strip = (r) => { const x = { ...r }; delete x.render_seconds; if (x.anims) x.anims = x.anims.map((a) => ({ ...a, ready_ms: 0 })); return x; }; // giờ thật: không so
async function same(t, name, movie, env) {
  if (!HAVE_BASE) { t.skip('base commit ' + BASE + ' not available'); return; }
  const job = path.join(D, name + '.json'); fs.writeFileSync(job, JSON.stringify(movie));
  const [a, b] = await Promise.all([run(baseDir, job, env), run(REPO, job, env)]);
  const ha = md5(a.mp4); const hb = md5(b.mp4); const first = ha.findIndex((h, i) => h !== hb[i]);
  assert.equal(hb.length, ha.length); assert.equal(first, -1, 'first differing frame ' + first);
  assert.equal(amd5(b.mp4), amd5(a.mp4), 'audio'); assert.deepEqual(strip(b.result), strip(a.result));
  assert.equal(b.html.length, a.html.length); b.html.forEach((h, i) => assert.equal(h, a.html[i], 'scene ' + i + ' HTML'));
  assert.ok(!/ libs |^\d\d:\d\d:\d\d el /m.test(b.log), 'no new code path in the log');
  t.diagnostic(name + ': ' + ha.length + ' frames + audio + result.json + ' + a.html.length + ' scene HTML identical to ' + BASE);
}

const svg = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="90" fill="#ff5a7a"/></svg>');
const GSAP = '<div id="g" style="font:800 56px sans-serif;color:#F6EECD;padding:30px">Split <span id="s">text</span></div><svg width="300" height="120"><path id="p" d="M10 60 Q150 0 290 60" stroke="#fff" stroke-width="8" fill="none"/><path id="q" d="M10 100 L290 100" fill="none"/></svg>'
  + '<script>const sp=SplitText.create("#g",{type:"chars"});const tl=gsap.timeline({paused:true});tl.from(sp.chars,{y:40,opacity:0,stagger:.04,ease:CustomBounce.create("b",{strength:.5})}).from("#p",{drawSVG:"0%",duration:.8},0).to("#s",{scrambleText:"GSAP",duration:.6},.3);ES.onSeek.push((t)=>tl.seek(t));</script>';
const A3 = '<div id="a" style="width:90px;height:90px;background:#3ddc97"></div><script>const an=anime({targets:"#a",translateX:[0,300],rotate:180,easing:"easeOutElastic(1,.6)",duration:1200,autoplay:false});ES.onSeek.push((t)=>an.seek(t*1000));</script>';
const CSS = '<style>@keyframes spin{to{transform:rotate(360deg)}}.c{width:120px;height:120px;background:#ffc53d;animation:spin 1.5s linear infinite}</style><div class="c"></div>';
const LOT = () => '<div id="l" style="width:400px;height:400px"></div><script>const la=lottie.loadAnimation({container:document.getElementById("l"),renderer:"svg",autoplay:false,loop:false,animationData:' + fs.readFileSync(FIX('waves.json'), 'utf8') + '});ES.onSeek.push((t)=>la.goToAndStop(t*1000,false));</script>';
const THREE_ = '<canvas id="c3" width="300" height="300"></canvas><script>const r=new THREE.WebGLRenderer({canvas:document.getElementById("c3"),antialias:false,preserveDrawingBuffer:true});const sc=new THREE.Scene();const cam=new THREE.PerspectiveCamera(40,1,.1,100);cam.position.z=5;'
  + 'const m=new THREE.Mesh(new THREE.BoxGeometry(1.6,1.6,1.6),new THREE.MeshStandardMaterial({color:0x4d9dff}));sc.add(m);sc.add(new THREE.AmbientLight(0xffffff,.4));const dl=new THREE.DirectionalLight(0xffffff,1.2);dl.position.set(2,3,4);sc.add(dl);'
  + 'ES.onSeek.push((t)=>{m.rotation.set(t*.9,t*1.3,0);r.render(sc,cam)});</script>';
function media() {
  const vid = path.join(D, 'clip.mp4'); const wav = path.join(D, 'blip.wav'); const mus = path.join(D, 'music.wav');
  if (!fs.existsSync(vid)) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-t', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', vid]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.3', wav]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=6', mus]);
  }
  return { vid, wav, mus };
}
test('regression (strict): GSAP + plugins, anime v3, CSS animation, keyframes + animation, image, camera + transitions', async (t) => {
  await same(t, 'r-gsap', { width: 540, height: 960, creative: { level: 'bold', seed: 'r1' }, scenes: [
    { comment: 's01 hook', duration: 1.2, 'background-color': '#14142B', elements: [{ type: 'html', libs: ['gsap', 'splittext', 'drawsvg', 'scrambletext', 'custombounce'], html: GSAP, x: 0, y: 100, width: 540, height: 400 },
      { type: 'image', src: svg, x: 170, y: 560, width: 200, height: 200, 'fade-in': 0.3, animation: 'pop' }] },
    { comment: 's02 item', duration: 1.2, 'background-color': '#0B0510', transition: { style: 'fade', duration: 0.3 }, elements: [{ type: 'html', libs: ['animejs'], html: A3, x: 40, y: 300, width: 460, height: 200, keyframes: [{ time: 0, y: 300 }, { time: 1, y: 500, easing: 'ease-out-back' }] }] },
    { comment: 's03 feature', duration: 1.2, 'background-color': '#204020', transition: { style: 'smoothleft', duration: 0.3 }, elements: [{ type: 'html', html: CSS, x: 200, y: 400, width: 200, height: 200 }] }] });
});
test('regression (strict): lottie-web JSON, three 0.160 (SwiftShader), video frames + sfx + music ducking + loudnorm', async (t) => {
  const { vid, wav, mus } = media();
  await same(t, 'r-libs', { width: 540, height: 960, creative: 'off', elements: [{ type: 'audio', src: mus, volume: 0.4 }], scenes: [
    { duration: 1.2, 'background-color': '#101018', elements: [{ type: 'html', libs: ['lottie'], html: LOT(), x: 70, y: 100, width: 400, height: 400 }, { type: 'html', libs: ['three'], html: THREE_, x: 120, y: 560, width: 300, height: 300 }] },
    { duration: 1.5, 'background-color': '#000', elements: [{ type: 'video', src: vid, fit: 'contain', x: 0, y: 300, width: 540, height: 360 }, { type: 'audio', src: wav, start: 0.4, comment: 'hit peakAt=0.05' }] }] });
});
test('regression (strict): an anim element (motion2code page) as overlay', async (t) => {
  const page = path.join(D, 'seek-loop.html');
  fs.writeFileSync(page, fs.readFileSync(path.join(REPO, 'examples', 'anim-hello', 'seek-loop.html'), 'utf8').replace(/<link[^>]+fonts\.(googleapis|gstatic)[^>]*>\s*/g, ''));
  await same(t, 'r-anim', { width: 540, height: 960, creative: 'off', scenes: [{ duration: 1.5, 'background-color': '#14142B', elements: [{ type: 'anim', src: 'seek-loop.html', x: 0, y: 300, width: 540, height: 304, background: 'transparent', seek: 1 }] }] });
});
