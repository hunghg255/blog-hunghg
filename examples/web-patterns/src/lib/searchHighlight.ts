/**
 * Tô đậm từ khoá trong gợi ý tìm kiếm, chỉ khớp ở ĐẦU từ.
 *
 * Ý tưởng từ Udemy (bold-search-terms.ts): "pot" khớp "pottery", "Harry Potter" nhưng không
 * khớp "despotism"; cho phép ký tự đặc biệt đứng trước, nên "net" khớp ".NET".
 * Udemy escape HTML rồi chèn `<strong>` vào chuỗi HTML. Bản này trả về các đoạn text để
 * React render, không cần HTML, nên không bao giờ cắt vào giữa một entity như `&amp;`.
 */
export interface Segment {
  text: string;
  match: boolean;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function highlightTerms(rawText: string, query: string): Segment[] {
  // Chuẩn hoá NFC: chữ "ệ" có thể đến dưới dạng 1 ký tự hoặc "e" + 2 dấu rời (NFD). Dấu rời là
  // \p{M}, không phải \p{L}, nên nếu không chuẩn hoá thì "t" trong "Việt" (NFD) bị coi là đầu từ.
  const text = rawText.normalize('NFC');
  const terms = query
    .normalize('NFC')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    // term dài trước: query "re react" thì "react" được thử trước "re", tô đậm trọn từ
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex);
  if (terms.length === 0) return [{ text, match: false }];

  // (?<![\p{L}\p{N}]) = trước đó KHÔNG phải chữ/số -> chỉ khớp đầu từ.
  // Dấu câu như "." hay "#" được phép đứng trước, nên "net" khớp ".NET", "c" khớp "#c".
  // Cờ u để \p{L} hiểu chữ có dấu tiếng Việt.
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${terms.join('|')})`, 'giu');

  const segments: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start), match: false });
    segments.push({ text: m[0], match: true });
    last = start + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), match: false });
  return segments;
}
