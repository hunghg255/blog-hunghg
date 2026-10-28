/**
 * Hình học cho trình soạn ảnh quảng cáo (ý tưởng từ AdsImageCoordinatesUtils,
 * AdsImageAspectRatioUtils, AdsInteractiveComponentPositionUtils của Facebook Ads Manager):
 * crop giữa ảnh theo tỉ lệ, khớp tỉ lệ với danh sách kích thước chuẩn, và giữ sticker đã xoay
 * nằm trong vùng an toàn của khung.
 * Khác bản gốc: dung sai tỉ lệ tương đối và sắp theo độ gần (bản gốc ±0.01 tuyệt đối, trả tập không thứ tự),
 * dung sai vị trí tuyệt đối và đối xứng, quét khoảng hợp lệ quanh giá trị hiện tại.
 */

export interface Size {
  width: number;
  height: number;
}
export interface Rect extends Size {
  x: number;
  y: number;
}
export type Point = [number, number];

/** Vùng lớn nhất có tỉ lệ `ratio` (rộng/cao) đặt giữa ảnh, toạ độ pixel nguyên. */
export function centerCrop(image: Size, ratio: number): Rect {
  if (!(ratio > 0)) return { x: 0, y: 0, ...image };
  let width: number;
  let height: number;
  if (image.width / image.height > ratio) {
    height = image.height; // ảnh "bè" hơn tỉ lệ: giữ trọn chiều cao, cắt hai bên
    width = Math.min(image.width, Math.round(height * ratio));
  } else {
    width = image.width;
    height = Math.min(image.height, Math.round(width / ratio));
  }
  // phần dư lẻ 1px dồn về phải/dưới, giống bản gốc
  return {
    x: Math.floor((image.width - width) / 2),
    y: Math.floor((image.height - height) / 2),
    width,
    height,
  };
}

/**
 * Khớp tỉ lệ với các khoá chuẩn ('191x100' → 1.91), dung sai TƯƠNG ĐỐI.
 * Trả theo độ gần, khoá gần nhất đứng đầu.
 */
export function matchCropKeys(ratio: number, keys: readonly string[], tolerance = 0.005) {
  return keys
    .map((key) => {
      const [w, h] = key.split('x').map(Number);
      return { key, error: Math.abs(ratio / (w / h) - 1) };
    })
    .filter((m) => m.error <= tolerance)
    .sort((a, b) => a.error - b.error)
    .map((m) => m.key);
}

/** Đổi crop từ hệ toạ độ ảnh này sang ảnh khác (ảnh gốc ↔ ảnh xem trước thu nhỏ). */
export function scaleCrop(crop: Rect, from: Size, to: Size): Rect | null {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  if (!(sx > 0 && sy > 0)) return null;
  return { x: crop.x * sx, y: crop.y * sy, width: crop.width * sx, height: crop.height * sy };
}

/**
 * Bốn góc của sticker xoay quanh tâm của nó, toạ độ chuẩn hoá theo khung (x theo chiều rộng,
 * y theo chiều cao). `width` là tỉ lệ so với chiều rộng khung, `turns` là số vòng (0.25 = 90°).
 * Xoay phải làm trong không gian pixel: khung 9:16 không vuông, xoay thẳng trên toạ độ chuẩn
 * hoá sẽ làm méo hình.
 */
export function rotatedCorners(turns: number, width: number, aspect: number, frame: Size): Point[] {
  const w = width * frame.width;
  const h = w * aspect; // aspect = cao/rộng của sticker
  const angle = 2 * Math.PI * turns;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners: Point[] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  return corners.map(([x, y]) => [
    (cos * x - sin * y) / frame.width,
    (sin * x + cos * y) / frame.height,
  ]);
}

export interface Placement {
  /** tâm sticker, chuẩn hoá 0..1 */
  x: number;
  y: number;
  width: number;
  turns: number;
}

export interface PlacementRules {
  frame: Size;
  aspect: number;
  safeX: [number, number];
  safeY: [number, number];
  widthRange: [number, number];
  turnsRange: [number, number];
  /** dung sai tuyệt đối, cùng một giá trị ở hai đầu khoảng */
  epsilon?: number;
}

const within = (v: number, [lo, hi]: [number, number], eps: number) =>
  v >= lo - eps && v <= hi + eps;

export function isValidPlacement(p: Placement, rules: PlacementRules) {
  const eps = rules.epsilon ?? 0.001;
  if (!within(p.width, rules.widthRange, eps) || !within(p.turns, rules.turnsRange, eps))
    return false;
  const corners = rotatedCorners(p.turns, p.width, rules.aspect, rules.frame);
  return corners.every(
    ([cx, cy]) => within(p.x + cx, rules.safeX, eps) && within(p.y + cy, rules.safeY, eps),
  );
}

/** Khoảng tâm hợp lệ theo một trục: tính thẳng từ hộp bao của các góc, không cần quét. */
export function centerRange(
  p: Placement,
  rules: PlacementRules,
  axis: 0 | 1,
): [number, number] | null {
  const values = rotatedCorners(p.turns, p.width, rules.aspect, rules.frame).map((c) => c[axis]);
  const [lo, hi] = axis === 0 ? rules.safeX : rules.safeY;
  const range: [number, number] = [lo - Math.min(...values), hi - Math.max(...values)];
  return range[0] <= range[1] ? range : null;
}

/**
 * Quét [lo, hi] theo bước `step`, trả đoạn hợp lệ liền mạch GẦN `current` nhất
 * (bản gốc trả đoạn đầu tiên, và trả cả khoảng [lo, lo] khi lo = hi dù không hợp lệ).
 */
export function scanRange(
  lo: number,
  hi: number,
  step: number,
  current: number,
  valid: (v: number) => boolean,
) {
  const runs: [number, number][] = [];
  let start: number | null = null;
  const n = Math.round((hi - lo) / step);
  for (let i = 0; i <= n; i++) {
    const v = +(lo + i * step).toFixed(6);
    if (valid(v)) start ??= v;
    else if (start !== null) {
      runs.push([start, +(v - step).toFixed(6)]);
      start = null;
    }
  }
  if (start !== null) runs.push([start, hi]);
  if (!runs.length) return null;
  const distance = ([a, b]: [number, number]) =>
    current < a ? a - current : current > b ? current - b : 0;
  return runs.reduce((best, run) => (distance(run) < distance(best) ? run : best));
}
