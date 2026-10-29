// es-render spec/layouts.mjs — the v1 layout kit: 10 templates (+ variants) that turn the slots of a CreativeSpec line into HTML for render.mjs.
//   template(ctx) → { html, libs: ['gsap'], events: [{ t, kind }], box: { x, y, w, h }, thumbT?, beats }
//   ctx: { s /* the spec line */, words /* TTS words, scene-relative, lead included */, D /* scene seconds */, G /* global start of the scene */,
//          p /* palette */, variant, W, H, cover /* true when drawing the cover */, brand, fontsUrl /* file:// dir of the vendored fonts */ }
// Rules every template obeys (checked by test/layouts.test.mjs and by QA S4/S5/S12/S13):
//   · ALL text goes through esc() — the AI can never inject markup; no <script> except our own GSAP timeline;
//   · hook templates are COMPLETE and opaque at t = 0 (frame-0 contract), only a 0.18 s settle moves;
//   · content stays inside y 230–1300 (captions band y 1330–1460 and the platform UI stay free);
//   · motion lives in ONE paused GSAP timeline seeked by ES.onSeek (render.mjs virtual clock) → frame-exact and deterministic.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (w) => String(w || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// identical prefix on every html element of the video → render.mjs sharedHead() loads it once per scene page
export function head(brand, fontsUrl) {
  const F = brand.fonts; const ff = (family, w, file, style = 'normal') => '@font-face{font-family:"' + family + '";font-weight:' + w + ';font-style:' + style + ';src:url(' + fontsUrl + '/' + file + ') format("truetype")}';
  return '<style>' + Object.entries(F.display.files).map(([w, f]) => ff(F.display.family, w, f)).join('') + ff(F.accent.family, 400, F.accent.file, 'italic') + Object.entries(F.mono.files).map(([w, f]) => ff(F.mono.family, w, f)).join('')
    + '*{box-sizing:border-box;margin:0;padding:0}body{font-family:"Inter Tight",sans-serif;-webkit-font-smoothing:antialiased}'
    + '.es{position:relative;color:var(--ink)}.hd{font-weight:900;letter-spacing:-.035em;line-height:.95}.fitl{white-space:nowrap}'
    + '.em{font-family:"Instrument Serif",serif;font-style:italic;font-weight:400;letter-spacing:0;color:var(--ac2);text-shadow:0 0 18px rgba(var(--glow),.85),0 0 46px rgba(var(--glow),.45)}'
    + '.chip{display:inline-block;font-weight:800;font-size:30px;letter-spacing:.32em;text-transform:uppercase;color:var(--ac2);padding:12px 26px 12px 34px;border:2px solid rgba(var(--glow),.55);border-radius:999px;background:rgba(var(--glow),.08)}'
    + '.card{background:rgba(255,255,255,.075);border:2px solid rgba(var(--glow),.40);border-radius:34px;box-shadow:0 30px 80px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.04) inset}'
    + '.mono{font-family:"JetBrains Mono",monospace;font-weight:500}.sub{font-weight:700;color:var(--muted);line-height:1.2}'
    + '@keyframes esdrift{0%{transform:translate3d(-4%,0,0) scale(1.05)}50%{transform:translate3d(3%,-2%,0) scale(1.1)}100%{transform:translate3d(-4%,0,0) scale(1.05)}}'
    + '</style>';
}
const vars = (p) => Object.entries({ bg: p.bg, bg2: p.bg2, ac: p.ac, ac2: p.ac2, glow: p.glow, ink: p.ink, muted: p.muted }).map(([k, v]) => '--' + k + ':' + v).join(';');
const light = (p) => p.caption === 'light';

// ambient world, continuous across cuts (negative animation-delay = global time of the scene start)
export function background(ctx) {
  const { p, G = 0, W = 1080, H = 1920 } = ctx; const d = (s) => '-' + (G + s).toFixed(2) + 's';
  const wave = (top, op, c1, c2, dur, off, id) => '<svg width="1404" height="806" viewBox="0 0 1080 806" preserveAspectRatio="none" style="position:absolute;left:-162px;top:' + top + 'px;opacity:' + op + ';filter:blur(16px);animation:esdrift ' + dur + 's ease-in-out ' + d(off) + ' infinite both">'
    + '<defs><linearGradient id="g' + id + '" x1="0" x2="1"><stop offset="0" stop-color="' + c1 + '" stop-opacity="0"/><stop offset=".45" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient></defs>'
    + '<path d="M0 443 C 270 218, 594 669, 1080 363 L 1080 806 L 0 806 Z" fill="url(#g' + id + ')"/></svg>';
  return head(ctx.brand, ctx.fontsUrl) + '<div class="es" style="' + vars(p) + ';width:' + W + 'px;height:' + H + 'px;overflow:hidden;background:radial-gradient(ellipse 980px 680px at 50% 8%,rgba(var(--glow),.26) 0%,rgba(var(--glow),0) 100%),linear-gradient(180deg,var(--bg2) 0%,var(--bg) 52%,var(--bg2) 100%)">'
    + wave(1300, light(p) ? 0.35 : 0.8, p.w1, p.w2, 9, 0, 1) + wave(1420, light(p) ? 0.25 : 0.5, p.w2, p.w1, 12, 3, 2)
    + '<div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 55%,rgba(' + (light(p) ? '120,40,90,.12' : '0,0,0,.42') + ') 100%)"></div></div>';
}

// ---------- helpers ----------
// seconds (scene-relative) at which each item is first spoken: first ≥ 3-letter token of the item found in order in the TTS words; the rest are spread evenly
export function anchors(items, words, D, { from = 0.35, to = 0.82 } = {}) {
  let j0 = 0; const t = items.map((it) => { const toks = String(it).split(/\s+/).map(norm).filter((x) => x.length >= 3);
    for (const tk of toks) for (let j = j0; j < words.length; j++) if (norm(words[j].w).startsWith(tk.slice(0, 4))) { j0 = j + 1; return Math.max(0.12, words[j].t - 0.05); } return null; });
  const lo = Math.max(from, (words[0]?.t ?? 0.2)); const hi = Math.max(lo + 0.3, Math.min(D - 0.6, (words.length ? words[words.length - 1].t : D * to)));
  return t.map((v, i) => (v != null ? v : lo + ((hi - lo) * i) / Math.max(1, items.length - 1 || 1)));
}
const spokenAt = (word, words) => { const k = norm(word); const w = words.find((x) => norm(x.w) === k || (k.length >= 4 && norm(x.w).startsWith(k.slice(0, 4)))); return w ? w.t : null; };
// headline: ≤ 11 characters per line, ≤ 3 lines; the emphasis word in accent serif italic with an underline that swipes on its spoken time
function headline(text, emphasis, { size = 200, min = 130, maxw = 860 } = {}) {
  const ws = String(text).split(/\s+/).filter(Boolean); const lines = [[]];
  for (const w of ws) { const cur = lines[lines.length - 1]; if (cur.length && (cur.join(' ') + ' ' + w).length > 11) lines.push([w]); else cur.push(w); }
  const longest = Math.max(...lines.map((l) => l.join(' ').length)); const fs = Math.round(Math.max(min, Math.min(size, maxw / (longest * 0.5))));
  const isEm = (w) => (emphasis || []).some((e) => norm(e) && norm(w) === norm(e));
  return { fs, lines: lines.length, html: '<div class="hl" style="text-align:left">' + lines.map((l) => '<div class="hd fitl" style="font-size:' + fs + 'px">' + l.map((w) => isEm(w)
    ? '<span class="em" style="font-size:1.1em;position:relative;display:inline-block">' + esc(w) + '<i class="ul" style="position:absolute;left:4%;right:4%;bottom:-.02em;height:.07em;border-radius:.04em;background:var(--ac);transform:scaleX(0);transform-origin:left;display:block"></i></span>'
    : '<span>' + esc(w) + '</span>').join(' ') + '</div>').join('') + '</div>' };
}
const FIT = 'document.fonts.ready.then(()=>{q(".fitl").forEach((el)=>{let f=parseFloat(getComputedStyle(el).fontSize);for(let i=0;i<16&&el.scrollWidth>el.clientWidth+1;i++){f*=.94;el.style.fontSize=f+"px"}});tl.seek(ES.time,false)});';
const tlWrap = (body, fit = true) => '<script>(()=>{const R=document.currentScript.parentElement;const q=(s)=>R.querySelectorAll(s);const tl=gsap.timeline({paused:true});' + body + 'tl.seek(0,false);ES.onSeek.push((t)=>tl.seek(Math.max(0,t),false));' + (fit ? FIT : '') + '})()</script>';
const root = (ctx, w, h, inner, style = '') => head(ctx.brand, ctx.fontsUrl) + '<div class="es" style="' + vars(ctx.p) + ';width:' + w + 'px;height:' + h + 'px;' + style + '">' + inner;
const em0 = (ctx) => ctx.cover ? 0 : null; // cover: every reveal is complete
const kick = (s) => (s.kicker ? '<div class="chip" style="margin:0 0 40px 0">' + esc(s.kicker) + '</div>' : '');
// title block for body scenes: heading words rise (staggered), the emphasis word in accent serif
const words = (text, emphasis, cls = '') => String(text).split(/\s+/).filter(Boolean).map((w) => ((emphasis || []).some((e) => norm(e) === norm(w)) ? '<span class="em w" style="display:inline-block;font-size:1.08em">' + esc(w) + '</span>' : '<span class="w" style="display:inline-block">' + esc(w) + '</span>')).join(' ');
const sizeFor = (t, big, small, ref = 14) => Math.round(Math.max(small, Math.min(big, big * Math.pow(ref / Math.max(ref, String(t).length), 0.6))));

// ---------- hooks (frame-0 contract) ----------
// hook_kinetic: the headline IS the artifact. variant "question": a chat bubble with a pulsing ? badge.
function hook_kinetic(ctx) {
  const { s, p, W = 1080, D } = ctx; const h = headline(s.text, s.emphasis); const emAt = em0(ctx) ?? Math.max(0.5, (spokenAt((s.emphasis || [])[0] || '', ctx.words) ?? 1.4) - 0.04); const q = ctx.variant === 'question';
  const html = root(ctx, W, 1060, '<div style="padding:0 70px">' + kick(s)
    + (q ? '<div class="card bub" style="padding:46px 52px 54px;border-radius:44px 44px 44px 10px;display:inline-block;max-width:900px">' + h.html + '</div><div class="qm hd" style="position:absolute;right:90px;top:20px;font-size:190px;color:var(--ac)">?</div>' : h.html) + '</div>'
    + tlWrap('tl.fromTo(q(".hl"),{scale:1.045,y:8},{scale:1,y:0,duration:.18,ease:"expo.out"},0);' + (q ? 'tl.fromTo(q(".qm"),{scale:1},{scale:1.18,duration:.5,ease:"sine.inOut",yoyo:true,repeat:3},0.3);' : '')
      + 'tl.to(q(".ul"),{scaleX:1,duration:.32,ease:"expo.out"},' + emAt.toFixed(2) + ');tl.fromTo(q(".em"),{scale:1},{scale:1.07,duration:.12,ease:"power2.out",yoyo:true,repeat:1},' + emAt.toFixed(2) + ');'
      + 'tl.to(q(".hl"),{y:-12,duration:' + Math.max(0.4, D - 2.4).toFixed(2) + ',ease:"power1.in"},2.4);') + '</div>');
  return { html, libs: ['gsap'], events: [{ t: 0.03, kind: 'hit' }, { t: emAt + 0.02, kind: 'pop' }], box: { x: 0, y: 380, w: W, h: 1060 }, thumbT: Math.min(D - 0.2, emAt + 0.4), beats: 2 };
}
// hook_result: headline + the finished result card (2–4 lines) both on frame 0; rows tick during the voice
function hook_result(ctx) {
  const { s, p, W = 1080, D } = ctx; const lines = (s.items || []).slice(0, 4); const h = headline(s.text, s.emphasis);
  const emAt = em0(ctx) ?? Math.max(0.5, (spokenAt((s.emphasis || [])[0] || '', ctx.words) ?? 1.8) - 0.04); const tick = lines.map((_, i) => (i === 0 ? 0 : 0.32 + i * 0.34));
  const html = root(ctx, W, 1060, '<div style="padding:0 70px">' + kick(s) + h.html
    + '<div class="card doc" style="margin-top:40px;width:880px;padding:30px 40px 34px;transform:rotate(-2.5deg);transform-origin:30% 50%">'
    + '<div class="mono" style="display:flex;align-items:center;gap:12px;font-size:28px;color:var(--muted);margin-bottom:22px"><span style="display:flex;gap:9px"><b style="width:15px;height:15px;border-radius:50%;background:#ff5f57"></b><b style="width:15px;height:15px;border-radius:50%;background:#febc2e"></b><b style="width:15px;height:15px;border-radius:50%;background:#28c840"></b></span>' + esc(s.sub || 'result.txt') + '</div>'
    + lines.map((l, i) => '<div class="ln" style="display:flex;align-items:center;gap:18px;font-size:42px;font-weight:800;line-height:1.2;padding:8px 0;' + (i ? 'border-top:1.5px solid rgba(255,255,255,.08);' : '') + '"><span class="ck" style="flex:none;width:44px;height:44px;border-radius:12px;background:var(--ac);display:grid;place-items:center;font-size:30px;color:#fff">✓</span><span>' + esc(l) + '</span></div>').join('') + '</div></div>'
    + tlWrap('tl.fromTo(q(".hl"),{scale:1.045,y:8},{scale:1,y:0,duration:.18,ease:"expo.out"},0);tl.fromTo(q(".doc"),{y:24,rotate:-4.5},{y:0,rotate:-2.5,duration:.42,ease:"expo.out"},0.02);'
      + 'const L=q(".ln");const T=' + JSON.stringify(tick) + ';L.forEach((el,i)=>{if(i)tl.fromTo(el,{opacity:0,x:-40},{opacity:1,x:0,duration:.26,ease:"expo.out"},T[i]);tl.fromTo(el.querySelector(".ck"),{scale:i?0:.6},{scale:1,duration:.3,ease:"back.out(2.2)"},T[i]+(i?.06:0));});'
      + 'tl.to(q(".ul"),{scaleX:1,duration:.32,ease:"expo.out"},' + emAt.toFixed(2) + ');tl.fromTo(q(".em"),{scale:1},{scale:1.07,duration:.12,ease:"power2.out",yoyo:true,repeat:1},' + emAt.toFixed(2) + ');'
      + 'tl.to(q(".doc"),{y:-14,duration:' + Math.max(0.4, D - 2.35).toFixed(2) + ',ease:"power1.in"},2.35);') + '</div>');
  return { html, libs: ['gsap'], events: [{ t: 0.03, kind: 'hit' }, ...tick.slice(1).map((t) => ({ t: t + 0.02, kind: 'click' })), { t: emAt + 0.02, kind: 'pop' }], box: { x: 0, y: 380, w: W, h: 1060 }, thumbT: Math.min(D - 0.2, emAt + 0.4), beats: 2 + lines.length };
}
// hook_number: the giant value is already on screen at frame 0 (slam settle), headline under it
function hook_number(ctx) {
  const { s, W = 1080, D } = ctx; const v = String(s.value || ''); const fs = v.length > 5 ? 300 : v.length > 3 ? 400 : 520; const h = headline(s.text, s.emphasis, { size: 150, min: 96, maxw: 880 });
  const html = root(ctx, W, 1060, '<div style="padding:0 70px">' + kick(s) + '<div class="hd num fitl" style="font-size:' + fs + 'px;line-height:.9;color:var(--ac);text-shadow:0 0 70px rgba(var(--glow),.55)">' + esc(v) + '</div><div style="margin-top:24px">' + h.html + '</div></div>'
    + tlWrap('tl.fromTo(q(".num"),{scale:1.12},{scale:1,duration:.18,ease:"expo.out"},0);tl.fromTo(q(".hl"),{scale:1.045,y:8},{scale:1,y:0,duration:.18,ease:"expo.out"},0);tl.to(q(".num"),{y:-14,duration:' + Math.max(0.4, D - 2.4).toFixed(2) + ',ease:"power1.in"},2.4);') + '</div>');
  return { html, libs: ['gsap'], events: [{ t: 0.03, kind: 'hit' }], box: { x: 0, y: 380, w: W, h: 1060 }, thumbT: Math.min(D - 0.2, 1.2), beats: 2 };
}

// ---------- body ----------
function title_card(ctx) { // variants: (default) statement · icon (big emoji) · quote
  const { s, p, W = 1080, D, variant } = ctx; const t = s.text || ''; const fs = sizeFor(t, 118, 64, 16); const sub = s.sub ? '<div class="sub sb" style="font-size:' + sizeFor(s.sub, 52, 38, 40) + 'px;margin-top:34px;max-width:880px">' + esc(s.sub) + '</div>' : '';
  const icon = variant === 'icon' ? '<div class="ico" style="font-size:300px;line-height:1;margin-bottom:30px">' + esc(s.iconChar || '✨') + '</div>' : variant === 'quote' ? '<div class="hd" style="font-size:260px;line-height:.55;height:130px;color:var(--ac)">“</div>' : '';
  const html = root(ctx, W, 1000, '<div style="padding:0 70px;display:flex;flex-direction:column;justify-content:center;height:1000px">' + icon + '<div class="hd ttl" style="font-size:' + fs + 'px">' + words(t, s.emphasis) + '</div><div class="bar" style="width:220px;height:14px;border-radius:7px;background:var(--ac);margin-top:34px;transform-origin:left"></div>' + sub + '</div>'
    + tlWrap('tl.fromTo(q(".w"),{y:70,opacity:0},{y:0,opacity:1,duration:.5,ease:"expo.out",stagger:.07},0.08);tl.fromTo(q(".bar"),{scaleX:0},{scaleX:1,duration:.45,ease:"expo.out"},0.4);' + (sub ? 'tl.fromTo(q(".sb"),{y:30,opacity:0},{y:0,opacity:1,duration:.4,ease:"expo.out"},0.6);' : '') + (variant === 'icon' ? 'tl.fromTo(q(".ico"),{scale:.3,rotate:-12},{scale:1,rotate:0,duration:.6,ease:"back.out(2)"},0.05);' : '')) + '</div>');
  return { html, libs: ['gsap'], events: [{ t: 0.1, kind: variant === 'icon' ? 'pop' : 'whoosh' }], box: { x: 0, y: 260, w: W, h: 1000 }, beats: 2 };
}
function list_steps(ctx) { // variants: (default) numbered · check (boxes tick)
  const { s, W = 1080, D, words: tw, variant } = ctx; const items = (s.items || []).slice(0, 5); const at = anchors(items, tw, D); const chk = variant === 'check';
  const row = (it, i) => '<div class="card it" style="display:flex;align-items:center;gap:30px;padding:' + (items.length > 4 ? '26px 36px' : '34px 40px') + '"><span class="nb hd" style="flex:none;width:' + (chk ? 64 : 76) + 'px;height:' + (chk ? 64 : 76) + 'px;border-radius:' + (chk ? 16 : 999) + 'px;background:' + (chk ? 'transparent;border:4px solid var(--ac)' : 'var(--ac)') + ';display:grid;place-items:center;font-size:' + (chk ? 44 : 44) + 'px;color:#fff">' + (chk ? '<i class="tk" style="font-style:normal;opacity:0">✓</i>' : i + 1) + '</span><span style="font-size:' + sizeFor(it, 56, 40, 18) + 'px;font-weight:800;line-height:1.1">' + esc(it) + '</span></div>';
  const html = root(ctx, W, 1040, '<div style="padding:0 70px">' + (s.text ? '<div class="hd hdg" style="font-size:' + sizeFor(s.text, 92, 60, 16) + 'px;margin-bottom:46px">' + words(s.text, s.emphasis) + '</div>' : '') + '<div style="display:flex;flex-direction:column;gap:' + (items.length > 4 ? 22 : 30) + 'px">' + items.map(row).join('') + '</div></div>'
    + tlWrap('tl.fromTo(q(".hdg .w"),{y:60,opacity:0},{y:0,opacity:1,duration:.45,ease:"expo.out",stagger:.06},0.05);const A=' + JSON.stringify(at.map((x) => +x.toFixed(2))) + ';q(".it").forEach((el,i)=>{tl.fromTo(el,{x:140,opacity:0},{x:0,opacity:1,duration:.4,ease:"expo.out"},A[i]);const k=el.querySelector(".tk");if(k)tl.fromTo(k,{opacity:0,scale:.2},{opacity:1,scale:1,duration:.3,ease:"back.out(2.4)"},A[i]+.18);});') + '</div>', 'display:flex;flex-direction:column;justify-content:center');
  return { html, libs: ['gsap'], events: at.map((t) => ({ t: t + 0.04, kind: chk ? 'click' : 'pop' })), box: { x: 0, y: 260, w: W, h: 1040 }, beats: 1 + items.length };
}
function stat(ctx) {
  const { s, W = 1080, D, words: tw } = ctx; const v = String(s.value || ''); const m = v.match(/^(\D*?)(\d[\d.,]*)(.*)$/); const n = m ? Number(m[2].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')) : NaN; const count = Number.isInteger(n) && n < 1e7;
  const land = Math.max(0.3, Math.min(2.2, (spokenAt(v.replace(/\D/g, ''), tw) ?? 0.3))); const fs = v.length > 6 ? 230 : 330;
  const html = root(ctx, W, 1000, '<div style="padding:0 70px;display:flex;flex-direction:column;justify-content:center;height:1000px;text-align:left"><div class="hd val fitl" style="font-size:' + fs + 'px;line-height:.95;color:var(--ac);text-shadow:0 0 70px rgba(var(--glow),.5)">' + esc(m ? m[1] : '') + '<span class="cnt">' + esc(count ? m[2] : v) + '</span>' + esc(m ? m[3] : '') + '</div>'
    + '<div class="hd lbl" style="font-size:' + sizeFor(s.text, 84, 54, 16) + 'px;margin-top:30px">' + words(s.text || '', s.emphasis) + '</div></div>'
    + tlWrap((count ? 'const o={v:0};tl.to(o,{v:' + n + ',duration:1.0,ease:"power2.out",onUpdate:()=>{const e=q(".cnt")[0];if(e)e.textContent=Math.round(o.v).toLocaleString("en-US")}},' + land.toFixed(2) + ');' : '') + 'tl.fromTo(q(".val"),{scale:.7,opacity:0},{scale:1,opacity:1,duration:.4,ease:"back.out(1.8)"},' + Math.max(0, land - 0.2).toFixed(2) + ');tl.fromTo(q(".lbl .w"),{y:50,opacity:0},{y:0,opacity:1,duration:.4,ease:"expo.out",stagger:.06},' + (land + 0.35).toFixed(2) + ');') + '</div>');
  return { html, libs: ['gsap'], events: [{ t: land + 0.9, kind: 'hit' }], box: { x: 0, y: 260, w: W, h: 1000 }, beats: 2 };
}
function compare(ctx) {
  const { s, W = 1080, D, words: tw } = ctx; const [a, b] = s.items || ['', '']; const half = Math.max(0.9, Math.min(D - 0.8, (tw.length ? tw[Math.floor(tw.length / 2)].t : D * 0.5)));
  const html = root(ctx, W, 1040, '<div style="padding:0 70px">' + (s.text ? '<div class="hd hdg" style="font-size:' + sizeFor(s.text, 84, 56, 18) + 'px;margin-bottom:44px">' + words(s.text, s.emphasis) + '</div>' : '')
    + '<div class="card bad" style="padding:44px 48px;opacity:.78"><div style="font-size:40px;font-weight:800;color:var(--muted);margin-bottom:10px">✕</div><div style="font-size:' + sizeFor(a, 58, 40, 20) + 'px;font-weight:800;line-height:1.1">' + esc(a) + '</div></div>'
    + '<div class="vs hd" style="font-size:80px;color:var(--ac);text-align:center;margin:22px 0">VS</div>'
    + '<div class="card good" style="padding:44px 48px;border-color:var(--ac);box-shadow:0 30px 80px rgba(0,0,0,.45),0 0 60px rgba(var(--glow),.35)"><div style="font-size:40px;font-weight:800;color:var(--ac2);margin-bottom:10px">✓</div><div style="font-size:' + sizeFor(b, 62, 42, 20) + 'px;font-weight:900;line-height:1.1">' + esc(b) + '</div></div></div>'
    + tlWrap('tl.fromTo(q(".hdg .w"),{y:60,opacity:0},{y:0,opacity:1,duration:.45,ease:"expo.out",stagger:.06},0.05);tl.fromTo(q(".bad"),{x:-160,opacity:0},{x:0,opacity:.78,duration:.45,ease:"expo.out"},0.3);tl.fromTo(q(".vs"),{scale:0},{scale:1,duration:.4,ease:"back.out(2.4)"},' + (half - 0.25).toFixed(2) + ');tl.fromTo(q(".good"),{x:160,opacity:0},{x:0,opacity:1,duration:.45,ease:"expo.out"},' + half.toFixed(2) + ');') + '</div>', 'display:flex;flex-direction:column;justify-content:center');
  return { html, libs: ['gsap'], events: [{ t: 0.32, kind: 'whoosh' }, { t: half + 0.05, kind: 'pop' }], box: { x: 0, y: 260, w: W, h: 1040 }, beats: 3 };
}
function prompt_box(ctx) { // variant "chat": bubbles appear in order
  const { s, W = 1080, D, words: tw, variant } = ctx; const chat = variant === 'chat';
  if (chat) {
    const bs = (s.bubbles || []).slice(0, 4); const at = anchors(bs.map((b) => b.text), tw, D, { from: 0.3 });
    const html = root(ctx, W, 1040, '<div style="padding:0 70px">' + (s.text ? '<div class="sub" style="font-size:46px;margin-bottom:34px;letter-spacing:.04em">' + esc(s.text) + '</div>' : '') + '<div style="display:flex;flex-direction:column;gap:26px">' + bs.map((b) => '<div class="card bb" style="max-width:800px;padding:30px 38px;font-size:46px;font-weight:700;line-height:1.2;' + (b.from === 'me' ? 'align-self:flex-end;background:rgba(var(--glow),.28);border-radius:40px 40px 10px 40px' : 'align-self:flex-start;border-radius:40px 40px 40px 10px') + '">' + esc(b.text) + '</div>').join('') + '</div></div>'
      + tlWrap('const A=' + JSON.stringify(at.map((x) => +x.toFixed(2))) + ';q(".bb").forEach((el,i)=>tl.fromTo(el,{y:50,opacity:0,scale:.9},{y:0,opacity:1,scale:1,duration:.4,ease:"back.out(1.6)"},A[i]));') + '</div>', 'display:flex;flex-direction:column;justify-content:center');
    return { html, libs: ['gsap'], events: at.map((t) => ({ t: t + 0.04, kind: 'click' })), box: { x: 0, y: 260, w: W, h: 1040 }, beats: bs.length };
  }
  const txt = s.prompt || ''; const typeEnd = Math.min(D - 1.0, Math.max(1.2, D * 0.55)); const fs = txt.length > 140 ? 40 : txt.length > 90 ? 46 : 52;
  const html = root(ctx, W, 1040, '<div style="padding:0 70px"><div class="card" style="padding:0;overflow:hidden"><div class="mono" style="display:flex;align-items:center;gap:14px;padding:22px 30px;background:rgba(255,255,255,.06);font-size:30px;color:var(--muted)"><span style="display:flex;gap:9px"><b style="width:16px;height:16px;border-radius:50%;background:#ff5f57"></b><b style="width:16px;height:16px;border-radius:50%;background:#febc2e"></b><b style="width:16px;height:16px;border-radius:50%;background:#28c840"></b></span>' + esc(s.text || 'Prompt') + '</div>'
    + '<div class="mono" style="padding:40px 44px 54px;font-size:' + fs + 'px;line-height:1.35;min-height:520px"><span class="tp"></span><span class="cr" style="display:inline-block;width:.55em;height:1.05em;background:var(--ac);vertical-align:-.15em;margin-left:4px"></span></div></div></div>'
    + tlWrap('const TXT=' + JSON.stringify(txt) + ';const o={n:0};tl.fromTo(q(".card"),{y:60,opacity:0},{y:0,opacity:1,duration:.45,ease:"expo.out"},0.05);tl.to(o,{n:TXT.length,duration:' + (typeEnd - 0.4).toFixed(2) + ',ease:"none",onUpdate:()=>{q(".tp")[0].textContent=TXT.slice(0,Math.round(o.n))}},0.4);tl.fromTo(q(".cr"),{opacity:1},{opacity:0,duration:.45,ease:"steps(1)",repeat:' + Math.max(1, Math.round(D / 0.9)) + ',yoyo:true},0);') + '</div>', 'display:flex;flex-direction:column;justify-content:center');
  return { html, libs: ['gsap'], events: [{ t: 0.4, kind: 'type' }], box: { x: 0, y: 260, w: W, h: 1040 }, beats: 2 };
}
function media(ctx) {
  const { s, W = 1080, D } = ctx; const src = s.visual && s.visual.localSrc; const fit = (s.visual && s.visual.fit) || 'cover'; const video = !!(s.visual && s.visual.shots); // video shots are `video` elements under this one (compile.mjs): here only the text bar
  const html = root(ctx, W, 1040, '<div style="width:' + W + 'px;height:1040px;overflow:hidden;position:relative">' + (video ? '' : src ? '<img class="im" src="' + esc(src) + '" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:' + (fit === 'contain' ? 'contain' : 'cover') + '">' : '<div style="position:absolute;inset:0;background:linear-gradient(135deg,var(--bg2),var(--bg))"></div>')
    + (s.text ? '<div class="card tb" style="position:absolute;left:70px;right:70px;bottom:36px;padding:30px 38px;font-size:' + sizeFor(s.text, 64, 42, 18) + 'px;font-weight:900;line-height:1.05;background:rgba(10,5,16,.62)">' + esc(s.text) + '</div>' : '') + '</div>'
    + tlWrap((video ? '' : 'tl.fromTo(q(".im"),{scale:1.04},{scale:1.12,duration:' + D.toFixed(2) + ',ease:"none"},0);') + 'tl.fromTo(q(".tb"),{y:80,opacity:0},{y:0,opacity:1,duration:.45,ease:"expo.out"},0.3);', false) + '</div>');
  return { html, libs: ['gsap'], events: [{ t: 0.05, kind: 'whoosh' }], box: { x: 0, y: 260, w: W, h: 1040 }, beats: 2 };
}
// CTA end card: brand pill, headline, action badge. The last scene holds ≥ 0.9 s after the voice (timing.mjs).
function cta_card(ctx) {
  const { s, W = 1080, D, brand } = ctx; const act = brand.cta[s.action || 'lab'] || brand.cta.lab; const badge = String(act.badge).replace('{KW}', s.keyword || 'TOOL');
  const html = root(ctx, W, 1040, '<div style="padding:0 70px;display:flex;flex-direction:column;justify-content:center;height:1040px">'
    + '<div class="chip" style="align-self:flex-start;margin-bottom:44px">ETHAN STUDIO</div><div class="hd ttl" style="font-size:' + sizeFor(s.text, 124, 66, 14) + 'px">' + words(s.text || '', s.emphasis) + '</div>'
    + '<div class="card bd" style="margin-top:56px;align-self:flex-start;padding:30px 52px;border-color:var(--ac);display:flex;align-items:center;gap:22px"><span style="font-size:58px">' + (s.action === 'comment' ? '💬' : s.action === 'follow' ? '➕' : s.action === 'save' ? '🔖' : '✈️') + '</span><span style="font-size:54px;font-weight:900">' + esc(badge) + '</span></div>'
    + '<div class="sub" style="font-size:40px;margin-top:26px">' + esc(act.sub) + '</div></div>'
    + tlWrap('tl.fromTo(q(".ttl .w"),{y:70,opacity:0},{y:0,opacity:1,duration:.5,ease:"expo.out",stagger:.07},0.1);tl.fromTo(q(".bd"),{scale:.6,opacity:0},{scale:1,opacity:1,duration:.5,ease:"back.out(2)"},0.7);tl.to(q(".bd"),{scale:1.05,duration:.5,ease:"sine.inOut",yoyo:true,repeat:3},1.3);') + '</div>');
  return { html, libs: ['gsap'], events: [{ t: 0.05, kind: 'riser' }, { t: 0.72, kind: 'ding', stop: true }], box: { x: 0, y: 300, w: W, h: 1040 }, beats: 2 };
}

export const TEMPLATES = { hook_kinetic, hook_result, hook_number, title_card, list_steps, stat, compare, prompt_box, media, cta_card };

// designed cover (1080×1920): same HEAD/background as the video, the hook composition drawn with `cover: true` (every reveal complete), series chip, brand mark.
// Same y as the hook box in the video (380) → QA S13 parity; the headline starts ≈ y 480, inside the 3:4 (y 240–1680) and 1:1 (y 420–1500) crops.
export function coverPage(ctx, hookSlots) {
  const c = { ...ctx, cover: true, G: 4, D: 3, words: [], s: { ...hookSlots } };
  const hk = (TEMPLATES[ctx.hookLayout] || hook_kinetic)(c);
  const bg = background(c);
  return '<!doctype html><html><head><meta charset="utf-8">' + head(ctx.brand, ctx.fontsUrl) + '</head><body style="margin:0;width:1080px;height:1920px;overflow:hidden">'
    + '<div style="position:absolute;inset:0">' + bg.slice(head(ctx.brand, ctx.fontsUrl).length) + '</div>'
    + '<div style="position:absolute;left:0;top:380px;width:1080px">' + hk.html.slice(head(ctx.brand, ctx.fontsUrl).length).replace(/<script>[\s\S]*<\/script>/, '').replace('transform:scaleX(0)', 'transform:scaleX(1)') + '</div>'
    + '<div style="position:absolute;left:0;right:0;top:1560px;text-align:center;font:800 30px \'Inter Tight\';letter-spacing:.42em;color:' + ctx.p.muted + '">ETHAN STUDIO</div></body></html>';
}
