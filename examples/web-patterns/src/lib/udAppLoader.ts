/**
 * Ba mảnh hạ tầng dựng trang (ý tưởng từ udAppLoader, course-taking/registry và
 * createUDProxy của Udemy):
 * 1. `loadApps`: tìm các "đảo" app trong HTML, nạp chunk và khởi động theo độ ưu tiên.
 * 2. `createRegistry`: component ở nhánh này tạo store, component ở nhánh khác dùng.
 * 3. `createLateContext`: object dữ liệu người dùng tới SAU khi HTML (được cache công khai) đã hiện.
 *
 * Khác bản gốc:
 * - Tải chunk của mọi app NGAY, chỉ có bước khởi động (bootstrap) là đi theo thứ tự ưu tiên.
 *   Bản gốc chờ nhóm trước khởi động xong mới bắt đầu tải chunk của nhóm sau (thác nước).
 * - App lỗi được đánh dấu `ud-app-failed` để lần gọi sau thử lại; bản gốc kẹt ở `ud-app-loading`.
 * - Registry nhớ ai đăng ký store: component cũ unmount không xoá store của component mới.
 * - Context lỗi thì chuyển sang trạng thái `error` (có thể thử lại), không treo "đang tải" mãi.
 */

export interface AppModule {
  bootstrap: (el: HTMLElement, args: unknown) => void;
}

export interface LoadAppsOptions {
  importApp: (moduleId: string) => Promise<AppModule>;
  /** Bản gốc: false (tải chunk theo từng nhóm ưu tiên). */
  prefetchAll?: boolean;
  onEvent?: (event: { moduleId: string; type: 'import-start' | 'import-end' | 'bootstrap' | 'error'; at: number }) => void;
}

export const UNLOAD_APP_EVENT = 'ud-app-loader.unload';

/** Nhóm các phần tử `.ud-app-loader` theo `data-module-priority`, ưu tiên cao chạy trước. */
export function groupByPriority(root: ParentNode): HTMLElement[][] {
  const groups = new Map<number, HTMLElement[]>();
  root.querySelectorAll<HTMLElement>('.ud-app-loader').forEach((el) => {
    const p = Number(el.dataset.modulePriority || 0);
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p)!.push(el);
  });
  return [...groups.entries()].sort(([a], [b]) => b - a).map(([, els]) => els);
}

export function loadApps(root: ParentNode, { importApp, prefetchAll = true, onEvent }: LoadAppsOptions) {
  const t0 = performance.now();
  const emit = (moduleId: string, type: Parameters<NonNullable<typeof onEvent>>[0]['type']) =>
    onEvent?.({ moduleId, type, at: Math.round(performance.now() - t0) });

  const groups = groupByPriority(root);
  const imports = new Map<HTMLElement, Promise<AppModule>>();
  const startImport = (el: HTMLElement) => {
    if (!imports.has(el)) {
      const id = el.dataset.moduleId!;
      emit(id, 'import-start');
      const p = importApp(id).then((m) => (emit(id, 'import-end'), m));
      p.catch(() => {}); // lỗi được xử lý ở bước bootstrap
      imports.set(el, p);
    }
    return imports.get(el)!;
  };

  const pending = (el: HTMLElement) =>
    !el.classList.contains('ud-app-loading') && !el.classList.contains('ud-app-loaded');

  if (prefetchAll) groups.flat().filter(pending).forEach(startImport);

  async function boot(el: HTMLElement) {
    if (!pending(el)) return;
    const id = el.dataset.moduleId!;
    el.classList.remove('ud-app-failed');
    el.classList.add('ud-app-loading');
    try {
      const mod = await startImport(el);
      mod.bootstrap(el, el.dataset.moduleArgs ? JSON.parse(el.dataset.moduleArgs) : {});
      el.classList.replace('ud-app-loading', 'ud-app-loaded');
      emit(id, 'bootstrap');
    } catch {
      el.classList.replace('ud-app-loading', 'ud-app-failed'); // lần gọi loadApps sau sẽ thử lại
      emit(id, 'error');
    }
  }

  const done = groups.reduce<Promise<unknown>>(
    (chain, els) => chain.then(() => Promise.all(els.map(boot))),
    Promise.resolve(),
  );

  // trả hàm gỡ NGAY (không chờ nạp xong), để có thể gỡ cả những app đã chạy trước
  const unload = () => groups.flat().forEach((el) => el.dispatchEvent(new Event(UNLOAD_APP_EVENT)));
  return { done, unload };
}

// ---------------------------------------------------------------- registry store

export function createRegistry<Stores extends Record<string, unknown>>() {
  const stores = new Map<keyof Stores, { store: unknown; owner: symbol }>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  return {
    /** Đăng ký store, trả hàm gỡ chỉ gỡ đúng bản mình đã đăng ký. */
    register<K extends keyof Stores>(name: K, store: Stores[K]) {
      const owner = Symbol(String(name));
      stores.set(name, { store, owner });
      notify();
      return () => {
        if (stores.get(name)?.owner !== owner) return; // đã có component khác đăng ký đè
        stores.delete(name);
        notify();
      };
    },
    get<K extends keyof Stores>(name: K) {
      return stores.get(name)?.store as Stores[K] | undefined;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// ---------------------------------------------------------------- context tới muộn

export type LateState = 'loading' | 'loaded' | 'error';

/**
 * Trước khi dữ liệu về, đọc bất kỳ thuộc tính nào cũng ném lỗi rõ ràng (giống bản gốc),
 * để code lỡ dùng sớm bị phát hiện ngay thay vì âm thầm nhận `undefined`.
 */
export function createLateContext<T extends object>(name: string, load: () => Promise<T>) {
  let state: LateState = 'loading';
  let data: T | null = null;
  let error = '';
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  const run = () => {
    state = 'loading';
    notify();
    return load().then(
      (d) => {
        data = d;
        state = 'loaded';
        notify();
      },
      (e: unknown) => {
        error = String(e);
        state = 'error';
        notify();
      },
    );
  };

  const proxy = new Proxy({} as T, {
    get(_, prop) {
      if (state !== 'loaded') throw new Error(`${name}.${String(prop)} chưa có: kiểm tra state trước khi đọc`);
      return (data as Record<PropertyKey, unknown>)[prop];
    },
  });

  return {
    data: proxy,
    get state() {
      return state;
    },
    get error() {
      return error;
    },
    start: run,
    retry: run,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
