import { useEffect, useRef } from 'react';

/**
 * Phím tắt toàn cục có phạm vi (scope), ý tưởng từ packages/keybindings của Trello:
 * - Một listener `keydown` duy nhất trên document cho cả app.
 * - Mỗi handler đăng ký kèm một scope (số). Scope cao chạy trước.
 * - Khi có handler ở scope >= Dialog thì các scope thấp hơn bị chặn: mở dialog/popover là
 *   phím tắt của trang bên dưới tự tắt, không component nào phải tự gỡ listener.
 * - Bỏ qua phím khi đang gõ vào ô nhập (trừ Escape), khi đang soạn chữ bằng IME,
 *   khi giữ Ctrl/⌘/Alt (để không đụng phím tắt của trình duyệt/hệ điều hành).
 * - Bàn phím tiếng Nga, dấu câu toàn khổ tiếng Trung được quy về phím Latinh tương ứng.
 */

export const Scope = {
  Global: 0,
  Page: 10,
  Panel: 20,
  Dialog: 100,
  Popover: 130,
} as const;

/** Từ scope này trở lên, handler sẽ chặn mọi scope thấp hơn. */
export const BLOCKING_SCOPE = Scope.Dialog;

/** Trả về `false` nếu handler quyết định không xử lý phím này (để handler sau thử). */
export type ShortcutCallback = (event: KeyboardEvent) => void | boolean;

interface Entry {
  key: string | null; // null = nhận mọi phím (catch-all)
  callback: ShortcutCallback;
}

// ---- Chuẩn hoá phím ----

/**
 * Bàn phím tiếng Nga (ЙЦУКЕН) thường in kèm chữ Latinh QWERTY. Quy chữ Kirin về phím Latinh
 * cùng vị trí để phím tắt vẫn chạy. Bảng của Trello thiếu х ъ э, ở đây bổ sung đủ.
 * Dấu câu toàn khổ (bộ gõ tiếng Trung) quy về dấu ASCII.
 */
const NON_LATIN_KEYS: Record<string, string> = {
  й: 'q', ц: 'w', у: 'e', к: 'r', е: 't', н: 'y', г: 'u', ш: 'i', щ: 'o', з: 'p', х: '[', ъ: ']',
  ф: 'a', ы: 's', в: 'd', а: 'f', п: 'g', р: 'h', о: 'j', л: 'k', д: 'l', ж: ';', э: "'",
  я: 'z', ч: 'x', с: 'c', м: 'v', и: 'b', т: 'n', ь: 'm', б: ',', ю: '.',
  '。': '.', '《': '<', '》': '>', '，': ',', '；': ';', '？': '?',
};

/** Giá trị trả về khi đang soạn chữ bằng IME: không bao giờ khớp phím tắt nào. */
export const PROCESS_KEY = 'Process';

export function normalizeKey(event: Pick<KeyboardEvent, 'key' | 'code' | 'isComposing' | 'keyCode'>): string {
  // Đang soạn chữ (tiếng Nhật, tiếng Trung, Telex trên một số bộ gõ…): keydown có keyCode 229
  // và `key` là chữ tạm, không phải phím người dùng định bấm.
  if (event.isComposing || event.keyCode === 229 || event.key === PROCESS_KEY) return PROCESS_KEY;

  const { key } = event;
  if (key.length !== 1) return key; // Escape, Enter, ArrowUp, F1…

  const lower = key.toLowerCase();
  const mapped = NON_LATIN_KEYS[lower];
  if (mapped) return key === lower ? mapped : mapped.toUpperCase();

  // Bố cục khác (Thái, Ả Rập, Hy Lạp…): không có bảng thì dựa vào vị trí vật lý của phím.
  // event.code luôn đặt tên theo QWERTY ("KeyF") bất kể bố cục đang dùng.
  if (key.charCodeAt(0) > 127 && /^Key[A-Z]$/.test(event.code)) {
    return event.code.slice(3).toLowerCase();
  }
  return key;
}

// ---- Ô nhập đang được gõ ----

/** Các input không nhận chữ: phím tắt vẫn chạy khi chúng đang focus. */
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file']);

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const isInput =
    target.matches('textarea, select, [contenteditable]:not([contenteditable="false"])') ||
    (target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type));
  if (!isInput) return false;
  // Safari đôi khi giữ activeElement là một input đã bị ẩn bằng JS: input ẩn thì coi như không gõ
  return !!(target.offsetWidth || target.offsetHeight || target.getClientRects().length);
}

// ---- Registry ----

const registry = new Map<number, Entry[]>();
let paused = false;
let listening = false;

export const pauseShortcuts = () => {
  paused = true;
};
export const resumeShortcuts = () => {
  paused = false;
};

function isEligible(event: KeyboardEvent, key: string) {
  return !(
    paused ||
    key === PROCESS_KEY ||
    key === 'Unidentified' ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    (key !== 'Escape' && isTypingTarget(event.target))
  );
}

/** Handler đang có hiệu lực, scope cao trước; dừng ở scope chặn đầu tiên có handler. */
export function getActiveEntries(): Entry[] {
  const scopes = [...registry.entries()].sort((a, b) => b[0] - a[0]);
  const result: Entry[] = [];
  for (const [scope, entries] of scopes) {
    result.push(...entries);
    if (entries.length > 0 && scope >= BLOCKING_SCOPE) break;
  }
  return result;
}

export function getTopScope(): number | null {
  const scopes = [...registry.entries()].filter(([, entries]) => entries.length > 0).map(([scope]) => scope);
  return scopes.length ? Math.max(...scopes) : null;
}

function onKeyDown(event: KeyboardEvent) {
  const key = normalizeKey(event);
  if (!isEligible(event, key)) return;

  for (const entry of getActiveEntries()) {
    if (entry.key !== null && entry.key !== key) continue;
    const handled = entry.callback(event) !== false;
    // handler theo phím cụ thể: coi như đã xử lý, chặn hành vi mặc định (vd: "/" mở Quick Find của Firefox)
    if (handled && entry.key !== null) event.preventDefault();
    if (event.defaultPrevented) break;
  }
}

function syncListener() {
  const hasEntries = [...registry.values()].some((entries) => entries.length > 0);
  if (hasEntries && !listening) {
    document.addEventListener('keydown', onKeyDown);
    listening = true;
  } else if (!hasEntries && listening) {
    document.removeEventListener('keydown', onKeyDown);
    listening = false;
  }
}

/**
 * Đăng ký phím tắt. `key = null` để nhận mọi phím (tự lọc trong callback).
 * Trả về hàm huỷ đăng ký, chỉ gỡ đúng lần đăng ký này.
 */
export function registerShortcut(key: string | null, callback: ShortcutCallback, scope: number = Scope.Page) {
  const entry: Entry = { key, callback };
  const entries = registry.get(scope) ?? [];
  // handler đăng ký sau đứng trước trong cùng scope (component mở sau thường nằm trên)
  entries.unshift(entry);
  registry.set(scope, entries);
  syncListener();

  return () => {
    const list = registry.get(scope);
    if (!list) return;
    const index = list.indexOf(entry);
    if (index !== -1) list.splice(index, 1);
    if (list.length === 0) registry.delete(scope);
    syncListener();
  };
}

export function clearShortcuts() {
  registry.clear();
  syncListener();
}

/**
 * Hook React. Callback được giữ trong ref nên truyền arrow function mới mỗi render cũng
 * không làm đăng ký lại (bản của Trello đăng ký lại mỗi khi callback đổi).
 */
export function useShortcut(
  key: string | null,
  callback: ShortcutCallback,
  { scope = Scope.Page, enabled = true }: { scope?: number; enabled?: boolean } = {},
) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!enabled) return;
    return registerShortcut(key, (event) => callbackRef.current(event), scope);
  }, [key, scope, enabled]);
}
