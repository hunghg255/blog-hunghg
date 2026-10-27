/**
 * Mô phỏng vòng lặp của KeyframesLoop bản gốc để so sánh: gọi rAF tiếp SAU khi forEach xong,
 * nên một callback ném lỗi làm vòng lặp dừng hẳn và mọi animation đứng hình.
 */
const set = new Set<{ cb: (delta: number) => void; prev: number }>();
export const fbLoopStats = { stopped: false };

function k() {
  if (set.size > 0) {
    const now = performance.now();
    try {
      set.forEach((a) => {
        a.cb(Math.min(now - (a.prev || now), 1000));
        a.prev = now;
      });
      requestAnimationFrame(k);
    } catch (error) {
      // bản gốc không có try/catch: lỗi bay lên window.onerror và không có rAF nào được hẹn nữa.
      // Ở đây bắt lại chỉ để demo không in lỗi đỏ, hành vi "vòng lặp chết" giữ nguyên.
      fbLoopStats.stopped = true;
      console.warn('[mô phỏng bản gốc] vòng lặp dừng vì lỗi:', (error as Error).message);
    }
  }
}

export function fbStart(cb: (delta: number) => void) {
  const entry = { cb, prev: performance.now() };
  if (set.size === 0) requestAnimationFrame(k);
  set.add(entry);
  return () => set.delete(entry);
}

export function fbReset() {
  set.clear();
  fbLoopStats.stopped = false;
}
