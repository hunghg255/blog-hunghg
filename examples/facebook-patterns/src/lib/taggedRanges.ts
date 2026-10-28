/**
 * Hai công cụ cho trình phát video:
 * 1. TaggedRanges: bảng [start, end) → nhãn (ví dụ representation đang có trong buffer), truy vấn tuần tự O(1).
 * 2. Tiện ích khoảng thời gian và quyết định nhảy qua lỗ (gap) trong buffer.
 * Ý tưởng học từ oz-player (OzTaggedTimeRanges, OzPlayheadManager, OzNumericalRangeUtil) của Facebook, viết lại từ đầu.
 */

export interface TaggedRange<T> {
  start: number;
  end: number;
  tag: T;
}

/** Tìm chỉ số đầu tiên thoả `pred` trong mảng đã sắp xếp (pred đơn điệu false… true). */
function lowerBound<T>(arr: T[], pred: (x: T) => boolean): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pred(arr[mid])) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export class TaggedRanges<T> {
  private list: TaggedRange<T>[] = [];
  private cursor = 0;

  constructor(private readonly same: (a: T, b: T) => boolean = Object.is) {}

  /** Ghi đè [start, end) bằng `tag`: phần cũ bị cắt hoặc xoá, đoạn kề nhau cùng nhãn được gộp. */
  add(start: number, end: number, tag: T) {
    if (!(end > start)) return;
    const L = this.list;
    const i = lowerBound(L, (r) => r.end > start); // đoạn đầu tiên có thể chồng
    let j = i;
    while (j < L.length && L[j].start < end) j++; // L[i..j) chồng lên [start, end)

    const repl: TaggedRange<T>[] = [];
    if (i < j && L[i].start < start) repl.push({ ...L[i], end: start });
    repl.push({ start, end, tag });
    if (i < j && L[j - 1].end > end) repl.push({ ...L[j - 1], start: end });
    L.splice(i, j - i, ...repl);

    // Gộp với hàng xóm cùng nhãn chạm đúng mép, chỉ trong vùng vừa đổi.
    let k = Math.max(0, i - 1);
    let last = i + repl.length; // chỉ số của phần tử ngay sau vùng vừa thay
    while (k < last && k + 1 < L.length) {
      const a = L[k];
      const b = L[k + 1];
      if (a.end === b.start && this.same(a.tag, b.tag)) {
        L.splice(k, 2, { start: a.start, end: b.end, tag: b.tag });
        last--;
      } else k++;
    }
    this.cursor = 0; // chỉ số cũ không còn đúng sau khi mảng đổi
  }

  /** Nhãn tại thời điểm t. Phát tuần tự thì thường trúng ngay đoạn đang trỏ hoặc đoạn kế, không thì tìm nhị phân. */
  get(t: number): T | null {
    const L = this.list;
    for (const k of [this.cursor, this.cursor + 1]) {
      const r = L[k];
      if (r && r.start <= t && t < r.end) {
        this.cursor = k;
        return r.tag;
      }
    }
    const k = lowerBound(L, (r) => r.end > t);
    if (k < L.length && L[k].start <= t) {
      this.cursor = k;
      return L[k].tag;
    }
    return null;
  }

  ranges(): readonly TaggedRange<T>[] {
    return this.list;
  }
}

// ---------- Khoảng thời gian và lỗ buffer ----------

export interface Range {
  start: number;
  end: number;
}

/** Sai số khi so thời gian (giây): timestamp của buffer hiếm khi khớp tuyệt đối. */
export const EPS = 0.01;

export function fromTimeRanges(tr: TimeRanges): Range[] {
  const out: Range[] = [];
  for (let i = 0; i < tr.length; i++) out.push({ start: tr.start(i), end: tr.end(i) });
  return out;
}

/** Gộp các khoảng chồng hoặc chạm nhau (trong sai số). Không sửa mảng đầu vào. */
export function mergeRanges(ranges: readonly Range[], eps = EPS): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + eps) last.end = Math.max(last.end, r.end);
    else out.push({ start: r.start, end: r.end }); // bản sao, không giữ tham chiếu tới input
  }
  return out;
}

/** Chỉ số khoảng chứa t (nới mỗi đầu `eps`), -1 nếu t nằm trong lỗ. */
export function rangeIndexAt(t: number, ranges: readonly Range[], eps = EPS): number {
  return ranges.findIndex((r) => t >= r.start - eps && t <= r.end + eps);
}

/** Chỉ số khoảng đầu tiên bắt đầu sau t. */
export function nextRangeIndex(t: number, ranges: readonly Range[], eps = EPS): number {
  return ranges.findIndex((r) => r.start > t + eps);
}

/** Số giây trong [a, b] được các khoảng phủ. */
export function coveredSeconds(a: number, b: number, ranges: readonly Range[]): number {
  let sum = 0;
  for (const r of ranges) sum += Math.max(0, Math.min(b, r.end) - Math.max(a, r.start));
  return sum;
}

export interface GapPolicy {
  /** Nhảy tới next.start + slack, để chắc chắn rơi vào trong khoảng có dữ liệu. */
  slack: number;
  /** Coi là "sát lỗ" khi còn ít hơn chừng này giây là hết khoảng hiện tại. */
  nearGapSec: number;
  /** Lỗ lớn hơn thì không nhảy (có thể dữ liệu đang tới); 0 là không giới hạn. */
  maxGapSec: number;
}

export type GapJump = { to: number; reason: 'in_gap' | 'stalled_near_gap'; skippedBuffered: number } | null;

/**
 * Quyết định có nhảy qua lỗ không. `stalled`: trình phát đã đứng yên (sự kiện waiting, hoặc
 * currentTime không tăng) trong khi đáng lẽ đang phát. Sát lỗ mà vẫn phát được thì để nó phát nốt.
 */
export function planGapJump(t: number, buffered: readonly Range[], policy: GapPolicy, stalled: boolean): GapJump {
  const ranges = mergeRanges(buffered);
  const n = nextRangeIndex(t, ranges);
  if (n === -1) return null;
  const next = ranges[n];
  const i = rangeIndexAt(t, ranges);
  if (i !== -1) {
    const cur = ranges[i];
    if (!stalled || cur.end - t >= policy.nearGapSec) return null;
  }
  if (policy.maxGapSec > 0 && next.start - t > policy.maxGapSec) return null;
  const to = next.start + policy.slack;
  return { to, reason: i === -1 ? 'in_gap' : 'stalled_near_gap', skippedBuffered: coveredSeconds(t, next.start, ranges) };
}
