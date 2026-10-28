#!/usr/bin/env node
// es-render spec/run.mjs — what render.yml calls for a spec job (jobs/<id>.json with kind "spec"):
//   node spec/run.mjs jobs/<id>.json out        → out/<id>.mp4 + out/<id>.cover*.jpg + out/<id>.result.json (ALWAYS written, even when something crashes)
//   exit 0 = a valid outcome (done / rejected / non-retryable error) · exit 75 = transient infrastructure failure (TTS, network, Chromium) → render.yml tries once more
// validate (same core.cjs as n8n) → TTS per line → exact fit → compile → render.mjs (child process, unchanged engine) → cover.mjs → QA check + standard → outcome.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ESC from './core.cjs';
import { compile } from './compile.mjs';
import { makeSfx } from './sfx.mjs';
import { outcome } from './outcome.mjs';
import { check as qaCheck } from '../qa.mjs';
import { standard } from '../qa-standard.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [jobArg, outArg = 'out'] = process.argv.slice(2);
if (!jobArg) { console.error('usage: node spec/run.mjs jobs/<id>.json [out]'); process.exit(2); }
const jobFile = path.resolve(jobArg); const outDir = path.resolve(outArg); fs.mkdirSync(outDir, { recursive: true });
const id = path.basename(jobFile, '.json').replace(/[^\w.-]/g, '_'); const resFile = path.join(outDir, id + '.result.json');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const write = (o) => fs.writeFileSync(resFile, JSON.stringify(o, null, 1));
const TRANSIENT = /tts|edge|ECONN|ETIMEDOUT|ENOTFOUND|fetch failed|socket|download|chrom|browser|playwright|ffmpeg .* killed/i;

// variety memory: palettes / music / hook types of the last 12 finished spec videos (results/ is checked out with the repo)
function recent() {
  try { const dir = path.join(ROOT, 'results'); const rs = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return null; } })
    .filter((r) => r && r.kind === 'spec' && r.creative).sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at))).slice(0, 12);
    return { palettes: rs.map((r) => r.creative.palette), tracks: rs.map((r) => r.creative.music), hooks: rs.map((r) => r.creative.hook_type) }; } catch (e) { return {}; }
}
const sh = (args, env = {}) => { const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } }); return r.status === 0; };

let job = {}; let base = { id, kind: 'spec' };
async function main() {
  const t0 = Date.now(); job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  const meta = job.meta || {}; const attempt = Number(meta.attempt) || 1; const max = Number(meta.max_attempts) || 3;
  base = { id, kind: 'spec', spec_hash: job.spec_hash || '', core: ESC.CORE, spec_core: job.core || '', attempt, max_attempts: max, ...(job.client ? { client: job.client } : {}) };
  const stale = job.core && Number(String(job.core).split('.')[1]) < Number(ESC.CORE.split('.')[1]) ? [{ code: 'W_CORE_STALE', path: '/', msg: 'the n8n node was generated from core ' + job.core + ', CI runs ' + ESC.CORE + ' — paste the new bundle', vi: 'node n8n cũ — dán lại bộ node mới' }] : [];
  // 1. validate with the SAME library (attempt/max → the last attempt may be salvaged here too; CI never salvages silently on earlier attempts)
  // facts: luôn là mảng (job.meta.facts từ node 1) — facts == null thì core nhận mọi FACTS#n (K4)
  const facts = Array.isArray(meta.facts) ? meta.facts.map(String) : typeof meta.facts === 'string' ? meta.facts : [];
  const r = ESC.check(job.spec, { attempt, max, id, ci: true, facts });
  if (!r.ok) { const res = { ...base, status: 'rejected', stage: 'validate', errors: r.errors, warnings: [...stale, ...r.warnings], feedback: r.feedback, finished_at: new Date().toISOString() }; write({ ...res, ...outcome(res, { attempt, max_attempts: max }) }); log('rejected (validate):', r.errors.map((e) => e.code).join(' ')); return 0; }
  const spec = r.spec;
  // file:// media (the owner's own clips) is for es-editor only (job.options.allow_local); a spec from n8n / the AI never reads local files on the runner
  if (!(job.options && job.options.allow_local)) for (const sc of [spec.hook, ...spec.scenes]) if (sc.visual) { const local = (u) => /^file:/i.test(String(u || '')); if (local(sc.visual.src) || (sc.visual.shots || []).some((q) => local(q.src))) { delete sc.visual.src; delete sc.visual.shots; if (!sc.visual.prompt) { delete sc.visual; sc.layout = 'title_card'; } stale.push({ code: 'W_LOCAL_SRC', path: '/', msg: 'file:// media is not allowed in this job → code layout', vi: 'không dùng file cục bộ trong job này' }); } }
  const brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'brand', (spec.brand || 'ethan-studio') + '.json'), 'utf8'));
  const work = fs.mkdtempSync(path.join(outDir, '.work-')); const fontsUrl = 'file://' + path.join(ROOT, brand.fonts.dir);
  // 2. TTS + exact timing + compile (nothing is drawn yet)
  const c = await compile(spec, { id, hash: job.spec_hash || r.hash, brand, fontsUrl, ttsDir: path.join(work, 'tts'), sfx: makeSfx(path.join(work, 'sfx'), { lib: path.join(ROOT, 'assets', 'sfx') }), recent: recent(),
    musicSrc: process.env.SPEC_MUSIC_SRC !== undefined ? process.env.SPEC_MUSIC_SRC || null : undefined });
  if (!c.ok) { const res = { ...base, status: 'rejected', stage: c.stage, errors: c.errors, warnings: [...stale, ...r.warnings], feedback: ESC.feedback({ errors: c.errors }), timing: { log: c.log }, finished_at: new Date().toISOString() }; write({ ...res, ...outcome(res, { attempt, max_attempts: max }) }); log('rejected (' + c.stage + '):', c.errors.map((e) => e.msg).join('; ')); return 0; }
  // 3. render with the unchanged engine
  const cdir = path.join(outDir, 'compiled'); fs.mkdirSync(cdir, { recursive: true }); const cfile = path.join(cdir, id + '.json');
  fs.writeFileSync(cfile, JSON.stringify({ id, movie: c.movie }));
  if (!sh([path.join(ROOT, 'render.mjs'), cfile, outDir], { ES_PRESYNTH_DIR: work })) throw new Error('render.mjs failed');
  let res = JSON.parse(fs.readFileSync(resFile, 'utf8')); if (res.status !== 'done') throw new Error(res.message || 'render failed');
  // 4. cover (designed from the hook composition; frame grab if the page fails), then QA
  if (!sh([path.join(ROOT, 'cover.mjs'), cfile, outDir])) log('cover.mjs failed → no designed cover'); res = JSON.parse(fs.readFileSync(resFile, 'utf8'));
  res.hook = c.report.hook;
  const mp4 = path.join(outDir, id + '.mp4'); const opt = { width: 1080, height: 1920, speech: true, needAudio: true };
  let qa = await qaCheck(mp4, { ...opt, duration: res.duration, scenes: res.scenes });
  if (!qa.pass) { // glitch (black frames, flicker, hitch): one safe re-render — no camera / beats / motion transitions — keep the better file
    const safe = { ...c.movie, creative: { ...c.movie.creative, level: 'subtle', camera: false, beats: false }, scenes: c.movie.scenes.map((s) => { const { transition, ...rest } = s; return rest; }) };
    const sdir = path.join(work, 'safe'); fs.mkdirSync(sdir, { recursive: true }); const sf = path.join(sdir, id + '.json'); fs.writeFileSync(sf, JSON.stringify({ id, movie: safe }));
    if (sh([path.join(ROOT, 'render.mjs'), sf, sdir], { ES_PRESYNTH_DIR: work })) { const r2 = JSON.parse(fs.readFileSync(path.join(sdir, id + '.result.json'), 'utf8')); const q2 = await qaCheck(path.join(sdir, id + '.mp4'), { ...opt, scenes: r2.scenes });
      if (q2.pass || q2.score > qa.score) { fs.copyFileSync(path.join(sdir, id + '.mp4'), mp4); res = { ...res, ...r2, cover: res.cover, hook: res.hook }; qa = { ...q2, retried: true }; } }
  }
  const std = await standard(mp4, res, { outDir });
  res = { ...res, ...base, status: 'done', title: spec.title, spec, hook: { ...c.report.hook, voice_end: (res.voice_track || []).find((v) => v.scene === 0)?.end ?? c.report.hook.voice_end }, timing: c.report.timing, creative: c.report.creative,
    qa, standard: std, warnings: [...stale, ...r.warnings], fixes: r.fixes, salvaged: r.salvaged || null, review: !!r.review,
    post_hint: { hook: spec.hook.say, headline: spec.hook.text, promise: spec.promise, cover_title: spec.cover.title, topic: spec.topic }, render_total_seconds: Math.round((Date.now() - t0) / 1000), finished_at: new Date().toISOString() };
  Object.assign(res, outcome(res, { attempt, max_attempts: max, review: !!r.review })); res.post_ok = res.publishable;
  write(res); fs.rmSync(work, { recursive: true, force: true }); log('done', id, res.duration + 's', 'outcome', res.outcome, '| hook', res.hook.voice_end + 's | QA', qa.score + '/10 | standard', std.pass ? 'pass' : 'FAIL ' + std.failed.join(','));
  return 0;
}
main().then((rc) => process.exit(rc)).catch((e) => {
  console.error(e); const msg = String((e && e.message) || e).slice(0, 1500); const retryable = TRANSIENT.test(msg);
  const res = { ...base, status: 'error', message: msg, retryable, finished_at: new Date().toISOString() }; try { write({ ...res, ...outcome(res) }); } catch (e2) { /* disk */ }
  process.exit(retryable ? 75 : 0);
});
