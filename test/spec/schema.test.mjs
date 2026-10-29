// node --test test/spec/schema.test.mjs — spec/creative-spec.schema.json khớp core 1.1: được sinh lại từ core (không lệch), và mọi trường mà
// normalize() trả về cho 4 ví dụ đều có trong schema (additionalProperties: false không được chặn spec hợp lệ). Không cần mạng / Chromium.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ESC from '../../spec/core.cjs';
import { ROOT, example, good } from './fx.mjs';

const file = ROOT + '/spec/creative-spec.schema.json';
test('schema được sinh từ core hiện tại (node spec/gen-schema.mjs không đổi file)', () => {
  const before = fs.readFileSync(file, 'utf8'); execFileSync(process.execPath, [ROOT + '/spec/gen-schema.mjs'], { stdio: 'ignore' });
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'creative-spec.schema.json cũ — chạy node spec/gen-schema.mjs'); assert.match(before, /Core 1\.1\.0/);
});
test('mọi trường của spec đã chuẩn hoá (4 ví dụ + EXAMPLE) có trong schema, enum đúng', () => {
  const sch = JSON.parse(fs.readFileSync(file, 'utf8')); const P = sch.properties;
  const has = (props, obj, where) => { for (const k of Object.keys(obj)) assert.ok(props[k], where + '.' + k + ' thiếu trong schema');
    for (const [k, v] of Object.entries(obj)) if (props[k] && props[k].enum && typeof v === 'string') assert.ok(props[k].enum.includes(v), where + '.' + k + ' = ' + v); };
  for (const raw of [good(), ...['explainer.en', 'explainer.vi', 'list.en', 'list.vi'].map(example)]) {
    const s = ESC.normalize(raw).spec; has(P, s, 'spec'); has(P.hook.properties, s.hook, 'hook'); has(P.cta.properties, s.cta, 'cta'); has(P.cover.properties, s.cover, 'cover');
    for (const [i, sc] of s.scenes.entries()) { has(P.scenes.items.properties, sc, 'scenes/' + i); if (sc.visual) has(P.scenes.items.properties.visual.properties, sc.visual, 'scenes/' + i + '/visual'); }
    for (const f of s.facts_used || []) assert.match(f.source, new RegExp(P.facts_used.items.properties.source.pattern));
    assert.equal(s.version, P.version.const);
  }
});
