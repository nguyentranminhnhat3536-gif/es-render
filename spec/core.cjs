// ES CreativeSpec core — es.creative/1.1 · standard es-short/1 (30–60 s, hook spoken by 3.0 s, cover with every video)
// ONE file, no imports, no network, plain ES2020. Vendored copy for es-editor (task 10): task 9's core.cjs 1.0 + the 1.1 fields
// (genre, structure, facts_used, visual_kind, visual_hint, sfx_cue), word budgets derived from the estimator (budgetFor),
// the v1 lint codes (E_CLAIM_NO_FACT, E_CLICHE, W_TEXT_ECHO, W_READ_FAST, W_GENERIC, W_NO_FACTS, W_CTA_EARLY) and the 1.1 prompt.
// Readers of es.creative/1 ignore the new fields. When task 9 lands in es-render main, a test compares CORE with engine/spec/core.cjs
// and this copy is deleted (FINAL task 10 C3).
// API: fromAI · normalize · estimate · validate · salvage · check · feedback · llmSchema · prompt · budgetFor · claims · summaryVi · specHash
const ESC = (() => {
  const VERSION = 'es.creative/1.1';
  const CORE = '1.1.0'; // bump on every rule change; results carry it
  const STANDARD = { name: 'es-short/1', min: 30, max: 60, hook_max: 3.0, hook_warn: 2.6, est_min: 32, est_max: 57, ideal: [35, 55], first_cut: 3.6 };

  // ---------- limits (single source: prompt, validator, Telegram preview and compiler read them) ----------
  const LIM = {
    // spoken word caps (hook / body / cta) are per language and derived from the estimator: budgetFor(lang, rate). These 1.0 keys stay for old readers (EN, +6 %).
    hook_say_words: [2, 7], hook_say_aim: 6, hook_text_words: 6, hook_text_words_vi: 8, hook_text_chars: 36, headline_chars: 28,
    body: [3, 8], say_words: [4, 20], say_aim: 14, scene_max_s: 9, scene_min_s: 1.6, cta_words: [3, 7], cta_aim: 5, cta_text_chars: 32, cta_max_s: 3.0, cta_aim_s: 2.2,
    text_words: 6, text_words_vi: 8, visual_hint_chars: 80, facts: 12, fact_chars: 200, echo: 0.5, read_word_s: 0.25, read_syll_s_vi: 0.18, read_base_s: 0.5, // VI reading per syllable ≈ 0.7 × an EN word (U, no source; calibrate by eye)
    text_chars: 48, sub_chars: 80, item_chars: 32, value_chars: 10, prompt_chars: 220, bubble_chars: 70, bubbles: [2, 4],
    emphasis: 2, keywords: 8, keyword_chars: 24, cover_words: [2, 5], cover_chars: 32, kicker_chars: 20, title_chars: 80, topic_chars: 160,
    promise_chars: 120, visual_prompt_chars: 300, hooks_alt: 2, onscreen_words: 14,
  };
  // ---------- timing model (estimate before TTS; CI measures the real mp3 files and fits, see spec/timing.mjs) ----------
  // wps = spoken word units per second at edge-tts rate +0 %. en: least-error fit of the two real ES-002 renders (Andrew +10 %,
  // 35 lines, measured mp3 totals 97.02 s / 99.47 s): 2.48 with 0.18 s mp3 edge silence per line and 0.12 s per comma → errors −4 % / +5 %.
  // vi: 3.4 syllables/s at +0 % (research §2.3: ≈ 3.4 syll/s for edge-tts VI voices; the +6 % default rate is applied once, in lineSec).
  // U until 3 real VI renders are measured (make results carry report.total).
  const TIME = { wps: { en: 2.48, vi: 3.4 }, spread: 0.06, edge: 0.18, comma: 0.12, stop: 0.28,
    lead: { hook: 0.05, scene: 0.12, cta: 0.12 }, hold: { hook: 0, context: 0.15, point: 0.2, proof: 0.25, demo: 0.35, rehook: 0.1, payoff: 0.45, cta: 0.9 },
    min: { hook: 1.2, scene: 1.6, cta: 2.4 }, per_item: [1.0, 0.45], overlap: 0.15 };
  const ENERGY_RATE = { calm: 2, normal: 6, high: 10 };
  const VOICES = { andrew: 'en-US-AndrewMultilingualNeural', ava: 'en-US-AvaMultilingualNeural', brian: 'en-US-BrianMultilingualNeural',
    emma: 'en-US-EmmaMultilingualNeural', namminh: 'vi-VN-NamMinhNeural', hoaimy: 'vi-VN-HoaiMyNeural' };
  const VOICE_DEFAULT = { en: { male: 'andrew', female: 'ava' }, vi: { male: 'namminh', female: 'hoaimy' } };
  const ROLES = ['context', 'point', 'proof', 'demo', 'rehook', 'payoff'];
  const HOOK_TYPES = ['result_first', 'mistake', 'number', 'question', 'before_after', 'pov', 'bold_claim', 'myth', 'curiosity_gap'];
  const CONTENT_TYPES = ['tip', 'how_to', 'list', 'tool_drop', 'lab_call', 'myth_fact', 'before_after', 'story'];
  const MOODS = ['auto', 'upbeat', 'tech', 'chill', 'epic', 'none'];
  const PALETTES = ['auto', 'neon_pink', 'violet_night', 'paper_light'];
  const CAPTIONS = ['auto', 'pop', 'boxed-word', 'one-word', 'none'];
  const ACTIONS = ['lab', 'follow', 'comment', 'save'];
  const ENERGY = ['calm', 'normal', 'high'];
  const ICONS = { bolt: '⚡', clock: '⏰', money: '💰', chart: '📈', check: '✅', cross: '❌', idea: '💡', robot: '🤖', chat: '💬', mail: '✉️', calendar: '📅',
    cart: '🛒', tag: '🏷️', star: '⭐', heart: '❤️', rocket: '🚀', shield: '🛡️', lock: '🔒', gear: '⚙️', search: '🔍', phone: '📱', laptop: '💻', doc: '📄',
    folder: '📁', link: '🔗', gift: '🎁', fire: '🔥', target: '🎯', users: '👥', trophy: '🏆', camera: '📷', pen: '✍️' };
  // layouts the AI may choose. tpl = template function in spec/layouts/ (several names share one template as variants).
  // v: 1 = implemented in v1; later names are accepted by 1.x but compiled through `fallback` until their template ships.
  const LAYOUTS = {
    hook_kinetic: { part: 'hook', need: ['text'], tpl: 'hook_kinetic', desc: 'the headline itself is the artifact: huge type, one emphasis word in accent serif' },
    hook_result: { part: 'hook', need: ['text', 'items'], items: [2, 4], tpl: 'hook_result', desc: 'headline + the finished result card (2–4 short lines) already on screen' },
    hook_number: { part: 'hook', need: ['text', 'value'], tpl: 'hook_number', desc: 'giant number (value) + headline' },
    hook_question: { part: 'hook', need: ['text'], tpl: 'hook_kinetic', variant: 'question', desc: 'the question the viewer already asks, as a chat bubble headline' },
    title_card: { part: 'body', need: ['text'], tpl: 'title_card', desc: 'one bold statement (+ optional sub line)' },
    icon_point: { part: 'body', need: ['icon', 'text'], tpl: 'title_card', variant: 'icon', desc: 'one big icon + statement' },
    quote: { part: 'body', need: ['text'], tpl: 'title_card', variant: 'quote', desc: 'a real quote/review (sub = who said it)' },
    list_steps: { part: 'body', need: ['items'], items: [2, 5], tpl: 'list_steps', desc: 'numbered steps, each lands when it is spoken' },
    checklist: { part: 'body', need: ['items'], items: [2, 4], tpl: 'list_steps', variant: 'check', desc: 'boxes tick one by one as they are spoken' },
    stat: { part: 'body', need: ['value', 'text'], tpl: 'stat', desc: 'number counts up (value) + label (text)' },
    compare: { part: 'body', need: ['items'], items: [2, 2], tpl: 'compare', desc: 'items = [before/wrong, after/right] cards' },
    prompt_box: { part: 'body', need: ['prompt'], tpl: 'prompt_box', desc: 'the exact prompt types itself in an app window (text = window title)' },
    chat_mock: { part: 'body', need: ['bubbles'], tpl: 'prompt_box', variant: 'chat', desc: 'DM / chat bubbles appear in order' },
    media: { part: 'body', need: ['visual'], tpl: 'media', desc: 'full-bleed image or clip (visual.src) + text bar' },
    cta_card: { part: 'cta', need: ['text'], tpl: 'cta_card', desc: 'brand end card for the action (lab / follow / comment / save)' },
  };
  // old ES · 2 movie-JSON layout names and the other designs' names → the vocabulary above (warning W_LAYOUT_LEGACY)
  const ALIAS = { number_carousel: 'hook_number', measure_card: 'stat', donut_stat: 'stat', stepper_card: 'list_steps', badge_grid: 'list_steps', coverflow: 'list_steps',
    checklist_cards: 'checklist', profile_cards: 'icon_point', search_answer: 'prompt_box', prompt_timer: 'prompt_box', lesson_swap: 'compare', offer_pills: 'cta_card', end_card: 'cta_card',
    kinetic: 'hook_kinetic', hook_title: 'hook_kinetic', hook_problem: 'hook_kinetic', hook_mistake: 'hook_kinetic', hook_split: 'hook_kinetic', question: 'hook_question',
    title: 'title_card', point_card: 'title_card', kinetic_line: 'title_card', headline: 'title_card', statement: 'title_card', text: 'title_card', myth_fact: 'compare',
    list: 'list_steps', steps: 'list_steps', steps_flow: 'list_steps', bullets: 'list_steps', numbered_list: 'list_steps', how_to: 'list_steps', todo: 'checklist', checks: 'checklist',
    number: 'stat', big_number: 'stat', statistic: 'stat', metric: 'stat', vs: 'compare', versus: 'compare', before_after: 'compare', comparison: 'compare', split: 'compare',
    testimonial: 'quote', review: 'quote', icon: 'icon_point', tip: 'icon_point', feature: 'icon_point', chat: 'chat_mock', dm: 'chat_mock', messages: 'chat_mock',
    prompt: 'prompt_box', code_prompt: 'prompt_box', screen: 'prompt_box', terminal: 'prompt_box', app: 'prompt_box', app_mock: 'prompt_box', ui: 'prompt_box',
    image: 'media', photo: 'media', video: 'media', footage: 'media', broll: 'media', b_roll: 'media', clip: 'media',
    cta: 'cta_card', cta_lab: 'cta_card', cta_follow: 'cta_card', cta_comment: 'cta_card', outro: 'cta_card' };
  // field aliases the models invent (lower-case, spaces/hyphens → _) — per object type
  const KEY = {
    top: { spec: 'version', spec_version: 'version', schema: 'version', speed: 'pace', language: 'lang', duration: 'target_duration', target_seconds: 'target_duration', seconds: 'target_duration', length: 'target_duration',
      type: 'content_type', kind: 'content_type', format_type: 'content_type', pillar: 'content_type', narrator: 'voice', voice_id: 'voice', bgm: 'music', music_mood: 'music', subtitles: 'captions',
      caption_style: 'captions', highlights: 'keywords', tags: 'keywords', opening: 'hook', intro: 'hook', body: 'scenes', body_scenes: 'scenes', sections: 'scenes', slides: 'scenes', beats: 'scenes',
      shots: 'scenes', call_to_action: 'cta', outro: 'cta', ending: 'cta', end_card: 'cta', thumbnail: 'cover', thumb: 'cover', poster: 'cover', alt_hooks: 'hooks_alt', hook_alternatives: 'hooks_alt',
      summary_vi: 'notes_vi', tom_tat: 'notes_vi', summary: 'notes_vi', caption: 'post', theme: 'palette', style: 'palette',
      facts: 'facts_used', claims: 'facts_used', used_facts: 'facts_used', sources: 'facts_used', the_genre: 'genre', story_structure: 'structure', beat_sheet: 'structure' },
    line: { voice: 'say', narration: 'say', vo: 'say', voiceover: 'say', voice_over: 'say', script: 'say', speech: 'say', spoken: 'say', line: 'say', audio_text: 'say',
      on_screen: 'text', onscreen: 'text', on_screen_text: 'text', heading: 'text', headline: 'text', title: 'text', screen_text: 'text', screen: 'text',
      subtitle: 'sub', subheading: 'sub', author: 'sub', attribution: 'sub', who: 'sub', bullets: 'items', points: 'items', steps: 'items', options: 'items', lines: 'items', list: 'items',
      number: 'value', stat: 'value', metric: 'value', emoji: 'icon', messages: 'bubbles', chat: 'bubbles', highlight: 'emphasis', highlights: 'emphasis', emphasis_words: 'emphasis',
      type: 'layout', template: 'layout', scene_type: 'layout', image_prompt: 'visual_prompt', broll: 'visual_prompt', b_roll: 'visual_prompt', pause: 'hold', extra_time: 'hold', kind: 'layout',
      visual_type: 'visual_kind', hint: 'visual_hint', visual_note: 'visual_hint', sfx: 'sfx_cue', sound: 'sfx_cue', sound_cue: 'sfx_cue' },
  };
  const HYPE = ['revolutionary', 'game-changer', 'game changer', 'ultimate', 'best ever', 'mind-blowing', 'mind blowing', 'insane', 'jaw-dropping', "you won't believe", 'you wont believe',
    'shocking', 'guaranteed', 'life-changing', 'life changing', 'secret hack', 'nobody is talking about', 'this will change everything', 'hack the algorithm', 'crazy results', '100% free forever', '10x'];
  const OPENER = /^(hey( guys| everyone| there)?|hi( guys| everyone| there)?|hello( everyone)?|welcome( back)?|what'?s up|so,? |okay,? so|in this video|in today'?s video|today,? (i|we)('m| am| are| will)?|let me show you|have you ever wondered|ethan studio( here)?)\b[,!.:]?\s*/i;
  // brand copy from the Agent OS playbook (the AI never writes URLs; post captions carry links). 1.1: every default fits the CTA budget (EN ≤ 7 words, VI ≤ 10 syllables)
  const CTA_DEF = {
    lab: { say: 'Grab it free in our Telegram Lab.', text: 'Free in the Telegram Lab' }, follow: { say: 'Follow for a free tool every week.', text: 'Follow for a tool every week' },
    comment: { say: 'Comment {KW} and I will send it.', text: 'Comment "{KW}"' }, save: { say: 'Save this for when you need it.', text: 'Save this for later' } };
  const CTA_DEF_VI = {
    lab: { say: 'Nhận miễn phí trong Telegram Lab nhé.', text: 'Miễn phí trong Telegram Lab' }, follow: { say: 'Theo dõi để nhận công cụ mới mỗi tuần.', text: 'Theo dõi: công cụ mỗi tuần' },
    comment: { say: 'Bình luận {KW}, mình gửi ngay nhé.', text: 'Bình luận "{KW}"' }, save: { say: 'Lưu lại video này để làm theo nhé.', text: 'Lưu lại để làm theo' } };
  const KICKER = { tool_drop: 'FREE TOOL', lab_call: 'FREE IN THE LAB', how_to: 'HOW TO', list: 'SAVE THIS', myth_fact: 'MYTH VS FACT', before_after: 'BEFORE / AFTER', story: 'TRUE STORY', tip: 'QUICK TIP' };
  const REVIEW_OK = new Set(['E_HYPE', 'E_HOOK_OPENER']); // brand-rule errors that may render on the last attempt — but never auto-post
  // ---------- 1.1 vocabularies ----------
  const GENRES = ['list', 'explainer', 'promo', 'story', 'talking_head'];
  const STRUCTURES = ['pas', 'list', 'result_first', 'story', 'before_after', 'myth_fact', 'compare'];
  const VISUAL_KINDS = ['code', 'motion', 'still', 'footage', 'talk'];
  const SFX_CUES = ['none', 'hit', 'riser', 'pop', 'ding'];
  const GENRE_OF = { list: 'list', tip: 'explainer', how_to: 'explainer', tool_drop: 'promo', lab_call: 'promo', myth_fact: 'explainer', before_after: 'promo', story: 'story' };
  const STRUCTURE_OF = { list: 'list', explainer: 'result_first', promo: 'before_after', story: 'story', talking_head: 'pas' };
  // owner's own script: only these block (his words are never refused for length, speed, hype or claims — they show as ⚠️)
  const OWNER_BLOCK = new Set(['E_PARSE', 'E_HOOK_MISSING', 'E_SAY_MISSING', 'E_LANG', 'E_SLOT', 'E_ITEMS']);
  // E_CLICHE (error for AI drafts, warning for the owner's text); matched on folded text (no diacritics, lower case)
  const CLICHE = { en: ["in today's fast-paced world", 'in todays fast-paced world', "let's dive in", 'lets dive in', 'game-changer', 'game changer', 'buckle up'],
    en_re: [/\bunlock(s|ed|ing)?\b/, /\belevate(s|d)?\b/, /\bseamless(ly)?\b/, /\brevolutioni[sz](e|es|ed|ing)\b/, /\bit'?s not just\b[^.!?]{1,60}\bit'?s\b/],
    vi: ['trong thoi dai 4.0', 'hay cung tim hieu', 'bi quyet vang', 'thay doi cuoc choi', 'khong the bo lo', 'chi voi vai cu click', 'xin chao cac ban', 'chao cac ban', 'xin chao ca nha'] };
  // E_CLAIM_NO_FACT vocabulary (folded). "một"/"one" count as a number only before a time unit ("một hoá đơn" is no claim).
  const NUM_WORDS = new Set(['hai', 'ba', 'bon', 'tu', 'nam', 'sau', 'bay', 'tam', 'chin', 'muoi', 'muoi', 'tram', 'nghin', 'ngan', 'trieu', 'ty', 'ruoi',
    'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'fifteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'half', 'dozen']);
  const ONE_WORDS = new Set(['mot', 'one', 'an', 'a']);
  const TIME_UNITS = new Set(['giay', 'phut', 'gio', 'tieng', 'ngay', 'tuan', 'thang', 'second', 'seconds', 'sec', 'secs', 'minute', 'minutes', 'min', 'mins', 'hour', 'hours', 'hr', 'hrs', 'day', 'days', 'week', 'weeks', 'month', 'months']);
  const UNITS = new Set([...TIME_UNITS, 'lan', '%', 'phan tram', 'nghin', 'ngan', 'trieu', 'ty', 'don', 'khach', 'dong', 'd', 'k', 'x', 'times', 'percent', 'customers', 'clients', 'orders', 'users', 'people']);
  const CLAIM_VERB = /(tiet kiem|nhanh hon|nhanh gap|tang|giam|chi con|chi mat|chi can|gap|xong trong|\bsave[sd]?\b|\bsaving\b|\bfaster\b|\bmore\b|\bless\b|\bfewer\b|\bcut[s]?\b|\bboost|\bonly\b|\bincrease|\breduce|\bdouble[sd]?\b|\btriple[sd]?\b|\bgrow|\bearn|\bin under\b|\bin just\b)/;
  const ASK_VERB = /(\bfollow\b|\bcomment\b|\bsubscribe\b|luu lai|theo doi|binh luan)/;
  const CAPS_HIDDEN = new Set(['list_steps', 'checklist', 'stat', 'compare', 'chat_mock']); // cards whose items carry the words: captions hidden there (FINAL §7.4, C13)
  // word budgets derived from the SAME estimator constants the gates use: a line inside its budget passes E_HOOK_SLOW (3.0 s) and E_SCENE_SLOW (9 s)
  // by construction. hook: no comma, ends by hook_max (aim: by hook_warn). body: one comma + one inner stop + the longest body hold (payoff).
  // cta: speech ≤ cta_max_s (aim cta_aim_s). EN counts words, VI counts syllables (space tokens); numbers count as read (units()).
  function budgetFor(lang, rate) {
    lang = lang === 'vi' ? 'vi' : 'en'; rate = Number.isFinite(Number(rate)) ? Number(rate) : ENERGY_RATE.normal;
    const wps = TIME.wps[lang] * (1 + rate / 100); const holdMax = Math.max(...ROLES.map((r) => TIME.hold[r] || 0));
    const hookS = (end) => end - TIME.lead.hook + TIME.edge / 2 - TIME.edge;
    const bodyS = LIM.scene_max_s - TIME.lead.scene - TIME.edge - TIME.comma - TIME.stop - holdMax;
    const n = (sec) => Math.max(1, Math.floor(sec * wps + 1e-9));
    const vi = lang === 'vi';
    return { lang, rate, wps: r2(wps), unit: vi ? 'syllables' : 'words',
      hook: [2, n(hookS(STANDARD.hook_max)), n(hookS(STANDARD.hook_warn))],
      body: [vi ? 5 : 4, n(bodyS), n(6 - TIME.lead.scene - TIME.edge - TIME.hold.point)],
      cta: [vi ? 4 : 3, n(LIM.cta_max_s - TIME.edge), n(LIM.cta_aim_s - TIME.edge)],
      text: vi ? LIM.text_words_vi : LIM.text_words,
      total: (target) => { const t = Math.round(clamp(target, STANDARD.min, STANDARD.max, 45)); return [Math.round((35 - 6) * wps), Math.round((Math.min(55, t + 6) - 6) * wps), Math.round((t - 6) * wps)]; } };
  }

  // ---------- helpers ----------
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const ck = (k) => String(k).trim().toLowerCase().replace(/[\s-]+/g, '_');
  const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const str = (v) => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
  const words = (s) => str(s).split(' ').filter((t) => /[\p{L}\p{N}]/u.test(t));
  const wc = (s) => words(s).length;
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const clamp = (v, a, b, d) => Math.max(a, Math.min(b, num(v, d)));
  const r2 = (x) => Math.round(x * 100) / 100;
  const oneOf = (v, list, d) => { const s = ck(str(v)).replace(/^es_/, ''); return list.includes(s) ? s : list.includes(s.replace(/_/g, '-')) ? s.replace(/_/g, '-') : d; };
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;
  const VI_RE = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
  const fold = (v) => String(v == null ? '' : v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[‘’]/g, "'");
  const hasHtml = (v) => typeof v === 'string' && /<[a-z/!][^>]*>/i.test(v);
  // plain text only: HTML stripped, markdown marks removed
  // chỉ bỏ THẺ HTML thật (<b>, </i>, <br/>, <span …>) — "< 5 phút … > 20%" của anh là chữ, không phải HTML
  const TAG_RE = /<\/?[a-z][a-z0-9]*(?:\s[^<>]{0,300})?\/?>|<!--[\s\S]{0,400}?-->/gi;
  const plain = (v) => str(typeof v === 'string' ? decode(v.replace(TAG_RE, ' ')).replace(/\*\*|__|`+/g, '') : v);
  // what TTS will say: no URLs / hashtags / emoji / arrows / markdown; "&" → "and", "w/" → "with"
  // lang 'vi': "&" → "và", "< 5" → "dưới 5", "> 20%" → "trên 20%" (EN: and / under / over) — không đọc "and" trong câu tiếng Việt, không nuốt ý "dưới / trên"
  const speakable = (v, lang) => { const vi = lang === 'vi' || (lang == null && VI_RE.test(str(v))); return plain(v).replace(/https?:\/\/\S+|www\.\S+|t\.me\/\S+/gi, ' ').replace(/(^|\s)#\w+/g, ' ').replace(EMOJI, ' ')
    .replace(/(\d)\s*<\s*(?=\d)/g, vi ? '$1 nhỏ hơn ' : '$1 less than ').replace(/(\d)\s*>\s*(?=\d)/g, vi ? '$1 lớn hơn ' : '$1 greater than ')
    .replace(/(^|\s)<=?\s*(?=[\d$€£])/g, vi ? '$1dưới ' : '$1under ').replace(/(^|\s)>=?\s*(?=[\d$€£])/g, vi ? '$1trên ' : '$1over ')
    .replace(/[→←↑↓⇒➜•|*_~<>{}[\]]/g, ' ')
    .replace(/\s&\s/g, vi ? ' và ' : ' and ').replace(/\bw\/\s?/gi, vi ? 'với ' : 'with ').replace(/\be\.g\.,?/gi, vi ? 'ví dụ' : 'for example').replace(/\s+/g, ' ').replace(/\s+([.,!?;:…])/g, '$1').trim(); };
  // spoken length in word units: numbers are read as several words, $ € £ % add one
  function units(text) {
    let n = 0;
    for (const t of str(text).replace(/[—–/]/g, ' ').split(' ')) {
      if (!/[\p{L}\p{N}]/u.test(t)) continue;
      const m = t.match(/^[(\["']*([$€£])?(\d[\d,.]*)(%|k|m|x|s)?/i);
      if (m) { const d = m[2].replace(/\D/g, '').length; n += (d <= 2 ? 1 : d <= 4 ? 2 : 3) + (m[1] ? 1 : 0) + (m[3] === '%' ? 1 : 0); }
      else n += Math.max(1, t.split('-').filter((p) => /[\p{L}\p{N}]/u.test(p)).length);
    }
    return n;
  }
  const trimTo = (t, max) => { t = str(t); if (t.length <= max) return t; let o = ''; for (const w of t.split(' ')) { if ((o + ' ' + w).trim().length > max) break; o = (o + ' ' + w).trim(); } return o.replace(/[,;:–-]+$/, ''); };
  const firstWords = (t, n) => words(t).slice(0, n).join(' ').replace(/[,.;:!?]+$/, '');
  // chữ trên màn tự lấy từ lời đọc (kịch bản không có {chữ:}): cắt ở dấu phẩy / hết vế trong 2..n từ; không thì n từ đầu, bỏ từ cuối
  // (tiếng Việt: tránh cắt đôi từ ghép "hoá | đơn") và bỏ hư từ ở cuối ("và", "là", "tự"…) → "Cuối tháng mở báo cáo", không "Cuối tháng mở báo cáo là"
  const FUNC_VI = new Set('và là của thì mà tự để các những cho với bằng ở trong khi nếu nhưng hay hoặc một cả đã sẽ đang được bị rằng nên vì do từ tới đến lại cũng còn rồi chỉ có dưới trên sau trước về theo như vào qua'.split(' ').map((w) => w.normalize('NFC')));
  const FUNC_EN = new Set('and the a an of to for with in on at is are be your my our that then by or but so as it this from into'.split(' '));
  // cắt chữ tiêu đề / hook / bìa theo số ký tự mà không kết thúc bằng hư từ treo ("… của", "… và", "… có", "… dưới", "… with")
  const trimHead = (t, max) => { const o = trimTo(t, max).split(' ').filter(Boolean); const F = VI_RE.test(str(t)) ? FUNC_VI : FUNC_EN; const bare = (x) => x.replace(/[,.;:!?…"“”'()]+/g, '').toLowerCase().normalize('NFC');
    while (o.length > 2 && F.has(bare(o[o.length - 1]))) o.pop(); return o.join(' ').replace(/[,;:–-]+$/, ''); };
  const autoHead = (t, n) => {
    const w = words(t); if (w.length <= 1) return firstWords(t, n); const vi = VI_RE.test(str(t)); const F = vi ? FUNC_VI : FUNC_EN;
    const k = w.findIndex((x, i) => i >= 1 && i < n && /[,.;:!?…]$/.test(x)); let o;
    if (k >= 1) o = w.slice(0, k + 1); else { o = w.slice(0, n); if (w.length > n && vi && o.length > 2) o.pop(); }
    const bare = (x) => x.replace(/[,.;:!?…"“”'()]+/g, '').toLowerCase().normalize('NFC');
    while (o.length > 2 && F.has(bare(o[o.length - 1]))) o.pop();
    return o.join(' ').replace(/[,.;:!…]+$/, '');
  };
  // hook ngắn (≤ 8 âm tiết VI / 6 từ EN, ≤ 28 ký tự = vừa tiêu đề) → cả câu hook làm chữ (không cắt "Cuối tháng còn gõ hoá"); dài hơn → autoHead 5 từ
  const hookHead = (t, lang) => { const sy = str(t).replace(/[.!…]+$/, ''); return wc(sy) <= (lang === 'vi' ? LIM.hook_text_words_vi : LIM.hook_text_words) && sy.length <= LIM.headline_chars ? sy : autoHead(t, 5); };
  function canon(v) { if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'; if (isObj(v)) return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'; return JSON.stringify(v); }
  function hash(v) { const s = canon(v); let h1 = 0xdeadbeef, h2 = 0x41c6ce57; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return ((h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')).slice(0, 14); }
  // content hash (ignores id, client, notes) — default render seed and log key
  const specHash = (s) => { if (!isObj(s)) return ''; const { id, client, notes_vi, footage, production, est, ...rest } = s; return hash(rest); };

  // ---------- AI output in any shape → object ----------
  function parseJSON(t) {
    if (isObj(t)) return t; let s = String(t == null ? '' : t).replace(/^﻿/, '').trim();
    s = s.replace(/```(?:json|JSON)?/g, '').trim();
    try { return JSON.parse(s); } catch (e) { /* try harder */ }
    const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a < 0 || b <= a) throw new Error('no {…} block in the answer');
    let mid = s.slice(a, b + 1); try { return JSON.parse(mid); } catch (e) { /* repair */ }
    mid = mid.replace(/[“”]/g, '"').replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1').replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":');
    return JSON.parse(mid);
  }
  // Gemini content.parts / candidates · OpenAI message / choices · Anthropic content[] · Agent/Chain output/text · HTTP body · bare spec · JSON string
  function fromAI(j) {
    const looks = (o) => isObj(o) && (/^es\.creative\//.test(str(o.version)) || (o.hook && (o.scenes || o.cta)) || (Array.isArray(o.scenes) && o.scenes.length > 1));
    const unwrap = (o) => (isObj(o.spec) && !o.scenes ? o.spec : isObj(o.creative_spec) ? o.creative_spec : isObj(o.creativeSpec) ? o.creativeSpec : o);
    if (typeof j === 'string') { try { const o = parseJSON(j); return looks(unwrap(o)) ? unwrap(o) : null; } catch (e) { return null; } }
    const texts = []; let found = null;
    (function walk(v, d) {
      if (found || v == null || d > 7) return;
      if (typeof v === 'string') { if (v.includes('{') && v.includes('}')) texts.push(v); return; }
      if (Array.isArray(v)) { const joined = v.map((x) => (isObj(x) && typeof x.text === 'string' ? x.text : '')).join(''); if (joined.includes('{')) texts.push(joined); for (const x of v) walk(x, d + 1); return; }
      if (!isObj(v)) return; if (looks(unwrap(v))) { found = unwrap(v); return; }
      for (const k of Object.keys(v)) if (!['binary', 'es', 'prompt', 'system', 'user', 'schema', 'schema_json', 'gemini_body', 'feedback'].includes(k)) walk(v[k], d + 1);
    })(j, 0);
    if (found) return found;
    for (const t of texts.sort((a, b) => b.length - a.length)) { try { const o = unwrap(parseJSON(t)); if (looks(o)) return o; } catch (e) { /* next */ } }
    return null;
  }

  // ---------- normalize: any reasonable shape → canonical spec. Never throws; every change is listed ----------
  function normalize(raw, opts = {}) {
    const fixes = []; const fix = (code, path, msg, vi) => fixes.push({ code, path, msg, ...(vi ? { vi } : {}) });
    let x = typeof raw === 'string' ? (() => { try { return parseJSON(raw); } catch (e) { return null; } })() : raw;
    if (isObj(x) && isObj(x.spec) && !x.scenes) x = x.spec; // job wrapper { id, kind, spec }
    if (isObj(x) && isObj(x.creative_spec)) x = x.creative_spec;
    if (!isObj(x)) return { spec: null, fixes };
    const rekey = (o, table, allowed, path) => { const r = {}; const dropped = [];
      for (const [k0, v] of Object.entries(o)) { let k = ck(k0); if (!allowed.includes(k) && table[k]) k = table[k]; if (allowed.includes(k)) { if (r[k] == null || r[k] === '') r[k] = v; } else dropped.push(k0); }
      if (dropped.length) fix('W_UNKNOWN_FIELD', path, 'ignored unknown field(s): ' + dropped.slice(0, 6).join(', '));
      return r; };
    const TOP = ['version', 'pace', 'id', 'lang', 'format', 'brand', 'content_type', 'genre', 'structure', 'topic', 'promise', 'title', 'target_duration', 'energy', 'voice', 'music', 'captions', 'palette', 'seed',
      'keywords', 'hook', 'scenes', 'cta', 'cover', 'hooks_alt', 'facts_used', 'post', 'notes_vi', 'client', 'footage', 'production', 'x'];
    const LINE = ['role', 'layout', 'hook_type', 'say', 'text', 'sub', 'items', 'value', 'icon', 'prompt', 'bubbles', 'emphasis', 'visual', 'visual_prompt', 'visual_kind', 'visual_hint', 'sfx_cue', 'hold', 'transition',
      'before', 'after', 'label', 'body', 'action', 'keyword', 'voice_mode', 'vi', 'claims', 'variant', 'id', 'image', 'kicker', 'step'];
    const t = rekey(x, KEY.top, TOP, '/');
    const htmlFix = (v, path) => { if (hasHtml(v)) fix('F_HTML_STRIPPED', path, 'removed HTML (plain text only)'); };
    const txt = (v, path) => { htmlFix(v, path); return plain(Array.isArray(v) ? v.join(', ') : isObj(v) ? Object.values(v).filter((y) => typeof y === 'string').join(' ') : v); };
    // lời đọc: bỏ URL / emoji / ký hiệu TTS sẽ đọc to. Kịch bản của anh (owner): khác chữ gốc (ngoài khoảng trắng) → ⚠️ để anh thấy bot đọc gì
    const say = (v, path) => { const raw0 = typeof v === 'string' ? v : ''; const a = txt(v, path); const b = speakable(a, s.lang || (VI_RE.test(raw0) ? 'vi' : 'en'));
      if (a !== b || (raw0 && raw0.replace(/\s+/g, ' ').trim() !== b)) { const where = path.replace(/^\/scenes\/(\d+).*/, (m0, i) => 'câu ' + (Number(i) + 1)).replace(/^\/hook.*/, 'hook').replace(/^\/cta.*/, 'CTA');
        if (opts.owner && raw0 && raw0.replace(/\s+/g, ' ').trim() !== b) fix('W_SAY_CHANGED', path, 'spoken line differs from the owner\'s text: "' + b.slice(0, 80) + '"', where + ': bot sẽ đọc “' + b.slice(0, 80) + '” (khác chữ anh gõ ở ký hiệu / link)');
        else fix('F_SAY_CLEANED', path, 'removed URL / emoji / symbols TTS would read aloud'); }
      return b; };
    if (t.version && !/^es\.creative\/1(\.\d+)?$/.test(str(t.version)) && str(t.version) !== '1.0') fix('W_VERSION', '/version', 'version "' + str(t.version) + '" read as ' + VERSION);
    const s = { version: VERSION };
    const idIn = str(opts.id || t.id).replace(/[^\w.-]/g, '_').slice(0, 64); if (idIn) s.id = idIn;
    // body lines first (language detection needs the spoken text)
    let rawScenes = Array.isArray(t.scenes) ? t.scenes.slice() : isObj(t.scenes) ? Object.values(t.scenes) : [];
    rawScenes = rawScenes.map((v) => (typeof v === 'string' ? { say: v } : v)).filter(isObj);
    const roleOf = (o) => ck(str(o.role || o.type || o.layout || o.kind));
    let hookIn = isObj(t.hook) ? t.hook : typeof t.hook === 'string' ? { say: t.hook } : null;
    if (!hookIn && rawScenes.length && /hook|intro|opening/.test(roleOf(rawScenes[0]))) { hookIn = rawScenes.shift(); fix('W_HOOK_MOVED', '/scenes/0', 'scene 1 was the hook → moved to hook'); }
    let ctaIn = isObj(t.cta) ? t.cta : typeof t.cta === 'string' ? { say: t.cta } : null;
    if (!ctaIn && rawScenes.length > 1 && /cta|end|offer|outro/.test(roleOf(rawScenes[rawScenes.length - 1]))) { ctaIn = rawScenes.pop(); fix('W_CTA_MOVED', '/scenes', 'last scene was the CTA → moved to cta'); }
    const allSay = [hookIn && (hookIn.say || hookIn.voice), ...rawScenes.map((o) => o.say || o.voice || o.narration), ctaIn && (ctaIn.say || ctaIn.voice)].filter((y) => typeof y === 'string').join(' ');
    s.lang = oneOf(t.lang || opts.lang, ['en', 'vi'], VI_RE.test(allSay) ? 'vi' : 'en');
    s.format = ['9:16', '16:9'].includes(str(t.format)) ? str(t.format) : ['9:16', '16:9'].includes(str(opts.format)) ? str(opts.format) : '9:16';
    s.brand = str(t.brand) || 'ethan-studio';
    s.content_type = oneOf(t.content_type, CONTENT_TYPES, /tool/.test(ck(str(t.content_type))) ? 'tool_drop' : /lab/.test(ck(str(t.content_type))) ? 'lab_call' : /how/.test(ck(str(t.content_type))) ? 'how_to' : /list|top/.test(ck(str(t.content_type))) ? 'list' : /myth/.test(ck(str(t.content_type))) ? 'myth_fact' : 'tip');
    s.genre = oneOf(t.genre || opts.genre, GENRES, { tips: 'list', listicle: 'list', how_to: 'explainer', tutorial: 'explainer', product: 'promo', ad: 'promo', talk: 'talking_head', talking: 'talking_head' }[ck(str(t.genre || opts.genre))] || GENRE_OF[s.content_type] || 'explainer');
    s.structure = oneOf(t.structure, STRUCTURES, { problem_agitate_solve: 'pas', steps: 'list', result: 'result_first', before: 'before_after', myth: 'myth_fact', vs: 'compare' }[ck(str(t.structure))] || STRUCTURE_OF[s.genre]);
    s.topic = txt(t.topic || opts.topic, '/topic').slice(0, LIM.topic_chars); s.promise = txt(t.promise, '/promise').slice(0, LIM.promise_chars);
    s.target_duration = Math.round(clamp(t.target_duration ?? opts.target, STANDARD.min, STANDARD.max, 45));
    s.energy = oneOf(t.energy, ENERGY, { subtle: 'calm', bold: 'high', balanced: 'normal', energetic: 'high', chill: 'calm', medium: 'normal' }[ck(str(t.energy))] || 'normal');
    // voice: "andrew" | "female" | full edge-tts name | { id, rate }
    const vo = isObj(t.voice) ? t.voice : { id: t.voice }; let vid = ck(str(vo.id || vo.name)).replace(/_/g, '-');
    const fullName = Object.entries(VOICES).find(([, v]) => v.toLowerCase() === vid)?.[0];
    let vkey = VOICES[vid.replace(/-/g, '')] ? vid.replace(/-/g, '') : fullName || (/^(female|woman|nu|nữ|f)$/.test(vid) ? VOICE_DEFAULT[s.lang].female : /^(male|man|nam|m)$/.test(vid) ? VOICE_DEFAULT[s.lang].male : '');
    if (!vkey) { if (vid) fix('W_VOICE', '/voice', 'unknown voice "' + vid + '" → default'); vkey = VOICE_DEFAULT[s.lang].male; }
    if (!VOICES[vkey].startsWith(s.lang === 'vi' ? 'vi-' : 'en-')) { fix('W_VOICE_LANG', '/voice', 'voice does not speak ' + s.lang + ' → ' + VOICE_DEFAULT[s.lang].male); vkey = VOICE_DEFAULT[s.lang].male; }
    const paceRate = { calm: 2, slow: 2, normal: 6, medium: 6, fast: 12, quick: 12 }[ck(str(t.pace))];
    s.voice = { id: vkey, rate: Math.round(clamp(vo.rate ?? vo.speed ?? paceRate, -10, 15, ENERGY_RATE[s.energy])) };
    const mu = isObj(t.music) ? t.music : { mood: t.music === false ? 'none' : t.music };
    s.music = { mood: oneOf(mu.mood, MOODS, { energetic: 'upbeat', happy: 'upbeat', lofi: 'chill', calm: 'chill', focus: 'tech', cinematic: 'epic', off: 'none', false: 'none' }[ck(str(mu.mood))] || 'auto'), volume: r2(clamp(mu.volume, 0, 0.4, 0.14)) };
    if (str(mu.track)) s.music.track = str(mu.track);
    s.captions = oneOf(t.captions, CAPTIONS, { boxed: 'boxed-word', word: 'one-word', off: 'none', karaoke: 'pop', classic: 'pop' }[ck(str(t.captions))] || 'auto');
    s.palette = oneOf(t.palette, PALETTES, { neon: 'neon_pink', es_neon: 'neon_pink', dark: 'neon_pink', violet: 'violet_night', paper: 'paper_light', light: 'paper_light', es_paper: 'paper_light' }[ck(str(t.palette))] || 'auto');
    if (str(t.seed)) s.seed = str(t.seed).slice(0, 40);
    // one line (hook / scene / cta) → canonical slots
    const items = (v, path) => { let a = v; if (typeof a === 'string') { const parts = a.split(/\n|;|\s\|\s|\s•\s/).map((q) => q.replace(/^\s*(\d+[.)]|[-•*])\s*/, '')).filter((q) => q.trim()); if (parts.length >= 2) { a = parts; fix('F_ITEMS_SPLIT', path, 'items given as text → split'); } else a = parts; }
      return (Array.isArray(a) ? a : []).map((q) => txt(isObj(q) ? q.text || q.title || q.label || Object.values(q).find((y) => typeof y === 'string') : q, path)).map((q) => q.replace(/^\s*(\d+[.)]|[-•*✅❌✓✗])\s*/, '')).filter(Boolean); };
    const line = (o0, part, path) => {
      const o = rekey(o0, KEY.line, LINE, path); const y = {};
      y.say = say(o.say, path + '/say');
      const T = txt(o.text, path + '/text'); if (T) y.text = T;
      const sub = txt(o.sub || o.label, path + '/sub'); if (sub) y.sub = sub;
      let it = items(o.items, path + '/items'); if (!it.length && (o.before || o.after)) it = [txt(o.before, path), txt(o.after, path)].filter(Boolean); if (it.length) y.items = it;
      const val = txt(o.value, path + '/value'); if (val) y.value = val;
      if (o.icon != null) { const ic = ck(str(o.icon)); const em = Object.keys(ICONS).find((k) => ICONS[k] === str(o.icon) || ICONS[k].replace('️', '') === str(o.icon)); const e2 = (str(o.icon).match(EMOJI) || [])[0];
        y.icon = ICONS[ic] ? ic : em || (e2 ? str(o.icon) : ''); if (!y.icon) delete y.icon; }
      const pr = txt(o.prompt || (/screen|prompt|terminal/.test(ck(str(o.layout))) ? o.body : ''), path + '/prompt'); if (pr) y.prompt = pr;
      if (!y.sub && o.body && !y.prompt) { const b = txt(o.body, path + '/body'); if (b) y.sub = b; }
      const bub = Array.isArray(o.bubbles) ? o.bubbles : null;
      if (bub) y.bubbles = bub.map((b, i) => (isObj(b) ? { from: /^(me|us|bot|brand|right|you)$/i.test(str(b.from || b.who || b.role)) ? 'me' : 'them', text: txt(b.text || b.message, path) } : { from: i % 2 ? 'me' : 'them', text: txt(b, path) })).filter((b) => b.text).slice(0, 6);
      const em = (Array.isArray(o.emphasis) ? o.emphasis : str(o.emphasis) ? [o.emphasis] : []).map((q) => txt(q, path)).filter(Boolean).slice(0, 3); if (em.length) y.emphasis = em;
      const vis = isObj(o.visual) ? o.visual : typeof o.image === 'string' && o.image ? { src: o.image } : null; const vp = txt(o.visual_prompt || (vis && vis.prompt), path + '/visual');
      if (vis || vp) { const v = {}; const src = str(vis && (vis.src || vis.url)); if (/^(https|file):\/\//.test(src) || /^[SB]\d+$/i.test(src)) v.src = src;
        if (vp) v.prompt = vp.slice(0, LIM.visual_prompt_chars); if (vis && Number.isInteger(num(vis.clip, NaN)) && num(vis.clip) >= 1) v.clip = num(vis.clip);
        if (vis && Array.isArray(vis.shots)) { const sh = vis.shots.filter(isObj).slice(0, 8).map((q) => ({ src: str(q.src), in: r2(Math.max(0, num(q.in, 0))), out: r2(num(q.out, 0)) })).filter((q) => /^(https|file):\/\//.test(q.src) && q.out > q.in); if (sh.length) v.shots = sh; }
        if (vis && num(vis.in, -1) >= 0) v.in = num(vis.in); if (vis && num(vis.out, -1) > 0) v.out = num(vis.out); if (vis && ['cover', 'contain', 'blur'].includes(str(vis.fit))) v.fit = str(vis.fit);
        if (vis && ['image', 'ai_image', 'ai_video', 'clip', 'footage'].includes(str(vis.kind))) v.kind = str(vis.kind); else v.kind = v.src ? (/\.(mp4|mov|webm)(\?|$)/i.test(v.src) || v.clip ? 'clip' : 'image') : v.clip || v.shots ? 'clip' : 'ai_image';
        if (v.src || v.prompt || v.clip || v.shots) y.visual = v; }
      if (part !== 'cta') { y.visual_kind = oneOf(o.visual_kind, VISUAL_KINDS, { ai: 'motion', animation: 'motion', animated: 'motion', image: 'still', photo: 'still', clip: 'footage', video: 'footage', card: 'code', graphic: 'code', none: 'code' }[ck(str(o.visual_kind))] || 'code');
        const hint = txt(o.visual_hint, path + '/visual_hint'); if (hint) { y.visual_hint = trimTo(hint, LIM.visual_hint_chars); if (y.visual_hint !== hint) fix('F_TRIMMED', path + '/visual_hint', 'visual_hint trimmed to ' + LIM.visual_hint_chars + ' characters'); }
        const sfx = oneOf(o.sfx_cue, SFX_CUES, { whoosh: 'riser', swoosh: 'riser', boom: 'hit', impact: 'hit', click: 'pop', bell: 'ding', chime: 'ding' }[ck(str(o.sfx_cue))] || 'none'); if (sfx !== 'none') y.sfx_cue = sfx; }
      if (o.hold != null && Number.isFinite(Number(o.hold))) y.hold = r2(clamp(o.hold, 0, 2, 0));
      if (part === 'body') y.role = oneOf(o.role, ROLES, 'point');
      if (part === 'hook') y.hook_type = oneOf(o.hook_type, HOOK_TYPES, 'bold_claim');
      if (part === 'cta') { y.action = oneOf(o.action, ACTIONS, { telegram: 'lab', join: 'lab', subscribe: 'follow', bookmark: 'save', comment_keyword: 'comment', dm: 'comment' }[ck(str(o.action))] || ''); if (str(o.keyword)) y.keyword = str(o.keyword).replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 16).toUpperCase(); }
      if (str(o.transition)) y.transition = ck(str(o.transition)).replace(/_/g, '-');
      y.layout = lay(o.layout, part, y, path);
      if ((y.layout === 'stat' || y.layout === 'hook_number') && !y.text && y.sub) { y.text = y.sub; delete y.sub; }
      if (y.layout === 'quote' && !y.text && str(o.body)) { y.text = txt(o.body, path + '/body'); if (y.sub === y.text) delete y.sub; }
      return y;
    };
    const lay = (name, part, y, path) => {
      let n = ck(str(name));
      if (n && !LAYOUTS[n] && ALIAS[n]) { fix('W_LAYOUT_LEGACY', path + '/layout', 'layout "' + n + '" → "' + ALIAS[n] + '"'); n = ALIAS[n]; }
      if (part === 'hook' && LAYOUTS[n] && LAYOUTS[n].part !== 'hook') n = n === 'stat' ? 'hook_number' : n === 'list_steps' || n === 'checklist' ? 'hook_result' : '';
      if (part === 'cta') return 'cta_card';
      if (LAYOUTS[n] && LAYOUTS[n].part === part) return n;
      if (n) fix('W_LAYOUT_UNKNOWN', path + '/layout', 'unknown layout "' + n + '" → inferred from the filled slots');
      if (part === 'hook') return y.value ? 'hook_number' : (y.items || []).length >= 2 ? 'hook_result' : /\?\s*$/.test(y.text || y.say) || y.hook_type === 'question' ? 'hook_question' : 'hook_kinetic';
      if ((y.bubbles || []).length >= 2) return 'chat_mock'; if (y.prompt) return 'prompt_box'; if (y.value) return 'stat';
      const it = y.items || []; if (it.length === 2 && /\b(vs|instead|before|after|wrong|right|old|new)\b|❌|✅/i.test(it.join(' ') + ' ' + (y.text || ''))) return 'compare';
      if (it.length >= 2) return 'list_steps'; if (y.icon) return 'icon_point'; if (y.visual && (y.visual.src || y.visual.prompt || y.visual.clip || y.visual.shots)) return 'media'; return 'title_card';
    };
    // required slots missing → a simpler layout the content can fill (warning — saves an AI retry)
    const fitSlots = (y, part, path) => {
      const was = y.layout; const n = (y.items || []).length;
      if (part === 'hook') { if (y.layout === 'hook_number' && !y.value) y.layout = n >= 2 ? 'hook_result' : 'hook_kinetic'; if (y.layout === 'hook_result' && n < 2) y.layout = 'hook_kinetic'; if (y.layout === 'hook_result' && n > 4) y.items = y.items.slice(0, 4); }
      else if (part === 'body') {
        if (y.layout === 'compare' && n !== 2) y.layout = n > 2 ? 'list_steps' : 'title_card';
        if ((y.layout === 'list_steps' || y.layout === 'checklist') && n < 2) y.layout = 'title_card';
        if (y.layout === 'stat' && !y.value) y.layout = y.icon ? 'icon_point' : 'title_card';
        if (y.layout === 'icon_point' && !y.icon) y.layout = 'title_card';
        if (y.layout === 'chat_mock' && (y.bubbles || []).length < 2) { if (!y.text && y.bubbles && y.bubbles[0]) y.text = trimTo(y.bubbles[0].text, LIM.text_chars); y.layout = 'title_card'; }
        if (y.layout === 'prompt_box' && !y.prompt) y.layout = 'title_card';
        if (y.layout === 'media' && !(y.visual && (y.visual.src || y.visual.prompt || y.visual.clip || y.visual.shots))) y.layout = 'title_card';
        if (['title_card', 'quote', 'stat', 'icon_point'].includes(y.layout) && !y.text && y.say) { y.text = autoHead(y.say, 6); fix('W_TEXT_FROM_SAY', path + '/text', 'on-screen text missing → first words of the line', 'chữ trên màn lấy từ lời đọc'); }
      }
      if (y.layout !== was) fix('W_LAYOUT_FALLBACK', path + '/layout', was + ' lacks its slots → ' + y.layout);
    };
    // hook
    s.hook = hookIn ? line(hookIn, 'hook', '/hook') : { say: '', layout: 'hook_kinetic', hook_type: 'bold_claim' };
    if (!s.hook.text && s.hook.say) { s.hook.text = hookHead(s.hook.say, s.lang); fix('W_HOOK_TEXT', '/hook/text', 'hook.text missing → first words of hook.say', 'chữ hook lấy từ câu hook'); }
    if (!s.hook.say && s.hook.text && wc(s.hook.text) >= LIM.hook_say_words[0]) { s.hook.say = speakable(s.hook.text); fix('W_HOOK_SAY', '/hook/say', 'hook.say missing → hook.text is spoken'); }
    if (s.hook.layout === 'hook_question' && s.hook.text && !/\?$/.test(s.hook.text)) s.hook.text += '?';
    fitSlots(s.hook, 'hook', '/hook');
    s.scenes = rawScenes.map((o, i) => { const y = line(o, 'body', '/scenes/' + i); fitSlots(y, 'body', '/scenes/' + i); return y; }).filter((y) => y.say || y.text || (y.items || []).length);
    // cta
    const c = ctaIn ? line(ctaIn, 'cta', '/cta') : { say: '', layout: 'cta_card', action: '' };
    const cf = fold(c.say + ' ' + (c.text || ''));
    c.action = c.action || (/telegram|\blab\b/.test(cf) || !c.say ? 'lab' : /follow|theo doi/.test(cf) ? 'follow' : /comment|binh luan/.test(cf) ? 'comment' : /\bsave\b|luu lai|\bluu\b/.test(cf) ? 'save' : 'lab');
    if (c.action === 'comment' && !c.keyword) { const kw = (c.say.match(/(?:comment|bình luận|binh luan)\s+["“'«]?([\p{L}\p{N}_-]{2,16})/iu) || [])[1];
      c.keyword = kw ? kw.toUpperCase() : (str((t.keywords || [])[0]) || 'TOOL').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'TOOL'; }
    const dflt = (k) => (s.lang === 'vi' ? CTA_DEF_VI : CTA_DEF)[c.action][k].replace('{KW}', c.keyword || 'TOOL');
    // kịch bản của anh (owner): câu CTA bot tự thêm thì báo ⚠️ (dựng luôn thì không đọc câu đó — edit.mjs); chữ CTA lấy từ chính lời CTA của anh, không lấy câu mẫu của brand
    if (!c.say) { const ownDef = opts.owner && !c.text; c.say = dflt('say'); fix(ownDef ? 'W_CTA_DEFAULT' : 'F_DEFAULT', '/cta/say', 'cta missing → brand CTA "' + c.action + '"', ownDef ? 'Kịch bản chưa có câu kêu gọi — bot thêm “' + c.say + '”; muốn câu khác thì trả lời “C: …”' : 'thêm CTA mặc định của brand'); }
    if (!c.text) { const ownSay = opts.owner && !fixes.some((x) => x.code === 'W_CTA_DEFAULT'); c.text = ownSay ? trimHead(autoHead(c.say, 4), LIM.cta_text_chars) : dflt('text'); fix(ownSay ? 'F_DERIVED' : 'F_DEFAULT', '/cta/text', ownSay ? 'cta.text missing → first words of the owner\'s CTA' : 'cta.text missing → brand default'); }
    s.cta = { action: c.action, say: c.say, text: c.text, layout: 'cta_card', ...(c.keyword ? { keyword: c.keyword } : {}) };
    // title, keywords, cover, alternatives
    s.title = txt(t.title, '/title').slice(0, LIM.title_chars) || s.topic.slice(0, LIM.title_chars) || s.hook.text || firstWords(s.hook.say, 8);
    const kw = items(t.keywords, '/keywords').map((k) => k.slice(0, LIM.keyword_chars)).filter((k) => wc(k) <= 3);
    s.keywords = kw.length ? [...new Set(kw)].slice(0, LIM.keywords) : (() => { const out = []; const add = (w) => { w = str(w).replace(/[^\p{L}\p{N}%$]/gu, ''); if (w.length > 2 && !out.some((k) => k.toLowerCase() === w.toLowerCase()) && out.length < 6) out.push(w); };
      [s.hook, ...s.scenes].forEach((o) => (o.emphasis || []).forEach(add)); for (const o of [s.hook, ...s.scenes]) for (const w of words([o.text, o.value].join(' '))) if (/\d|^[A-Z]{2,}/.test(w) || w.length >= 7) add(w); return out; })();
    const cv = isObj(t.cover) ? t.cover : { title: t.cover };
    s.cover = { title: txt(cv.title || cv.text || cv.heading, '/cover/title'), from: oneOf(cv.from, ['hook', 'scene'], 'hook') };
    if (!s.cover.title) { s.cover.title = wc(s.hook.text) >= 2 && wc(s.hook.text) <= 5 ? s.hook.text : autoHead(wc(s.hook.text) >= 2 ? s.hook.text : s.hook.say, 5); fix('F_DERIVED', '/cover/title', 'cover.title missing → hook text'); }
    const cem = txt(cv.emphasis || cv.highlight, '/cover/emphasis'); if (cem) s.cover.emphasis = cem;
    s.cover.kicker = trimTo(txt(cv.kicker || cv.series || cv.label, '/cover/kicker') || KICKER[s.content_type] || 'QUICK TIP', LIM.kicker_chars).toUpperCase();
    const alt = txt(cv.alt_title, '/cover/alt_title'); if (alt) s.cover.alt_title = alt;
    if (s.cover.from === 'scene') s.cover.scene = Math.round(clamp(cv.scene, 1, Math.max(1, s.scenes.length), 1));
    s.hooks_alt = (Array.isArray(t.hooks_alt) ? t.hooks_alt : []).filter(isObj).slice(0, LIM.hooks_alt).map((h, i) => { const y = line(h, 'hook', '/hooks_alt/' + i); return { hook_type: y.hook_type, say: y.say, text: y.text || firstWords(y.say, 5), layout: y.layout === 'hook_result' && !(y.items || []).length ? 'hook_kinetic' : y.layout, ...(y.items ? { items: y.items } : {}), ...(y.value ? { value: y.value } : {}), ...(y.emphasis ? { emphasis: y.emphasis } : {}) }; }).filter((h) => h.say);
    // 1.1: claims with a number must be cited — source "FACTS#n" (the n-th FACTS line given to the writer) or "owner" (the owner's own words)
    const fu = (Array.isArray(t.facts_used) ? t.facts_used : isObj(t.facts_used) ? Object.values(t.facts_used) : []).map((f) => (typeof f === 'string' ? { claim: f, source: '' } : f)).filter(isObj)
      .map((f) => ({ claim: txt(f.claim || f.text || f.fact, '/facts_used').slice(0, LIM.fact_chars), source: (() => { const v = str(f.source || f.from || f.ref).replace(/\s+/g, ''); const m = v.match(/^(?:facts?)?#?(\d{1,2})$/i); return m ? 'FACTS#' + Number(m[1]) : /^(owner|chu|chủ|anh)$/i.test(v) ? 'owner' : v.slice(0, 20); })() }))
      .filter((f) => f.claim && f.source && !/^(none|-)$/i.test(f.source)).slice(0, LIM.facts);
    if (fu.length) s.facts_used = fu;
    const pr = isObj(t.production) ? t.production : isObj(opts.production) ? opts.production : null; if (pr) s.production = pr; // stored, not hashed
    if (isObj(t.post)) { const cap = txt(t.post.caption, '/post').slice(0, 600); const tags = items(t.post.hashtags, '/post').map((h) => '#' + h.replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter((h) => h.length > 1).slice(0, 8); if (cap || tags.length) s.post = { caption: cap, hashtags: tags }; }
    else if (typeof t.post === 'string' && str(t.post)) s.post = { caption: str(t.post).slice(0, 600), hashtags: [] };
    if (str(t.notes_vi)) s.notes_vi = str(t.notes_vi).slice(0, 600);
    if (isObj(opts.client)) s.client = opts.client; // card passthrough comes from n8n / the bot only, never from the AI
    if (Array.isArray(t.footage) && opts.footage !== false) s.footage = t.footage.filter(isObj).slice(0, 20);
    return { spec: s, fixes };
  }

  // ---------- estimate (before TTS): mirrors spec/timing.mjs with word counts instead of mp3 durations ----------
  function lineSec(text, lang, rate, f = 1) {
    const t = str(text); const n = units(t); if (!n) return 0; const body = t.replace(/[.!?…]+\s*$/, '');
    return TIME.edge + n / ((TIME.wps[lang] || TIME.wps.en) * (1 + rate / 100) * f) + TIME.comma * (body.match(/[,;:—–]/g) || []).length + TIME.stop * (body.match(/[.!?…](\s|$)/g) || []).length;
  }
  function estimate(s, f = 1) {
    const lang = s.lang || 'en'; const rate = num(s.voice && s.voice.rate, 6); const parts = []; let t = 0;
    const push = (part, o, lead, hold, min) => { const sp = lineSec(o.say, lang, rate, f); const n = (o.items || o.bubbles || []).length;
      const d = Math.max(min, part === 'scene' && n ? TIME.per_item[0] + TIME.per_item[1] * n : 0, (sp ? lead + sp : 0) + hold);
      const start = parts.length === 0 ? 0 : parts.length === 1 ? t : t - TIME.overlap; // hook → scene 1 is a hard cut
      parts.push({ part, role: o.role || part, layout: o.layout, start: r2(start), d: r2(d), words: units(o.say), speech_end: sp ? r2(start + lead + sp - TIME.edge / 2) : null }); t = start + d; };
    push('hook', s.hook, TIME.lead.hook, s.hook.hold ?? TIME.hold.hook, TIME.min.hook);
    for (const sc of s.scenes) push('scene', sc, TIME.lead.scene, sc.hold ?? TIME.hold[sc.role] ?? TIME.hold.point, TIME.min.scene);
    push('cta', s.cta, TIME.lead.cta, TIME.hold.cta, TIME.min.cta);
    return { total: r2(t), hook_end: parts[0].speech_end || 0, words: parts.reduce((a, p) => a + p.words, 0), parts, wps: r2((TIME.wps[lang] || TIME.wps.en) * (1 + rate / 100) * f) };
  }
  function estimateAll(s) { const mid = estimate(s); const slow = estimate(s, 1 - TIME.spread); const fast = estimate(s, 1 + TIME.spread);
    return { ...mid, total_hi: slow.total, total_lo: fast.total, hook_end_hi: slow.hook_end }; }

  // ---------- validate: hard errors block (AI retry), warnings never block ----------
  function validate(input, opts = {}) {
    const n = opts.normalized ? { spec: input, fixes: [] } : normalize(input, opts);
    const errors = []; const warnings = n.fixes.filter((f) => /^W_/.test(f.code)); const fixes = n.fixes.filter((f) => !/^W_/.test(f.code));
    const E = (code, path, msg, hint, vi, extra) => errors.push({ code, path, msg, ...(hint ? { hint } : {}), ...(vi ? { vi } : {}), ...(extra || {}) });
    const W = (code, path, msg, vi) => warnings.push({ code, path, msg, ...(vi ? { vi } : {}) });
    if (!n.spec) { E('E_PARSE', '/', 'no CreativeSpec JSON object found in the answer', 'return ONE JSON object only — no prose, no markdown fences', 'AI không trả về JSON'); return { ok: false, errors, warnings, fixes, spec: null, estimate: null }; }
    const s = n.spec; const est = estimateAll(s); const formats = [].concat(opts.formats || ['9:16', '16:9']);
    const B = budgetFor(s.lang, s.voice.rate); const U = s.lang === 'vi' ? 'âm tiết' : 'từ'; const vi = s.lang === 'vi';
    if (!formats.includes(s.format)) E('E_FORMAT', '/format', 'format ' + s.format + ' is not available here (' + formats.join(', ') + ')', 'use "9:16"', 'khung ' + s.format + ' chưa hỗ trợ — dùng 9:16');
    // hook
    const h = s.hook; const hw = units(h.say);
    if (!h.say) E('E_HOOK_MISSING', '/hook/say', 'hook.say is empty', 'write the first spoken line (' + B.hook[2] + ' ' + B.unit + ' or fewer)', 'thiếu câu hook');
    else {
      if (hw < B.hook[0] || hw > B.hook[1]) E('E_HOOK_LONG', '/hook/say', 'hook.say has ' + hw + ' spoken ' + B.unit + ' (allowed ' + B.hook[0] + '–' + B.hook[1] + ')', 'use ≤ ' + B.hook[1] + ' ' + B.unit + ' (aim ' + B.hook[2] + '), no commas', 'hook ' + hw + ' ' + U + ' (' + B.hook[0] + '–' + B.hook[1] + ', nên ≤ ' + B.hook[2] + ')', { actual: hw, limit: B.hook[1] });
      else if (est.hook_end > STANDARD.hook_max) E('E_HOOK_SLOW', '/hook/voice', 'hook is spoken until ≈' + est.hook_end + ' s (must end by ' + STANDARD.hook_max + ' s)', 'cut hook.say to ≤ ' + B.hook[1] + ' ' + B.unit + ', no commas', 'hook đọc xong ~' + est.hook_end + 's (phải ≤ 3s)', { actual: est.hook_end, limit: STANDARD.hook_max });
      else if (est.hook_end > STANDARD.hook_warn || hw > B.hook[2]) W('W_HOOK_EDGE', '/hook/say', 'hook ends at ≈' + est.hook_end + ' s (' + hw + ' ' + B.unit + ') — ≤ ' + B.hook[2] + ' ' + B.unit + ' / ≤ ' + STANDARD.hook_warn + ' s hits harder', 'hook sát 3s');
      if (OPENER.test(h.say)) E('E_HOOK_OPENER', '/hook/say', 'hook opens with a greeting / intro / brand name ("' + firstWords(h.say, 3) + '…")', 'open on the result or the pain, e.g. "Your reviews already wrote your FAQ."', 'hook không được mở bằng chào hỏi / giới thiệu');
    }
    const htw = vi ? LIM.hook_text_words_vi : LIM.hook_text_words;
    if (!h.text) E('E_HOOK_TEXT', '/hook/text', 'hook.text (the frame-0 headline) is empty', 'give a 2–5 word headline', 'thiếu chữ hook trên màn');
    else if (wc(h.text) > htw || h.text.length > LIM.hook_text_chars) E('E_HOOK_TEXT', '/hook/text', 'hook.text "' + h.text + '" is too long (max ' + htw + ' ' + B.unit + ' / ' + LIM.hook_text_chars + ' characters)', 'make it the 2–5 word punch version', 'chữ hook dài quá (≤ ' + htw + ' ' + U + ')');
    else if (h.text.length > LIM.headline_chars) W('W_HEADLINE_LONG', '/hook/text', 'frame-0 headline is ' + h.text.length + ' characters — ≤ ' + LIM.headline_chars + ' keeps it ≥ 130 px', 'chữ hook hơi dài cho khung đầu');
    echo(h, '/hook', 'hook');
    slots(h, '/hook');
    if (opts.recent && [].concat(opts.recent).slice(0, 5).includes(h.hook_type)) W('W_HOOK_RECENT', '/hook/hook_type', 'hook type "' + h.hook_type + '" was used in the last 5 videos', 'kiểu hook vừa dùng gần đây');
    // the frame-0 headline is static from frame 0 (still0) and doubles as the cover: only its own words are timed here (its line speed is E_HOOK_SLOW)
    readFast({ text: h.text, value: h.value }, est.parts[0], '/hook', 'hook', false); // hook items are a glimpse of the finished result, not reading matter
    // body
    if (s.scenes.length < LIM.body[0] || s.scenes.length > LIM.body[1]) E('E_SCENES_COUNT', '/scenes', s.scenes.length + ' body scenes (hook and cta are separate; allowed ' + LIM.body.join('–') + ')', s.scenes.length > LIM.body[1] ? 'merge or delete ' + (s.scenes.length - LIM.body[1]) + ' scene(s)' : 'add ' + (LIM.body[0] - s.scenes.length) + ' scene(s)', 'cần 3–8 cảnh thân bài (đang có ' + s.scenes.length + ')');
    s.scenes.forEach((sc, i) => {
      const p = '/scenes/' + i; const w = units(sc.say); const part = est.parts[i + 1] || {};
      if (!sc.say) E('E_SAY_MISSING', p + '/say', 'scene ' + (i + 1) + ' has no spoken line', 'every scene needs say (' + B.body[0] + '–' + B.body[1] + ' ' + B.unit + ')', 'cảnh ' + (i + 1) + ' thiếu lời đọc');
      else if (w > B.body[1]) E('E_SAY_LONG', p + '/say', 'scene ' + (i + 1) + ' say has ' + w + ' ' + B.unit + ' (max ' + B.body[1] + ')', 'split it or cut to ≤ ' + B.body[2] + ' ' + B.unit, 'cảnh ' + (i + 1) + ' dài ' + w + ' ' + U + ' (tối đa ' + B.body[1] + ')', { actual: w, limit: B.body[1] });
      else if (w < B.body[0]) E('E_SAY_SHORT', p + '/say', 'scene ' + (i + 1) + ' say has ' + w + ' ' + B.unit + ' (min ' + B.body[0] + ')', 'write a full sentence', 'cảnh ' + (i + 1) + ' lời đọc quá ngắn');
      else if (part.d > LIM.scene_max_s) E('E_SCENE_SLOW', p, 'scene ' + (i + 1) + ' lasts ≈' + part.d + ' s (max ' + LIM.scene_max_s + ' s without a cut)', 'split it into two scenes', 'cảnh ' + (i + 1) + ' dài ' + part.d + 's (tối đa 9s)');
      if (part.d && part.d < LIM.scene_min_s) W('W_SCENE_SHORT', p, 'scene ' + (i + 1) + ' ≈' + part.d + ' s is very short — merge it', 'cảnh ' + (i + 1) + ' quá ngắn');
      slots(sc, p);
      if (i > 0 && s.scenes[i - 1].layout === sc.layout) W('W_SAME_LAYOUT', p + '/layout', 'same layout as the previous scene — vary for rhythm', 'cảnh ' + (i + 1) + ' trùng bố cục cảnh trước');
      const onscreen = wc([sc.text, sc.sub, sc.value, ...(sc.items || [])].join(' '));
      if (onscreen > LIM.onscreen_words + 2) W('W_READ', p, onscreen + ' words on screen — keep ≤ ' + LIM.onscreen_words, 'cảnh ' + (i + 1) + ' nhiều chữ');
      if (sc.visual && !sc.visual.src && !sc.visual.shots && opts.ci) W('W_VISUAL_CI', p + '/visual', 'AI visual without src: es-render CI has no AI keys → the scene uses a code layout', 'cảnh ' + (i + 1) + ' không có hình AI → dùng đồ hoạ');
      echo(sc, p, 'cảnh ' + (i + 1)); readFast(sc, part, p, 'cảnh ' + (i + 1), !CAPS_HIDDEN.has(sc.layout));
    });
    // cta
    const cw = units(s.cta.say);
    if (cw > B.cta[1]) E('E_CTA_LONG', '/cta/say', 'cta.say has ' + cw + ' ' + B.unit + ' (max ' + B.cta[1] + ')', 'one line ≤ ' + B.cta[2] + ' ' + B.unit + ', no URL', 'CTA dài ' + cw + ' ' + U + ' (tối đa ' + B.cta[1] + ')', { actual: cw, limit: B.cta[1] });
    readFast(s.cta, est.parts[est.parts.length - 1], '/cta', 'CTA', true);
    if (s.cta.text.length > LIM.cta_text_chars) E('E_TEXT_LONG', '/cta/text', 'cta.text is ' + s.cta.text.length + ' characters (max ' + LIM.cta_text_chars + ')', 'shorten to ≤ 6 words', 'chữ CTA dài quá');
    if (s.cta.action === 'lab' && !/lab|telegram/i.test(s.cta.say + ' ' + s.cta.text)) W('W_CTA_LAB', '/cta', 'action "lab" but the CTA does not mention the Telegram Lab', 'CTA chưa nhắc Telegram Lab');
    // one CTA, after the payoff: an ask before the payoff beat splits attention
    const pay = s.scenes.findIndex((x) => x.role === 'payoff'); const early = s.scenes.slice(0, pay < 0 ? s.scenes.length : pay).findIndex((x) => ASK_VERB.test(fold(x.say)));
    if (early >= 0) W('W_CTA_EARLY', '/scenes/' + early + '/say', 'scene ' + (early + 1) + ' asks to follow / comment / save before the payoff — keep ONE ask, in the CTA after the payoff', 'cảnh ' + (early + 1) + ' kêu gọi trước cảnh kết quả');
    // language, brand voice
    const spoken = [h.say, ...s.scenes.map((x) => x.say), s.cta.say].join(' '); const shown = [h.text, ...s.scenes.map((x) => [x.text, x.sub, ...(x.items || [])].join(' ')), s.cta.text, s.cover.title].join(' ');
    if (s.lang === 'en' && VI_RE.test(spoken + ' ' + shown)) E('E_LANG', '/lang', 'lang is "en" but the text contains Vietnamese', 'write every spoken and on-screen word in English (Vietnamese only in notes_vi)', 'lang en nhưng có chữ tiếng Việt');
    else if (opts.want_lang && s.lang !== opts.want_lang) E('E_LANG', '/lang', 'the job asked for "' + opts.want_lang + '" but the script is "' + s.lang + '"', 'write natively in ' + (opts.want_lang === 'vi' ? 'Vietnamese' : 'English') + ' and set "lang": "' + opts.want_lang + '"', 'viết sai ngôn ngữ (cần ' + (opts.want_lang === 'vi' ? 'tiếng Việt' : 'tiếng Anh') + ')');
    else if (s.lang === 'vi' && !opts.owner && h.say && !VI_RE.test(spoken)) E('E_LANG', '/lang', 'lang is "vi" but the spoken lines have no Vietnamese diacritics', 'write every spoken line in Vietnamese with full diacritics', 'lang vi nhưng lời đọc không phải tiếng Việt có dấu');
    const low = (spoken + ' ' + shown).toLowerCase(); const hype = HYPE.filter((b) => low.includes(b));
    if (hype.length) E('E_HYPE', '/', 'hype / clickbait wording: ' + hype.join(', ') + ' (brand voice: plain, concrete, no hype)', 'say the concrete result instead', 'có từ ngữ "hype" bị cấm: ' + hype.join(', '));
    const cl = cliches(spoken + ' . ' + shown);
    if (cl.length) E('E_CLICHE', '/', 'cliché wording: ' + cl.join(', '), 'say the concrete thing instead (what happens, to whom, on which screen)', 'có câu sáo rỗng: ' + cl.join(', '));
    // numbers and results: only from FACTS (or the owner's own words), cited in facts_used
    const seenBeat = new Set();
    for (const c of claims(s, opts).filter((x) => !x.cited && !seenBeat.has(x.beat) && seenBeat.add(x.beat)))
      E('E_CLAIM_NO_FACT', c.path, 'claim with a number ("' + c.text.slice(0, 70) + '") is not backed by FACTS — cite it in facts_used as FACTS#n / owner, or remove the number and describe the steps instead', 'remove the number, or use one given in FACTS and cite it', 'câu có con số chưa có nguồn: “' + c.text.slice(0, 50) + '”');
    // specificity: only FACTS items and digits count (brand / product names do not)
    const digits = new Set(); for (const o of [h, ...s.scenes, s.cta]) for (const t of [o.say, o.text, o.value, ...(o.items || [])]) for (const w of str(t).split(/\s+/)) if (/\d/.test(w)) digits.add(w.replace(/[^\d%.,]/g, ''));
    const factsN = factList(opts.facts).length; const cited = (s.facts_used || []).filter((f) => validSource(f.source, opts)).length;
    if (digits.size + cited < 2) W('W_GENERIC', '/', 'only ' + (digits.size + cited) + ' concrete token(s) (a digit or a cited FACT) — name the real number, step count or situation', 'kịch bản còn chung chung (ít con số / dữ kiện cụ thể)');
    if (!opts.owner && opts.facts != null && !factsN) W('W_NO_FACTS', '/', 'no FACTS were given — the script only tells the steps (no numbers or results)', 'Chưa có số liệu thật — kịch bản chỉ kể các bước. Trả lời “số: …” để thêm (vd “số: 1.200 khách đang dùng”)');
    // cover
    const ct = s.cover.title; const cwc = wc(ct);
    if (cwc < LIM.cover_words[0] || cwc > LIM.cover_words[1] || ct.length > LIM.cover_chars) E('E_COVER', '/cover/title', 'cover.title "' + ct + '" must be 2–5 words, ≤ ' + LIM.cover_chars + ' characters', 'same promise as the hook, other words', 'tiêu đề ảnh bìa phải 2–5 từ, ≤ 32 ký tự');
    if (s.cover.alt_title) { const a = s.cover.alt_title; if (wc(a) < 2 || wc(a) > 5 || a.length > LIM.cover_chars || a.toLowerCase() === ct.toLowerCase()) { W('W_ALT_TITLE', '/cover/alt_title', 'alt cover title must be 2–5 words, ≤ 32 chars and differ from the title → dropped'); delete s.cover.alt_title; } }
    if (s.cover.emphasis && !ct.toLowerCase().includes(s.cover.emphasis.toLowerCase())) { W('W_EMPHASIS', '/cover/emphasis', 'cover.emphasis is not a word of the title → ignored'); delete s.cover.emphasis; }
    if (h.say && ct.toLowerCase() === h.say.toLowerCase().replace(/[.!?]+$/, '')) W('W_COVER_ECHO', '/cover/title', 'cover repeats the hook sentence — same promise, different words', 'bìa trùng câu hook');
    // story shape (craft rules, warnings)
    if (!s.scenes.some((x) => x.role === 'payoff')) W('W_NO_PAYOFF', '/scenes', 'no "payoff" scene — show the promised result before the CTA', 'chưa có cảnh kết quả (payoff)');
    if (est.total >= 40 && !s.scenes.some((x, i) => x.role === 'rehook' && est.parts[i + 1] && est.parts[i + 1].start / est.total >= 0.3 && est.parts[i + 1].start / est.total <= 0.7)) W('W_NO_REHOOK', '/scenes', 'no "rehook" line between 30–70 % of the video', 'nên có 1 câu giữ chân ở giữa video');
    // length (estimate; CI re-checks with real TTS, QA checks the file)
    if (h.say && s.scenes.length) {
      const wps = est.wps;
      if (est.total > STANDARD.est_max) E('E_TOO_LONG', '/', 'estimated length ' + est.total + ' s (' + est.words + ' spoken words at ' + wps + ' words/s) is over the ' + STANDARD.est_max + ' s gate of the 30–60 s standard', 'remove about ' + Math.ceil((est.total - 50) * wps) + ' spoken words or delete ' + Math.max(1, Math.round((est.total - 50) / 6)) + ' scene(s)', 'dài ~' + Math.round(est.total) + 's (chuẩn ≤ 60s) — bớt ~' + Math.ceil((est.total - 50) * wps) + ' từ', { actual: est.total, limit: STANDARD.est_max });
      else if (est.total < STANDARD.est_min) E('E_TOO_SHORT', '/', 'estimated length ' + est.total + ' s (' + est.words + ' spoken words) is under the ' + STANDARD.est_min + ' s gate', 'add about ' + Math.ceil((40 - est.total) * wps) + ' spoken words or one more scene', 'ngắn ~' + Math.round(est.total) + 's (chuẩn ≥ 30s) — thêm ~' + Math.ceil((40 - est.total) * wps) + ' từ', { actual: est.total, limit: STANDARD.est_min });
      else if (est.total < STANDARD.ideal[0] || est.total > STANDARD.ideal[1]) W('W_DURATION_EDGE', '/', 'estimated ' + est.total + ' s (ok; ideal ' + STANDARD.ideal.join('–') + ' s)', 'độ dài sát biên');
    }
    return { ok: errors.length === 0, errors, warnings, fixes, spec: s, estimate: est };

    function slots(o, p) {
      const L = LAYOUTS[o.layout]; if (!L) return;
      for (const k of L.need) {
        if (k === 'items') { const c = (o.items || []).length; const [a, b] = L.items; if (c < a || c > b) E('E_ITEMS', p + '/items', 'layout ' + o.layout + ' needs ' + (a === b ? a : a + '–' + b) + ' items (has ' + c + ')', c > b ? 'keep the best ' + b : 'add ' + (a - c), 'bố cục ' + o.layout + ' cần ' + (a === b ? a : a + '–' + b) + ' ý'); }
        else if (k === 'bubbles') { const c = (o.bubbles || []).length; if (c < LIM.bubbles[0] || c > LIM.bubbles[1]) E('E_ITEMS', p + '/bubbles', 'chat_mock needs 2–4 bubbles (has ' + c + ')', 'keep 2–4 short messages', 'cần 2–4 tin nhắn'); }
        else if (k === 'visual') { /* media without visual falls back in normalize */ }
        else if (!str(o[k])) E('E_SLOT', p + '/' + k, 'layout ' + o.layout + ' needs "' + k + '"', 'fill "' + k + '" or pick another layout', 'bố cục ' + o.layout + ' thiếu "' + k + '"');
      }
      const long = (k, max) => { if (o[k] && o[k].length > max) E('E_TEXT_LONG', p + '/' + k, k + ' is ' + o[k].length + ' characters (max ' + max + ', it must fit on screen)', 'shorten to ≤ ' + max + ' characters', p.replace('/scenes/', 'cảnh ') + ': ' + k + ' dài quá'); };
      if (p !== '/hook') long('text', LIM.text_chars); long('sub', LIM.sub_chars); long('value', LIM.value_chars); long('prompt', LIM.prompt_chars);
      (o.items || []).forEach((it, j) => { if (it.length > LIM.item_chars) E('E_TEXT_LONG', p + '/items/' + j, 'item ' + (j + 1) + ' is ' + it.length + ' characters (max ' + LIM.item_chars + ')', 'shorten to ≤ 4 words', 'ý ' + (j + 1) + ' dài quá'); });
      (o.bubbles || []).forEach((b, j) => { if (b.text.length > LIM.bubble_chars) E('E_TEXT_LONG', p + '/bubbles/' + j, 'bubble ' + (j + 1) + ' is too long (max ' + LIM.bubble_chars + ' characters)', 'shorten it', 'tin nhắn ' + (j + 1) + ' dài quá'); });
      if ((o.emphasis || []).length > LIM.emphasis) o.emphasis = o.emphasis.slice(0, LIM.emphasis);
      for (const e of o.emphasis || []) if (!(o.say + ' ' + (o.text || '')).toLowerCase().includes(e.toLowerCase())) { W('W_EMPHASIS', p + '/emphasis', '"' + e + '" is not in this line → ignored'); o.emphasis = o.emphasis.filter((x) => x !== e); }
    }
    // text = the keyword / number, not the transcript: > 50 % of its tokens heard in the same line (headlines of 3+ tokens)
    function echo(o, p, name) {
      const said = new Set(toks(o.say)); const t = toks(o.text); if (t.length < 3) return;
      const fz = (x) => fold(x).replace(/[^a-z0-9%]+$/, ''); const ft = fz(o.text);
      if ([5, 6].some((k) => ft === fz(firstWords(o.say, k)) || ft === fz(autoHead(o.say, k))) || ft === fz(hookHead(o.say, VI_RE.test(o.say) ? 'vi' : 'en'))) return; // headline auto-derived from the line by normalize (W_TEXT_FROM_SAY / W_HOOK_TEXT), not written
      const share = t.filter((x) => said.has(x)).length / t.length;
      if (share > LIM.echo) W('W_TEXT_ECHO', p + '/text', name + ' text repeats ' + Math.round(share * 100) + ' % of its spoken line — show the keyword or number, not the transcript', name + ': chữ trên màn lặp lời đọc');
    }
    // reading time: (on-screen words + caption words shown in the same beat) × 0.25 s + 0.5 s must fit the beat
    function readFast(o, part, p, name, caps) {
      if (!part || !part.d) return;
      const screen = wc([o.text, o.sub, o.value, ...(o.items || []), ...(o.bubbles || []).map((b) => b.text)].join(' ')); const cap = caps ? wc(o.say) : 0;
      const need = r2((screen + cap) * (vi ? LIM.read_syll_s_vi : LIM.read_word_s) + LIM.read_base_s);
      if (screen && need > part.d) W('W_READ_FAST', p, name + ': ' + (screen + cap) + ' words to read (' + screen + ' on screen' + (cap ? ' + ' + cap + ' in captions' : '') + ') need ≈' + need + ' s, the beat lasts ≈' + part.d + ' s — fewer on-screen words', name + ': nhiều chữ để đọc kịp');
    }
  }
  // ---------- 1.1 lint helpers ----------
  const toks = (t) => fold(plain(t)).split(/[^a-z0-9%]+/).filter((x) => x.length > 0);
  const factList = (f) => (f == null ? [] : Array.isArray(f) ? f : String(f).split(/\n+/)).map((x) => str(typeof x === 'string' ? x : x && (x.claim || x.text)).replace(/^\s*(?:facts?\s*#?\s*\d+\s*[:.)]\s*|[-•*]\s+|\d{1,2}[.)]\s+)/i, '')).filter(Boolean); // strips "1. …" / "- …" / "FACTS#2: …", never "1.200 khách"
  function validSource(src, opts = {}) {
    if (src === 'owner') return true; const m = /^FACTS#(\d+)$/.exec(String(src || '')); if (!m) return false;
    const n = factList(opts.facts).length; return opts.facts == null || (+m[1] >= 1 && +m[1] <= n);
  }
  function cliches(text) {
    const f = ' ' + fold(text).replace(/\s+/g, ' ') + ' '; const out = [];
    for (const c of [...CLICHE.en, ...CLICHE.vi]) if (f.includes(c)) out.push(c);
    for (const re of CLICHE.en_re) { const m = f.match(re); if (m) out.push(m[0].trim().slice(0, 30)); }
    return [...new Set(out)];
  }
  // numbers inside a sentence, with what follows them. Accented text is matched with accented words ("sau" = after ≠ "sáu" = six);
  // text without Vietnamese diacritics is matched folded (unaccented VI or EN).
  const NUM_ACC = ['hai', 'ba', 'bốn', 'tư', 'năm', 'lăm', 'sáu', 'bảy', 'bẩy', 'tám', 'chín', 'mười', 'mươi', 'mốt', 'trăm', 'nghìn', 'ngàn', 'triệu', 'tỷ', 'tỉ', 'rưỡi'];
  const NUM_VAL = { 'một': 1, mot: 1, one: 1, hai: 2, two: 2, ba: 3, three: 3, 'bốn': 4, bon: 4, 'tư': 4, four: 4, 'năm': 5, nam: 5, 'lăm': 5, five: 5, 'sáu': 6, sau: 6, six: 6, 'bảy': 7, 'bẩy': 7, bay: 7, seven: 7,
    'tám': 8, tam: 8, eight: 8, 'chín': 9, chin: 9, nine: 9, 'mười': 10, muoi: 10, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, 'mốt': 1, half: 0.5, 'rưỡi': 0.5, ruoi: 0.5, dozen: 12 };
  const MULT = { 'mươi': 10, muoi: 10, 'trăm': 100, tram: 100, hundred: 100, 'nghìn': 1e3, nghin: 1e3, 'ngàn': 1e3, ngan: 1e3, thousand: 1e3, 'triệu': 1e6, trieu: 1e6, million: 1e6, 'tỷ': 1e9, 'tỉ': 1e9, ty: 1e9 };
  const EN_NUM = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'fifteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'half', 'dozen'];
  const NUM_SET = { acc: new Set([...NUM_ACC, ...EN_NUM]), fold: new Set(['hai', 'ba', 'bon', 'nam', 'sau', 'bay', 'tam', 'chin', 'muoi', 'tram', 'nghin', 'ngan', 'trieu', 'ruoi', ...EN_NUM]) };
  const UNIT_ACC = ['giây', 'phút', 'giờ', 'tiếng', 'ngày', 'tuần', 'tháng', 'lần', 'nghìn', 'ngàn', 'triệu', 'tỷ', 'đơn', 'khách', 'đồng', 'đ'];
  const UNIT_EN = ['%', 'k', 'x', 'times', 'percent', 'second', 'seconds', 'sec', 'secs', 'minute', 'minutes', 'min', 'mins', 'hour', 'hours', 'hr', 'hrs', 'day', 'days', 'week', 'weeks', 'month', 'months', 'customers', 'clients', 'orders', 'users', 'people'];
  const UNIT_SET = { acc: new Set([...UNIT_ACC, ...UNIT_EN]), fold: new Set([...UNIT_ACC.map(fold), ...UNIT_EN]) };
  const TIME_SET = { acc: new Set(['giây', 'phút', 'giờ', 'tiếng', 'ngày', 'tuần', 'tháng', 'second', 'seconds', 'minute', 'minutes', 'hour', 'hours', 'day', 'days', 'week', 'weeks', 'month', 'months']) };
  TIME_SET.fold = new Set([...TIME_SET.acc].map(fold));
  const VERB_ACC = ['tiết kiệm', 'nhanh hơn', 'nhanh gấp', 'tăng', 'giảm', 'chỉ còn', 'chỉ mất', 'chỉ cần', 'xong trong'];
  const VERB_EN = /(^| )(save[sd]?|saving|faster|more|less|fewer|cuts?|boost(s|ed)?|only|increase[sd]?|reduce[sd]?|double[sd]?|triple[sd]?|grows?|earns?|in under|in just)( |$)/;
  function numKey(group) { // tokens of one number → canonical digits ("1.200" → 1200, "hai mươi lăm" → 25)
    if (group.length === 1 && /\d/.test(group[0])) return group[0].replace(/[^\d]/g, '');
    let total = 0, cur = 0;
    for (const t of group) { if (/\d/.test(t)) cur += Number(t.replace(/[^\d]/g, '')) || 0; else if (MULT[t]) { if (MULT[t] >= 1e3) { total += (cur || 1) * MULT[t]; cur = 0; } else cur = (cur || 1) * MULT[t]; } else if (NUM_VAL[t] != null) cur += NUM_VAL[t]; }
    return String(total + cur);
  }
  function numbersIn(sentence) { // → { claim: bool, keys: [canonical numbers attached to a unit / % / gấp / lần] }
    const accented = VI_RE.test(sentence); const mode = accented ? 'acc' : 'fold';
    const norm = (accented ? String(sentence).toLowerCase().normalize('NFC') : fold(sentence)).replace(/%/g, ' % ').replace(/[$€£]\s?(?=\d)/g, ' $ ').replace(/(\d)(?=\p{L})/gu, '$1 ');
    const T = norm.split(/[^\p{L}\p{N}%$.,]+/u).map((x) => x.replace(/^[.,]+|[.,]+$/g, '')).filter(Boolean);
    const isNum = (t) => /^\d[\d.,]*$/.test(t) || NUM_SET[mode].has(t);
    // "một" / "one" is a number only before a time unit ("một phút") or a multiplier ("một nghìn"): "một hoá đơn", "bấm một lần" are no claims
    const one = (i) => (T[i] === (accented ? 'một' : 'mot') || T[i] === 'one') && (TIME_SET[mode].has(T[i + 1]) || MULT[T[i + 1]] >= 100);
    const keys = []; let direct = false; let unit = false;
    for (let i = 0; i < T.length; i++) {
      if (T[i] === '%') direct = true;
      if (!isNum(T[i]) && !one(i)) continue;
      // one number = the first token + spelled continuations ("hai mươi lăm", "1 nghìn", "một nghìn hai trăm"); "500 một tháng" stops before "một"
      let j = i + 1; while (j < T.length && (NUM_SET[mode].has(T[j]) || /^(lăm|mốt)$/.test(T[j]) || ((T[j] === 'một' || T[j] === 'mot') && MULT[T[j + 1]] >= 100))) j++;
      const group = T.slice(i, j); const next = T[j] || ''; const prev = T[i - 1] || '';
      const pct = next === '%' || next === 'percent' || (/^(phần|phan)$/.test(next) && /^(trăm|tram)$/.test(T[j + 1] || ''));
      const times = /^(lần|lan|times|x)$/.test(next); const gap = accented ? prev === 'gấp' : prev === 'gap';
      // money, and a count of customers / users / orders ≥ 100, are claims even without a result verb ("1.200 khách đang dùng", "$500")
      const money = prev === '$' || /^(đ|d|đồng|dong|usd|vnd|k)$/.test(next); const crowd = /^(khách|khach|customers|clients|users|people|orders|đơn|don)$/.test(next) && Number(numKey(group)) >= 100;
      if (pct || times || gap || money || crowd) direct = true;
      if (pct || times || gap || money || crowd || UNIT_SET[mode].has(next)) { unit = true; keys.push(numKey(group)); }
      i = j - 1;
    }
    const joined = ' ' + T.join(' ') + ' ';
    const verb = VERB_EN.test(T.join(' ')) || VERB_ACC.some((v) => joined.includes(' ' + (accented ? v : fold(v)) + ' '));
    return { claim: direct || (unit && verb), keys };
  }
  // claims(spec, {facts, ownerText}) → [{ path, text, keys, cited }] — every sentence of hook / scenes / CTA (say, text, value, items) that states a number result
  function claims(s, opts = {}) {
    const fl = factList(opts.facts); const out = [];
    const refs = (s.facts_used || []).filter((f) => validSource(f.source, opts)).map((f) => {
      const m = /^FACTS#(\d+)$/.exec(f.source); const ref = m && opts.facts != null ? fl[+m[1] - 1] : f.source === 'owner' && opts.ownerText != null ? String(opts.ownerText) : f.claim;
      return new Set(sentences(ref).flatMap((x) => numbersIn(x).keys).concat(allKeys(ref)));
    });
    const known = new Set(refs.flatMap((r) => [...r]));
    const beats = [['/hook', s.hook, ['say', 'text', 'value']], ...(s.scenes || []).map((x, i) => ['/scenes/' + i, x, ['say', 'text', 'value', 'items', 'sub']]), ['/cta', s.cta, ['say', 'text']]];
    for (const [p, o, keys] of beats) for (const k of keys) for (const v of (k === 'items' ? o.items || [] : [o[k]])) for (const sen of sentences(v)) {
      const r = numbersIn(sen); if (r.claim) out.push({ path: p + '/' + k, beat: p, text: sen, keys: r.keys, cited: r.keys.length > 0 && r.keys.every((x) => known.has(x)) || (!r.keys.length && refs.length > 0) });
    }
    return out;
  }
  const sentences = (v) => str(v).split(/(?<=[.!?…])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  function allKeys(t) { // every number of a FACTS / owner line, digits or spelled (a fact line need not carry a unit)
    const out = []; const accented = VI_RE.test(t); const T = (accented ? String(t).toLowerCase().normalize('NFC') : fold(t)).replace(/(\d)(?=\p{L})/gu, '$1 ').split(/[^\p{L}\p{N}.,]+/u).map((x) => x.replace(/^[.,]+|[.,]+$/g, '')).filter(Boolean);
    const isNum = (x) => /^\d[\d.,]*$/.test(x) || NUM_SET[accented ? 'acc' : 'fold'].has(x) || x === 'một' || x === 'mot';
    for (let i = 0; i < T.length; i++) { if (!isNum(T[i])) continue; let j = i; while (j < T.length && isNum(T[j])) j++; out.push(numKey(T.slice(i, j))); i = j - 1; }
    return out;
  }

  // ---------- salvage: deterministic last-attempt repair. Never invents content (only trims, drops, re-paces) ----------
  function salvage(spec0, opts = {}) {
    const s = JSON.parse(JSON.stringify(spec0)); const did = [];
    const cut = (t, n) => { const w = str(t).split(' '); return w.length <= n ? str(t) : w.slice(0, n).join(' ').replace(/[,;:]+$/, '') + '.'; };
    const Bf = () => budgetFor(s.lang, s.voice.rate); const htw = s.lang === 'vi' ? LIM.hook_text_words_vi : LIM.hook_text_words;
    if (OPENER.test(s.hook.say)) { const rest = s.hook.say.replace(OPENER, ''); if (wc(rest) >= 3) { s.hook.say = rest.charAt(0).toUpperCase() + rest.slice(1); did.push('hook opener removed'); } }
    const hookFits = () => estimate(s).hook_end <= STANDARD.hook_max - 0.15 && units(s.hook.say) <= Bf().hook[1];
    if (!hookFits()) { const ht = speakable(s.hook.text); const hk = Bf().hook[1]; s.hook.say = wc(ht) >= 3 && wc(ht) <= hk ? ht.replace(/[.!?]*$/, '.') : cut(s.hook.say, hk); did.push('hook shortened'); }
    for (let k = Bf().hook[1]; !hookFits() && k >= 3; k--) s.hook.say = cut(s.hook.say, k);
    if (wc(s.hook.text) > htw || s.hook.text.length > LIM.hook_text_chars) { s.hook.text = trimHead(firstWords(s.hook.text, 5), LIM.hook_text_chars); did.push('hook text trimmed'); }
    for (const o of [s.hook, ...s.scenes]) {
      for (const [k, m] of [['text', LIM.text_chars], ['sub', LIM.sub_chars], ['prompt', LIM.prompt_chars], ['value', LIM.value_chars]]) if (o[k] && o[k].length > m && !(o === s.hook && k === 'text')) { o[k] = trimTo(o[k], m); did.push(k + ' trimmed'); }
      const L = LAYOUTS[o.layout]; if (o.items) { const mx = L && L.items ? L.items[1] : 5; if (o.items.length > mx) { o.items = o.items.slice(0, mx); did.push('items trimmed'); } o.items = o.items.map((t) => trimTo(t, LIM.item_chars)); }
      if (o.bubbles) o.bubbles = o.bubbles.slice(0, LIM.bubbles[1]).map((b) => ({ ...b, text: trimTo(b.text, LIM.bubble_chars) }));
      const bd = Bf().body; if (o !== s.hook && units(o.say) > bd[1]) { const first = (o.say.match(/^[^.!?]+[.!?]/) || [o.say])[0]; o.say = units(first) >= bd[0] + 2 && units(first) <= bd[1] ? first : cut(o.say, bd[2]); did.push('long line cut'); }
    }
    s.scenes = s.scenes.filter((o) => units(o.say) >= Bf().body[0]);
    const CD = s.lang === 'vi' ? CTA_DEF_VI : CTA_DEF;
    if (units(s.cta.say) > Bf().cta[1]) { s.cta.say = CD[s.cta.action].say.replace('{KW}', s.cta.keyword || 'TOOL'); did.push('cta → brand default'); }
    if (s.cta.text.length > LIM.cta_text_chars) { s.cta.text = CD[s.cta.action].text.replace('{KW}', s.cta.keyword || 'TOOL'); did.push('cta text → brand default'); }
    const ct = s.cover.title; if (wc(ct) < 2 || wc(ct) > 5 || ct.length > LIM.cover_chars) { const h = wc(s.hook.text) >= 2 ? s.hook.text : s.hook.say; s.cover.title = trimHead(autoHead(h, 5), LIM.cover_chars); did.push('cover title from hook'); }
    // too many scenes / too long: drop the wordiest middle scene (never the first, never the payoff, never the last before the CTA)
    const droppable = () => s.scenes.map((x, i) => ({ x, i })).filter(({ x, i }) => i > 0 && i < s.scenes.length - 1 && x.role !== 'payoff');
    while (s.scenes.length > LIM.body[1] || (estimate(s).total > STANDARD.est_max - 2 && s.scenes.length > LIM.body[0])) { const c = droppable(); if (!c.length) break; const k = c.sort((a, b) => units(b.x.say) - units(a.x.say))[0].i; s.scenes.splice(k, 1); did.push('scene ' + (k + 1) + ' dropped'); }
    for (let g = 0; estimate(s).total > STANDARD.est_max - 1 && s.voice.rate < 12 && g < 4; g++) { s.voice.rate += 3; did.push('pace +3%'); }
    // too short: slower pace + longer holds (never new words)
    for (let g = 0; estimate(s).total < STANDARD.est_min + 1 && g < 6; g++) { for (const x of s.scenes) x.hold = r2(Math.min(1.2, (x.hold ?? TIME.hold[x.role] ?? 0.2) + 0.25)); if (s.voice.rate > -4) s.voice.rate -= 2; did.push('holds +0.25 s'); }
    const r = validate(s, { ...opts, normalized: true }); r.salvaged = [...new Set(did)];
    if (r.ok && did.length) r.warnings.unshift({ code: 'W_SALVAGED', path: '/', msg: 'repaired automatically on the last attempt: ' + r.salvaged.join(', '), vi: 'đã tự sửa: ' + r.salvaged.join(', ') });
    return r;
  }

  // ---------- feedback for the AI retry: one line per problem, exact numbers, imperative ----------
  function feedback(res) {
    const e = (res.errors || []).slice(0, 12).map((x, i) => (i + 1) + '. [' + x.code + ' ' + (x.path || '/') + '] ' + x.msg + (x.hint ? ' → ' + x.hint : ''));
    const w = (res.warnings || []).filter((x) => /W_HOOK_EDGE|W_TEXT_ECHO|W_SAME_LAYOUT|W_NO_PAYOFF|W_NO_REHOOK|W_READ_FAST|W_CTA_EARLY|W_HEADLINE_LONG/.test(x.code)).slice(0, 4).map((x) => (x.path || '') + ' ' + x.msg);
    const est = res.estimate;
    return 'Your previous CreativeSpec JSON breaks the ES Short standard (30–60 s, hook spoken within 3 s). Fix ONLY these problems and return the COMPLETE corrected JSON, same shape, no commentary:\n'
      + e.join('\n') + (w.length ? '\nAlso improve if easy (not required): ' + w.join('; ') : '')
      + (est ? '\nCurrent estimate: ' + est.total + ' s, hook ends at ' + est.hook_end + ' s, ' + est.words + ' spoken words, ' + (est.parts.length - 2) + ' body scenes.' : '') + '\nKeep everything that was not mentioned unchanged.';
  }

  // ---------- full pipeline used by n8n node 2, es-render CI and es-editor ----------
  // check(raw, { attempt, max, recent, formats, id, lang, format, genre, facts, ownerText, owner, client, ci })
  //   → { ok, review, salvaged, spec, errors, warnings, fixes, estimate, feedback, hash, core }
  // owner: the owner's own words (import, pasted text, rule edits) — only structural codes block; everything else becomes a ⚠️ warning and nothing is salvaged
  function check(raw, opts = {}) {
    const attempt = num(opts.attempt, 1); const max = num(opts.max, 3);
    const obj = raw && isObj(raw) && (raw.hook || raw.scenes || /^es\.creative/.test(str(raw.version))) ? raw : fromAI(raw);
    let res = validate(obj, opts); res.salvaged = null; res.review = false;
    if (opts.owner) {
      const keep = res.errors.filter((x) => OWNER_BLOCK.has(x.code) || (x.code === 'E_SCENES_COUNT' && res.spec && !res.spec.scenes.length));
      res.warnings.unshift(...res.errors.filter((x) => !keep.includes(x))); res.errors = keep; res.ok = !keep.length;
    } else if (!res.ok && attempt >= max && res.spec) {
      const blocking = res.errors.filter((x) => ['E_PARSE', 'E_LANG', 'E_HOOK_MISSING', 'E_FORMAT'].includes(x.code) || (x.code === 'E_SCENES_COUNT' && res.spec.scenes.length < LIM.body[0]));
      if (!blocking.length) { const sv = salvage(res.spec, opts); if (sv.ok || sv.errors.length < res.errors.length) res = sv; }
      // brand-rule errors salvage cannot fix → render, but route to 👀 review instead of auto-posting
      if (!res.ok && res.errors.every((x) => REVIEW_OK.has(x.code))) { res.warnings.unshift(...res.errors.map((x) => ({ ...x, code: x.code.replace(/^E_/, 'W_') }))); res.errors = []; res.ok = true; res.review = true; }
    }
    res.review = !!res.review; res.feedback = res.ok ? '' : feedback(res); res.hash = res.spec ? specHash(res.spec) : ''; res.core = CORE; res.attempt = attempt;
    return res;
  }

  // ---------- JSON Schema for structured output ----------
  // strict: every object closed + every key required, "" / [] mean empty (Claude output_config.format + OpenAI strict json_schema; only
  // type/enum/properties/required/items/additionalProperties — no length or count keywords, which Claude rejects). gemini: same without
  // additionalProperties (Gemini responseSchema does not accept it).
  function llmSchema({ strict = true } = {}) {
    const S = { type: 'string' }; const A = { type: 'array', items: { type: 'string' } };
    // 1.1: no "" inside an enum (the live n8n Editor schema moved to "none", F 76292deb: Gemini's fallback rejects empty enum values); "none" = no icon
    const E = (list) => ({ type: 'string', enum: list }); const ICON_IDS = Object.keys(ICONS).concat(['none']); const VK = E(VISUAL_KINDS);
    const obj = (props) => (strict ? { type: 'object', additionalProperties: false, required: Object.keys(props), properties: props } : { type: 'object', required: Object.keys(props), properties: props });
    const hookProps = { hook_type: E(HOOK_TYPES), layout: E(Object.keys(LAYOUTS).filter((k) => LAYOUTS[k].part === 'hook')), say: S, text: S, emphasis: S, value: S, items: A, visual_kind: VK };
    return obj({
      version: E([VERSION]), lang: E(['en', 'vi']), content_type: E(CONTENT_TYPES), genre: E(GENRES), structure: E(STRUCTURES), topic: S, promise: S, title: S, energy: E(ENERGY), voice: E(Object.keys(VOICES)),
      music: E(MOODS.filter((m) => m !== 'auto')), keywords: A, hook: obj(hookProps),
      scenes: { type: 'array', items: obj({ role: E(ROLES), layout: E(Object.keys(LAYOUTS).filter((k) => LAYOUTS[k].part === 'body')), say: S, text: S, sub: S, items: A, value: S, icon: E(ICON_IDS), prompt: S,
        bubbles: { type: 'array', items: obj({ from: E(['them', 'me']), text: S }) }, emphasis: S, visual_prompt: S, visual_kind: VK, visual_hint: S, sfx_cue: E(SFX_CUES) }) },
      cta: obj({ action: E(ACTIONS), say: S, text: S, keyword: S }),
      cover: obj({ title: S, alt_title: S, emphasis: S, kicker: S }),
      hooks_alt: { type: 'array', items: obj({ hook_type: E(HOOK_TYPES), say: S, text: S }) },
      facts_used: { type: 'array', items: obj({ claim: S, source: S }) },
      post: obj({ caption: S, hashtags: A }), notes_vi: S,
    });
  }

  // ---------- prompt: one builder for n8n ES · 2 and es-editor (brain.mjs) ----------
  // input: { topic, facts, points, hook_idea, content_type, target, lang, cta, notes, playbook{brand,positioning,what,audience,voice,cta_rules,never}, recent[], extra,
  //          retry: { attempt, max, feedback, prev } }
  const PB = { brand: 'ETHAN STUDIO', positioning: 'Smart tools for small business & everyday life.', what: 'Apps · Templates · AI automations',
    audience: 'International, English-speaking small-business owners, freelancers and busy people (US first).',
    voice: 'Friendly builder talking to a peer. Plain, concrete, practical. Short sentences. No hype words, no fake numbers, no clickbait. Show the actual steps or the actual result.',
    cta_rules: 'Video CTA: invite people to the free Telegram Lab (a free tool every Wednesday), or follow for a new tool every week / comment a keyword / save this. Never read a URL aloud.',
    never: ['Never promise delivery dates, prices or refunds.', 'Never share personal phone numbers or bank details.'] };
  const BEATS = {
    tool_drop: 'hook (result_first: the tool already working) → context (the annoying job it removes) → 2–3 demo/point scenes (prompt_box, chat_mock, list_steps) → payoff (the finished result) → cta lab',
    lab_call: 'hook (question) → context → 2 point scenes (what is inside the Lab, checklist) → proof (a real example) → cta lab',
    tip: 'hook → context (why it matters, one line) → 2–3 point scenes → rehook in the middle → payoff → cta',
    how_to: 'hook (result_first) → one step per scene (list_steps / prompt_box / checklist) → payoff (show the result) → cta',
    list: 'hook (number: "3 …") → one scene per item (3–5, vary layouts) → payoff → cta save',
    myth_fact: 'hook (myth) → compare [myth, fact] → proof → point (what to do instead) → payoff → cta',
    before_after: 'hook (before_after) → context (the pain) → 2 steps → payoff (compare) → cta',
    story: 'hook (pov or curiosity_gap) → context → rehook (the turn) → point/proof → payoff → cta follow' };
  const STRUCT_BEATS = {
    pas: 'hook (the pain: mistake / question) → context: the pain in ONE concrete situation → 2–3 point/demo scenes: the fix, one step each → payoff: the result on screen → cta',
    list: 'hook (number: "3 …" / "N cách") → one scene per item (3–5, vary layouts), the best item LAST with a rehook line before it → payoff: recap or the best result → cta save',
    result_first: 'hook (result_first: the finished result already on screen) → one step per scene (prompt_box / list_steps / checklist) → rehook → payoff: the same result, now explained → cta',
    story: 'hook (pov / curiosity_gap, in the middle of the action) → context (setup) → point (the conflict) → rehook (the turn) → proof (what changed) → payoff (the lesson) → cta follow',
    before_after: 'hook (before_after: tease the after) → context: the before, the pain → 2 steps: the process → payoff: compare before / after, held ≥ 2 s → cta',
    myth_fact: 'hook (myth) → compare [myth, fact] → proof → point (what to do instead) → payoff → cta',
    compare: 'hook (question or before_after) → one compare scene per criterion (A vs B) → payoff: the verdict → cta' };
  const GENRE_PRESET = {
    list: 'layouts hook_number, list_steps, checklist, icon_point, stat · visual_kind: code; motion ≤ 2; no still · energy normal · cta save',
    explainer: 'layouts hook_result, prompt_box, chat_mock, compare, list_steps, stat · visual_kind: code; motion ≤ 2; still ≤ 1 (a real-world context shot) · cta lab',
    promo: 'layouts hook_result, media, compare, stat · footage first when AVAILABLE FOOTAGE matches; still ≤ 2; motion ≤ 2 · energy high · cta lab or follow',
    story: 'layouts hook_kinetic, quote, title_card, media · footage first; still ≤ 3 (setting, objects — never a fake "real" person); motion ≤ 1 · energy calm · cta follow',
    talking_head: 'the owner talks to camera (visual_kind talk); cards only for list / stat / compare / quote lines; lines short, one breath each' };
  // fallback example = editor/spec/examples/explainer.en.json (a test keeps them identical); script.mjs passes the example of the job's genre + language
  const EXAMPLE = {"version":"es.creative/1.1","lang":"en","content_type":"tip","genre":"explainer","structure":"result_first","topic":"Turn customer reviews into FAQ answers with one prompt","promise":"Paste your reviews, get a ready FAQ section","title":"Your reviews already wrote your FAQ","energy":"normal","voice":"andrew","music":"tech","keywords":["FAQ","reviews","prompt"],"hook":{"hook_type":"result_first","layout":"hook_result","say":"Your reviews already wrote your FAQ.","text":"Reviews → FAQ","emphasis":"FAQ","value":"","items":["Q: Does it run small?","Q: How long is shipping?","Q: Is it dishwasher safe?"],"visual_kind":"code"},"scenes":[{"role":"context","layout":"title_card","say":"Customers keep asking the same questions, and the answers already sit in your reviews.","text":"Inbox on repeat","sub":"","items":[],"value":"","icon":"none","prompt":"","bubbles":[],"emphasis":"reviews","visual_prompt":"","visual_kind":"code","visual_hint":"one bold line on the brand background","sfx_cue":"none"},{"role":"point","layout":"list_steps","say":"Step one: export your latest reviews into one plain text file.","text":"Get the raw words","sub":"","items":["Shop dashboard","Export as CSV","Last 50 reviews"],"value":"","icon":"none","prompt":"","bubbles":[],"emphasis":"","visual_prompt":"","visual_kind":"code","visual_hint":"three steps land one by one","sfx_cue":"none"},{"role":"demo","layout":"prompt_box","say":"Step two: paste them into this prompt and ask for the top questions with short answers.","text":"ChatGPT","sub":"","items":[],"value":"","icon":"none","prompt":"From these reviews, list the questions buyers ask most. Answer each in 2 sentences, using only facts from the reviews.","bubbles":[],"emphasis":"prompt","visual_prompt":"","visual_kind":"code","visual_hint":"the prompt types itself in an app window","sfx_cue":"none"},{"role":"rehook","layout":"icon_point","say":"But the last step is the one that makes buyers trust it.","text":"Proof wins","sub":"","items":[],"value":"","icon":"shield","prompt":"","bubbles":[],"emphasis":"","visual_prompt":"a shield closes around a short answer card","visual_kind":"motion","visual_hint":"shield icon, short motion","sfx_cue":"hit"},{"role":"point","layout":"checklist","say":"Quote one real review under each answer, so every claim has proof.","text":"Show the receipt","sub":"","items":["Answer","Real quote","Star rating"],"value":"","icon":"none","prompt":"","bubbles":[],"emphasis":"","visual_prompt":"","visual_kind":"code","visual_hint":"boxes tick as they are spoken","sfx_cue":"none"},{"role":"payoff","layout":"compare","say":"On our test shop, it took only two minutes for fifty reviews.","text":"Before and after","sub":"","items":["Inbox full of questions","FAQ answers them first"],"value":"","icon":"none","prompt":"","bubbles":[],"emphasis":"","visual_prompt":"the inbox empties while an FAQ list fills up","visual_kind":"motion","visual_hint":"before / after, held","sfx_cue":"ding"}],"cta":{"action":"lab","say":"Get the prompt in our Telegram Lab.","text":"Free prompt in the Lab","keyword":""},"cover":{"title":"Reviews into FAQ","alt_title":"FAQ from your reviews","emphasis":"FAQ","kicker":"FREE PROMPT"},"hooks_alt":[{"hook_type":"mistake","say":"Stop writing your FAQ from scratch.","text":"Stop writing FAQs"},{"hook_type":"question","say":"Same five questions in your inbox again?","text":"Same 5 questions?"}],"facts_used":[{"claim":"On our test shop, it took only two minutes for fifty reviews.","source":"FACTS#1"}],"post":{"caption":"","hashtags":[]},"notes_vi":"Video ~40s: dùng đánh giá của khách viết FAQ bằng 1 prompt; số liệu lấy từ FACTS#1."};
  // prompt(input) → { system, user, prompt, schema, temperature, gemini_body, budget }
  // input: { topic | idea, brief, facts (string lines | array), learnings, lang, target, format | aspect, genre, mode ('make'|'talk'|'voiceover'), recent[] (hook types of the
  //          last 5 scripts), extra, example (a valid spec of the same genre + language), playbook{…}, voice_md, footage (AVAILABLE FOOTAGE text), content_type, hook_idea,
  //          points, cta, notes, retry: { attempt, max, feedback, prev } }
  function prompt(input = {}) {
    const pb = { ...PB, ...(isObj(input.playbook) ? Object.fromEntries(['brand', 'positioning', 'what', 'audience', 'voice', 'cta_rules', 'never'].filter((k) => input.playbook[k]).map((k) => [k, input.playbook[k]])) : {}) };
    const lang = input.lang === 'vi' ? 'vi' : 'en'; const target = Math.round(clamp(input.target, 30, 60, 45)); const vi = lang === 'vi';
    const format = ['9:16', '16:9'].includes(str(input.format || input.aspect)) ? str(input.format || input.aspect) : '9:16';
    const genre = GENRES.includes(str(input.genre)) ? str(input.genre) : ''; const mode = ['make', 'talk', 'voiceover'].includes(str(input.mode)) ? str(input.mode) : 'make';
    const ctype = input.content_type ? oneOf(input.content_type, CONTENT_TYPES, 'tip') : '';
    const B = budgetFor(lang, ENERGY_RATE.normal); const tot = B.total(target); const u = vi ? 'syllables (each space-separated word counts 1)' : 'words';
    const recent = [].concat(input.recent || []).filter(Boolean).slice(0, 5);
    const facts = factList(input.facts).slice(0, LIM.facts);
    const lays = (part) => Object.entries(LAYOUTS).filter(([, v]) => v.part === part).map(([k, v]) => '  ' + k + ' — ' + v.desc + ' · needs ' + v.need.join(' + ') + (v.items ? ' (' + v.items.join('–') + ')' : '')).join('\n');
    const system = 'You are the head scriptwriter of ' + pb.brand + ' short videos (' + pb.positioning + ' ' + pb.what + '). You write SPOKEN language for an AI voice and VISUALS for a code renderer, as ONE CreativeSpec JSON object (format "' + VERSION + '"). '
      + 'The renderer turns it into a ' + format + ' video with voice-over, kinetic text cards, captions, music, sound effects and a cover, so you write only WORDS and pick LAYOUTS and visual kinds: never HTML, CSS, colors, fonts, timings or URLs. '
      + 'You never invent numbers, clients, quotes or events. Return ONLY the JSON object, no markdown.';
    const L = [
      '1. TASK: ' + (str(input.topic || input.idea) || '(pick one practical AI/automation tip for small businesses)') + '\n   target ' + target + ' s · format ' + format + ' · production ' + mode
        + (mode === 'talk' ? ' (the owner reads these lines to camera)' : mode === 'voiceover' ? ' (an AI voice reads over the owner\'s clips)' : ' (AI voice + code cards, no camera)')
        + '\n   LANGUAGE of every spoken and on-screen word: ' + (vi ? 'Vietnamese — write natively, the way a Vietnamese creator talks, never translated from English' : 'English') + '. "notes_vi" = a 1–2 sentence Vietnamese summary for the owner.'
        + '\n   GENRE: ' + (genre || 'choose one of ' + GENRES.join(' / ')) + (ctype ? ' · content type ' + ctype : '') + (input.hook_idea ? '\n   HOOK IDEA (rewrite it within the hook budget): ' + str(input.hook_idea) : '')
        + (input.brief ? '\n   OWNER MESSAGE (his words; a number here may be cited with source "owner"):\n' + String(input.brief).slice(0, 1500) : '')
        + (input.points ? '\n   KEY POINTS:\n' + String(input.points).slice(0, 2500) : '') + (input.cta ? '\n   CTA WISH: ' + str(input.cta) : '') + (input.notes ? '\n   NOTES: ' + String(input.notes).slice(0, 800) : ''),
      '2. BRAND: ' + pb.brand + ' — ' + pb.positioning + ' Audience: ' + pb.audience + '\n   VOICE: ' + pb.voice + ' ' + [].concat(pb.never || []).join(' ') + '\n   CTA RULES: ' + pb.cta_rules
        + (input.voice_md ? '\n   OWNER TONE NOTES:\n' + String(input.voice_md).slice(0, 1200) : ''),
      facts.length ? '3. FACTS — the ONLY source of numbers, results, names and claims. Cite every number you use in "facts_used" as {"claim": "<your sentence>", "source": "FACTS#n"}:\n' + facts.map((f, i) => '   FACTS#' + (i + 1) + ': ' + f.slice(0, LIM.fact_chars)).join('\n')
        : '3. FACTS: none → no statistics, results, times, prices or percentages; tell the steps and the concrete situation instead (counting is fine: "3 bước", "5 lỗi", "3 steps"). "facts_used": [].',
      '   A sentence with a number + a unit (seconds, hours, %, x, times, customers, giây, giờ, lần, khách…) and a result verb (save, faster, only, tiết kiệm, nhanh hơn, chỉ còn…) is a CLAIM: code rejects it unless facts_used cites it.',
      input.learnings ? '4. LEARNINGS from the owner\'s analytics (apply them):\n' + String(input.learnings).slice(0, 1500) : '',
      '5. BUDGET (code counts ' + u + ' at the voice speed ≈ ' + B.wps + ' per second; a line inside its budget passes the timing gates):'
        + '\n   • hook.say ' + B.hook[0] + '–' + B.hook[1] + ' (aim ' + B.hook[2] + '), no commas → spoken by 3.0 s. hook.text ≤ ' + B.text + ' ' + (vi ? 'syllables' : 'words') + ', ≤ 28 characters.'
        + '\n   • each scene say ' + B.body[0] + '–' + B.body[1] + ' (aim ' + B.body[2] + '), ≤ 2 sentences; ' + LIM.body[0] + '–' + LIM.body[1] + ' body scenes (best 4–6), each ≤ 9 s.'
        + '\n   • cta.say ' + B.cta[0] + '–' + B.cta[1] + ' (aim ' + B.cta[2] + ').   • whole script ' + tot[0] + '–' + tot[1] + ' (aim ' + tot[2] + ') for ' + target + ' s; must land in 30–60 s.',
      '6. GENRE + STRUCTURE: pick "genre" (' + GENRES.join(', ') + ') and "structure" (' + STRUCTURES.join(', ') + ').\n' + Object.entries(STRUCT_BEATS).map(([k, v]) => '   ' + k + ': ' + v).join('\n')
        + '\n   Genre presets: ' + Object.entries(GENRE_PRESET).filter(([k]) => !genre || k === genre).map(([k, v]) => k + ' — ' + v).join(' | ')
        + '\n   Over 35 s: one "rehook" line at 40–60 % of the video. The "payoff" SHOWS the promised result and holds. ONE CTA, after the payoff (never "follow / comment / lưu lại" earlier). Never the same layout twice in a row.',
      '7. HOOK LAB: write 3 hooks of 3 DIFFERENT hook_type' + (recent.length ? ' (none of ' + recent.join(', ') + ' — used in the last videos)' : '') + '. Put the strongest in "hook", the other two in "hooks_alt" (same promise). '
        + 'Triple hook: what is HEARD (hook.say) ≠ what is READ (hook.text, the frame-0 headline, complete in the very first frame) ≠ what is SEEN (layout + items / value), all the same promise. '
        + 'hook_type → layout: result_first → hook_result (2–4 items = lines of the finished result) · number → hook_number (value) · question → hook_question · mistake / before_after / pov / bold_claim / myth / curiosity_gap → hook_kinetic. No greeting, no "In this video", no brand name first.',
      '8. SAY (heard): one breath per line, ≤ 2 sentences, commas only where the voice should pause (the TTS has no other pause control), concrete nouns, active verbs; each line makes the next one necessary. '
        + 'Write numbers the way they are read when that is ambiguous. No symbols, emoji, URLs or hashtags.',
      '9. TEXT (read): the keyword or the number, never the transcript (most of its words must NOT be in the same line\'s say), ≤ ' + B.text + ' ' + (vi ? 'syllables' : 'words') + ', ≤ 2 lines; items 2–5 × ≤ 4 words. Leave unused fields "" or [].',
      '10. VISUAL (seen): visual_kind "code" by default (a designed text card). "motion" for at most 2 hero beats (payoff, rehook) with ONE visual metaphor sentence in visual_prompt. '
        + '"still" only for a place / object / scene a card cannot show (never a real person shown as real, never text inside the image). "footage" only when AVAILABLE FOOTAGE matches (name it in visual_hint). "talk" only when production = talk. '
        + 'visual_hint = ≤ 80 characters for the editor (what the viewer sees). sfx_cue: none | hit | riser | pop | ding — at most one accent per beat, usually none.',
      input.footage ? '    AVAILABLE FOOTAGE:\n' + String(input.footage).slice(0, 1500) : '',
      '11. BANNED: ' + HYPE.slice(0, 14).join(', ') + ' · clichés: in today\'s fast-paced world, let\'s dive in, unlock, elevate, seamless, revolutionize, buckle up, "it\'s not just X, it\'s Y"'
        + ' · trong thời đại 4.0, hãy cùng tìm hiểu, bí quyết vàng, thay đổi cuộc chơi, không thể bỏ lỡ, chỉ với vài cú click, xin chào các bạn.',
      '12. CTA & COVER: cta.action lab | follow | comment (+ keyword) | save, platform-neutral, never a URL; cta.text = the end-card headline. cover.title 2–5 words, ≤ 32 characters, the hook\'s promise in other words; cover.alt_title = a second angle (A/B); cover.emphasis = its key word.',
      'HOOK LAYOUTS:\n' + lays('hook'), 'BODY LAYOUTS:\n' + lays('body'), 'ICONS (icon_point; "none" when unused): ' + Object.keys(ICONS).join(' '),
      input.extra ? '\n' + String(input.extra) : '',
    ];
    if (input.retry && input.retry.feedback) {
      L.push('', '--- ATTEMPT ' + num(input.retry.attempt, 2) + ' of ' + num(input.retry.max, 3) + ' ---', String(input.retry.feedback));
      if (input.retry.prev) L.push('YOUR PREVIOUS JSON (edit it, do not start over):', (typeof input.retry.prev === 'string' ? input.retry.prev : JSON.stringify(input.retry.prev)).slice(0, 12000));
    }
    const ex = isObj(input.example) ? input.example : EXAMPLE;
    L.push('', '13. EXAMPLE of a valid answer (' + (ex.genre || 'explainer') + ', ' + (ex.lang || 'en') + ' — different topic, do not copy its wording' + (facts.length ? '' : '; its facts_used only shows the format — you have no FACTS') + '):', JSON.stringify(ex), '', 'Return ONLY the JSON object with "version": "' + VERSION + '".');
    const user = L.filter((x) => x !== '').join('\n');
    const temperature = input.retry && input.retry.feedback ? 0.4 : 0.8;
    return { system, user, prompt: system + '\n\n=====\n\n' + user, schema: llmSchema({ strict: true }), temperature, budget: { ...B, total: tot },
      gemini_body: { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature, responseMimeType: 'application/json' } } };
  }

  // ---------- one-line Vietnamese summary (n8n alerts, Telegram, results) ----------
  function summaryVi(res) {
    if (!res || !res.spec) return '❌ AI không trả về kịch bản JSON';
    const e = res.estimate || estimateAll(res.spec);
    return (res.ok ? (res.review ? '👀' : '✅') : '❌') + ' "' + res.spec.title + '" · ~' + Math.round(e.total) + 's · hook ' + e.hook_end + 's · ' + res.spec.scenes.length + ' cảnh · ' + e.words + ' từ'
      + (res.errors && res.errors.length ? ' · lỗi: ' + res.errors.slice(0, 3).map((x) => x.vi || x.code).join('; ') : '')
      + (res.warnings && res.warnings.length ? ' · lưu ý: ' + res.warnings.filter((x) => x.vi).slice(0, 2).map((x) => x.vi).join('; ') : '');
  }

  return { VERSION, CORE, STANDARD, LIM, TIME, ENERGY_RATE, VOICES, VOICE_DEFAULT, ROLES, HOOK_TYPES, CONTENT_TYPES, MOODS, PALETTES, CAPTIONS, ACTIONS, ICONS, LAYOUTS, ALIAS, CTA_DEF, CTA_DEF_VI, KICKER, HYPE,
    GENRES, STRUCTURES, VISUAL_KINDS, SFX_CUES, OWNER_BLOCK, CAPS_HIDDEN, EXAMPLE,
    units, words, speakable, lineSec, parseJSON, fromAI, normalize, estimate: estimateAll, validate, salvage, feedback, check, llmSchema, prompt, budgetFor, claims, cliches, factList, summaryVi, specHash, hash, canon, fold };
})();
if (typeof module === 'object' && module && module.exports) module.exports = ESC;
