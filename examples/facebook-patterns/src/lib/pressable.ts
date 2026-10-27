import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Các "interaction hook" cho nút/link: hover, press, focus, focus-visible.
 * Ý tưởng từ ReactHoverEvent / ReactPressEvent / ReactFocusEvent / Pressability của Facebook.
 */

// navigator.platform đã deprecated; ưu tiên userAgentData (Chromium), fallback về platform.
const platform =
  typeof navigator === 'undefined'
    ? ''
    : ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform);
const isMac = /Mac|iPhone|iPad|macOS/i.test(platform);

// ---------------- Focus modality (bàn phím hay con trỏ?) ----------------

/**
 * true = tương tác gần nhất là bàn phím. Mặc định true: focus đầu tiên của trang
 * (vd: autofocus) chưa có thao tác nào nên coi như bàn phím, giống Facebook.
 */
let keyboardModality = true;
let modalityListenersInstalled = false;

/** Phím "thật": bỏ qua tổ hợp Cmd/Ctrl (và Alt trên Windows/Linux) như Cmd+Tab đổi app. */
function isPlainKey(e: KeyboardEvent) {
  return !(e.metaKey || (!isMac && e.altKey) || e.ctrlKey);
}

function onModalityEvent(e: Event) {
  if (e.type === 'keydown') {
    if (isPlainKey(e as KeyboardEvent)) keyboardModality = true;
    return;
  }
  // pointermove trên <html> (chuột lướt ngoài nội dung) không tính
  if ((e.target as Element | null)?.nodeName === 'HTML') return;
  keyboardModality = false;
}

/** Gắn listener toàn cục MỘT lần, ở pha capture để chạy trước mọi handler khác. */
export function installModalityListeners() {
  if (modalityListenersInstalled || typeof window === 'undefined') return;
  modalityListenersInstalled = true;
  for (const type of ['keydown', 'pointermove', 'pointerdown', 'pointerup']) {
    window.addEventListener(type, onModalityEvent, { capture: true, passive: true });
  }
}

export function isKeyboardModality() {
  return keyboardModality;
}

/** Gõ chữ trong ô nhập không có nghĩa là người dùng đang "đi bằng bàn phím". */
function isTypingKey(e: KeyboardEvent) {
  if (e.key === 'Tab' || e.key === 'Escape') return false;
  const target = e.target as HTMLElement;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

// ---------------- Chặn lan truyền theo TỪNG LOẠI hook ----------------

/**
 * Pressable lồng nhau (card bấm được chứa nút "Thích"): chỉ phần tử TRONG CÙNG nhận press/click.
 * Không gọi stopPropagation thật (sẽ phá handler khác của app, vd outside-click) mà đánh dấu
 * lên event: mỗi loại ("press", "click") có cờ riêng. Hover thì không chặn: cha vẫn hover.
 */
const HANDLED = Symbol('interactionHandled');
type MarkedEvent = Event & { [HANDLED]?: Record<string, true> };

export function isHandled(e: Event, hook: string) {
  return (e as MarkedEvent)[HANDLED]?.[hook] === true;
}
export function markHandled(e: Event, hook: string) {
  const marked = e as MarkedEvent;
  (marked[HANDLED] ??= {})[hook] = true;
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

// ---------------- usePress ----------------

export interface PressEvent {
  type: 'pressstart' | 'pressend' | 'pressmove';
  pointerType: string;
  /** true nếu pressend vì con trỏ trượt ra ngoài / bị huỷ, không phải nhả bên trong */
  cancelled?: boolean;
}

export interface UsePressOptions {
  disabled?: boolean;
  onPressStart?: (e: PressEvent) => void;
  onPressEnd?: (e: PressEvent) => void;
  onPressChange?: (pressed: boolean) => void;
}

export function usePress(ref: RefObject<HTMLElement | null>, options: UsePressOptions) {
  const opts = useLatest(options);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const state = {
      pressed: false,
      active: false,
      pointerId: -1,
      pointerType: '',
      bounds: null as DOMRect | null,
    };

    const start = (pointerType: string) => {
      if (state.pressed) return;
      state.pressed = true;
      opts.current.onPressStart?.({ type: 'pressstart', pointerType });
      opts.current.onPressChange?.(true);
    };
    const end = (cancelled: boolean) => {
      if (!state.pressed) return;
      state.pressed = false;
      opts.current.onPressEnd?.({ type: 'pressend', pointerType: state.pointerType, cancelled });
      opts.current.onPressChange?.(false);
    };
    const stop = (cancelled: boolean) => {
      state.active = false;
      state.bounds = null;
      end(cancelled);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
    };

    const onDown = (e: PointerEvent) => {
      if (opts.current.disabled) return;
      if (isHandled(e, 'press')) return;
      markHandled(e, 'press');
      // chuột phải, nút phụ, và Ctrl+click trên Mac (= chuột phải) không phải "bấm"
      if (e.buttons === 2 || e.buttons > 4 || (isMac && e.pointerType === 'mouse' && e.ctrlKey)) return;
      state.active = true;
      state.pointerId = e.pointerId;
      state.pointerType = e.pointerType || 'mouse';
      // Cảm ứng/bút có "implicit pointer capture": mọi pointermove đều có target là element
      // ban đầu, nên không dùng target để biết ngón tay đã trượt ra ngoài được. Lưu rect lại.
      if (state.pointerType !== 'mouse') state.bounds = el.getBoundingClientRect();
      start(state.pointerType);
      document.addEventListener('pointermove', onMove, { passive: true });
      document.addEventListener('pointerup', onUp, { passive: true });
      document.addEventListener('pointercancel', onCancel, { passive: true });
    };

    const onMove = (e: PointerEvent) => {
      if (!state.active || e.pointerId !== state.pointerId) return;
      let inside: boolean;
      if (state.pointerType === 'mouse') {
        inside = el.contains(e.target as Node);
      } else {
        const b = state.bounds!;
        inside = e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
      }
      // trượt ra -> nhả (press out); trượt vào lại -> nhấn lại (press in)
      if (inside) start(state.pointerType);
      else end(true);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === state.pointerId) stop(false);
    };
    const onCancel = () => stop(true);
    // mất focus giữa chừng (alert(), chuyển tab…) -> huỷ
    const onFocusOut = (e: FocusEvent) => {
      if (e.target === el && state.active) stop(true);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('focusout', onFocusOut);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('focusout', onFocusOut);
      stop(true);
    };
  }, [ref, opts]);
}

// ---------------- useHover ----------------

export function useHover(
  ref: RefObject<HTMLElement | null>,
  { disabled, onHoverChange }: { disabled?: boolean; onHoverChange?: (hovered: boolean) => void },
) {
  const onChange = useLatest(onHoverChange);
  const disabledRef = useLatest(disabled);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let hovered = false;
    const set = (next: boolean) => {
      if (hovered === next) return;
      hovered = next;
      onChange.current?.(next);
    };
    const onOver = (e: PointerEvent) => {
      // Cảm ứng không có hover: chạm xong, trình duyệt giả lập mouseover và "hover" bị dính
      // lại tới khi chạm chỗ khác. Bỏ qua hẳn pointerType touch.
      if (e.pointerType === 'touch' || disabledRef.current) return;
      // Không đánh dấu "đã xử lý" ở đây: cha vẫn hover khi chuột ở trong con, giống CSS :hover,
      // và không phụ thuộc chuột đi vào card trước hay đi thẳng vào nút con.
      set(true);
    };
    const onOut = (e: PointerEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && el.contains(to)) return; // chỉ đi sang con của chính nó
      set(false);
    };
    el.addEventListener('pointerover', onOver);
    el.addEventListener('pointerout', onOut);
    return () => {
      el.removeEventListener('pointerover', onOver);
      el.removeEventListener('pointerout', onOut);
      set(false);
    };
  }, [ref, onChange, disabledRef]);
}

// ---------------- useFocus (+ focus-visible) ----------------

export function useFocus(
  ref: RefObject<HTMLElement | null>,
  {
    onFocusChange,
    onFocusVisibleChange,
  }: { onFocusChange?: (f: boolean) => void; onFocusVisibleChange?: (f: boolean) => void },
) {
  const cbs = useLatest({ onFocusChange, onFocusVisibleChange });

  useEffect(() => {
    installModalityListeners();
    const el = ref.current;
    if (!el) return;
    let focused = false;
    let focusVisible = false;
    const setVisible = (next: boolean) => {
      if (focusVisible === next) return;
      focusVisible = next;
      cbs.current.onFocusVisibleChange?.(next);
    };
    const onFocusIn = (e: FocusEvent) => {
      if (e.target !== el || focused) return; // chỉ focus vào CHÍNH element, không phải con
      focused = true;
      cbs.current.onFocusChange?.(true);
      setVisible(keyboardModality);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (e.target !== el || !focused) return;
      focused = false;
      cbs.current.onFocusChange?.(false);
      setVisible(false);
    };
    // Đang focus bằng chuột rồi bấm phím -> chuyển sang hiện focus ring; bấm chuột -> tắt.
    const onKeyDown = (e: KeyboardEvent) => {
      if (focused && isPlainKey(e) && !isTypingKey(e)) setVisible(true);
    };
    const onPointerDown = () => {
      if (focused) setVisible(false);
    };
    el.addEventListener('focusin', onFocusIn);
    el.addEventListener('focusout', onFocusOut);
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('pointerdown', onPointerDown);
    return () => {
      el.removeEventListener('focusin', onFocusIn);
      el.removeEventListener('focusout', onFocusOut);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('pointerdown', onPointerDown);
    };
  }, [ref, cbs]);
}

// ---------------- Gộp lại: usePressability ----------------

export interface InteractionState {
  hovered: boolean;
  pressed: boolean;
  focused: boolean;
  focusVisible: boolean;
  disabled: boolean;
}

export function usePressability(
  ref: RefObject<HTMLElement | null>,
  { disabled = false, ...press }: UsePressOptions & { disabled?: boolean },
): InteractionState {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  const [focusVisible, setFocusVisible] = useState(false);
  useHover(ref, { disabled, onHoverChange: setHovered });
  usePress(ref, {
    ...press,
    disabled,
    onPressChange: (p) => {
      setPressed(p);
      press.onPressChange?.(p);
    },
  });
  useFocus(ref, { onFocusChange: setFocused, onFocusVisibleChange: setFocusVisible });
  return { hovered: hovered && !disabled, pressed, focused, focusVisible, disabled };
}
