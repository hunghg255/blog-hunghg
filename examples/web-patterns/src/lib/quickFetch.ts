/**
 * Quick-fetch: bắn request API ngay khi HTML vừa tới, song song với lúc trình duyệt tải
 * bundle JS; khi app khởi động xong thì "nhận lại" promise đó thay vì gọi API lần nữa.
 * Ý tưởng từ app.hubspot.com (js/quick-fetch/restQuickFetch.js + utils/makeQuickFetchedRequest.js).
 *
 * File này có 2 nửa:
 * - createQuickFetch(): chạy trong một script RẤT nhỏ ở <head> (không React, không thư viện).
 * - withQuickFetch(): dùng trong app, bọc hàm gọi API bình thường.
 * Hai nửa gặp nhau qua một biến global (mặc định window.__quickFetch).
 */

export type Fetcher = (url: string, init?: RequestInit) => Promise<unknown>;

export interface EarlyRequest {
  name: string;
  url: string;
  startedAt: number;
  status: 'pending' | 'done' | 'error';
  promise: Promise<unknown>;
}

export interface QuickFetchOptions {
  fetcher?: Fetcher;
  /** quá hạn này mà app chưa nhận thì bỏ: dữ liệu đã cũ */
  maxAgeMs?: number;
  /** hết giờ thì coi như lỗi, app sẽ tự gọi lại */
  timeoutMs?: number;
  now?: () => number;
}

const defaultFetcher: Fetcher = async (url, init) => {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

export function createQuickFetch({
  fetcher = defaultFetcher,
  maxAgeMs = 30_000,
  timeoutMs = 15_000,
  now = () => performance.now(),
}: QuickFetchOptions = {}) {
  const requests = new Map<string, EarlyRequest>();

  function makeEarlyRequest(name: string, url: string, init?: RequestInit): EarlyRequest {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('quick-fetch timeout')), timeoutMs);
    const request: EarlyRequest = {
      name,
      url,
      startedAt: now(),
      status: 'pending',
      promise: fetcher(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer)),
    };
    request.promise.then(
      () => (request.status = 'done'),
      () => (request.status = 'error'),
    );
    // Chưa ai nhận thì lỗi vẫn không được thành "unhandled rejection"
    request.promise.catch(() => {});
    requests.set(name, request);
    return request;
  }

  /**
   * Chạy `then` sau khi request `name` xong: request phụ thuộc kết quả request trước
   * (HubSpot: chờ auth trả về danh sách feature gate rồi mới quyết định gọi API nào).
   */
  function after(name: string, then: (result: unknown) => void) {
    requests.get(name)?.promise.then(then, () => {});
  }

  /**
   * Lấy request sớm ra và XOÁ khỏi danh sách (chỉ dùng một lần). Trả về null nếu không có,
   * đã quá cũ, hoặc URL không khớp với thứ app thật sự cần.
   */
  function take(name: string, expectedUrl?: string): EarlyRequest | null {
    const request = requests.get(name);
    if (!request) return null;
    requests.delete(name);
    if (now() - request.startedAt > maxAgeMs) return null;
    if (expectedUrl !== undefined && request.url !== expectedUrl) return null;
    return request;
  }

  return { makeEarlyRequest, after, take, peek: () => [...requests.values()] };
}

export type QuickFetch = ReturnType<typeof createQuickFetch>;

declare global {
  interface Window {
    __quickFetch?: QuickFetch;
  }
}

/**
 * Bọc hàm gọi API của app: có request sớm khớp URL thì dùng nó, request sớm lỗi thì
 * gọi lại bằng đường bình thường; không có thì gọi bình thường.
 */
export function withQuickFetch<Args extends unknown[], T>(
  name: string,
  toUrl: (...args: Args) => string,
  request: (...args: Args) => Promise<T>,
  getQuickFetch: () => QuickFetch | undefined = () => window.__quickFetch,
) {
  return async (...args: Args): Promise<T> => {
    const early = getQuickFetch()?.take(name, toUrl(...args));
    if (!early) return request(...args);
    try {
      return (await early.promise) as T;
    } catch {
      return request(...args);
    }
  };
}
