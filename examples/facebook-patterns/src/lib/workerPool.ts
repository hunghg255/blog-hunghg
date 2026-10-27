/**
 * Pool Web Worker có hàng đợi theo job id (ý tưởng từ WebWorkerPool + JpegResizer của Facebook).
 *
 * Bản gốc: N worker, chia việc xoay vòng (round-robin), mỗi worker giữ một mảng callback,
 * worker lỗi thì terminate và báo lỗi cho mọi job đang chờ, NHƯNG vẫn nằm trong vòng xoay:
 * từ đó cứ 1/N job lại nhận ngay lỗi "Worker terminated".
 *
 * Bản viết lại:
 * - mỗi job có id riêng, kết quả trả về khớp theo id (không phụ thuộc thứ tự),
 * - chọn worker theo round-robin hoặc theo số job đang chạy (least-busy),
 * - worker chết thì tạo worker mới thế chỗ (respawn), không để "lỗ" trong pool,
 * - huỷ được job bằng AbortSignal.
 */

export type DispatchStrategy = 'round-robin' | 'least-busy';

export interface PoolRequest<TIn> {
  id: number;
  payload: TIn;
}

export type PoolResponse<TOut> =
  | { id: number; ok: true; result: TOut }
  | { id: number; ok: false; error: string };

export interface WorkerPoolOptions {
  size: number;
  /** tạo một worker mới, vd () => new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' }) */
  create: () => Worker;
  strategy?: DispatchStrategy;
  /** worker chết thì tạo lại (mặc định true). false = giống bản gốc của Facebook. */
  respawn?: boolean;
  /** được gọi mỗi khi một job được giao cho worker (để demo/ghi log) */
  onDispatch?: (jobId: number, workerIndex: number) => void;
  onWorkerError?: (workerIndex: number, message: string) => void;
}

interface Pending<TOut> {
  resolve: (value: TOut) => void;
  reject: (reason: Error) => void;
  workerIndex: number;
}

interface Slot {
  worker: Worker | null; // null = đã chết và không respawn
  running: number;
  generation: number;
}

export class WorkerTerminatedError extends Error {
  constructor(workerIndex: number) {
    super(`Worker #${workerIndex} đã bị terminate`);
    this.name = 'WorkerTerminatedError';
  }
}

export class WorkerPool<TIn, TOut> {
  private slots: Slot[] = [];
  private pending = new Map<number, Pending<TOut>>();
  private nextId = 1;
  private cursor = 0;
  /** worker nhận job gần nhất (để UI hiển thị) */
  lastWorkerIndex = -1;

  constructor(private options: WorkerPoolOptions) {
    for (let i = 0; i < options.size; i++) this.slots.push(this.spawn(i, 0));
  }

  private spawn(index: number, generation: number): Slot {
    const worker = this.options.create();
    const slot: Slot = { worker, running: 0, generation };
    worker.onmessage = (event: MessageEvent<PoolResponse<TOut>>) => {
      const data = event.data;
      const job = this.pending.get(data.id);
      if (!job) return; // job đã bị huỷ
      this.pending.delete(data.id);
      slot.running--;
      if (data.ok) job.resolve(data.result);
      else job.reject(new Error(data.error));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.handleCrash(index, slot, event.message || 'lỗi không rõ trong worker');
    };
    return slot;
  }

  private handleCrash(index: number, slot: Slot, message: string) {
    if (this.slots[index] !== slot) return; // slot này đã được thay rồi
    slot.worker?.terminate();
    this.options.onWorkerError?.(index, message);
    // mọi job đang nằm trên worker này đều hỏng
    for (const [id, job] of this.pending) {
      if (job.workerIndex === index) {
        this.pending.delete(id);
        job.reject(new WorkerTerminatedError(index));
      }
    }
    this.slots[index] =
      this.options.respawn === false
        ? { worker: null, running: 0, generation: slot.generation }
        : this.spawn(index, slot.generation + 1);
  }

  private pick(): number {
    const { strategy = 'round-robin' } = this.options;
    if (strategy === 'least-busy') {
      let best = -1;
      this.slots.forEach((slot, i) => {
        if (slot.worker && (best === -1 || slot.running < this.slots[best].running)) best = i;
      });
      return best === -1 ? 0 : best;
    }
    // round-robin như bản gốc: không nhìn tải, không bỏ qua worker chết
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.slots.length;
    return index;
  }

  run(payload: TIn, { signal, transfer = [] }: { signal?: AbortSignal; transfer?: Transferable[] } = {}) {
    const id = this.nextId++;
    const workerIndex = this.pick();
    this.lastWorkerIndex = workerIndex;
    const slot = this.slots[workerIndex];
    return new Promise<TOut>((resolve, reject) => {
      if (!slot.worker) {
        reject(new WorkerTerminatedError(workerIndex));
        return;
      }
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      this.pending.set(id, { resolve, reject, workerIndex });
      slot.running++;
      this.options.onDispatch?.(id, workerIndex);
      slot.worker.postMessage({ id, payload } satisfies PoolRequest<TIn>, transfer);
      signal?.addEventListener(
        'abort',
        () => {
          if (!this.pending.delete(id)) return;
          slot.running--;
          reject(signal.reason);
        },
        { once: true },
      );
    });
  }

  /** số job đang chạy trên từng worker (null = worker đã chết) */
  load(): Array<number | null> {
    return this.slots.map((slot) => (slot.worker ? slot.running : null));
  }

  terminate() {
    this.slots.forEach((slot) => slot.worker?.terminate());
    for (const job of this.pending.values()) job.reject(new Error('Pool đã đóng'));
    this.pending.clear();
  }
}
