/**
 * Gọi hàm trong Web Worker như gọi một hàm async: có Promise, có tiến độ (progress) và huỷ
 * được. Ý tưởng từ WorkerConnector + createWorkerInterface của web.telegram.org
 * (src/util/WorkerConnector.ts, src/util/createWorkerInterface.ts).
 *
 * File này là phía trang chính. Phía worker: xem workerRpcHost.ts.
 */

// ---- Giao thức (hai phía dùng chung) ----

export type CallMessage = { type: 'call'; id: number; name: string; input: unknown };
export type CancelMessage = { type: 'cancel'; id: number };
export type ToWorker = CallMessage | CancelMessage;

export type FromWorker =
  | { type: 'result'; id: number; value: unknown }
  | { type: 'error'; id: number; error: { name: string; message: string } }
  | { type: 'progress'; id: number; value: unknown }
  | { type: 'fatal'; error: { message: string } };

/** Ngữ cảnh worker truyền cho mỗi hàm: báo tiến độ, biết khi nào bị huỷ, chuyển buffer. */
export interface CallContext<P = unknown> {
  progress(value: P): void;
  signal: AbortSignal;
  /** đánh dấu ArrayBuffer trong kết quả để CHUYỂN (transfer) thay vì sao chép */
  transfer(...buffers: ArrayBuffer[]): void;
}

/** Kiểu của một API trong worker: mỗi hàm nhận (input, ctx). */
export type WorkerApi = Record<string, (input: never, ctx: CallContext<never>) => unknown>;

type InputOf<F> = F extends (input: infer I, ctx: never) => unknown ? I : never;
type ProgressOf<F> = F extends (input: never, ctx: CallContext<infer P>) => unknown ? P : never;
type ResultOf<F> = F extends (...args: never[]) => infer R ? Awaited<R> : never;

export interface CallOptions<P> {
  onProgress?: (value: P) => void;
  signal?: AbortSignal;
  /** buffer trong `input` cần chuyển hẳn sang worker (trang chính mất quyền dùng) */
  transfer?: Transferable[];
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  onProgress?: (value: unknown) => void;
  cleanup: () => void;
}

export class WorkerCrashedError extends Error {
  name = 'WorkerCrashedError';
}

export function createWorkerClient<Api extends WorkerApi>(worker: Worker) {
  // id tăng dần là đủ duy nhất trong phạm vi một worker
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const failAll = (reason: unknown) => {
    for (const p of pending.values()) {
      p.cleanup();
      p.reject(reason);
    }
    pending.clear();
  };

  worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
    const data = event.data;
    if (data.type === 'fatal') {
      // Telegram ném lỗi ra ở đây, các promise đang chờ thì treo mãi. Ta từ chối tất cả.
      failAll(new WorkerCrashedError(data.error.message));
      return;
    }
    const p = pending.get(data.id);
    if (!p) return; // đã huỷ hoặc đã xong: bỏ qua tin nhắn đến muộn
    if (data.type === 'progress') {
      p.onProgress?.(data.value);
      return;
    }
    pending.delete(data.id);
    p.cleanup();
    if (data.type === 'result') p.resolve(data.value);
    else p.reject(Object.assign(new Error(data.error.message), { name: data.error.name }));
  });

  // Lỗi khi tải/parse file worker: không còn gì để chờ nữa
  worker.addEventListener('error', (event) => failAll(new WorkerCrashedError(event.message || 'worker error')));

  function call<K extends keyof Api & string>(
    name: K,
    input: InputOf<Api[K]>,
    { onProgress, signal, transfer = [] }: CallOptions<ProgressOf<Api[K]>> = {},
  ): Promise<ResultOf<Api[K]>> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        pending.delete(id);
        worker.postMessage({ type: 'cancel', id } satisfies CancelMessage);
        reject(signal!.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress: onProgress as ((value: unknown) => void) | undefined,
        cleanup: () => signal?.removeEventListener('abort', onAbort),
      });
      worker.postMessage({ type: 'call', id, name, input } satisfies CallMessage, transfer);
    });
  }

  return {
    call,
    get pendingCount() {
      return pending.size;
    },
    terminate() {
      worker.terminate();
      failAll(new WorkerCrashedError('worker đã bị terminate'));
    },
  };
}

export type WorkerClient<Api extends WorkerApi> = ReturnType<typeof createWorkerClient<Api>>;

/**
 * Nhiều worker cho việc nặng (Telegram tạo sẵn vài worker cho RLottie và chia vòng tròn).
 * Ở đây chọn worker đang ít việc nhất.
 */
export function createWorkerPool<Api extends WorkerApi>(size: number, makeWorker: () => Worker) {
  const clients = Array.from({ length: size }, () => createWorkerClient<Api>(makeWorker()));
  return {
    call: ((...args: Parameters<WorkerClient<Api>['call']>) => {
      const client = clients.reduce((a, b) => (b.pendingCount < a.pendingCount ? b : a));
      return client.call(...args);
    }) as WorkerClient<Api>['call'],
    terminate: () => clients.forEach((c) => c.terminate()),
  };
}
