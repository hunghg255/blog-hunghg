import { useSyncExternalStore } from 'react';
import type { ResolvedTheme, ThemePreference } from './themeScript';

/**
 * Phần chạy sau khi app đã tải: đọc/đổi theme, theo dõi hệ điều hành và các tab khác.
 * Trạng thái thật nằm trên <html> + localStorage (script ở <head> đã đặt sẵn), store chỉ đồng bộ theo.
 */

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function createThemeStore(storageKey = 'theme', attribute = 'data-theme', doc: Document = document) {
  const win = doc.defaultView!;
  const media = win.matchMedia(DARK_QUERY);
  const listeners = new Set<() => void>();

  const readPreference = (): ThemePreference => {
    try {
      const stored = win.localStorage.getItem(storageKey);
      return stored === 'light' || stored === 'dark' ? stored : 'system';
    } catch {
      return 'system';
    }
  };

  let preference = readPreference();
  const resolve = (pref: ThemePreference): ResolvedTheme =>
    pref === 'system' ? (media.matches ? 'dark' : 'light') : pref;

  function apply() {
    const theme = resolve(preference);
    const root = doc.documentElement;
    if (root.getAttribute(attribute) !== theme) {
      // Tắt transition trong lúc đổi màu: nếu không, mọi phần tử có `transition: background`
      // sẽ chuyển màu lệch nhịp nhau trông như trang bị "lag".
      const style = doc.createElement('style');
      style.textContent = '*,*::before,*::after{transition:none!important}';
      doc.head.appendChild(style);
      root.setAttribute(attribute, theme);
      root.style.colorScheme = theme;
      void win.getComputedStyle(doc.body).opacity; // ép trình duyệt tính lại style ngay, trước khi gỡ <style>
      style.remove();
    }
    listeners.forEach((listener) => listener());
  }

  // Hệ điều hành đổi sáng/tối: chỉ có tác dụng khi đang ở chế độ 'system'
  const onSystemChange = () => {
    if (preference === 'system') apply();
  };
  // Tab khác đổi theme: sự kiện `storage` chỉ bắn ở các tab KHÁC tab vừa ghi
  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey && event.key !== null) return;
    preference = readPreference();
    apply();
  };
  media.addEventListener('change', onSystemChange);
  win.addEventListener('storage', onStorage);

  return {
    getPreference: () => preference,
    getResolved: () => resolve(preference),
    setPreference(next: ThemePreference) {
      preference = next;
      try {
        if (next === 'system') win.localStorage.removeItem(storageKey);
        else win.localStorage.setItem(storageKey, next);
      } catch {
        // không lưu được thì chỉ đổi cho phiên này
      }
      apply();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      media.removeEventListener('change', onSystemChange);
      win.removeEventListener('storage', onStorage);
    },
  };
}

export type ThemeStore = ReturnType<typeof createThemeStore>;

/** Hook React đọc theme từ store. Server không biết theme, nên trả 'system' / undefined. */
export function useTheme(store: ThemeStore) {
  const preference = useSyncExternalStore(store.subscribe, store.getPreference, () => 'system' as const);
  const resolved = useSyncExternalStore(store.subscribe, store.getResolved, () => undefined);
  return { preference, resolved, setPreference: store.setPreference };
}
