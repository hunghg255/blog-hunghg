/**
 * Chống "từ mồ côi" (một từ nằm trơ trọi ở dòng cuối của tiêu đề) bằng cách nối hai từ
 * cuối bằng khoảng trắng không ngắt dòng (ý tưởng từ lib/unorphan.js của Toptal).
 */

const NBSP = ' ';

export interface UnorphanOptions {
  /** chỉ áp dụng khi câu có nhiều hơn chừng này từ (Toptal: 3) */
  minWords?: number;
  /** không nối nếu hai từ cuối gộp lại dài hơn chừng này ký tự (tránh tràn khung hẹp) */
  maxJoinedLength?: number;
}

export function unorphan(sentence: string, { minWords = 3, maxJoinedLength = 20 }: UnorphanOptions = {}): string {
  const words = sentence.trim().split(/\s+/);
  if (words.length <= minWords) return words.join(' ');
  const last = words.pop()!;
  const beforeLast = words.pop()!;
  if (beforeLast.length + 1 + last.length > maxJoinedLength) return [...words, beforeLast, last].join(' ');
  return [...words, beforeLast + NBSP + last].join(' ');
}
