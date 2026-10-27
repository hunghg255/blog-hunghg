/**
 * Focus stack cho popup lồng nhau (ý tưởng từ owa-calendar-focus-manager của Outlook)
 * và "trọng tài" chọn vùng nhận focus theo ưu tiên (owa-mail-focus-manager).
 *
 * Giả định giống Outlook: mọi popup (dialog, menu, panel…) được gắn THẲNG vào document.body.
 * Mỗi con trực tiếp của body là một "popup root"; stack lưu cặp (popup root → phần tử focus
 * cuối cùng trong nó). Khi popup đang chứa focus bị gỡ, focus được trả về mục kế trên stack,
 * kể cả khi phần tử cũ đã bị render lại (tìm lại bằng một "locator").
 */

// ---------- locator: mô tả một phần tử để tìm lại sau khi nó bị render lại ----------

export interface Locator {
  tag: string;
  /** data-focus-key nếu có: cách chắc chắn nhất, nên đặt cho nút mở popup */
  key?: string;
  /** các thuộc tính ổn định, so khớp chính xác */
  attrs: Array<[string, string]>;
  /** vị trí theo chỉ số con từ popup root xuống, dùng khi thuộc tính không đủ phân biệt */
  path: number[];
}

// thuộc tính hay đổi theo trạng thái: đưa vào selector thì tìm lại sẽ trượt
const VOLATILE = new Set(['class', 'style', 'tabindex', 'value', 'disabled', 'hidden', 'autofocus']);
const VOLATILE_PREFIX = ['aria-expanded', 'aria-pressed', 'aria-selected', 'aria-checked', 'aria-current', 'aria-activedescendant', 'data-state'];

function isStableAttribute(name: string) {
  return !VOLATILE.has(name) && !VOLATILE_PREFIX.includes(name);
}

export function describeElement(element: Element, root: Element): Locator {
  const path: number[] = [];
  for (let el: Element | null = element; el && el !== root; el = el.parentElement) {
    path.unshift(el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0);
  }
  return {
    tag: element.tagName.toLowerCase(),
    key: element.getAttribute('data-focus-key') ?? undefined,
    attrs: Array.from(element.attributes)
      .filter((a) => a.value !== '' && isStableAttribute(a.name))
      .map((a) => [a.name, a.value]),
    path,
  };
}

/** CSS.escape cho cả tên lẫn giá trị: không bao giờ tạo selector làm querySelectorAll ném lỗi. */
export function selectorFor(locator: Locator): string {
  if (locator.key !== undefined) return `[data-focus-key="${CSS.escape(locator.key)}"]`;
  return locator.tag + locator.attrs.map(([n, v]) => `[${CSS.escape(n)}="${CSS.escape(v)}"]`).join('');
}

export type LocateStrategy = 'same-element' | 'key' | 'attributes' | 'path';

export function locate(locator: Locator, root: Element): { element: HTMLElement; via: LocateStrategy } | null {
  const matches = root.querySelectorAll<HTMLElement>(selectorFor(locator));
  if (matches.length === 1) return { element: matches[0], via: locator.key !== undefined ? 'key' : 'attributes' };
  // không duy nhất (hoặc không còn): thử theo vị trí trong cây
  let el: Element | undefined = root;
  for (const index of locator.path) {
    el = el?.children[index];
    if (!el) return null;
  }
  return el && el !== root && el.tagName.toLowerCase() === locator.tag ? { element: el as HTMLElement, via: 'path' } : null;
}

// ---------- tabbable ----------

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function isFocusable(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  if (!el.matches(FOCUSABLE) || el.closest('[inert]')) return false;
  return el.getClientRects().length > 0;
}

export function firstFocusable(root: Element): HTMLElement | null {
  if (isFocusable(root)) return root as HTMLElement;
  return Array.from(root.querySelectorAll(FOCUSABLE)).find(isFocusable) ?? null;
}

// ---------- focus stack ----------

interface Entry {
  root: Element;
  element: HTMLElement;
  locator: Locator;
  /** lúc được focus, phần tử có đang hiện viền focus (bàn phím) không */
  focusVisible: boolean;
}

export interface RestoreInfo {
  /** popup root vừa bị gỡ */
  removed: Element;
  target: HTMLElement | null;
  via: LocateStrategy | 'first-focusable' | 'none';
}

export interface FocusStackOptions {
  onRestore?: (info: RestoreInfo) => void;
}

/** Con trực tiếp của body chứa `node` (popup root của nó), hoặc null. */
export function popupRootOf(node: Node | null): Element | null {
  let el = node instanceof Element ? node : node?.parentElement ?? null;
  while (el && el.parentElement && el.parentElement !== document.body) el = el.parentElement;
  return el && el.parentElement === document.body ? el : null;
}

export function createFocusStack({ onRestore }: FocusStackOptions = {}) {
  const stack: Entry[] = [];
  const indexOf = (root: Element) => stack.findIndex((e) => e.root === root);

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target === document.body) return;
    const root = popupRootOf(target);
    if (!root) return;
    const entry: Entry = { root, element: target, locator: describeElement(target, root), focusVisible: target.matches(':focus-visible') };
    // Outlook xoá entry cũ rồi đẩy lên đỉnh: popup vừa được focus là popup "trên cùng"
    const at = indexOf(root);
    if (at !== -1) stack.splice(at, 1);
    stack.push(entry);
  };

  const restoreAfterRemoval = (removed: Element) => {
    // bỏ các mục đầu stack không còn dùng được (popup đã bị gỡ hoặc không còn gì để focus)
    while (stack.length && (!stack[stack.length - 1].root.isConnected || !firstFocusable(stack[stack.length - 1].root))) stack.pop();
    const top = stack[stack.length - 1];
    if (!top) return onRestore?.({ removed, target: null, via: 'none' });

    let target: HTMLElement | null = null;
    let via: RestoreInfo['via'] = 'none';
    if (isFocusable(top.element)) {
      target = top.element;
      via = 'same-element';
    } else {
      const found = locate(top.locator, top.root);
      if (found && isFocusable(found.element)) ({ element: target, via } = found);
      else if ((target = firstFocusable(top.root))) via = 'first-focusable';
    }
    // không có viền focus lúc trước (người dùng dùng chuột) thì đừng để focus kéo trang cuộn đi
    target?.focus({ preventScroll: !top.focusVisible });
    onRestore?.({ removed, target, via });
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.removedNodes)) {
        if (!(node instanceof Element)) continue;
        const at = indexOf(node);
        if (at === -1) continue;
        const wasTop = at === stack.length - 1;
        stack.splice(at, 1);
        // chỉ can thiệp khi popup bị gỡ đang giữ focus: trình duyệt đã đẩy focus về body
        if (!wasTop) continue;
        // đợi một tick: nếu cùng lúc có popup mới được mở, popup đó sẽ tự đặt focus (Outlook
        // dùng cờ "preventFocusUntilNextRender" 200ms cho việc này)
        setTimeout(() => {
          const active = document.activeElement;
          if (active && active !== document.body && active.isConnected) return;
          restoreAfterRemoval(node);
        }, 0);
      }
    }
  });

  document.addEventListener('focusin', onFocusIn, true);
  // chỉ quan sát con trực tiếp của body: rẻ, và đúng với giả định "popup gắn vào body"
  observer.observe(document.body, { childList: true });

  return {
    /** bản sao để hiển thị/debug */
    snapshot: () => stack.map((e) => ({ root: e.root, element: e.element, selector: selectorFor(e.locator) })),
    destroy() {
      observer.disconnect();
      document.removeEventListener('focusin', onFocusIn, true);
      stack.length = 0;
    },
  };
}

// ---------- trọng tài focus theo ưu tiên ----------

/**
 * Vùng ưu tiên cao thử trước; trong một vùng, callback đăng ký SAU thử trước (LIFO: component
 * mới mount, thường nằm trên cùng). Callback trả true nếu đã đặt được focus.
 */
export function createFocusArbiter<Area extends string>(priority: readonly Area[]) {
  const registry = new Map<Area, Array<() => boolean>>(priority.map((a) => [a, []]));

  const focusArea = (area: Area): boolean => {
    const callbacks = registry.get(area) ?? [];
    for (let i = callbacks.length - 1; i >= 0; i--) if (callbacks[i]()) return true;
    return false;
  };

  return {
    register(area: Area, tryFocus: () => boolean) {
      registry.get(area)?.push(tryFocus);
      return () => {
        const list = registry.get(area);
        const i = list?.lastIndexOf(tryFocus) ?? -1;
        if (list && i !== -1) list.splice(i, 1);
      };
    },
    /** chạy sau frame tới, khi React đã commit xong; trả về vùng nhận focus */
    reset(): Promise<Area | null> {
      return new Promise((resolve) =>
        requestAnimationFrame(() => resolve(priority.find((area) => focusArea(area)) ?? null)),
      );
    },
    focusArea,
  };
}
