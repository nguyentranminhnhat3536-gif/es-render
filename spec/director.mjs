// es-render spec/director.mjs — the seeded creative decisions of one video (v1: palette, music, captions, transitions, camera).
// Same seed + same recent → same decisions (re-render = same video); another seed ("🔁 Phương án khác") or another recent set → another variant.
// recent = { palettes: [], tracks: [], hooks: [] } newest first, read from the last 12 results/*.json by spec/recent.mjs (CI) — empty in tests.
export function rng(seed) { let h = 1779033703 ^ seed.length; for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; }; }
const MOOD_BY_TYPE = { tool_drop: 'tech', how_to: 'tech', lab_call: 'tech', tip: 'upbeat', list: 'upbeat', myth_fact: 'upbeat', before_after: 'upbeat', story: 'chill' };
// transition INTO a scene, by the layout of that scene (render.mjs knows zoom / whip / whip-up natively; the others are ffmpeg xfade)
const TRANS_BY_LAYOUT = { list_steps: 'whip-up', checklist: 'whip-up', stat: 'zoom', compare: 'zoom', title_card: 'whip', icon_point: 'whip', quote: 'whip', prompt_box: 'smoothleft', chat_mock: 'smoothleft', media: 'smoothleft', cta_card: 'circleopen' };
const CALM = { whip: 'smoothleft', 'whip-up': 'smoothleft', zoom: 'dissolve', circleopen: 'dissolve' };
const CYCLE = ['whip', 'whip-up', 'smoothleft', 'zoom'];

export function direct(spec, { brand, seed, recent = {} }) {
  const r = rng(String(seed || spec.id || 'es')); const lastP = (recent.palettes || [])[0];
  // palette
  let palette = spec.palette && spec.palette !== 'auto' && brand.palettes[spec.palette] ? spec.palette : null;
  if (!palette) { const pool = Object.entries(brand.palettes).filter(([k]) => !(k === lastP && k !== 'neon_pink')); const tot = pool.reduce((a, [, v]) => a + v.weight, 0); let x = r() * tot; palette = pool[pool.length - 1][0]; for (const [k, v] of pool) { x -= v.weight; if (x <= 0) { palette = k; break; } } }
  if (spec.content_type === 'lab_call' && (!spec.palette || spec.palette === 'auto')) palette = 'neon_pink';
  const p = { ...brand.palettes[palette], key: palette };
  // music
  let track = null; const mood = spec.music.mood === 'auto' ? MOOD_BY_TYPE[spec.content_type] || 'upbeat' : spec.music.mood;
  if (mood !== 'none') {
    const pool = brand.music.tracks.filter((t) => t.mood.includes(mood)); const fresh = pool.filter((t) => !(recent.tracks || []).slice(0, 3).includes(t.id));
    const from = fresh.length ? fresh : pool.length ? pool : brand.music.tracks.filter((t) => t.id === brand.music.default); track = from.length ? from[Math.floor(r() * from.length)] : null;
  }
  // captions
  const sub = (v) => (typeof v === 'string' ? v.replace(/\{(ac2|ac|ink)\}/g, (_, k) => p[k]) : v);
  const base = brand.captions[p.caption] || brand.captions.dark; const captions = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, sub(v)]));
  if (spec.captions && spec.captions !== 'auto' && spec.captions !== 'none') captions.style = spec.captions;
  // transitions: into scene i (0 = hook has none; 1 = first body scene = hard cut on the voice, no overlap)
  const lays = [spec.hook.layout, ...spec.scenes.map((s) => s.layout), 'cta_card']; const calm = spec.energy === 'calm'; const trans = [null, null]; let prev = '';
  for (let i = 2; i < lays.length; i++) { let st = TRANS_BY_LAYOUT[lays[i]] || 'whip'; if (st === prev) st = CYCLE[(CYCLE.indexOf(st) + 1 + Math.floor(r() * 3)) % 4]; if (calm) st = CALM[st] || st; prev = st; trans.push({ style: st, duration: calm ? 0.3 : 0.24 }); }
  return { palette, p, track, mood, captions: spec.captions === 'none' ? null : captions, trans, creative: { level: calm ? 'subtle' : 'bold', transitions: 'keep', camera: true, beats: true, look: 'none' } };
}
