/**
 * Polling thưa dần (decaying interval), viết lại từ Trello (`packages/time/src/decayingInterval.ts`,
 * và bản cũ `app/scripts/lib/util/decaying-interval.js`).
 *
 * Mặc định của Trello: 6 lần mỗi 10 giây, rồi 10 lần mỗi 1 phút, rồi DỪNG. Khi đã sang nhịp
 * chậm, chỉ cần người dùng rê chuột là bắt đầu lại từ nhịp nhanh. Người đang nhìn màn hình
 * thì thấy dữ liệu mới; tab bỏ quên thì gần như không tốn request nào.
 *
 * Bản này giữ ý tưởng, sửa và thêm:
 * - huỷ được cả lúc đang chờ requestAnimationFrame (bản gốc không giữ id của rAF);
 * - chờ `fn` (async) xong mới hẹn lần sau, không bao giờ chồng request;
 * - "người dùng quay lại" tính cả bàn phím, chạm, focus, và tab hiện lại (không chỉ mousemove);
 * - tab bị ẩn thì tạm dừng hẳn bằng visibilitychange (bản gốc dựa vào việc rAF không chạy khi tab ẩn).
 */

export interface DecayStep {
  iterations: number;
  /** ms giữa 2 lần gọi */
  every: number;
}

export interface DecayingIntervalOptions {
  steps?: DecayStep[];
  /** sự kiện coi là "người dùng quay lại", reset về nhịp nhanh */
  wakeEvents?: Array<keyof DocumentEventMap>;
  /** gọi fn ngay khi được đánh thức (thay vì chờ hết khoảng đầu tiên) */
  runOnWake?: boolean;
  /** để demo/test tua nhanh */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export const TRELLO_STEPS: DecayStep[] = [
  { iterations: 6, every: 10_000 },
  { iterations: 10, every: 60_000 },
];

export type DecayPhase = 'fast' | 'slow' | 'stopped' | 'hidden' | 'cancelled';

export interface DecayingInterval {
  cancel(): void;
  /** về lại nhịp nhanh, như khi người dùng vừa rê chuột */
  wake(): void;
  phase(): DecayPhase;
  /** ms tới lần gọi kế tiếp (undefined nếu đang dừng) */
  nextDelay(): number | undefined;
}

export function decayingInterval(
  fn: () => unknown,
  {
    steps = TRELLO_STEPS,
    wakeEvents = ['mousemove', 'keydown', 'pointerdown', 'focusin'],
    runOnWake = false,
    setTimer = (f, ms) => window.setTimeout(f, ms),
    clearTimer = (id) => window.clearTimeout(id as number),
  }: DecayingIntervalOptions = {},
): DecayingInterval {
  const fastest = Math.min(...steps.map((s) => s.every));
  let queue: number[] = [];
  let timer: unknown;
  let cancelled = false;
  let listening = false;
  let current: number | undefined;
  let state: DecayPhase = 'fast';
  let inFlight = false; // fn đang chạy (async): không hẹn lần mới chồng lên

  const listen = (on: boolean) => {
    if (on === listening) return;
    listening = on;
    for (const type of wakeEvents) {
      if (on) document.addEventListener(type, onWake, { passive: true, capture: true });
      else document.removeEventListener(type, onWake, { capture: true });
    }
  };

  function schedule() {
    clearTimer(timer);
    timer = undefined;
    current = queue.shift();
    if (current === undefined) {
      state = 'stopped';
      listen(true); // hết lượt: chỉ dậy khi người dùng quay lại
      return;
    }
    state = current > fastest ? 'slow' : 'fast';
    // đang ở nhịp chậm thì mới cần nghe chuột (nhịp nhanh rồi thì reset cũng vô nghĩa)
    listen(state === 'slow');
    timer = setTimer(async () => {
      timer = undefined;
      inFlight = true;
      try {
        await fn();
      } finally {
        inFlight = false;
        if (!cancelled && state !== 'hidden') schedule();
      }
    }, current);
  }

  function restart() {
    queue = steps.flatMap(({ iterations, every }) => Array<number>(iterations).fill(every));
    // fn đang chạy thì chỉ nạp lại lịch; `finally` ở trên sẽ hẹn lần kế tiếp khi fn xong
    if (!inFlight) schedule();
  }

  function onWake() {
    if (cancelled || state === 'fast' || state === 'hidden') return;
    if (runOnWake) void fn();
    restart();
  }

  const onVisibility = () => {
    if (cancelled) return;
    if (document.visibilityState === 'hidden') {
      clearTimer(timer);
      timer = undefined;
      state = 'hidden';
      listen(false);
    } else if (state === 'hidden') {
      // vừa quay lại tab: dữ liệu có thể đã cũ, coi như người dùng vừa thức dậy
      state = 'stopped';
      onWake();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  restart();

  return {
    cancel() {
      cancelled = true;
      state = 'cancelled';
      clearTimer(timer);
      listen(false);
      document.removeEventListener('visibilitychange', onVisibility);
    },
    wake: () => {
      if (state === 'fast') restart();
      else onWake();
    },
    phase: () => state,
    nextDelay: () => (state === 'fast' || state === 'slow' ? current : undefined),
  };
}
