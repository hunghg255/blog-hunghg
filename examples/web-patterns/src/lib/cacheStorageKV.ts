/**
 * Dùng Cache Storage (`caches`) làm kho key-value ngay từ trang chính, không cần service worker.
 * Ý tưởng từ src/util/cacheApi.ts của Telegram Web: lưu sticker, ảnh nền, gói ngôn ngữ.
 * Hợp với dữ liệu nhị phân lớn (Blob) hơn localStorage (chỉ lưu chuỗi, vài MB, chặn main thread).
 */

export type CacheValueType = 'text' | 'json' | 'blob';

function hasCacheStorage() {
  try {
    return typeof caches !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Cache API chỉ nhận Request http(s). Key kiểu "sticker:123" sẽ bị hiểu là URL có scheme "sticker"
 * và bị từ chối. Telegram thay ':' bằng '_' (nên "a:b" và "a_b" đụng nhau); ở đây mã hoá cả key
 * vào một đường dẫn giả cùng origin.
 */
function toRequest(key: string) {
  return new Request(`${self.location.origin}/__kv__/${encodeURIComponent(key)}`);
}

export async function cacheGet(cacheName: string, key: string, type: 'text'): Promise<string | undefined>;
export async function cacheGet<T = unknown>(cacheName: string, key: string, type: 'json'): Promise<T | undefined>;
export async function cacheGet(cacheName: string, key: string, type: 'blob'): Promise<Blob | undefined>;
export async function cacheGet(cacheName: string, key: string, type: CacheValueType) {
  if (!hasCacheStorage()) return undefined;
  try {
    const cache = await caches.open(cacheName);
    const response = await cache.match(toRequest(key));
    if (!response) return undefined;
    if (type === 'text') return await response.text();
    if (type === 'json') return await response.json();
    const blob = await response.blob();
    // iOS Safari có lúc trả Blob mất `type`; lấy lại từ header đã lưu (Telegram cũng vá như vậy)
    if (!blob.type) {
      const contentType = response.headers.get('Content-Type');
      if (contentType) return new Blob([blob], { type: contentType });
    }
    return blob;
  } catch (error) {
    console.warn('cacheGet', error);
    return undefined;
  }
}

export async function cacheSet(cacheName: string, key: string, data: string | Blob | object): Promise<boolean> {
  if (!hasCacheStorage()) return false;
  try {
    let response: Response;
    if (data instanceof Blob) {
      // ghi rõ Content-Type, đừng trông vào việc trình duyệt tự suy ra từ blob.type
      response = new Response(data, { headers: { 'Content-Type': data.type || 'application/octet-stream' } });
    } else if (typeof data === 'string') {
      response = new Response(data, { headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
    } else {
      response = new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    }
    const cache = await caches.open(cacheName);
    await cache.put(toRequest(key), response);
    return true;
  } catch (error) {
    // QuotaExceededError, chế độ riêng tư… cache chỉ là phần phụ, đừng làm hỏng tính năng chính
    console.warn('cacheSet', error);
    return false;
  }
}

export async function cacheDelete(cacheName: string) {
  if (!hasCacheStorage()) return false;
  return caches.delete(cacheName).catch(() => false);
}

/**
 * Đặt version vào TÊN cache ("lang-packs-v5"): đổi format dữ liệu thì đổi tên, rồi xoá mọi cache
 * cùng tiền tố mà không phải tên hiện tại. Gọi lúc khởi động app.
 * (Telegram chỉ dọn các bản cũ khi người dùng đăng xuất, nên bản cũ nằm lại tới lúc đó.)
 */
export async function cleanupOldCaches(prefix: string, current: string): Promise<string[]> {
  if (!hasCacheStorage()) return [];
  const names = await caches.keys();
  const stale = names.filter((name) => name.startsWith(prefix) && name !== current);
  await Promise.all(stale.map((name) => caches.delete(name)));
  return stale;
}
