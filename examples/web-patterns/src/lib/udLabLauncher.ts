/**
 * Mở môi trường lab ở tab mới mà không bị chặn popup, rồi giữ "nhịp tim" cho phiên lab
 * (ý tưởng từ lab-launcher và heartbeat của Udemy).
 */

// ---------- 1. Mở tab trước, điền URL sau ----------

export interface LaunchApi {
  /** tạo phiên lab; ném LabConflictError nếu người dùng đang chạy lab khác */
  createInstance(): Promise<{ workspaceUrl: string }>;
}

export class LabConflictError extends Error {
  constructor(public runningLabs: string[]) {
    super('Đang có lab khác chạy');
  }
}

export type LaunchResult =
  | { kind: 'opened'; url: string }
  | { kind: 'blocked'; url: string } // trình duyệt chặn: đưa link cho người dùng tự bấm
  | { kind: 'conflict'; runningLabs: string[] }
  | { kind: 'error'; message: string };

/**
 * PHẢI gọi đồng bộ trong handler của click: `window.open` chỉ được phép khi trang còn
 * "kích hoạt tạm thời" (transient activation) từ thao tác của người dùng.
 * Tab mở ra trỏ tới trang chờ cùng origin, sau đó mới đổi sang URL thật.
 */
export async function launchInPlaceholder(
  api: LaunchApi,
  placeholderUrl = 'about:blank',
  open: typeof window.open = window.open.bind(window),
): Promise<LaunchResult> {
  // Không truyền chuỗi features: chuỗi khác rỗng (kể cả 'close=yes') làm trình duyệt mở cửa sổ popup thay vì tab.
  const tab = open(placeholderUrl, '_blank');

  try {
    const { workspaceUrl } = await api.createInstance();
    if (!tab || tab.closed) return { kind: 'blocked', url: workspaceUrl };
    // Tab mở bằng window.open giữ `opener` trỏ về trang mình; cắt đi trước khi sang origin khác.
    tab.opener = null;
    tab.location.href = workspaceUrl;
    return { kind: 'opened', url: workspaceUrl };
  } catch (error) {
    tab?.close(); // đừng để lại một tab trắng
    if (error instanceof LabConflictError) return { kind: 'conflict', runningLabs: error.runningLabs };
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

// ---------- 2. Nhịp tim: tick đều, ghi tiến độ định kỳ, không chồng lượt ----------

export interface HeartbeatOptions {
  /** khoảng tick để cập nhật đồng hồ trên UI (Udemy: 250ms) */
  tickMs?: number;
  /** khoảng ghi tiến độ lên server (Udemy: 15s) */
  logEveryMs?: number;
  /** trần cho một lần ghi, phòng tab ngủ lâu rồi thức dậy (Udemy: 300s) */
  maxElapsedMs?: number;
  onTick?: (elapsedMs: number) => void;
  /**
   * ghi tiến độ; có thể chậm, heartbeat sẽ không gọi chồng.
   * `startedAt` theo đồng hồ `now` (mặc định performance.now(); cần epoch thì cộng performance.timeOrigin).
   */
  onLog: (startedAt: number, elapsedMs: number) => Promise<void>;
  now?: () => number;
}

export function createHeartbeat({
  tickMs = 250,
  logEveryMs = 15_000,
  maxElapsedMs = 300_000,
  onTick,
  onLog,
  now = () => performance.now(),
}: HeartbeatOptions) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let windowStart = 0;
  let running = false;

  // setTimeout lồng nhau thay vì setInterval: lượt sau chỉ được hẹn khi lượt trước (kể cả await) xong,
  // nên một lần ghi chậm không làm các tick sau ghi trùng.
  const loop = async () => {
    if (!running) return;
    const elapsed = now() - windowStart; // performance.now() đơn điệu, không lùi khi đổi giờ máy
    onTick?.(elapsed);
    if (elapsed >= logEveryMs) {
      const startedAt = windowStart;
      windowStart = now();
      try {
        await onLog(startedAt, Math.min(elapsed, maxElapsedMs));
      } catch {
        // ghi lỗi thì bỏ qua lượt này; lượt sau vẫn chạy
      }
    }
    if (running) timer = setTimeout(loop, tickMs);
  };

  return {
    start() {
      if (running) return;
      running = true;
      windowStart = now();
      timer = setTimeout(loop, tickMs);
    },
    stop() {
      running = false;
      clearTimeout(timer);
    },
    get running() {
      return running;
    },
  };
}
