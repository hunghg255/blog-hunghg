/**
 * Hàng đợi task chạy từng bước, task con chen lên đầu (theo chiều sâu).
 * Ý tưởng từ RelayTaskQueue (react-relay classic), viết lại: vòng lặp thay cho đệ quy, scheduler tuỳ chọn.
 */

export type Step = (input: any) => any;
/** Scheduler nhận một hàm "chạy một bước" và quyết định khi nào gọi nó (rAF, setTimeout, idle…). */
export type Scheduler = (runOne: () => void) => void;

type Item = () => void;

export class TaskQueue {
  private queue: Item[] = [];
  private scheduled = false;
  private draining = false;

  constructor(private scheduler: Scheduler | null = null) {}

  injectScheduler(scheduler: Scheduler | null) {
    this.scheduler = scheduler;
  }

  get size() {
    return this.queue.length;
  }

  /** Mỗi bước nhận kết quả bước trước; bước sau chỉ được xếp hàng khi bước trước xong. */
  enqueue(...steps: Step[]): Promise<unknown> {
    const promise = new Promise<unknown>((resolve, reject) => {
      let i = 0;
      const pushNext = (value: unknown) => {
        if (i >= steps.length) return resolve(value);
        this.queue.push(() => {
          let out: unknown;
          try {
            out = steps[i++](value);
          } catch (e) {
            return reject(e); // bước lỗi: bỏ các bước còn lại
          }
          pushNext(out);
        });
      };
      pushNext(undefined);
    });
    this.schedule();
    return promise;
  }

  /** Chạy một mục: mục mới sinh ra trong lúc chạy được đặt lên ĐẦU hàng. */
  private runOne(item: Item) {
    const rest = this.queue;
    this.queue = [];
    try {
      item();
    } finally {
      this.queue = this.queue.concat(rest);
    }
  }

  private schedule() {
    if (this.scheduled || this.draining || this.queue.length === 0) return;
    if (!this.scheduler) {
      // không có scheduler: chạy hết ngay bằng vòng lặp, không đệ quy
      this.draining = true;
      try {
        while (this.queue.length) this.runOne(this.queue.shift()!);
      } finally {
        this.draining = false;
      }
      return;
    }
    this.scheduled = true;
    let called = false;
    this.scheduler(() => {
      if (called) throw new Error('Scheduler gọi lại cùng một callback hai lần');
      called = true;
      const item = this.queue.shift();
      if (item) this.runOne(item); // trong lúc chạy, scheduled vẫn true nên enqueue lồng không hẹn thêm
      this.scheduled = false;
      this.schedule();
    });
  }
}
