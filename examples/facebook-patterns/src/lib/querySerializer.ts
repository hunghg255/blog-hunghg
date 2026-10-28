/**
 * Query string kiểu PHP (`a[b][]=1&a[b][]=2`) ↔ object lồng nhau, an toàn với
 * prototype pollution (ý tưởng từ PHPQuerySerializer của Facebook).
 *
 * Bản gốc đổi key nguy hiểm (`__proto__`, `hasOwnProperty`) thành một ký tự "lính canh"
 * và chỉ đi vào key là thuộc tính riêng (hasOwnProperty). Bản này làm chặt hơn:
 *  - mọi object tạo ra đều không có prototype (Object.create(null))
 *  - bỏ hẳn cặp key/value nếu đường dẫn chứa `__proto__`, `constructor`, `prototype`
 *  - giới hạn chỉ số mảng, độ sâu và số cặp để chống input lớn bất thường
 */

export type QueryValue = string | null | QueryValue[] | { [key: string]: QueryValue };
export type QueryObject = { [key: string]: QueryValue };

const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);

export interface ParseOptions {
  /** chỉ số lớn hơn thì coi như key của object (bản gốc: tối đa 3 chữ số = 999) */
  maxArrayIndex?: number;
  /** số cấp `[...]` tối đa của một key */
  maxDepth?: number;
  /** số cặp key=value tối đa được đọc */
  maxPairs?: number;
}

const newObject = (): QueryObject => Object.create(null);

function decode(part: string): string {
  try {
    return decodeURIComponent(part.replace(/\+/g, ' '));
  } catch {
    return part; // chuỗi % hỏng: giữ nguyên thay vì ném lỗi
  }
}

/** Tách `a[b][][c]` thành ['a', 'b', '', 'c']; trả null nếu dấu ngoặc lệch. */
export function splitKey(key: string): string[] | null {
  const m = /^([^[\]]+)((?:\[[^[\]]*\])*)$/.exec(key);
  if (!m) return null;
  const parts = [m[1]];
  for (const seg of m[2].matchAll(/\[([^[\]]*)\]/g)) parts.push(seg[1]);
  return parts;
}

const isIndex = (key: string, max: number) => /^\d+$/.test(key) && Number(key) <= max;

/** Mảng nhận một key không phải chỉ số hợp lệ: chuyển thành object, giữ phần tử cũ. */
function toObject(arr: QueryValue[]): QueryObject {
  const obj = newObject();
  arr.forEach((v, i) => {
    obj[String(i)] = v;
  });
  return obj;
}

export function parseQuery(query: string, options: ParseOptions = {}): QueryObject {
  const { maxArrayIndex = 999, maxDepth = 20, maxPairs = 1000 } = options;
  const root = newObject();
  const pairs = query.replace(/^\?/, '').split('&').filter(Boolean).slice(0, maxPairs);

  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    // khác bản gốc: giải mã key TRƯỚC khi tách ngoặc, nên `a%5Bb%5D` và `a[b]` như nhau
    const rawKey = decode(eq === -1 ? pair : pair.slice(0, eq));
    const value = eq === -1 ? null : decode(pair.slice(eq + 1));
    const path = splitKey(rawKey) ?? [rawKey];
    if (path.length - 1 > maxDepth || path.some((p) => DANGEROUS.has(p))) continue;

    // `parent[key]` của bước hiện tại; cần giữ cả parent để có thể thay mảng bằng object
    let parent: QueryObject | QueryValue[] = root;
    const resolved: string[] = []; // key thật đã đi qua (ô `[]` đã đổi thành chỉ số)
    for (let i = 0; i < path.length; i++) {
      const isLast = i === path.length - 1;
      let key = path[i];
      if (Array.isArray(parent) && key !== '' && !isIndex(key, maxArrayIndex)) {
        // mảng gặp key chữ hoặc chỉ số quá lớn: đổi container cha thành object
        const converted = toObject(parent);
        replaceChild(root, resolved, converted);
        parent = converted;
      }
      if (key === '') {
        if (!Array.isArray(parent)) key = String(Object.keys(parent).length);
        else key = String(parent.length);
      }
      const container = parent as Record<string, QueryValue>;
      resolved.push(key);
      if (isLast) {
        container[key] = value;
        break;
      }
      const next = path[i + 1];
      const existing = container[key];
      if (existing === undefined || existing === null || typeof existing === 'string') {
        container[key] = next === '' || isIndex(next, maxArrayIndex) ? [] : newObject();
      }
      parent = container[key] as QueryObject | QueryValue[];
    }
  }
  return root;
}

/** Thay container tại `path` (tính từ root) bằng `value`. */
function replaceChild(root: QueryObject, path: string[], value: QueryValue) {
  let node: Record<string, QueryValue> = root;
  for (let i = 0; i < path.length - 1; i++) node = node[path[i]] as Record<string, QueryValue>;
  node[path[path.length - 1]] = value;
}

/** Mã hoá giống bản gốc: encodeURIComponent nhưng giữ nguyên `[` `]` cho dễ đọc. */
export function encodeComponent(s: string): string {
  return encodeURIComponent(s).replace(/%5B/g, '[').replace(/%5D/g, ']');
}

export function serializeQuery(data: Record<string, unknown>): string {
  const out: string[] = [];
  const walk = (prefix: string, value: unknown) => {
    if (value === undefined) return;
    if (value === null) {
      out.push(encodeComponent(prefix));
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${prefix}[${i}]`, v));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(`${prefix}[${k}]`, v);
    } else {
      out.push(`${encodeComponent(prefix)}=${encodeComponent(String(value))}`);
    }
  };
  for (const [k, v] of Object.entries(data)) walk(k, v);
  return out.join('&');
}

/** JSON hoá object không prototype (JSON.stringify xử lý được, chỉ cần sắp key cho dễ so). */
export function toJSON(value: QueryValue): string {
  return JSON.stringify(value, null, 2);
}
