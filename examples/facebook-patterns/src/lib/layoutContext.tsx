import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';

/**
 * Con tự biết vị trí của mình (isFirst/isLast/index) mà cha không phải truyền prop
 * (ý tưởng từ createLayoutContext của Facebook, cùng họ với "descendants" của Reach UI).
 *
 * Mỗi con đăng ký DOM node của nó qua ref callback. Provider giữ danh sách node,
 * sắp theo thứ tự trong DOM bằng compareDocumentPosition. Đúng cả khi con nằm sâu
 * trong wrapper, render có điều kiện hay đổi thứ tự.
 */

export interface Layout<V> {
  isFirst: boolean;
  isLast: boolean;
  index: number;
  total: number;
  values: V[];
}

type Entry<V> = { node: Element; value: V };
type Action<V> = { add: Element | null; remove: Element | null; value: V } | { resort: true };

function byDocumentOrder<V>(a: Entry<V>, b: Entry<V>) {
  return a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function reducer<V>(state: Entry<V>[], action: Action<V>) {
  if ('resort' in action) return [...state].sort(byDocumentOrder);
  const { add, remove, value } = action;
  const next = state.filter((e) => e.node !== add && e.node !== remove);
  if (add) next.push({ node: add, value });
  return next.sort(byDocumentOrder);
}

export function createLayoutContext<V = undefined>() {
  const Ctx = createContext<{
    dispatch: (a: Action<V>) => void;
    indexOf: Map<Element, number>;
    values: V[];
  } | null>(null);

  function Provider({ children }: { children: ReactNode }) {
    const [entries, dispatch] = useReducer(reducer<V>, []);
    // Khác bản gốc: con đổi chỗ (key giữ nguyên) thì React chỉ dời node, ref callback không
    // chạy lại, danh sách sẽ sai thứ tự. Sau mỗi lần render, kiểm tra lại và sắp lại nếu cần.
    useLayoutEffect(() => {
      for (let i = 1; i < entries.length; i++) {
        if (byDocumentOrder(entries[i - 1], entries[i]) > 0) {
          dispatch({ resort: true });
          return;
        }
      }
    });
    const value = useMemo(() => {
      const indexOf = new Map<Element, number>();
      entries.forEach((e, i) => indexOf.set(e.node, i));
      return { dispatch, indexOf, values: entries.map((e) => e.value) };
    }, [entries]);
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
  }

  /** Trả về [layout của mình (null ở lần render đầu), ref callback gắn vào phần tử gốc]. */
  function useLayout(value: V): [Layout<V> | null, (node: Element | null) => void] {
    const ctx = useContext(Ctx);
    if (!ctx) throw new Error('useLayout phải nằm trong Provider');
    const nodeRef = useRef<Element | null>(null);
    const { dispatch, indexOf, values } = ctx;
    const index = nodeRef.current ? indexOf.get(nodeRef.current) : undefined;
    const layout =
      index === undefined
        ? null
        : { isFirst: index === 0, isLast: index === values.length - 1, index, total: values.length, values };
    const ref = useCallback(
      (node: Element | null) => {
        // đổi node (hoặc value) thì gỡ node cũ, thêm node mới trong một action
        dispatch({ add: node, remove: nodeRef.current, value });
        nodeRef.current = node;
      },
      [dispatch, value],
    );
    return [layout, ref];
  }

  return { Provider, useLayout };
}
