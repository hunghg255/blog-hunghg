/**
 * Mô phỏng udAppLoader bản gốc (không phải mã của Udemy) để so sánh trong demo:
 * - chunk của một nhóm ưu tiên chỉ bắt đầu tải khi nhóm trước đã khởi động xong;
 * - lỗi thì báo Sentry rồi thôi: phần tử giữ class `ud-app-loading`, lần gọi sau bỏ qua nó.
 * Registry bản gốc: unregisterStores gán undefined, không cần biết ai đã đăng ký.
 */
import { groupByPriority, type LoadAppsOptions } from '../lib/udAppLoader';

export function loadAppsUdemyStyle(root: ParentNode, { importApp, onEvent }: LoadAppsOptions) {
  const t0 = performance.now();
  const emit = (moduleId: string, type: 'import-start' | 'import-end' | 'bootstrap' | 'error') =>
    onEvent?.({ moduleId, type, at: Math.round(performance.now() - t0) });

  function load(el: HTMLElement) {
    if (el.classList.contains('ud-app-loading') || el.classList.contains('ud-app-loaded')) {
      return Promise.resolve();
    }
    el.classList.add('ud-app-loading');
    const id = el.dataset.moduleId!;
    emit(id, 'import-start');
    return importApp(id)
      .then((mod) => {
        emit(id, 'import-end');
        mod.bootstrap(el, {});
        el.classList.remove('ud-app-loading');
        el.classList.add('ud-app-loaded');
        emit(id, 'bootstrap');
      })
      .catch(() => emit(id, 'error')); // như Raven.captureException: không gỡ class loading
  }

  const done = groupByPriority(root).reduce<Promise<unknown>>(
    (chain, els) => chain.then(() => Promise.all(els.map(load))),
    Promise.resolve(),
  );
  return { done };
}

export function createUdemyStyleRegistry() {
  const stores: Record<string, unknown> = {};
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  return {
    register(name: string, store: unknown) {
      stores[name] = store;
      notify();
      return () => {
        stores[name] = undefined; // như unregisterStores
        notify();
      };
    },
    get: (name: string) => stores[name],
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
