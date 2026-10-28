/**
 * Map nhiều khoá dạng trie, lai Map/WeakMap (ý tưởng từ module MultiKeyMap của Facebook).
 *
 * Mỗi nút trie có hai bảng con:
 * - `strong`: Map cho khoá nguyên thuỷ (string, number, boolean, null, undefined, symbol, bigint)
 * - `weak`:   WeakMap cho khoá là object/hàm, để object chết thì nhánh của nó được GC thu hồi
 *
 * Khác bản gốc: `delete` tỉa các nút rỗng trên đường về gốc (bản gốc để lại nút rỗng mãi
 * trong các Map mạnh), và symbol được coi là khoá nguyên thuỷ (WeakMap chỉ nhận một số symbol).
 */

type Leaf<V> = { kind: 'value'; value: V };
interface Node<V> {
  kind: 'node';
  strong: Map<unknown, Node<V> | Leaf<V>>;
  weak: WeakMap<object, Node<V> | Leaf<V>>;
  /** số con trong `strong` + `weak` (WeakMap không đếm được nên tự đếm) */
  size: number;
}

const isPrimitive = (key: unknown): boolean =>
  key === null || (typeof key !== 'object' && typeof key !== 'function');

const newNode = <V>(): Node<V> => ({ kind: 'node', strong: new Map(), weak: new WeakMap(), size: 0 });

function child<V>(node: Node<V>, key: unknown) {
  return isPrimitive(key) ? node.strong.get(key) : node.weak.get(key as object);
}

function setChild<V>(node: Node<V>, key: unknown, value: Node<V> | Leaf<V>) {
  const had = child(node, key) !== undefined;
  if (isPrimitive(key)) node.strong.set(key, value);
  else node.weak.set(key as object, value);
  if (!had) node.size++;
}

function deleteChild<V>(node: Node<V>, key: unknown) {
  const had = isPrimitive(key) ? node.strong.delete(key) : node.weak.delete(key as object);
  if (had) node.size--;
  return had;
}

export class MultiKeyMap<K extends readonly unknown[], V> {
  private root: Node<V> = newNode();
  private arity: number | null = null;

  private check(keys: K) {
    if (keys.length === 0) throw new Error('MultiKeyMap: cần ít nhất một khoá');
    this.arity ??= keys.length;
    if (keys.length !== this.arity) {
      throw new Error(`MultiKeyMap: luôn phải dùng ${this.arity} khoá, nhận ${keys.length}`);
    }
  }

  set(keys: K, value: V): this {
    this.check(keys);
    let node = this.root;
    for (let i = 0; i < keys.length - 1; i++) {
      let next = child(node, keys[i]);
      if (next === undefined) {
        next = newNode<V>();
        setChild(node, keys[i], next);
      }
      node = next as Node<V>;
    }
    setChild(node, keys[keys.length - 1], { kind: 'value', value });
    return this;
  }

  get(keys: K): V | undefined {
    this.check(keys);
    let node: Node<V> | Leaf<V> | undefined = this.root;
    for (const key of keys) {
      if (node === undefined || node.kind !== 'node') return undefined;
      node = child(node, key);
    }
    return node?.kind === 'value' ? node.value : undefined;
  }

  has(keys: K): boolean {
    this.check(keys);
    let node: Node<V> | Leaf<V> | undefined = this.root;
    for (const key of keys) {
      if (node === undefined || node.kind !== 'node') return false;
      node = child(node, key);
    }
    return node?.kind === 'value';
  }

  delete(keys: K): boolean {
    this.check(keys);
    const path: Node<V>[] = [];
    let node: Node<V> | Leaf<V> | undefined = this.root;
    for (let i = 0; i < keys.length - 1; i++) {
      if (node === undefined || node.kind !== 'node') return false;
      path.push(node);
      node = child(node, keys[i]);
    }
    if (node === undefined || node.kind !== 'node') return false;
    if (!deleteChild(node, keys[keys.length - 1])) return false;
    // tỉa ngược: nút nào hết con thì gỡ khỏi cha
    for (let i = path.length - 1; i >= 0 && node.size === 0; i--) {
      deleteChild(path[i], keys[i]);
      node = path[i];
    }
    return true;
  }

  /** Số nút trie đang được giữ bằng tham chiếu mạnh (để đo rò bộ nhớ trong demo). */
  countStrongNodes(): number {
    const walk = (node: Node<V>): number => {
      let n = 1;
      node.strong.forEach((c) => {
        if (c.kind === 'node') n += walk(c);
      });
      return n;
    };
    return walk(this.root);
  }
}

export interface MemoStats {
  hits: number;
  misses: number;
}

/**
 * Memo hoá hàm nhiều đối số. Đối số là object thì cache tự rụng khi object bị GC.
 * (Facebook dựng `memoizeWithArgsWeak` trên MultiKeyMap theo đúng cách này.)
 */
export function memoizeWithArgs<A extends readonly unknown[], R>(fn: (...args: A) => R) {
  const cache = new MultiKeyMap<A, R>();
  const stats: MemoStats = { hits: 0, misses: 0 };
  const memoized = (...args: A): R => {
    // hàm không đối số vẫn cần một khoá
    const keys = (args.length === 0 ? [undefined] : args) as unknown as A;
    if (cache.has(keys)) {
      stats.hits++;
      return cache.get(keys) as R;
    }
    stats.misses++;
    const result = fn(...args);
    cache.set(keys, result);
    return result;
  };
  return Object.assign(memoized, { stats, cache });
}
