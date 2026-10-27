/**
 * Router không có bảng route ở client: hỏi server URL này là trang gì, rồi cache kết quả
 * (ý tưởng từ CometRouteStore + CometRouteMapper của Facebook).
 *
 * - Cache 2 tầng: theo URL đầy đủ (đã chuẩn hoá), và theo path + các param "có nghĩa".
 *   Param không có nghĩa (tracking, ref…) không tách cache.
 * - Bỏ param tracking trước khi so khớp.
 * - Server có thể báo trước "sắp gửi route cho các URL này" (kèm response dữ liệu):
 *   client đặt sẵn một promise chờ cho từng URL. Prefetch (khi rê chuột lên link) chờ
 *   promise này thay vì gọi mạng lần nữa.
 *
 * Bản gốc: prefetch chờ promise tới khi nó hết hạn (15s); điều hướng thật thì không chờ,
 * không có trong cache là gọi mạng ngay. Bản viết lại cho điều hướng chờ thêm một khoảng
 * ngắn có giới hạn (`maxWaitOnNavigate`, đặt 0 để giống bản gốc); timer hết hạn chỉ xoá
 * đúng entry nó tạo; invalidatePath so theo ranh giới "/".
 */

export interface RouteResult {
  type: 'route';
  name: string;
  /** param của query được dùng để tách cache, ví dụ ['id'] cho /profile.php?id=… */
  significant: string[];
}
export interface RedirectResult {
  type: 'redirect';
  to: string;
}
export type ResolveResult = RouteResult | RedirectResult;

export interface ResolvedRoute {
  name: string;
  url: string;
  params: Record<string, string>;
}

export type Source = 'url-cache' | 'path-cache' | 'pushed' | 'network';

export const TRACKING_PARAMS = ['__cft__', '__tn__', 'fnr_t', 'sw_fnr_id', 'utm_source', 'utm_medium', 'fbclid'];

export function normalizeUrl(url: string, tracking = TRACKING_PARAMS): string {
  const u = new URL(url, 'https://example.test');
  tracking.forEach((p) => u.searchParams.delete(p));
  u.searchParams.sort();
  let path = u.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  const qs = u.searchParams.toString();
  return path + (qs ? `?${qs}` : '');
}

function splitUrl(url: string) {
  const u = new URL(url, 'https://example.test');
  return { path: u.pathname.replace(/(.)\/$/, '$1'), params: Object.fromEntries(u.searchParams) as Record<string, string> };
}

const significantKey = (params: Record<string, string>, names: string[]) =>
  JSON.stringify([...names].sort().map((n) => [n, params[n] ?? null]));

interface Pending {
  promise: Promise<ResolveResult | null>;
  resolve: (r: ResolveResult | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface RouteStoreOptions {
  /** gọi server phân giải URL */
  resolve: (url: string) => Promise<ResolveResult>;
  /** promise đặt trước tự hết hạn sau khoảng này (bản gốc 15s) */
  pushTtl?: number;
  /** một lần điều hướng chờ promise đặt trước tối đa bao lâu rồi tự gọi mạng (0 = không chờ) */
  maxWaitOnNavigate?: number;
  maxRedirects?: number;
}

export function createRouteStore({ resolve, pushTtl = 15_000, maxWaitOnNavigate = 300, maxRedirects = 5 }: RouteStoreOptions) {
  const byUrl = new Map<string, ResolvedRoute>();
  /** path → { significant names, results theo khoá param có nghĩa } */
  const byPath = new Map<string, { significant: string[]; results: Map<string, ResolveResult> }>();
  const pending = new Map<string, Pending>();

  function install(url: string, result: ResolveResult) {
    const { path, params } = splitUrl(normalizeUrl(url));
    const significant = result.type === 'route' ? result.significant : Object.keys(params);
    let node = byPath.get(path);
    if (!node) {
      node = { significant, results: new Map() };
      byPath.set(path, node);
    }
    node.results.set(significantKey(params, node.significant), result);
  }

  /** Tra cache ở client, đi theo redirect đã biết. */
  function lookup(url: string, depth = 0): { route: ResolvedRoute; source: Source } | null {
    const key = normalizeUrl(url);
    const hit = byUrl.get(key);
    if (hit) return { route: hit, source: 'url-cache' };
    const { path, params } = splitUrl(key);
    const node = byPath.get(path);
    const result = node?.results.get(significantKey(params, node.significant));
    if (!result) return null;
    if (result.type === 'redirect') return depth < maxRedirects ? lookup(result.to, depth + 1) : null;
    const route = { name: result.name, url: key, params };
    byUrl.set(key, route);
    return { route, source: 'path-cache' };
  }

  /** request phân giải đang bay, để prefetch và điều hướng cùng URL không gọi mạng hai lần */
  const inflight = new Map<string, Promise<ResolvedRoute>>();

  function fromNetwork(url: string, depth = 0): Promise<ResolvedRoute> {
    const key = normalizeUrl(url);
    const running = inflight.get(key);
    if (running) return running;
    const request = (async () => {
      const result = await resolve(key);
      install(key, result);
      if (result.type === 'redirect') {
        if (depth >= maxRedirects) throw new Error('Quá nhiều redirect');
        return fromNetwork(result.to, depth + 1);
      }
      return lookup(key)!.route;
    })().finally(() => inflight.delete(key));
    inflight.set(key, request);
    return request;
  }

  return {
    lookup,
    install,
    /** Server báo trước sẽ gửi route cho các URL này. */
    expect(urls: string[]) {
      urls.forEach((url) => {
        const key = normalizeUrl(url);
        if (lookup(key) || pending.has(key)) return;
        let resolveFn!: (r: ResolveResult | null) => void;
        const promise = new Promise<ResolveResult | null>((r) => (resolveFn = r));
        const entry: Pending = {
          promise,
          resolve: resolveFn,
          timer: setTimeout(() => {
            // chỉ xoá nếu entry trong map vẫn là entry mình tạo
            if (pending.get(key) === entry) pending.delete(key);
            resolveFn(null);
          }, pushTtl),
        };
        pending.set(key, entry);
      });
    },
    /** Payload route server đẩy tới (null = server không phân giải được). */
    deliver(url: string, result: ResolveResult | null) {
      const key = normalizeUrl(url);
      if (result) install(key, result);
      const entry = pending.get(key);
      if (entry) {
        pending.delete(key);
        clearTimeout(entry.timer);
        entry.resolve(result);
      }
    },
    async navigate(url: string): Promise<{ route: ResolvedRoute; source: Source; waitedMs: number }> {
      const start = performance.now();
      const cached = lookup(url);
      if (cached) return { ...cached, waitedMs: 0 };
      const entry = pending.get(normalizeUrl(url));
      if (entry && maxWaitOnNavigate > 0) {
        const timeout = new Promise<null>((r) => setTimeout(() => r(null), maxWaitOnNavigate));
        const pushed = await Promise.race([entry.promise, timeout]);
        if (pushed) {
          const hit = lookup(url);
          if (hit) return { route: hit.route, source: 'pushed', waitedMs: performance.now() - start };
        }
      }
      const route = await fromNetwork(url);
      return { route, source: 'network', waitedMs: performance.now() - start };
    },
    /** Prefetch khi rê chuột lên link: chờ promise đặt trước tới khi nó hết hạn, giống `fetch` của bản gốc. */
    async prefetch(url: string): Promise<{ route: ResolvedRoute; source: Source }> {
      const cached = lookup(url);
      if (cached) return cached;
      const entry = pending.get(normalizeUrl(url));
      if (entry && (await entry.promise)) {
        const hit = lookup(url);
        if (hit) return { route: hit.route, source: 'pushed' };
      }
      return { route: await fromNetwork(url), source: 'network' };
    },
    invalidatePath(prefix: string) {
      const matches = (p: string) => p === prefix || p.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
      [...byPath.keys()].forEach((p) => matches(p) && byPath.delete(p));
      [...byUrl.keys()].forEach((u) => matches(u.split('?')[0]) && byUrl.delete(u));
    },
    stats: () => ({ urls: byUrl.size, paths: byPath.size, pending: pending.size }),
  };
}

export type RouteStore = ReturnType<typeof createRouteStore>;
