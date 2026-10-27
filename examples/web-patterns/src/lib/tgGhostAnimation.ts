/**
 * "Ghost animation" khi mở/đóng trình xem ảnh, theo ý tưởng của Telegram Web A
 * (components/mediaViewer/helpers/ghostAnimation.ts):
 *
 * Ảnh nhỏ trong danh sách và ảnh lớn trong viewer là HAI cây DOM khác nhau, không thể animate
 * một phần tử từ cây này sang cây kia. Cách làm: tạo một phần tử "ma" (ghost) chứa ảnh, đặt sẵn
 * ở vị trí ĐÍCH với kích thước đích, rồi dùng transform đưa nó về trông như đang nằm ở vị trí
 * NGUỒN (FLIP). Frame sau bỏ transform: trình duyệt tự chạy transition. Xong thì xoá ghost.
 */

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type GhostShape = 'rounded' | 'circle' | 'cover' | 'none';

export interface GhostOptions {
  durationMs?: number;
  endDelayMs?: number;
  /** hình dạng của ảnh nguồn (bo góc, tròn, bị crop object-fit: cover) */
  shape?: GhostShape;
  /** z-index của ghost, phải nằm trên viewer */
  zIndex?: number;
}

const GHOST_CLASS = 'tg-ghost';

/**
 * Ảnh nguồn hiển thị kiểu `object-fit: cover` trong ô vuông thì bị cắt mất một phần. Nếu bay từ
 * khung ô vuông đó, ảnh sẽ méo trong lúc bay. `uncover` mở rộng khung nguồn ra đúng tỉ lệ thật của
 * ảnh, căn giữa quanh ô (phần thừa nằm ngoài ô, đúng như phần bị crop).
 */
export function uncover(source: Rect, realWidth: number, realHeight: number): Rect {
  const ratio = realWidth / realHeight;
  let { top, left, width, height } = source;
  if (ratio > width / height) {
    const newWidth = height * ratio;
    left -= (newWidth - width) / 2;
    width = newWidth;
  } else {
    const newHeight = width / ratio;
    top -= (newHeight - height) / 2;
    height = newHeight;
  }
  return { top, left, width, height };
}

/** Transform đưa một khung đặt ở `to` trông như đang nằm ở `from` (căn theo tâm). */
export function getFlipTransform(from: Rect, to: Rect) {
  const translateX = from.left + from.width / 2 - (to.left + to.width / 2);
  const translateY = from.top + from.height / 2 - (to.top + to.height / 2);
  const scaleX = from.width / to.width;
  const scaleY = from.height / to.height;
  return `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY})`;
}

/** Kích thước lớn nhất giữ tỉ lệ, vừa trong vùng khả dụng (giống calculateDimensions của Telegram). */
export function fitInto(realWidth: number, realHeight: number, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / realWidth, maxHeight / realHeight, 1);
  return { width: realWidth * scale, height: realHeight * scale };
}

function createGhost(src: string, rect: Rect, zIndex: number) {
  const ghost = document.createElement('div');
  ghost.className = GHOST_CLASS;
  Object.assign(ghost.style, {
    position: 'fixed',
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    zIndex: String(zIndex),
    overflow: 'hidden',
    pointerEvents: 'none',
    willChange: 'transform, opacity',
  });
  const img = new Image();
  img.src = src;
  img.alt = '';
  Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'block' });
  ghost.appendChild(img);
  return ghost;
}

function applyShape(ghost: HTMLElement, shape: GhostShape) {
  ghost.style.borderRadius = shape === 'circle' ? '50%' : shape === 'rounded' ? '12px' : '0';
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/** Ghost đang bay (nếu có): đóng viewer giữa lúc đang mở thì dùng lại nó thay vì tạo mới. */
function findFlyingGhost() {
  return document.querySelector<HTMLElement>(`.${GHOST_CLASS}`);
}

export interface OpenParams {
  src: string;
  /** khung ảnh nguồn trên màn hình */
  from: Rect;
  /** khung ảnh lớn trong viewer */
  to: Rect;
  /** kích thước thật của ảnh, dùng để "uncover" khi nguồn bị crop */
  natural: { width: number; height: number };
}

export async function animateOpening({ src, from, to, natural }: OpenParams, options: GhostOptions = {}) {
  const { durationMs = 200, endDelayMs = 100, shape = 'cover', zIndex = 1000 } = options;
  const source = shape === 'cover' ? uncover(from, natural.width, natural.height) : from;

  findFlyingGhost()?.remove();
  const ghost = createGhost(src, to, zIndex);
  ghost.style.transform = getFlipTransform(source, to);
  applyShape(ghost, shape);

  document.body.classList.add('tg-ghost-animating');
  await nextFrame();
  document.body.appendChild(ghost);
  await nextFrame();
  ghost.style.transition = `transform ${durationMs}ms ease, opacity ${durationMs}ms ease, border-radius ${durationMs}ms ease`;
  ghost.style.transform = '';
  applyShape(ghost, 'none');

  await new Promise((resolve) => setTimeout(resolve, durationMs + endDelayMs));
  await nextFrame();
  // chỉ dọn nếu ghost này chưa bị lượt đóng lấy đi
  if (ghost.dataset.taken !== '1') {
    ghost.remove();
    document.body.classList.remove('tg-ghost-animating');
  }
}

export interface CloseParams {
  src: string;
  /** khung ảnh lớn đang hiển thị trong viewer */
  from: Rect;
  /** khung ảnh nguồn (có thể đã bị cuộn khỏi màn hình) */
  to: Rect;
  /** vùng nhìn thấy của danh sách chứa ảnh nguồn; mặc định là cả cửa sổ */
  viewport?: Rect;
}

export type CloseMode = 'return' | 'fly-off-top' | 'fly-off-bottom' | 'fade';

/** Quyết định cách đóng: về đúng chỗ, bay ra mép trên/dưới, hay mờ dần (ảnh chỉ thấy một phần). */
export function getCloseMode(target: Rect, viewport: Rect): CloseMode {
  const bottom = target.top + target.height;
  const viewportBottom = viewport.top + viewport.height;
  if (bottom <= viewport.top) return 'fly-off-top';
  if (target.top >= viewportBottom) return 'fly-off-bottom';
  if (target.top < viewport.top || bottom > viewportBottom) return 'fade';
  return 'return';
}

export async function animateClosing({ src, from, to, viewport }: CloseParams, options: GhostOptions = {}) {
  const { durationMs = 200, endDelayMs = 100, shape = 'cover', zIndex = 1000 } = options;
  const area = viewport ?? { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
  const mode = getCloseMode(to, area);

  let target = to;
  if (mode === 'fly-off-top') target = { ...to, top: area.top - to.height };
  if (mode === 'fly-off-bottom') target = { ...to, top: area.top + area.height };

  const existing = findFlyingGhost();
  let ghost: HTMLElement;

  if (existing) {
    // Đang mở dở mà người dùng đóng ngay: lấy vị trí HIỆN TẠI của ghost (đang ở giữa đường bay),
    // tắt transition, đặt lại khung đích mới rồi bay tiếp từ đó. Không có cú nhảy về điểm đầu.
    existing.dataset.taken = '1';
    ghost = existing;
    const current = existing.getBoundingClientRect();
    Object.assign(ghost.style, {
      transition: 'none',
      top: `${target.top}px`,
      left: `${target.left}px`,
      width: `${target.width}px`,
      height: `${target.height}px`,
      transformOrigin: 'top left',
      transform: `translate3d(${current.left - target.left}px, ${current.top - target.top}px, 0) scale(${
        current.width / target.width
      }, ${current.height / target.height})`,
    });
  } else {
    ghost = createGhost(src, target, zIndex);
    // ảnh lớn có thể có tỉ lệ khác khung đích (bị crop): giữ tỉ lệ bằng cách lấy scale nhỏ hơn
    const scale = Math.min(from.width / target.width, from.height / target.height);
    const fromFitted = {
      width: target.width * scale,
      height: target.height * scale,
      left: from.left + (from.width - target.width * scale) / 2,
      top: from.top + (from.height - target.height * scale) / 2,
    };
    ghost.style.transform = getFlipTransform(fromFitted, target);
    document.body.appendChild(ghost);
  }

  document.body.classList.add('tg-ghost-animating');
  await nextFrame();
  await nextFrame();
  ghost.style.transition = `transform ${durationMs}ms ease, opacity ${durationMs}ms ease, border-radius ${durationMs}ms ease`;
  ghost.style.transform = '';
  if (mode === 'fade') ghost.style.opacity = '0';
  // về hình dạng của ảnh nguồn (ảnh crop trong ô vuông thì góc vuông)
  applyShape(ghost, shape === 'cover' ? 'none' : shape);

  await new Promise((resolve) => setTimeout(resolve, durationMs + endDelayMs));
  await nextFrame();
  ghost.remove();
  document.body.classList.remove('tg-ghost-animating');
  return mode;
}
