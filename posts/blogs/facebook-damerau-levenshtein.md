---
title: 'Học từ Facebook #65: Damerau-Levenshtein theo dải chéo, tự sửa tên gõ sai'
description: 'Ba đoạn code khoảng cách sửa chuỗi trong bundle Facebook: bản OSA chỉ giữ 3 hàng, bản Relay chỉ hỏi "có ≤ k lỗi không" theo đường chéo, và form thanh toán đoán bang Mỹ từ chữ gõ sai. Kèm các lỗi tìm được và cách sửa.'
date: '2026-10-28T09:16'
series: facebook
seriesOrder: 65
author: hunghg255
image: https://blog.hunghg.me/blogs/fb-edit-distance.png
tags: ['facebook', 'algorithm', 'string', 'form', 'search']
---

Người dùng gõ "Calfornia" vào ô bang ở form thanh toán. Form nên hiểu là California (CA), không bắt gõ lại. Gõ "teh" trong ô tìm kiếm, nên gợi ý "the". Cả hai cần một thước đo "hai chuỗi khác nhau bao nhiêu": **khoảng cách sửa chuỗi** (edit distance), số thao tác tối thiểu để biến chuỗi này thành chuỗi kia.

Bundle Facebook có ba mảnh code xoay quanh chuyện này, mỗi mảnh dạy một điều khác nhau, và hai trong ba mảnh có lỗi đáng học.

> [!TIP]
> **Tóm tắt**
> - **Levenshtein** đếm chèn, xoá, thay. **Damerau-Levenshtein** thêm hoán vị hai ký tự kề nhau ("teh" → "the" là 1 lỗi chứ không phải 2).
> - Bản Facebook là **OSA** (Optimal String Alignment): mỗi đoạn chỉ được hoán vị một lần, không sửa tiếp. Hệ quả: "ca" → "abc" ra 3, trong khi Damerau-Levenshtein thật ra 2.
> - Khi chỉ cần hỏi "có ≤ k lỗi không", chỉ các ô gần đường chéo (`|i − j| ≤ k`) mới quan trọng: O(k·n) thay vì O(m·n), dừng sớm khi cả hàng vượt k.
> - Ngưỡng **tuyệt đối** (< 5 lỗi) trên tên ngắn là quá rộng: Facebook sửa "york" thành Iowa, "Hà Nội" thành Hawaii. Dùng ngưỡng **tương đối** theo độ dài, không đủ gần thì hỏi lại.

<iframe class="demo-frame" src="/demos/facebook-patterns/index.html?theme=dark#/edit-distance" title="Demo edit-distance" loading="lazy" style="height: 1180px"></iframe>

<p class="demo-links">▶ <a href="/demos/facebook-patterns/index.html#/edit-distance" target="_blank" rel="noopener">Mở demo toàn màn hình ↗</a> · <a href="https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns?file=src/lib/editDistance.ts" target="_blank" rel="noopener">Sửa code trên StackBlitz ↗</a> · <a href="https://github.com/hunghg255/blog-hunghg/blob/master/examples/facebook-patterns/src/lib/editDistance.ts" target="_blank" rel="noopener">Xem source trên GitHub ↗</a></p>

## Facebook làm thế nào?

### DamerauLevenshtein: bảng quy hoạch động chỉ 3 hàng

Module `DamerauLevenshtein` (bundle `27.js`), đã đổi tên biến:

```js
function distance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (a === b) return 0;
  const d = [[], [], []];                 // chỉ 3 hàng: i-2, i-1, i (chỉ số mod 3)
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i % 3][0] = i;
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      d[i % 3][j] = Math.min(
        d[(i - 1) % 3][j] + 1,            // xoá
        d[i % 3][j - 1] + 1,              // chèn
        d[(i - 1) % 3][j - 1] + cost,     // thay (hoặc giữ nguyên)
      );
      if (i > 1 && j > 1 && a.charAt(i - 1) == b.charAt(j - 2) && a.charAt(i - 2) == b.charAt(j - 1))
        d[i % 3][j] = Math.min(d[i % 3][j], d[(i - 2) % 3][j - 2] + cost); // hoán vị
    }
  return d[a.length % 3][b.length];
}
```

Ô `d[i][j]` là khoảng cách giữa `i` ký tự đầu của `a` và `j` ký tự đầu của `b`. Mỗi ô chỉ cần hàng trên (`i-1`) và hàng trên nữa (`i-2`, cho hoán vị), nên thay vì bảng `m × n`, Facebook xoay vòng 3 hàng bằng `% 3`: bộ nhớ O(n).

Lưu ý điều kiện hoán vị nhìn **2 ô chéo về trước** `d[i-2][j-2]`. Đây là định nghĩa OSA: nếu hai ký tự vừa hoán vị thì đoạn đó coi như đã xử lý xong, không được chèn gì vào giữa. Với "ca" → "abc": cách rẻ nhất là hoán vị "ca" → "ac" rồi chèn "b" vào giữa, 2 bước. OSA không cho chèn vào giữa cặp vừa hoán vị, nên phải đi đường khác, 3 bước. Damerau-Levenshtein thật (thuật toán Lowrance-Wagner) cho phép, ra 2. Phần lớn ứng dụng không bận tâm khác biệt này, nhưng OSA **không thoả bất đẳng thức tam giác**: `osa("ca","ac") + osa("ac","abc") = 1 + 1 = 2 < osa("ca","abc") = 3`. Cấu trúc tìm kiếm dựa trên metric (BK-tree) cần bất đẳng thức tam giác sẽ cho kết quả sai nếu dùng OSA.

### testEditDistance: chỉ hỏi "có ≤ k lỗi không"

Relay cổ điển có `react-relay-deprecated/classic/tools/testEditDistance(a, b, k)` (bundle `155.js`) trả `true/false`. Nó không dựng bảng mà theo dõi **đường chéo**:

```js
// h[diag][errors] = hàng xa nhất đi được trên đường chéo diag với đúng `errors` lỗi
do {
  if (errors > k) return false;
  errors++;
  for (let i = Math.floor((errors - (n - m)) / 2); i >= 1; i--) extend(n - m + i, errors - i);
  for (let i = Math.floor((n - m + errors) / 2); i >= 1; i--) extend(n - m - i, errors - i);
  extend(n - m, errors);
} while (h[n - m + offset][errors] !== m);   // tới góc dưới phải thì xong
return true;

function extend(diag, errors) {
  let row = h[diag + offset][errors] + 1;
  let transposed = row;
  if (a[row - 1] === b[diag + row] && a[row] === b[diag + row - 1]) transposed = row + 1;
  row = Math.max(row, h[diag - 1 + offset][errors], h[diag + 1 + offset][errors] + 1, transposed);
  while (a[row] === b[row + diag] && row < Math.min(m, n - diag)) row++; // trượt dọc chéo khi khớp
  h[diag + offset][errors + 1] = row;
}
```

Đây là ý tưởng của **Ukkonen** (1985): với mỗi số lỗi `e` và mỗi đường chéo, chỉ cần nhớ "đi được xa nhất tới đâu". Đoạn khớp liên tiếp được trượt qua bằng vòng `while` không tốn lỗi, nên hai chuỗi gần giống nhau được kiểm tra rất nhanh: O((k + 1) · n) hoặc tốt hơn.

Tác dụng thực tế: hỏi "chuỗi người dùng gõ có gần tên trường nào không" cho hàng trăm ứng viên, mỗi ứng viên dừng ngay khi vượt `k`, không cần biết khoảng cách chính xác.

Khi thử bản gốc với 50.000 cặp chuỗi ngẫu nhiên, kết quả luôn khớp OSA, **nhưng** hàm ném `TypeError` (đọc `h[...]` chưa tạo) mỗi khi `k` lớn hơn hoặc bằng độ dài chuỗi dài hơn và hai chuỗi khác nhau, ví dụ `testEditDistance('b', 'a', 1)`. Vòng lặp tăng `errors` vượt quá số đường chéo đã cấp phát. Nơi gọi trong Relay có lẽ chỉ dùng `k` nhỏ với tên dài nên không gặp.

### CommerceInputNormalizer: đoán bang Mỹ

Form thanh toán (bundle `128.js`) có bộ chuẩn hoá cho từng ô: số thẻ (tách nhóm 4-4-4-4 hoặc 4-6-5 cho Amex), ngày hết hạn, email, mã ZIP. Ô bang:

```js
USAState: () => (input) => {
  let a = input;
  if (a.length > 2) {
    a = a.toLowerCase()
      .replace(/^columbia/, 'district of columbia')
      .replace(/^n\.?\s+/, 'north ')
      .replace(/^s\.?\s+/, 'south ');
    let best = 1000, bestKey = null;
    for (const key in CommerceUSAStates) {       // { STATE_CA: 'California', … }
      const name = CommerceUSAStates[key].toLowerCase();
      let d = DamerauLevenshteinDistance(a, name);
      if (a.charAt(0) !== name.charAt(0)) d++;   // phạt khác chữ cái đầu
      if (d === 0) { best = d; bestKey = key; break; }
      if (d < best) { best = d; bestKey = key; }
    }
    if (best < 5) a = bestKey.replace('STATE_', '');
  }
  return a.replace(/[^a-zA-Z]/, '').substr(0, 2).toUpperCase();
}
```

Có vài ý hay: mở rộng "N. Carolina" thành "north carolina" trước khi so; phạt thêm 1 khi chữ cái đầu khác (người gõ hiếm khi sai chữ đầu); khớp tuyệt đối thì dừng sớm.

Nhưng ngưỡng `best < 5` là **tuyệt đối**. Tên bang ngắn ("Iowa", "Ohio", "Utah" 4 chữ) thì 4 lỗi là sai gần hết từ. Chạy thử với danh sách bang thật:

| Gõ | Facebook trả | Vì sao |
|---|---|---|
| `york` | `IA` (Iowa) | "york" → "iowa" 3 lỗi + 1 phạt chữ đầu = 4 < 5 |
| `carolina` | `CA` (California) | gần California hơn North/South Carolina (bị phạt chữ đầu) |
| `Hà Nội` | `HI` (Hawaii) | không bỏ dấu, nhưng vẫn < 5 lỗi |
| `vietnam` | `VI` | không bang nào < 5, rơi về "2 chữ đầu" |
| `dakota` | `DA` | như trên, "DA" không phải mã bang nào |

Hai dòng cuối cho thấy nhánh dự phòng `substr(0, 2)` biến mọi chuỗi thành một "mã bang" giả, form không có cách nào biết là đoán hỏng. Thêm một chi tiết nhỏ: `replace(/[^a-zA-Z]/, '')` thiếu cờ `g` nên chỉ xoá ký tự không phải chữ **đầu tiên**.

## Viết lại

Bản viết lại có bốn hàm: `osaDistance` (giữ đúng thuật toán Facebook, làm việc trên code point), `damerauDistance` (bản đầy đủ), `withinDistance` (kiểm tra ≤ k lỗi theo dải chéo), `closestMatch` (sửa lỗi gõ với ngưỡng tương đối).

Damerau-Levenshtein đầy đủ cần nhớ **lần cuối mỗi ký tự xuất hiện** để cho phép hoán vị hai ký tự cách xa nhau rồi sửa phần giữa:

```ts title=src/lib/editDistance.ts
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
```

Kiểm tra ≤ k lỗi. Thay vì đường chéo kiểu Ukkonen (khó đọc, dễ sai chỉ số như ta vừa thấy), bản viết lại dùng bảng quy hoạch động bình thường nhưng **chỉ tính dải `|i − j| ≤ k`**, ba hàng dùng lại, dừng khi cả hàng vượt `k`:

```ts title=src/lib/editDistance.ts
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
```

Sửa lỗi gõ với ngưỡng theo độ dài:

```ts title=src/lib/editDistance.ts
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
```

::: spoiler Xem toàn bộ src/lib/editDistance.ts

```ts title=src/lib/editDistance.ts
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
```

:::

## Đi qua code

- **`chars = Array.from`** tách theo code point. `"👍🏽".length` là 4 (hai cặp surrogate), `Array.from` cho 2 phần tử (emoji + bộ chỉnh màu da). Bản gốc dùng `charAt` nên một emoji bị tính là 2 ký tự, hoán vị hai emoji thành lỗi lạ. Muốn chính xác theo "ký tự người dùng nhìn thấy" thì dùng `Intl.Segmenter` (grapheme), xem [bài #25 về tìm kiếm gấp dấu](/blogs/facebook-search-diacritics-tokenize).
- **`damerauDistance`** thêm một hàng và một cột "vô cực" (`inf = m + n`) ở chỉ số 0 để công thức hoán vị `d[i1][j1] + (i − i1 − 1) + 1 + (j − j1 − 1)` không cần kiểm tra biên. `i1` là hàng cuối cùng ký tự `t[j−1]` xuất hiện trong `s`, `j1` là cột cuối cùng trong hàng hiện tại có khớp. Bộ nhớ O(m·n) vì công thức nhảy về hàng bất kỳ.
- **`withinDistance`** trả `false` ngay nếu chênh độ dài > k (cần ít nhất chừng ấy lần chèn/xoá). Mỗi hàng chỉ tính `j ∈ [i − k, i + k]`, đặt một ô "chặn" giá trị `k + 1` ở hai bên dải để hàng sau không đọc phải giá trị cũ. Giá trị được kẹp ở `k + 1`: ta chỉ quan tâm "vượt k hay chưa".
- **`normalizeForMatch`** tách dấu bằng `normalize('NFD')`, xoá dấu kết hợp `\p{M}`, đổi `đ → d` (chữ đ không tách dấu được), hạ chữ thường, gộp khoảng trắng.
- **`closestMatch`** tính khoảng cách tới mọi ứng viên, cộng phạt chữ đầu như bản gốc, khớp 0 thì trả ngay. Ngưỡng là `floor(độ dài tên đích × 0.34)`, tối thiểu 1: "Iowa" chỉ chấp nhận 1 lỗi, "Massachusetts" chấp nhận 4. Không đủ gần thì trả `null` để UI hỏi lại.

**Khác bản gốc:**
- Ngưỡng tương đối và trả `null` thay vì ngưỡng tuyệt đối và đoán bừa 2 chữ đầu. "york", "carolina", "Hà Nội", "vietnam", "dakota" đều ra "không chắc"; "Calfornia", "new yrok", "texs", "misisipi" vẫn sửa đúng.
- So trên chuỗi đã bỏ dấu (bản gốc chỉ `toLowerCase`).
- `withinDistance` không ném lỗi với `k` lớn, và test được bằng cách so với `osaDistance(a, b) <= k` trên chuỗi ngẫu nhiên (40.000 cặp, không lệch cặp nào).

## Tại sao không làm cách khác?

**So khớp tiền tố hoặc `includes`?** Không bắt được lỗi gõ ở giữa từ ("Calfornia"). Hợp cho tự hoàn thành khi người dùng gõ chưa xong, nên thường kết hợp: tiền tố trước, khoảng cách sửa chuỗi khi không có tiền tố nào khớp.

**Soundex/Metaphone (so theo cách phát âm)?** Bắt được "Misisipi", nhưng thiết kế cho tiếng Anh, vô dụng với tiếng Việt và tên riêng.

**Trigram (tỉ lệ cụm 3 ký tự chung)?** Nhanh với danh sách lớn, có index được (PostgreSQL `pg_trgm`). Với chuỗi rất ngắn ("TX", "Iowa") trigram ít, kết quả kém. Với 51 bang, tính khoảng cách tới từng bang (51 × vài chục ô) là tức thì.

**Hiện dropdown thay vì ô nhập tự do?** Với bang Mỹ, `<select>` hoặc combobox là UX tốt hơn, khỏi sửa lỗi. Autocorrect hữu ích khi dữ liệu đến từ nơi khác (dán địa chỉ, tự điền của trình duyệt, nhập CSV).

## Edge case và cạm bẫy

- **Ngưỡng cho chuỗi rất ngắn.** Với "TX" (2 ký tự) mọi chuỗi 2 ký tự khác đều cách ≤ 2. Facebook bỏ qua chuỗi ≤ 2 ký tự (coi là mã bang); bản viết lại có `max(1, …)` nên ít nhất vẫn cho 1 lỗi. Với mã ngắn, so khớp chính xác là đủ.
- **Hoà điểm.** "north dakota" và "south dakota" cách "dakota" như nhau. `closestMatch` lấy ứng viên **đầu tiên** đạt điểm thấp nhất; nếu điểm bằng nhau giữa hai ứng viên, nên trả cả hai để người dùng chọn.
- **Chi phí với danh sách lớn.** 51 bang thì vòng lặp đơn giản là đủ. 100.000 sản phẩm thì cần index: BK-tree (cần Levenshtein hoặc DL đầy đủ, không dùng OSA), SymSpell (sinh trước các biến thể xoá), hoặc trigram.
- **`withinDistance` vẫn tốn O(n) bộ nhớ** cho ba hàng dù chỉ tính 2k + 1 ô mỗi hàng; muốn O(k) thì đánh chỉ số theo đường chéo như Ukkonen, đổi lại code khó đọc hơn.
- **Unicode chưa chuẩn hoá.** "é" có thể là 1 code point (U+00E9) hoặc 2 (e + dấu). Luôn `normalize()` trước khi so, nếu không hai chuỗi trông giống hệt vẫn cách nhau 1-2 lỗi.

## Dùng trong dự án

```ts
import { closestMatch, withinDistance } from './editDistance';

// Sửa tên tỉnh/thành khi nhập CSV
const provinces = ['Hà Nội', 'Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ'].map((label) => ({ label, value: label }));
const m = closestMatch(row.city, provinces);
if (!m) markForReview(row);
else if (m.distance > 0) row.city = m.value; // ghi lại để người dùng xem

// "Bạn có định gõ…": lọc nhanh ứng viên ≤ 2 lỗi
const suggestions = commands.filter((c) => withinDistance(input.toLowerCase(), c, 2)).slice(0, 3);
```

## Kiểm thử

::: spoiler Ví dụ test (bản phác, không có trong repo)

```ts
import { describe, expect, it } from 'vitest';
import { closestMatch, damerauDistance, osaDistance, withinDistance } from './editDistance';
import { alea } from './seededRandom';

describe('distance', () => {
  it('OSA và Damerau-Levenshtein khác nhau ở ca → abc', () => {
    expect(osaDistance('ca', 'abc')).toBe(3);
    expect(damerauDistance('ca', 'abc')).toBe(2);
    expect(damerauDistance('teh', 'the')).toBe(1);
  });
  it('withinDistance khớp osaDistance ≤ k', () => {
    const random = alea('within');
    const word = () => Array.from({ length: Math.floor(random() * 12) }, () => 'abc'[Math.floor(random() * 3)]).join('');
    for (let i = 0; i < 5000; i++) {
      const [a, b, k] = [word(), word(), Math.floor(random() * 5)];
      expect(withinDistance(a, b, k)).toBe(osaDistance(a, b) <= k);
    }
  });
});

describe('closestMatch', () => {
  const states = [{ label: 'Iowa', value: 'IA' }, { label: 'New York', value: 'NY' }, { label: 'California', value: 'CA' }];
  it('sửa lỗi gõ nhỏ, từ chối khi quá xa', () => {
    expect(closestMatch('Calfornia', states)?.value).toBe('CA');
    expect(closestMatch('new yrok', states)?.value).toBe('NY');
    expect(closestMatch('york', states)).toBeNull();
  });
});
```

:::

## So với thư viện và chuẩn web

- **fastest-levenshtein**, **leven**: Levenshtein (không có hoán vị) rất nhanh, dùng khi không cần xử lý "teh".
- **Fuse.js**: tìm kiếm mờ trên danh sách object, dựa trên thuật toán Bitap, có trọng số theo trường. Hợp cho ô tìm kiếm có vài nghìn mục.
- **talisman**, **natural**: có Damerau-Levenshtein, OSA, Jaro-Winkler (hợp cho tên người), Soundex.
- Phía server: PostgreSQL `fuzzystrmatch` (`levenshtein`, `levenshtein_less_equal` chính là ý tưởng "≤ k lỗi, dừng sớm"), `pg_trgm` cho index.

Bài liên quan: [Học từ Facebook #25: tìm kiếm gấp dấu, phiên âm và highlight đầu từ](/blogs/facebook-search-diacritics-tokenize).

---

Bài này thuộc series **[Học từ mã nguồn Facebook](/series/facebook)** (83 bài, đọc theo thứ tự).

::: spoiler Xem nhanh danh sách bài trong series

*Phần 1*

- [Mở đầu: cách đọc code minify của Facebook](/blogs/learn-from-facebook-source-code)
- [#1 Dùng chung IntersectionObserver + infinite scroll](/blogs/facebook-shared-intersection-observer)
- [#2 useViewportDuration: đo thời gian thực sự được xem](/blogs/facebook-use-viewport-duration)
- [#3 Preload code + data khi hover](/blogs/facebook-preload-on-hover)
- [#4 Toast manager với external store](/blogs/facebook-toast-manager)
- [#5 Network status + heartbeat backoff](/blogs/facebook-network-status-heartbeat)
- [#6 ErrorGuard: bắt lỗi theo ngữ cảnh](/blogs/facebook-error-guard)
- [#7 Banzai: gom log theo lô + sendBeacon](/blogs/facebook-batch-logger)
- [#8 Focus trap + Esc theo layer](/blogs/facebook-focus-trap)

*Phần 2*

- [#9 Mẹo calc(… * 9999): container query, line-clamp, mũi tên carousel bằng CSS](/blogs/facebook-css-9999-trick)
- [#10 Thanh cuộn tuỳ biến bằng CSS 3D](/blogs/facebook-css-3d-scrollbar)
- [#11 Modal cuộn bằng window, giữ vị trí trang nền](/blogs/facebook-document-scroll-modal)
- [#12 Popover, tooltip group và hovercard](/blogs/facebook-popover-tooltip)
- [#13 Primitive Pressable + focus-visible](/blogs/facebook-pressable)
- [#14 Tab "Xem thêm" + sticky header bằng IntersectionObserver](/blogs/facebook-priority-tabs-sticky-header)
- [#15 Avatar khoét mask, gradient Messenger, skeleton steps()](/blogs/facebook-visual-tricks)
- [#16 Khung chat không giật](/blogs/facebook-chat-scroller)
- [#17 Thuật toán chọn bố cục collage ảnh](/blogs/facebook-photo-collage-layout)
- [#18 Keep-alive tab trong SPA](/blogs/facebook-keep-alive-tabs)
- [#19 Tự đo Visual Completion & interaction tracing](/blogs/facebook-visual-completion)
- [#20 Router SPA bền bỉ & tải chunk có retry](/blogs/facebook-spa-router-resilient-loading)

*Phần 3*

- [#21 Smart Compose: gợi ý chữ mờ khi gõ](/blogs/facebook-smart-compose-ghost-text)
- [#22 MQTT ngay trong trình duyệt, tự chuyển sang long-poll](/blogs/facebook-mqtt-in-browser)
- [#23 Đo thời gian dùng bằng bitmap 64 giây](/blogs/facebook-time-spent-bitmap)
- [#24 Bảng reaction nhấn giữ rồi trượt](/blogs/facebook-reaction-press-slide)
- [#25 Tìm kiếm gấp dấu, phiên âm và highlight đầu từ](/blogs/facebook-search-diacritics-tokenize)
- [#26 Ring buffer biết trace nào đã mất log](/blogs/facebook-trace-ring-buffer)
- [#27 Engine animation JS: một vòng rAF và solver cubic-bezier](/blogs/facebook-keyframes-loop-cubic-bezier)
- [#28 Bootloader: bitmap tài nguyên đã tải, chỉ reload khi cần](/blogs/facebook-bootloader-bitmap-consistency)
- [#29 Nhận biết click do screen reader tạo ra](/blogs/facebook-virtual-cursor-detection)
- [#30 Tải trước feed theo chất lượng mạng, đoán hạng thiết bị](/blogs/facebook-network-aware-prefetch)
- [#31 Hàng đợi gửi tin chat giữ đúng thứ tự](/blogs/facebook-ordered-send-queue)
- [#32 Gộp lời gọi API trong cùng một tick](/blogs/facebook-api-batcher)
- [#33 Resize ảnh trong pool Web Worker](/blogs/facebook-jpeg-resize-worker-pool)
- [#34 Crop ảnh theo nhiều khuôn mặt](/blogs/facebook-face-aware-crop)
- [#35 Kéo-thả sắp xếp và vùng thả file không nhấp nháy](/blogs/facebook-flicker-free-drag-drop)
- [#36 Tiện ích UI: fade-out, sticky event, hàm huỷ được](/blogs/facebook-ui-utility-hooks)
- [#37 Hạ tầng nhỏ: cookie, hash lỗi, prefetch khi chuột dừng](/blogs/facebook-small-infra-cookie-hash-idle)

*Phần 4–6*

- [#38 Đồng bộ tin nhắn: phát hiện lỗ seqID và fetch bù theo tầng](/blogs/facebook-messenger-sync-seqid-gaps)
- [#39 OTID: ID tin nhắn kiểu Snowflake sinh ở client](/blogs/facebook-otid-client-snowflake)
- [#40 QPL: lấy mẫu từ lúc bắt đầu, đo RTT gửi tin đầu-cuối](/blogs/facebook-qpl-send-rtt)
- [#41 Bộ điều phối request bảy chế độ gộp và chống trùng](/blogs/facebook-request-dispatcher-modes)
- [#42 Thread list theo mốc thời gian, cookie presence có version](/blogs/facebook-threadlist-ranged-presence)
- [#43 Composer dạng plugin: reducer, dirty checker, chuỗi kiểm tra](/blogs/facebook-plugin-composer)
- [#44 Thanh toán bất đồng bộ: subscribe trước, poll dự phòng](/blogs/facebook-async-checkout)
- [#45 Validate số thẻ: sửa lỗi gõ, dải BIN, Luhn](/blogs/facebook-card-validation)
- [#46 Lịch chọn khoảng ngày: bo góc dải chọn, phím đủ bộ, RTL](/blogs/facebook-range-calendar-a11y)
- [#47 Giờ mở cửa theo tuần: qua đêm, gộp khoảng, phần bù](/blogs/facebook-weekly-hours-intervals)
- [#48 Tiến độ đăng realtime: giữ event chờ snapshot, watchdog](/blogs/facebook-realtime-publish-snapshot)
- [#49 Tiền tệ theo đơn vị nhỏ nhất và ô nhập tiền](/blogs/facebook-currency-minor-units)
- [#50 Sửa hàng loạt Empty/Uniform/Mixed, seen/read bằng 2 bit](/blogs/facebook-bulk-edit-seen-bits)
- [#51 Phát hiện script lạ hook vào hàm native](/blogs/facebook-native-hook-detection)
- [#52 localStorage tự dọn khi đầy quota](/blogs/facebook-quota-aware-storage)
- [#53 Cache tuyến do server phân giải, chờ sẵn promise](/blogs/facebook-route-cache-prefetch)
- [#54 Lưới phím mũi tên 2D và focus không làm cuộn trang](/blogs/facebook-focus-table-grid)
- [#55 Tách emoji bằng máy trạng thái](/blogs/facebook-emoji-segmentation)
- [#56 Đọc trước ghi sau trong một frame, con tự biết vị trí](/blogs/facebook-read-then-write-dom)
- [#57 Hàng đợi lệnh cho video và stream sắp lại chunk](/blogs/facebook-video-command-queue)

*Phần 7–10*

- [#58 Ước lượng băng thông EWMA: loại outlier, nhớ qua phiên](/blogs/facebook-bandwidth-ewma-estimator)
- [#59 ABR theo độ tự tin phát và cắt bậc bitrate theo MOS](/blogs/facebook-abr-playback-confidence)
- [#60 Prefetch segment dự đoán từ manifest, parse hộp sidx](/blogs/facebook-dash-predicted-segments)
- [#61 Đọc metadata MP4/MOV ngay trên client](/blogs/facebook-mp4-metadata-client)
- [#62 Upload tiếp tục được: offset, hash dedupe, phát hiện treo](/blogs/facebook-resumable-upload)
- [#63 Fenwick tree: chọn ngẫu nhiên có trọng số và offset dòng](/blogs/facebook-fenwick-weighted-random)
- [#64 Vạch trục số và trục thời gian "đẹp"](/blogs/facebook-nice-axis-ticks)
- **#65 Damerau-Levenshtein theo dải chéo và tự sửa tên gõ sai** (bài này)
- [#66 PRNG có seed, shuffle tái lập và lấy mẫu trace](/blogs/facebook-seeded-prng-sampling)
- [#67 Cặp min/max-heap tái dùng vị trí trong danh sách ảo](/blogs/facebook-dual-heap-buffer-set)
- [#68 Memo nhiều đối số bằng Map/WeakMap và interning object](/blogs/facebook-multikey-memo-interning)
- [#69 Thống kê cửa sổ trượt và đại số khoảng thời gian](/blogs/facebook-moving-stat-intervals)
- [#70 Int64 từ hai số 32-bit, decode UTF, offset theo code point](/blogs/facebook-int64-utf-codepoints)
- [#71 Engine múi giờ IANA trên client, phát hiện lệch giờ](/blogs/facebook-client-iana-timezone)
- [#72 Tự cài semver range](/blogs/facebook-semver-range)
- [#73 Auto-link URL, cắt chữ an toàn, giới hạn LaTeX](/blogs/facebook-autolink-safe-truncate)
- [#74 Parser query kiểu PHP chống prototype pollution](/blogs/facebook-php-query-serializer)
- [#75 Popover tự lật theo phần tràn nhỏ nhất](/blogs/facebook-popover-auto-flip)
- [#76 Tiền tố for(;;) chống JSON hijacking, đọc stream](/blogs/facebook-csrf-prefix-streaming)
- [#77 Chống lộ Referer, linkshim, xoá token trên URL](/blogs/facebook-referrer-linkshim-url-scrub)
- [#78 setImmediate bằng postMessage, gom delta chuột theo frame](/blogs/facebook-setimmediate-mouse-batching)
- [#79 Phát hiện crash qua heartbeat, dò proxy cache hỏng](/blogs/facebook-crash-heartbeat-proxy-check)
- [#80 DPR vào cookie cho ảnh @2x, che khoá trong log](/blogs/facebook-dpr-cookie-secret-redaction)
- [#81 Flux waitFor tự viết và proxy có đệm](/blogs/facebook-flux-dispatch-buffered-proxy)
- [#82 Crop đúng tỉ lệ, xoay sticker bằng ma trận](/blogs/facebook-image-crop-rotation-geometry)

:::

Code + demo: [`examples/facebook-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns) · [Mở trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns)
