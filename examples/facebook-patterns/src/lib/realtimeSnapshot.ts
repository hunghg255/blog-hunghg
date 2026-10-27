/**
 * Snapshot + delta qua kênh push (ý tưởng từ AdsDraftPublishRealtimeClient/Connection của
 * Facebook Ads Manager).
 *
 * Vấn đề: client vừa subscribe kênh push vừa gọi REST lấy trạng thái hiện tại (snapshot).
 * Event push nào tới TRƯỚC snapshot mà áp vào ngay thì sẽ bị snapshot ghi đè và mất.
 *
 * Cách làm:
 * - startBuffering() trước khi gọi REST: mọi event push đi vào hàng đợi.
 * - Snapshot về: lấy làm trạng thái, rồi phát lại hàng đợi theo thứ tự (stopBuffering).
 * - Bước áp event phải idempotent: event đã nằm trong snapshot thì áp lại không đổi gì.
 * - Watchdog: mỗi event đặt lại hẹn giờ; im lặng quá lâu thì coi như push bị kẹt và hỏi REST.
 */

export interface Versioned {
  /** số thứ tự tăng dần do server gán: snapshot mang seq của event cuối nó đã gộp vào */
  seq: number;
}

export interface SnapshotSyncOptions<S extends Versioned, E extends Versioned> {
  fetchSnapshot: () => Promise<S>;
  /** áp một event vào state, PHẢI idempotent */
  apply: (state: S, event: E) => S;
  onState: (state: S) => void;
  /** im lặng quá lâu thì gọi onStall rồi tự lấy lại snapshot qua REST; 0 = tắt */
  watchdogMs?: number;
  onStall?: () => void;
  /** REST lỗi thì thử lại sau bao lâu (event push vẫn được giữ trong lúc chờ) */
  retryMs?: number;
  onLog?: (message: string) => void;
}

export function createSnapshotSync<S extends Versioned, E extends Versioned>({
  fetchSnapshot,
  apply,
  onState,
  watchdogMs = 30_000,
  onStall,
  retryMs = 1000,
  onLog = () => {},
}: SnapshotSyncOptions<S, E>) {
  let state: S | null = null;
  /** seq của snapshot gần nhất: event có seq <= mốc này đã nằm sẵn trong snapshot */
  let snapshotSeq = -Infinity;
  let buffer: E[] | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let fetchId = 0;
  let stopped = false;

  const armWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
    if (!watchdogMs || stopped) return;
    watchdog = setTimeout(() => {
      onLog(`Không có push trong ${watchdogMs} ms, lấy trạng thái qua REST`);
      onStall?.();
      void refresh();
    }, watchdogMs);
  };

  const applyOne = (event: E) => {
    if (!state) return;
    // event cũ hơn snapshot thì đã nằm trong snapshot rồi. Chỉ so với mốc của SNAPSHOT,
    // không so với event vừa áp: push có thể tới lệch thứ tự (#12 tới sau #13) mà vẫn là event mới.
    if (event.seq <= snapshotSeq) {
      onLog(`Bỏ event #${event.seq} (snapshot đã có tới #${snapshotSeq})`);
      return;
    }
    state = apply(state, event);
    onState(state);
  };

  async function refresh() {
    const id = ++fetchId;
    buffer ??= [];
    try {
      const snapshot = await fetchSnapshot();
      if (id !== fetchId || stopped) return; // đã có lần refresh mới hơn
      state = snapshot;
      snapshotSeq = snapshot.seq;
      onState(state);
      const pending = buffer;
      buffer = null;
      onLog(`Snapshot #${snapshot.seq} về, phát lại ${pending.length} event đã giữ`);
      pending.forEach(applyOne);
      armWatchdog();
    } catch (error) {
      if (id !== fetchId || stopped) return;
      // bản gốc không có nhánh này: REST lỗi thì cờ buffering bật mãi, không ai lấy lại snapshot
      onLog(`Lấy snapshot lỗi: ${(error as Error).message}. Vẫn giữ ${buffer?.length ?? 0} event, thử lại sau ${retryMs} ms`);
      if (retry) clearTimeout(retry);
      retry = setTimeout(() => void refresh(), retryMs);
    }
  }

  return {
    /** gọi khi subscribe xong (hoặc cùng lúc): bắt đầu giữ event rồi lấy snapshot */
    start: () => refresh(),
    /** nơi kênh push đưa event vào */
    receive(event: E) {
      if (stopped) return;
      armWatchdog();
      if (buffer) {
        buffer.push(event);
        return;
      }
      applyOne(event);
    },
    refresh,
    getState: () => state,
    isBuffering: () => buffer !== null,
    stop() {
      stopped = true;
      if (watchdog) clearTimeout(watchdog);
      if (retry) clearTimeout(retry);
    },
  };
}

/**
 * Gom nhiều lần gọi trong `ms` thành một lần, dữ liệu dồn vào Map theo id (bản gốc dùng cho
 * các event "đã xoá fragment" để dispatch một lần thay vì mỗi event một lần re-render).
 */
export function createBatchedMap<K, V>(ms: number, flush: (items: Map<K, V>) => void) {
  let items = new Map<K, V>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    add(key: K, value: V) {
      items.set(key, value);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const batch = items;
        items = new Map();
        flush(batch);
      }, ms);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      items = new Map();
    },
  };
}
