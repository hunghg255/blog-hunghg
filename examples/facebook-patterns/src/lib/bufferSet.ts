/**
 * Gán dòng (row index) vào một số "chỗ" (position) cố định để tái dùng node DOM khi cuộn
 * (ý tưởng từ IntegerBufferSet của Facebook, dùng trong FixedDataTable).
 *
 * Khi một dòng mới cần hiện ra mà hết chỗ, ta lấy chỗ của dòng ở XA vùng nhìn thấy nhất.
 * Dòng xa nhất là dòng nhỏ nhất hoặc lớn nhất, nên giữ cùng lúc một min-heap và một
 * max-heap trên row index, xoá kiểu lười (lazy): entry đã bị thay vẫn nằm trong heap,
 * chỉ bị bỏ khi nó nổi lên đỉnh.
 */

export class Heap<T> {
  private items: T[] = [];

  constructor(private readonly less: (a: T, b: T) => boolean) {}

  get size() {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(item: T) {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(items[i], items[parent])) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        if (l < items.length && this.less(items[l], items[best])) best = l;
        if (r < items.length && this.less(items[r], items[best])) best = r;
        if (best === i) break;
        [items[i], items[best]] = [items[best], items[i]];
        i = best;
      }
    }
    return top;
  }
}

interface Entry {
  value: number;
  position: number;
  /** đánh dấu entry này đã hết hiệu lực (thay cho việc tra map như bản gốc) */
  stale: boolean;
}

export class BufferSet {
  private readonly byValue = new Map<number, Entry>();
  private nextPosition = 0;
  private minHeap = new Heap<Entry>((a, b) => a.value < b.value);
  private maxHeap = new Heap<Entry>((a, b) => a.value > b.value);

  /** Số chỗ đã cấp. */
  get size() {
    return this.nextPosition;
  }

  /** Số entry đang nằm trong hai heap (kể cả entry đã hết hiệu lực), để quan sát dọn rác. */
  get heapSizes() {
    return { min: this.minHeap.size, max: this.maxHeap.size };
  }

  positionOf(value: number) {
    return this.byValue.get(value)?.position ?? null;
  }

  /** Cấp chỗ mới hoàn toàn (khi chưa đạt giới hạn số node). */
  addNew(value: number) {
    if (this.byValue.has(value)) throw new Error(`dòng ${value} đã có chỗ`);
    const position = this.nextPosition++;
    this.track(value, position);
    return position;
  }

  /**
   * Lấy chỗ của dòng nằm ngoài [low, high] và xa nhất để giao cho newValue.
   * Trả null nếu mọi dòng đang giữ chỗ đều nằm trong [low, high] (không được đá dòng đang hiện).
   */
  replaceFurthest(low: number, high: number, newValue: number) {
    if (this.byValue.has(newValue)) throw new Error(`dòng ${newValue} đã có chỗ`);
    this.dropStaleTops();
    const min = this.minHeap.peek();
    const max = this.maxHeap.peek();
    if (!min || !max) return null;
    if (min.value >= low && max.value <= high) return null;

    // bên nào lệch khỏi vùng nhìn thấy nhiều hơn thì bị lấy chỗ
    const victim = low - min.value > max.value - high ? this.minHeap.pop()! : this.maxHeap.pop()!;
    victim.stale = true;
    this.byValue.delete(victim.value);
    this.track(newValue, victim.position);
    this.compactIfBloated();
    return victim.position;
  }

  private track(value: number, position: number) {
    const entry: Entry = { value, position, stale: false };
    this.byValue.set(value, entry);
    this.minHeap.push(entry);
    this.maxHeap.push(entry);
  }

  private dropStaleTops() {
    while (this.minHeap.peek()?.stale) this.minHeap.pop();
    while (this.maxHeap.peek()?.stale) this.maxHeap.pop();
  }

  /**
   * Mỗi lần thay chỉ pop ở MỘT heap; heap kia giữ lại entry cũ. Khi một heap lớn hơn 10 lần
   * số dòng đang sống thì dựng lại cả hai từ map (bản gốc so hai heap với nhau).
   */
  private compactIfBloated() {
    const live = this.byValue.size;
    if (Math.max(this.minHeap.size, this.maxHeap.size) <= 10 * Math.max(live, 1)) return;
    this.minHeap = new Heap<Entry>((a, b) => a.value < b.value);
    this.maxHeap = new Heap<Entry>((a, b) => a.value > b.value);
    for (const entry of this.byValue.values()) {
      this.minHeap.push(entry);
      this.maxHeap.push(entry);
    }
  }
}

/**
 * Tiện ích cho danh sách ảo: với dải dòng cần hiện [first, last] và giới hạn số node,
 * trả về map row → position. Dòng đã có chỗ giữ nguyên chỗ (node DOM không đổi).
 */
export function assignRows(set: BufferSet, first: number, last: number, maxNodes: number) {
  const assignment = new Map<number, number>();
  for (let row = first; row <= last; row++) {
    let position = set.positionOf(row);
    if (position === null) {
      position = set.size < maxNodes ? set.addNew(row) : set.replaceFurthest(first, last, row);
    }
    if (position !== null) assignment.set(row, position);
  }
  return assignment;
}
