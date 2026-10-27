/**
 * Hàng đợi requestAnimationFrame có "ngân sách" thời gian mỗi frame.
 * Ý tưởng từ RequestAnimationFrameLimiter của apps.apple.com
 * (shared/components/src/utils/rafQueue.ts): gom nhiều callback vào MỘT rAF, chạy tới khi hết
 * ~3ms thì dừng, phần còn lại để frame sau. Main thread luôn còn chỗ cho input và render.
 */

type Task = (frameTime: number) => void;
/** bọc task trong object để huỷ được mà không cần biết vị trí của nó trong mảng */
type Entry = { task: Task | null };

export interface RafQueueStats {
  /** số task đã chạy trong frame vừa rồi */
  ran: number;
  /** thời gian đã dùng trong frame vừa rồi (ms) */
  spent: number;
  /** số task còn chờ */
  pending: number;
}

export interface RafQueueOptions {
  /** ngân sách mỗi frame (ms). Apple: 3ms */
  budgetMs?: number;
  /** gọi sau mỗi frame có chạy task (để đo đạc) */
  onFrame?: (stats: RafQueueStats) => void;
  /** task ném lỗi: mặc định báo qua reportError và CHẠY TIẾP các task khác */
  onError?: (error: unknown) => void;
}

const defaultOnError = (error: unknown) => {
  if (typeof reportError === 'function') reportError(error);
  else setTimeout(() => { throw error; });
};

export class RafQueue {
  private queue: Entry[] = [];
  private head = 0; // chỉ số task kế tiếp; tránh queue.shift() O(n) mỗi lần
  private frameId: number | null = null;
  private readonly budgetMs: number;
  private readonly onFrame?: (stats: RafQueueStats) => void;
  private readonly onError: (error: unknown) => void;

  constructor({ budgetMs = 3, onFrame, onError = defaultOnError }: RafQueueOptions = {}) {
    this.budgetMs = budgetMs;
    this.onFrame = onFrame;
    this.onError = onError;
  }

  /** Thêm task; trả về hàm huỷ (task chưa chạy thì sẽ không chạy nữa). */
  add(task: Task): () => void {
    const entry: Entry = { task };
    this.queue.push(entry);
    this.schedule();
    return () => {
      entry.task = null;
    };
  }

  get pending() {
    let count = 0;
    for (let i = this.head; i < this.queue.length; i++) if (this.queue[i].task) count++;
    return count;
  }

  /** Huỷ hết task đang chờ (ví dụ khi rời trang/route). */
  clear() {
    this.queue = [];
    this.head = 0;
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  private schedule() {
    if (this.frameId === null && this.head < this.queue.length) {
      this.frameId = requestAnimationFrame(this.run);
    }
  }

  private run = (frameTime: number) => {
    this.frameId = null;
    if (this.head >= this.queue.length) return;
    const start = performance.now();
    let ran = 0;
    // Chạy ít nhất 1 task mỗi frame (kể cả task dài hơn ngân sách), nếu không hàng đợi kẹt mãi
    do {
      const entry = this.queue[this.head++];
      const task = entry.task;
      entry.task = null; // nhả tham chiếu cho GC, và huỷ sau khi chạy thì không có tác dụng gì
      if (!task) continue; // task đã bị huỷ: bỏ qua, không tính vào ngân sách
      try {
        task(frameTime);
      } catch (error) {
        // Apple: một task ném lỗi là cả hàng đợi đứng (requestId không bao giờ về null)
        this.onError(error);
      }
      ran++;
    } while (this.head < this.queue.length && performance.now() - start < this.budgetMs);

    // dọn mảng khi đã chạy hết, để mảng không phình mãi
    if (this.head >= this.queue.length) {
      this.queue = [];
      this.head = 0;
    }
    this.onFrame?.({ ran, spent: performance.now() - start, pending: this.pending });
    this.schedule();
  };
}

let shared: RafQueue | null = null;

/** Hàng đợi dùng chung cho cả app (Apple: getRafQueue). Trên server thì chạy ngay. */
export function getRafQueue(): Pick<RafQueue, 'add'> {
  if (typeof window === 'undefined') {
    return {
      add(task) {
        task(0);
        return () => {};
      },
    };
  }
  return (shared ??= new RafQueue());
}
