/**
 * Cửa sổ video nổi (PiP tự vẽ): kích thước theo tỉ lệ, resize 8 hướng, kéo trong khung, né vật cản —
 * viết lại từ ý tưởng của WhatsApp Web 2020 (module bjegcccgec, dffjiffehg). Không phải mã gốc.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Size {
  width: number;
  height: number;
}

/** Các hằng số giống bản gốc: lề 10px, cạnh dài mặc định 330px, cạnh ngắn tối thiểu 145px. */
export const PIP = { margin: 10, longSide: 330, minSide: 145 } as const;
export const MIN_RATIO = PIP.minSide / PIP.longSide;
export const MAX_RATIO = PIP.longSide / PIP.minSide;

/**
 * Tỉ lệ rộng/cao của khung. Video quá dài hoặc quá dẹt bị kẹp về [145/330, 330/145];
 * khi đó `clamped` = true và phần thừa nên lấp bằng nền mờ (bản gốc làm vậy).
 */
export function pipRatio(video: Size) {
  const raw = video.width > 0 && video.height > 0 ? video.width / video.height : 1;
  const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, raw));
  return { ratio, clamped: ratio !== raw };
}

/** Bề rộng nhỏ nhất: cả hai cạnh đều không dưới minSide. */
export const minWidth = (ratio: number) => Math.max(PIP.minSide, PIP.minSide * ratio);

/** Khung ban đầu: cạnh dài = 330px, đặt ở góc phải dưới của vùng chứa. */
export function initialPipRect(ratio: number, bounds: Size, margin = PIP.margin): Rect {
  const width = ratio > 1 ? PIP.longSide : PIP.longSide * ratio;
  const height = width / ratio;
  return { left: bounds.width - width - margin, top: bounds.height - height - margin, width, height };
}

export type Handle = 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'sw' | 'se';

/**
 * Resize từ một tay nắm, giữ nguyên tỉ lệ. Cạnh/góc đối diện đứng yên.
 * Ở góc, lấy chiều kéo "mạnh" hơn: max(dx, ratio·dy) — kéo chéo hay kéo lệch đều cho cảm giác tự nhiên.
 * Kết quả luôn nằm trong [minWidth, bề rộng lớn nhất còn vừa khung], không bao giờ "kẹt" giữa chừng.
 */
export function resizeFromHandle(start: Rect, handle: Handle, dx: number, dy: number, ratio: number, bounds: Size, margin = PIP.margin): Rect {
  const sx = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
  const sy = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;
  const grow = sx && sy ? Math.max(sx * dx, ratio * sy * dy) : sx ? sx * dx : ratio * sy * dy;

  // điểm neo (cạnh/góc đứng yên) và chỗ trống còn lại theo hướng kéo
  const right = start.left + start.width;
  const bottom = start.top + start.height;
  const roomX = sx < 0 ? right - margin : bounds.width - margin - start.left;
  const roomY = sy < 0 ? bottom - margin : bounds.height - margin - start.top;
  const maxWidth = Math.max(minWidth(ratio), Math.min(roomX, roomY * ratio));

  const width = Math.min(maxWidth, Math.max(minWidth(ratio), start.width + grow));
  const height = width / ratio;
  return {
    left: sx < 0 ? right - width : start.left,
    top: sy < 0 ? bottom - height : start.top,
    width,
    height,
  };
}

/** Kéo khung, kẹp từng trục vào trong vùng chứa (trục nào vượt thì dính vào mép, trục kia vẫn đi). */
export function moveRect(start: Rect, dx: number, dy: number, bounds: Size, margin = PIP.margin): Rect {
  const clamp = (v: number, size: number, total: number) => Math.min(total - size - margin, Math.max(margin, v));
  return {
    ...start,
    left: clamp(start.left + dx, start.width, bounds.width),
    top: clamp(start.top + dy, start.height, bounds.height),
  };
}

export const overlaps = (a: Rect, b: Rect) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

const inside = (r: Rect, bounds: Size, margin: number) =>
  r.left >= margin && r.top >= margin && r.left + r.width <= bounds.width - margin && r.top + r.height <= bounds.height - margin;

export type EscapeSide = 'left' | 'bottom' | 'right' | 'top';

/**
 * Nếu khung đè lên vật cản (menu, hộp thoại), tìm hướng dịch NGẮN nhất để thoát, theo thứ tự ưu tiên
 * trái → dưới → phải → trên khi bằng nhau, bỏ qua hướng làm khung ra ngoài vùng chứa.
 * Trả null nếu không đè hoặc không có hướng nào hợp lệ.
 */
export function escapeOverlap(pip: Rect, obstacle: Rect, bounds: Size, padding = PIP.margin, margin = PIP.margin) {
  if (!overlaps(pip, obstacle)) return null;
  const moves: [EscapeSide, number, number][] = [
    ['left', -(pip.left + pip.width - obstacle.left + padding), 0],
    ['bottom', 0, obstacle.top + obstacle.height - pip.top + padding],
    ['right', obstacle.left + obstacle.width - pip.left + padding, 0],
    ['top', 0, -(pip.top + pip.height - obstacle.top + padding)],
  ];
  let best: { side: EscapeSide; rect: Rect; distance: number } | null = null;
  for (const [side, dx, dy] of moves) {
    const rect = { ...pip, left: pip.left + dx, top: pip.top + dy };
    const distance = Math.abs(dx) + Math.abs(dy);
    if (inside(rect, bounds, margin) && (!best || distance < best.distance)) best = { side, rect, distance };
  }
  return best;
}
