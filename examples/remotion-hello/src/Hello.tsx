import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, random } from 'remotion';

// Chữ và chấm chỉ tính từ frame: không Date, không Math.random (dùng random(seed) của Remotion), không trạng thái mang qua khung.
export const Hello: React.FC<{ title: string; sub: string }> = ({ title, sub }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });
  const subIn = interpolate(frame, [18, 36], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const out = interpolate(frame, [75, 89], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const hue = interpolate(frame, [0, 89], [210, 290]);
  const dots = Array.from({ length: 24 }, (_, i) => ({
    x: random('x' + i) * width,
    y: random('y' + i) * height,
    r: 6 + random('r' + i) * 18,
    speed: 0.5 + random('s' + i) * 1.5,
  }));
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, hsl(${hue},60%,18%), hsl(${hue + 40},70%,8%))`, fontFamily: 'sans-serif', opacity: out }}>
      {dots.map((d, i) => (
        <div key={i} style={{ position: 'absolute', left: d.x, top: (d.y - frame * d.speed * 6 + height) % height, width: d.r, height: d.r, borderRadius: '50%', background: 'rgba(255,255,255,0.25)' }} />
      ))}
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: 40 }}>
        <div style={{ color: 'white', fontSize: 120, fontWeight: 800, textAlign: 'center', padding: '0 60px', transform: `scale(${pop}) translateY(${(1 - pop) * 120}px)` }}>{title}</div>
        <div style={{ color: 'hsl(45,100%,70%)', fontSize: 56, opacity: subIn, transform: `translateY(${(1 - subIn) * 40}px)` }}>{sub}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
