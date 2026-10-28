// es-render spec/sfx.mjs — sound effects synthesised with ffmpeg (no downloads, deterministic) + the SFX grammar with density caps.
// DEF = the table of es-editor editor/sfx.mjs (peak = seconds to the "hit" so render.mjs can punch the camera exactly there).
// Override per kind with CC0 files: assets/sfx/<kind>[-n].wav|mp3 (peak measured from the loudest 10 ms).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const N = '(2*random(0)-1)';
export const DEF = {
  whoosh: { d: 0.7, peak: 0.33, src: 'anoisesrc=d=0.7:c=pink:a=0.7:r=48000', af: 'highpass=f=280,lowpass=f=2800,afade=t=in:d=0.32:curve=exp,afade=t=out:st=0.34:d=0.36:curve=exp,volume=9dB' },
  swish: { d: 0.4, peak: 0.17, src: 'anoisesrc=d=0.4:c=white:a=0.45:r=48000', af: 'highpass=f=900,lowpass=f=6000,afade=t=in:d=0.16,afade=t=out:st=0.18:d=0.22,volume=4dB' },
  pop: { d: 0.18, peak: 0.01, expr: '0.8*sin(2*PI*(650+900*exp(-30*t))*t)*exp(-28*t)' },
  boom: { d: 1.3, peak: 0.03, expr: '0.95*sin(2*PI*(42+95*exp(-9*t))*t)*exp(-3.2*t)', af: 'lowpass=f=260' },
  hit: { d: 1.2, peak: 0.02, expr: '0.8*sin(2*PI*(48+130*exp(-12*t))*t)*exp(-3*t)+0.45*' + N + '*exp(-16*t)', af: 'lowpass=f=5000' },
  ding: { d: 1.4, peak: 0.01, expr: '0.33*(sin(2*PI*1318.5*t)+0.5*sin(2*PI*2637*t)+0.25*sin(2*PI*3955.5*t))*exp(-3.4*t)*min(1,t*400)' },
  click: { d: 0.06, peak: 0, expr: '0.9*' + N + '*exp(-260*t)', af: 'highpass=f=1500' },
  riser: { d: 1.6, peak: 1.55, expr: '0.38*sin(2*PI*(180*t+650*t*t))*pow(t/1.6,2)+0.22*' + N + '*pow(t/1.6,3)', af: 'highpass=f=140,afade=t=out:st=1.5:d=0.1' },
  glitch: { d: 0.35, peak: 0.05, expr: '0.35*sgn(sin(2*PI*180*t))*gt(sin(2*PI*23*t),0)+0.25*' + N + '*gt(sin(2*PI*31*t),0.3)' },
  type: { d: 0.75, peak: 0, expr: '0.6*' + N + '*exp(-300*mod(t,0.085))*lt(mod(t,0.085),0.03)', af: 'highpass=f=2200' },
};
export function makeSfx(dir, { lib = '' } = {}) {
  fs.mkdirSync(dir, { recursive: true }); const out = {};
  for (const [k, d] of Object.entries(DEF)) {
    const own = lib && fs.existsSync(lib) ? fs.readdirSync(lib).find((f) => f.toLowerCase().replace(/\.(wav|mp3)$/, '').replace(/[-_ .]*\d+$/, '') === k) : '';
    if (own) { out[k] = { file: path.join(lib, own), peak: 0.02, d: d.d }; continue; } // peak of own files: measured by the caller if it matters
    const file = path.join(dir, 'sfx_' + k + '.wav'); const src = d.src ? ['-f', 'lavfi', '-i', d.src] : ['-f', 'lavfi', '-i', "aevalsrc='" + d.expr + "':s=48000:d=" + d.d];
    execFileSync(FFMPEG, ['-y', '-v', 'error', ...src, '-af', (d.af ? d.af + ',' : '') + 'alimiter=limit=0.9:level=disabled', '-ac', '2', '-ar', '48000', file]);
    out[k] = { file, peak: d.peak, d: d.d };
  }
  return out;
}
// SFX grammar: layout events → sounds. Priority hit > whoosh > ding > riser > pop > click > type; ≥ 0.18 s between two sounds, ≤ 3 per 2 s window, ≤ 0.8 per second overall.
const VOL = { hit: 0.45, boom: 0.3, whoosh: 0.32, ding: 0.38, riser: 0.25, pop: 0.28, click: 0.25, type: 0.2, glitch: 0.25, swish: 0.3 };
const PRI = { hit: 7, boom: 7, whoosh: 6, ding: 5, riser: 4, pop: 3, click: 2, type: 1, glitch: 3, swish: 3 };
export function place(events, { density = 'normal', total = 45 } = {}) {
  // events: [{ g /* global second of the PEAK */, kind, stop?, scene }] → kept events (caps applied)
  const k = density === 'low' ? 0.5 : 1; const max = Math.floor(total * 0.8 * k);
  const sorted = [...events].sort((a, b) => (PRI[b.kind] || 0) - (PRI[a.kind] || 0) || a.g - b.g); const kept = [];
  for (const e of sorted) {
    if (kept.length >= max) break;
    if (kept.some((x) => Math.abs(x.g - e.g) < 0.18)) continue;
    if (kept.filter((x) => x.g > e.g - 2 && x.g <= e.g + 2).length >= 3 * k + 0.001) continue;
    kept.push(e);
  }
  return kept.sort((a, b) => a.g - b.g).map((e) => ({ ...e, vol: VOL[e.kind] || 0.3 }));
}
