/**
 * Hai bản để so trong demo, KHÔNG phải mã của Facebook:
 *  - parseFbStyle: viết lại theo đúng hành vi của PHPQuerySerializer.deserialize
 *    (key nguy hiểm → ký tự U+1F756, chỉ đi vào thuộc tính riêng, ≤3 chữ số là mảng;
 *    ô `[]` ở giữa đường dẫn gọi `push`, nên ném TypeError nếu node không phải mảng)
 *  - parseNaive: kiểu "obj[k] = obj[k] || {}" hay gặp trên mạng, bị prototype pollution.
 *    Để không làm bẩn Object.prototype thật của trang, mọi object nó tạo đều kế thừa từ
 *    một prototype "hộp cát" do demo truyền vào.
 */

const SENTINEL = '\u{1F756}';
const mapKey = (k: string) => (k === 'hasOwnProperty' || k === '__proto__' ? SENTINEL : k);

function decode(s: string) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

export function parseFbStyle(query: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const has = Object.prototype.hasOwnProperty;
  const re = /^([-_\w]+)((?:\[[-_\w]*\])+)=?(.*)/;
  for (const part of query.replace(/%5B/gi, '[').replace(/%5D/gi, ']').split('&')) {
    if (!part) continue;
    const m = part.match(re);
    if (!m) {
      const eq = part.indexOf('=');
      if (eq === -1) out[decode(part)] = null;
      else out[decode(part.slice(0, eq))] = decode(part.slice(eq + 1));
      continue;
    }
    const keys = m[2].split(/\]\[|\[|\]/).slice(0, -1);
    keys[0] = m[1];
    const value = decode(m[3] || '');
    let node: any = out;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = mapKey(keys[i]);
      if (k) {
        if (!has.call(node, k)) {
          const next = keys[i + 1] && !/^\d{1,3}$/.test(keys[i + 1]) ? {} : [];
          try {
            node[k] = next;
          } catch {
            /* gán lên giá trị nguyên thuỷ */
          }
          // bản gốc: gán lên giá trị nguyên thuỷ không có tác dụng → trả luôn kết quả,
          // mọi cặp phía sau bị bỏ
          if (node[k] !== next) return out;
        }
        node = node[k];
      } else {
        node.push(keys[i + 1] && !/^\d{1,3}$/.test(keys[i + 1]) ? {} : []);
        node = node[node.length - 1];
      }
    }
    const last = keys[keys.length - 1];
    if (Array.isArray(node) && last === '') node.push(value);
    else node[mapKey(last)] = value;
  }
  return out;
}

/** Tạo prototype hộp cát: cả `__proto__` lẫn `constructor.prototype` đều trỏ về nó. */
export function makeSandboxProto(): Record<string, unknown> {
  // vẫn kế thừa Object.prototype để accessor `__proto__` hoạt động như object thường
  const proto: Record<string, unknown> = Object.create(Object.prototype);
  Object.defineProperty(proto, 'constructor', { value: { prototype: proto }, writable: true, configurable: true });
  return proto;
}

export function parseNaive(query: string, proto: object): Record<string, any> {
  const make = () => Object.create(proto);
  const root = make();
  for (const part of query.split('&')) {
    if (!part) continue;
    const [rawKey, rawValue = ''] = part.split('=');
    const keys = decode(rawKey).replace(/\]/g, '').split('[');
    let node = root;
    for (let i = 0; i < keys.length - 1; i++) {
      node[keys[i]] = node[keys[i]] || make(); // đi thẳng vào __proto__ / constructor
      node = node[keys[i]];
      // chốt an toàn riêng cho demo: không bao giờ ghi lên Object.prototype thật
      if (node === Object.prototype || node === Function.prototype) return root;
    }
    node[keys[keys.length - 1]] = decode(rawValue);
  }
  return root;
}
