/**
 * Kiểm tra tính toàn vẹn của các API native mà trang của mình phụ thuộc vào
 * (bối cảnh: ClickRefLogger của Facebook hook hàm native để dò script lạ).
 *
 * Mục đích ở đây là PHÒNG THỦ: trang thanh toán, trang đăng nhập muốn biết `fetch`,
 * `XMLHttpRequest.prototype.open`, `addEventListener`… có đang bị một script bên thứ ba
 * (extension, thư viện quảng cáo, mã độc chèn vào) bọc lại hay không, để quyết định
 * có nên dùng bản tham chiếu đã chụp sẵn, hay ghi log cảnh báo.
 *
 * Đây KHÔNG phải ranh giới bảo mật: script chạy trước bạn trên cùng trang có thể sửa
 * luôn những công cụ kiểm tra. Kết quả chỉ là tín hiệu.
 */

export interface IntegrityResult {
  path: string;
  ok: boolean;
  checks: Array<{ name: string; pass: boolean; detail?: string }>;
}

/**
 * Mở một realm sạch (iframe about:blank, không gắn src) để lấy Function.prototype.toString
 * và các hàm tham chiếu chưa bị script của trang hiện tại đụng tới.
 * Giới hạn: extension có content script `all_frames`/`match_about_blank` vẫn có thể chạm vào.
 */
export function openCleanRealm(doc: Document = document) {
  const iframe = doc.createElement('iframe');
  iframe.style.display = 'none';
  iframe.setAttribute('aria-hidden', 'true');
  doc.documentElement.appendChild(iframe);
  const win = iframe.contentWindow as (Window & typeof globalThis) | null;
  if (!win) {
    iframe.remove();
    throw new Error('Không mở được realm sạch');
  }
  return {
    win,
    toString: win.Function.prototype.toString as (this: unknown) => string,
    dispose: () => iframe.remove(),
  };
}

export function resolvePath(root: unknown, path: string): { holder: object | null; key: string; value: unknown } {
  const parts = path.split('.');
  let holder: unknown = root;
  for (const part of parts.slice(0, -1)) {
    holder = holder == null ? undefined : (holder as Record<string, unknown>)[part];
  }
  const key = parts[parts.length - 1];
  const value = holder == null ? undefined : (holder as Record<string, unknown>)[key];
  return { holder: (holder as object) ?? null, key, value };
}

const NATIVE_RE = /^function [\w$]+\(\) \{\s*\[native code\]\s*\}$/;

/**
 * So một hàm của trang với bản cùng đường dẫn trong realm sạch:
 *  1. dùng toString CỦA REALM SẠCH để in hàm (hook giả `fn.toString` không ảnh hưởng)
 *  2. hàm không được có thuộc tính `toString` riêng
 *  3. `name` và `length` khớp với bản sạch
 *  4. descriptor trên đối tượng chứa (configurable/writable/enumerable) khớp với bản sạch
 */
export function checkNative(path: string, pageRoot: unknown, realm: ReturnType<typeof openCleanRealm>): IntegrityResult {
  const page = resolvePath(pageRoot, path);
  const clean = resolvePath(realm.win, path);
  const checks: IntegrityResult['checks'] = [];
  const fn = page.value;

  if (typeof fn !== 'function') {
    return { path, ok: false, checks: [{ name: 'là function', pass: false, detail: typeof fn }] };
  }

  let printed = '';
  try {
    printed = realm.toString.call(fn);
  } catch (error) {
    printed = `lỗi: ${(error as Error).message}`;
  }
  checks.push({ name: 'toString của realm sạch ra [native code]', pass: NATIVE_RE.test(printed), detail: printed.slice(0, 60) });

  const ownToString = Object.prototype.hasOwnProperty.call(fn, 'toString');
  checks.push({ name: 'không có toString riêng', pass: !ownToString });

  const cleanFn = clean.value as ((...args: unknown[]) => unknown) | undefined;
  if (typeof cleanFn === 'function') {
    checks.push({
      name: 'name và length khớp bản sạch',
      pass: fn.name === cleanFn.name && fn.length === cleanFn.length,
      detail: `${fn.name}/${fn.length} vs ${cleanFn.name}/${cleanFn.length}`,
    });
  }

  if (page.holder && clean.holder) {
    const a = Object.getOwnPropertyDescriptor(page.holder, page.key);
    const b = Object.getOwnPropertyDescriptor(clean.holder, clean.key);
    if (a && b) {
      const same = a.configurable === b.configurable && a.enumerable === b.enumerable && ('value' in a) === ('value' in b);
      checks.push({
        name: 'descriptor khớp bản sạch',
        pass: same,
        detail: `configurable ${a.configurable}/${b.configurable}`,
      });
    }
  }

  return { path, ok: checks.every((c) => c.pass), checks };
}

export function checkAll(paths: string[], pageRoot: unknown = window): IntegrityResult[] {
  const realm = openCleanRealm();
  try {
    return paths.map((p) => checkNative(p, pageRoot, realm));
  } finally {
    realm.dispose();
  }
}

/**
 * Cách phòng thủ thực dụng nhất: chụp tham chiếu NGAY khi script của bạn chạy (càng sớm
 * càng tốt, ví dụ inline trong <head>) rồi chỉ dùng bản đã chụp cho thao tác nhạy cảm.
 */
export function snapshotNatives<T extends Record<string, string>>(paths: T, root: unknown = window) {
  const out = {} as { [K in keyof T]: (...args: never[]) => unknown };
  for (const [name, path] of Object.entries(paths)) {
    const { holder, value } = resolvePath(root, path);
    if (typeof value === 'function') {
      // giữ `this` gốc cho hàm toàn cục như fetch; hàm trên prototype gọi bằng .call(target)
      out[name as keyof T] = (holder === root ? value.bind(root) : value) as (...args: never[]) => unknown;
    }
  }
  return out;
}

/** Giải mã chuỗi kiểu ClickRefLogger: mỗi ký tự XOR 1 ("jiri" → "khsh"). Chỉ là che mắt, không phải mã hoá. */
export const xor1 = (text: string) => Array.from(text, (ch) => String.fromCharCode(ch.charCodeAt(0) ^ 1)).join('');
