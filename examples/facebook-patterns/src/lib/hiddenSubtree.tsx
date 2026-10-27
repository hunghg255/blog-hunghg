import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * "Cây con đang bị ẩn" (ý tưởng từ HiddenSubtreeContextProvider của Facebook).
 *
 * Khi một màn hình vẫn được giữ mount nhưng không hiển thị (keep-alive tab, dialog bị che…),
 * mọi thứ bên trong cần biết để tự dừng: video, timer, animation, log impression.
 *
 * Có 2 context:
 * - Reactive: đổi giá trị -> component dùng nó re-render. Tiện, nhưng đắt nếu cây lớn.
 * - Passive: chỉ có getCurrentState() + subscribe(). Đổi trạng thái KHÔNG làm re-render;
 *   ai quan tâm thì tự subscribe (dừng timer, pause video…). Facebook dùng loại này cho
 *   hầu hết các hook hạ tầng.
 */

export interface HiddenState {
  /** bị ẩn hẳn (vd: tab không active) */
  hidden: boolean;
  /** vẫn thấy nhưng ở "nền" (vd: browser tab ẩn, bị dialog che) */
  backgrounded: boolean;
}

export interface HiddenSubtreeStore {
  getCurrentState(): HiddenState;
  /** chỉ được gọi khi trạng thái gộp THỰC SỰ đổi */
  subscribe(listener: (state: HiddenState) => void): () => void;
}

const VISIBLE: HiddenState = { hidden: false, backgrounded: false };

const HiddenSubtreeContext = createContext<HiddenState>(VISIBLE);
const HiddenSubtreePassiveContext = createContext<HiddenSubtreeStore>({
  getCurrentState: () => VISIBLE,
  subscribe: () => () => {},
});

// Con bị ẩn nếu chính nó HOẶC bất kỳ tổ tiên nào bị ẩn (phép OR).
const merge = (a: HiddenState, b: HiddenState): HiddenState => ({
  hidden: a.hidden || b.hidden,
  backgrounded: a.backgrounded || b.backgrounded,
});
const same = (a: HiddenState, b: HiddenState) =>
  a.hidden === b.hidden && a.backgrounded === b.backgrounded;

export function HiddenSubtreeProvider({
  hidden,
  backgrounded = false,
  ignoreParent = false,
  children,
}: {
  hidden: boolean;
  backgrounded?: boolean;
  /** không gộp với tổ tiên (vd: một layer nổi lên trên cùng luôn hiển thị) */
  ignoreParent?: boolean;
  children: ReactNode;
}) {
  const parent = useContext(HiddenSubtreeContext);
  const parentStore = useContext(HiddenSubtreePassiveContext);

  const ownRef = useRef<HiddenState>({ hidden, backgrounded });
  const lastNotifiedRef = useRef<HiddenState | null>(null);
  const listenersRef = useRef(new Set<(state: HiddenState) => void>());

  const getCurrentState = useCallback(
    () => (ignoreParent ? ownRef.current : merge(ownRef.current, parentStore.getCurrentState())),
    [ignoreParent, parentStore],
  );

  // Gọi khi props của mình đổi HOẶC khi cha báo đổi. Chỉ phát cho listener nếu trạng thái
  // gộp khác lần phát trước: cha đổi backgrounded mà mình đang hidden sẵn thì con không cần biết.
  const notifyIfChanged = useCallback(() => {
    const next = getCurrentState();
    if (lastNotifiedRef.current && same(next, lastNotifiedRef.current)) return;
    lastNotifiedRef.current = next;
    Array.from(listenersRef.current).forEach((listener) => listener(next));
  }, [getCurrentState]);

  // layout effect: listener (vd: pause video) chạy cùng commit với lúc màn hình bị ẩn,
  // trước khi trình duyệt vẽ frame tiếp theo.
  useLayoutEffect(() => {
    ownRef.current = { hidden, backgrounded };
    notifyIfChanged();
  }, [hidden, backgrounded, notifyIfChanged]);

  useEffect(() => {
    if (ignoreParent) return;
    return parentStore.subscribe(notifyIfChanged);
  }, [ignoreParent, parentStore, notifyIfChanged]);

  const store = useMemo<HiddenSubtreeStore>(
    () => ({
      getCurrentState,
      subscribe(listener) {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    }),
    [getCurrentState],
  );

  const merged = ignoreParent ? { hidden, backgrounded } : merge({ hidden, backgrounded }, parent);
  // useMemo theo 2 boolean: giá trị context chỉ đổi tham chiếu khi thực sự đổi
  const value = useMemo(
    () => ({ hidden: merged.hidden, backgrounded: merged.backgrounded }),
    [merged.hidden, merged.backgrounded],
  );

  return (
    <HiddenSubtreeContext.Provider value={value}>
      <HiddenSubtreePassiveContext.Provider value={store}>{children}</HiddenSubtreePassiveContext.Provider>
    </HiddenSubtreeContext.Provider>
  );
}

/** Reactive: component re-render mỗi khi trạng thái đổi. */
export function useHiddenSubtree(): HiddenState {
  return useContext(HiddenSubtreeContext);
}

/** true nếu bị ẩn hoặc đang ở nền. */
export function useIsHidden(): boolean {
  const { hidden, backgrounded } = useContext(HiddenSubtreeContext);
  return hidden || backgrounded;
}

/** Passive: lấy store để tự subscribe, không gây re-render. */
export function useHiddenSubtreePassive(): HiddenSubtreeStore {
  return useContext(HiddenSubtreePassiveContext);
}

/**
 * setInterval tự dừng khi cây con bị ẩn/ở nền và chạy lại khi hiện ra.
 * Dùng store passive nên việc ẩn/hiện không làm component re-render.
 */
export function useVisibleInterval(callback: () => void, ms: number) {
  const store = useHiddenSubtreePassive();
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = (state: HiddenState) => {
      const shouldRun = !state.hidden && !state.backgrounded;
      if (shouldRun && timer === undefined) {
        timer = setInterval(() => callbackRef.current(), ms);
      } else if (!shouldRun && timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    sync(store.getCurrentState());
    const unsubscribe = store.subscribe(sync);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [store, ms]);
}

/** Tab trình duyệt có đang bị ẩn không (Page Visibility API). */
export function useDocumentHidden(): boolean {
  const [hiddenDoc, setHiddenDoc] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  );
  useEffect(() => {
    const onChange = () => setHiddenDoc(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return hiddenDoc;
}
