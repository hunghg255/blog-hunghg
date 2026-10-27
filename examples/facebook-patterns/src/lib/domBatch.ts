/**
 * Đọc trước, ghi sau trong cùng một frame (ý tưởng từ queryThenMutateDOM của Facebook,
 * cùng họ với thư viện fastdom).
 *
 * Đọc layout (offsetWidth, getBoundingClientRect…) ngay sau khi vừa ghi style buộc trình duyệt
 * tính lại layout đồng bộ. Xen kẽ đọc-ghi-đọc-ghi trong một vòng lặp thì mỗi lần đọc là một lần
 * layout: "layout thrashing". Gom lại: trong một requestAnimationFrame, chạy TẤT CẢ query trước,
 * rồi TẤT CẢ mutate, nên chỉ cần một lần layout.
 */

export type Query<T> = () => T;
export type Mutate<T> = (value: T) => void;

export interface Scheduled {
  cancel(): void;
}

/** Facebook giữ job ĐẦU TIÊN cùng key; 'last' giữ job mới nhất (dữ liệu mới hơn). */
export type KeyPolicy = 'first' | 'last';

interface Job {
  query: Query<unknown>;
  mutate: Mutate<unknown>;
  key?: string;
  output?: unknown;
  deleted: boolean;
}

export interface DomBatcher {
  schedule<T>(query: Query<T> | null, mutate: Mutate<T> | null, key?: string): Scheduled;
  /** chạy ngay (dùng trong test hoặc khi cần đồng bộ) */
  flush(): void;
  /** số lần layout bị ép trong lần flush gần nhất (để demo) */
  readonly stats: { frames: number; rounds: number; jobs: number; errors: number };
}

export function createDomBatcher({
  keyPolicy = 'first',
  raf = (cb: () => void) => requestAnimationFrame(cb),
  onError = (e: unknown) => console.error(e),
  forceLayout = () => document.body.getClientRects(),
}: {
  keyPolicy?: KeyPolicy;
  raf?: (cb: () => void) => void;
  onError?: (e: unknown) => void;
  forceLayout?: () => void;
} = {}): DomBatcher {
  let queue: Job[] = [];
  let byKey = new Map<string, Job>();
  let scheduled = false;
  const stats = { frames: 0, rounds: 0, jobs: 0, errors: 0 };

  const guard = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      // một callback lỗi không được làm hỏng cả frame (bản gốc dùng ErrorUtils.applyWithGuard)
      stats.errors++;
      onError(e);
    }
  };

  function flush() {
    scheduled = false;
    stats.frames++;
    // mutate có thể xếp thêm job: chạy thêm vòng ngay trong frame này
    while (queue.length) {
      stats.rounds++;
      const jobs = queue;
      queue = [];
      byKey = new Map();
      forceLayout(); // ép layout một lần, mọi query sau đó đọc giá trị đã tính sẵn
      for (const job of jobs) if (!job.deleted) guard(() => (job.output = job.query()));
      for (const job of jobs) if (!job.deleted) guard(() => job.mutate(job.output));
      stats.jobs += jobs.length;
    }
  }

  function schedule<T>(query: Query<T> | null, mutate: Mutate<T> | null, key?: string): Scheduled {
    if (!query && !mutate) return { cancel() {} };
    if (key !== undefined && byKey.has(key)) {
      const existing = byKey.get(key)!;
      if (keyPolicy === 'first') return { cancel() {} };
      existing.deleted = true; // 'last': bỏ job cũ, giữ job mới
    }
    const job: Job = {
      query: (query ?? (() => undefined)) as Query<unknown>,
      mutate: (mutate ?? (() => {})) as Mutate<unknown>,
      key,
      deleted: false,
    };
    queue.push(job);
    if (key !== undefined) byKey.set(key, job);
    if (!scheduled) {
      scheduled = true;
      raf(flush);
    }
    return {
      cancel() {
        job.deleted = true;
        if (key !== undefined && byKey.get(key) === job) byKey.delete(key);
      },
    };
  }

  return { schedule, flush, stats };
}

/** Dùng chung một batcher cho cả trang, giống module singleton của Facebook. */
export const domBatcher = typeof window !== 'undefined' ? createDomBatcher() : null;
