import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Đoán ý định người dùng từ chuột/bàn phím:
 * - idle: không thao tác gì trong `timeout` ms (ý tưởng từ useIdle của toptal.com)
 * - exit-intent: chuột lao ra mép trên cửa sổ, nơi có thanh tab/nút đóng (usePageLeave của toptal.com)
 * - wiggle: lắc chuột qua lại nhanh (useWiggle của InVision)
 * Mỗi detector là hàm thuần trả về `stop()`, kèm hook React mỏng bên dưới.
 */

// ---------- Idle ----------

export interface IdleOptions {
  timeout: number;
  onIdle: () => void;
  onActive?: () => void;
  events?: readonly string[];
  target?: Document;
}

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;

export function watchIdle({ timeout, onIdle, onActive, events = ACTIVITY_EVENTS, target = document }: IdleOptions) {
  let lastActivity = performance.now();
  let idle = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Không đặt lại timer ở MỖI sự kiện (pointermove bắn ~60 lần/giây): chỉ ghi lại thời điểm.
  // Khi timer hết hạn mới kiểm tra: còn thiếu bao lâu thì hẹn tiếp chừng đó.
  const check = () => {
    const remaining = lastActivity + timeout - performance.now();
    if (remaining > 0) {
      timer = setTimeout(check, remaining);
      return;
    }
    timer = undefined;
    idle = true;
    onIdle();
  };

  const onActivity = () => {
    lastActivity = performance.now();
    if (idle) {
      idle = false;
      onActive?.();
    }
    if (timer === undefined) timer = setTimeout(check, timeout);
  };

  events.forEach((name) => target.addEventListener(name, onActivity, { passive: true, capture: true }));
  timer = setTimeout(check, timeout);

  return () => {
    clearTimeout(timer);
    events.forEach((name) => target.removeEventListener(name, onActivity, { capture: true }));
  };
}

// ---------- Exit intent ----------

export interface ExitIntentOptions {
  onExit: () => void;
  /** chuột rời trang khi còn cách mép trên ≤ sensitivity px mới tính, mặc định 20 */
  sensitivity?: number;
  /** bỏ qua trong vài giây đầu: người dùng vừa vào trang chưa thể "định bỏ đi", mặc định 3000 */
  minTimeOnPage?: number;
  target?: Document;
}

export function watchExitIntent({ onExit, sensitivity = 20, minTimeOnPage = 3000, target = document }: ExitIntentOptions) {
  const start = performance.now();
  const onMouseOut = (event: MouseEvent) => {
    // relatedTarget === null: chuột không sang phần tử nào khác trong trang, tức là ra khỏi cửa sổ
    if (event.relatedTarget !== null) return;
    if (event.clientY > sensitivity) return; // ra cạnh trái/phải/dưới thì thường không phải định đóng tab
    if (performance.now() - start < minTimeOnPage) return;
    onExit();
  };
  target.addEventListener('mouseout', onMouseOut);
  return () => target.removeEventListener('mouseout', onMouseOut);
}

// ---------- Wiggle (lắc chuột) ----------

export interface WiggleOptions {
  onWiggle: () => void;
  /** số lần đổi hướng ngang cần có, mặc định 6 */
  reversals?: number;
  /** trong khoảng thời gian (ms), mặc định 800 */
  window?: number;
  /** mỗi nhịp phải đi được ít nhất bấy nhiêu px, để rung tay không bị tính, mặc định 24 */
  minDistance?: number;
  /** sau khi bắn thì nghỉ bao lâu, mặc định 2000 */
  cooldown?: number;
  target?: EventTarget;
}

export function watchWiggle({
  onWiggle,
  reversals = 6,
  window: windowMs = 800,
  minDistance = 24,
  cooldown = 2000,
  target = document,
}: WiggleOptions) {
  let lastX: number | null = null;
  let direction = 0; // -1 trái, 1 phải
  let travelled = 0; // quãng đường đã đi theo hướng hiện tại
  let times: number[] = []; // thời điểm các lần đổi hướng, chỉ giữ trong cửa sổ trượt
  let quietUntil = 0;

  const onMove = (event: Event) => {
    const { clientX, timeStamp: now } = event as PointerEvent;
    if (lastX === null) {
      lastX = clientX;
      return;
    }
    const dx = clientX - lastX;
    lastX = clientX;
    if (dx === 0) return;
    const dir = Math.sign(dx);
    if (dir === direction) {
      travelled += Math.abs(dx);
      return;
    }
    // Đổi hướng: chỉ tính nếu nhịp vừa rồi đủ dài
    if (direction !== 0 && travelled >= minDistance) {
      times.push(now);
      times = times.filter((t) => now - t <= windowMs);
      if (times.length >= reversals && now >= quietUntil) {
        times = [];
        quietUntil = now + cooldown;
        onWiggle();
      }
    }
    direction = dir;
    travelled = Math.abs(dx);
  };

  target.addEventListener('pointermove', onMove, { passive: true });
  return () => target.removeEventListener('pointermove', onMove);
}

// ---------- React ----------

/** Giữ callback mới nhất trong ref để effect không phải gắn lại listener mỗi lần render. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function useIdle(timeout: number, onIdle: () => void, onActive?: () => void) {
  const idleRef = useLatest(onIdle);
  const activeRef = useLatest(onActive);
  useEffect(
    () => watchIdle({ timeout, onIdle: () => idleRef.current(), onActive: () => activeRef.current?.() }),
    [timeout, idleRef, activeRef],
  );
}

export function useExitIntent(onExit: () => void, options: Omit<ExitIntentOptions, 'onExit'> = {}) {
  const exitRef = useLatest(onExit);
  const { sensitivity, minTimeOnPage } = options;
  useEffect(
    () => watchExitIntent({ onExit: () => exitRef.current(), sensitivity, minTimeOnPage }),
    [sensitivity, minTimeOnPage, exitRef],
  );
}

export function useWiggle(onWiggle: () => void, options: Omit<WiggleOptions, 'onWiggle'> = {}) {
  const wiggleRef = useLatest(onWiggle);
  const { reversals, window: windowMs, minDistance, cooldown, target } = options;
  useEffect(
    () => watchWiggle({ onWiggle: () => wiggleRef.current(), reversals, window: windowMs, minDistance, cooldown, target }),
    [reversals, windowMs, minDistance, cooldown, target, wiggleRef],
  );
}
