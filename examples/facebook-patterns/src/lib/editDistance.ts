/**
 * Khoảng cách sửa chuỗi kiểu Damerau-Levenshtein (ý tưởng từ DamerauLevenshtein,
 * testEditDistance và CommerceInputNormalizer trong bundle Facebook).
 *
 * - osaDistance: bản Facebook dùng (Optimal String Alignment), chỉ giữ 3 hàng của bảng DP.
 * - damerauDistance: Damerau-Levenshtein đầy đủ (cho phép sửa giữa hai ký tự đã hoán vị).
 * - withinDistance: chỉ hỏi "có ≤ k lỗi không", tính trên dải chéo rộng 2k + 1 và dừng sớm.
 * - closestMatch: tự sửa lỗi gõ theo danh sách, ngưỡng tương đối thay vì tuyệt đối.
 *
 * Mọi hàm làm việc trên code point (Array.from) để emoji, chữ ngoài BMP không bị tách đôi.
 */

const chars = (s: string) => Array.from(s);

/** OSA: mỗi đoạn con chỉ được hoán vị một lần. "ca" → "abc" ra 3. */
export function osaDistance(a: string, b: string) {
  const s = chars(a);
  const t = chars(b);
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;
  // 3 hàng xoay vòng: i-2, i-1, i
  const rows = [new Array<number>(t.length + 1), new Array<number>(t.length + 1), new Array<number>(t.length + 1)];
  for (let j = 0; j <= t.length; j++) rows[0][j] = j;
  for (let i = 1; i <= s.length; i++) {
    const cur = rows[i % 3];
    const prev = rows[(i - 1) % 3];
    const prev2 = rows[(i - 2 + 3) % 3];
    cur[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        cur[j] = Math.min(cur[j], prev2[j - 2] + cost);
      }
    }
  }
  return rows[s.length % 3][t.length];
}

/** Damerau-Levenshtein đầy đủ (Lowrance-Wagner): "ca" → "abc" ra 2. Bộ nhớ O(m·n). */
export function damerauDistance(a: string, b: string) {
  const s = chars(a);
  const t = chars(b);
  const inf = s.length + t.length;
  const lastRow = new Map<string, number>(); // ký tự → hàng cuối cùng nó xuất hiện trong s
  // bảng có thêm một hàng/cột "vô cực" ở chỉ số 0
  const d: number[][] = Array.from({ length: s.length + 2 }, () => new Array<number>(t.length + 2).fill(0));
  d[0][0] = inf;
  for (let i = 0; i <= s.length; i++) {
    d[i + 1][0] = inf;
    d[i + 1][1] = i;
  }
  for (let j = 0; j <= t.length; j++) {
    d[0][j + 1] = inf;
    d[1][j + 1] = j;
  }
  for (let i = 1; i <= s.length; i++) {
    let lastMatchCol = 0;
    for (let j = 1; j <= t.length; j++) {
      const i1 = lastRow.get(t[j - 1]) ?? 0;
      const j1 = lastMatchCol;
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      if (cost === 0) lastMatchCol = j;
      d[i + 1][j + 1] = Math.min(
        d[i][j] + cost,
        d[i + 1][j] + 1,
        d[i][j + 1] + 1,
        d[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1),
      );
    }
    lastRow.set(s[i - 1], i);
  }
  return d[s.length + 1][t.length + 1];
}

/**
 * Có biến được a thành b với ≤ k thao tác (OSA) không? Chỉ tính các ô |i - j| ≤ k,
 * dừng ngay khi cả một hàng đều vượt k: O(k·n) thay vì O(m·n).
 */
export function withinDistance(a: string, b: string, k: number) {
  const s = chars(a);
  const t = chars(b);
  if (Math.abs(s.length - t.length) > k) return false;
  if (s.length === 0 || t.length === 0) return Math.max(s.length, t.length) <= k;
  const big = k + 1;
  // 3 hàng dùng lại, chỉ ghi các ô trong dải (cộng một ô "chặn" mỗi bên) nên không tốn O(m·n) bộ nhớ
  let prev2 = new Array<number>(t.length + 2).fill(big);
  let prev = new Array<number>(t.length + 2).fill(big);
  let cur = new Array<number>(t.length + 2).fill(big);
  for (let j = 0; j <= Math.min(k, t.length); j++) prev[j] = j;
  for (let i = 1; i <= s.length; i++) {
    const from = Math.max(1, i - k);
    const to = Math.min(t.length, i + k);
    cur[from - 1] = from === 1 && i <= k ? i : big;
    cur[to + 1] = big;
    let rowMin = cur[from - 1];
    for (let j = from; j <= to; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) v = Math.min(v, prev2[j - 2] + cost);
      cur[j] = Math.min(v, big);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > k) return false;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[t.length] <= k;
}

/** Bỏ dấu, hạ chữ thường, gộp khoảng trắng: "  Hà   Nội " → "ha noi". */
export function normalizeForMatch(s: string) {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MatchOptions {
  /** Tỉ lệ lỗi tối đa so với độ dài từ đích, mặc định 0.34 (khoảng 1 lỗi mỗi 3 ký tự). */
  maxErrorRatio?: number;
  /** Cộng thêm 1 khi ký tự đầu khác nhau, giống CommerceInputNormalizer. */
  firstLetterPenalty?: boolean;
  distance?: (a: string, b: string) => number;
}

export interface Match<T> {
  value: T;
  label: string;
  distance: number;
}

/**
 * Tìm phần tử gần nhất; trả null nếu không đủ gần (thay vì trả bừa như bản gốc).
 * Ngưỡng tính theo độ dài của từ đích nên "york" không còn bị sửa thành "Iowa".
 */
export function closestMatch<T>(
  input: string,
  candidates: Array<{ label: string; value: T }>,
  { maxErrorRatio = 0.34, firstLetterPenalty = true, distance = damerauDistance }: MatchOptions = {},
): Match<T> | null {
  const query = normalizeForMatch(input);
  if (!query) return null;
  let best: Match<T> | null = null;
  for (const candidate of candidates) {
    const label = normalizeForMatch(candidate.label);
    let d = distance(query, label);
    if (firstLetterPenalty && query[0] !== label[0]) d += 1;
    if (d === 0) return { value: candidate.value, label: candidate.label, distance: 0 };
    if (!best || d < best.distance) best = { value: candidate.value, label: candidate.label, distance: d };
  }
  if (!best) return null;
  const limit = Math.max(1, Math.floor(chars(normalizeForMatch(best.label)).length * maxErrorRatio));
  return best.distance <= limit ? best : null;
}
