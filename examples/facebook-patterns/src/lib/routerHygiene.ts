/**
 * Những chi tiết "vệ sinh" cho router SPA chạy lâu (ý tưởng từ buildCometRouter của Facebook).
 *
 * 1. Tự reload đầy đủ ở lần điều hướng kế tiếp khi: đã điều hướng quá N lần, phiên quá cũ,
 *    hoặc server báo đã có bản deploy mới. Reload đúng lúc người dùng đang chuyển trang thì
 *    họ gần như không nhận ra, và không mất dữ liệu đang nhập dở.
 * 2. history.state chỉ chứa một `key` (+ chỉ số), dữ liệu thật nằm trong bộ nhớ. Sau reload,
 *    key không còn trong bộ nhớ -> dựng lại trang từ URL.
 * 3. back() an toàn: mở link trong tab mới thì không có gì để back, nên sau một khoảng chờ
 *    mà không thấy popstate thì tự điều hướng về trang cha.
 * 4. Unload hook: chặn rời trang khi còn thay đổi chưa lưu, cả khi bấm nút Back của trình duyệt.
 */

export type ReloadReason = 'navigation_limit' | 'session_time_limit' | 'new_version';

export interface RouterSnapshot {
  url: string;
  /** vị trí trong lịch sử của app, 0 = trang đầu tiên của phiên */
  index: number;
  state: unknown;
  navigationCount: number;
  newVersionAvailable: boolean;
}

export type RouterEvent =
  | { type: 'navigate'; url: string; replace: boolean }
  | { type: 'popstate'; url: string }
  | { type: 'unknown_key'; url: string }
  | { type: 'force_reload'; url: string; reason: ReloadReason }
  | { type: 'blocked'; message: string }
  | { type: 'back_no_history'; fallbackUrl: string }
  | { type: 'back_failed'; fallbackUrl: string };

/** Trả về chuỗi cảnh báo để chặn rời trang, hoặc null/undefined để cho đi. */
export type UnloadHook = () => string | null | undefined;

export interface RouterOptions {
  maxNavigations?: number;
  maxSessionAgeMs?: number;
  /** chờ popstate bao lâu sau history.back() */
  backTimeoutMs?: number;
  now?: () => number;
  /** mặc định: hardNavigate(url) */
  forceReload?: (url: string, reason: ReloadReason) => void;
  /** hỏi người dùng có muốn rời trang không; mặc định window.confirm */
  confirmLeave?: (message: string) => Promise<boolean>;
  onEvent?: (event: RouterEvent) => void;
}

interface Entry {
  url: string;
  index: number;
  state: unknown;
}

/**
 * Tải lại đầy đủ tới `url`. Cẩn thận: nếu `url` trùng hệt URL hiện tại và có `#…`,
 * location.assign() chỉ là "điều hướng fragment" (cuộn tới anchor), KHÔNG tải lại trang.
 */
export function hardNavigate(url: string) {
  if (new URL(url, location.href).href === location.href) location.reload();
  else location.assign(url);
}

const currentUrl = () => location.pathname + location.search + location.hash;
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function createRouter({
  maxNavigations = 50,
  maxSessionAgeMs = 2.5 * 24 * 60 * 60 * 1000,
  backTimeoutMs = 500,
  now = Date.now,
  forceReload = hardNavigate,
  confirmLeave = async (message) => window.confirm(message),
  onEvent,
}: RouterOptions = {}) {
  const sessionStart = now();
  const entries = new Map<string, Entry>();
  const hooks = new Set<UnloadHook>();
  const listeners = new Set<() => void>();
  let navigationCount = 0;
  let newVersionAvailable = false;
  let keySeq = 0;
  let pendingBackToken: symbol | null = null;
  let skipHooksOnce = false;
  let reloading = false;

  const newKey = () => `state-key-${now()}-${keySeq++}`;

  // Trình duyệt tự khôi phục vị trí cuộn khi back thường sai với SPA (nội dung chưa render xong).
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  // Trang đầu tiên: giữ key cũ nếu có (vd: reload), luôn ghi lại để chắc chắn có key.
  const initialIndex = typeof history.state?.index === 'number' ? history.state.index : 0;
  let currentKey: string = history.state?.key ?? newKey();
  entries.set(currentKey, { url: currentUrl(), index: initialIndex, state: null });
  history.replaceState({ key: currentKey, index: initialIndex }, '', currentUrl());

  let snapshot = makeSnapshot();
  function makeSnapshot(): RouterSnapshot {
    const entry = entries.get(currentKey)!;
    return { url: entry.url, index: entry.index, state: entry.state, navigationCount, newVersionAvailable };
  }
  const emit = () => {
    snapshot = makeSnapshot();
    listeners.forEach((listener) => listener());
  };

  const blockingMessage = () => {
    for (const hook of hooks) {
      const message = hook();
      if (message) return message;
    }
    return null;
  };

  /** Lý do phải reload đầy đủ thay vì điều hướng trong SPA, nếu có. */
  function reloadReason(): ReloadReason | null {
    if (newVersionAvailable) return 'new_version';
    if (navigationCount >= maxNavigations) return 'navigation_limit';
    if (now() - sessionStart > maxSessionAgeMs) return 'session_time_limit';
    return null;
  }

  async function navigate(url: string, { replace = false, state = null as unknown } = {}) {
    if (reloading) return false;
    const reason = reloadReason();
    if (reason) {
      // Điều hướng TỚI url mới bằng full page load: đúng trang người dùng muốn,
      // nhưng với JS/CSS mới và bộ nhớ sạch.
      reloading = true;
      onEvent?.({ type: 'force_reload', url, reason });
      forceReload(url, reason);
      return false;
    }
    const message = blockingMessage();
    if (message) {
      onEvent?.({ type: 'blocked', message });
      if (!(await confirmLeave(message))) return false;
    }
    const current = entries.get(currentKey)!;
    const key = newKey();
    const index = replace ? current.index : current.index + 1;
    entries.set(key, { url, index, state });
    if (replace) history.replaceState({ key, index }, '', url);
    else history.pushState({ key, index }, '', url);
    currentKey = key;
    navigationCount++;
    onEvent?.({ type: 'navigate', url, replace });
    emit();
    return true;
  }

  async function onPopState(event: PopStateEvent) {
    pendingBackToken = null; // back() đã thành công
    const key: string | undefined = event.state?.key;
    const entry = key ? entries.get(key) : undefined;

    if (!skipHooksOnce) {
      const message = blockingMessage();
      if (message) {
        // Trình duyệt đã đổi URL rồi, không "huỷ" popstate được: đẩy lại trang hiện tại,
        // hỏi người dùng, nếu họ đồng ý rời thì back thêm một lần.
        const current = entries.get(currentKey)!;
        history.pushState({ key: currentKey, index: current.index }, '', current.url);
        onEvent?.({ type: 'blocked', message });
        if (await confirmLeave(message)) {
          skipHooksOnce = true;
          history.back();
        }
        return;
      }
    }
    skipHooksOnce = false;

    if (!key || !entry) {
      // Entry từ trước khi reload (bộ nhớ đã mất) hoặc do code khác pushState:
      // dựng lại từ URL, thay thế entry hiện tại.
      const url = currentUrl();
      onEvent?.({ type: 'unknown_key', url });
      const newEntryKey = newKey();
      const index = typeof event.state?.index === 'number' ? event.state.index : 0;
      entries.set(newEntryKey, { url, index, state: null });
      history.replaceState({ key: newEntryKey, index }, '', url);
      currentKey = newEntryKey;
      emit();
      return;
    }
    currentKey = key;
    onEvent?.({ type: 'popstate', url: entry.url });
    emit();
  }

  /**
   * Quay lại trang trước trong app; không được thì về `fallbackUrl`.
   * - index = 0: trang này là trang đầu tiên của phiên (vd: mở link từ tab mới), back sẽ
   *   rời khỏi app hoặc không làm gì -> đi thẳng tới fallback.
   * - Còn lại: history.back(), rồi sau `backTimeoutMs` + 2 frame mà chưa có popstate thì
   *   coi như back thất bại (Facebook dùng đúng cách này, với 500ms).
   */
  async function back(fallbackUrl: string) {
    const current = entries.get(currentKey)!;
    if (current.index === 0) {
      onEvent?.({ type: 'back_no_history', fallbackUrl });
      return navigate(fallbackUrl, { replace: true });
    }
    const token = Symbol('back');
    pendingBackToken = token;
    history.back();
    await new Promise((resolve) => setTimeout(resolve, backTimeoutMs));
    await nextFrame();
    await nextFrame();
    if (pendingBackToken !== token) return true;
    pendingBackToken = null;
    onEvent?.({ type: 'back_failed', fallbackUrl });
    return navigate(fallbackUrl, { replace: true });
  }

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (reloading) return;
    const message = blockingMessage();
    if (message) {
      event.preventDefault();
      // trình duyệt hiện thông báo mặc định của nó, không dùng chuỗi này
      event.returnValue = message;
    }
  };

  window.addEventListener('popstate', onPopState);
  window.addEventListener('beforeunload', onBeforeUnload);

  return {
    navigate,
    back,
    /** Gọi khi server báo có bản deploy mới (header, polling /version.json, websocket…). */
    markNewVersionAvailable() {
      newVersionAvailable = true;
      emit();
    },
    addUnloadHook(hook: UnloadHook) {
      hooks.add(hook);
      return () => {
        hooks.delete(hook);
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    destroy() {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
    },
  };
}

export type Router = ReturnType<typeof createRouter>;
