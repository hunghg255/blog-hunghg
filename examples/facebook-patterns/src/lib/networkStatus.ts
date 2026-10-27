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
  | { type: 'heartbeat-fail'; attempt: number; retryIn: number };

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

  async function heartbeatOnce() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      // Có response (kể cả 404/500) nghĩa là đã tới được server -> online.
      await fetchImpl(heartbeatUrl, { cache: 'no-store', signal: controller.signal });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function runHeartbeat() {
    if (await heartbeatOnce()) {
      heartbeatPending = false;
      attempt = 0;
      onHeartbeat?.({ type: 'heartbeat-ok' });
      setOnline(true);
      return;
    }
    setOnline(false);
    // 100ms, 200ms, 400ms ... tối đa maxDelay: ping dày lúc đầu (mạng hay chập chờn
    // vài trăm ms) rồi thưa dần để không spam khi mất mạng lâu.
    const retryIn = Math.min(initialDelay * 2 ** attempt, maxDelay);
    attempt++;
    onHeartbeat?.({ type: 'heartbeat-fail', attempt, retryIn });
    retryTimer = setTimeout(runHeartbeat, retryIn);
  }

  function startHeartbeat() {
    if (heartbeatPending) return; // đang ping rồi thì thôi
    heartbeatPending = true;
    onHeartbeat?.({ type: 'heartbeat-start' });
    void runHeartbeat();
  }

  const onBrowserOnline = () => startHeartbeat(); // "online" có thể sai -> xác nhận lại
  const onBrowserOffline = () => {
    setOnline(false);
    startHeartbeat();
  };
  window.addEventListener('online', onBrowserOnline);
  window.addEventListener('offline', onBrowserOffline);

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
      if (!online && !heartbeatPending) setOnline(true);
    },
    destroy() {
      clearTimeout(retryTimer);
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
  return useSyncExternalStore(status.subscribe, status.isOnline);
}
