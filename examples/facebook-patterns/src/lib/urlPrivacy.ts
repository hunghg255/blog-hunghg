/**
 * Mấy lớp bảo vệ quanh URL và link ra ngoài (ý tưởng từ HistoryManager, CometLinkShimUtils,
 * ClickIDParameterUtils và NonFBLinkReferrerProtector của Facebook):
 *  1. Xoá token nhạy cảm khỏi thanh địa chỉ ngay khi trang tải (replaceState)
 *  2. Link ra ngoài đi qua trang chuyển hướng có chữ ký (link shim), chống open redirect
 *  3. Quyết định có gắn tham số đo lường (click id) vào link ra ngoài hay không
 *  4. Giới hạn Referer gửi sang trang khác
 */

// ---- 1. Làm sạch URL ----

export function scrubParams(href: string, params: readonly string[]): { url: string; removed: string[] } {
  const url = new URL(href);
  const removed: string[] = [];
  for (const p of params) {
    if (url.searchParams.has(p)) {
      removed.push(p);
      url.searchParams.delete(p);
    }
  }
  return { url: url.toString(), removed };
}

/**
 * Gọi một lần lúc khởi động: thay URL hiện tại bằng bản đã bỏ token, giữ nguyên
 * history.state (khác bản gốc ở nhánh cũ: ghi đè state bằng chuỗi URL).
 */
export function scrubCurrentLocation(params: readonly string[]): string[] {
  const { url, removed } = scrubParams(location.href, params);
  if (removed.length) history.replaceState(history.state, '', url);
  return removed;
}

// ---- 2. Link shim có chữ ký ----

const encoder = new TextEncoder();

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
  // 16 byte đầu là đủ cho mục đích chống sửa link; mã hoá base64url cho gọn
  return btoa(String.fromCharCode(...sig.slice(0, 16)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface ShimConfig {
  /** trang trung gian, ví dụ https://l.example.com/l.php */
  endpoint: string;
  /** bí mật phía server; demo để ở client chỉ để minh hoạ */
  secret: string;
}

/** Link đã đi qua shim chưa? Nếu rồi thì lấy lại đích gốc để không bọc hai lần. */
export function unwrapShim(href: string, endpoint: string): string | null {
  const url = new URL(href);
  const shim = new URL(endpoint);
  if (url.origin !== shim.origin || url.pathname !== shim.pathname) return null;
  const target = url.searchParams.get('u');
  return target; // khác bản gốc: thiếu `u` thì trả null chứ không biến thành chuỗi "null"
}

export async function shimLink(href: string, config: ShimConfig): Promise<string> {
  const target = unwrapShim(href, config.endpoint) ?? href;
  const url = new URL(config.endpoint);
  url.searchParams.set('u', target);
  url.searchParams.set('h', await hmac(config.secret, target));
  return url.toString();
}

/** Phía server (ở đây mô phỏng): chỉ chuyển hướng khi chữ ký khớp với đích. */
export async function verifyShim(href: string, config: ShimConfig): Promise<string | null> {
  const url = new URL(href);
  const target = url.searchParams.get('u');
  const sig = url.searchParams.get('h');
  if (!target || !sig) return null;
  return (await hmac(config.secret, target)) === sig ? target : null;
}

// ---- 3. Có gắn click id không? ----

/** `host` có phải `domain` hoặc subdomain của nó không (có ranh giới dấu chấm). */
export function isDomainOrSubdomain(host: string, domain: string): boolean {
  host = host.toLowerCase();
  domain = domain.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

export interface Redirector {
  /** domain của dịch vụ chuyển hướng (ad server…) */
  domain: string;
  /** lấy URL đích nằm bên trong, null nếu không có */
  extract: (url: URL) => string | null;
}

export interface ClickIdPolicy {
  param: string;
  /** domain của chính mình: không gắn */
  ownDomains: readonly string[];
  /** domain đối tác yêu cầu không gắn */
  blocklist: readonly string[];
  redirectors: readonly Redirector[];
  /** giới hạn số lớp chuyển hướng lồng nhau được bóc */
  maxDepth?: number;
}

export type ClickIdDecision = { decorate: true; url: string } | { decorate: false; reason: string };

function matchAny(host: string, domains: readonly string[]) {
  return domains.some((d) => isDomainOrSubdomain(host, d));
}

export function decideClickId(href: string, value: string, policy: ClickIdPolicy): ClickIdDecision {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { decorate: false, reason: 'không phải URL tuyệt đối' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { decorate: false, reason: `giao thức ${url.protocol}` };
  if (matchAny(url.hostname, policy.ownDomains)) return { decorate: false, reason: 'link nội bộ' };

  // bóc từng lớp chuyển hướng: đích cuối nằm trong blocklist thì cũng không gắn
  let current: URL | null = url;
  for (let depth = 0; current && depth <= (policy.maxDepth ?? 3); depth++) {
    if (matchAny(current.hostname, policy.blocklist)) return { decorate: false, reason: `đích ${current.hostname} trong blocklist` };
    const host: string = current.hostname;
    const redirector: Redirector | undefined = policy.redirectors.find((r) => isDomainOrSubdomain(host, r.domain));
    const inner: string | null | undefined = redirector?.extract(current);
    current = inner ? safeUrl(inner) : null;
  }
  const out = new URL(url);
  out.searchParams.set(policy.param, value);
  return { decorate: true, url: out.toString() };
}

function safeUrl(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

// ---- 4. Referer ----

export type ReferrerPolicyValue = 'no-referrer' | 'origin' | 'strict-origin-when-cross-origin' | 'unsafe-url';

/**
 * Cách hiện đại: đặt `referrerpolicy` ngay trên thẻ <a> thay vì đổi thẻ meta toàn trang.
 * Trả về các thuộc tính nên gắn cho link ra ngoài.
 */
export function externalLinkAttributes(policy: ReferrerPolicyValue = 'origin') {
  return { rel: 'noopener', referrerPolicy: policy, target: '_blank' } as const;
}

/**
 * Cách của bản gốc cho trình duyệt cũ: trước khi điều hướng, đổi tạm <meta name=referrer>
 * rồi trả lại sau 100ms. Khác bản gốc: nghe cả `auxclick` (chuột giữa), vì Chrome/Firefox
 * không phát `click` cho nút giữa, nên mở tab mới bằng chuột giữa sẽ lọt qua.
 */
export function installReferrerSwitch(
  root: HTMLElement,
  meta: HTMLMetaElement,
  options: { switched: ReferrerPolicyValue; restoreMs?: number; events?: readonly ('click' | 'auxclick')[] },
): () => void {
  const original = meta.content;
  const events = options.events ?? ['click', 'auxclick'];
  const onEvent = (e: Event) => {
    const link = (e.target as Element | null)?.closest?.('a[data-ref-mode="origin"]');
    if (!link) return;
    meta.content = options.switched;
    setTimeout(() => {
      meta.content = original;
    }, options.restoreMs ?? 100);
  };
  for (const type of events) root.addEventListener(type, onEvent);
  return () => {
    for (const type of events) root.removeEventListener(type, onEvent);
  };
}
