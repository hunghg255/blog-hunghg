/**
 * Phóng to / kéo ảnh trong media viewer bằng một `transform: matrix(s, 0, 0, s, tx, ty)`,
 * ý tưởng từ Telegram Web A (components/mediaViewer/PanZoom.tsx, vốn lấy từ react-pan-zoom).
 *
 * Quy ước ở đây: `transform-origin: 0 0`, ảnh nằm ở góc trên trái của khung khi tx = ty = 0.
 * Khi đó mép trái ảnh = tx, mép phải = tx + width * s. Toán đơn giản hơn origin ở tâm.
 */

export interface Matrix {
  scale: number;
  tx: number;
  ty: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Mức zoom trên thanh trượt → scale thật. Telegram làm phi tuyến để mức cao "nhảy" xa hơn. */
export const SCALE_VALUES: Record<number, number> = { 1: 1, 1.5: 1.5, 2: 2.2, 2.5: 3.3, 3: 5.5 };

export function tuneZoom(level: number) {
  return SCALE_VALUES[level] ?? level;
}

/** Luôn chừa ít nhất `safe` px ảnh trong khung, để không kéo ảnh khuất hẳn. */
export function clampToSafeArea(m: Matrix, frame: Size, image: Size, safe = 150): Matrix {
  const w = image.width * m.scale;
  const h = image.height * m.scale;
  // mép trái không vượt quá (frame - safe); mép phải không nhỏ hơn safe
  const tx = Math.min(frame.width - safe, Math.max(safe - w, m.tx));
  const ty = Math.min(frame.height - safe, Math.max(safe - h, m.ty));
  return { scale: m.scale, tx, ty };
}

/** Ma trận để ảnh nằm giữa khung ở scale cho trước. */
export function centered(frame: Size, image: Size, scale: number): Matrix {
  return {
    scale,
    tx: (frame.width - image.width * scale) / 2,
    ty: (frame.height - image.height * scale) / 2,
  };
}

/** Đổi scale nhưng giữ nguyên điểm (px, py) trong khung, vd vị trí con trỏ khi lăn chuột. */
export function zoomAt(m: Matrix, scale: number, px: number, py: number): Matrix {
  const k = scale / m.scale;
  return { scale, tx: px - (px - m.tx) * k, ty: py - (py - m.ty) * k };
}

export const toCss = (m: Matrix) => `matrix(${m.scale}, 0, 0, ${m.scale}, ${m.tx}, ${m.ty})`;

export interface PanZoomOptions {
  image: Size;
  minScale?: number;
  maxScale?: number;
  safe?: number;
  onChange?: (m: Matrix) => void;
}

/**
 * Gắn kéo (chuột, bút, ngón tay), lăn chuột để zoom và chụm hai ngón vào `frame`.
 * `content` là phần tử được biến đổi. Trả về controller.
 */
export function createPanZoom(frame: HTMLElement, content: HTMLElement, opts: PanZoomOptions) {
  const { image, minScale = 1, maxScale = 5.5, safe = 150 } = opts;
  const frameSize = () => ({ width: frame.clientWidth, height: frame.clientHeight });
  let m = centered(frameSize(), image, 1);
  let frameId = 0;

  // Ghi transform một lần mỗi frame, luôn từ giá trị MỚI NHẤT
  // (bản gốc gán transform bằng state cũ trong handleMouseMove).
  const render = () => {
    if (frameId) return;
    frameId = requestAnimationFrame(() => {
      frameId = 0;
      content.style.transform = toCss(m);
    });
  };

  const set = (next: Matrix) => {
    m = clampToSafeArea(next, frameSize(), image, safe);
    render();
    opts.onChange?.(m);
  };

  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStart: { dist: number; scale: number } | null = null;

  const local = (e: PointerEvent | WheelEvent) => {
    const r = frame.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: PointerEvent) => {
    // capture: thả chuột ở ngoài khung vẫn nhận pointerup (bản gốc nghe mouseup trên khung nên kẹt chế độ kéo)
    frame.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: m.scale };
    }
    frame.classList.add('is-dragging');
  };

  const onMove = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const now = local(e);
    pointers.set(e.pointerId, now);

    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const scale = Math.min(maxScale, Math.max(minScale, (pinchStart.scale * dist) / pinchStart.dist));
      set(zoomAt(m, scale, (a.x + b.x) / 2, (a.y + b.y) / 2));
      return;
    }
    if (m.scale <= minScale) return; // ảnh vừa khung thì không cho kéo
    set({ ...m, tx: m.tx + now.x - prev.x, ty: m.ty + now.y - prev.y });
  };

  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) frame.classList.remove('is-dragging');
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const scale = Math.min(maxScale, Math.max(minScale, m.scale * Math.exp(-e.deltaY / 300)));
    const p = local(e);
    set(scale === minScale ? centered(frameSize(), image, scale) : zoomAt(m, scale, p.x, p.y));
  };

  frame.style.touchAction = 'none'; // để pointermove của ngón tay không bị trình duyệt cướp đi cuộn/zoom trang
  content.style.transformOrigin = '0 0';
  frame.addEventListener('pointerdown', onDown);
  frame.addEventListener('pointermove', onMove);
  frame.addEventListener('pointerup', onUp);
  frame.addEventListener('pointercancel', onUp);
  frame.addEventListener('wheel', onWheel, { passive: false });
  render();

  return {
    get matrix() {
      return m;
    },
    /** Đặt mức zoom từ thanh trượt, zoom quanh tâm khung. */
    setZoomLevel(level: number) {
      const scale = tuneZoom(level);
      const f = frameSize();
      set(scale <= minScale ? centered(f, image, scale) : zoomAt(m, scale, f.width / 2, f.height / 2));
    },
    set,
    destroy() {
      cancelAnimationFrame(frameId);
      frame.removeEventListener('pointerdown', onDown);
      frame.removeEventListener('pointermove', onMove);
      frame.removeEventListener('pointerup', onUp);
      frame.removeEventListener('pointercancel', onUp);
      frame.removeEventListener('wheel', onWheel);
    },
  };
}
