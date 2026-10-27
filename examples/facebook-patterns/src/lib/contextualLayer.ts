import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Đặt một "layer" (menu, tooltip, hovercard…) cạnh một anchor.
 * Ý tưởng lấy từ BaseContextualLayer của Facebook:
 * - Đặt vị trí bằng HAI lần translate: lần 1 theo px tới cạnh anchor, lần 2 theo %
 *   (-100% / -50%) để lùi lại đúng bằng kích thước của chính layer -> không cần đo layer
 *   mới đặt được "above" hay "middle".
 * - Tự lật (auto-flip) khi chạm mép viewport, chỉ khi phía bên kia đủ chỗ.
 * - Tự căn (auto-align): đẩy layer vào trong viewport, trả về `adjustment` để mũi tên bù lại.
 * - Ẩn layer khi anchor bị các vùng cuộn tổ tiên cắt mất hoàn toàn.
 * - Anchor nằm trong vùng fixed/sticky thì layer cũng dùng position: fixed.
 * - Ghi thẳng vào element.style, không đi qua React state ở mỗi lần cuộn.
 */

export type Position = 'above' | 'below' | 'start' | 'end';
export type Align = 'start' | 'middle' | 'end' | 'stretch';

export interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function toRect(el: Element): Rect {
  const { top, right, bottom, left } = el.getBoundingClientRect();
  return { top, right, bottom, left };
}

/** Giao của 2 hình chữ nhật, null nếu không chạm nhau. */
export function intersectRects(a: Rect, b: Rect): Rect | null {
  // (Bản minify của Facebook viết nhầm `b.right < b.left` ở điều kiện cuối.)
  if (a.bottom < b.top || b.bottom < a.top || a.right < b.left || b.right < a.left) return null;
  return {
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
    left: Math.max(a.left, b.left),
  };
}

/** Các tổ tiên có thể cắt nội dung (overflow khác visible), từ trong ra ngoài. */
export function getClippingAncestors(el: Element): Element[] {
  const result: Element[] = [];
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if (overflowX !== 'visible' || overflowY !== 'visible') result.push(node);
  }
  return result;
}

/** Anchor (hoặc tổ tiên của nó) là fixed/sticky -> layer phải fixed theo. */
export function isFixedOrSticky(el: Element): boolean {
  for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
    const { position } = getComputedStyle(node);
    if (position === 'fixed' || position === 'sticky') return true;
  }
  return false;
}

export interface LayerStyleInput {
  position: Position;
  align: Align;
  /** rect của anchor (đã cắt theo vùng cuộn) */
  contextRect: Rect;
  /** rect của khung toạ độ mà layer dùng (offset parent, hoặc viewport nếu fixed) */
  offsetRect: Rect;
  /** dịch thêm theo trục phụ để layer không tràn viewport */
  adjustment: number | null;
  fixed: boolean;
}

export interface LayerStyles {
  transform: string;
  position: 'fixed' | null;
  width: string | null;
  height: string | null;
}

/** Tính style cho layer. Thuần tính toán, không đọc DOM -> dễ test. */
export function getLayerStyles({
  position,
  align,
  contextRect: c,
  offsetRect: o,
  adjustment,
  fixed,
}: LayerStyleInput): LayerStyles {
  let x = 0;
  let y = 0;
  // phần trăm theo kích thước CHÍNH layer (translate % tính theo element được transform)
  let px: string | 0 = 0;
  let py: string | 0 = 0;
  let width: string | null = null;
  let height: string | null = null;

  switch (position) {
    case 'above':
      y = c.top - o.top;
      py = '-100%';
      break;
    case 'below':
      y = c.bottom - o.top;
      break;
    case 'start':
      x = c.left - o.left;
      px = '-100%';
      break;
    case 'end':
      x = c.right - o.left;
      break;
  }

  if (position === 'above' || position === 'below') {
    switch (align) {
      case 'start':
        x = c.left - o.left;
        break;
      case 'middle':
        x = (c.left + c.right) / 2 - o.left;
        px = '-50%';
        break;
      case 'end':
        x = c.right - o.left;
        px = '-100%';
        break;
      case 'stretch':
        x = c.left - o.left;
        width = `${c.right - c.left}px`;
        break;
    }
    if (adjustment != null) x += adjustment;
  } else {
    switch (align) {
      case 'start':
        y = c.top - o.top;
        break;
      case 'middle':
        y = (c.top + c.bottom) / 2 - o.top;
        py = '-50%';
        break;
      case 'end':
        y = c.bottom - o.top;
        py = '-100%';
        break;
      case 'stretch':
        y = c.top - o.top;
        height = `${c.bottom - c.top}px`;
        break;
    }
    if (adjustment != null) y += adjustment;
  }

  let transform = '';
  if (x !== 0 || y !== 0) transform += `translate(${Math.round(x)}px, ${Math.round(y)}px) `;
  if (px !== 0 || py !== 0) transform += `translate(${px}, ${py})`;
  return { transform: transform.trim(), position: fixed ? 'fixed' : null, width, height };
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Lật sang phía đối diện nếu phía hiện tại tràn khỏi `bounds` VÀ phía kia đủ chỗ.
 * Không đủ chỗ cả hai phía thì giữ nguyên (lật cũng chẳng tốt hơn).
 */
export function getFlippedPosition(position: Position, c: Rect, size: Size, bounds: Rect): Position {
  switch (position) {
    case 'above':
      return c.top - size.height < bounds.top && c.bottom + size.height < bounds.bottom
        ? 'below'
        : 'above';
    case 'below':
      return c.bottom + size.height > bounds.bottom && c.top - size.height > bounds.top
        ? 'above'
        : 'below';
    case 'start':
      return c.left - size.width < bounds.left && c.right + size.width < bounds.right
        ? 'end'
        : 'start';
    case 'end':
      return c.right + size.width > bounds.right && c.left - size.width > bounds.left
        ? 'start'
        : 'end';
  }
}

const opposite = (p: Position): Position =>
  p === 'above' ? 'below' : p === 'below' ? 'above' : p === 'start' ? 'end' : 'start';

/** Layer đặt ở phía `position` có nằm gọn trong bounds theo trục chính không. */
export function fitsSide(position: Position, c: Rect, size: Size, bounds: Rect): boolean {
  switch (position) {
    case 'above':
      return c.top - size.height >= bounds.top;
    case 'below':
      return c.bottom + size.height <= bounds.bottom;
    case 'start':
      return c.left - size.width >= bounds.left;
    case 'end':
      return c.right + size.width <= bounds.right;
  }
}

/** Số px cần dịch theo trục phụ để layer nằm gọn trong `bounds` (null = không cần). */
export function getAlignAdjustment(
  position: Position,
  align: Align,
  c: Rect,
  size: Size,
  bounds: Rect,
): number | null {
  let from: number;
  let to: number;
  if (position === 'above' || position === 'below') {
    if (align === 'stretch') return null;
    const start = align === 'start' ? c.left : align === 'end' ? c.right - size.width : (c.left + c.right) / 2 - size.width / 2;
    from = start;
    to = start + size.width;
    if (from < bounds.left) return bounds.left - from;
    if (to > bounds.right) return bounds.right - to;
  } else {
    if (align === 'stretch') return null;
    const start = align === 'start' ? c.top : align === 'end' ? c.bottom - size.height : (c.top + c.bottom) / 2 - size.height / 2;
    from = start;
    to = start + size.height;
    if (from < bounds.top) return bounds.top - from;
    if (to > bounds.bottom) return bounds.bottom - to;
  }
  return null;
}

export interface UseContextualLayerOptions {
  position?: Position;
  align?: Align;
  autoFlip?: boolean;
  autoAlign?: boolean;
  /** khoảng cách tối thiểu tới mép viewport, Facebook dùng 8px */
  margin?: number;
  /** khoảng trống bị thanh điều hướng cố định chiếm (giống CometViewportMarginsContext) */
  viewportMargins?: Partial<Rect>;
  /** false = layer đang đóng, khỏi lắng nghe gì cả */
  enabled?: boolean;
  /**
   * Layer đặt ngang (start/end) mà CẢ HAI bên đều không đủ chỗ (màn hình hẹp) thì chuyển
   * xuống dưới anchor. Facebook không làm bước này; Floating UI gọi là "fallback placements".
   */
  crossAxisFallback?: boolean;
}

export interface ContextualLayerState {
  /** vị trí thực tế sau khi tự lật */
  position: Position;
  /** anchor bị vùng cuộn cắt mất -> layer đang bị ẩn */
  hidden: boolean;
  adjustment: number | null;
}

export function useContextualLayer(
  anchorRef: RefObject<Element | null>,
  layerRef: RefObject<HTMLElement | null>,
  {
    position: preferred = 'below',
    align = 'start',
    autoFlip = true,
    autoAlign = true,
    margin = 8,
    viewportMargins,
    enabled = true,
    crossAxisFallback = true,
  }: UseContextualLayerOptions = {},
) {
  const [state, setState] = useState<ContextualLayerState>({
    position: preferred,
    hidden: false,
    adjustment: null,
  });
  const vmTop = viewportMargins?.top ?? 0;
  const vmRight = viewportMargins?.right ?? 0;
  const vmBottom = viewportMargins?.bottom ?? 0;
  const vmLeft = viewportMargins?.left ?? 0;

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    const layer = layerRef.current;
    if (!anchor || !layer) return;
    const doc = document.documentElement;

    // 1. Rect của anchor sau khi bị các vùng cuộn tổ tiên cắt.
    let contextRect: Rect | null = toRect(anchor);
    for (const ancestor of getClippingAncestors(anchor)) {
      contextRect = intersectRects(contextRect, toRect(ancestor));
      if (!contextRect) break;
    }
    if (!contextRect || contextRect.bottom - contextRect.top <= 0) {
      layer.style.visibility = 'hidden';
      setState((s) => (s.hidden ? s : { ...s, hidden: true }));
      return;
    }
    layer.style.visibility = '';

    // 2. Vùng an toàn trong viewport (trừ margin + thanh điều hướng cố định).
    const bounds: Rect = {
      top: vmTop + margin,
      right: doc.clientWidth - vmRight - margin,
      bottom: doc.clientHeight - vmBottom - margin,
      left: vmLeft + margin,
    };
    const size: Size = { width: layer.offsetWidth, height: layer.offsetHeight };

    // 3. Lật & căn: luôn tính từ vị trí "mong muốn", nên còn chỗ thì tự lật về.
    let position = autoFlip ? getFlippedPosition(preferred, contextRect, size, bounds) : preferred;
    if (crossAxisFallback && !fitsSide(position, contextRect, size, bounds)) {
      if ((position === 'start' || position === 'end') && !fitsSide(opposite(position), contextRect, size, bounds)) {
        position = 'below';
      }
    }
    const adjustment = autoAlign ? getAlignAdjustment(position, align, contextRect, size, bounds) : null;

    // 4. Khung toạ độ: viewport nếu fixed, ngược lại là offsetParent của layer.
    const fixed = isFixedOrSticky(anchor);
    const offsetRect: Rect = fixed
      ? { top: 0, left: 0, right: doc.clientWidth, bottom: doc.clientHeight }
      : toRect((layer.offsetParent as Element | null) ?? doc);

    // 5. Ghi thẳng vào DOM, không re-render ở mỗi lần cuộn.
    const styles = getLayerStyles({ position, align, contextRect, offsetRect, adjustment, fixed });
    layer.style.transform = styles.transform;
    layer.style.position = styles.position ?? 'absolute';
    layer.style.width = styles.width ?? '';
    layer.style.height = styles.height ?? '';

    // React state chỉ đổi khi vị trí/độ lệch đổi (để vẽ mũi tên), không phải mỗi frame.
    setState((s) =>
      s.position === position && s.adjustment === adjustment && !s.hidden
        ? s
        : { position, adjustment, hidden: false },
    );
  }, [anchorRef, layerRef, preferred, align, autoFlip, autoAlign, crossAxisFallback, margin, vmTop, vmRight, vmBottom, vmLeft]);

  const repositionRef = useRef(reposition);

  // Đặt vị trí trước khi trình duyệt vẽ để không bị "nháy" ở góc trái trên.
  // Chạy sau mỗi lần render: nội dung layer có thể vừa đổi.
  useLayoutEffect(() => {
    repositionRef.current = reposition;
    if (enabled) reposition();
  });

  useLayoutEffect(() => {
    if (!enabled) return;
    const run = () => repositionRef.current();
    // capture: true -> bắt được scroll của MỌI vùng cuộn lồng nhau (scroll không nổi bọt)
    window.addEventListener('scroll', run, { capture: true, passive: true });
    window.addEventListener('resize', run);
    // nội dung layer/anchor đổi kích thước (ảnh tải xong, Suspense resolve…) -> đặt lại
    const ro = new ResizeObserver(run);
    if (layerRef.current) ro.observe(layerRef.current);
    if (anchorRef.current) ro.observe(anchorRef.current);
    return () => {
      window.removeEventListener('scroll', run, { capture: true });
      window.removeEventListener('resize', run);
      ro.disconnect();
    };
  }, [enabled, anchorRef, layerRef]);

  return { ...state, reposition };
}

/**
 * Đóng popover khi click ra ngoài (BasePopoverTrigger + useOnOutsideClick).
 * Chỉ "kích hoạt" sau `armDelay` ms kể từ lúc mở: cú click vừa MỞ popover cũng nổi bọt lên
 * document, nếu nghe ngay thì popover vừa mở đã tự đóng.
 * `insideRefs`: các vùng được tính là "bên trong" (trigger + layer trong portal).
 */
export function useOutsideClick(
  insideRefs: RefObject<Element | null>[],
  onOutside: () => void,
  enabled: boolean,
  armDelay = 150,
) {
  const onOutsideRef = useRef(onOutside);
  useLayoutEffect(() => {
    onOutsideRef.current = onOutside;
  });
  useLayoutEffect(() => {
    if (!enabled) return;
    let armed = false;
    const timer = setTimeout(() => (armed = true), armDelay);
    const onClick = (event: MouseEvent) => {
      if (!armed) return;
      const target = event.target as Node;
      if (insideRefs.some((ref) => ref.current?.contains(target))) return;
      onOutsideRef.current();
    };
    document.addEventListener('click', onClick);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', onClick);
    };
    // insideRefs là mảng ref ổn định do người gọi truyền vào
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, armDelay]);
}
