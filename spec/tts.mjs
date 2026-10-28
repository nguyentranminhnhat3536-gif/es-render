// es-render spec/tts.mjs — one TTS file per spoken line: <dir>/<sha1>.mp3 + <sha1>.words.json (the exact pair render.mjs reads for a pre-synthesised voice element).
// real: the existing tts.py (edge-tts 7.3.1, 4 retries per line). SPEC_FAKE_TTS=1: silent mp3 + evenly spaced words at the estimator speed (tests, no network).
//   makeTts({ dir, voice /* full edge-tts name */, fake }) → async (text, rate /* % */) → { file, dur, words: [{ t, d, w }] }
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const FFMPEG = process.env.FFMPEG || 'ffmpeg'; const FFPROBE = process.env.FFPROBE || 'ffprobe'; const PY = process.env.PYTHON || 'python3';
const HERE = path.dirname(new URL(import.meta.url).pathname); const TTS_PY = process.env.TTS_PY || path.join(HERE, '..', 'tts.py');
const probeDur = (f) => Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim()) || 0;

export function makeTts({ dir, voice = 'en-US-AndrewMultilingualNeural', fake = !!process.env.SPEC_FAKE_TTS, wps = 2.48, k = 1 } = {}) {
  fs.mkdirSync(dir, { recursive: true }); const memo = new Map();
  return async (text, rate = 0) => {
    const key = crypto.createHash('sha1').update([voice, rate, text].join('|')).digest('hex').slice(0, 12); const base = path.join(dir, key);
    if (!memo.has(key)) {
      if (!fs.existsSync(base + '.mp3') || !fs.existsSync(base + '.words.json')) {
        if (fake) {
          const ws = String(text).split(/\s+/).filter(Boolean); const sp = wps * k * (1 + rate / 100); let t = 0.09;
          const words = ws.map((w) => { const o = { t: +t.toFixed(3), d: +(0.85 / sp).toFixed(3), w }; t += 1 / sp; return o; });
          // speech-like band-passed noise (−24 dBFS) so QA sees audio, not silence; the words' timing is what the tests care about
          execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anoisesrc=d=' + +(t + 0.09).toFixed(3) + ':c=pink:a=0.25:r=24000', '-af', 'bandpass=f=1400:width_type=h:w=2200,volume=-6dB,afade=t=in:d=0.08,afade=t=out:st=' + Math.max(0, +(t - 0.05).toFixed(3)) + ':d=0.14', '-c:a', 'libmp3lame', '-b:a', '48k', base + '.mp3']);
          fs.writeFileSync(base + '.words.json', JSON.stringify(words));
        } else {
          const job = path.join(dir, key + '.job.json'); fs.writeFileSync(job, JSON.stringify([{ text, voice, rate: (rate >= 0 ? '+' : '') + rate + '%', out: base }]));
          execFileSync(PY, [TTS_PY, job], { stdio: ['ignore', 'inherit', 'inherit'] }); fs.rmSync(job, { force: true });
        }
      }
      memo.set(key, { file: base + '.mp3', dur: +probeDur(base + '.mp3').toFixed(3), words: JSON.parse(fs.readFileSync(base + '.words.json', 'utf8')) });
    }
    return memo.get(key);
  };
}
