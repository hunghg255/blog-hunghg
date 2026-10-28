import type { BlobCacheStats, UrlFactory } from '../lib/waBlobCache';

/**
 * Mô phỏng hành vi của cache blob trong WhatsApp Web 2020 để demo so sánh (KHÔNG phải mã gốc).
 * Giữ lại hai điểm của bản gốc:
 *   - put đè cùng key không động tới objectURL đã tạo, nên url() vẫn trả URL của blob cũ;
 *   - bỏ ghim không hẹn dọn, nên cache có thể nằm quá giới hạn tới lần put kế tiếp.
 */
export class WhatsAppStyleBlobCache {
  private entries = new Map<string, Blob>();
  private usage = new Map<string, number>();
  private urls = new Map<string, string>();
  private currentSize = 0;
  private evictions = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly sizeLimit: number,
    private readonly urlFactory: UrlFactory,
    private readonly purgeDelay = 1000,
  ) {}

  put(key: string, blob: Blob) {
    if (blob.size > this.sizeLimit) return false;
    this.deleteEntry(key); // chỉ xoá node, không đụng tới _filehashToUrl
    this.entries.set(key, blob);
    this.currentSize += blob.size;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.purgeNow(), this.purgeDelay);
    return true;
  }

  get(key: string) {
    const blob = this.entries.get(key);
    if (blob === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, blob);
    return blob;
  }

  has(key: string) {
    return this.entries.has(key);
  }

  url(key: string) {
    const existing = this.urls.get(key);
    if (existing) {
      this.get(key);
      return existing;
    }
    const blob = this.get(key);
    if (!blob) throw new Error(`There is no blob matching filehash: ${key}.`);
    const url = this.urlFactory.create(blob);
    this.urls.set(key, url);
    return url;
  }

  pin(key: string) {
    this.usage.set(key, (this.usage.get(key) ?? 0) + 1);
  }

  unpin(key: string) {
    const count = this.usage.get(key) ?? 0;
    if (count <= 0) throw new Error('Cannot decrease the usageCount to a negative number.');
    if (count === 1) this.usage.delete(key);
    else this.usage.set(key, count - 1);
  }

  purgeNow() {
    clearTimeout(this.timer);
    for (const [key, blob] of this.entries) {
      if (this.currentSize <= this.sizeLimit) break;
      if (this.usage.has(key)) continue;
      this.deleteEntry(key);
      this.evictions++;
      const url = this.urls.get(key);
      if (url) {
        this.urls.delete(key);
        this.urlFactory.revoke(url);
      }
      void blob;
    }
  }

  stats(): BlobCacheStats {
    return {
      count: this.entries.size,
      size: this.currentSize,
      pinned: this.usage.size,
      urls: this.urls.size,
      evictions: this.evictions,
    };
  }

  dispose() {
    clearTimeout(this.timer);
    for (const url of this.urls.values()) this.urlFactory.revoke(url);
    this.urls.clear();
    this.entries.clear();
  }

  private deleteEntry(key: string) {
    const blob = this.entries.get(key);
    if (blob === undefined) return;
    this.entries.delete(key);
    this.currentSize -= blob.size;
  }
}
