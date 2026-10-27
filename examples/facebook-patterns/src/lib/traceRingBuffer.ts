/**
 * Một ring buffer DÙNG CHUNG cho nhiều "cửa sổ ghi" (trace) mở chồng lên nhau, và mỗi cửa sổ
 * biết mình đã bị mất bao nhiêu phần tử khi buffer đầy (ý tưởng từ CircularBuffer +
 * IntervalTrackingBoundedBuffer của Facebook, dùng cho log TimeSlice của interaction trace).
 */

export class CircularBuffer<T> {
  private items: T[] = [];
  /** vị trí ghi tiếp theo khi buffer đã đầy (cũng là vị trí phần tử cũ nhất) */
  private head = 0;
  private evictListeners: Array<(item: T) => void> = [];

  constructor(private capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('Buffer size should be a positive integer');
    }
  }

  write(item: T) {
    if (this.items.length < this.capacity) {
      this.items.push(item);
    } else {
      // đầy: báo cho người nghe trước khi đè phần tử cũ nhất
      const evicted = this.items[this.head];
      this.evictListeners.forEach((listener) => listener(evicted));
      this.items[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
    }
    return this;
  }

  onEvict(listener: (item: T) => void) {
    this.evictListeners.push(listener);
    return this;
  }

  /** Các phần tử theo thứ tự từ cũ tới mới. */
  read(): T[] {
    return this.items.slice(this.head).concat(this.items.slice(0, this.head));
  }

  /** Bỏ `count` phần tử cũ nhất (không gọi onEvict: đây là dọn chủ động, không phải tràn). */
  dropFirst(count: number) {
    if (count <= 0) return this;
    const ordered = this.read();
    ordered.splice(0, count);
    this.items = ordered;
    this.head = 0;
    return this;
  }

  get size() {
    return this.items.length;
  }
}

export interface RecordingWindow<T> {
  id: number;
  /** số phần tử đã đẩy vào buffer (tính từ đầu) lúc cửa sổ mở */
  startIndex: number;
  /** số phần tử của cửa sổ này đã bị đẩy ra khỏi buffer trước khi kịp đóng */
  getOverflowSize(): number;
  hasOverflown(): boolean;
  /** Đóng cửa sổ, trả về các phần tử còn giữ được kể từ lúc mở. Gọi lần hai trả []. */
  close(): T[];
}

/**
 * Ý tưởng chính: đánh số TUYỆT ĐỐI cho mọi phần tử từng được đẩy vào.
 * - `pushed`: tổng số phần tử đã đẩy (chỉ số tuyệt đối của phần tử kế tiếp)
 * - `dropped`: số phần tử đã rời buffer (bị đè hoặc bị dọn) = chỉ số tuyệt đối của phần tử
 *   cũ nhất còn trong buffer
 * Một cửa sổ mở lúc `pushed = s` thì đã mất `max(dropped - s, 0)` phần tử của nó.
 */
export class IntervalTrackingBuffer<T> {
  private buffer: CircularBuffer<T>;
  private windows: RecordingWindow<T>[] = [];
  private nextId = 1;
  private pushed = 0;
  private dropped = 0;

  constructor(capacity = 5000) {
    this.buffer = new CircularBuffer<T>(capacity).onEvict(() => {
      this.dropped++;
    });
  }

  /** Không có cửa sổ nào mở thì không ghi gì: không ai cần, khỏi tốn bộ nhớ. */
  push(item: T) {
    if (this.windows.length === 0) return false;
    this.buffer.write(item);
    this.pushed++;
    return true;
  }

  isActive() {
    return this.windows.length > 0;
  }

  get stats() {
    return { size: this.buffer.size, pushed: this.pushed, dropped: this.dropped, open: this.windows.length };
  }

  open(): RecordingWindow<T> {
    const id = this.nextId++;
    const startIndex = this.pushed;
    let closed = false;
    let finalOverflow: number | null = null;
    const window: RecordingWindow<T> = {
      id,
      startIndex,
      getOverflowSize: () => finalOverflow ?? Math.max(this.dropped - startIndex, 0),
      hasOverflown: () => window.getOverflowSize() > 0,
      close: () => {
        if (closed) return [];
        closed = true;
        finalOverflow = Math.max(this.dropped - startIndex, 0);
        return this.closeWindow(id);
      },
    };
    this.windows.push(window);
    return window;
  }

  /** chỉ số tuyệt đối -> vị trí trong buffer hiện tại */
  private position(absoluteIndex: number) {
    return Math.max(absoluteIndex - this.dropped, 0);
  }

  private closeWindow(id: number): T[] {
    const index = this.windows.findIndex((w) => w.id === id);
    if (index === -1) return [];
    const [closing] = this.windows.splice(index, 1);
    const entries = this.buffer.read().slice(this.position(closing.startIndex));

    // Dọn: phần tử nằm trước cửa sổ còn mở sớm nhất thì không ai cần nữa.
    // Không còn cửa sổ nào -> dọn sạch.
    const oldestStillNeeded = this.windows.length
      ? Math.min(...this.windows.map((w) => w.startIndex))
      : this.pushed;
    const removable = this.position(oldestStillNeeded);
    if (removable > 0) {
      this.buffer.dropFirst(removable);
      this.dropped += removable;
    }
    return entries;
  }
}
