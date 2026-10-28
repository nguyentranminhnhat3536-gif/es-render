// spec/timing.mjs — exact timing after TTS, BEFORE any frame is drawn (adapted from the craft design's tested solver to the final spec shape).
// Mirrors render.mjs: scene D = max(0.2 s, round(dur·30)/30); T[i] = T[i−1] + D[i−1] − transition[i]; total = T[last] + D[last].
// lines: [{ part: 'hook' | 'scene' | 'cta', role, n /* items or bubbles */, hold?, trans /* into this scene, s */, voice: { dur, words: [{ t, d, w }] } }]
// tts(i, rate) → Promise<{ dur, words }> re-synthesises line i at another edge-tts rate (cached by text|voice|rate in spec/tts.mjs).
export const FPS = 30;
const fr = (x) => Math.max(Math.round(FPS * 0.2), Math.round(x * FPS)) / FPS;
// [default, min, max] seconds kept after the voice, per role (same defaults as core.cjs TIME.hold)
export const HOLD = { hook: [0, 0, 0.35], context: [0.15, 0.05, 0.6], point: [0.2, 0.05, 0.7], proof: [0.25, 0.1, 0.8], demo: [0.35, 0.1, 1.0], rehook: [0.1, 0, 0.4], payoff: [0.45, 0.2, 1.0], cta: [0.9, 0.6, 2.2] };
export const LEAD = { hook: 0.05, scene: 0.12, cta: 0.12 };
const MIN = { hook: 1.2, scene: 1.6, cta: 2.4 };
const key = (s) => (s.part === 'hook' ? 'hook' : s.part === 'cta' ? 'cta' : HOLD[s.role] ? s.role : 'point');

export function layout(sc) {
  let t = 0;
  const out = sc.map((s, i) => {
    const lead = LEAD[s.part] ?? LEAD.scene; const items = s.part === 'scene' && s.n ? 1.0 + 0.45 * s.n : 0;
    const D = fr(Math.max(MIN[s.part] ?? MIN.scene, items, (s.voice ? lead + s.voice.dur : 0) + s.hold));
    const T = i ? t - (s.trans || 0) : 0; t = T + D; return { T: +T.toFixed(3), D, lead };
  });
  const h = sc[0]; const lw = h && h.voice && h.voice.words.length ? h.voice.words[h.voice.words.length - 1] : null;
  return { scenes: out, total: +t.toFixed(3), hook_end: lw ? +(out[0].lead + lw.t + lw.d).toFixed(3) : 0, first_word: h && h.voice && h.voice.words[0] ? +(out[0].lead + h.voice.words[0].t).toFixed(3) : null,
    first_cut: out[1] ? +(out[1].T + (sc[1].trans || 0) / 2).toFixed(3) : t };
}

// 1. hook ≤ 3.0 s: re-synthesise ONLY the hook line faster (+6 % steps, max +20 %), never cut words here
// 2. total into aim: holds first (no re-TTS), then the body rate in 4 % steps (−10…+15 %)
// → { ok, L, rates, log } | { ok: false, code: 'E_HOOK_SLOW' | 'E_TOO_LONG' | 'E_TOO_SHORT', msg, L, log }
export async function fit(sc, { tts, rate = 6, min = 30, max = 60, hookMax = 3.0, aim = [32, 57] } = {}) {
  const log = []; const R = (r) => Math.max(-10, Math.min(20, r));
  for (const s of sc) s.hold = s.hold != null ? s.hold : HOLD[key(s)][0];
  let hr = rate; let L = layout(sc);
  while (L.hook_end > hookMax - 0.05 && hr < 20) { hr = R(hr + 6); sc[0].voice = await tts(0, hr); L = layout(sc); log.push('hook rate +' + hr + '% → ' + L.hook_end + 's'); }
  if (L.hook_end > hookMax) return { ok: false, code: 'E_HOOK_SLOW', msg: 'hook is spoken until ' + L.hook_end + ' s even at +' + hr + ' % (max ' + hookMax + ' s) — shorten hook.say', L, log };
  const flex = (dir) => { let moved = 0; for (const s of sc) { const [, lo, hi] = HOLD[key(s)]; const nv = dir > 0 ? Math.min(hi, s.hold + 0.1) : Math.max(lo, s.hold - 0.1); moved += Math.abs(nv - s.hold); s.hold = +nv.toFixed(2); } return moved > 0.001; };
  let br = rate; L = layout(sc);
  for (let k = 0; k < 40 && (L.total > aim[1] || L.total < aim[0]); k++) {
    const dir = L.total > aim[1] ? -1 : 1;
    if (flex(dir)) { L = layout(sc); continue; }
    const nr = Math.max(-10, Math.min(15, br - dir * 4)); if (nr === br) break; br = nr;
    for (let i = 1; i < sc.length; i++) if (sc[i].voice) sc[i].voice = await tts(i, br);
    L = layout(sc); log.push('body rate ' + br + '% → ' + L.total + 's');
  }
  if (L.total > max) return { ok: false, code: 'E_TOO_LONG', msg: 'measured length ' + L.total + ' s after auto-fit (body rate ' + br + ' %) — remove about ' + Math.ceil((L.total - 52) * 2.5) + ' spoken words', L, log };
  if (L.total < min) return { ok: false, code: 'E_TOO_SHORT', msg: 'measured length ' + L.total + ' s after auto-fit — add about ' + Math.ceil((38 - L.total) * 2.5) + ' spoken words', L, log };
  return { ok: true, L, rates: { hook: hr, body: br }, log };
}

// 3. (v1.1, needs music library bpm/beat0) move each cut onto the nearest beat by changing the hold of the scene before it (−0.12…+0.2 s)
export function beatSnap(sc, { bpm, beat0 = 0, seek = 0 } = {}) {
  if (!bpm) return 0; const ib = 60 / bpm; let n = 0;
  for (let i = 0; i < sc.length - 1; i++) {
    const L = layout(sc); const cut = L.scenes[i + 1].T + (sc[i + 1].trans || 0) / 2; const target = Math.round((cut + seek - beat0) / ib) * ib + beat0 - seek;
    const dl = target - cut; const lo = HOLD[key(sc[i])][1];
    if (dl <= 0.2 && dl >= -0.12 && sc[i].hold + dl >= lo) { sc[i].hold = +(sc[i].hold + dl).toFixed(3); n++; }
  }
  return n;
}
