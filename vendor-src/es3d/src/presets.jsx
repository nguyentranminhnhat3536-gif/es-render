// preset của phần tử "3d". Mỗi preset là một cây React; tư thế theo thời gian đặt bằng usePose (hàm thuần của t),
// vật lý chỉ qua <Physics> của index.jsx (bước cố định 1/60 s). Số ngẫu nhiên: mulberry32(spec.seed), tạo lại khi dựng lại cây.
import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBox } from '@react-three/drei/core/RoundedBox.js';
import { RigidBody, CuboidCollider, CylinderCollider, BallCollider } from '@react-three/rapier';
import { mulberry32, usePose, useBeforeStep, DT, easeOutCubic } from './util.js';

const glow = (c, k = 3) => <meshStandardMaterial color={c} emissive={c} emissiveIntensity={k} toneMapped={false} />;
function Lights({ spec }) {
  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight position={[3, 6, 4]} intensity={2} />
      <directionalLight position={[-4, 3, -3]} intensity={0.9} color={spec.colors.accent} />
      <pointLight position={[0, 3.2, -2.6]} intensity={18} distance={9} color={spec.colors.accent} />
    </>
  );
}
function Floor({ spec, physics }) {
  const c = useMemo(() => new THREE.Color(spec.colors.bg === 'transparent' ? '#111118' : spec.colors.bg).offsetHSL(0, 0, 0.04), []);
  const mesh = <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[40, 96]} /><meshStandardMaterial color={c} roughness={0.9} metalness={0} envMapIntensity={0.25} /></mesh>;
  if (spec.colors.bg === 'transparent' && !physics) return null;
  return (
    <>
      {spec.colors.bg === 'transparent' ? null : mesh}
      {physics ? <RigidBody type="fixed" colliders={false}><CuboidCollider args={[14, 0.5, 14]} position={[0, -0.5, 0]} friction={0.9} /></RigidBody> : null}
    </>
  );
}

// sản phẩm: hộp bo góc (mặt trước = ảnh "image" nếu có) hoặc model .glb (thu về chiều cao h, đặt giữa)
function useProduct(spec, assets) {
  return useMemo(() => {
    const [w, h, d] = spec.product;
    if (!assets.model) return { w, h, d, model: null };
    const m = assets.model.clone(true); const bb = new THREE.Box3().setFromObject(m); const sz = bb.getSize(new THREE.Vector3()); const ct = bb.getCenter(new THREE.Vector3());
    const s = h / Math.max(1e-6, sz.y); m.scale.setScalar(s); m.position.set(-ct.x * s, -ct.y * s, -ct.z * s);
    return { w: sz.x * s, h, d: sz.z * s, model: m };
  }, []);
}
function ProductMesh({ spec, assets, p }) {
  if (p.model) return <primitive object={p.model} />;
  const { w, h, d } = p;
  return (
    <group>
      <RoundedBox args={[w, h, d]} radius={Math.min(0.08, w * 0.08)} smoothness={4}>
        <meshPhysicalMaterial color={spec.colors.primary} roughness={0.3} metalness={0.2} clearcoat={0.7} clearcoatRoughness={0.2} />
      </RoundedBox>
      <mesh position={[0, 0, d / 2 + 0.002]}>
        <planeGeometry args={[w * 0.82, h * 0.78]} />
        {assets.image ? <meshStandardMaterial map={assets.image} roughness={0.4} metalness={0} /> : <meshStandardMaterial color={spec.colors.accent} emissive={spec.colors.accent} emissiveIntensity={0.35} roughness={0.5} />}
      </mesh>
      <mesh position={[0, -h * 0.47, d / 2 + 0.003]}><planeGeometry args={[w * 0.5, h * 0.025]} />{glow(spec.colors.accent, 2.2)}</mesh>
    </group>
  );
}

// product-hero: bệ xoay (kinematic khi có vật lý → ma sát kéo sản phẩm xoay theo), sản phẩm rơi xuống bệ, hạt màu rơi nảy, viền phát sáng (bloom)
function ProductHero({ ctl, spec, assets, physics }) {
  const R = 1.05; const Hp = 0.42; const spin = spec.spin; const ph = spec.physics || {};
  const p = useProduct(spec, assets);
  const ped = useRef(); const body = useRef(); const prodG = useRef();
  const rnd = useMemo(() => mulberry32(spec.seed), []);
  const tilt = useMemo(() => [(rnd() - 0.5) * 0.12, -0.5 + (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.12], []);
  const bits = useMemo(() => {
    const out = []; const pal = [spec.colors.accent, spec.colors.primary, spec.colors.accent2 || spec.colors.accent];
    for (let i = 0; i < spec.bits; i++) {
      const a = rnd() * Math.PI * 2; const r = 0.55 + rnd() * 1.25;
      out.push({ kind: rnd() < 0.55 ? 'ball' : 'cube', s: 0.07 + rnd() * 0.09, pos: [Math.cos(a) * r, 2.8 + i * (spec.spread / Math.max(1, spec.bits)) + rnd() * 0.5, Math.sin(a) * r * 1.1 - 0.15],
        rot: [rnd() * 3, rnd() * 3, rnd() * 3], av: [(rnd() - 0.5) * 8, (rnd() - 0.5) * 8, (rnd() - 0.5) * 8], c: pal[Math.floor(rnd() * pal.length)], glow: rnd() < 0.4 });
    }
    return out;
  }, []);
  const q = useMemo(() => new THREE.Quaternion(), []); const e = useMemo(() => new THREE.Euler(), []);
  // bệ: có vật lý → đặt góc của bước k + 1 trước khi bước; không vật lý → góc theo t
  useBeforeStep(ctl, (k) => { if (body.current) body.current.setNextKinematicRotation(q.setFromEuler(e.set(0, spin * (k + 1) * DT, 0))); });
  usePose(ctl, (t) => { if (!physics && ped.current) ped.current.rotation.y = spin * t; });
  // không vật lý: sản phẩm hạ xuống bệ bằng đường cong (thuần theo t) rồi xoay cùng bệ
  usePose(ctl, (t) => { if (!physics && prodG.current) { const u = easeOutCubic(t / 0.9); prodG.current.position.y = Hp + p.h / 2 + (1 - u) * 2.6; } });
  const pedMesh = (
    <>
      <mesh position={[0, Hp / 2, 0]}><cylinderGeometry args={[R, R * 1.04, Hp, 96]} /><meshPhysicalMaterial color="#1b1c24" roughness={0.25} metalness={0.7} clearcoat={0.5} /></mesh>
      <mesh position={[0, Hp, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[R * 0.985, 0.022, 16, 160]} />{glow(spec.colors.accent, 4)}</mesh>
      <mesh position={[0, 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[R * 1.035, 0.012, 12, 160]} />{glow(spec.colors.accent, 2)}</mesh>
    </>
  );
  return (
    <>
      <Lights spec={spec} />
      <Floor spec={spec} physics={physics} />
      {physics ? (
        <>
          <RigidBody ref={body} type="kinematicPosition" colliders={false}>
            <CylinderCollider args={[Hp / 2, R]} position={[0, Hp / 2, 0]} friction={2} restitution={0.1} />
            {pedMesh}
          </RigidBody>
          <RigidBody colliders={false} position={[0, Hp + p.h / 2 + spec.drop, 0]} rotation={tilt} linearDamping={0.05} angularDamping={0.6} ccd>
            <CuboidCollider args={[p.w / 2, p.h / 2, p.d / 2]} restitution={Math.min(0.25, ph.restitution * 0.5)} friction={2} density={1} />
            <ProductMesh spec={spec} assets={assets} p={p} />
          </RigidBody>
          {bits.map((b, i) => (
            <RigidBody key={i} colliders={false} position={b.pos} rotation={b.rot} angularVelocity={b.av} linearDamping={0.1} angularDamping={0.3}>
              {b.kind === 'ball' ? <BallCollider args={[b.s]} restitution={ph.restitution + 0.15} friction={0.6} /> : <CuboidCollider args={[b.s, b.s, b.s]} restitution={ph.restitution} friction={0.7} />}
              <mesh>{b.kind === 'ball' ? <sphereGeometry args={[b.s, 24, 16]} /> : <boxGeometry args={[b.s * 2, b.s * 2, b.s * 2]} />}
                {b.glow ? glow(b.c, 2.5) : <meshPhysicalMaterial color={b.c} roughness={0.25} metalness={0.3} clearcoat={0.6} />}</mesh>
            </RigidBody>
          ))}
        </>
      ) : (
        <group ref={ped}>
          {pedMesh}
          <group ref={prodG} position={[0, Hp + p.h / 2 + 2.6, 0]}><ProductMesh spec={spec} assets={assets} p={p} /></group>
        </group>
      )}
    </>
  );
}

// logo-spin: đồng xu kim loại, mặt trước / sau là ảnh (logo), quay vào (easeOut) rồi xoay chậm + lơ lửng; viền phát sáng
function LogoSpin({ ctl, spec, assets }) {
  const g = useRef(); const R = 1.1; const T = 0.16; const y0 = spec.camera.to[1];
  usePose(ctl, (t) => {
    if (!g.current) return;
    g.current.rotation.y = easeOutCubic(t / 1.6) * Math.PI * 2 * spec.turns + t * spec.spin;
    g.current.position.y = y0 + Math.sin(t * 2.1) * 0.06; g.current.rotation.z = Math.sin(t * 1.3) * 0.05;
  });
  const face = (z, ry) => (
    <mesh position={[0, 0, z]} rotation={[0, ry, 0]}><circleGeometry args={[R * 0.86, 96]} />
      {assets.image ? <meshStandardMaterial map={assets.image} roughness={0.35} metalness={0.1} transparent /> : <meshStandardMaterial color={spec.colors.accent} roughness={0.3} metalness={0.6} />}</mesh>
  );
  return (
    <>
      <Lights spec={spec} />
      <Floor spec={spec} physics={false} />
      <group ref={g} position={[0, y0, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[R, R, T, 128]} /><meshPhysicalMaterial color={spec.colors.primary} roughness={0.22} metalness={0.9} clearcoat={0.6} /></mesh>
        {face(T / 2 + 0.002, 0)}{face(-T / 2 - 0.002, Math.PI)}
        <mesh><torusGeometry args={[R * 1.0, 0.028, 16, 160]} />{glow(spec.colors.accent, 4)}</mesh>
      </group>
    </>
  );
}

export const PRESETS = {
  'product-hero': { Scene: ProductHero, physics: 'optional' },
  'logo-spin': { Scene: LogoSpin, physics: 'none' },
};
