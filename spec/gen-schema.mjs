// node spec/gen-schema.mjs → spec/creative-spec.schema.json (JSON Schema draft 2020-12 of the NORMALISED spec = what CI accepts and results store).
// Enums and limits come from core.cjs so the schema can never drift from the validator. Rules a schema cannot express (word counts, timing, hook ≤ 3 s,
// cross-field rules) live in ESC.validate() and carry "x-" annotations here for the reader.
import fs from 'node:fs';
import path from 'node:path';
import ESC from './core.cjs';

const L = ESC.LIM; const here = path.dirname(new URL(import.meta.url).pathname);
const str = (max, extra = {}) => ({ type: 'string', maxLength: max, ...extra });
const layoutsOf = (part) => Object.keys(ESC.LAYOUTS).filter((k) => ESC.LAYOUTS[k].part === part);
const visual = { type: 'object', additionalProperties: false, properties: { kind: { enum: ['image', 'ai_image', 'ai_video', 'clip', 'footage'] }, src: { type: 'string', pattern: '^(https|file)://|^[SB]\\d+$' }, prompt: str(L.visual_prompt_chars),
  clip: { type: 'integer', minimum: 1 }, in: { type: 'number', minimum: 0 }, out: { type: 'number', exclusiveMinimum: 0 }, fit: { enum: ['cover', 'contain', 'blur'] } } };
const line = (part, extra) => ({ type: 'object', additionalProperties: false, required: ['say', 'layout'], properties: {
  say: { type: 'string', minLength: 0, 'x-words': part === 'hook' ? ESC.LIM.hook_say_words : part === 'cta' ? [3, L.cta_words[1]] : L.say_words, description: 'spoken line (TTS): plain text, no URL/emoji/markup' },
  text: str(L.text_chars, { description: 'on-screen headline (hook: frame-0 headline, ≤ ' + L.hook_text_words + ' words / ' + L.hook_text_chars + ' chars)' }), sub: str(L.sub_chars),
  items: { type: 'array', maxItems: 5, items: str(L.item_chars) }, value: str(L.value_chars), icon: { type: 'string', maxLength: 8, description: 'one of ' + Object.keys(ESC.ICONS).join(' ') + ' (or one emoji)' }, prompt: str(L.prompt_chars),
  bubbles: { type: 'array', maxItems: 6, items: { type: 'object', required: ['text'], additionalProperties: false, properties: { from: { enum: ['them', 'me'] }, text: str(L.bubble_chars) } } },
  emphasis: { type: 'array', maxItems: 3, items: str(20) }, visual,
  visual_kind: { enum: ESC.VISUAL_KINDS, description: 'core 1.1: how the line is shown (code card / motion / still / footage / talk)' }, visual_hint: str(L.visual_hint_chars || 80), sfx_cue: { enum: ESC.SFX_CUES, default: 'none' }, hold: { type: 'number', minimum: 0, maximum: 2, description: 'seconds kept after the voice; default by role' }, transition: { type: 'string', maxLength: 20 },
  layout: { enum: layoutsOf(part), description: 'only these layouts exist for the ' + part + ' part' }, ...extra } });
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://github.com/nguyentranminhnhat3536-gif/es-render/blob/main/spec/creative-spec.schema.json', title: 'ETHAN STUDIO CreativeSpec es.creative/1 (standard es-short/1)',
  description: 'The normalised spec (spec/core.cjs normalize()). The AI-facing structured-output schema is the flat variant from ESC.llmSchema(). Core ' + ESC.CORE + '.',
  type: 'object', additionalProperties: false, required: ['version', 'lang', 'title', 'hook', 'scenes', 'cta', 'cover'],
  properties: {
    version: { const: ESC.VERSION, description: 'es.creative/1.x is read as es.creative/1; another major → W_VERSION and read as 1' },
    id: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,64}$', description: 'set by n8n / the bot (= job id); never trusted from the AI' },
    lang: { enum: ['en', 'vi'], default: 'en' }, format: { enum: ['9:16', '16:9'], default: '9:16', description: 'es-short/1 renders 9:16 only; 16:9 → E_FORMAT unless validate(spec,{formats}) allows it' },
    brand: { type: 'string', default: 'ethan-studio', description: 'brand kit: spec/brand/<brand>.json' }, content_type: { enum: ESC.CONTENT_TYPES, default: 'tip' },
    genre: { enum: ESC.GENRES, description: 'core 1.1' }, structure: { enum: ESC.STRUCTURES, description: 'core 1.1' },
    topic: str(L.topic_chars), promise: str(L.promise_chars, { description: 'the one result the viewer gets (≤ 12 words)' }), title: str(L.title_chars, { minLength: 1 }),
    target_duration: { type: 'integer', minimum: 30, maximum: 60, default: 45, description: 'informational; the estimate and the measured timeline are what is checked' },
    energy: { enum: ESC.ENERGY, default: 'normal', description: 'calm → render creative "subtle", fewer SFX, smooth transitions; high → +4 % voice rate' },
    voice: { type: 'object', additionalProperties: false, required: ['id', 'rate'], properties: { id: { enum: Object.keys(ESC.VOICES) }, rate: { type: 'integer', minimum: -10, maximum: 15, description: 'edge-tts rate %; default by energy 2/6/10; CI may raise the hook line to +20 %' } } },
    music: { type: 'object', additionalProperties: false, properties: { mood: { enum: ESC.MOODS, default: 'auto' }, volume: { type: 'number', minimum: 0, maximum: 0.4, default: 0.14 }, track: { type: 'string' } } },
    captions: { enum: ESC.CAPTIONS, default: 'auto' }, palette: { enum: ESC.PALETTES, default: 'auto' }, seed: str(40, { description: 'another seed = another visual variant of the same words' }),
    keywords: { type: 'array', maxItems: L.keywords, items: str(L.keyword_chars), description: 'highlighted in the captions; derived from emphasis / numbers when missing' },
    hook: line('hook', { hook_type: { enum: ESC.HOOK_TYPES, default: 'bold_claim' } }),
    scenes: { type: 'array', minItems: L.body[0], maxItems: L.body[1], items: line('body', { role: { enum: ESC.ROLES, default: 'point' } }), description: 'body scenes between the hook and the CTA (hard 3–8, best 4–6)' },
    cta: { type: 'object', additionalProperties: false, required: ['say', 'text', 'layout', 'action'], properties: { say: str(220, { 'x-words': [3, L.cta_words[1]] }), text: str(L.cta_text_chars), layout: { const: 'cta_card' }, action: { enum: ESC.ACTIONS, default: 'lab' }, keyword: str(16) } },
    cover: { type: 'object', additionalProperties: false, required: ['title', 'from', 'kicker'], properties: { title: str(L.cover_chars, { minLength: 1, 'x-words': L.cover_words }), alt_title: str(L.cover_chars, { 'x-words': L.cover_words }), emphasis: str(20), kicker: str(L.kicker_chars), from: { enum: ['hook', 'scene'], default: 'hook' }, scene: { type: 'integer', minimum: 1 } } },
    hooks_alt: { type: 'array', maxItems: L.hooks_alt, items: { type: 'object', required: ['say'], additionalProperties: false, properties: { hook_type: { enum: ESC.HOOK_TYPES }, say: str(120), text: str(L.hook_text_chars), layout: { enum: layoutsOf('hook') }, items: { type: 'array', items: str(L.item_chars) }, value: str(L.value_chars), emphasis: { type: 'array', items: str(20) } } }, description: 'two other hooks (other types, same promise) for the bot buttons' },
    facts_used: { type: 'array', maxItems: L.facts, items: { type: 'object', additionalProperties: false, required: ['claim', 'source'], properties: { claim: str(L.fact_chars), source: { type: 'string', pattern: '^(FACTS#\\d{1,2}|owner)$|^.{1,20}$' } } }, description: 'core 1.1: every number / result sentence cites FACTS#n (given by n8n node 1 / the bot) or "owner"; CI re-checks against job.meta.facts' },
    production: { type: 'object', description: 'es-editor only: how the script is produced (stored, not hashed)' },
    post: { type: 'object', additionalProperties: false, properties: { caption: str(600), hashtags: { type: 'array', maxItems: 8, items: str(40) } } },
    notes_vi: str(600, { description: 'Vietnamese summary for the owner; not rendered, not hashed' }), client: { type: 'object', description: 'card passthrough set by n8n / the bot (≤ 8 KB, secret-like keys removed), never by the AI' },
    footage: { type: 'array', description: 'es-editor only: clip catalogue a script refers to (visual.clip)' },
  },
};
fs.writeFileSync(path.join(here, 'creative-spec.schema.json'), JSON.stringify(schema, null, 2) + '\n');
console.log('wrote spec/creative-spec.schema.json for core', ESC.CORE);
