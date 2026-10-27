/**
 * Ô tìm kiếm/autocomplete "chuẩn production", gom mẹo từ 3 site:
 * - Similarweb (services/fetchService.ts): gộp nhiều AbortSignal thành một, và một registry
 *   để huỷ mọi request GET đang chạy khi chuyển trang.
 * - Udemy (autosuggest.mobx-store.ts): debounce 200ms, huỷ request cũ, nuốt AbortError
 *   (không báo lỗi, không xoá gợi ý). Lớp gốc của Udemy chỉ ĐỌC cache theo query, dòng ghi
 *   cache bị comment để lớp con tự quyết; cache có giới hạn kích thước ở đây là phần thêm.
 * - Pipedrive (hooks/keyboard.js): khoá phím mũi tên/Enter khi kết quả chưa "chốt"
 *   (đang debounce hoặc đang tải) để không chọn nhầm kết quả của query cũ.
 */

// ---------------------------------------------------------------------------
// 1. Gộp nhiều AbortSignal
// ---------------------------------------------------------------------------

export interface CombinedSignal {
  signal: AbortSignal;
  /** gỡ listener trên các signal nguồn khi request đã xong (tránh rò bộ nhớ) */
  dispose(): void;
}

/**
 * Signal abort khi BẤT KỲ signal nguồn nào abort.
 * Có `AbortSignal.any` (chuẩn mới) thì dùng; không thì tự làm như Similarweb, nhưng thêm
 * `dispose()`: signal nguồn sống lâu (vd signal của cả trang) mà request nào cũng gắn
 * listener rồi không gỡ thì listener tích tụ mãi.
 */
export function anySignal(signals: AbortSignal[]): CombinedSignal {
  const native = (AbortSignal as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (native) return { signal: native.call(AbortSignal, signals), dispose: () => {} };

  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  const dispose = () => cleanups.splice(0).forEach((fn) => fn());

  for (const source of signals) {
    if (source.aborted) {
      controller.abort(source.reason);
      dispose();
      break;
    }
    const onAbort = () => {
      controller.abort(source.reason);
      dispose();
    };
    source.addEventListener('abort', onAbort, { once: true });
    cleanups.push(() => source.removeEventListener('abort', onAbort));
  }
  return { signal: controller.signal, dispose };
}

export const isAbortError = (error: unknown) =>
  error instanceof DOMException ? error.name === 'AbortError' : (error as Error)?.name === 'AbortError';

// ---------------------------------------------------------------------------
// 2. Registry các request đang chạy (huỷ hàng loạt khi chuyển trang)
// ---------------------------------------------------------------------------

export function createRequestRegistry() {
  const pending = new Set<AbortController>();
  return {
    /** Bọc một lời gọi: tự gắn signal của registry (gộp với signal riêng nếu có). */
    async run<T>(task: (signal: AbortSignal) => Promise<T>, own?: AbortSignal): Promise<T> {
      const controller = new AbortController();
      const combined = anySignal(own ? [own, controller.signal] : [controller.signal]);
      pending.add(controller);
      try {
        return await task(combined.signal);
      } finally {
        pending.delete(controller);
        combined.dispose();
      }
    },
    abortAll(reason = 'navigation') {
      const count = pending.size;
      pending.forEach((c) => c.abort(new DOMException(reason, 'AbortError')));
      pending.clear();
      return count;
    },
    get size() {
      return pending.size;
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Store cho ô gợi ý
// ---------------------------------------------------------------------------

export type SuggestStatus = 'idle' | 'debouncing' | 'loading' | 'ready' | 'error';

export interface SuggestState<T> {
  input: string;
  /** query đã chuẩn hoá (trim) ứng với `items` đang hiển thị */
  shownQuery: string;
  items: T[];
  status: SuggestStatus;
  activeIndex: number;
  /** true = kết quả đang hiển thị khớp với ô nhập, được phép chọn bằng bàn phím */
  stable: boolean;
}

export interface SuggestStoreOptions<T> {
  load: (query: string, signal: AbortSignal) => Promise<T[]>;
  debounceMs?: number;
  minLength?: number;
  cacheSize?: number;
  /** gọi khi request lỗi thật (không phải do mình huỷ) */
  onError?: (error: unknown) => void;
  /** để demo đếm: mỗi request thật sự gửi đi / bị huỷ / lấy từ cache */
  onEvent?: (event: 'request' | 'abort' | 'cache-hit', query: string) => void;
}

export function createSuggestStore<T>({
  load,
  debounceMs = 200,
  minLength = 1,
  cacheSize = 50,
  onError,
  onEvent,
}: SuggestStoreOptions<T>) {
  let state: SuggestState<T> = {
    input: '',
    shownQuery: '',
    items: [],
    status: 'idle',
    activeIndex: -1,
    stable: true,
  };
  const listeners = new Set<() => void>();
  const cache = new Map<string, T[]>(); // Map giữ thứ tự chèn -> dùng làm LRU đơn giản
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: AbortController | undefined;

  const set = (patch: Partial<SuggestState<T>>) => {
    state = { ...state, ...patch };
    state.stable = state.status === 'ready' || state.status === 'idle' || state.status === 'error';
    listeners.forEach((l) => l());
  };

  const remember = (query: string, items: T[]) => {
    cache.delete(query);
    cache.set(query, items);
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
  };

  async function fetchNow(query: string) {
    const controller = new AbortController();
    inflight = controller;
    const { signal } = controller;
    onEvent?.('request', query);
    set({ status: 'loading' });
    try {
      const items = await load(query, signal);
      // chốt chặn cuối: dù load() quên tôn trọng signal, kết quả của query cũ cũng bị bỏ
      if (signal.aborted) return;
      remember(query, items);
      set({ items, shownQuery: query, status: 'ready', activeIndex: -1 });
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return; // mình tự huỷ: không phải lỗi
      onError?.(error);
      set({ items: [], shownQuery: query, status: 'error', activeIndex: -1 });
    } finally {
      if (inflight === controller) inflight = undefined;
    }
  }

  function cancelPending() {
    clearTimeout(timer);
    timer = undefined;
    if (inflight && !inflight.signal.aborted) {
      inflight.abort();
      onEvent?.('abort', '');
    }
    inflight = undefined;
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setInput(input: string) {
      cancelPending();
      const query = input.trim();
      if (query.length < minLength) {
        set({ input, items: [], shownQuery: query, status: 'idle', activeIndex: -1 });
        return;
      }
      const cached = cache.get(query);
      if (cached) {
        onEvent?.('cache-hit', query);
        remember(query, cached);
        set({ input, items: cached, shownQuery: query, status: 'ready', activeIndex: -1 });
        return;
      }
      // giữ danh sách cũ trên màn hình (đỡ nhấp nháy) nhưng đánh dấu là chưa chốt
      set({ input, status: 'debouncing', activeIndex: -1 });
      timer = setTimeout(() => void fetchNow(query), debounceMs);
    },

    /** ↑ / ↓. Trả false nếu bị khoá vì kết quả chưa chốt. */
    move(delta: 1 | -1) {
      if (!state.stable || state.items.length === 0) return false;
      const n = state.items.length;
      // -1 = chưa chọn gì (con trỏ vẫn ở ô nhập); đi vòng: cuối -> ô nhập -> đầu
      const next = state.activeIndex + delta;
      set({ activeIndex: next < -1 ? n - 1 : next >= n ? -1 : next });
      return true;
    },

    /**
     * Enter. Kết quả đã chốt và có mục đang chọn -> chọn mục đó.
     * Chưa chốt -> KHÔNG chọn mục cũ (Pipedrive bỏ qua phím luôn); ở đây coi như gửi
     * nguyên câu đang gõ, giống Enter trên ô tìm kiếm của Google.
     */
    enter(): { type: 'item'; item: T } | { type: 'query'; query: string } {
      if (state.stable && state.activeIndex >= 0) {
        return { type: 'item', item: state.items[state.activeIndex] };
      }
      return { type: 'query', query: state.input.trim() };
    },

    clear() {
      cancelPending();
      set({ input: '', items: [], shownQuery: '', status: 'idle', activeIndex: -1 });
    },

    dispose: cancelPending,
  };
}

export type SuggestStore<T> = ReturnType<typeof createSuggestStore<T>>;
