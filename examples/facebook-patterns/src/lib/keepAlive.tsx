import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { HiddenSubtreeProvider } from './hiddenSubtree';

/**
 * Keep-alive cho các "tab" của SPA (ý tưởng từ CometRouter + MaintainedRouteConfig + CometMainRoutes).
 *
 * Khi rời một tab được cấu hình `maintained`, cây React của nó KHÔNG bị unmount mà được giữ lại
 * (ẩn đi) trong một thời gian `maintainForMs`. Quay lại trong thời gian đó: hiện ra tức thì,
 * nguyên state, nguyên vị trí cuộn. Hết hạn: unmount để trả lại bộ nhớ.
 * Mỗi tab được bọc HiddenSubtreeProvider để code bên trong biết mình đang bị ẩn mà tự dừng.
 */

export interface KeepAliveRouteConfig {
  maintained: boolean;
  /** giữ bao lâu sau khi rời tab; null/undefined = giữ mãi (như Messenger của Facebook) */
  maintainForMs?: number | null;
}

export interface MaintainedEntry {
  key: string;
  /** thời điểm (Date.now()) sẽ bị huỷ, null = không hết hạn */
  expiresAt: number | null;
}

export interface KeepAliveOutletProps {
  activeKey: string;
  render: (key: string) => ReactNode;
  config: Record<string, KeepAliveRouteConfig | undefined>;
  /** giữ tối đa bao nhiêu tab ẩn cùng lúc; vượt quá thì huỷ tab rời đi lâu nhất */
  maxMaintained?: number;
  /**
   * Cách ẩn tab không active:
   * - 'display': display:none (rẻ nhất, nhưng phần tử cuộn bên trong có thể mất scrollTop)
   * - 'content-visibility': content-visibility:hidden, trình duyệt bỏ qua render nhưng giữ
   *   nguyên trạng thái render (kể cả vị trí cuộn của phần tử con).
   */
  hideMode?: 'display' | 'content-visibility';
  onMaintainedChange?: (entries: MaintainedEntry[]) => void;
}

interface KeepAliveInfo {
  routeKey: string;
  active: boolean;
}

const KeepAliveContext = createContext<KeepAliveInfo | null>(null);

/** Cho component bên trong biết nó thuộc tab nào và tab đó có đang active không. */
export function useKeepAliveInfo() {
  return useContext(KeepAliveContext);
}

function nextMaintained(
  list: MaintainedEntry[],
  prevKey: string,
  activeKey: string,
  config: KeepAliveOutletProps['config'],
  maxMaintained: number,
): MaintainedEntry[] {
  // 1. Tab vừa được mở lại: bỏ khỏi danh sách giữ (FB: `withoutKey(A, tabKey)` + clearTimeout).
  let next = list.filter((entry) => entry.key !== activeKey);
  // 2. Tab vừa rời đi: nếu được cấu hình maintained thì giữ lại kèm hạn huỷ.
  const prevConfig = config[prevKey];
  if (prevConfig?.maintained && !next.some((entry) => entry.key === prevKey)) {
    const ttl = prevConfig.maintainForMs;
    next = [...next, { key: prevKey, expiresAt: ttl != null ? Date.now() + ttl : null }];
  }
  // 3. Giới hạn số tab giữ lại: huỷ tab rời đi lâu nhất.
  if (next.length > maxMaintained) next = next.slice(next.length - maxMaintained);
  return next;
}

export function KeepAliveOutlet({
  activeKey,
  render,
  config,
  maxMaintained = Infinity,
  hideMode = 'content-visibility',
  onMaintainedChange,
}: KeepAliveOutletProps) {
  const [state, setState] = useState<{ activeKey: string; maintained: MaintainedEntry[] }>({
    activeKey,
    maintained: [],
  });

  // Tính danh sách giữ lại NGAY TRONG LÚC RENDER khi tab đổi ("adjust state when a prop
  // changes"). Nếu đợi tới effect, commit đổi tab sẽ không còn tab cũ trong cây -> React
  // unmount nó -> mất hết state, đúng điều keep-alive muốn tránh.
  let maintained = state.maintained;
  if (state.activeKey !== activeKey) {
    maintained = nextMaintained(state.maintained, state.activeKey, activeKey, config, maxMaintained);
    setState({ activeKey, maintained });
  }

  // Cấu hình đổi (vd: tắt keep-alive) thì bỏ các tab không còn được phép giữ.
  const allowed = maintained.filter((entry) => config[entry.key]?.maintained);
  if (allowed.length !== maintained.length) {
    maintained = allowed;
    setState({ activeKey, maintained });
  }

  // Hẹn giờ huỷ: đồng bộ timer với danh sách hiện tại. Effect chỉ lo side effect,
  // danh sách là nguồn sự thật duy nhất.
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = timersRef.current;
    const live = new Set(maintained.map((entry) => entry.key));
    timers.forEach((timer, key) => {
      if (!live.has(key)) {
        clearTimeout(timer);
        timers.delete(key);
      }
    });
    maintained.forEach(({ key, expiresAt }) => {
      if (expiresAt == null || timers.has(key)) return;
      timers.set(
        key,
        setTimeout(
          () => {
            timers.delete(key);
            setState((current) => ({
              ...current,
              maintained: current.maintained.filter((entry) => entry.key !== key),
            }));
          },
          Math.max(0, expiresAt - Date.now()),
        ),
      );
    });
  }, [maintained]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    onMaintainedChange?.(maintained);
  }, [maintained, onMaintainedChange]);

  // Thứ tự render ổn định theo lần đầu xuất hiện: đổi tab không làm React di chuyển node DOM
  // (di chuyển node chứa <video>/<iframe> có thể làm chúng tải lại).
  const orderRef = useRef<string[]>([]);
  if (!orderRef.current.includes(activeKey)) orderRef.current = [...orderRef.current, activeKey];

  const liveKeys = new Set([activeKey, ...maintained.map((entry) => entry.key)]);
  const keys = orderRef.current.filter((key) => liveKeys.has(key));

  return (
    <>
      {keys.map((key) => {
        const active = key === activeKey;
        return (
          <div
            key={key}
            data-keepalive-key={key}
            aria-hidden={!active || undefined}
            // inert: tab ẩn không nhận focus/click và trình đọc màn hình bỏ qua
            inert={!active}
            style={
              active
                ? undefined
                : hideMode === 'display'
                  ? { display: 'none' }
                  : { contentVisibility: 'hidden', position: 'absolute', inset: 0, overflow: 'hidden' }
            }
          >
            <HiddenSubtreeProvider hidden={!active} backgrounded={!active}>
              <KeepAliveContext.Provider value={{ routeKey: key, active }}>{render(key)}</KeepAliveContext.Provider>
            </HiddenSubtreeProvider>
          </div>
        );
      })}
    </>
  );
}
