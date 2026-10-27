import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

/**
 * Khung composer dạng plugin (ý tưởng từ CometComposer.react + reduceComposerViewState
 * + useComposerViewStateReducer + useContextRef của Facebook).
 *
 * Composer chỉ giữ MỘT state. Mỗi plugin tự đăng ký:
 * - reducer: xử lý action của mình trên state chung,
 * - dirty checker: "phần của tôi đã bị sửa chưa?",
 * - validator: lỗi chặn đăng,
 * - pre-submit hook: được hỏi trước khi đăng (vd mở hộp thoại xác nhận).
 * Không plugin nào biết plugin khác. isDirty = OR của mọi checker.
 */

export interface ComposerAction {
  type: string;
  [key: string]: unknown;
}

export type ComposerReducer<S> = (state: S, action: ComposerAction) => S;
export type DirtyChecker<S> = (beginning: S, current: S) => boolean;
/** trả chuỗi lỗi hoặc null */
export type Validator<S> = (state: S) => string | null;
/** true = cho đăng tiếp, false = dừng */
export type PreSubmitHook<S> = (state: S) => Promise<boolean>;

export type SubmitResult<S> =
  | { status: 'invalid'; errors: string[] }
  | { status: 'halted' }
  | { status: 'committed'; state: S };

/**
 * Tập có đếm tham chiếu: cùng một hàm được đăng ký 2 lần (2 component dùng chung) thì
 * chỉ chạy 1 lần, và chỉ bị gỡ khi lần đăng ký cuối cùng được gỡ. Thứ tự = thứ tự đăng ký đầu.
 */
export class RefCountedRegistry<F> {
  private counts = new Map<F, number>();

  add(item: F): () => void {
    this.counts.set(item, (this.counts.get(item) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = this.counts.get(item);
      if (n === undefined) return;
      if (n <= 1) this.counts.delete(item);
      else this.counts.set(item, n - 1);
    };
  }

  values() {
    return Array.from(this.counts.keys());
  }

  get size() {
    return this.counts.size;
  }
}

export interface ComposerSnapshot<S> {
  state: S;
  isDirty: boolean;
  errors: string[];
}

export class ComposerStore<S> {
  readonly reducers = new RefCountedRegistry<ComposerReducer<S>>();
  readonly checkers = new RefCountedRegistry<DirtyChecker<S>>();
  readonly validators = new RefCountedRegistry<Validator<S>>();
  readonly hooks = new RefCountedRegistry<PreSubmitHook<S>>();
  private listeners = new Set<() => void>();
  private snapshot: ComposerSnapshot<S>;

  constructor(private readonly beginning: S) {
    this.snapshot = { state: beginning, isDirty: false, errors: [] };
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** Chạy lần lượt mọi reducer đang đăng ký, rồi tính lại isDirty và lỗi. */
  dispatch = (action: ComposerAction) => {
    let state = this.snapshot.state;
    for (const reducer of this.reducers.values()) state = reducer(state, action);
    this.commit(state);
  };

  /**
   * Plugin vừa mount/unmount: tính lại isDirty/lỗi với tập checker mới. Chỉ báo cho consumer
   * khi kết quả thật sự đổi; nếu luôn báo thì plugin đăng ký lại mỗi render sẽ thành vòng lặp
   * render vô hạn.
   */
  recompute = () => this.commit(this.snapshot.state);

  async submit(): Promise<SubmitResult<S>> {
    const { state, errors } = this.snapshot;
    if (errors.length > 0) return { status: 'invalid', errors };
    // hook chạy NỐI TIẾP: hook sau chỉ được hỏi khi hook trước đã cho qua
    for (const hook of this.hooks.values()) {
      const ok = await hook(state);
      if (!ok) return { status: 'halted' };
    }
    return { status: 'committed', state };
  }

  private commit(state: S) {
    const isDirty = this.checkers.values().some((check) => check(this.beginning, state));
    const errors = this.validators
      .values()
      .map((validate) => validate(state))
      .filter((e): e is string => e != null);
    const prev = this.snapshot;
    // giữ nguyên tham chiếu nếu không có gì đổi: consumer không phải render lại
    if (prev.state === state && prev.isDirty === isDirty && sameStrings(prev.errors, errors))
      return;
    this.snapshot = {
      state,
      isDirty,
      errors: sameStrings(prev.errors, errors) ? prev.errors : errors,
    };
    this.listeners.forEach((l) => l());
  }
}

function sameStrings(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// ---------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ComposerContext = createContext<ComposerStore<any> | null>(null);

export function useComposerStore<S>(beginning: S) {
  const [store] = useState(() => new ComposerStore(beginning));
  return store;
}

export function useComposer<S>() {
  const store = useContext(ComposerContext) as ComposerStore<S> | null;
  if (!store) throw new Error('useComposer phải nằm trong <ComposerContext.Provider>');
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snapshot, dispatch: store.dispatch, store };
}

export interface PluginParts<S> {
  reducer?: ComposerReducer<S>;
  isAltered?: DirtyChecker<S>;
  validate?: Validator<S>;
  beforeSubmit?: PreSubmitHook<S>;
}

/**
 * Plugin tự đăng ký các phần của mình.
 *
 * Khác bản gốc: bản gốc đăng ký CHÍNH hàm plugin truyền vào, với deps [hàm]. Plugin truyền
 * hàm inline thì mỗi lần render bị gỡ ra rồi đăng ký lại ở CUỐI Map, thứ tự reducer đổi
 * theo thứ tự render. Ở đây mỗi plugin đăng ký một wrapper ỔN ĐỊNH (tạo một lần), wrapper đọc
 * bản mới nhất qua ref, nên thứ tự chỉ phụ thuộc thứ tự mount.
 */
export function usePlugin<S>(parts: PluginParts<S>) {
  const { store } = useComposer<S>();
  const latest = useRef(parts);
  useLayoutEffect(() => {
    latest.current = parts;
  });

  const has = {
    reducer: !!parts.reducer,
    isAltered: !!parts.isAltered,
    validate: !!parts.validate,
    beforeSubmit: !!parts.beforeSubmit,
  };

  useEffect(() => {
    const releases: Array<() => void> = [];
    if (has.reducer)
      releases.push(store.reducers.add((s, a) => latest.current.reducer?.(s, a) ?? s));
    if (has.isAltered)
      releases.push(store.checkers.add((b, c) => latest.current.isAltered?.(b, c) ?? false));
    if (has.validate)
      releases.push(store.validators.add((s) => latest.current.validate?.(s) ?? null));
    if (has.beforeSubmit)
      releases.push(
        store.hooks.add((s) => latest.current.beforeSubmit?.(s) ?? Promise.resolve(true)),
      );
    store.recompute();
    return () => {
      releases.forEach((release) => release());
      store.recompute();
    };
  }, [store, has.reducer, has.isAltered, has.validate, has.beforeSubmit]);
}

/** Hỏi trước khi rời trang khi còn thay đổi chưa đăng. */
export function useWarnBeforeUnload(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = ''; // trình duyệt cũ cần gán returnValue
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);
}
