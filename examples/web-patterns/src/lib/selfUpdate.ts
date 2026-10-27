/**
 * SPA tự cập nhật: thay vì hỏi "Có bản mới, tải lại?", app tự tải lại toàn trang ở lần
 * điều hướng kế tiếp, đúng trang người dùng vừa bấm. Ghép ý tưởng từ:
 *
 * - Trello (client-updater/shouldReloadToUpdate.ts): app mở quá 1 ngày thì reload ở lần điều
 *   hướng tới; không reload ở các chuyển cảnh "nhạy cảm" (board <-> card); kết quả là enum để
 *   test từng nhánh; ghi lý do vào storage để sau reload gửi analytics.
 * - Zappos (history/createSmartHistory.js): quá 16 giờ thì mọi push/replace thành tải trang
 *   đầy đủ; một số loại trang luôn tải đầy đủ, trừ khi đi giữa hai trang cùng loại.
 * - Facebook: reload khi server báo có bản deploy mới (xem bài router của series Facebook).
 */

// Enum kết quả như Trello: mỗi nhánh một giá trị riêng, test được từng nhánh.
// Dùng object `as const` thay cho `enum` để code vẫn là JavaScript thuần sau khi bỏ kiểu.
export const NavDecision = {
  /** loại trang đích luôn tải đầy đủ (trang đăng nhập, trang chưa làm bằng SPA…) */
  FULL_LOAD_ROUTE: 'FULL_LOAD_ROUTE',
  /** chuyển cảnh không được phép reload (vd mở card nằm đè lên board) */
  PROTECTED_TRANSITION: 'PROTECTED_TRANSITION',
  /** server đã có bản mới */
  NEW_VERSION: 'NEW_VERSION',
  /** app đã chạy quá lâu */
  MAX_AGE: 'MAX_AGE',
  /** chưa có lý do reload: điều hướng trong SPA */
  NOT_TIME_YET: 'NOT_TIME_YET',
} as const;
export type NavDecision = (typeof NavDecision)[keyof typeof NavDecision];

const FULL = new Set<NavDecision>([NavDecision.FULL_LOAD_ROUTE, NavDecision.NEW_VERSION, NavDecision.MAX_AGE]);
export const isFullLoad = (decision: NavDecision) => FULL.has(decision);

export interface UpdatePolicy {
  /** url -> loại trang ('board', 'card', 'search'…), null nếu không nhận ra */
  classify: (path: string) => string | null;
  /** app sống quá thời gian này (ms) thì reload ở lần điều hướng tới */
  maxAge: number;
  /** loại trang luôn tải đầy đủ. Loại không nhận ra (null) cũng tải đầy đủ. */
  fullLoadTypes?: string[];
  /** cặp [từ, tới] không bao giờ reload để cập nhật */
  protectedTransitions?: Array<[string, string]>;
}

export interface NavContext {
  /** app bắt đầu chạy lúc nào (thường là lúc module được nạp) */
  startedAt: number;
  now: number;
  newVersionAvailable: boolean;
}

export function decideNavigation(from: string, to: string, policy: UpdatePolicy, ctx: NavContext): NavDecision {
  const fromType = policy.classify(from);
  const toType = policy.classify(to);

  // 1. Trang đích không làm bằng SPA (hoặc không nhận ra): tải đầy đủ.
  //    Đi giữa hai trang cùng một loại đã biết thì vẫn SPA (giống Zappos).
  if (toType === null) return NavDecision.FULL_LOAD_ROUTE;
  if ((policy.fullLoadTypes ?? []).includes(toType) && toType !== fromType) return NavDecision.FULL_LOAD_ROUTE;

  // 2. Chuyển cảnh nhạy cảm: kể cả có bản mới cũng chờ lần sau
  const isProtected = (policy.protectedTransitions ?? []).some(([a, b]) => a === fromType && b === toType);
  if (isProtected) return NavDecision.PROTECTED_TRANSITION;

  // 3. Có bản mới, hoặc app đã chạy quá lâu
  if (ctx.newVersionAvailable) return NavDecision.NEW_VERSION;
  if (ctx.now - ctx.startedAt > policy.maxAge) return NavDecision.MAX_AGE;

  return NavDecision.NOT_TIME_YET;
}

// ---------------------------------------------------------------------------
// Ghi lý do trước khi reload, đọc lại sau khi tải xong (Trello: sendReloadedToUpdateEvent)
// ---------------------------------------------------------------------------

const REPORT_KEY = 'reloadedToUpdate';

export interface ReloadReport {
  reason: NavDecision;
  fromVersion: string;
  fromPath: string;
  toPath: string;
  sessionSeconds: number;
}

export function saveReloadReport(report: ReloadReport, storage: Storage = sessionStorage) {
  try {
    storage.setItem(REPORT_KEY, JSON.stringify(report));
  } catch {
    // storage đầy / bị chặn: sắp reload rồi, bỏ qua
  }
}

/** Gọi một lần lúc app khởi động; trả về báo cáo (nếu lần tải này là do tự cập nhật) rồi xoá. */
export function consumeReloadReport(storage: Storage = sessionStorage): ReloadReport | null {
  try {
    const raw = storage.getItem(REPORT_KEY);
    storage.removeItem(REPORT_KEY); // xoá ngay để lần tải sau không gửi lại
    return raw ? (JSON.parse(raw) as ReloadReport) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bộ điều hướng
// ---------------------------------------------------------------------------

export interface NavigatorOptions {
  policy: UpdatePolicy;
  version: string;
  currentPath: () => string;
  /** điều hướng trong SPA, vd history.pushState + render */
  push: (path: string) => void;
  /** tải trang đầy đủ, mặc định location.assign */
  fullLoad?: (path: string) => void;
  now?: () => number;
  storage?: Storage;
}

export function createSelfUpdatingNavigator({
  policy,
  version,
  currentPath,
  push,
  fullLoad = (path) => location.assign(path),
  now = Date.now,
  storage,
}: NavigatorOptions) {
  const startedAt = now();
  let newVersionAvailable = false;

  return {
    navigate(to: string): NavDecision {
      const from = currentPath();
      const decision = decideNavigation(from, to, policy, { startedAt, now: now(), newVersionAvailable });
      if (!isFullLoad(decision)) {
        push(to);
        return decision;
      }
      if (decision !== NavDecision.FULL_LOAD_ROUTE) {
        saveReloadReport(
          { reason: decision, fromVersion: version, fromPath: from, toPath: to, sessionSeconds: Math.round((now() - startedAt) / 1000) },
          storage,
        );
      }
      fullLoad(to);
      return decision;
    },
    markNewVersion() {
      newVersionAvailable = true;
    },
  };
}

/**
 * Hỏi server bản đang deploy (vd /version.json do bước build sinh ra). Gọi định kỳ và mỗi
 * khi tab được hiện lại; thấy khác bản đang chạy thì gọi onNewVersion một lần.
 */
export function watchVersion({
  url,
  current,
  interval = 10 * 60 * 1000,
  onNewVersion,
  fetchImpl = fetch,
}: {
  url: string;
  current: string;
  interval?: number;
  onNewVersion: (version: string) => void;
  fetchImpl?: typeof fetch;
}) {
  let done = false;
  const check = async () => {
    if (done || document.hidden) return;
    try {
      const response = await fetchImpl(url, { cache: 'no-store' });
      const { version } = (await response.json()) as { version: string };
      if (!done && version && version !== current) {
        done = true;
        onNewVersion(version);
      }
    } catch {
      // mạng lỗi: lần sau thử lại
    }
  };
  const id = setInterval(check, interval);
  const onVisible = () => void check();
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    done = true;
    clearInterval(id);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/**
 * Cách của Elastic Cloud: server gắn bản UI đang deploy vào header của MỌI response API
 * (`x-ui-tag`). Không cần poll riêng, các request vốn có đã mang tin "có bản mới".
 * Trả về hàm nhận response (gọi trong wrapper fetch / interceptor của axios).
 */
export function createVersionHeaderWatcher({
  current,
  header = 'x-ui-tag',
  onNewVersion,
}: {
  current: string;
  header?: string;
  onNewVersion: (version: string) => void;
}) {
  let announced: string | null = null;
  return <R extends { headers: Headers }>(response: R): R => {
    const tag = response.headers.get(header);
    // Response không có header (API khác, CDN, 204…) thì bỏ qua và KHÔNG xoá trạng thái
    // đã báo; nếu không, thanh "có bản mới" sẽ chớp tắt theo từng request.
    if (tag && tag !== current && tag !== announced) {
      announced = tag;
      onNewVersion(tag);
    }
    return response;
  };
}
