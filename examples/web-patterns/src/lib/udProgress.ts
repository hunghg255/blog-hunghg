/**
 * Ghi tiến độ xem video mà không gọi API mỗi lần `timeupdate`
 * (ý tưởng từ handleVideoProgress + video-viewer.mobx-store.js của Udemy):
 * - chia thời lượng thành bucket 15 giây, chỉ báo khi sang bucket mới;
 * - gom 5 bản ghi mới gửi một lần;
 * - coi như học xong khi còn dưới 15 giây;
 * - player lỗi mạng thì thử lại với độ trễ 500·n² ms.
 * Bản viết lại thêm: đếm số giây thật sự đã xem, không mất batch khi gửi lỗi hay đóng tab,
 * và ngân sách thử lại tự hồi phục.
 */

export interface ProgressRecord {
  /** giây đã tới, làm tròn xuống */
  position: number;
  total: number;
  /** số giây thật sự đã phát (không tính đoạn tua qua) */
  watched: number;
  type: 'progress' | 'ended';
}

export interface ProgressTrackerOptions {
  interval?: number;
  completionOffset?: number;
  /** tỉ lệ thời lượng phải xem thật mới tính là xong; 0 = giống Udemy, chỉ cần tới gần cuối */
  minWatchedRatio?: number;
  onProgress(record: ProgressRecord): void;
  onComplete(record: ProgressRecord): void;
}

export function createProgressTracker({
  interval = 15,
  completionOffset = 15,
  minWatchedRatio = 0,
  onProgress,
  onComplete,
}: ProgressTrackerOptions) {
  let lastBucket = 0;
  let lastTime: number | null = null;
  let watched = 0;
  let completed = false;

  function update(currentTime: number, duration: number, type: 'timeupdate' | 'ended' | 'seeked' = 'timeupdate') {
    if (!(duration > 0)) return;

    // Cộng thời gian đã xem: chỉ tính bước nhảy nhỏ giữa hai timeupdate liên tiếp
    // (timeupdate bắn khoảng 4 lần/giây; ở tốc độ 2x mỗi bước ~0.5 giây).
    // Bước lớn hoặc âm là người dùng tua, không cộng.
    if (type !== 'seeked' && lastTime !== null) {
      const delta = currentTime - lastTime;
      if (delta > 0 && delta < 2) watched = Math.min(duration, watched + delta);
    }
    lastTime = currentTime;

    const bucket = Math.floor(currentTime / interval);
    const record: ProgressRecord = {
      position: type === 'ended' ? Math.floor(duration) : Math.floor(currentTime),
      total: Math.floor(duration),
      watched: Math.floor(watched),
      type: type === 'ended' ? 'ended' : 'progress',
    };
    // 'ended' luôn được báo, kể cả khi vẫn nằm trong bucket cuối đã báo trước đó
    if (type === 'ended' || (bucket !== lastBucket && bucket > 0)) {
      lastBucket = bucket;
      onProgress(record);
    }

    if (!completed && isNearEnd(currentTime, duration, type) && watched >= duration * minWatchedRatio) {
      completed = true;
      onComplete(record);
    }
  }

  /**
   * Video ngắn hơn ngưỡng (vd 10 giây với ngưỡng 15) thì "còn dưới 15 giây" đúng ngay từ đầu;
   * khi đó đòi phải xem tới cuối thật.
   */
  function isNearEnd(currentTime: number, duration: number, type: string) {
    if (type === 'ended') return true;
    if (duration <= completionOffset) return duration - currentTime <= 0.5;
    return duration - currentTime < completionOffset;
  }

  return {
    update,
    get watched() {
      return watched;
    },
    get completed() {
      return completed;
    },
    reset() {
      lastBucket = 0;
      lastTime = null;
      watched = 0;
      completed = false;
    },
  };
}

export interface BatchSenderOptions<T> {
  size?: number;
  send(items: T[]): Promise<void>;
  /** gửi lúc trang sắp đóng; trả false nếu trình duyệt từ chối */
  beacon(items: T[]): boolean;
}

/**
 * Gom bản ghi rồi gửi theo lô. Khác bản gốc ở hai chỗ:
 * - chỉ xoá khỏi hàng đợi khi server nhận thành công (Udemy xoá ngay khi bắt đầu gửi);
 * - lúc tab bị ẩn/đóng thì gửi bằng sendBeacon (Udemy gọi axios trong beforeunload,
 *   request đó thường bị huỷ cùng trang).
 */
export function createBatchSender<T>({ size = 5, send, beacon }: BatchSenderOptions<T>) {
  let queue: T[] = [];
  let sending = false;

  async function flush() {
    if (sending || queue.length === 0) return;
    sending = true;
    const batch = queue.slice(0, size);
    try {
      await send(batch);
      queue = queue.slice(batch.length);
    } catch {
      // giữ nguyên trong hàng đợi, lần sau gửi lại
    } finally {
      sending = false;
    }
  }

  return {
    push(item: T) {
      queue.push(item);
      if (queue.length >= size) void flush();
    },
    flush,
    /** gọi trong pagehide / visibilitychange → hidden */
    flushWithBeacon() {
      if (queue.length && beacon(queue)) queue = [];
    },
    get pending() {
      return queue.length;
    },
  };
}

/** 500·n² ms giống Udemy, có trần và thêm jitter ±25% để nhiều người xem không cùng thử lại một lúc. */
export function retryDelay(attempt: number, cap = 15_000, random = Math.random) {
  const base = Math.min(500 * attempt * attempt, cap);
  return Math.round(base * (0.75 + random() * 0.5));
}

/**
 * Ngân sách thử lại tự hồi phục: tối đa `limit` lần, nhưng đã qua `healthyMs` không có lỗi nào
 * thì đếm lại từ đầu. Udemy đếm `numErrors` suốt đời player: 5 lần chớp mạng rải rác
 * trong một buổi học là hết quyền thử lại.
 */
export function createRetryBudget({ limit = 5, healthyMs = 60_000, now = Date.now } = {}) {
  let failures = 0;
  let lastFailureAt = -Infinity;
  return {
    /** gọi khi player lỗi; trả về độ trễ trước khi thử lại, hoặc null nếu hết quyền */
    onError(): number | null {
      if (now() - lastFailureAt >= healthyMs) failures = 0;
      lastFailureAt = now();
      if (failures >= limit) return null;
      failures++;
      return retryDelay(failures);
    },
    get failures() {
      return failures;
    },
  };
}
