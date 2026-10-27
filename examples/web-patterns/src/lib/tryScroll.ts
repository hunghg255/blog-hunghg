/**
 * Khôi phục vị trí cuộn khi trang còn đang tải dần (ý tưởng từ try-scroll.ts của apps.apple.com)
 * và skip link kiểm tra focus thật (ý tưởng từ a11yUtils.js của Zappos).
 */

export interface ScrollableElement {
  scrollTop: number;
  scrollHeight: number;
  /** chiều cao khung nhìn của phần tử cuộn; window thì dùng innerHeight */
  clientHeight: number;
}

export type RestoreResult = 'restored' | 'gave-up' | 'missing' | 'cancelled';

export interface RestoreOptions {
  /** chờ tối đa bao lâu (ms). Apple dùng 100 frame, tức ~1,6 giây ở 60Hz nhưng chỉ ~0,8 giây ở 120Hz */
  timeout?: number;
  /** sai số cho phép (px): nội dung lazy-load có thể làm trang cao thêm vài px, bản gốc dùng 16 */
  tolerance?: number;
  signal?: AbortSignal;
  /** gọi mỗi frame phải chờ, để log/hiển thị */
  onWait?: (info: { frame: number; scrollHeight: number; needed: number }) => void;
}

// Mỗi phần tử cuộn chỉ có một lần khôi phục đang chạy: back liên tiếp thì lần sau thay lần trước.
const pending = new WeakMap<object, AbortController>();

export function restoreScroll(
  getElement: () => ScrollableElement | null,
  targetY: number,
  { timeout = 1600, tolerance = 16, signal, onWait }: RestoreOptions = {},
): Promise<RestoreResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve('cancelled');
    const first = getElement();
    if (!first) return resolve('missing');

    pending.get(first)?.abort();
    const controller = new AbortController();
    pending.set(first, controller);
    const onAbort = () => {
      cancelAnimationFrame(frameId);
      resolve('cancelled');
    };
    controller.signal.addEventListener('abort', onAbort, { once: true });
    signal?.addEventListener('abort', () => controller.abort(), { once: true });

    const start = performance.now();
    let frame = 0;
    let frameId = 0;

    const tick = () => {
      frame++;
      const element = getElement();
      if (!element) return finish('missing');
      const { scrollHeight, clientHeight } = element;
      // Chỉ cuộn khi đặt scrollTop = targetY vẫn còn đủ một màn hình nội dung phía dưới.
      // Đặt sớm hơn thì trình duyệt kẹp scrollTop về (scrollHeight - clientHeight) và vị trí bị mất.
      const needed = targetY + clientHeight;
      if (needed <= scrollHeight + tolerance) {
        element.scrollTop = targetY;
        return finish('restored');
      }
      if (performance.now() - start >= timeout) return finish('gave-up');
      onWait?.({ frame, scrollHeight, needed });
      frameId = requestAnimationFrame(tick);
    };

    const finish = (result: RestoreResult) => {
      controller.signal.removeEventListener('abort', onAbort);
      if (pending.get(first) === controller) pending.delete(first);
      resolve(result);
    };

    frameId = requestAnimationFrame(tick);
  });
}

/** Người dùng tự cuộn/chạm trong lúc đang chờ: thôi khôi phục, đừng giật trang của họ. */
export function cancelOnUserScroll(target: EventTarget): AbortController {
  const controller = new AbortController();
  const stop = () => controller.abort();
  for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) {
    target.addEventListener(type, stop, { once: true, passive: true, signal: controller.signal });
  }
  return controller;
}

/**
 * Lưu vị trí cuộn theo từng mục lịch sử (history entry). Apple giữ tối đa 10 mục trong một LRU.
 * Id nằm trong history.state nên reload trang vẫn còn; map vị trí thì nằm trong bộ nhớ.
 */
export function createScrollHistory(getElement: () => ScrollableElement | null, limit = 10) {
  const positions = new Map<string, number>();
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const remember = (id: string, y: number) => {
    positions.delete(id);
    positions.set(id, y);
    // Map giữ thứ tự chèn: phần tử đầu là cũ nhất
    while (positions.size > limit) positions.delete(positions.keys().next().value!);
  };
  const currentId = () => (history.state as { scrollId?: string } | null)?.scrollId;

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (!currentId()) history.replaceState({ ...(history.state ?? {}), scrollId: newId() }, '');

  return {
    /** gọi ngay trước khi chuyển trang (pushState) */
    saveCurrent() {
      const id = currentId();
      const el = getElement();
      if (id && el) remember(id, el.scrollTop);
    },
    push(state: Record<string, unknown> = {}, url?: string) {
      this.saveCurrent();
      history.pushState({ ...state, scrollId: newId() }, '', url);
      const el = getElement();
      if (el) el.scrollTop = 0;
    },
    /** gọi trong popstate, sau khi đã bắt đầu render trang cũ */
    restore(options?: RestoreOptions) {
      const id = currentId();
      const y = id ? positions.get(id) : undefined;
      if (y === undefined) return Promise.resolve('missing' as RestoreResult);
      return restoreScroll(getElement, y, options);
    },
  };
}

// ---------- skip link (Zappos) ----------

const TABBABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus vào phần tử đầu tiên TRONG container mà thật sự nhận được focus.
 * Thay vì tự đoán (display:none? visibility? inert? nằm trong <details> đóng?), cứ thử focus()
 * rồi hỏi lại document.activeElement: trình duyệt là bên biết chắc nhất.
 */
export function focusFirstReachable(container: HTMLElement): HTMLElement | null {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(TABBABLE));
  if (container.matches(TABBABLE)) candidates.unshift(container);
  for (const el of candidates) {
    el.focus({ preventScroll: true });
    if (document.activeElement === el) {
      el.scrollIntoView({ block: 'nearest' });
      return el;
    }
  }
  // Không có gì focus được (bản gốc dừng ở đây, người dùng bàn phím vẫn ở đầu trang):
  // cho chính container nhận focus bằng tabindex="-1", Tab tiếp theo sẽ đi từ đây.
  if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
  container.focus({ preventScroll: true });
  container.scrollIntoView({ block: 'start' });
  return document.activeElement === container ? container : null;
}

/** Gắn cho mọi skip link trong trang: <a href="#main" data-skip-link>. */
export function handleSkipLinkClick(event: MouseEvent, root: ParentNode = document) {
  const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#"]');
  if (!link) return;
  const id = decodeURIComponent(link.hash.slice(1));
  // getElementById: id bắt đầu bằng số hay có ký tự đặc biệt vẫn đúng, querySelector(`#${id}`) thì không
  const target = 'getElementById' in root ? (root as Document).getElementById(id) : root.querySelector(`[id="${CSS.escape(id)}"]`);
  if (!(target instanceof HTMLElement)) return;
  event.preventDefault();
  focusFirstReachable(target);
}
