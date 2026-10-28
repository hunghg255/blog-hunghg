/**
 * Cache blob trong RAM có giới hạn dung lượng, kiểu WhatsApp Web (module `eceibhbeff` + `cbjgeibhdg`).
 *
 * - LRU theo tổng `blob.size`, không theo số phần tử.
 * - Blob đang được dùng (đang hiện trên màn hình) được "ghim" bằng bộ đếm, không bao giờ bị đẩy ra.
 * - Mỗi key có đúng một objectURL dùng chung; URL bị revoke khi blob rời cache.
 * - Dọn dẹp được gom lại: lần put đầu hẹn một lần dọn sau `purgeDelay`, các put tiếp theo không dời lịch.
 *
 * Khác bản gốc: dùng thứ tự chèn của Map thay cho danh sách liên kết đôi, revoke URL cũ khi put đè
 * cùng key, và hẹn dọn lại khi bỏ ghim.
 */

export interface UrlFactory {
  create(blob: Blob): string;
  revoke(url: string): void;
}

const browserUrls: UrlFactory = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

export interface BlobCacheOptions {
  /** tổng dung lượng tối đa (byte) của các blob không bị ghim */
  sizeLimit: number;
  /** dọn sau lần put/bỏ ghim đầu tiên bao lâu (ms); các lần sau trong khoảng đó không dời lịch */
  purgeDelay?: number;
  urls?: UrlFactory;
  onEvict?: (key: string, blob: Blob) => void;
}

export interface BlobCacheStats {
  count: number;
  size: number;
  pinned: number;
  urls: number;
  evictions: number;
}

export class BlobCache {
  /** Map giữ thứ tự chèn: phần tử đầu là phần tử lâu nhất chưa dùng */
  private entries = new Map<string, Blob>();
  private pins = new Map<string, number>();
  private urls = new Map<string, string>();
  private currentSize = 0;
  private evictions = 0;
  private purgeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly sizeLimit: number;
  private readonly purgeDelay: number;
  private readonly urlFactory: UrlFactory;
  private readonly onEvict?: (key: string, blob: Blob) => void;

  constructor({ sizeLimit, purgeDelay = 1000, urls = browserUrls, onEvict }: BlobCacheOptions) {
    if (sizeLimit < 0) throw new RangeError('sizeLimit phải ≥ 0');
    this.sizeLimit = sizeLimit;
    this.purgeDelay = purgeDelay;
    this.urlFactory = urls;
    this.onEvict = onEvict;
  }

  /** Thêm hoặc thay blob. Blob lớn hơn cả giới hạn thì bỏ qua (trả false). */
  put(key: string, blob: Blob): boolean {
    if (blob.size > this.sizeLimit) return false;
    this.remove(key);
    this.entries.set(key, blob);
    this.currentSize += blob.size;
    this.schedulePurge();
    return true;
  }

  /** Lấy blob và đánh dấu "vừa dùng" (chuyển xuống cuối Map). */
  get(key: string): Blob | undefined {
    const blob = this.entries.get(key);
    if (blob === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, blob);
    return blob;
  }

  has(key: string) {
    return this.entries.has(key);
  }

  /** objectURL dùng chung cho key; tạo khi cần. */
  url(key: string): string {
    const existing = this.urls.get(key);
    if (existing) {
      this.get(key);
      return existing;
    }
    const blob = this.get(key);
    if (!blob) throw new Error(`Không có blob cho key ${key}`);
    const url = this.urlFactory.create(blob);
    this.urls.set(key, url);
    return url;
  }

  /** Ghim: blob đang hiện trên màn hình thì không được đẩy ra. */
  pin(key: string) {
    this.pins.set(key, (this.pins.get(key) ?? 0) + 1);
  }

  unpin(key: string) {
    const count = this.pins.get(key) ?? 0;
    if (count <= 0) throw new Error(`Bỏ ghim ${key} nhiều hơn số lần ghim`);
    if (count === 1) {
      this.pins.delete(key);
      // Bản gốc không hẹn dọn ở đây, nên cache có thể nằm quá giới hạn tới lần put kế tiếp.
      this.schedulePurge();
    } else {
      this.pins.set(key, count - 1);
    }
  }

  /** Xoá một key và revoke URL của nó (nếu có). */
  remove(key: string) {
    const blob = this.entries.get(key);
    if (blob === undefined) return;
    this.entries.delete(key);
    this.currentSize -= blob.size;
    this.revoke(key);
  }

  /** Đẩy blob cũ nhất ra cho tới khi về dưới giới hạn, bỏ qua blob đang ghim. */
  purgeNow() {
    clearTimeout(this.purgeTimer);
    this.purgeTimer = undefined;
    for (const [key, blob] of this.entries) {
      if (this.currentSize <= this.sizeLimit) break;
      if (this.pins.has(key)) continue;
      this.remove(key);
      this.evictions++;
      this.onEvict?.(key, blob);
    }
  }

  clear() {
    for (const key of [...this.entries.keys()]) this.remove(key);
    this.pins.clear();
  }

  stats(): BlobCacheStats {
    return {
      count: this.entries.size,
      size: this.currentSize,
      pinned: this.pins.size,
      urls: this.urls.size,
      evictions: this.evictions,
    };
  }

  dispose() {
    clearTimeout(this.purgeTimer);
    this.clear();
  }

  private revoke(key: string) {
    const url = this.urls.get(key);
    if (url) {
      this.urls.delete(key);
      this.urlFactory.revoke(url);
    }
  }

  /** Như throttle không chạy ngay: put liên tục khi cuộn không đẩy lần dọn ra xa mãi. */
  private schedulePurge() {
    if (this.purgeTimer === undefined) this.purgeTimer = setTimeout(() => this.purgeNow(), this.purgeDelay);
  }
}
