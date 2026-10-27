import { useSyncExternalStore } from 'react';

/**
 * Trạng thái mạng "đáng tin" hơn navigator.onLine (ý tưởng từ NetworkStatusImpl + NetworkHeartbeat).
 *
 * - navigator.onLine chỉ biết máy có kết nối tới router hay không, không biết có ra được
 *   Internet / tới server của mình hay không.
 * - Khi nghi ngờ (sự kiện offline, request lỗi nhiều), ta gọi một endpoint heartbeat nhỏ.
 *   Lỗi thì thử lại với exponential backoff, tới khi thành công thì báo online.
 */

export type HeartbeatEvent =
  | { type: 'heartbeat-start' }
  | { type: 'heartbeat-ok' }
  | { type: 'heartbeat-fail'; attempt: number; retryIn: number }
  /** hệ điều hành báo offline (navigator.onLine = false): ngừng ping, chờ sự kiện `online` */
  | { type: 'heartbeat-paused' };

export interface NetworkStatusOptions {
  heartbeatUrl: string;
  fetchImpl?: typeof fetch;
  initialDelay?: number;
  maxDelay?: number;
  timeout?: number;
  /** cửa sổ thời gian để tính tỉ lệ lỗi */
  windowMs?: number;
  onHeartbeat?: (event: HeartbeatEvent) => void;
}

export function createNetworkStatus({
  heartbeatUrl,
  fetchImpl = (...args) => fetch(...args),
  initialDelay = 100,
  maxDelay = 6400,
  timeout = 5000,
  windowMs = 5000,
  onHeartbeat,
}: NetworkStatusOptions) {
  let online = typeof navigator === 'undefined' ? true : navigator.onLine;
  const listeners = new Set<() => void>();
  let heartbeatPending = false;
  // Tăng mỗi khi một vòng heartbeat bị huỷ. Heartbeat đang bay về sau khi đã bị huỷ
  // sẽ thấy `run !== heartbeatRun` và bỏ qua kết quả của nó.
  let heartbeatRun = 0;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let errors: number[] = [];
  let successes: number[] = [];

  const setOnline = (next: boolean) => {
    if (online === next) return;
    online = next;
    listeners.forEach((listener) => listener());
  };

  const prune = () => {
    const since = performance.now() - windowMs;
    errors = errors.filter((t) => t > since);
    successes = successes.filter((t) => t > since);
  };

  // navigator.onLine = false thì gần như chắc chắn mất mạng (không có card mạng nào kết nối):
  // ping lúc này chỉ tốn pin. Ngược lại `true` thì chưa chắc, nên mới cần heartbeat.
  const osSaysOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

  async function heartbeatOnce() {
    try {
      // Có response (kể cả 404/500) nghĩa là đã tới được server -> online.
      // AbortSignal.timeout: huỷ request nếu treo quá `timeout` ms (mạng 2G có thể treo cả phút).
      await fetchImpl(heartbeatUrl, { cache: 'no-store', signal: AbortSignal.timeout(timeout) });
      return true;
    } catch {
      return false;
    }
  }

  async function runHeartbeat(run: number) {
    const ok = await heartbeatOnce();
    if (run !== heartbeatRun) return; // vòng này đã bị huỷ trong lúc chờ
    if (ok) {
      heartbeatPending = false;
      attempt = 0;
      onHeartbeat?.({ type: 'heartbeat-ok' });
      setOnline(true);
      return;
    }
    setOnline(false);
    if (osSaysOffline()) {
      // Ngừng vòng ping; sự kiện `online` của trình duyệt sẽ khởi động lại heartbeat.
      pauseHeartbeat();
      return;
    }
    // 100ms, 200ms, 400ms ... tối đa maxDelay: ping dày lúc đầu (mạng hay chập chờn
    // vài trăm ms) rồi thưa dần để không spam khi mất mạng lâu.
    // (Facebook tăng nhanh hơn: 100 → 200 → 800 → 6400, xem bài viết.)
    const retryIn = Math.min(initialDelay * 2 ** attempt, maxDelay);
    attempt++;
    onHeartbeat?.({ type: 'heartbeat-fail', attempt, retryIn });
    retryTimer = setTimeout(() => runHeartbeat(run), retryIn);
  }

  function cancelHeartbeat() {
    heartbeatRun++;
    heartbeatPending = false;
    attempt = 0;
    clearTimeout(retryTimer);
  }

  function pauseHeartbeat() {
    cancelHeartbeat();
    onHeartbeat?.({ type: 'heartbeat-paused' });
  }

  function startHeartbeat() {
    if (heartbeatPending) return; // đang ping rồi thì thôi
    if (osSaysOffline()) return; // chờ sự kiện `online`
    heartbeatPending = true;
    onHeartbeat?.({ type: 'heartbeat-start' });
    void runHeartbeat(heartbeatRun);
  }

  const onBrowserOnline = () => startHeartbeat(); // "online" có thể sai -> xác nhận lại
  const onBrowserOffline = () => {
    // Đây là tín hiệu tin được: báo offline ngay, dừng mọi vòng ping đang chạy.
    setOnline(false);
    if (heartbeatPending) pauseHeartbeat();
  };
  // An toàn khi import ở server (SSR): chỉ gắn listener khi có window.
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onBrowserOnline);
    window.addEventListener('offline', onBrowserOffline);
  }

  return {
    isOnline: () => online,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Gọi khi một request của app lỗi mạng. */
    reportError() {
      errors.push(performance.now());
      prune();
      // Thỉnh thoảng lỗi một request là bình thường. Chỉ nghi ngờ mất mạng khi
      // số lần thành công không còn gấp đôi số lần lỗi trong `windowMs` gần nhất.
      if (successes.length < errors.length * 2) startHeartbeat();
    },
    /** Gọi khi một request của app có response. */
    reportSuccess() {
      successes.push(performance.now());
      prune();
      // Một response thật là bằng chứng mạnh hơn mọi heartbeat: huỷ vòng ping đang chạy
      // (có thể đang chờ tới 6.4s) và báo online ngay.
      if (heartbeatPending) cancelHeartbeat();
      setOnline(true);
    },
    destroy() {
      cancelHeartbeat();
      if (typeof window === 'undefined') return;
      window.removeEventListener('online', onBrowserOnline);
      window.removeEventListener('offline', onBrowserOffline);
    },
  };
}

export type NetworkStatus = ReturnType<typeof createNetworkStatus>;

/** Bọc fetch để tự báo thành công/lỗi cho NetworkStatus. */
export function trackedFetch(status: NetworkStatus, fetchImpl: typeof fetch = fetch): typeof fetch {
  return async (...args) => {
    try {
      const response = await fetchImpl(...args);
      status.reportSuccess();
      return response;
    } catch (error) {
      // AbortError là do mình huỷ, không phải lỗi mạng
      if (!(error instanceof DOMException && error.name === 'AbortError')) status.reportError();
      throw error;
    }
  };
}

export function useOnline(status: NetworkStatus) {
  // server không biết trạng thái mạng của client -> mặc định online
  return useSyncExternalStore(status.subscribe, status.isOnline, () => true);
}
