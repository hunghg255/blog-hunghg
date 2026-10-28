/**
 * Chỉ mục subscription theo record, ý tưởng từ RelayStoreSubscriptionsUsingMapByID (viết lại):
 * - mỗi subscription nhớ tập record nó đã đọc (seen); chỉ mục là Map recordId → Set<subscription>,
 * - store đổi một số record thì chỉ đọc lại subscription dính tới chúng, mỗi subscription tối đa một lần/vòng,
 * - đọc lại xong thì dựng lại chỉ mục theo tập record mới, và chỉ báo khi dữ liệu thật sự khác (structural sharing).
 */
import { recycleNodesInto } from './recycleNodes';

export type Reader = (id: string) => unknown;
export type Selector<T> = (read: Reader) => T;

interface Subscription<T> {
  selector: Selector<T>;
  callback: (data: T) => void;
  data: T;
  seen: Set<string>;
  notifiedRevision: number;
  disposed: boolean;
}

export interface UpdateStats {
  /** số subscription bị đọc lại */
  reads: number;
  /** số callback được gọi (dữ liệu thật sự khác) */
  notified: number;
}

export class SubscriptionIndex {
  private byRecord = new Map<string, Set<Subscription<unknown>>>();
  private revision = 0;
  totalReads = 0;

  constructor(private getRecord: (id: string) => unknown) {}

  /** Chạy selector qua một reader có ghi lại mọi ID đã đọc. */
  private read<T>(selector: Selector<T>) {
    const seen = new Set<string>();
    const data = selector((id) => {
      seen.add(id);
      return this.getRecord(id);
    });
    this.totalReads++;
    return { data, seen };
  }

  subscribe<T>(
    selector: Selector<T>,
    callback: (data: T) => void,
  ): { data: T; dispose: () => void } {
    const { data, seen } = this.read(selector);
    const sub: Subscription<T> = {
      selector,
      callback,
      data,
      seen,
      notifiedRevision: this.revision,
      disposed: false,
    };
    this.index(sub as Subscription<unknown>, new Set(), seen);
    return {
      data,
      dispose: () => {
        if (sub.disposed) return;
        sub.disposed = true;
        // gỡ theo tập seen HIỆN TẠI, không phải tập lúc subscribe
        this.index(sub as Subscription<unknown>, sub.seen, new Set());
      },
    };
  }

  /** Báo cho index biết các record vừa đổi. */
  update(changedIds: Iterable<string>): UpdateStats {
    this.revision++;
    const stats: UpdateStats = { reads: 0, notified: 0 };
    for (const id of changedIds) {
      const subs = this.byRecord.get(id);
      if (!subs) continue;
      // sao chép: callback có thể subscribe/dispose làm đổi Set đang duyệt
      for (const sub of [...subs]) {
        if (sub.disposed || sub.notifiedRevision === this.revision) continue;
        sub.notifiedRevision = this.revision;
        stats.reads++;
        const { data, seen } = this.read(sub.selector);
        const next = recycleNodesInto(sub.data, data);
        const oldSeen = sub.seen;
        sub.seen = seen;
        this.index(sub, oldSeen, seen);
        if (next !== sub.data) {
          sub.data = next;
          stats.notified++;
          sub.callback(next);
        }
      }
    }
    return stats;
  }

  private index(sub: Subscription<unknown>, oldSeen: Set<string>, newSeen: Set<string>) {
    oldSeen.forEach((id) => {
      if (newSeen.has(id)) return;
      const set = this.byRecord.get(id);
      if (!set) return;
      set.delete(sub);
      if (set.size === 0) this.byRecord.delete(id);
    });
    newSeen.forEach((id) => {
      if (oldSeen.has(id)) return;
      let set = this.byRecord.get(id);
      if (!set) this.byRecord.set(id, (set = new Set()));
      set.add(sub);
    });
  }

  /** Số subscription đang được chỉ mục dưới một record (cho demo/test). */
  countFor(id: string) {
    return this.byRecord.get(id)?.size ?? 0;
  }
  get indexedRecordCount() {
    return this.byRecord.size;
  }
}
