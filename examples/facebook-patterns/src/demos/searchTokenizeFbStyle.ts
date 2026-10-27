/**
 * Mô phỏng lại hành vi của TokenizeUtil + cometSearchTypeaheadHighlightUtils (bản dump
 * facebook.com) để demo so sánh. Viết lại cho dễ đọc, giữ nguyên các chỗ yếu:
 * bảng gấp dấu thiếu chữ Việt, highlight chỉ sau dấu cách, regex có dấu gạch dài "–".
 */

// Bảng rút gọn đúng như bản gốc: chỉ Latin-1, Latin Extended-A và Cyrillic cơ bản
const TABLE: Record<string, string> = {
  a: 'а à á â ã ä å ā', b: 'б', c: 'ц ç č', d: 'д ð ď đ', e: 'э е è é ê ë ě ē', f: 'ф',
  g: 'г ğ ģ', h: 'х ħ', i: 'и ì í î ï ı ī', j: 'й', k: 'к ĸ ķ', l: 'л ľ ĺ ŀ ł ļ', m: 'м',
  n: 'н ñ ň ŉ ŋ ņ', o: 'о ø ö õ ô ó ò', p: 'п', r: 'р ř ŕ', s: 'с ş š ſ', t: 'т ť ŧ þ',
  u: 'у ю ü û ú ù ů ū', v: 'в', y: 'ы ÿ ý', z: 'з ž', ae: 'æ', oe: 'œ', ts: 'ц', ch: 'ч',
  ij: 'ĳ', sh: 'ш', ss: 'ß', ya: 'я',
};
const MAP: Record<string, string> = {};
for (const [to, from] of Object.entries(TABLE)) for (const ch of from.split(' ')) MAP[ch] = to;

export function fbFlatten(text: string) {
  let out = '';
  for (const ch of text.toLowerCase()) out += MAP[ch] ?? ch;
  return out.replace(/ +/g, ' ');
}

const PUNCT = /[.,+*?$|#{}()'^\-[\]\\/!@%"~=<>_:;\s]+/;

/** Giống isQueryMatch của bản gốc: từ cuối là tiền tố, mỗi từ đích dùng một lần. */
export function fbIsQueryMatch(query: string, target: string) {
  const flatQuery = fbFlatten(query);
  const q = flatQuery.split(PUNCT).filter(Boolean);
  const t = fbFlatten(target).split(PUNCT).filter(Boolean);
  const lastIsPrefix = flatQuery.length > 0 && !flatQuery.endsWith(' ');
  const used = new Set<number>();
  return (
    q.length > 0 &&
    q.every((token, i) => {
      const prefixOk = lastIsPrefix && i === q.length - 1;
      const j = t.findIndex((tt, k) => !used.has(k) && (tt === token || (prefixOk && tt.startsWith(token))));
      if (j === -1) return false;
      used.add(j);
      return true;
    })
  );
}

// Nguyên văn các dải có dấu "–" (U+2013) như bản gốc: "ݐ–ݿ" là BA ký tự,
// không phải một dải, và làm mọi chuỗi chứa "–" bị coi là chữ nối nét.
// eslint-disable-next-line no-misleading-character-class
const FB_CONNECTED = /[ऀ-ॿ฀-๿؀-ۿݐ–ݿࢠ–ࣿﭐ–﷿ﹰ–﻿一-龯]/;

export const fbMayHaveConnectedCharacters = (text: string) => FB_CONNECTED.test(text);

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Giống highlightMatch của bản gốc: thêm dấu cách vào đầu rồi tìm "( từ1| từ2)". */
export function fbHighlight(query: string, text: string) {
  if (fbMayHaveConnectedCharacters(text)) return [{ text, matched: false }];
  const pattern = new RegExp('( ' + escapeRegex(query).split(/\s+/).join('| ') + ')', 'gi');
  const padded = ' ' + text;
  const out: Array<{ text: string; matched: boolean }> = [];
  let last = 0;
  for (let m = pattern.exec(padded); m; m = pattern.exec(padded)) {
    let before = padded.substring(last, m.index);
    if (last === 0) before = before.trimStart();
    if (before) out.push({ text: before, matched: false });
    out.push({ text: m.index === 0 ? m[0].trimStart() : m[0], matched: true });
    last = m.index + m[0].length;
    if (m[0].length === 0) pattern.lastIndex++; // bản gốc không có dòng này; thêm để demo không treo
  }
  if (last < padded.length) out.push({ text: padded.substring(last), matched: false });
  return out;
}
