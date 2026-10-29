// es-render spec/compile.mjs — CreativeSpec (validated, normalised) + real TTS timings → an ordinary movie JSON that the UNCHANGED render.mjs renders
// (plus the 5 additive render.mjs changes: pre-synthesised voice, ES.ready, music seek, voice_track, vendored fonts).
//   compile(spec, { id, hash, brand, tts, sfx, ttsDir, fontsUrl, musicSrc?, recent?, assets?, fps? }) → { ok: true, movie, report } | { ok: false, stage: 'timing', errors: [...] }
import ESC from './core.cjs';
import { fit } from './timing.mjs';
import { direct } from './director.mjs';
import { TEMPLATES, background, coverPage } from './layouts.mjs';
import { place } from './sfx.mjs';
import { makeTts } from './tts.mjs';

const r3 = (x) => Math.round(x * 1000) / 1000;
const SFX_CUE = { hit: 'hit', riser: 'riser', pop: 'pop', ding: 'ding' };
const roleTag = (part, line) => (part === 'hook' ? 'hook' : part === 'cta' ? 'offer' : ['list_steps', 'checklist', 'stat'].includes(line.layout) ? 'item' : 'feature');

export async function compile(spec, o) {
  const { id, brand, fontsUrl, ttsDir } = o; const W = 1080; const H = 1920; const FPS = o.fps || 30;
  const voiceName = ESC.VOICES[spec.voice.id]; const tts = o.tts || makeTts({ dir: ttsDir, voice: voiceName });
  const seed = spec.seed || o.hash || id; const D = direct(spec, { brand, seed, recent: o.recent || {} });
  const lines = [{ part: 'hook', line: spec.hook }, ...spec.scenes.map((line) => ({ part: 'scene', line })), { part: 'cta', line: spec.cta }];
  // 1. one TTS file per line at the spec rate
  const sc = []; for (let i = 0; i < lines.length; i++) { const { part, line } = lines[i]; const voice = await tts(line.say, spec.voice.rate);
    sc.push({ part, role: part === 'scene' ? line.role : part, n: (line.items || line.bubbles || []).length, hold: line.hold, trans: D.trans[i] ? D.trans[i].duration : 0, voice, say: line.say }); }
  // 2. exact fit (hook ≤ 3.0 s by re-synthesising ONLY the hook faster; total into 32–57 s by holds, then body rate) — before any frame is drawn
  const f = await fit(sc, { tts: (i, rate) => tts(sc[i].say, rate), rate: spec.voice.rate });
  if (!f.ok) return { ok: false, stage: 'timing', errors: [{ code: f.code, path: f.code === 'E_HOOK_SLOW' ? '/hook/say' : '/', msg: f.msg + ' (measured)', vi: f.vi ? f.vi + ' (đo thật)' : undefined, measured: true }], log: f.log, L: f.L };
  const L = f.L; const p = D.p; const n = lines.length; const bgHtml = (T) => background({ p, G: T, W, H, brand, fontsUrl });

  // 3. scenes
  const scenes = []; const ev = []; // ev: SFX candidates with the GLOBAL second of their peak
  for (let i = 0; i < n; i++) {
    const { part, line } = lines[i]; const { T, D: Ds, lead } = L.scenes[i]; const lay = ESC.LAYOUTS[line.layout] || ESC.LAYOUTS[part === 'hook' ? 'hook_kinetic' : part === 'cta' ? 'cta_card' : 'title_card'];
    const slots = { ...line, kicker: part === 'hook' ? spec.cover.kicker : undefined, iconChar: line.icon ? ESC.ICONS[line.icon] || line.icon : undefined, action: part === 'cta' ? spec.cta.action : undefined, keyword: spec.cta.keyword };
    const words = sc[i].voice.words.map((w) => ({ ...w, t: r3(w.t + lead) }));
    const tpl = TEMPLATES[lay.tpl] || TEMPLATES.title_card; const out = tpl({ s: slots, words, D: Ds, G: T, p, variant: lay.variant, brand, fontsUrl, W, H });
    const rate = i === 0 ? f.rates.hook : f.rates.body;
    const elements = [
      { type: 'html', html: bgHtml(T), x: 0, y: 0, width: W, height: H, 'z-index': -20 },
      { type: 'html', html: out.html, libs: out.libs, x: out.box.x, y: out.box.y, width: out.box.w, height: out.box.h, 'z-index': 5 },
      { type: 'voice', text: line.say, voice: voiceName, speed: r3(1 + rate / 100), start: r3(lead), src: 'file://' + sc[i].voice.file }];
    if (lay.tpl === 'media' && slots.visual && slots.visual.shots) { // the owner's own clips under the voice-over (editor/voiceover.mjs assigned the shots); shots shorter than the fitted scene are cycled
      let at = 0; const shots = slots.visual.shots;
      for (let k = 0; at < Ds - 0.05 && k < 24; k++) { const sh = shots[k % shots.length]; const d = Math.min(sh.out - sh.in, Ds - at); elements.unshift({ type: 'video', src: sh.src, seek: r3(sh.in), duration: r3(d), start: r3(at), x: 0, y: 0, width: W, height: H, fit: slots.visual.fit || 'cover', muted: true, 'z-index': 0 }); at += d; }
    }
    for (const e of out.events) ev.push({ g: r3(T + e.t), kind: e.kind, stop: !!e.stop, scene: i });
    if (SFX_CUE[line.sfx_cue]) ev.push({ g: r3(T + lead + 0.02), kind: SFX_CUE[line.sfx_cue], scene: i }); // core 1.1 sfx_cue (cùng bảng với es-editor make.mjs); giới hạn mật độ vẫn áp dụng
    if (i >= 2 && D.trans[i] && /^(whip|whip-up|zoom|smoothleft|circleopen)$/.test(D.trans[i].style)) ev.push({ g: r3(T + D.trans[i].duration / 2), kind: 'whoosh', scene: i }); // whoosh peaks on the cut
    scenes.push({ comment: 's' + String(i + 1).padStart(2, '0') + ' ' + roleTag(part, line) + ' · ' + line.layout + (part === 'scene' ? ' [' + line.role + ']' : ''), 'background-color': p.bg, duration: Ds,
      ...(D.trans[i] ? { transition: { style: D.trans[i].style, duration: D.trans[i].duration } } : {}), elements, _out: out, _T: T });
  }
  // 4. SFX with caps; each sound goes into the scene that contains its PEAK (render.mjs punches the camera there), start may be negative (global start ≥ 0)
  const kept = place(ev, { density: spec.energy === 'calm' ? 'low' : 'normal', total: L.total }); let nsfx = 0;
  for (const e of kept) {
    const def = o.sfx[e.kind]; if (!def) continue; let j = 0; for (let i = 0; i < n; i++) if (L.scenes[i].T <= e.g + 1e-6) j = i;
    const start = Math.max(-L.scenes[j].T, r3(e.g - def.peak - L.scenes[j].T)); nsfx++;
    scenes[j].elements.push({ type: 'audio', src: 'file://' + def.file, start, duration: def.d, volume: e.vol, spill: true, comment: 'sfx ' + e.kind + ' peakAt=' + def.peak + (e.stop ? ' stop' : '') });
  }
  // 5. movie-level: music, captions, creative; cover pages
  const elements = [];
  const musicSrc = o.musicSrc !== undefined ? o.musicSrc : D.track && D.track.url;
  if (musicSrc) elements.push({ type: 'audio', src: musicSrc, volume: spec.music.volume, 'fade-out': 0.8, ...(D.track && D.track.hook_in ? { seek: D.track.hook_in } : {}) });
  if (D.captions) elements.push({ type: 'subtitles', language: spec.lang, settings: { ...D.captions, keywords: spec.keywords, hide: [] } });
  const hookTpl = ESC.LAYOUTS[spec.hook.layout]; const cslots = (title, emp) => ({ ...spec.hook, text: title, emphasis: emp ? [emp] : [], kicker: spec.cover.kicker, sub: spec.hook.sub });
  const cctx = { p, W, H, brand, fontsUrl, hookLayout: hookTpl ? hookTpl.tpl : 'hook_kinetic' };
  const thumbT = Math.max(0.2, Math.min(scenes[0]._out.thumbT || 1.0, (L.scenes[1] ? L.scenes[1].T : L.total) - 0.1));
  const cover = { title: spec.cover.title, style: 'hook_' + (spec.hook.hook_type || 'kinetic'), thumb_t: r3(thumbT), html: coverPage(cctx, cslots(spec.cover.title, spec.cover.emphasis)),
    ...(spec.cover.alt_title ? { alt_title: spec.cover.alt_title, alt_html: coverPage(cctx, cslots(spec.cover.alt_title, '')) } : {}) };
  const sc0box = scenes[0] && scenes[0]._out ? scenes[0]._out.box : null;
  for (const s of scenes) { delete s._out; delete s._T; }
  const movie = { width: W, height: H, 'client-data': { spec: ESC.VERSION, core: ESC.CORE, spec_hash: o.hash || '', tid: (spec.id || '').split('-').slice(0, 2).join('-') },
    creative: { ...D.creative, seed: String(seed), subtitles: D.captions ? D.captions.style : '' }, elements, scenes, cover };
  // vùng tiêu đề hook cho QA S4b (đọc được ở khung 0): hộp của layout hook, bỏ dải phụ đề (brand.safe.caption_band) — màu chữ / nền của palette
  const hb = sc0box; const band = (brand.safe && brand.safe.caption_band) || [1330, 1460];
  const box = hb ? { x: hb.x, y: hb.y, w: hb.w, h: Math.max(60, Math.min(hb.y + hb.h, band[0]) - hb.y) } : null;
  const report = { hook: { box, ink: p.ink, accent: p.ac, bg: p.bg, type: spec.hook.hook_type, layout: spec.hook.layout, headline: spec.hook.text, voice_start: r3(L.scenes[0].lead + (sc[0].voice.words[0] ? sc[0].voice.words[0].t : 0)), voice_end: L.hook_end, first_cut: L.first_cut, rate: f.rates.hook },
    timing: { estimate: ESC.estimate(spec).total, after_tts: L.total, rates: f.rates, log: f.log }, creative: { palette: D.palette, music: D.track ? D.track.id : null, captions: D.captions ? D.captions.style : 'none', seed: String(seed),
      layouts: [spec.hook.layout, ...spec.scenes.map((s) => s.layout), 'cta_card'], transitions: D.trans.map((t) => (t ? t.style : 'cut')), sfx: nsfx, hook_type: spec.hook.hook_type, content_type: spec.content_type }, scenes: L.scenes };
  return { ok: true, movie, report, L };
}
