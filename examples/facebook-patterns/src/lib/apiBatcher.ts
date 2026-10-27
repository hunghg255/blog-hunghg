/**
 * Gộp các lời gọi API phát ra trong cùng một tick thành một request "batch".
 *
 * Ý tưởng từ ApiBatcher (dùng trong ApiClient của Facebook để gọi Graph API):
 * - Lời gọi đầu tiên hẹn setTimeout(0); mọi lời gọi tới trước khi hẹn giờ chạy đi chung chuyến.
 * - Đủ 50 lời gọi thì gửi ngay, không chờ (Graph API nhận tối đa 50 request mỗi batch).
 * - Chuyến chỉ có 1 lời gọi thì gửi thẳng request đó, khỏi bọc batch.
 * - Kết quả trả về là mảng, khớp với lời gọi theo vị trí; cả batch lỗi thì mọi lời gọi cùng lỗi.
 */

export interface BatchRequest {
  method: 'GET' | 'POST' | 'DELETE';
  /** đường dẫn tương đối, vd "/me?fields=name" */
  relativeUrl: string;
  /** body đã mã hoá dạng query string cho POST (giống Graph API batch) */
  body?: string;
}

/** Một phần tử trong mảng kết quả batch. null khi server không chạy được request đó. */
export type BatchItemResponse = { code: number; body: string } | null;

export interface ApiBatcherOptions {
  executeSingle: (request: BatchRequest) => Promise<unknown>;
  executeBatch: (requests: BatchRequest[]) => Promise<BatchItemResponse[]>;
  /** mặc định 50 như bản gốc */
  maxBatchSize?: number;
  /**
   * 'task' (mặc định, như FB): gom tới hết task hiện tại, bắt được cả lời gọi phát ra từ
   * các callback/microtask nối nhau. 'microtask': gửi sớm hơn nhưng chỉ gom được code đồng bộ.
   */
  schedule?: 'task' | 'microtask';
  /** gộp các GET trùng URL trong cùng chuyến thành một (bản gốc không có) */
  dedupeGets?: boolean;
}

export class BatchItemError extends Error {
  constructor(
    public code: number,
    public body: string,
  ) {
    super(`Batch item failed with ${code}`);
  }
}

interface Pending {
  request: BatchRequest;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

function parseBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export function createApiBatcher(options: ApiBatcherOptions) {
  const { executeSingle, executeBatch, maxBatchSize = 50, schedule = 'task', dedupeGets = false } = options;
  let pending: Pending[] = [];
  let scheduled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  const listeners = new Set<(info: { size: number; mode: 'single' | 'batch' }) => void>();

  function scheduleFlush() {
    if (scheduled) return;
    scheduled = true;
    const myGeneration = generation;
    const run = () => {
      // chuyến này đã bị gửi sớm vì đủ maxBatchSize thì bỏ qua lần hẹn cũ
      if (myGeneration === generation) flush();
    };
    if (schedule === 'microtask') queueMicrotask(run);
    else timer = setTimeout(run, 0);
  }

  function flush() {
    if (timer != null) clearTimeout(timer);
    timer = null;
    scheduled = false;
    generation++;
    const batch = pending;
    pending = [];
    if (batch.length === 0) return;

    // dedupe: các GET trùng URL dùng chung một chỗ trong batch
    const slots: BatchRequest[] = [];
    const waiters: Pending[][] = [];
    const indexByKey = new Map<string, number>();
    for (const item of batch) {
      const key = item.request.method === 'GET' && dedupeGets ? `GET ${item.request.relativeUrl}` : null;
      const existing = key != null ? indexByKey.get(key) : undefined;
      if (existing !== undefined) {
        waiters[existing].push(item);
        continue;
      }
      if (key != null) indexByKey.set(key, slots.length);
      slots.push(item.request);
      waiters.push([item]);
    }

    if (slots.length === 1) {
      listeners.forEach((l) => l({ size: 1, mode: 'single' }));
      executeSingle(slots[0]).then(
        (value) => waiters[0].forEach((w) => w.resolve(value)),
        (error) => waiters[0].forEach((w) => w.reject(error)),
      );
      return;
    }

    listeners.forEach((l) => l({ size: slots.length, mode: 'batch' }));
    executeBatch(slots).then(
      (responses) => {
        if (!Array.isArray(responses) || responses.length !== slots.length) {
          const error = new Error('Batch response malformed');
          waiters.flat().forEach((w) => w.reject(error));
          return;
        }
        responses.forEach((response, i) => {
          for (const w of waiters[i]) {
            if (response == null) w.reject(new BatchItemError(0, 'no response for this item'));
            else if (response.code >= 400) w.reject(new BatchItemError(response.code, response.body));
            else w.resolve(parseBody(response.body));
          }
        });
      },
      (error) => waiters.flat().forEach((w) => w.reject(error)),
    );
  }

  return {
    call<T = unknown>(request: BatchRequest): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        pending.push({ request, resolve: resolve as (v: unknown) => void, reject });
        if (pending.length >= maxBatchSize) flush();
        else scheduleFlush();
      });
    },
    flush,
    onDispatch(listener: (info: { size: number; mode: 'single' | 'batch' }) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
