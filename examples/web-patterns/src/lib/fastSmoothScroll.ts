/**
 * Cuộn mượt tới một phần tử, nhưng KHÔNG BAO GIỜ lâu: nếu đích ở quá xa thì "dịch chuyển tức thời"
 * tới gần đích trước, rồi mới animate đoạn cuối. Ý tưởng từ src/util/fastSmoothScroll.ts của
 * Telegram Web (web.telegram.org/a).
 */

export type ScrollPosition = 'start' | 'center' | 'end' | 'centerOrTop';

export interface FastSmoothScrollOptions {
  position?: ScrollPosition;
  /** khoảng chừa ra ở mép (px) */
  margin?: number;
  /** quãng đường animate tối đa; xa hơn thì nhảy tức thời phần dư. Telegram: 1500px */
  maxDistance?: number;
  /** ép thời lượng (ms); 0 = nhảy thẳng, không animate */
  duration?: number;
  /** người dùng tự cuộn (wheel/touch/phím) thì dừng animation, mặc định true */
  abortOnUserInput?: boolean;
}

const MIN_DURATION = 250;
const MAX_DURATION = 600;
const SHORT_TRANSITION_MAX_DISTANCE = 500;

// easeOutQuint cho quãng dài, "easeOut 3.5" cho quãng ngắn (đúng công thức của Telegram)
const longTransition = (t: number) => 1 - (1 - t) ** 5;
const shortTransition = (t: number) => 1 - (1 - t) ** 3.5;

/** Vị trí của element tính theo hệ toạ độ nội dung của container (không phụ thuộc offsetParent). */
function offsetWithin(container: HTMLElement, element: HTMLElement) {
  return element.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientTop + container.scrollTop;
}

/** Điểm xuất phát: nếu đích cách xa hơn maxDistance thì nhảy tới cách đích đúng maxDistance. */
export function calculateScrollFrom(scrollTop: number, elementTop: number, maxDistance: number) {
  const offset = elementTop - scrollTop;
  if (offset < -maxDistance) return scrollTop + (offset + maxDistance);
  if (offset > maxDistance) return scrollTop + (offset - maxDistance);
  return scrollTop;
}

/** Thời lượng tăng tuyến tính theo quãng đường: 0px → 250ms, ≥ maxDistance → 600ms. */
export function durationFor(distance: number, maxDistance: number) {
  const ratio = Math.min(Math.abs(distance) / maxDistance, 1);
  return MIN_DURATION + ratio * (MAX_DURATION - MIN_DURATION);
}

export interface ScrollAnimation {
  /** resolve true khi tới đích, false khi bị huỷ (animation khác chen vào, người dùng tự cuộn) */
  finished: Promise<boolean>;
  cancel(): void;
  /** quãng đường được "dịch chuyển tức thời" (px), để demo/đo đạc */
  teleported: number;
}

const USER_INPUT_EVENTS = ['wheel', 'touchstart', 'keydown'] as const;

// Mỗi container chỉ có một animation: animation mới huỷ animation cũ (Telegram: animateSingle)
const running = new WeakMap<HTMLElement, () => void>();

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function fastSmoothScroll(
  container: HTMLElement,
  element: HTMLElement,
  {
    position = 'start',
    margin = 0,
    maxDistance = 1500,
    duration,
    abortOnUserInput = true,
  }: FastSmoothScrollOptions = {},
): ScrollAnimation {
  running.get(container)?.();

  const elementTop = offsetWithin(container, element);
  const elementHeight = element.offsetHeight;
  const containerHeight = container.clientHeight;
  const maxScrollTop = container.scrollHeight - containerHeight;
  const scrollFrom = Math.min(
    Math.max(calculateScrollFrom(container.scrollTop, elementTop, maxDistance), 0),
    maxScrollTop,
  );
  const teleported = Math.abs(scrollFrom - container.scrollTop);
  if (teleported > 0) container.scrollTop = scrollFrom; // bước 1: nhảy tức thời phần dư

  let path: number;
  switch (position) {
    case 'start':
      path = elementTop - margin - scrollFrom;
      break;
    case 'end':
      path = elementTop + elementHeight + margin - (scrollFrom + containerHeight);
      break;
    case 'center':
    case 'centerOrTop':
      // element cao hơn khung nhìn thì căn đầu element thay vì căn giữa
      path =
        position === 'center' || elementHeight < containerHeight
          ? elementTop + elementHeight / 2 - (scrollFrom + containerHeight / 2)
          : elementTop - margin - scrollFrom;
      break;
  }

  // không cuộn quá mép trên/dưới, nếu không animation sẽ "chạy không" ở cuối
  path = Math.max(-scrollFrom, Math.min(path, maxScrollTop - scrollFrom));
  const target = scrollFrom + path;

  const ms = prefersReducedMotion() ? 0 : (duration ?? durationFor(path, maxDistance));
  if (path === 0 || ms === 0) {
    container.scrollTop = target;
    return { finished: Promise.resolve(true), cancel() {}, teleported };
  }

  const ease = Math.abs(path) < SHORT_TRANSITION_MAX_DISTANCE ? shortTransition : longTransition;
  let frame = 0;
  let resolve!: (done: boolean) => void;
  const finished = new Promise<boolean>((r) => (resolve = r));

  const stop = (done: boolean) => {
    cancelAnimationFrame(frame);
    if (running.get(container) === cancel) running.delete(container);
    if (abortOnUserInput) USER_INPUT_EVENTS.forEach((type) => container.removeEventListener(type, onUserInput));
    resolve(done);
  };
  const cancel = () => stop(false);
  const onUserInput = () => cancel();

  if (abortOnUserInput) {
    USER_INPUT_EVENTS.forEach((type) => container.addEventListener(type, onUserInput, { passive: true }));
  }
  running.set(container, cancel);

  let start: number | undefined;
  const tick = (now: number) => {
    start ??= now;
    const t = Math.min((now - start) / ms, 1);
    // vị trí = đích - phần đường còn lại; làm tròn để tránh scrollTop lẻ gây rung chữ
    container.scrollTop = Math.round(target - path * (1 - ease(t)));
    if (t < 1) frame = requestAnimationFrame(tick);
    else stop(true);
  };
  frame = requestAnimationFrame(tick);

  return { finished, cancel, teleported };
}
