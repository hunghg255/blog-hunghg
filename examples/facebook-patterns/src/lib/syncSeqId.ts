/**
 * Áp dụng delta realtime theo đúng thứ tự seqID, phát hiện "lỗ" và tự đồng bộ bù
 * (ý tưởng từ MercurySyncDeltaHandler + MercurySyncDeltaHolder của Messenger web).
 *
 * - Mỗi delta có seqID tăng đều 1 đơn vị. Client nhớ lastSeqID.
 * - next − last = 1 → áp dụng; > 1 → có lỗ (mất gói hoặc tới sai thứ tự); ≤ 0 → trùng, bỏ.
 * - Gặp lỗ thì đồng bộ lại (bản gốc gọi ngay "global DFF": lấy lại toàn bộ state).
 * - Server có thể gửi lệnh "forced fetch" (DFF) cho một tin / một thread / toàn bộ.
 *   Lấy hẹp thất bại thì rơi xuống tầng rộng hơn: message → thread → global.
 * - Mỗi lúc chỉ một lần fetch; trong lúc fetch, delta mới chỉ được xếp hàng.
 */

export type Delta<T> =
  | { kind: 'data'; payload: T; numNoOps?: number }
  | { kind: 'forcedFetch'; threadKey?: string; messageId?: string };

export type FetchLevel = 'message' | 'thread' | 'global';

export interface GlobalSnapshot {
  /** seqID mà snapshot đã bao gồm */
  seqId: number;
}

export interface SyncHandlerOptions<T> {
  apply: (seqId: number, payload: T) => void;
  fetchMessage: (threadKey: string, messageId: string) => Promise<void>;
  fetchThread: (threadKey: string) => Promise<void>;
  fetchGlobal: () => Promise<GlobalSnapshot>;
  /**
   * Chờ bao lâu trước khi coi một khoảng trống là "lỗ" thật. 0 = như bản gốc (fetch ngay).
   * Delta tới sai thứ tự vài chục ms là chuyện thường; chờ một chút tránh đồng bộ toàn bộ oan.
   */
  holeGraceMs?: number;
  /** số lần thử lại global fetch trước khi bỏ cuộc */
  maxGlobalRetries?: number;
  onEvent?: (event: SyncEvent) => void;
}

export type SyncEvent =
  | { type: 'apply'; seqId: number }
  | { type: 'drop'; seqId: number }
  | { type: 'hole'; last: number; next: number }
  | { type: 'hole-filled'; seqId: number }
  | { type: 'fetch-start'; level: FetchLevel; seqId?: number }
  | { type: 'fetch-ok'; level: FetchLevel; seqId?: number }
  | { type: 'fetch-fail'; level: FetchLevel; seqId?: number }
  | { type: 'gave-up' };

/** Hàng chờ delta theo seqID: tự sắp, bỏ seqID trùng. */
export class DeltaHolder<T> {
  private readonly byId = new Map<number, Delta<T>>();
  private ids: number[] = [];
  private last = 0;

  push(seqId: number, delta: Delta<T>) {
    if (this.byId.has(seqId)) return;
    this.byId.set(seqId, delta);
    // giữ mảng luôn sắp tăng: chèn đúng chỗ thay vì sort lại mỗi lần peek như bản gốc
    let i = this.ids.length;
    while (i > 0 && this.ids[i - 1] > seqId) i--;
    this.ids.splice(i, 0, seqId);
  }

  peek(): number | undefined {
    return this.ids[0];
  }

  pop(): { seqId: number; delta: Delta<T> } | undefined {
    const seqId = this.ids.shift();
    if (seqId === undefined) return undefined;
    const delta = this.byId.get(seqId)!;
    this.byId.delete(seqId);
    return { seqId, delta };
  }

  get lastSeqId() {
    return this.last;
  }

  set lastSeqId(value: number) {
    this.last = value;
  }

  /** sau global fetch: snapshot đã gồm mọi thứ tới seqId, bỏ hết delta cũ hơn */
  resetTo(seqId: number) {
    this.last = seqId;
    while (this.ids.length > 0 && this.ids[0] <= seqId) this.pop();
  }

  get size() {
    return this.ids.length;
  }
}

export function createSyncHandler<T>(options: SyncHandlerOptions<T>) {
  const {
    apply,
    fetchMessage,
    fetchThread,
    fetchGlobal,
    holeGraceMs = 0,
    maxGlobalRetries = 3,
    onEvent = () => {},
  } = options;
  const holder = new DeltaHolder<T>();
  // > 0: đang fetch hoặc đang bị pause (bản gốc dùng chung một bộ đếm cho cả hai việc)
  let blocked = 0;
  let fetching = false;
  let holeTimer: ReturnType<typeof setTimeout> | undefined;
  let waitingHole: { last: number; next: number } | null = null;
  let disposed = false;
  // lệnh "đồng bộ toàn bộ" server đẩy riêng, không đi kèm seqID (FAKE_DFF ở bản gốc)
  let forceGlobalPending = false;

  function runFetch(level: FetchLevel, seqId: number | undefined, task: () => Promise<void>) {
    // bất biến: chỉ một fetch bay cùng lúc
    if (fetching) throw new Error('đã có một fetch đang chạy');
    fetching = true;
    blocked++;
    onEvent({ type: 'fetch-start', level, seqId });
    task()
      .then(
        () => onEvent({ type: 'fetch-ok', level, seqId }),
        () => onEvent({ type: 'fetch-fail', level, seqId }),
      )
      .finally(() => {
        fetching = false;
        blocked--;
        drain();
      });
  }

  let globalFailures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  /** Đồng bộ toàn bộ. Gọi trùng (đang fetch hoặc đang chờ thử lại) thì bỏ qua. */
  function requestGlobal() {
    if (fetching || retryTimer !== undefined || disposed) return;
    runFetch('global', undefined, async () => {
      try {
        const snapshot = await fetchGlobal();
        globalFailures = 0;
        holder.resetTo(snapshot.seqId);
      } catch (error) {
        globalFailures++;
        if (globalFailures >= maxGlobalRetries) {
          disposed = true;
          onEvent({ type: 'gave-up' });
        } else {
          // backoff 200ms, 400ms, 800ms… thay vì thử lại ngay như bản gốc
          retryTimer = setTimeout(() => {
            retryTimer = undefined;
            requestGlobal();
          }, 200 * 2 ** (globalFailures - 1));
        }
        throw error;
      }
    });
  }

  function handleForcedFetch(seqId: number, delta: Extract<Delta<T>, { kind: 'forcedFetch' }>) {
    const { threadKey, messageId } = delta;
    if (threadKey !== undefined && messageId !== undefined) {
      runFetch('message', seqId, () =>
        fetchMessage(threadKey, messageId).catch((error) => {
          // lấy 1 tin thất bại: đặt lại lệnh ở cùng seqID nhưng hẹp hơn một bậc (cả thread)
          holder.lastSeqId = seqId - 1;
          holder.push(seqId, { kind: 'forcedFetch', threadKey });
          throw error;
        }),
      );
    } else if (threadKey !== undefined) {
      runFetch('thread', seqId, () =>
        fetchThread(threadKey).catch((error) => {
          holder.lastSeqId = seqId - 1;
          holder.push(seqId, { kind: 'forcedFetch' });
          throw error;
        }),
      );
    } else {
      requestGlobal();
    }
  }

  function applyOne(seqId: number, delta: Delta<T>) {
    // một delta có thể "nuốt" nhiều seqID trống phía sau (numNoOps)
    holder.lastSeqId = delta.kind === 'data' && delta.numNoOps && delta.numNoOps > 1 ? seqId + delta.numNoOps - 1 : seqId;
    if (delta.kind === 'forcedFetch') {
      handleForcedFetch(seqId, delta);
    } else {
      apply(seqId, delta.payload);
      onEvent({ type: 'apply', seqId });
    }
  }

  function drain() {
    // vòng lặp thay vì đệ quy: không có "khung ngoài" chạy tiếp sau khi một fetch đã bắt đầu
    while (!disposed && blocked === 0) {
      if (forceGlobalPending) {
        forceGlobalPending = false;
        requestGlobal();
        continue; // requestGlobal đã tăng blocked: vòng lặp tự dừng, không chạy tiếp như bản gốc
      }
      const next = holder.peek();
      if (next === undefined) return;
      const diff = next - holder.lastSeqId;
      if (diff === 1) {
        if (waitingHole) {
          onEvent({ type: 'hole-filled', seqId: next });
          clearTimeout(holeTimer);
          waitingHole = null;
        }
        const item = holder.pop()!;
        applyOne(item.seqId, item.delta);
      } else if (diff <= 0) {
        holder.pop();
        onEvent({ type: 'drop', seqId: next });
      } else {
        onHole(holder.lastSeqId, next);
        return;
      }
    }
  }

  function onHole(last: number, next: number) {
    if (waitingHole && waitingHole.last === last) return; // đang chờ đúng lỗ này
    waitingHole = { last, next };
    onEvent({ type: 'hole', last, next });
    const fire = () => {
      waitingHole = null;
      if (disposed || fetching) return;
      // vẫn còn lỗ sau thời gian chờ: đồng bộ toàn bộ
      if ((holder.peek() ?? 0) - holder.lastSeqId > 1) requestGlobal();
    };
    if (holeGraceMs <= 0) fire();
    else holeTimer = setTimeout(fire, holeGraceMs);
  }

  return {
    /** nhận một delta từ realtime (MQTT/WebSocket) */
    receive(seqId: number, delta: Delta<T>) {
      if (disposed) return;
      holder.push(seqId, delta);
      drain();
    },
    /** khởi tạo lastSeqID từ lần tải đầu */
    init(seqId: number) {
      holder.lastSeqId = seqId;
      drain();
    },
    /** server yêu cầu đồng bộ toàn bộ (không kèm seqID) */
    forceGlobalSync() {
      forceGlobalPending = true;
      drain();
    },
    /** chặn áp dụng delta, ví dụ trong lúc đang gửi tin (bản gốc dùng khi gửi) */
    pause() {
      blocked++;
    },
    resume() {
      blocked--;
      drain();
    },
    get lastSeqId() {
      return holder.lastSeqId;
    },
    get pending() {
      return holder.size;
    },
    get isFetching() {
      return fetching;
    },
    dispose() {
      disposed = true;
      clearTimeout(holeTimer);
      clearTimeout(retryTimer);
    },
  };
}

export type SyncHandler<T> = ReturnType<typeof createSyncHandler<T>>;
