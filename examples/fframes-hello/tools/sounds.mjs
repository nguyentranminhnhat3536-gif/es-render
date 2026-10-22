#!/usr/bin/env node
// Tạo âm thanh cho fframes-hello bằng toán (không dùng file của ai → không vướng bản quyền), ghi vào media/*.wav.
//   node tools/sounds.mjs        (chạy lại ra y hệt: nhiễu dùng hạt giống cố định)
// Nhịp 120 BPM khớp các hằng T_* trong src/lib.rs: mỗi phách 0,5 s.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 48000; const BEAT = 0.5; const DUR = 11 * BEAT;
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'media');
let seed = 0x2f6e2b1; const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
const TAU = Math.PI * 2;

function wav(name, x, peakDb = -1) {
  // chuẩn hoá đỉnh để mức to nhỏ chỉnh ở một chỗ: gain_db trong lib.rs
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v)); const k = pk ? 10 ** (peakDb / 20) / pk : 0;
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  x.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * k)) * 32767), 44 + i * 2));
  fs.writeFileSync(path.join(out, name), b); console.log(name, (x.length / SR).toFixed(2) + 's');
}
const buf = (sec) => new Float32Array(Math.round(sec * SR));
// lọc thông dải 2 cực (RBJ), tần số đổi theo thời gian cho tiếng gió
function bandpass(x, fAt, q = 2.5) {
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const w = TAU * fAt(i / SR) / SR, a = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + a;
    const v = (a * x[i] - a * x2 - -2 * c * y1 - (1 - a) * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// nền: hợp âm La trưởng add9 ấm + nhịp trống trầm mỗi phách, mở ngay khung đầu, tắt dần 0,8 s cuối
{
  const x = buf(DUR); const notes = [110, 164.81, 246.94, 277.18, 329.63];
  for (let i = 0; i < x.length; i++) {
    const t = i / SR; const env = Math.min(1, t / 0.04) * Math.min(1, (DUR - t) / 0.8);
    let pad = 0; for (const [n, f] of notes.entries()) { const lfo = 1 + 0.25 * Math.sin(TAU * (0.5 + n * 0.13) * t); pad += lfo * (Math.sin(TAU * (f - 0.35) * t) + Math.sin(TAU * (f + 0.35) * t + n) + 0.18 * Math.sin(TAU * 2 * f * t)) / (1 + n * 0.35); }
    const ph = t % BEAT; const kick = t < DUR - BEAT ? Math.sin(TAU * (46 * ph + (120 / 26) * (1 - Math.exp(-26 * ph)))) * Math.exp(-11 * ph) : 0;
    const off = (t + BEAT / 2) % BEAT; const hat = t > 2 * BEAT && t < DUR - BEAT ? noise() * Math.exp(-90 * off) * 0.12 : 0;
    x[i] = env * (0.11 * pad + 0.55 * kick + hat);
  }
  wav('bed.wav', x);
}
// pop: tiếng "bụp" ngắn khi số tỉ lệ đáp xuống
{
  const x = buf(0.16);
  for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] = Math.sin(TAU * (700 * t + 500 / 30 * (1 - Math.exp(-30 * t)))) * Math.exp(-38 * t) * Math.min(1, t / 0.002) + noise() * Math.exp(-400 * t) * 0.3; }
  wav('pop.wav', x);
}
// whoosh: nhiễu qua dải lọc quét 400 → 3000 → 900 Hz, đỉnh ở 0,45 s (giữa lúc khung đổi dạng)
{
  const n = buf(0.8).map(() => noise());
  const y = bandpass(n, (t) => (t < 0.45 ? 400 + 2600 * (t / 0.45) ** 2 : 3000 - 2100 * Math.min(1, (t - 0.45) / 0.35)));
  for (let i = 0; i < y.length; i++) { const t = i / SR; y[i] *= t < 0.45 ? (t / 0.45) ** 2 : Math.exp(-9 * (t - 0.45)); }
  wav('whoosh.wav', y);
}
// tick: tiếng bấm nút chọn khung
{
  const x = buf(0.05);
  for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] = Math.sin(TAU * 3100 * t) * Math.exp(-160 * t) + noise() * Math.exp(-900 * t) * 0.6; }
  wav('tick.wav', x);
}
// chime: chuông nhẹ cho chữ ký ETHAN STUDIO (Mi 6 + bồi âm)
{
  const x = buf(1.6);
  for (let i = 0; i < x.length; i++) { const t = i / SR; const a = Math.min(1, t / 0.005); x[i] = a * (Math.sin(TAU * 1318.5 * t) * Math.exp(-2.6 * t) + 0.35 * Math.sin(TAU * 2637 * t) * Math.exp(-4 * t) + 0.12 * Math.sin(TAU * 3955.5 * t) * Math.exp(-7 * t)); }
  wav('chime.wav', x);
}
