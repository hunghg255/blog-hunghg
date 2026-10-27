/**
 * Chọn vùng crop sao cho giữ được nhiều khuôn mặt nhất (ý tưởng từ PixelzFocus của Facebook).
 *
 * Khi khung hiển thị khác tỉ lệ ảnh, chỉ một trục bị cắt. Trên trục đó ta chỉ thấy được một
 * "cửa sổ" dài `visible` (tính theo tỉ lệ 0..1 của ảnh). Bài toán: đặt cửa sổ ở đâu để chứa
 * nhiều điểm quan tâm (khuôn mặt) nhất, hoà thì chọn chỗ cân lề nhất.
 */

export interface FocusPoint {
  /** 0..1 theo chiều ngang ảnh */
  x: number;
  /** 0..1 theo chiều dọc ảnh */
  y: number;
}

/** Phần nhìn thấy được trên trục bị cắt, 0..1. */
export function visibleFraction(containerRatio: number, imageRatio: number) {
  return containerRatio < imageRatio ? containerRatio / imageRatio : imageRatio / containerRatio;
}

/** Khung "gầy" hơn ảnh -> cắt hai bên trái phải -> focus theo trục x. */
export function cropsHorizontally(containerRatio: number, imageRatio: number) {
  return containerRatio < imageRatio;
}

/** Chỉ số phần tử lớn nhất <= value trong mảng đã sắp xếp (-1 nếu không có). */
export function lastIndexAtMost(sorted: number[], value: number) {
  let low = 0;
  let high = sorted.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] <= value) low = mid + 1;
    else high = mid - 1;
  }
  return high;
}

export interface Window1D {
  low: number;
  high: number;
}

/** Mọi cửa sổ [sorted[i], sorted[i] + visible] chứa nhiều điểm nhất. O(n log n). */
export function biggestWindows(sorted: number[], visible: number): Window1D[] {
  let best: Window1D[] = [];
  let bestCount = 0;
  for (let i = 0; i < sorted.length; i++) {
    const high = lastIndexAtMost(sorted, sorted[i] + visible);
    const count = high - i + 1;
    if (count > bestCount) {
      best = [];
      bestCount = count;
    }
    if (count === bestCount) best.push({ low: i, high });
  }
  return best;
}

/** Hoà số điểm thì chọn cửa sổ mà các điểm cách mép xa nhất (lề nhỏ hơn lớn nhất). */
export function bestWindow(sorted: number[], windows: Window1D[], visible: number): Window1D | null {
  let best: Window1D | null = null;
  let bestMargin = -Infinity;
  for (const w of windows) {
    const first = sorted[w.low];
    const last = sorted[w.high];
    const center = (first + last) / 2;
    const margin = Math.min(first - (center - visible / 2), center + visible / 2 - last);
    if (margin > bestMargin) {
      bestMargin = margin;
      best = w;
    }
  }
  return best;
}

/** Tâm (0..1 theo ảnh) -> giá trị object-position (0..1). */
export function centerToCss(center: number, visible: number) {
  if (Math.abs(1 - visible) < 1e-5) return 0;
  return Math.min(1, Math.max(0, (center - visible / 2) / (1 - visible)));
}

export interface CropFocus {
  /** giá trị object-position, 0..1 mỗi trục */
  css: { x: number; y: number };
  axis: 'x' | 'y';
  visible: number;
  /** tâm cửa sổ theo toạ độ ảnh */
  center: number;
  /** số điểm nằm trong vùng nhìn thấy */
  inView: number;
}

export interface FocusOptions {
  /** true = lặp lại bug của bản gốc: nhánh nhiều điểm trả tâm thay vì giá trị CSS */
  legacyMultiPoint?: boolean;
}

export function computeCropFocus(
  points: FocusPoint[],
  containerRatio: number,
  imageRatio: number,
  { legacyMultiPoint = false }: FocusOptions = {},
): CropFocus {
  const horizontal = cropsHorizontally(containerRatio, imageRatio);
  const axis = horizontal ? 'x' : 'y';
  const visible = visibleFraction(containerRatio, imageRatio);
  // sort số đúng cách; bản gốc gọi .sort() không comparator (so như chuỗi)
  const coords = points.map((p) => p[axis]).sort((a, b) => a - b);

  let center = 0.5;
  if (coords.length > 0) {
    const window = bestWindow(coords, biggestWindows(coords, visible), visible)!;
    center = (coords[window.low] + coords[window.high]) / 2;
  }
  const value = legacyMultiPoint && coords.length > 1 ? center : centerToCss(center, visible);
  const start = value * (1 - visible);
  const inView = coords.filter((c) => c >= start - 1e-9 && c <= start + visible + 1e-9).length;
  return {
    css: horizontal ? { x: value, y: 0.5 } : { x: 0.5, y: value },
    axis,
    visible,
    center,
    inView,
  };
}

export type Rotation = 0 | 90 | 180 | 270;

/**
 * Đổi toạ độ trên ảnh ĐÃ XOAY (theo chiều kim đồng hồ) về toạ độ ảnh gốc.
 * width/height là kích thước ảnh gốc. Chỉ hoán vị và trừ cạnh, không sin/cos.
 * (rotationCoordinateTransform của Facebook dùng đúng bảng này.)
 */
export function toOriginalCoordinates(x: number, y: number, angle: Rotation, width: number, height: number) {
  switch (angle) {
    case 90:
      return { x: y, y: height - x };
    case 180:
      return { x: width - x, y: height - y };
    case 270:
      return { x: width - y, y: x };
    default:
      return { x, y };
  }
}
