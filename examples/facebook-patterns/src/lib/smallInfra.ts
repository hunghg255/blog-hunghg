/* -------------------------------------------------------------------------- */
/* 1. Cookie theo chính sách khai báo một chỗ (ý tưởng từ CookieCore)         */
/* -------------------------------------------------------------------------- */

/**
 * Facebook không rải path/TTL/secure/SameSite khắp nơi mỗi lần set cookie. Mọi cookie được
 * khai báo trong một bảng cấu hình (CookieCoreConfig); tên không có trong bảng thì KHÔNG
 * được set. Cookie tên `_js_<x>` dùng chung chính sách với `<x>`.
 */
export interface CookiePolicy {
  /** thời gian sống, giây; 0 = cookie phiên */
  ttlSeconds?: number;
  path?: string;
  /** cho phép gửi qua http (mặc định false = luôn Secure) */
  insecure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export type CookieConfig = Record<string, CookiePolicy>;

export interface ResolvedPolicy {
  name: string;
  /** tên khoá chính sách thực sự được dùng (có thể khác name nếu đi qua tiền tố _js_) */
  policyKey: string;
  ttlSeconds: number;
  path: string;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

const JS_PREFIX = /^_js_(.+)$/;

export function resolvePolicy(config: CookieConfig, name: string): ResolvedPolicy | null {
  let key = name;
  // bản gốc dùng regex /_js_(.*)/ không neo đầu: "abc_js_x" cũng khớp. Ở đây neo ^.
  while (!(key in config)) {
    const match = key.match(JS_PREFIX);
    if (!match) return null;
    key = match[1];
  }
  const p = config[key];
  return {
    name,
    policyKey: key,
    ttlSeconds: p.ttlSeconds ?? 0,
    path: p.path ?? '/',
    secure: !p.insecure,
    sameSite: p.sameSite ?? 'Lax',
  };
}

/**
 * Domain để set cookie: rút về domain gốc nếu host thuộc danh sách (vd www.facebook.com ->
 * .facebook.com) để mọi subdomain đọc được; còn lại để host-only.
 */
export function cookieDomain(hostname: string, baseDomains: string[]): string | null {
  for (const base of baseDomains) {
    if (hostname === base || hostname.endsWith(`.${base}`)) return `.${base}`;
  }
  return null;
}

export interface SetOptions {
  /** ghi đè TTL của chính sách, giây */
  ttlSeconds?: number;
  /** mốc hết hạn tuyệt đối (ms). Bản gốc nhận chung một tham số: > Date.now() thì hiểu là mốc tuyệt đối */
  expiresAt?: number;
}

export function serializeCookie(policy: ResolvedPolicy, value: string, domain: string | null, opts: SetOptions = {}, now = Date.now()) {
  const parts = [`${encodeURIComponent(policy.name)}=${encodeURIComponent(value)}`, `path=${policy.path}`];
  const maxAge = opts.expiresAt != null ? Math.round((opts.expiresAt - now) / 1000) : (opts.ttlSeconds ?? policy.ttlSeconds);
  if (maxAge > 0) parts.push(`max-age=${maxAge}`);
  if (domain) parts.push(`domain=${domain}`);
  if (policy.secure) parts.push('secure');
  parts.push(`samesite=${policy.sameSite.toLowerCase()}`);
  return parts.join('; ');
}

export interface CookieStoreOptions {
  config: CookieConfig;
  baseDomains?: string[];
  /** để test: ghi/đọc vào chỗ khác thay vì document.cookie */
  write?: (cookie: string) => void;
  read?: () => string;
  hostname?: string;
  /** chỉ set khi trang không nằm trong iframe (setIfFirstPartyContext của bản gốc) */
  firstPartyOnly?: boolean;
}

export function createCookieStore({
  config,
  baseDomains = [],
  write = (c) => (document.cookie = c),
  read = () => document.cookie,
  hostname = location.hostname,
  firstPartyOnly = false,
}: CookieStoreOptions) {
  const domain = cookieDomain(hostname, baseDomains);
  const inIframe = typeof window !== 'undefined' && window.self !== window.top;

  return {
    /** trả về chuỗi đã ghi, hoặc null nếu bị từ chối (không có chính sách / đang trong iframe) */
    set(name: string, value: string, opts?: SetOptions): string | null {
      const policy = resolvePolicy(config, name);
      if (!policy || (firstPartyOnly && inIframe)) return null;
      const cookie = serializeCookie(policy, value, domain, opts);
      write(cookie);
      return cookie;
    },
    get(name: string): string | null {
      if (!resolvePolicy(config, name)) return null;
      const prefix = `${encodeURIComponent(name)}=`;
      const hit = read()
        .split('; ')
        .find((c) => c.startsWith(prefix));
      return hit ? decodeURIComponent(hit.slice(prefix.length)) : null;
    },
    /** xoá rõ ràng. Bản gốc dùng "TTL == 1" làm tín hiệu xoá. */
    clear(name: string): string | null {
      const policy = resolvePolicy(config, name);
      if (!policy) return null;
      const cookie = `${encodeURIComponent(name)}=; path=${policy.path}; max-age=0${domain ? `; domain=${domain}` : ''}`;
      write(cookie);
      return cookie;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 2. Hash 6 ký tự để gom lỗi giống nhau (getSimpleHash)                       */
/* -------------------------------------------------------------------------- */

const BASE32 = 'abcdefghijklmnopqrstuvwxyz012345';

/**
 * Hash đa thức kiểu Java (h = h*31 + c), lấy 30 bit thấp mã hoá thành 6 ký tự base32.
 * Bản gốc nối các tham số liền nhau nên hash('ab','c') === hash('a','bc');
 * `separate: true` chèn ký tự \u0000 giữa các phần để tránh va chạm kiểu đó.
 */
export function simpleHash(parts: Array<string | null | undefined>, { separate = true } = {}): string {
  let h = 0;
  parts.forEach((part, index) => {
    if (part == null) return;
    if (separate && index > 0) h = (Math.imul(h, 31) + 0) | 0;
    for (let i = 0; i < part.length; i++) h = (Math.imul(h, 31) + part.charCodeAt(i)) | 0;
  });
  let out = '';
  for (let i = 0; i < 6; i++) {
    out = BASE32.charAt(h & 31) + out;
    h >>= 5;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* 3. "Chuột vừa dừng" (CometMouseActivity)                                   */
/* -------------------------------------------------------------------------- */

/**
 * Một listener mousemove dùng chung cho cả trang; không có mousemove trong `delay` ms thì
 * gọi mọi callback. Khác bản gốc: listener được gỡ khi không còn ai đăng ký (bản gốc giữ
 * listener mãi, và hàm huỷ của init() gỡ listener nhưng không reset cờ, nên sau đó không
 * đăng ký lại được nữa).
 */
const stopCallbacks = new Set<() => void>();
let stopTimer: ReturnType<typeof setTimeout> | null = null;
let stopDelay = 50;

function onMove() {
  if (stopTimer != null) clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    stopTimer = null;
    stopCallbacks.forEach((fn) => fn());
  }, stopDelay);
}

export function onMouseStop(callback: () => void, { delay = 50 } = {}) {
  stopDelay = delay;
  if (stopCallbacks.size === 0) window.addEventListener('mousemove', onMove, { passive: true });
  stopCallbacks.add(callback);
  return () => {
    stopCallbacks.delete(callback);
    if (stopCallbacks.size === 0) {
      window.removeEventListener('mousemove', onMove);
      if (stopTimer != null) clearTimeout(stopTimer);
      stopTimer = null;
    }
  };
}

/** số callback đang đăng ký (để demo) */
export const mouseStopSubscribers = () => stopCallbacks.size;
