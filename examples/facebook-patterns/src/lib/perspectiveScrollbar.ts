import type { CSSProperties } from 'react';

/**
 * Thanh cuộn tuỳ biến mà thumb di chuyển hoàn toàn trên compositor: không có listener
 * `scroll` nào cập nhật vị trí thumb (ý tưởng từ BaseScrollableArea của Facebook).
 *
 * Phần tử cuộn có `perspective: 1px`. Thumb là con `position: absolute` của nó (nên cuộn theo
 * nội dung), nhưng được đặt ở một chiều sâu Z và một ma trận có w = -1 sao cho sau phép chiếu
 * phối cảnh, nó đi XUỐNG với tốc độ `ratio` lần tốc độ cuộn. JS chỉ tính lại khi kích thước đổi.
 */

export interface ThumbMetrics {
  /** chiều cao vùng nhìn thấy (b) */
  viewport: number;
  /** tổng chiều cao nội dung (a = scrollHeight) */
  content: number;
  thumbHeight: number;
  /** thumb đi được bao nhiêu px khi nội dung cuộn 1px: (b - thumb) / (a - b) */
  ratio: number;
  transform: string;
  visible: boolean;
}

/**
 * Tính kích thước + transform của thumb.
 * - Thumb chiếm tỉ lệ viewport/content của rãnh: thumb = b² / a (giống thanh cuộn hệ thống),
 *   nhưng không nhỏ hơn `minThumb` (Facebook không có giới hạn này).
 * - ratio = quãng đường thumb đi được / quãng đường nội dung cuộn được.
 * - Sau phép chiếu, toạ độ y của thumb trên màn hình = y + ratio * scrollTop (xem bài viết).
 */
export function computeThumb(viewport: number, content: number, minThumb = 0): ThumbMetrics {
  if (content <= viewport || viewport <= 0) {
    return { viewport, content, thumbHeight: 0, ratio: 0, transform: 'none', visible: false };
  }
  const thumbHeight = Math.min(viewport, Math.max(minThumb, (viewport * viewport) / content));
  const ratio = (viewport - thumbHeight) / (content - viewport);
  const transform = [
    // w' = -w: lật dấu phần dịch chuyển do cuộn -> thumb đi ngược chiều nội dung
    'matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,-1)',
    // thu nhỏ trước để sau khi chia cho w' = 1/ratio thì kích thước trở lại như cũ
    `scale(${1 / ratio})`,
    // tổng z = -1 - 1/ratio  ->  w' = -1 - z = 1/ratio (với perspective 1px)
    `translateZ(${1 - 1 / ratio}px)`,
    'translateZ(-2px)',
  ].join(' ');
  return { viewport, content, thumbHeight, ratio, transform, visible: true };
}

/** Style cho phần tử cuộn. Cần thêm CSS `::-webkit-scrollbar { display: none }` để ẩn thanh cuộn gốc. */
export const perspectiveScrollerStyle: CSSProperties = {
  position: 'relative',
  overflowY: 'auto',
  overscrollBehaviorY: 'contain',
  perspective: '1px',
  perspectiveOrigin: 'right top',
  transformStyle: 'preserve-3d',
  scrollbarWidth: 'none',
};

/** Thumb: con trực tiếp của phần tử cuộn. Không nhận chuột, chuột đi vào track bên dưới. */
export const perspectiveThumbStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  width: 12,
  padding: '0 3px',
  boxSizing: 'border-box',
  transformOrigin: 'right top',
  pointerEvents: 'none',
  opacity: 0,
  display: 'none',
};

/** Track: cao bằng toàn bộ nội dung nên luôn phủ dải bên phải khi cuộn. Nhận chuột. */
export const perspectiveTrackStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  width: 12,
  display: 'none',
};

export interface PerspectiveScrollbarElements {
  scroller: HTMLElement;
  /** bọc nội dung, để ResizeObserver biết khi nội dung đổi chiều cao */
  content: HTMLElement;
  thumb: HTMLElement;
  track: HTMLElement;
}

export interface PerspectiveScrollbarOptions {
  minThumb?: number;
  /** ẩn thumb sau bao lâu không cuộn */
  hideAfterMs?: number;
  onMetrics?: (metrics: ThumbMetrics) => void;
}

/**
 * Gắn hành vi vào 4 phần tử. Trả về hàm huỷ. Dùng được với bất kỳ framework nào.
 * Thứ duy nhất chạy theo `scroll` là bật/tắt độ mờ của thumb, không đụng tới vị trí.
 */
export function attachPerspectiveScrollbar(
  { scroller, content, thumb, track }: PerspectiveScrollbarElements,
  { minThumb = 24, hideAfterMs = 1000, onMetrics }: PerspectiveScrollbarOptions = {},
): () => void {
  let metrics = computeThumb(0, 0);
  let hovered = false;
  let dragging = false;
  let scrolling = false;
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;

  const render = () => {
    const show = metrics.visible && (hovered || dragging || scrolling);
    thumb.style.opacity = show ? '1' : '0';
    // hiện ngay lập tức, ẩn thì mờ dần (Facebook: 0s khi hiện, .3s khi ẩn)
    thumb.style.transition = show ? 'opacity 0s' : 'opacity .3s';
  };

  const measure = () => {
    // Ẩn thumb + track TRƯỚC khi đo: track cao bằng scrollHeight cũ, nếu để nguyên thì nội dung
    // co lại mà scrollHeight vẫn giữ giá trị cũ (track tự "chống" chiều cao của chính nó).
    thumb.style.display = 'none';
    track.style.display = 'none';
    metrics = computeThumb(scroller.clientHeight, scroller.scrollHeight, minThumb);
    thumb.style.height = `${metrics.thumbHeight}px`;
    thumb.style.transform = metrics.transform;
    track.style.height = `${metrics.content}px`;
    thumb.style.display = metrics.visible ? 'block' : 'none';
    track.style.display = metrics.visible ? 'block' : 'none';
    render();
    onMetrics?.(metrics);
  };

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleMeasure = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measure, 100); // debounce 100ms như Facebook
  };

  const onScroll = () => {
    scrolling = true;
    render();
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      scrolling = false;
      render();
    }, hideAfterMs);
  };
  const onEnter = () => {
    hovered = true;
    render();
  };
  const onLeave = () => {
    hovered = false;
    render();
  };

  // Kéo thumb / giữ chuột trên rãnh
  let repeatTimer: ReturnType<typeof setInterval> | undefined;
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !metrics.visible) return;
    event.preventDefault();
    const scrollerTop = scroller.getBoundingClientRect().top;
    const startY = event.clientY;
    const startScroll = scroller.scrollTop;
    const thumbTop = scrollerTop + startScroll * metrics.ratio;
    track.setPointerCapture(event.pointerId);

    if (startY < thumbTop || startY > thumbTop + metrics.thumbHeight) {
      // bấm vào rãnh ngoài thumb: cuộn dần 20px mỗi 16ms về phía con trỏ
      const step = startY < thumbTop ? -20 : 20;
      repeatTimer = setInterval(() => scroller.scrollBy({ top: step }), 16);
    } else {
      dragging = true;
      render();
    }

    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      // thumb đi 1px thì nội dung đi 1/ratio px
      scroller.scrollTop = startScroll + (e.clientY - startY) / metrics.ratio;
    };
    const onUp = () => {
      clearInterval(repeatTimer);
      dragging = false;
      render();
      track.removeEventListener('pointermove', onMove);
      track.removeEventListener('pointerup', onUp);
      track.removeEventListener('pointercancel', onUp);
    };
    track.addEventListener('pointermove', onMove);
    track.addEventListener('pointerup', onUp);
    track.addEventListener('pointercancel', onUp);
  };

  const observer = new ResizeObserver(scheduleMeasure);
  observer.observe(scroller);
  observer.observe(content);
  window.addEventListener('resize', scheduleMeasure);
  scroller.addEventListener('scroll', onScroll, { passive: true });
  scroller.addEventListener('pointerenter', onEnter);
  scroller.addEventListener('pointerleave', onLeave);
  track.addEventListener('pointerdown', onPointerDown);
  measure();

  return () => {
    observer.disconnect();
    clearTimeout(resizeTimer);
    clearTimeout(scrollTimer);
    clearInterval(repeatTimer);
    window.removeEventListener('resize', scheduleMeasure);
    scroller.removeEventListener('scroll', onScroll);
    scroller.removeEventListener('pointerenter', onEnter);
    scroller.removeEventListener('pointerleave', onLeave);
    track.removeEventListener('pointerdown', onPointerDown);
  };
}

/**
 * Facebook tắt kỹ thuật này (dùng thanh cuộn gốc) trên iOS, Android, Edge (EdgeHTML), IE và
 * Firefox < 64 bằng UA sniffing. Bản viết lại dùng feature query: thiết bị cảm ứng chính
 * (thanh cuộn overlay sẵn có, đẹp rồi) hoặc người dùng muốn giảm chuyển động thì không cần.
 */
export function shouldUsePerspectiveScrollbar(): boolean {
  if (typeof window === 'undefined' || typeof CSS === 'undefined') return false;
  if (!CSS.supports('perspective', '1px') || !CSS.supports('transform-style', 'preserve-3d')) return false;
  return !window.matchMedia('(pointer: coarse)').matches;
}
