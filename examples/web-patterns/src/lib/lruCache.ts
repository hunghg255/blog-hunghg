/**
 * Hai cách viết LRU cache không cần thư viện, cộng tính năng "ghim" key đang dùng.
 *
 * - LruMap: dựa vào việc Map luôn giữ thứ tự chèn (cách của Apple trên apps.apple.com).
 * - LinkedLru: danh sách liên kết đôi + Map, mọi thao tác O(1) (cách của Similarweb).
 * - isPinned: key đang được giao diện dùng thì không bị đẩy ra (ý tưởng từ MruCache của Outlook).
 */

export interface LruOptions<K, V> {
  max: number;
  /** key đang được dùng (vd thư đang mở) thì không bị đẩy ra, kể cả khi cache đã đầy */
  isPinned?: (key: K) => boolean;
  onEvict?: (key: K, value: V) => void;
}

function checkMax(max: number) {
  if (!Number.isInteger(max) || max < 0) throw new RangeError(`max phải là số nguyên ≥ 0, nhận ${max}`);
}

/** LRU dựa trên thứ tự chèn của Map: key đầu tiên luôn là key lâu chưa dùng nhất. */
export class LruMap<K, V> {
  private map = new Map<K, V>();
  private readonly options: LruOptions<K, V>;

  constructor(options: LruOptions<K, V>) {
    checkMax(options.max);
    this.options = options;
  }

  get size() {
    return this.map.size;
  }

  /** Đọc và đưa key lên "mới dùng nhất". */
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /** Đọc mà KHÔNG đổi thứ tự (dùng cho debug, hiển thị). */
  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  has(key: K) {
    return this.map.has(key);
  }

  set(key: K, value: V): this {
    // Map.set với key đã có KHÔNG đổi vị trí của nó, phải xoá rồi chèn lại
    this.map.delete(key);
    this.map.set(key, value);
    this.prune();
    return this;
  }

  delete(key: K) {
    return this.map.delete(key);
  }

  /** Từ cũ nhất tới mới nhất. */
  keys() {
    return [...this.map.keys()];
  }

  private prune() {
    const { max, isPinned, onEvict } = this.options;
    if (this.map.size <= max) return;
    for (const [key, value] of this.map) {
      if (this.map.size <= max) break;
      if (isPinned?.(key)) continue; // đang dùng: bỏ qua, xét key kế tiếp
      this.map.delete(key);
      onEvict?.(key, value);
    }
  }
}

interface Node<K, V> {
  key: K;
  value: V;
  prev: Node<K, V> | null;
  next: Node<K, V> | null;
}

/** LRU bằng danh sách liên kết đôi: head = mới dùng nhất, tail = lâu chưa dùng nhất. */
export class LinkedLru<K, V> {
  private nodes = new Map<K, Node<K, V>>();
  private head: Node<K, V> | null = null;
  private tail: Node<K, V> | null = null;
  private readonly options: LruOptions<K, V>;

  constructor(options: LruOptions<K, V>) {
    checkMax(options.max);
    this.options = options;
  }

  get size() {
    return this.nodes.size;
  }

  get(key: K): V | undefined {
    const node = this.nodes.get(key);
    if (!node) return undefined;
    this.moveToFront(node);
    return node.value;
  }

  peek(key: K): V | undefined {
    return this.nodes.get(key)?.value;
  }

  has(key: K) {
    return this.nodes.has(key);
  }

  set(key: K, value: V): this {
    const existing = this.nodes.get(key);
    if (existing) {
      existing.value = value;
      this.moveToFront(existing);
    } else {
      const node: Node<K, V> = { key, value, prev: null, next: this.head };
      if (this.head) this.head.prev = node;
      this.head = node;
      this.tail ??= node;
      this.nodes.set(key, node);
      this.prune();
    }
    return this;
  }

  delete(key: K) {
    const node = this.nodes.get(key);
    if (!node) return false;
    this.unlink(node);
    this.nodes.delete(key);
    return true;
  }

  /** Từ cũ nhất tới mới nhất, cùng thứ tự với LruMap.keys(). */
  keys() {
    const out: K[] = [];
    for (let node = this.tail; node; node = node.prev) out.push(node.key);
    return out;
  }

  private unlink(node: Node<K, V>) {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
    node.prev = node.next = null;
  }

  private moveToFront(node: Node<K, V>) {
    if (this.head === node) return;
    this.unlink(node);
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    this.tail ??= node;
  }

  private prune() {
    const { max, isPinned, onEvict } = this.options;
    let node = this.tail;
    while (this.nodes.size > max && node) {
      const prev = node.prev;
      if (!isPinned?.(node.key)) {
        this.unlink(node);
        this.nodes.delete(node.key);
        onEvict?.(node.key, node.value);
      }
      node = prev;
    }
  }
}

/** Ghi nhớ kết quả hàm, giới hạn số kết quả bằng LRU (Apple có hàm memoize tương tự, giới hạn 5). */
export function memoizeLru<A extends unknown[], R>(
  fn: (...args: A) => R,
  { max = 5, key = (...args: A) => JSON.stringify(args) }: { max?: number; key?: (...args: A) => string } = {},
) {
  const cache = new LruMap<string, R>({ max });
  return (...args: A): R => {
    const k = key(...args);
    if (cache.has(k)) return cache.get(k)!;
    const result = fn(...args);
    cache.set(k, result);
    return result;
  };
}
