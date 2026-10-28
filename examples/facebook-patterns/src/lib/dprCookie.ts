/**
 * Hai việc nhỏ của hạ tầng Facebook web:
 * 1. Ghi devicePixelRatio vào cookie `dpr` để lần tải sau server chọn sẵn ảnh @2x/@3x
 *    (ý tưởng từ WebPixelRatioDetector / CometPixelRatioUpdater).
 * 2. Không để khoá mã hoá SRTP (SDES `inline:`) lọt vào log (ý tưởng từ ZenonSDESKeyDetector).
 * Khác bản gốc: tên sự kiện đúng (`pagehide`, bản Comet viết nhầm `pageHide`), cập nhật ngay khi
 * DPR đổi (zoom, kéo cửa sổ sang màn khác), và che khoá thay vì chỉ phát hiện; regex nhận cả khoá
 * 64 ký tự và khoá kết thúc bằng `+`, `/`.
 */

export interface DprCookieOptions {
  name?: string;
  /** mặc định ghi vào document.cookie, path=/, 1 năm */
  setCookie?: (name: string, value: string | null) => void;
  getDpr?: () => number;
  /** báo khi DPR đổi trong lúc trang đang mở */
  onChange?: (dpr: number) => void;
}

/** 2 chữ số thập phân là đủ: 1.25, 1.5, 2.625 (Android) → '2.63'; DPR = 1 thì xoá cookie */
export function formatDpr(dpr: number): string | null {
  if (!Number.isFinite(dpr) || dpr <= 0) return null;
  const rounded = Math.round(dpr * 100) / 100;
  return rounded === 1 ? null : String(rounded);
}

function defaultSetCookie(name: string, value: string | null) {
  document.cookie =
    value == null
      ? `${name}=; path=/; max-age=0; samesite=lax`
      : `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

export function syncDprCookie(options: DprCookieOptions = {}) {
  const name = options.name ?? 'dpr';
  const setCookie = options.setCookie ?? defaultSetCookie;
  const getDpr = options.getDpr ?? (() => window.devicePixelRatio || 1);
  let last: string | null | undefined;

  const write = () => {
    const value = formatDpr(getDpr());
    if (value === last) return; // không ghi cookie thừa
    last = value;
    setCookie(name, value);
  };

  // `matchMedia` chỉ báo khi ĐÚNG giá trị DPR hiện tại hết khớp, nên mỗi lần đổi phải đăng ký lại.
  let query: MediaQueryList | null = null;
  const watch = () => {
    query?.removeEventListener('change', onDprChange);
    query = window.matchMedia?.(`(resolution: ${getDpr()}dppx)`) ?? null;
    query?.addEventListener('change', onDprChange);
  };
  function onDprChange() {
    write();
    options.onChange?.(getDpr());
    watch();
  }
  const onHide = () => {
    if (document.visibilityState === 'hidden') write();
  };

  write(); // ghi ngay: bản gốc chỉ ghi lúc rời trang nên lượt tải thứ hai vẫn chưa có cookie
  watch();
  window.addEventListener('pagehide', write);
  document.addEventListener('visibilitychange', onHide);
  return () => {
    query?.removeEventListener('change', onDprChange);
    window.removeEventListener('pagehide', write);
    document.removeEventListener('visibilitychange', onHide);
  };
}

/** Bản của Facebook, giữ lại để demo và test so sánh. */
export const FB_SDES_PATTERN = /inline:\s*[0-9a-zA-z+/]{40}(\b|\s|$)/;

/**
 * Khoá SDES (RFC 4568): base64 của key‖salt. AES_CM_128: 30 byte → 40 ký tự;
 * AES_256_CM: 46 byte → 64 ký tự (có `==`). Sau khoá là `|`, khoảng trắng hoặc hết chuỗi.
 */
const SDES_KEY = /(inline:\s*)[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])/g;

export function containsSdesKey(text: string) {
  SDES_KEY.lastIndex = 0;
  return SDES_KEY.test(text);
}

export function redactSdesKeys(text: string) {
  let count = 0;
  const redacted = text.replace(SDES_KEY, (_, prefix: string) => {
    count++;
    return `${prefix}[đã che]`;
  });
  return { text: redacted, count };
}

/** Đi qua mọi chuỗi trong object log (không sửa object gốc), che khoá, trả số chỗ đã che. */
export function redactSecrets<T>(value: T): { value: T; count: number } {
  let count = 0;
  const seen = new WeakMap<object, unknown>();
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = redactSdesKeys(v);
      count += r.count;
      return r.text;
    }
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v); // vòng tham chiếu
    const out: Record<string, unknown> | unknown[] = Array.isArray(v) ? [] : {};
    seen.set(v, out);
    for (const [k, child] of Object.entries(v)) (out as Record<string, unknown>)[k] = walk(child);
    return out;
  };
  return { value: walk(value) as T, count };
}
