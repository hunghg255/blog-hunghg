/**
 * Chặn cookie phình to tới mức server/CDN từ chối request (ý tưởng từ cookieSizeHelper của InVision).
 *
 * Mọi cookie của domain đi kèm MỌI request trong header `Cookie`. Script bên thứ ba (analytics,
 * A/B test…) có thể ghi cookie ngày càng lớn; vượt giới hạn header của proxy/CDN thì request
 * bị trả 4xx (thường là 400 hoặc 431, tuỳ server), người dùng thấy app hỏng mà không hiểu vì sao.
 * InVision đo `document.cookie`, vượt 13KB (dưới mức 16KB của Cloudflare) thì xoá các cookie
 * "dọn được" (amplitude*, mp_*).
 */

/** Số byte UTF-8 của chuỗi (InVision dùng mẹo encodeURI(s).split(/%..|./).length - 1). */
export const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** Nơi đọc/ghi cookie; mặc định là document.cookie, demo/test thay bằng bản giả. */
export interface CookieJar {
  read(): string;
  write(cookie: string): void;
}

export const documentJar: CookieJar = {
  read: () => document.cookie,
  write: (cookie) => {
    document.cookie = cookie;
  },
};

export interface CookieInfo {
  name: string;
  bytes: number;
}

export function listCookies(header: string): CookieInfo[] {
  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ name: part.split('=')[0], bytes: byteLength(part) }));
}

export interface GuardOptions {
  /** ngưỡng bắt đầu dọn, mặc định 13KB như InVision */
  maxBytes?: number;
  /** tên cookie chứa chuỗi này thì được phép xoá */
  disposable?: string[];
  /** domain đã dùng khi script kia ghi cookie, vd '.example.com' */
  domain?: string;
  path?: string;
  jar?: CookieJar;
}

export interface GuardReport {
  before: number;
  after: number;
  removed: string[];
}

export function guardCookieSize({
  maxBytes = 13 * 1024,
  disposable = ['amplitude', 'mp_'],
  domain,
  path = '/',
  jar = documentJar,
}: GuardOptions = {}): GuardReport {
  const before = byteLength(jar.read());
  const report: GuardReport = { before, after: before, removed: [] };
  if (before <= maxBytes) return report;

  // Xoá cookie to nhất trước, dừng khi đã xuống dưới ngưỡng.
  const candidates = listCookies(jar.read())
    .filter((c) => disposable.some((part) => c.name.includes(part)))
    .sort((a, b) => b.bytes - a.bytes);

  for (const cookie of candidates) {
    // Max-Age=0 là cách xoá chắc chắn. Muốn dùng expires thì phải là chuỗi ngày hợp lệ
    // (vd 'Thu, 01 Jan 1970 00:00:00 GMT'); một con số như `expires=1700000000000` bị trình
    // duyệt bỏ qua, cookie chỉ bị đặt lại thành rỗng chứ không mất.
    jar.write(`${cookie.name}=; Max-Age=0; path=${path}`);
    // cookie có thể được ghi kèm domain (dùng chung cho subdomain): phải xoá đúng domain đó
    if (domain) jar.write(`${cookie.name}=; Max-Age=0; path=${path}; domain=${domain}`);
    report.removed.push(cookie.name);
    if (byteLength(jar.read()) <= maxBytes) break;
  }

  report.after = byteLength(jar.read());
  return report;
}

/** Chạy guard lúc trình duyệt rảnh, không tranh CPU với lúc tải trang. */
export function scheduleCookieGuard(options?: GuardOptions, onReport?: (report: GuardReport) => void) {
  const run = () => {
    const report = guardCookieSize(options);
    if (report.removed.length) onReport?.(report);
  };
  if ('requestIdleCallback' in window) {
    const id = requestIdleCallback(run, { timeout: 10_000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(run, 5000);
  return () => clearTimeout(id);
}
