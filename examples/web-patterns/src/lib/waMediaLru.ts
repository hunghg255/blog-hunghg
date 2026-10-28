// Kho media LRU trên Cache API, tự co lại theo quota trình duyệt.
// Viết lại từ dgbehccfjg (LruMediaStore), fheibeebe (kho ArrayBuffer trên Cache API),
// ciaihgijjb (chọn backend) và bihghijhgb (createEnqueue) của WhatsApp Web bản 2020.

/** Phần Cache API mà kho cần: tiêm vào được để test hoặc giả lập lỗi quota. */
export type CacheLike = Pick<Cache, 'match' | 'put' | 'delete' | 'keys'>;

export interface StorageEstimateLike {
  quota?: number;
  usage?: number;
}

const MB = 1024 * 1024;

/** Chừa trống 1% quota, kẹp trong [100 MB, 500 MB] như bản gốc. */
export const defaultTargetFree = (quota: number) => Math.min(500 * MB, Math.max(100 * MB, Math.floor(quota * 0.01)));

export interface MediaLruOptions {
  openCache: () => Promise<CacheLike>;
  /** mặc định navigator.storage.estimate */
  estimate?: () => Promise<StorageEstimateLike | undefined>;
  targetFree?: (quota: number) => number;
  /** file lớn hơn thì không cache (bản gốc: 30 MB) */
  maxItemBytes?: number;
  /** giới hạn khi chưa biết quota */
  initialMaxSize?: number;
  now?: () => number;
  onEvict?: (key: string, size: number, reason: string) => void;
}

interface Meta {
  size: number;
  lastUsed: number;
}

const SIZE_HEADER = 'x-media-size';
const TIME_HEADER = 'x-media-last-used';
const urlOf = (key: string) => `https://media-cache.invalid/${encodeURIComponent(key)}`;

/**
 * Hàng đợi theo key: lời gọi cùng key chạy nối tiếp. Khác createEnqueue gốc: dọn key khi promise
 * xong ở CẢ hai nhánh, nên một lần lỗi không làm mọi lần gọi sau với key đó lỗi theo.
 */
export function createKeyedQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return <A extends unknown[], R>(fn: (...args: A) => Promise<R>, keyOf: (...args: A) => string = (...a) => String(a[0])) =>
    (...args: A): Promise<R> => {
      const key = keyOf(...args);
      const run = (tails.get(key) ?? Promise.resolve()).then(() => fn(...args));
      const tail = run.then(
        () => undefined,
        () => undefined,
      );
      tails.set(key, tail);
      tail.then(() => tails.get(key) === tail && tails.delete(key));
      return run;
    };
}

export class MediaLruStore {
  private meta = new Map<string, Meta>();
  private cache?: CacheLike;
  private queue = createKeyedQueue();
  maxSize: number;
  /** tổng byte đã ghi xuống đĩa (để so với bản gốc ghi lại cả file mỗi lần đọc) */
  bytesWritten = 0;

  constructor(private o: MediaLruOptions) {
    this.maxSize = o.initialMaxSize ?? 200 * MB;
  }

  get currentSize() {
    let n = 0;
    for (const m of this.meta.values()) n += m.size;
    return n;
  }

  /** Danh sách từ cũ nhất tới mới nhất. */
  entries(): [string, Meta][] {
    return [...this.meta].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  }

  private now() {
    return this.o.now?.() ?? Date.now();
  }

  /** Mở cache và dựng lại metadata từ header đã ghi kèm mỗi response. */
  async open() {
    this.cache = await this.o.openCache();
    this.meta.clear();
    for (const req of await this.cache.keys()) {
      const res = await this.cache.match(req);
      const size = Number(res?.headers.get(SIZE_HEADER));
      const key = decodeURIComponent(new URL(req.url).pathname.slice(1));
      if (res && size >= 0) this.meta.set(key, { size, lastUsed: Number(res.headers.get(TIME_HEADER)) || 0 });
    }
  }

  private get c() {
    if (!this.cache) throw new Error('chưa open()');
    return this.cache;
  }

  /** Đọc: chỉ cập nhật thời điểm dùng trong metadata, không ghi lại bytes. */
  get = (key: string) =>
    this.queue(async (k: string) => {
      const res = await this.c.match(urlOf(k));
      if (!res) {
        this.meta.delete(k);
        return null;
      }
      const m = this.meta.get(k);
      if (m) m.lastUsed = this.now();
      return new Uint8Array(await res.arrayBuffer());
    })(key);

  put = (key: string, bytes: Uint8Array<ArrayBuffer>) =>
    this.queue(async (k: string, data: Uint8Array<ArrayBuffer>) => {
      const size = data.byteLength;
      if (size > (this.o.maxItemBytes ?? 30_000_000) || size > this.maxSize) return false;
      // Dọn chỗ TRƯỚC khi ghi, không để kho vượt giới hạn rồi mới dọn.
      await this.evictUntil(this.maxSize - size, 'nhường chỗ', k);
      const lastUsed = this.now();
      try {
        await this.c.put(
          urlOf(k),
          new Response(data, { headers: { [SIZE_HEADER]: String(size), [TIME_HEADER]: String(lastUsed) } }),
        );
      } catch (e) {
        if ((e as Error).name !== 'QuotaExceededError') throw e;
        // Trình duyệt hết chỗ: co giới hạn còn một nửa kích thước hiện tại, không ghi metadata "ma".
        this.maxSize = Math.floor(this.currentSize / 2);
        await this.evictUntil(this.maxSize, 'QuotaExceededError');
        return false;
      }
      this.meta.set(k, { size, lastUsed });
      this.bytesWritten += size;
      return true;
    })(key, bytes);

  delete = (key: string) =>
    this.queue(async (k: string) => {
      await this.c.delete(urlOf(k));
      this.meta.delete(k);
    })(key);

  private async evictUntil(limit: number, reason: string, except?: string) {
    for (const [key, m] of this.entries()) {
      if (this.currentSize <= limit) return;
      if (key === except) continue;
      await this.c.delete(urlOf(key));
      this.meta.delete(key);
      this.o.onEvict?.(key, m.size, reason);
    }
  }

  /**
   * Gọi định kỳ (bản gốc: mỗi 60 giây). Giới hạn = phần kho đang chiếm + chỗ trống − chỗ phải chừa.
   * Khác bản gốc: giới hạn tăng lại được khi trống thêm, và thiếu estimate thì giữ nguyên thay vì tắt kho.
   */
  async updateMaxSize() {
    const est = await (this.o.estimate ?? (() => navigator.storage?.estimate?.()))();
    if (est?.quota == null || est.usage == null) return this.maxSize;
    const free = est.quota - est.usage;
    const target = (this.o.targetFree ?? defaultTargetFree)(est.quota);
    this.maxSize = Math.max(0, this.currentSize + free - target);
    await this.evictUntil(this.maxSize, 'quota');
    return this.maxSize;
  }
}
