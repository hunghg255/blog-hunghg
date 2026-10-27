/**
 * Gom update realtime theo nhịp (ý tưởng từ Telegram Web A: api/gramjs/provider.ts).
 *
 * - Update từ server (trạng thái online, đang gõ, lượt xem…) dồn vào một mảng, xả theo
 *   throttle 425ms: con số này là trung bình thời lượng animation cuộn khi gửi tin
 *   (250–600ms), để không đổ update vào giữa animation.
 * - Lần đầu sau một khoảng yên lặng thì xả ngay (leading edge), không bắt chờ.
 * - Update "gấp" (tin mới, xoá tin) mở một nhịp MỚI: xả ngay lập tức, các lần xả đã hẹn
 *   của nhịp cũ mang generation cũ nên bị bỏ qua.
 * - Xả ở cuối tick (microtask) để mọi update tới trong cùng một tick đi chung một lần.
 */

export interface BatcherOptions<U> {
  flush: (updates: U[]) => void;
  /** update loại nào cần hiện ngay */
  isUrgent?: (update: U) => boolean;
  /** Telegram: API_UPDATE_THROTTLE = round((250 + 600) / 2) = 425 */
  intervalMs?: number;
}

export function createUpdateBatcher<U>({ flush, isUrgent = () => false, intervalMs = 425 }: BatcherOptions<U>) {
  let pending: U[] = [];
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // có update tới sau lần xả gần nhất của nhịp hiện tại
  let hasTrailing = false;
  let microtaskQueued = false;

  function flushNow(gen: number) {
    if (gen !== generation || pending.length === 0) return;
    const batch = pending;
    pending = [];
    flush(batch);
  }

  /** Xả ở cuối tick hiện tại: update tới cùng tick đi chung một lần. */
  function flushOnTickEnd() {
    if (microtaskQueued) return;
    microtaskQueued = true;
    const gen = generation;
    queueMicrotask(() => {
      microtaskQueued = false;
      flushNow(gen);
    });
  }

  function startWindow() {
    timer = setTimeout(function tick() {
      if (!hasTrailing) {
        timer = undefined; // yên lặng cả một nhịp: dừng hẳn
        return;
      }
      hasTrailing = false;
      flushOnTickEnd();
      timer = setTimeout(tick, intervalMs);
    }, intervalMs);
  }

  function push(update: U) {
    pending.push(update);
    if (isUrgent(update)) {
      // nhịp mới: huỷ lịch cũ, xả ngay ở cuối tick
      generation++;
      clearTimeout(timer);
      timer = undefined;
      hasTrailing = false;
      microtaskQueued = false;
    }
    if (timer === undefined) {
      flushOnTickEnd(); // leading edge
      startWindow();
    } else {
      hasTrailing = true;
    }
  }

  function destroy() {
    clearTimeout(timer);
    timer = undefined;
    pending = [];
    generation++;
  }

  return { push, destroy, getPendingCount: () => pending.length };
}

export type UpdateBatcher<U> = ReturnType<typeof createUpdateBatcher<U>>;
