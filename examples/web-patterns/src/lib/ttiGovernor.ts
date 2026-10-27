/**
 * TTI governor (ý tưởng từ owa-tti của Outlook Web):
 * - Việc phụ lúc khởi động (tải module thông báo, khảo sát, gợi ý…) không chạy dồn một lúc,
 *   mà xếp hàng, mỗi việc một macrotask (setTimeout), tối đa `concurrency` việc đang chạy.
 * - Việc đánh dấu `idle: true` chờ tới khi trang "tương tác được" (TTI), có giới hạn thời gian.
 * - "Monkey": cố tình làm trễ một việc ngẫu nhiên để đo xem việc đó có thật sự cần sớm không.
 */

export type Task = () => unknown;
export type GovernedTask = Task | { task: Task; condition?: boolean; idle?: boolean };

export interface GovernorProfile {
  /** số việc được chạy cùng lúc */
  concurrency: number;
  /** chờ bao lâu (ms) trước khi bắt đầu xử lý hàng đợi thường */
  delay: number;
  /** khoảng nghỉ (ms) giữa các việc, để trình duyệt kịp vẽ và xử lý input */
  pulse: number;
}

export const DEFAULT_PROFILE: GovernorProfile = { concurrency: 3, delay: 1, pulse: 1 };

// ---- Hàng đợi FIFO giới hạn số việc chạy song song ----

export class TaskQueue {
  private tasks: Task[] = [];
  private running = 0;

  constructor(
    private readonly concurrency: number,
    private readonly pulse: number,
    private readonly runTask: (task: Task) => Promise<unknown>,
  ) {}

  add(task: Task) {
    this.tasks.push(task);
    this.schedule();
  }

  get size() {
    return this.tasks.length + this.running;
  }

  private schedule() {
    while (this.running < this.concurrency && this.tasks.length > 0) {
      // Lấy việc ra ngay khi giữ chỗ, để mỗi chỗ ứng với đúng một việc.
      const task = this.tasks.shift()!;
      this.running++;
      // Mỗi việc chạy trong một macrotask riêng: giữa hai việc, trình duyệt được vẽ
      // và xử lý click. Nếu chạy liền trong một vòng lặp thì thành một long task dài.
      setTimeout(() => {
        // Promise.resolve().then: lỗi ném ĐỒNG BỘ trong runTask cũng thành promise bị reject,
        // không làm `running` kẹt mãi (lỗi của bản gốc, xem bài viết).
        Promise.resolve()
          .then(() => this.runTask(task))
          .catch(() => {})
          .finally(() => {
            this.running--;
            this.schedule();
          });
      }, this.pulse);
    }
  }
}

// ---- Chờ trang "tương tác được" ----

/**
 * Xấp xỉ TTI: sau `load`, chờ một khoảng `quietMs` không có long task (> 50ms) nào.
 * Trình duyệt không có Long Tasks API thì chờ requestIdleCallback (hoặc setTimeout).
 * Định nghĩa TTI gốc còn đòi không quá 2 request mạng đang chạy; bản này bỏ điều kiện đó.
 */
export function waitForQuietWindow({ quietMs = 5000 }: { quietMs?: number } = {}): Promise<void> {
  return new Promise((resolve) => {
    const afterLoad = () => {
      const supportsLongTask =
        typeof PerformanceObserver !== 'undefined' &&
        PerformanceObserver.supportedEntryTypes?.includes('longtask');
      if (!supportsLongTask) {
        const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1));
        idle(() => resolve());
        return;
      }
      let timer = setTimeout(done, quietMs);
      const observer = new PerformanceObserver(() => {
        // có long task mới: đếm lại khoảng yên lặng từ đầu
        clearTimeout(timer);
        timer = setTimeout(done, quietMs);
      });
      observer.observe({ type: 'longtask' });
      function done() {
        observer.disconnect();
        resolve();
      }
    };
    if (document.readyState === 'complete') afterLoad();
    else window.addEventListener('load', afterLoad, { once: true });
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- Governor ----

export interface GovernorReport {
  profile: GovernorProfile;
  tasks: number;
  /** vị trí của việc bị monkey làm trễ, -1 nếu không bật */
  monkey: number;
  /** từ lúc tạo governor tới khi việc cuối cùng BẮT ĐẦU chạy */
  elapsedMs: number;
}

export interface GovernorOptions {
  profile?: Partial<GovernorProfile>;
  /** promise báo trang đã tương tác được, mặc định waitForQuietWindow() */
  whenInteractive?: () => Promise<unknown>;
  /** quá thời gian này thì chạy việc `idle` dù chưa đạt TTI (Outlook: 45 giây) */
  interactiveTimeout?: number;
  /** bật monkey: làm trễ một việc ngẫu nhiên thêm `delayMs` (Outlook: 60 giây) */
  monkey?: { delayMs: number; index?: number };
  onTaskStart?: (info: { task: Task; index: number; idle: boolean; delayedByMonkey: boolean }) => void;
  onReport?: (report: GovernorReport) => void;
}

export function createGovernor({
  profile: profileOverride,
  whenInteractive = () => waitForQuietWindow(),
  interactiveTimeout = 45_000,
  monkey,
  onTaskStart,
  onReport,
}: GovernorOptions = {}) {
  const profile = { ...DEFAULT_PROFILE, ...profileOverride };
  const startedAt = performance.now();
  let total = 0;
  let started = 0;
  let monkeyIndex = -1;
  let reportEnabled = false;

  const runTask = (task: Task, idle: boolean) => {
    const index = started++;
    const delayedByMonkey = index === monkeyIndex;
    onTaskStart?.({ task, index, idle, delayedByMonkey });
    if (reportEnabled && started === total) {
      reportEnabled = false;
      onReport?.({ profile, tasks: total, monkey: monkeyIndex, elapsedMs: performance.now() - startedAt });
    }
    if (delayedByMonkey) {
      // không giữ chỗ trong hàng đợi trong lúc chờ: việc khác vẫn chạy bình thường
      setTimeout(task, monkey!.delayMs);
      return Promise.resolve();
    }
    return Promise.resolve(task());
  };

  // Hai hàng đợi tạo lười: hàng thường chờ `delay`, hàng idle chờ TTI hoặc hết thời gian.
  let normalQueue: Promise<TaskQueue> | null = null;
  let idleQueue: Promise<TaskQueue> | null = null;
  const makeQueue = (ready: Promise<unknown>, idle: boolean) =>
    ready.then(() => new TaskQueue(profile.concurrency, profile.pulse, (task) => runTask(task, idle)));

  const getQueue = (idle: boolean) => {
    if (idle) {
      idleQueue ??= makeQueue(
        Promise.race([whenInteractive().catch(() => {}), sleep(interactiveTimeout)]),
        true,
      );
      return idleQueue;
    }
    normalQueue ??= makeQueue(sleep(profile.delay), false);
    return normalQueue;
  };

  return {
    profile,
    /** Xếp hàng các việc phụ. Việc có `condition: false` bị bỏ qua. */
    govern(...tasks: GovernedTask[]): Promise<void> {
      const added: Promise<void>[] = [];
      for (const item of tasks) {
        const task = typeof item === 'function' ? item : item.task;
        const shouldRun = typeof item === 'function' || !('condition' in item) || !!item.condition;
        const idle = typeof item !== 'function' && !!item.idle;
        if (!shouldRun) continue;
        total++;
        // KHÔNG await từng việc: bản gốc `await getQueue(idle)` trong vòng lặp, nên một việc
        // idle đứng đầu danh sách làm mọi việc thường phía sau phải chờ tới TTI.
        added.push(getQueue(idle).then((queue) => queue.add(task)));
      }
      return Promise.all(added).then(() => {});
    },
    /** Gọi sau khi đã xếp hàng xong mọi việc: chọn việc cho monkey và gửi báo cáo khi xong. */
    enableReport() {
      reportEnabled = true;
      // chỉ chọn trong các việc CHƯA chạy, nếu không monkey có thể rơi vào việc đã xong
      if (monkey && total > started) {
        monkeyIndex = monkey.index ?? started + Math.floor(Math.random() * (total - started));
      }
      if (started === total && total > 0) {
        reportEnabled = false;
        onReport?.({ profile, tasks: total, monkey: monkeyIndex, elapsedMs: performance.now() - startedAt });
      }
    },
  };
}
