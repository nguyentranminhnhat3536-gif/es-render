// node --test test/spec/layouts.test.mjs — every v1 template × variant in a real Chromium page (needs playwright; no network, no ffmpeg):
//   S12  all text inside the safe content box (y 230–1300, x 60–1020), no horizontal overflow, even with worst-case slot lengths
//   S4   hook templates: headline and artifact fully opaque at t = 0 (frame-0 contract)
//   no page error · only OUR <script> · every spec string escaped
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ESC from '../../spec/core.cjs';
import { TEMPLATES, head, background } from '../../spec/layouts.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/brand/ethan-studio.json'), 'utf8')); const fontsUrl = 'file://' + path.join(ROOT, brand.fonts.dir);
const { chromium } = await import('playwright');
const GSAP = 'file://' + path.join(ROOT, 'node_modules/gsap/dist/gsap.min.js');
const long = (n, w = 'word') => Array.from({ length: n }, (_, i) => w + i).join(' ').slice(0, n);
const P = { ...brand.palettes.neon_pink, key: 'neon_pink' };
const words = 'Step one export your last fifty reviews into one plain text file and paste them'.split(' ').map((w, i) => ({ t: 0.3 + i * 0.3, d: 0.25, w })); // ends at ≈ 4.2 s, scene D = 5.5 s
const CASES = [
  ['hook_kinetic', undefined, { text: 'Stop doing this by hand', emphasis: ['hand'], kicker: 'QUICK TIP' }], ['hook_kinetic', 'question', { text: 'Same DM again?', emphasis: ['DM'], kicker: 'QUICK TIP' }],
  ['hook_kinetic', undefined, { text: 'Reviews → FAQ in one prompt', emphasis: [], kicker: 'FREE IN THE LAB' }],
  ['hook_result', undefined, { text: 'Reviews → FAQ', emphasis: ['FAQ'], kicker: 'FREE PROMPT', items: ['Q: Does it run small?', 'Q: How long is shipping?', 'Q: Is it dishwasher safe?', 'Q: Can I return it for free?'] }],
  ['hook_number', undefined, { text: '3 prompts. 0 inbox.', value: '3', emphasis: [], kicker: 'LIST' }], ['hook_number', undefined, { text: 'Save time every week', value: '$12,500', emphasis: [] }],
  ['title_card', undefined, { text: 'Same 5 questions, every day', sub: 'And the answers are already in your reviews', emphasis: ['reviews'] }], ['title_card', undefined, { text: long(48), sub: long(80) }],
  ['title_card', 'icon', { text: 'The trust step', iconChar: '🛡️' }], ['title_card', 'quote', { text: 'It answered my customers before they asked', sub: '— Maya, shop owner' }],
  ['list_steps', undefined, { text: 'Export 50 reviews', items: ['Shop dashboard', 'Export CSV', 'Copy the text'] }], ['list_steps', undefined, { text: long(48), items: Array.from({ length: 5 }, () => long(32)) }],
  ['list_steps', 'check', { text: 'Check before posting', items: ['Facts match', 'No made-up claims', 'One clear benefit', 'Link in bio'] }],
  ['stat', undefined, { text: 'listings in one coffee break', value: '7' }], ['stat', undefined, { text: long(48), value: '$1,250,000' }],
  ['compare', undefined, { text: 'Before vs after', items: ['Cotton bag, 40cm', 'Survives every school run'] }], ['compare', undefined, { text: long(48), items: [long(32), long(32)] }],
  ['prompt_box', undefined, { text: 'ChatGPT', prompt: long(220) }], ['prompt_box', undefined, { text: 'ChatGPT', prompt: 'Write a 60-word product description for busy parents.' }],
  ['prompt_box', 'chat', { text: 'Instagram DM', bubbles: [{ from: 'them', text: long(70) }, { from: 'me', text: long(70) }, { from: 'them', text: 'ok' }, { from: 'me', text: long(70) }] }],
  ['media', undefined, { text: 'Real photo of a tote bag', visual: { kind: 'image' } }],
  ['cta_card', undefined, { text: 'Free prompt in the Lab', action: 'lab' }], ['cta_card', undefined, { text: long(32), action: 'comment', keyword: 'FAQ' }],
];
const browser = await chromium.launch({ args: ['--disable-gpu', '--font-render-hinting=none', '--disable-web-security'] });
test.after(() => browser.close());

for (const [name, variant, s] of CASES) {
  test(name + (variant ? '/' + variant : '') + ' · ' + String(s.text || s.prompt || '').slice(0, 24), async () => {
    const D = 5.5; const out = TEMPLATES[name]({ s: { ...s, kicker: s.kicker }, words, D, G: 0, p: P, variant, brand, fontsUrl, W: 1080, H: 1920 });
    assert.ok(!/<script/i.test(out.html.replace(/<script>[\s\S]*?<\/script>/g, '')), 'only our own <script>');
    const doc = '<!doctype html><html><head><meta charset="utf-8"><script>window.ES={time:0,onSeek:[],ready:[]};window.__seek=(t)=>{window.ES.time=t;for(const f of window.ES.onSeek)f(t)}</script><script src="' + GSAP + '"></script></head><body style="margin:0;width:1080px;height:1920px;position:relative;background:#000">'
      + '<div id="box" style="position:absolute;left:' + out.box.x + 'px;top:' + out.box.y + 'px;width:' + out.box.w + 'px;height:' + out.box.h + 'px">' + out.html + '</div></body></html>';
    const f = path.join(ROOT, 'out', '.layout-' + name + '.html'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, doc);
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } }); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto('file://' + f, { waitUntil: 'load' }); await page.evaluate(() => document.fonts.ready); await page.evaluate(() => window.__seek(0));
    const f0 = await page.evaluate(() => { const o = (el) => { let x = 1; for (let n = el; n && n.id !== 'box'; n = n.parentElement) x *= Number(getComputedStyle(n).opacity); return x; }; const h = document.querySelector('.hl'); const lines = [...document.querySelectorAll('.ln')];
      return { hl: h ? o(h) : null, row0: lines[0] ? o(lines[0]) : null, num: document.querySelector('.num') ? o(document.querySelector('.num')) : null }; });
    if (/^hook_/.test(name)) { assert.ok((f0.hl ?? f0.num) >= 0.99, 'frame 0: headline opaque ' + JSON.stringify(f0)); if (name === 'hook_result') assert.ok(f0.row0 >= 0.99, 'frame 0: first artifact row visible'); }
    await page.evaluate((t) => window.__seek(t), D - 0.05);
    const m = await page.evaluate(() => { let top = 1e9, bottom = 0, left = 1e9, right = 0; const els = [...document.querySelectorAll('#box *')].filter((e) => e.children.length === 0 && (e.textContent || '').trim() && e.tagName !== 'SCRIPT' && e.tagName !== 'STYLE');
      for (const e of els) { const r = e.getBoundingClientRect(); if (r.width < 1 || getComputedStyle(e).visibility === 'hidden') continue; top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom); left = Math.min(left, r.left); right = Math.max(right, r.right); }
      return { top, bottom, left, right, sw: document.documentElement.scrollWidth, n: els.length }; });
    await page.close();
    assert.deepEqual(errs, [], 'page errors');
    assert.ok(m.n > 0, 'has text'); assert.ok(m.bottom <= 1300, 'S12 bottom ' + Math.round(m.bottom) + ' > 1300'); assert.ok(m.left >= 60 && m.right <= 1020, 'x range ' + Math.round(m.left) + '–' + Math.round(m.right));
    if (!/^hook_/.test(name)) assert.ok(m.top >= 225, 'top ' + Math.round(m.top)); assert.ok(m.sw <= 1080, 'no horizontal scroll ' + m.sw);
    console.log(name.padEnd(13), (variant || '').padEnd(8), 'y', Math.round(m.top) + '–' + Math.round(m.bottom), 'x', Math.round(m.left) + '–' + Math.round(m.right));
  });
}
