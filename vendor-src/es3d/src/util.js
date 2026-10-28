// tiện ích chung của es3d: PRNG có seed, bước vật lý cố định, đăng ký "poser" (hàm tư thế thuần theo giây t, chạy trước advance)
import { useLayoutEffect } from 'react';

export const HZ = 60; export const DT = 1 / HZ;
export const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const easeOutCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInOutCubic = (x) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
// fn(t) đặt tư thế của đối tượng theo giây phần tử — không đọc delta, không cộng dồn
export function usePose(ctl, fn, deps = []) {
  useLayoutEffect(() => { ctl.posers.add(fn); return () => { ctl.posers.delete(fn); }; }, deps);
}
// hàm chạy trước mỗi bước vật lý k (0, 1, 2…): vật kinematic đặt vị trí của bước k + 1
export function useBeforeStep(ctl, fn, deps = []) {
  useLayoutEffect(() => { ctl.before.push(fn); return () => { const i = ctl.before.indexOf(fn); if (i >= 0) ctl.before.splice(i, 1); }; }, deps);
}
