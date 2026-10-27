/**
 * Parse HTML không chạy script, và kiểm tra href (ý tưởng từ rich-text-editor/helpers.js của Udemy).
 */

let detachedDoc: Document | null = null;

/**
 * Document "tách rời": tạo bằng createHTMLDocument nên không gắn với cửa sổ nào.
 * Gán innerHTML trên phần tử của document này KHÔNG tải ảnh, KHÔNG chạy onload/onerror.
 * Phần tử tạo từ `document` chính thì khác: chưa gắn vào trang vẫn tải ảnh và chạy onerror.
 */
export function getDetachedDoc(): Document {
  detachedDoc ??= document.implementation.createHTMLDocument('');
  return detachedDoc;
}

/** Parse một chuỗi HTML thành cây DOM "trơ" (không tải, không chạy gì). */
export function parseInert(html: string): HTMLElement {
  const div = getDetachedDoc().createElement('div');
  div.innerHTML = html;
  return div;
}

/** Lấy chữ thuần từ HTML mà không để <img onerror> kịp chạy. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return parseInert(html).textContent ?? '';
}

// ---------- kiểm tra href ----------

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'ftps:', 'mailto:']);
const DOMAIN_LIKE = /^([\w-]{1,63}\.)+[a-z-]{2,63}(:\d+)?([/?#]|$)|^(\d{1,3}\.){3}\d{1,3}([:/?#]|$)/i;

export type HrefCheck = { ok: true; href: string } | { ok: false; reason: string };

/**
 * Kiểm tra href người dùng gõ hoặc dán vào editor.
 * Dựa trên `URL` của trình duyệt thay vì cắt chuỗi theo '://', nên `javascript:`, `data:`,
 * `/\evil.com` không lọt qua. Trả về href ĐÃ CHUẨN HOÁ: nơi gọi phải dùng giá trị này,
 * không dùng lại chuỗi gốc.
 */
export function checkHref(input: string, base = 'https://example.com'): HrefCheck {
  const href = input.trim();
  if (!href) return { ok: false, reason: 'Bắt buộc nhập' };

  // đường dẫn tương đối trong site: chỉ chấp nhận một dấu '/' ở đầu, theo sau không phải '/' hay '\'
  if (href.startsWith('/')) {
    if (/^\/[/\\]/.test(href)) return { ok: false, reason: 'Đường dẫn trỏ ra domain khác (//, /\\)' };
    return { ok: true, href };
  }

  // "google.com" không có scheme: thêm https:// rồi mới parse
  // ("example.com:8080" trông giống scheme "example.com:", nên xét dạng tên miền trước)
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(href) && !DOMAIN_LIKE.test(href);
  const candidate = hasScheme ? href : DOMAIN_LIKE.test(href) ? `https://${href}` : null;
  if (!candidate) return { ok: false, reason: 'Không giống một URL' };

  let url: URL;
  try {
    url = new URL(candidate, base);
  } catch {
    return { ok: false, reason: 'URL không hợp lệ' };
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return { ok: false, reason: `Không cho phép giao thức ${url.protocol}` };
  if (url.protocol === 'mailto:') {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(decodeURIComponent(url.pathname))
      ? { ok: true, href: url.href }
      : { ok: false, reason: 'Email không hợp lệ' };
  }
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return { ok: false, reason: 'Thiếu tên miền' };
  return { ok: true, href: url.href };
}

/** Phát hiện Sanitizer API (`Element.setHTML`) — trình duyệt chưa hỗ trợ thì dùng thư viện như DOMPurify. */
export function hasSetHTML(): boolean {
  return typeof (Element.prototype as Element & { setHTML?: unknown }).setHTML === 'function';
}
