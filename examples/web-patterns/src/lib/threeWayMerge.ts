/**
 * Three-way merge theo dòng (thuật toán diff3), chạy hoàn toàn trên trình duyệt.
 *
 * Ý tưởng từ pmDiff của Postman: server trả về ba phiên bản (base, của mình, của họ),
 * client tự tính chỗ nào gộp được, chỗ nào xung đột, và cho người dùng chọn từng khối.
 * Khác Postman: dòng được căn bằng LCS (dãy con chung dài nhất) thay vì so theo số thứ tự dòng,
 * nên chèn một dòng ở đầu file không biến cả phần còn lại thành xung đột.
 */

export type MergeChunk =
  /** giống nhau ở cả ba bản */
  | { kind: 'same'; lines: string[] }
  /** chỉ một bên đổi (hoặc hai bên đổi giống hệt nhau): tự gộp được */
  | { kind: 'ours' | 'theirs' | 'both'; base: string[]; lines: string[] }
  /** hai bên đổi cùng một chỗ theo hai cách khác nhau */
  | { kind: 'conflict'; id: number; base: string[]; ours: string[]; theirs: string[] };

export type Resolution = 'ours' | 'theirs' | 'both' | 'base';

export interface MergeResult {
  chunks: MergeChunk[];
  conflicts: number;
}

/** Bảng LCS tốn (số dòng a) × (số dòng b) ô: vượt mức này thì báo lỗi thay vì treo tab. */
export const MAX_LCS_CELLS = 4_000_000;

export function splitLines(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

/**
 * Với mỗi dòng của `a`, trả về chỉ số dòng khớp với nó trong `b` theo LCS, hoặc -1.
 * Các cặp khớp luôn tăng dần ở cả hai phía (đó là tính chất của dãy con chung).
 */
export function lcsMatch(a: string[], b: string[]): number[] {
  const match = new Array<number>(a.length).fill(-1);

  // Phần đầu và phần cuối giống nhau thì khớp luôn, bảng LCS chỉ cần cho đoạn giữa.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    match[start] = start;
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
    match[endA] = endB;
  }

  const rows = endA - start;
  const cols = endB - start;
  if (rows === 0 || cols === 0) return match;
  if (rows * cols > MAX_LCS_CELLS) {
    throw new RangeError(`Đoạn khác nhau quá lớn để so (${rows} × ${cols} dòng)`);
  }

  // dp[i][j] = độ dài LCS của a[start+i..endA) và b[start+j..endB), tính từ cuối lên
  const width = cols + 1;
  const dp = new Uint32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[start + i] === b[start + j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (a[start + i] === b[start + j]) {
      match[start + i] = start + j;
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return match;
}

const sameLines = (x: string[], y: string[]) =>
  x.length === y.length && x.every((line, i) => line === y[i]);

/** Gộp ba phiên bản. `ours` là bản của mình, `theirs` là bản người khác, `base` là tổ tiên chung. */
export function merge3(base: string, ours: string, theirs: string): MergeResult {
  const o = splitLines(base);
  const a = splitLines(ours);
  const b = splitLines(theirs);
  const matchA = lcsMatch(o, a);
  const matchB = lcsMatch(o, b);

  const chunks: MergeChunk[] = [];
  let conflicts = 0;

  const pushSame = (lines: string[]) => {
    if (lines.length === 0) return;
    const last = chunks[chunks.length - 1];
    if (last?.kind === 'same') last.lines.push(...lines);
    else chunks.push({ kind: 'same', lines: [...lines] });
  };

  let io = 0; // vị trí đang xét trong base
  let ia = 0; // trong ours
  let ib = 0; // trong theirs

  for (;;) {
    // Tìm "điểm neo" tiếp theo: một dòng của base còn nguyên ở CẢ HAI bản
    let k = io;
    while (k < o.length && (matchA[k] < 0 || matchB[k] < 0)) k++;
    const ka = k < o.length ? matchA[k] : a.length;
    const kb = k < o.length ? matchB[k] : b.length;

    // Đoạn giữa hai điểm neo: có thể bên nào đó đã sửa
    if (k > io || ka > ia || kb > ib) {
      const O = o.slice(io, k);
      const A = a.slice(ia, ka);
      const B = b.slice(ib, kb);

      if (sameLines(A, O) && sameLines(B, O)) pushSame(O);
      else if (sameLines(A, O)) chunks.push({ kind: 'theirs', base: O, lines: B });
      else if (sameLines(B, O)) chunks.push({ kind: 'ours', base: O, lines: A });
      else if (sameLines(A, B)) chunks.push({ kind: 'both', base: O, lines: A });
      else chunks.push({ kind: 'conflict', id: conflicts++, base: O, ours: A, theirs: B });
    }

    if (k >= o.length) break;
    pushSame([o[k]]);
    io = k + 1;
    ia = ka + 1;
    ib = kb + 1;
  }

  return { chunks, conflicts };
}

export const MARKER = { ours: '<'.repeat(7), sep: '='.repeat(7), theirs: '>'.repeat(7) };

/**
 * Dựng văn bản kết quả. Xung đột chưa chọn được ghi kèm dấu kiểu Git
 * (7 dấu <, 7 dấu =, 7 dấu >) để không âm thầm mất dữ liệu của bên nào.
 */
export function buildMergedText(
  chunks: MergeChunk[],
  choices: Partial<Record<number, Resolution>> = {},
): { text: string; unresolved: number } {
  const out: string[] = [];
  let unresolved = 0;

  for (const chunk of chunks) {
    if (chunk.kind !== 'conflict') {
      out.push(...chunk.lines);
      continue;
    }
    const choice = choices[chunk.id];
    if (choice === 'ours') out.push(...chunk.ours);
    else if (choice === 'theirs') out.push(...chunk.theirs);
    else if (choice === 'both') out.push(...chunk.ours, ...chunk.theirs);
    else if (choice === 'base') out.push(...chunk.base);
    else {
      unresolved++;
      out.push(`${MARKER.ours} của tôi`, ...chunk.ours, MARKER.sep, ...chunk.theirs, `${MARKER.theirs} của họ`);
    }
  }

  return { text: out.join('\n'), unresolved };
}
