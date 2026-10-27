/**
 * Gom origin của mọi ảnh đã render để sinh <link rel="preconnect"> (ý tưởng từ
 * PreconnectTracker của apps.apple.com: Artwork/utils/preconnect.ts).
 *
 * Apple chỉ dùng nó khi render phía server: mỗi <Artwork> báo URL của mình, cuối trang
 * in các thẻ preconnect vào HTML. Ở client tracker không tồn tại và component bỏ qua.
 */
export class PreconnectTracker {
  private readonly originSet = new Set<string>();

  /** Ghi nhận URL; trả về true nếu đây là origin mới. */
  trackUrl(url: string): boolean {
    try {
      const { origin } = new URL(url);
      if (this.originSet.has(origin)) return false;
      this.originSet.add(origin);
      return true;
    } catch {
      // URL hỏng (vd template rỗng): thiếu một preconnect còn hơn làm hỏng cả component
      return false;
    }
  }

  get origins(): string[] {
    return [...this.originSet];
  }

  /**
   * HTML để chèn vào <head> khi SSR.
   * Ảnh <img> bình thường tải ở chế độ no-cors nên KHÔNG đặt `crossorigin`: kết nối mở
   * với crossorigin chỉ dùng được cho request CORS (font, fetch), dùng sai là phí một kết nối.
   */
  toHtml({ max = 4, exclude }: { max?: number; exclude?: string } = {}): string {
    return this.origins
      .filter((origin) => origin !== exclude)
      .slice(0, max)
      .map((origin) => `<link rel="preconnect" href="${origin}">`)
      .join('\n');
  }
}

/**
 * Bản cho client (không có trong code Apple): thêm preconnect lúc chạy cho origin chưa có.
 * Chỉ có ích khi gọi TRƯỚC lúc ảnh thật sự được tải (vd vừa nhận dữ liệu trang, ảnh còn
 * nằm dưới màn hình với loading="lazy").
 */
export function ensurePreconnect(
  url: string,
  { doc = document, crossOrigin = false }: { doc?: Document; crossOrigin?: boolean } = {},
): HTMLLinkElement | null {
  let origin: string;
  try {
    origin = new URL(url, doc.baseURI).origin;
  } catch {
    return null;
  }
  if (origin === doc.location?.origin) return null; // cùng origin thì kết nối đã có sẵn
  const existing = Array.from(doc.head.querySelectorAll<HTMLLinkElement>('link[rel="preconnect"]')).find(
    (link) => new URL(link.href).origin === origin && link.hasAttribute('crossorigin') === crossOrigin,
  );
  if (existing) return existing;
  const link = doc.createElement('link');
  link.rel = 'preconnect';
  link.href = origin;
  if (crossOrigin) link.crossOrigin = 'anonymous';
  doc.head.appendChild(link);
  return link;
}
