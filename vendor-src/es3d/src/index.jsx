// es3d — bundle cho phần tử "3d" của es-render: React + @react-three/fiber + drei (một phần) + @react-three/rapier + @react-three/postprocessing,
// three 0.186 nằm trong bundle (không đụng window.THREE 0.160 của khoá "three").
// Đồng hồ: Canvas frameloop "never"; mỗi khung es-render gọi handle.seek(giây phần tử) → (1) vật lý bước cố định 1/60 s từ 0 tới floor(t·60),
// (2) đặt mọi tư thế bằng hàm thuần của t (camera, vật quay…), (3) advance(t) vẽ đồng bộ (cả hậu kỳ). Không useFrame nào tự tính tư thế,
// không đọc clock.getElapsedTime()/getDelta() (đọc lại performance.now), không Noise (cộng dồn delta), không worker, không mạng.
// Tua lùi khi có vật lý: dựng lại cây <Physics> (key mới), chờ commit xong (promise trả về → es-render đẩy vào ES.busy), chạy lại từ bước 0.
import React, { Component, Suspense, useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { createRoot, advance, useThree, extend } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei/core/ContactShadows.js';
import { Physics, useRapier, useBeforePhysicsStep } from '@react-three/rapier';
import { EffectComposer, Bloom, Vignette, DepthOfField, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PRESETS } from './presets.jsx';
import { HZ, DT, usePose, easeInOutCubic } from './util.js';

// R3F v9 + createRoot: danh mục JSX (<mesh>, <meshStandardMaterial>…) phải extend — cả THREE (drei / postprocessing dùng nhiều lớp)
extend(THREE);

class Boundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { this.props.ctl.fail(err); }
  render() { return this.state.err ? null : this.props.children; }
}
// lấy store của root + môi trường phòng (PMREM một lần, đồng bộ) + nền / sương
function Stage({ ctl, spec }) {
  const { gl, scene, get, camera } = useThree();
  useLayoutEffect(() => {
    ctl.get = get;
    const pm = new THREE.PMREMGenerator(gl); const env = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
    scene.environment = env; scene.environmentIntensity = spec.envIntensity;
    if (spec.colors.bg !== 'transparent') { scene.background = new THREE.Color(spec.colors.bg); scene.fog = new THREE.Fog(spec.colors.bg, spec.fog[0], spec.fog[1]); }
    camera.fov = spec.camera.fov; camera.near = 0.05; camera.far = 200; camera.updateProjectionMatrix();
    return () => { env.dispose(); };
  }, []);
  // camera: quay quanh "to" (orbit rad/s) + tiến gần (dolly, phần quãng đường trong cả thời lượng) — thuần theo t
  const c = spec.camera; const off = useMemo(() => new THREE.Vector3(...c.from).sub(new THREE.Vector3(...c.to)), []);
  const v = useMemo(() => new THREE.Vector3(), []); const tg = useMemo(() => new THREE.Vector3(...c.to), []);
  usePose(ctl, (t) => {
    const a = c.orbit * t; const k = 1 - c.dolly * easeInOutCubic(t / spec.D);
    v.copy(off).applyAxisAngle(THREE.Object3D.DEFAULT_UP, a).multiplyScalar(k).add(tg);
    camera.position.copy(v); camera.lookAt(tg); camera.updateMatrixWorld();
  });
  return null;
}
// mỗi mount (kể cả dựng lại) báo "xong" sau khi mọi effect của cây vật lý đã chạy (thân rigid tạo trong useEffect của rapier)
function Settled({ ctl, gen }) { useEffect(() => { ctl.settled(gen); }, []); return null; }
function Stepper({ ctl }) {
  const { step, world } = useRapier();
  useEffect(() => { ctl.step = step; ctl.world = world; return () => { if (ctl.step === step) ctl.step = null; }; }, [step]);
  useBeforePhysicsStep(() => { for (const f of ctl.before) f(ctl.k); });
  return null;
}
function PhysicsTree({ ctl, spec, assets }) {
  const [gen, setGen] = useState(0);
  ctl.setGen = setGen;
  const P = PRESETS[spec.preset];
  if (!spec.physics) return <group key={gen}><P.Scene ctl={ctl} spec={spec} assets={assets} physics={false} /><Settled ctl={ctl} gen={gen} /></group>;
  return (
    <group key={gen}>
      <Physics paused interpolate={false} timeStep={DT} gravity={[0, spec.physics.gravity, 0]} colliders={false}>
        <Stepper ctl={ctl} />
        <P.Scene ctl={ctl} spec={spec} assets={assets} physics />
      </Physics>
      <Settled ctl={ctl} gen={gen} />
    </group>
  );
}
function Fx({ spec }) {
  const f = spec.fx; if (!(f.bloom > 0 || f.vignette > 0 || f.dof)) return null;
  return (
    <EffectComposer multisampling={spec.aa} enableNormalPass={false}>
      {f.bloom > 0 ? <Bloom mipmapBlur intensity={f.bloom} luminanceThreshold={f.threshold} luminanceSmoothing={0.2} radius={0.75} /> : null}
      {f.dof ? <DepthOfField worldFocusDistance={f.dof.focus} worldFocusRange={f.dof.range} bokehScale={f.dof.bokeh} /> : null}
      {f.vignette > 0 ? <Vignette offset={0.3} darkness={f.vignette} /> : null}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
function App({ ctl, spec, assets }) {
  return (
    <Boundary ctl={ctl}>
      <Stage ctl={ctl} spec={spec} />
      <Suspense fallback={null}><PhysicsTree ctl={ctl} spec={spec} assets={assets} /></Suspense>
      {spec.shadow > 0 ? <ContactShadows position={[0, 0.002, 0]} scale={spec.shadowScale} blur={2.4} far={4} opacity={spec.shadow} resolution={512} color="#000000" /> : null}
      <Fx spec={spec} />
    </Boundary>
  );
}

// ảnh / .glb từ byte nhúng (asset-*.js của es-render): không URL mạng; glb nén (Draco / meshopt / KTX2) đã bị chặn ở Node
async function loadAssets(spec, bytes) {
  const out = {};
  if (spec.assets.image) {
    const b = bytes(spec.assets.image); const url = URL.createObjectURL(new Blob([b], { type: spec.assets.imageType || 'image/png' }));
    try { out.image = await new THREE.TextureLoader().loadAsync(url); } finally { URL.revokeObjectURL(url); }
    out.image.colorSpace = THREE.SRGBColorSpace; out.image.anisotropy = 4;
  }
  if (spec.assets.model) {
    const b = bytes(spec.assets.model);
    const gltf = await new Promise((ok, no) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', ok, no));
    out.model = gltf.scene;
  }
  return out;
}

// canvas: <canvas> của phần tử; spec: cấu hình đã chuẩn hoá ở Node (el3d.mjs); opt.bytes(sha8) → Uint8Array
export function mount(canvas, spec, opt = {}) {
  const P = PRESETS[spec.preset]; if (!P) throw new Error('E_3D_PRESET: không có preset "' + spec.preset + '"');
  let failed = null; let onFail = () => {};
  const ctl = { n: 0, k: 0, gen: 0, step: null, get: null, before: [], posers: new Set(), want: {}, waiters: new Map(),
    fail: (e) => { failed = failed || e; onFail(e); },
    settled: (g) => { const w = ctl.waiters.get(g); if (w) { ctl.waiters.delete(g); w(); } } };
  const wait = (g) => new Promise((ok, no) => { ctl.waiters.set(g, ok); onFail = no; if (failed) no(failed); });
  const poses = (t) => { for (const f of ctl.posers) f(t); };
  // postprocessing đặt renderer.autoClear = false; ContactShadows (drei) vẽ vào render target của nó không tự xoá → bóng cộng dồn
  // theo lịch sử tua. Bật lại trước mỗi khung: mọi pass của composer đều vẽ phủ cả khung nên xoá trước không đổi hình.
  const draw = (t) => { poses(t); const st = ctl.get(); st.gl.autoClear = true; advance(t, false, st); };
  const go = (t, want) => { if (spec.physics) { if (!ctl.step) throw new Error('E_3D_PHYSICS: vật lý chưa sẵn sàng'); while (ctl.n < want) { ctl.k = ctl.n; ctl.step(DT); ctl.n++; } } draw(t); };
  let root = null;
  const ready = (async () => {
    const assets = await loadAssets(spec, opt.bytes || (() => { throw new Error('thiếu bytes()'); }));
    root = createRoot(canvas);
    await root.configure({
      gl: { antialias: false, alpha: spec.colors.bg === 'transparent', preserveDrawingBuffer: true, powerPreference: 'high-performance', premultipliedAlpha: true },
      dpr: 1, size: { width: spec.W, height: spec.H, top: 0, left: 0, updateStyle: false }, frameloop: 'never', events: undefined,
      camera: { fov: spec.camera.fov, near: 0.05, far: 200, position: spec.camera.from }, shadows: false,
    });
    const first = wait(0);
    root.render(<App ctl={ctl} spec={spec} assets={assets} />);
    await first;
    if (!ctl.get) throw new Error('E_3D_LOAD: cảnh chưa dựng xong');
    go(0, 0);
    return true;
  })();
  // tua lùi khi có vật lý → promise (dựng lại cây vật lý rồi chạy lại từ 0); còn lại vẽ đồng bộ, trả undefined
  const seek = (t) => {
    if (failed) throw failed;
    const want = spec.physics ? Math.floor(t * HZ + 1e-6) : 0;
    if (want < ctl.n) {
      const g = ++ctl.gen; const p = wait(g); ctl.step = null; ctl.n = 0;
      ctl.setGen(g);
      return p.then(() => go(t, want));
    }
    go(t, want);
    return undefined;
  };
  return { ready, seek, info: () => ({ steps: ctl.n, gen: ctl.gen }), unmount: () => root && root.unmount() };
}

export const version = '1.0.0';
export const presets = Object.keys(PRESETS);
