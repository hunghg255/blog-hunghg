/**
 * Store optimistic theo lớp, ý tưởng từ RelayOptimisticRecordSource + RelayRecordSourceMutator +
 * RelayPublishQueue (viết lại từ đầu, rút gọn):
 * - dữ liệu server nằm ở `base`; khi có update optimistic, một lớp phủ (overlay) được đặt lên trên,
 * - update ghi vào một "sổ nháp" (sink) theo kiểu copy-on-write rồi mới publish vào lớp đang hoạt động,
 * - có dữ liệu server mới: bỏ lớp phủ, ghi vào base, rồi áp lại mọi update optimistic còn sống (rebase).
 */

export type StoreRecord = { readonly id: string; readonly [field: string]: unknown };
/** null = biết chắc record không tồn tại; undefined = không biết. */
export type RecordValue = StoreRecord | null | undefined;

export interface ReadableSource {
  get(id: string): RecordValue;
  ids(): string[];
}

/** Đánh dấu "record đã bị xoá ở lớp này", khác với "lớp này không đụng tới record". */
export const REMOVED: unique symbol = Symbol('removed');

export class BaseSource implements ReadableSource {
  private map = new Map<string, StoreRecord | null>();
  constructor(initial: StoreRecord[] = []) {
    initial.forEach((r) => this.map.set(r.id, Object.freeze({ ...r })));
  }
  get(id: string): RecordValue {
    return this.map.get(id);
  }
  set(id: string, record: StoreRecord | null) {
    this.map.set(id, record);
  }
  ids() {
    return [...this.map.keys()];
  }
}

export class OverlaySource implements ReadableSource {
  readonly layer = new Map<string, StoreRecord | null | typeof REMOVED>();
  constructor(readonly base: ReadableSource) {}
  get(id: string): RecordValue {
    if (this.layer.has(id)) {
      const v = this.layer.get(id)!;
      return v === REMOVED ? undefined : v;
    }
    return this.base.get(id);
  }
  set(id: string, record: StoreRecord | null) {
    this.layer.set(id, record);
  }
  /** Xoá record ở lớp phủ: đặt sentinel để che bản ở base. */
  remove(id: string) {
    this.layer.set(id, REMOVED);
  }
  ids() {
    const out = new Set(this.base.ids());
    this.layer.forEach((v, id) => (v === REMOVED ? out.delete(id) : out.add(id)));
    return [...out];
  }
}

/** Sổ nháp của một updater: chỉ chứa record bị sửa, đọc thì xem sổ nháp trước rồi tới nguồn. */
export class Mutator {
  readonly sink = new Map<string, Record<string, unknown> | null>();
  constructor(private source: ReadableSource) {}

  get(id: string, field: string): unknown {
    for (const layer of [this.sink, this.source]) {
      const rec = layer.get(id);
      if (rec === null) return null; // record bị xoá ở lớp trên che lớp dưới
      if (rec && field in rec) return rec[field];
    }
    return undefined;
  }
  exists(id: string) {
    const s = this.sink.get(id);
    if (s !== undefined) return s !== null;
    return this.source.get(id) != null;
  }
  set(id: string, field: string, value: unknown) {
    let draft = this.sink.get(id);
    if (draft == null) {
      if (draft === null || this.source.get(id) == null)
        throw new Error(`Record ${id} không tồn tại`);
      draft = { id }; // copy-on-write: chỉ chép field nào bị ghi
      this.sink.set(id, draft);
    }
    draft[field] = value;
  }
  create(id: string, fields: Record<string, unknown> = {}) {
    if (this.exists(id)) throw new Error(`Record ${id} đã tồn tại`);
    this.sink.set(id, { ...fields, id });
  }
  remove(id: string) {
    this.sink.set(id, null);
  }
}

export type Updater = (m: Mutator) => void;
export interface OptimisticUpdate {
  readonly label: string;
  readonly apply: Updater;
}

export class LayeredStore {
  readonly base: BaseSource;
  overlay: OverlaySource | null = null;
  private listeners = new Set<() => void>();
  version = 0;

  constructor(initial: StoreRecord[]) {
    this.base = new BaseSource(initial);
  }
  source(): ReadableSource {
    return this.overlay ?? this.base;
  }
  snapshot() {
    if (this.overlay) throw new Error('Đã có snapshot');
    this.overlay = new OverlaySource(this.base);
  }
  restore() {
    this.overlay = null;
  }
  /** Ghi sổ nháp vào lớp đang hoạt động; mỗi record bị sửa là một object mới (bất biến). */
  publish(sink: Mutator['sink']) {
    const target = this.overlay ?? this.base;
    sink.forEach((draft, id) => {
      if (draft === null) {
        if (target instanceof OverlaySource) target.remove(id);
        else target.set(id, null);
        return;
      }
      const current = target.get(id);
      target.set(id, Object.freeze({ ...(current ?? {}), ...draft, id }));
    });
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  notify() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }
}

export interface RunStats {
  committed: number;
  reapplied: number;
  applied: number;
  rebased: boolean;
  errors: string[];
}

export class PublishQueue {
  private pendingData: Updater[] = [];
  private pendingOptimistic = new Set<OptimisticUpdate>();
  private applied = new Set<OptimisticUpdate>();
  private needsRebase = false;
  onError: (label: string, error: unknown) => void = () => {};

  constructor(private store: LayeredStore) {}

  get appliedUpdates(): OptimisticUpdate[] {
    return [...this.applied, ...this.pendingOptimistic];
  }

  applyUpdate(update: OptimisticUpdate) {
    if (this.applied.has(update) || this.pendingOptimistic.has(update))
      throw new Error('Update đã được áp');
    this.pendingOptimistic.add(update);
  }
  revertUpdate(update: OptimisticUpdate) {
    if (this.pendingOptimistic.delete(update)) return;
    if (this.applied.delete(update)) this.needsRebase = true;
  }
  revertAll() {
    this.pendingOptimistic.clear();
    if (this.applied.size) this.needsRebase = true;
    this.applied.clear();
  }
  /** Dữ liệu thật từ server (hoặc commitUpdate): luôn ghi vào base, nên phải rebase. */
  commit(updater: Updater) {
    this.pendingData.push(updater);
    this.needsRebase = true;
  }

  run(): RunStats {
    const stats: RunStats = { committed: 0, reapplied: 0, applied: 0, rebased: false, errors: [] };
    const guard = (label: string, fn: Updater, source: ReadableSource) => {
      const m = new Mutator(source);
      try {
        fn(m);
        return m.sink;
      } catch (e) {
        stats.errors.push(label);
        this.onError(label, e);
        return null; // updater lỗi: bỏ cả sổ nháp, không để ghi dở
      }
    };

    // 1. Có dữ liệu server mới hoặc vừa gỡ một update đã áp: bỏ lớp phủ
    if (this.needsRebase && this.store.overlay) {
      this.store.restore();
      stats.rebased = true;
    }
    // 2. Ghi dữ liệu server vào base
    for (const updater of this.pendingData) {
      const sink = guard('commit', updater, this.store.base);
      if (sink) this.store.publish(sink);
      stats.committed++;
    }
    this.pendingData = [];
    // 3. Dựng lại lớp phủ: áp lại update cũ (nếu vừa bỏ lớp phủ) rồi update mới
    if (this.pendingOptimistic.size || (stats.rebased && this.applied.size)) {
      if (!this.store.overlay) this.store.snapshot();
      if (stats.rebased) {
        this.applied.forEach((u) => {
          const sink = guard(u.label, u.apply, this.store.source());
          if (sink) this.store.publish(sink);
          stats.reapplied++;
        });
      }
      this.pendingOptimistic.forEach((u) => {
        const sink = guard(u.label, u.apply, this.store.source());
        if (sink) this.store.publish(sink);
        this.applied.add(u);
        stats.applied++;
      });
      this.pendingOptimistic.clear();
    }
    this.needsRebase = false;
    this.store.notify();
    return stats;
  }
}
