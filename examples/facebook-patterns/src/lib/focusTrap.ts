import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Giữ focus trong dialog + khôi phục focus khi đóng (ý tưởng từ FocusRegion / getTabbableNodes)
 * và đóng đúng layer trên cùng khi bấm Esc (ý tưởng từ CometHideLayerOnEscape).
 */

const TABBABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

/** Các element Tab tới được, theo đúng thứ tự trong DOM. */
export function getTabbableNodes(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter((el) => {
    if (el.tabIndex < 0) return false;
    // nằm trong vùng `inert`, `fieldset` bị disable hay `<details>` đang đóng: trình duyệt
    // không cho focus, nên cũng không được tính vào vòng Tab
    if (el.closest('[inert]')) return false;
    if (el.matches(':disabled')) return false;
    const closedDetails = el.closest('details:not([open])');
    if (closedDetails && !(el.tagName === 'SUMMARY' && el.parentElement === closedDetails)) {
      return false;
    }
    // bị ẩn bằng display:none / kích thước 0 / visibility:hidden thì không focus được
    if (el.offsetWidth === 0 && el.offsetHeight === 0 && el.getClientRects().length === 0) {
      return false;
    }
    return getComputedStyle(el).visibility !== 'hidden';
  });
}

export interface UseFocusTrapOptions {
  /** focus vào phần tử đầu tiên khi mở, mặc định true */
  autoFocus?: boolean;
  /** trả focus về nơi mở dialog khi đóng, mặc định true */
  restoreFocus?: boolean;
}

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  { autoFocus = true, restoreFocus = true }: UseFocusTrapOptions = {},
) {
  // Ghi lại element đang focus NGAY LÚC RENDER lần đầu active (giống autoRestoreFocus của FB).
  // Nếu đợi tới useEffect thì quá muộn: input con có `autoFocus` đã được React focus trong
  // giai đoạn commit, và ta sẽ "nhớ nhầm" chính input đó.
  // Lưu ý: đọc DOM và đọc/ghi ref trong lúc render là phá quy tắc của React (lint / React
  // Compiler có thể cảnh báo). Ở đây chấp nhận được vì thao tác idempotent: render lại bao
  // nhiêu lần thì kết quả vẫn như nhau.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const wasActiveRef = useRef(false);
  if (active && !wasActiveRef.current && typeof document !== 'undefined') {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
  }
  wasActiveRef.current = active;

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;

    const previouslyFocused = previouslyFocusedRef.current;

    if (autoFocus && !container.contains(document.activeElement)) {
      // không có gì focus được thì focus chính container (cần tabIndex=-1)
      (getTabbableNodes(container)[0] ?? container).focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      // dialog lồng nhau: chỉ dialog chứa element đang focus mới xử lý
      if (!container.contains(document.activeElement)) return;
      const nodes = getTabbableNodes(container);
      if (nodes.length === 0) {
        event.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || current === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Focus lọt ra ngoài (click ra nền, công cụ trợ năng…) thì kéo lại vào trong.
    // Bỏ qua nếu focus đi vào một dialog khác mở chồng lên trên.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node;
      if (container.contains(target)) return;
      if (target instanceof Element && target.closest('[data-focus-trap]')) return;
      (getTabbableNodes(container)[0] ?? container).focus();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      // chỉ trả focus nếu element cũ vẫn còn trên trang
      if (restoreFocus && previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [active, autoFocus, restoreFocus, containerRef]);
}

// ---- Esc chỉ đóng layer trên cùng ----

const escapeStack: Array<{ current: () => void }> = [];
let escapeListenerInstalled = false;

function onEscapeKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || escapeStack.length === 0) return;
  // Đang gõ bằng bộ gõ IME (tiếng Nhật, tiếng Việt kiểu VNI/Telex trên một số bộ gõ…):
  // Esc dùng để huỷ chữ đang soạn, không phải để đóng dialog.
  if (event.isComposing) return;
  // Một component bên trong (combobox, date picker…) đã tự xử lý Esc, vd: đóng dropdown
  // của nó. Không đóng luôn cả dialog.
  if (event.defaultPrevented) return;
  event.preventDefault();
  escapeStack[escapeStack.length - 1].current();
}

export function useEscapeLayer(onEscape: () => void, active = true) {
  const handlerRef = useRef(onEscape);
  useLayoutEffect(() => {
    handlerRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    if (!escapeListenerInstalled) {
      document.addEventListener('keydown', onEscapeKeyDown);
      escapeListenerInstalled = true;
    }
    // layer mở sau nằm trên cùng stack (giới hạn: xem bài viết)
    escapeStack.push(handlerRef);
    return () => {
      const index = escapeStack.indexOf(handlerRef);
      if (index !== -1) escapeStack.splice(index, 1);
    };
  }, [active]);
}
