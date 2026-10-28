/**
 * Cache kết quả query theo (queryId, biến), có TTL và giới hạn kích thước.
 * Ý tưởng từ RelayQueryResponseCache, viết lại thành LRU thật: get cũng làm mới thứ tự,
 * và chỉ kiểm tra hạn của đúng mục đang đọc thay vì quét cả Map.
 */

/** JSON với khoá object được sắp xếp, để {a,b} và {b,a} cho cùng một chuỗi. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  );
}

interface Entry<T> {
  fetchTime: number;
  payload: T;
}

export interface CacheOptions {
  size: number;
  ttl: number;
  /** đổi được để test/demo */
  now?: () => number;
}

export class ResponseCache<T> {
  private map = new Map<string, Entry<T>>();
  private size: number;
  private ttl: number;
  private now: () => number;

  constructor({ size, ttl, now = Date.now }: CacheOptions) {
    if (!(size > 0) || !(ttl > 0)) throw new Error('size và ttl phải > 0');
    this.size = size;
    this.ttl = ttl;
    this.now = now;
  }

  static key(queryId: string, variables: Record<string, unknown>) {
    return stableStringify({ queryId, variables });
  }

  get(
    queryId: string,
    variables: Record<string, unknown>,
  ): (T & { cacheTimestamp: number }) | null {
    const key = ResponseCache.key(queryId, variables);
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.fetchTime + this.ttl < this.now()) {
      this.map.delete(key);
      return null;
    }
    // LRU: đưa xuống cuối thứ tự chèn
    this.map.delete(key);
    this.map.set(key, entry);
    return { ...entry.payload, cacheTimestamp: entry.fetchTime };
  }

  set(queryId: string, variables: Record<string, unknown>, payload: T) {
    const key = ResponseCache.key(queryId, variables);
    this.map.delete(key);
    this.map.set(key, { fetchTime: this.now(), payload });
    while (this.map.size > this.size) {
      // mục cũ nhất (ít được dùng gần đây nhất) nằm đầu Map
      this.map.delete(this.map.keys().next().value!);
    }
  }

  /** Dọn mục hết hạn, gọi định kỳ nếu cần (không phải mỗi lần get). */
  prune() {
    const now = this.now();
    for (const [k, e] of this.map) if (e.fetchTime + this.ttl < now) this.map.delete(k);
  }

  clear() {
    this.map.clear();
  }

  keys() {
    return [...this.map.keys()];
  }
}
