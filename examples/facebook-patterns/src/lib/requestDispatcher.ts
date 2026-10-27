/**
 * Bộ điều phối request theo endpoint với nhiều chế độ gộp / chống trùng
 * (ý tưởng từ MercuryServerDispatcher của Messenger web).
 *
 * Mỗi endpoint có: số request đang bay, dữ liệu của request đang bay (pending),
 * và tối đa MỘT gói chờ (batch) được trộn dần bằng hàm combine.
 *
 *  immediate        luôn gửi ngay
 *  idempotent       đang có request bay thì bỏ qua (lệnh lặp lại vô nghĩa)
 *  successive       đang bay thì gộp vào gói chờ, xong request cũ mới gửi gói chờ
 *  successiveUnique như successive nhưng bỏ dữ liệu y hệt request đang bay
 *  conditional      chỉ gộp khi combineIf cho phép, không thì gửi riêng ngay
 *  deferredMulti    luôn gộp, gửi ở cuối tick (gom mọi lệnh phát ra cùng lúc)
 *  piggyback        gộp; lỗi thì dữ liệu lỗi đi nhờ chuyến kế tiếp
 */

export type DispatchMode =
  | 'immediate'
  | 'idempotent'
  | 'successive'
  | 'successiveUnique'
  | 'conditional'
  | 'deferredMulti'
  | 'piggyback';

export interface EndpointConfig<D> {
  mode: DispatchMode;
  send: (data: D) => Promise<void>;
  /** trộn dữ liệu mới vào gói chờ: combine(cũ, mới) */
  combine?: (older: D, newer: D) => D;
  /** chế độ conditional: có được gộp `next` vào `current` không */
  combineIf?: (current: D, next: D) => boolean;
  /** so dữ liệu trùng cho successiveUnique (mặc định so JSON với key đã sắp) */
  isEqual?: (a: D, b: D) => boolean;
  onEvent?: (event: DispatchEvent<D>) => void;
  /** CHỈ để demo tái hiện lỗi của bản gốc: xoá pending SAU khi đã gửi gói chờ */
  legacyClearPendingAfterFlush?: boolean;
}

export type DispatchEvent<D> =
  | { type: 'send'; data: D }
  | { type: 'queued'; data: D }
  | { type: 'skipped'; data: D; reason: 'in-flight' | 'duplicate' }
  | { type: 'done'; data: D }
  | { type: 'error'; data: D };

/** JSON có sắp key, để {a,b} và {b,a} được coi là bằng nhau (bản gốc so JSON.stringify thô). */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

const defaultCombine = <D>(_older: D, newer: D) => newer;

export function createEndpoint<D>(config: EndpointConfig<D>) {
  const {
    mode,
    send,
    combine = defaultCombine,
    combineIf = () => true,
    isEqual = (a, b) => stableJson(a) === stableJson(b),
    onEvent = () => {},
    legacyClearPendingAfterFlush = false,
  } = config;
  let inFlight = 0;
  let pending: D | undefined;
  let batch: { data: D } | undefined;
  let deferTimer: ReturnType<typeof setTimeout> | undefined;

  function addToBatch(data: D, asOlder = false) {
    if (!batch) batch = { data };
    else batch.data = asOlder ? combine(data, batch.data) : combine(batch.data, data);
    onEvent({ type: 'queued', data });
  }

  function flushBatch() {
    if (!batch) return;
    const { data } = batch;
    batch = undefined;
    doSend(data);
  }

  function doSend(data: D) {
    inFlight++;
    pending = data;
    onEvent({ type: 'send', data });
    send(data).then(
      () => finish(data, false),
      () => finish(data, true),
    );
  }

  function finish(data: D, failed: boolean) {
    inFlight--;
    onEvent({ type: failed ? 'error' : 'done', data });
    // Xoá pending của request VỪA XONG trước khi gửi gói kế tiếp.
    // Bản gốc làm ngược lại (gửi gói chờ rồi mới delete), nên xoá mất pending của request mới.
    if (!legacyClearPendingAfterFlush && pending === data) pending = undefined;
    if (failed && mode === 'piggyback') {
      // dữ liệu lỗi được xếp trước dữ liệu mới; có sẵn gói chờ thì gửi luôn,
      // không thì đợi lệnh kế tiếp rồi đi nhờ chuyến đó
      const hadBatch = batch !== undefined;
      addToBatch(data, true);
      if (hadBatch) flushBatch();
    } else if (mode === 'successive' || mode === 'successiveUnique' || mode === 'conditional' || mode === 'piggyback') {
      flushBatch();
    }
    if (legacyClearPendingAfterFlush) pending = undefined;
  }

  return {
    trySend(data: D) {
      switch (mode) {
        case 'immediate':
          return doSend(data);
        case 'idempotent':
          if (inFlight) return onEvent({ type: 'skipped', data, reason: 'in-flight' });
          return doSend(data);
        case 'successive':
          return inFlight ? addToBatch(data) : doSend(data);
        case 'successiveUnique':
          if (!inFlight) return doSend(data);
          if (pending !== undefined && isEqual(pending, data)) {
            return onEvent({ type: 'skipped', data, reason: 'duplicate' });
          }
          return addToBatch(data);
        case 'conditional':
          if (inFlight && ((pending !== undefined && combineIf(pending, data)) || (batch && combineIf(batch.data, data)))) {
            return addToBatch(data);
          }
          return doSend(data);
        case 'deferredMulti':
          addToBatch(data);
          clearTimeout(deferTimer);
          deferTimer = setTimeout(flushBatch, 0);
          return;
        case 'piggyback':
          addToBatch(data);
          if (!inFlight) flushBatch();
          return;
      }
    },
    get inFlight() {
      return inFlight;
    },
    get hasBatch() {
      return batch !== undefined;
    },
  };
}

export type Endpoint<D> = ReturnType<typeof createEndpoint<D>>;
