/**
 * Hai bản đối chứng cho demo LRU (viết lại theo mô tả, không phải mã gốc):
 * - ArrayLru: giữ thứ tự bằng mảng + indexOf/splice như MruCache của Outlook, mỗi lần chạm là O(n).
 * - NaiveMapLru: như LruMap của Apple, set() KHÔNG xoá key cũ trước nên cập nhật giá trị không đổi thứ tự.
 */
export class ArrayLru<K, V> {
  private store = new Map<K, V>();
  private order: K[] = []; // cũ → mới
  constructor(private max: number) {}

  get(key: K) {
    if (!this.store.has(key)) return undefined;
    this.touch(key);
    return this.store.get(key);
  }

  set(key: K, value: V) {
    this.store.set(key, value);
    if (this.order.indexOf(key) >= 0) this.touch(key);
    else {
      this.order.push(key);
      while (this.order.length > this.max) this.store.delete(this.order.shift()!);
    }
  }

  keys() {
    return [...this.order];
  }

  private touch(key: K) {
    const i = this.order.indexOf(key);
    this.order.splice(i, 1);
    this.order.push(key);
  }
}

export class NaiveMapLru<K, V> extends Map<K, V> {
  constructor(private max: number) {
    super();
  }

  get(key: K) {
    if (!this.has(key)) return undefined;
    const value = super.get(key)!;
    this.delete(key);
    super.set(key, value);
    return value;
  }

  set(key: K, value: V) {
    super.set(key, value); // key đã có: giữ nguyên vị trí cũ
    while (this.size > this.max) this.delete(this.keys().next().value!);
    return this;
  }
}
