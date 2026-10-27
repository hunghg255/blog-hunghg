import {
  createContext,
  Suspense,
  useContext,
  useId,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

/**
 * Biết khi nào một tương tác (click, điều hướng) đã render XONG mọi thứ nó kích hoạt
 * (ý tưởng từ CometPlaceholder + CometHeroFallbackTracker + CometHeroInteractionImpl).
 *
 * Mẹo: fallback của mỗi Suspense render thêm một component vô hình. Fallback đang hiện
 * = component đó đang mount = "còn đang chờ". Khi không còn fallback nào đang mount,
 * và frame tiếp theo đã vẽ, tương tác được coi là hoàn tất.
 */

export interface InteractionSpan {
  name: string;
  /** ms kể từ lúc tương tác bắt đầu */
  start: number;
  end: number | null;
}

export interface Interaction {
  id: number;
  name: string;
  status: 'pending' | 'done' | 'aborted';
  /** ms tới khi hoàn tất / bị huỷ */
  duration: number | null;
  abortReason?: string;
  spans: InteractionSpan[];
}

const COMMIT_SPAN = 'interaction-commit';

export class InteractionTracker {
  private current: Interaction | null = null;
  private startTime = 0;
  private pending = new Map<string, InteractionSpan>();
  /** mọi span của interaction hiện tại theo uuid (kể cả đã xong) */
  private spansById = new Map<string, InteractionSpan>();
  private frame = 0;
  private nextId = 1;
  private snapshot: Interaction | null = null;
  private listeners = new Set<() => void>();
  private doneListeners = new Set<(interaction: Interaction) => void>();
  private abortListeners = new Set<(interaction: Interaction) => void>();

  constructor() {
    if (typeof document !== 'undefined') {
      // Facebook huỷ interaction khi bị ẩn: tab nền không vẽ, số đo sẽ sai.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.abort('hidden');
      });
    }
  }

  /**
   * Bắt đầu một tương tác.
   * waitForCommit: điều hướng bằng startTransition (React Router 7, Next.js App Router…) GIỮ
   * UI cũ thay vì hiện fallback, nên không có fallback nào đăng ký và tương tác sẽ bị coi là
   * "xong" trước khi trang mới kịp commit. Bật cờ này rồi gọi `commit()` từ layout effect
   * của trang đích.
   */
  start(name: string, { waitForCommit = false } = {}): number {
    if (this.current?.status === 'pending') this.abort('replaced');
    this.pending.clear();
    this.spansById.clear();
    this.startTime = performance.now();
    this.current = { id: this.nextId++, name, status: 'pending', duration: null, spans: [] };
    if (waitForCommit) this.register(COMMIT_SPAN, 'commit');
    this.emit();
    // Có thể không có Suspense nào treo cả: vẫn phải tự kiểm tra sau khi React commit.
    this.scheduleCheck();
    return this.current.id;
  }

  /** Trang đích đã commit (gọi trong useLayoutEffect của nó) — dùng với waitForCommit. */
  commit() {
    this.remove(COMMIT_SPAN);
  }

  /** Được gọi từ fallback đang mount. */
  register(uuid: string, name: string) {
    if (this.current?.status !== 'pending') return;
    // Cùng một fallback mount lại (StrictMode chạy effect 2 lần, hoặc fallback bị
    // unmount/mount lại tại cùng vị trí): dùng lại span cũ thay vì tạo span mới.
    let span = this.spansById.get(uuid);
    if (span) {
      span.end = null;
    } else {
      span = { name, start: this.now(), end: null };
      this.spansById.set(uuid, span);
      this.current.spans.push(span);
    }
    this.pending.set(uuid, span);
    cancelAnimationFrame(this.frame);
    this.emit();
  }

  /** Fallback unmount = nội dung thật đã thế chỗ. */
  remove(uuid: string) {
    const span = this.pending.get(uuid);
    if (!span) return;
    span.end = this.now();
    this.pending.delete(uuid);
    this.emit();
    this.scheduleCheck();
  }

  /** Giữ tương tác chưa xong bằng tay (vd: chờ ảnh hero tải). Trả về hàm nhả. */
  hold(name: string): () => void {
    const uuid = `hold-${Math.random().toString(36).slice(2)}`;
    this.register(uuid, name);
    return () => this.remove(uuid);
  }

  abort(reason: string) {
    if (this.current?.status !== 'pending') return;
    cancelAnimationFrame(this.frame);
    this.current.status = 'aborted';
    this.current.abortReason = reason;
    this.current.duration = this.now();
    this.pending.clear();
    this.emit();
    this.abortListeners.forEach((listener) => listener(this.snapshot!));
  }

  onDone(listener: (interaction: Interaction) => void) {
    this.doneListeners.add(listener);
    return () => this.doneListeners.delete(listener);
  }

  /** Bị huỷ: tab ẩn, tương tác mới thay thế, hoặc gọi abort() bằng tay. */
  onAbort(listener: (interaction: Interaction) => void) {
    this.abortListeners.add(listener);
    return () => this.abortListeners.delete(listener);
  }

  // --- external store cho UI ---
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;

  private now() {
    return Math.round(performance.now() - this.startTime);
  }

  private emit() {
    // bản sao bất biến để useSyncExternalStore phát hiện thay đổi
    this.snapshot = this.current
      ? { ...this.current, spans: this.current.spans.map((span) => ({ ...span })) }
      : null;
    this.listeners.forEach((listener) => listener());
  }

  private scheduleCheck() {
    const interaction = this.current;
    if (!interaction || interaction.status !== 'pending' || this.pending.size > 0) return;
    cancelAnimationFrame(this.frame);
    // rAF: callback chạy ngay trước frame kế tiếp, tức là sau khi commit vừa rồi được vẽ.
    // Trong lúc chờ, nếu một Suspense khác treo (register) thì frame bị huỷ.
    this.frame = requestAnimationFrame(() => {
      if (this.current !== interaction || interaction.status !== 'pending' || this.pending.size > 0) return;
      interaction.status = 'done';
      interaction.duration = this.now();
      this.emit();
      this.doneListeners.forEach((listener) => listener(this.snapshot!));
    });
  }
}

const TrackerContext = createContext<InteractionTracker | null>(null);

export function InteractionTrackerProvider({
  tracker,
  children,
}: {
  tracker: InteractionTracker;
  children: ReactNode;
}) {
  return <TrackerContext.Provider value={tracker}>{children}</TrackerContext.Provider>;
}

export function useInteraction(tracker: InteractionTracker) {
  return useSyncExternalStore(tracker.subscribe, tracker.getSnapshot, tracker.getSnapshot);
}

function FallbackTracker({ name }: { name: string }) {
  const tracker = useContext(TrackerContext);
  const uuid = useId();
  // layout effect: đăng ký trong cùng commit với lúc fallback xuất hiện, trước khi vẽ
  useLayoutEffect(() => {
    if (!tracker) return;
    tracker.register(uuid, name);
    return () => tracker.remove(uuid);
  }, [tracker, uuid, name]);
  return null;
}

/** Suspense có báo cáo: mỗi lần fallback hiện là một "span" trong timeline tương tác. */
export function TrackedSuspense({
  name,
  fallback,
  children,
}: {
  name: string;
  fallback: ReactNode;
  children: ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <>
          {fallback}
          <FallbackTracker name={name} />
        </>
      }
    >
      {children}
    </Suspense>
  );
}
