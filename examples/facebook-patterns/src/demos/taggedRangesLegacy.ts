/**
 * Mô phỏng lại thuật toán của OzTaggedTimeRanges (bản gốc) bằng code dễ đọc, chỉ để demo so sánh.
 * Giữ nguyên các chỗ sai: đoạn bị phủ trọn không bị xoá (push thay vì splice), gộp hai phía dùng
 * đối tượng cũ nên mất phần bên trái, và con trỏ của get() không được đặt lại sau add().
 */
export interface LegacyRange {
  start: number;
  end: number;
  tag: string;
}

export class LegacyTaggedRanges {
  list: LegacyRange[] = [];
  private cursor = 0;
  private lastT = 0;

  add(start: number, end: number, tag: string) {
    if (end <= start) return;
    const L = this.list;
    if (L.length === 0) {
      L.push({ start, end, tag });
      return;
    }
    let from = 0;
    let to = 0;
    for (let f = 0; f < L.length; f++) {
      if (start === L[f].start && end === L[f].end) {
        from = f;
        to = f + 1;
        break;
      }
      if (start >= L[f].start) from = f + 1;
      if (end <= L[f].end) to = f;
      if (end < L[f].start) break;
    }
    L.splice(from, Math.max(0, to - from), { start, end, tag });
    this.fix(from);
  }

  private fix(idx: number) {
    const L = this.list;
    let a = idx;
    const b = L[a];
    const prev = a > 0 ? L[a - 1] : null;
    if (prev) {
      if (prev.tag === b.tag) {
        if (prev.end >= b.start) {
          L.splice(a - 1, 2, { start: prev.start, end: Math.max(b.end, prev.end), tag: b.tag });
          a--;
        }
      } else {
        if (prev.end > b.start && prev.start === b.start) {
          L.splice(a - 1, 1);
          a--;
        } else if (prev.end > b.start) {
          L.splice(a - 1, 1, { start: prev.start, end: b.start, tag: prev.tag });
        }
        if (prev.end > b.end) L.splice(a + 1, 0, { start: b.end, end: prev.end, tag: prev.tag });
      }
    }
    const next = a !== L.length - 1 ? L[a + 1] : null;
    if (!next || next.start > b.end) return;
    if (next.tag === b.tag) {
      // `b` vẫn là đối tượng trước khi gộp với bên trái → mất phần bên trái nếu vừa gộp.
      L.splice(a, 2, { start: b.start, end: Math.max(next.end, b.end), tag: b.tag });
    } else if (next.end < b.end) {
      // Đoạn `next` nằm trọn trong `b`: đáng lẽ phải xoá, bản gốc lại push phần còn lại xuống cuối mảng.
      L.splice(a, 1, { start: b.start, end: next.start, tag: b.tag });
      L.push({ start: next.end, end: b.end, tag: b.tag });
    } else {
      L.splice(a + 1, 1, { start: b.end, end: next.end, tag: next.tag });
    }
  }

  get(t: number): string | null {
    const from = t >= this.lastT ? this.cursor : 0;
    let found: number | null = null;
    for (let i = from; i < this.list.length; i++) {
      if (this.list[i].start <= t && t < this.list[i].end) {
        found = i;
        break;
      }
    }
    this.cursor = found ?? 0;
    this.lastT = t;
    return found == null ? null : this.list[found].tag;
  }
}
