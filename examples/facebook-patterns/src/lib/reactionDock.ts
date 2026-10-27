import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';

/**
 * Bảng reaction "nhấn giữ rồi trượt" (ý tưởng từ UFIReactionsMenuImpl / UFIReactionsDialogLayerImpl của Facebook).
 *
 * - Khi kéo, sự kiện chạm (touch) và pointer có capture luôn bắn về phần tử bắt đầu chạm,
 *   nên phải tự hỏi "ngón tay đang ở trên ô nào" bằng document.elementFromPoint.
 * - Dock vừa bật lên (animation 200ms) thì chặn click: dock mọc ngay dưới con trỏ, không được chọn nhầm.
 * - Dock không đủ chỗ phía trên (bị header che) thì lật xuống dưới nút.
 * - Bàn phím: roving tabindex, mũi tên trái/phải đảo theo RTL, Enter trên reaction đang chọn = bỏ chọn.
 */

export interface PressSlideOptions<T extends string> {
  items: readonly T[];
  /** reaction người dùng đang chọn (null = chưa thả cảm xúc) */
  current: T | null;
  onSelect: (item: T | null, how: 'release' | 'click' | 'keyboard' | 'quick') => void;
  /** giữ bao lâu thì mở dock (ms) */
  longPressMs?: number;
  /** thời gian animation mở dock; click trong khoảng này bị bỏ qua (FB: 200) */
  dockAnimationMs?: number;
  blockClicksWhileAnimating?: boolean;
  /**
   * Cách tìm ô reaction từ phần tử dưới ngón tay:
   * 'closest' (bản viết lại) hoặc 'parent' (bản gốc: chỉ thử thêm đúng 1 cấp cha)
   */
  hitTest?: 'closest' | 'parent';
  /** chiều cao vùng bị che ở đỉnh viewport (header cố định) */
  topInset?: number;
  /** chuột (không phải cảm ứng) dừng trên nút bấy nhiêu ms thì mở dock; null = tắt */
  openOnHoverMs?: number | null;
  dockRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLElement | null>;
}

const ATTR = 'data-reaction';

function itemAt<T extends string>(x: number, y: number, mode: 'closest' | 'parent', items: readonly T[]): T | null {
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return null;
  if (mode === 'closest') {
    el = el.closest<HTMLElement>(`[${ATTR}]`);
  } else if (!el.hasAttribute(ATTR) && el.parentElement) {
    el = el.parentElement; // bản gốc: thử thêm đúng một cấp
  }
  const value = el?.getAttribute(ATTR) as T | null | undefined;
  return value && items.includes(value) ? value : null;
}

export function usePressSlide<T extends string>(options: PressSlideOptions<T>) {
  const {
    items,
    current,
    longPressMs = 400,
    dockAnimationMs = 200,
    blockClicksWhileAnimating = true,
    hitTest = 'closest',
    topInset = 0,
    openOnHoverMs = null,
    dockRef,
    triggerRef,
  } = options;
  const onSelectRef = useRef(options.onSelect);
  onSelectRef.current = options.onSelect;

  const [open, setOpen] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [placement, setPlacement] = useState<'above' | 'below'>('above');
  const [hovered, setHovered] = useState<T | null>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const sliding = useRef(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedByPress = useRef(false);
  const animatingRef = useRef(false);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setHovered(null);
    setFocusIndex(-1);
    sliding.current = false;
    if (restoreFocus) triggerRef.current?.focus();
  }, [triggerRef]);

  const openDock = useCallback(
    (focusFirst: boolean) => {
      const trigger = triggerRef.current;
      // đủ chỗ phía trên (sau khi trừ header) thì đặt trên, không thì lật xuống dưới
      const dockHeight = 64;
      if (trigger) setPlacement(trigger.getBoundingClientRect().top - dockHeight - 8 < topInset ? 'below' : 'above');
      setOpen(true);
      animatingRef.current = true;
      setAnimating(true);
      setTimeout(() => {
        animatingRef.current = false;
        setAnimating(false);
      }, dockAnimationMs);
      const start = Math.max(0, current ? items.indexOf(current) : 0);
      setFocusIndex(focusFirst ? start : -1);
    },
    [current, dockAnimationMs, items, topInset, triggerRef],
  );

  // trong lúc trượt: nghe trên document, hỏi elementFromPoint xem đang ở ô nào
  useEffect(() => {
    if (!open) return;
    const onMove = (e: globalThis.PointerEvent) => {
      if (!sliding.current) return;
      setHovered(itemAt(e.clientX, e.clientY, hitTest, items));
    };
    const onUp = (e: globalThis.PointerEvent) => {
      if (!sliding.current) return;
      sliding.current = false;
      const item = itemAt(e.clientX, e.clientY, hitTest, items);
      if (item) {
        onSelectRef.current(item, 'release');
        close();
      } else {
        setHovered(null); // thả tay ở ngoài: dock vẫn mở để chạm chọn
      }
    };
    const onCancel = () => {
      sliding.current = false;
      setHovered(null);
    };
    const onOutside = (e: globalThis.PointerEvent) => {
      const t = e.target as Node;
      if (!dockRef.current?.contains(t) && !triggerRef.current?.contains(t)) close();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('pointerdown', onOutside);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('pointerdown', onOutside);
    };
  }, [open, hitTest, items, close, dockRef, triggerRef]);

  // roving tabindex: đưa focus tới ô đang chọn
  useLayoutEffect(() => {
    if (!open || focusIndex < 0) return;
    dockRef.current?.querySelectorAll<HTMLElement>(`[${ATTR}]`)[focusIndex]?.focus();
  }, [open, focusIndex, dockRef]);

  useEffect(() => () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }, []);

  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const triggerProps = {
    'aria-haspopup': 'true' as const,
    'aria-expanded': open,
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      openedByPress.current = false;
      cancelPress();
      // cảm ứng tự "capture" pointer vào nút: mọi pointermove/pointerup sau đó đều có target là nút.
      // Nhả capture cho target khớp phần tử dưới ngón tay (logic chính vẫn dùng elementFromPoint).
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      pressTimer.current = setTimeout(() => {
        openedByPress.current = true;
        sliding.current = true;
        openDock(false);
      }, longPressMs);
    },
    onPointerUp() {
      cancelPress();
    },
    onPointerEnter(e: PointerEvent<HTMLElement>) {
      if (openOnHoverMs == null || e.pointerType !== 'mouse' || open) return;
      cancelPress();
      pressTimer.current = setTimeout(() => openDock(false), openOnHoverMs);
    },
    onPointerLeave() {
      // rời nút trước khi đủ thời gian giữ/hover: huỷ (trừ khi dock đã mở và đang trượt)
      if (!sliding.current) cancelPress();
    },
    onClick() {
      if (openedByPress.current) return; // click sinh ra sau cú giữ: không tính là "like nhanh"
      onSelectRef.current(current ? null : items[0], 'quick');
    },
    onContextMenu(e: { preventDefault(): void }) {
      e.preventDefault(); // giữ lâu trên mobile mở menu ngữ cảnh
    },
    onKeyDown(e: KeyboardEvent<HTMLElement>) {
      if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.altKey)) {
        e.preventDefault();
        openDock(true);
      }
    },
  };

  const dockProps = {
    role: 'toolbar' as const,
    'aria-label': 'Cảm xúc',
    onKeyDown(e: KeyboardEvent<HTMLElement>) {
      const rtl = dockRef.current ? getComputedStyle(dockRef.current).direction === 'rtl' : false;
      const back = rtl ? 'ArrowRight' : 'ArrowLeft';
      const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
      if (e.key === back || e.key === forward) {
        e.preventDefault();
        setFocusIndex((i) => Math.max(0, Math.min(items.length - 1, (i < 0 ? 0 : i) + (e.key === back ? -1 : 1))));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      } else if (e.key === 'Tab') {
        close(); // để Tab tự đi tiếp tới phần tử kế sau nút
      }
    },
  };

  const itemProps = (item: T, index: number) => ({
    [ATTR]: item,
    'aria-pressed': current === item,
    tabIndex: index === (focusIndex < 0 ? Math.max(0, current ? items.indexOf(current) : 0) : focusIndex) ? 0 : -1,
    onClick(e: { detail: number }) {
      if (blockClicksWhileAnimating && animatingRef.current) return; // dock vừa mọc dưới con trỏ
      // Enter/Space trên reaction đang chọn = bỏ chọn (FB: NONE)
      const how = e.detail === 0 ? 'keyboard' : 'click';
      onSelectRef.current(how === 'keyboard' && current === item ? null : item, how);
      close(how === 'keyboard');
    },
    onFocus() {
      setFocusIndex(index);
    },
  });

  return { open, animating, placement, hovered, triggerProps, dockProps, itemProps, close };
}
