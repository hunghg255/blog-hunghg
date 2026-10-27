/**
 * Sửa hàng loạt kiểu Ads Manager (ý tưởng từ AdsBulkValueUtils / AdsEmptyValue /
 * AdsUniformValue / AdsMixedValue của Facebook).
 *
 * Chọn N chiến dịch rồi mở một form: mỗi field trong form không giữ "một giá trị" mà giữ
 * một BulkValue cho cả N dòng:
 *   - empty:   cả N dòng đều rỗng (null, '', [], Set rỗng, {} rỗng)
 *   - uniform: cả N dòng cùng một giá trị
 *   - mixed:   mỗi dòng một giá trị, giữ nguyên mảng N giá trị
 * Sửa một field thì chỉ field đó thành uniform; field không đụng tới giữ đúng giá trị
 * riêng của từng dòng khi tách ngược ra N object.
 */

export type BulkValue<T = unknown> =
  | { kind: 'empty' }
  | { kind: 'uniform'; value: T }
  | { kind: 'mixed'; values: T[] };

const EMPTY: BulkValue<never> = Object.freeze({ kind: 'empty' });

export function isEmptyLike(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Set || value instanceof Map) return value.size === 0;
  if (Object.prototype.toString.call(value) === '[object Object]') {
    return Object.keys(value as object).length === 0;
  }
  return false;
}

/** So sánh sâu đơn giản cho dữ liệu JSON (đủ cho form). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** Thử lần lượt empty → uniform → mixed, giống thứ tự AdsEmptyUniformMixedBulkValueTypes. */
export function aggregate<T>(values: T[], equal = deepEqual): BulkValue<T> {
  if (values.every(isEmptyLike)) return EMPTY;
  const first = values[0];
  if (values.every((v) => equal(v, first))) return { kind: 'uniform', value: first };
  return { kind: 'mixed', values };
}

export function match<T, R>(
  bulk: BulkValue<T>,
  cases: { empty: () => R; uniform: (value: T) => R; mixed: (values: T[]) => R },
): R {
  if (bulk.kind === 'empty') return cases.empty();
  if (bulk.kind === 'uniform') return cases.uniform(bulk.value);
  return cases.mixed(bulk.values);
}

/** Giá trị cho dòng thứ i; undefined nghĩa là "không ghi gì". */
export function valueAt<T>(bulk: BulkValue<T>, index: number): T | undefined {
  if (bulk.kind === 'empty') return undefined;
  if (bulk.kind === 'uniform') return bulk.value;
  return bulk.values[index];
}

// ---- gộp/tách sâu theo path ----

/** Cây field: lá là `true`, nhánh là object con. */
export type Shape = { [key: string]: true | Shape };
export type BulkTree = { [key: string]: BulkValue | BulkTree };

export function isBulkValue(value: unknown): value is BulkValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    ['empty', 'uniform', 'mixed'].includes((value as { kind: string }).kind)
  );
}

export function getByPath(object: unknown, path: string[]): unknown {
  let current = object;
  for (const key of path) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function setByPath(object: Record<string, unknown>, path: string[], value: unknown) {
  let current = object;
  path.slice(0, -1).forEach((key) => {
    if (typeof current[key] !== 'object' || current[key] === null) current[key] = {};
    current = current[key] as Record<string, unknown>;
  });
  current[path[path.length - 1]] = value;
}

/** N object → một cây BulkValue theo shape. */
export function aggregateDeep(objects: object[], shape: Shape, path: string[] = []): BulkTree {
  const tree: BulkTree = {};
  for (const [key, child] of Object.entries(shape)) {
    const childPath = [...path, key];
    tree[key] =
      child === true
        ? aggregate(objects.map((o) => getByPath(o, childPath)))
        : aggregateDeep(objects, child, childPath);
  }
  return tree;
}

/** Cây BulkValue → N object. Lá empty thì không ghi (giống hàm `z` của bản gốc). */
export function deaggregateDeep(tree: BulkTree, count: number): Record<string, unknown>[] {
  const out = Array.from({ length: count }, () => ({}) as Record<string, unknown>);
  const walk = (node: BulkTree, path: string[]) => {
    for (const [key, child] of Object.entries(node)) {
      const childPath = [...path, key];
      if (isBulkValue(child)) {
        out.forEach((object, i) => {
          const value = valueAt(child, i);
          if (value !== undefined) setByPath(object, childPath, value);
        });
      } else {
        walk(child, childPath);
      }
    }
  };
  walk(tree, []);
  return out;
}

/** Sửa một field trên form: lá đó thành uniform (hoặc empty nếu giá trị rỗng). */
export function editLeaf(tree: BulkTree, path: string[], value: unknown): BulkTree {
  const [head, ...rest] = path;
  const node = tree[head];
  if (rest.length === 0) return { ...tree, [head]: isEmptyLike(value) ? EMPTY : { kind: 'uniform', value } };
  if (!node || isBulkValue(node)) throw new Error(`Path không tồn tại: ${path.join('.')}`);
  return { ...tree, [head]: editLeaf(node, rest, value) };
}

/** Liệt kê các lá đã đổi so với cây gốc (dùng để chỉ gửi field bị sửa lên server). */
export function changedPaths(before: BulkTree, after: BulkTree, path: string[] = []): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: string[] = [];
  keys.forEach((key) => {
    const a = before[key];
    const b = after[key];
    const childPath = [...path, key];
    if (isBulkValue(a) || isBulkValue(b)) {
      if (!deepEqual(a, b)) out.push(childPath.join('.'));
    } else if (a && b) {
      out.push(...changedPaths(a, b, childPath));
    }
  });
  return out;
}
