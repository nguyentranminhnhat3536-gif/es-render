// Dữ liệu dùng chung cho test/spec/*: ví dụ hợp lệ của core 1.1 + FACTS mà mỗi ví dụ trích dẫn (facts_used → FACTS#1).
// Luôn truyền facts (mảng, có thể rỗng) cho ESC.check — facts == null thì core chấp nhận MỌI FACTS#n (lỗ "rửa số liệu", K4).
import fs from 'node:fs';
import ESC from '../../spec/core.cjs';

export const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
export const FACTS = {
  EXAMPLE: ['Test shop: 50 reviews turned into an FAQ in 2 minutes (measured 10/2026)'],
  'explainer.en': ['Test shop: 50 reviews turned into an FAQ in 2 minutes (measured 10/2026)'],
  'explainer.vi': ['Quán thử nghiệm ES Invoice: làm xong một hoá đơn trong 28 giây (đo thật, 10/2026)'],
  'list.en': [], 'list.vi': [],
};
export const clone = (o) => JSON.parse(JSON.stringify(o));
export const good = () => clone(ESC.EXAMPLE);
export const example = (name) => JSON.parse(fs.readFileSync(ROOT + '/spec/examples/' + name + '.json', 'utf8'));
