/**
 * Cache dữ liệu khởi động (từ điển i18n, settings, user data…) trong IndexedDB.
 * Ý tưởng từ CacheService của Similarweb Pro:
 * - Dữ liệu nặng có "version" riêng: mỗi lần mở app chỉ hỏi server version (rất nhẹ),
 *   khớp với bản đã lưu thì dùng luôn, lệch thì tải bản mới rồi ghi đè.
 * - Dữ liệu không có version: trả bản cũ ngay, tải bản mới ở nền (stale-while-revalidate).
 * - Không có IndexedDB (một số chế độ riêng tư, webview cũ) thì cứ gọi mạng như bình thường.
 */

export interface CacheRecord<T = unknown> {
  key: string;
  /** null với dữ liệu không có version (stale-while-revalidate) */
  version: string | null;
  value: T;
  savedAt: number;
}

export interface KVStore {
  get<T>(key: string): Promise<CacheRecord<T> | undefined>;
  put<T>(record: CacheRecord<T>): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
  close(): void;
}

const STORE = 'cache';

export function hasIndexedDB() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    // Firefox cũ ném SecurityError khi chặn cookie mà chỉ đọc biến `indexedDB`
    return false;
  }
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
}

/**
 * Mở một object store dạng key-value. `dbVersion` là version của SCHEMA (cấu trúc store),
 * khác với version của dữ liệu bên trong từng bản ghi.
 */
export function openKV(dbName: string, dbVersion = 1, blockedTimeout = 3000): Promise<KVStore> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const open = indexedDB.open(dbName, dbVersion);

    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };

    // Tab khác còn giữ kết nối tới schema cũ thì lệnh nâng cấp bị "blocked" và chờ vô hạn.
    // Đừng để app treo ở màn hình tải: hết giờ thì báo lỗi, phía gọi sẽ đi mạng.
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error('IndexedDB đang bị tab khác chặn nâng cấp'));
    }, blockedTimeout);

    open.onerror = () => {
      clearTimeout(timer);
      if (!settled) reject(open.error);
      settled = true;
    };

    open.onsuccess = () => {
      clearTimeout(timer);
      const db = open.result;
      if (settled) {
        db.close(); // đã báo lỗi vì quá giờ, đừng để kết nối mồ côi
        return;
      }
      settled = true;
      // Chiều ngược lại: tab khác (bản app mới hơn) cần nâng schema thì ta nhả kết nối ra.
      db.onversionchange = () => db.close();

      const store = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
      const write = async (fn: (s: IDBObjectStore) => void) => {
        const tx = db.transaction(STORE, 'readwrite');
        fn(tx.objectStore(STORE));
        await transactionDone(tx);
      };

      resolve({
        get: <T>(key: string) => promisify(store('readonly').get(key)) as Promise<CacheRecord<T> | undefined>,
        put: (record) => write((s) => s.put(record)),
        delete: (key) => write((s) => s.delete(key)),
        clear: () => write((s) => s.clear()),
        keys: async () => (await promisify(store('readonly').getAllKeys())).map(String),
        close: () => db.close(),
      });
    };
  });
}

/** Bản ghi có đúng hình dạng mong đợi không (Similarweb cũng kiểm tra kỹ trước khi tin cache). */
function isUsable<T>(record: CacheRecord<T> | undefined): record is CacheRecord<T> {
  return typeof record === 'object' && record !== null && 'value' in record && record.value !== undefined;
}

export type VersionedOutcome = 'hit' | 'miss' | 'stale-version' | 'bypass' | 'no-idb';

export interface VersionedSource<T> {
  key: string;
  /** gọi endpoint nhẹ chỉ trả version, vd { version: '2026-10-27.3' } */
  fetchVersion: () => Promise<string>;
  /** tải bản đầy đủ của đúng version đó */
  fetchData: (version: string) => Promise<T>;
}

export async function getVersioned<T>(
  kv: KVStore | null,
  source: VersionedSource<T>,
  { bypass = false } = {},
): Promise<{ value: T; version: string; outcome: VersionedOutcome }> {
  const version = await source.fetchVersion();
  if (!kv) return { value: await source.fetchData(version), version, outcome: 'no-idb' };

  let cached: CacheRecord<T> | undefined;
  if (!bypass) {
    cached = await kv.get<T>(source.key).catch(() => undefined);
    if (isUsable(cached) && cached.version === version) {
      return { value: cached.value, version, outcome: 'hit' };
    }
  }

  const value = await source.fetchData(version);
  // Version và dữ liệu nằm chung MỘT bản ghi: không bao giờ có cảnh version mới đi với dữ liệu cũ.
  // Ghi lỗi (hết quota…) thì bỏ qua: lần tải này vẫn thành công, lần sau tải lại.
  await kv.put<T>({ key: source.key, version, value, savedAt: Date.now() }).catch(() => undefined);
  return { value, version, outcome: bypass ? 'bypass' : cached ? 'stale-version' : 'miss' };
}

/**
 * Trả bản đã lưu ngay lập tức (nếu có), đồng thời tải bản mới ở nền.
 * Bản mới về thì ghi vào cache và gọi `onFresh` để giao diện cập nhật.
 */
export async function staleWhileRevalidate<T>(
  kv: KVStore | null,
  key: string,
  fetchData: () => Promise<T>,
  onFresh: (value: T) => void,
  { bypass = false } = {},
): Promise<{ value: T; fromCache: boolean }> {
  const cached = kv && !bypass ? await kv.get<T>(key).catch(() => undefined) : undefined;

  const refresh = async () => {
    const value = await fetchData();
    await kv?.put<T>({ key, version: null, value, savedAt: Date.now() }).catch(() => undefined);
    return value;
  };

  if (isUsable(cached)) {
    refresh().then(onFresh, () => {
      /* mạng lỗi: vẫn dùng bản cũ, lần mở sau thử lại */
    });
    return { value: cached.value, fromCache: true };
  }
  return { value: await refresh(), fromCache: false };
}

/**
 * Cửa thoát hiểm khi debug/hỗ trợ khách hàng: thêm `?clear-cache` vào URL để bỏ qua cache
 * một lần. Đọc xong thì xoá tham số khỏi URL (giữ nguyên hash) để F5 lần sau không bỏ qua nữa.
 */
export function consumeBypassFlag(param = 'clear-cache'): boolean {
  const params = new URLSearchParams(location.search);
  if (!params.has(param)) return false;
  params.delete(param);
  const search = params.toString();
  history.replaceState(history.state, '', `${location.pathname}${search ? `?${search}` : ''}${location.hash}`);
  return true;
}
