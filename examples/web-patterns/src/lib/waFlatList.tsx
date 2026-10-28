/**
 * Danh sách ảo (virtualized list) tái dùng key React, kiểu FlatList của WhatsApp Web 2020
 * (module `bgheieccaj` FlatList + `dhgihfccic` KeyPool + `ffahjhaig` FlatListItem).
 *
 * - KeyPool: item mới vào cửa sổ nhận lại key React của item vừa rời đi, nên React chỉ cập nhật
 *   props cho DOM sẵn có, không unmount/mount. Kết quả sắp theo key nên thứ tự con không đổi, React
 *   không phải di chuyển node DOM; vị trí do `translateY` quyết định.
 * - Overscan bất đối xứng: phần đệm không dùng được ở đầu danh sách dồn sang cuối và ngược lại.
 * - Transition 200ms chỉ khi CÙNG item đổi offset (đổi thứ tự chat), không khi key vừa bị tái dùng.
 * - Cuộn gom theo requestAnimationFrame; trong lúc cuộn tắt pointer-events, bật lại sau 150ms.
 *
 * Khác bản gốc: tìm cửa sổ bằng binary search, zIndex nằm trong phép so sánh của memo (bản gốc
 * so `this.props.zIndex != this.props.zIndex`, luôn false), và cờ pointer-events khởi tạo đúng.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface FlatItem {
  itemKey: string;
  height?: number;
}

export interface Keyed<T> {
  rctKey: number;
  item: T;
  index: number;
}

export class KeyPool {
  private keyOf = new Map<string, number>();
  private used = new Set<number>();

  /**
   * Gán key React (số nhỏ) cho các item của cửa sổ hiện tại. Item đã có key giữ key cũ;
   * item mới lấy key của item vừa rời cửa sổ, thiếu thì cấp số nhỏ nhất chưa dùng.
   */
  assign<T extends FlatItem>(items: readonly T[], firstIndex = 0, sortByKey = true): Keyed<T>[] {
    const nextKeyOf = new Map<string, number>();
    const free = new Set(this.used);
    for (const item of items) {
      const key = this.keyOf.get(item.itemKey);
      if (key !== undefined) {
        nextKeyOf.set(item.itemKey, key);
        free.delete(key);
      }
    }
    // Key của item vừa rời cửa sổ được dùng lại trước, rồi mới tới số nhỏ nhất chưa ai giữ.
    const recycled = [...free];
    const nextUsed = new Set(nextKeyOf.values());
    let n = 0;
    const out = items.map((item, i): Keyed<T> => {
      let key = nextKeyOf.get(item.itemKey);
      if (key === undefined) {
        key = recycled.pop();
        while (key === undefined && nextUsed.has(n)) n++;
        if (key === undefined) key = n++;
        nextKeyOf.set(item.itemKey, key);
        nextUsed.add(key);
      }
      return { rctKey: key, item, index: firstIndex + i };
    });
    this.keyOf = nextKeyOf;
    this.used = nextUsed;
    return sortByKey ? out.sort((a, b) => a.rctKey - b.rctKey) : out;
  }
}

/** offsets[i] = tổng chiều cao các item trước i; offsets[n] = tổng chiều dài list. */
export function computeOffsets(items: readonly FlatItem[], defaultHeight: number): number[] {
  const offsets = new Array<number>(items.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < items.length; i++) offsets[i + 1] = offsets[i] + (items[i].height ?? defaultHeight);
  return offsets;
}

/** Item đầu tiên có đáy vượt qua `y`, tìm bằng binary search trên offsets. */
function firstEndingAfter(offsets: readonly number[], y: number) {
  let lo = 0;
  let hi = offsets.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid + 1] > y) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export interface WindowRange {
  first: number;
  last: number;
}

/**
 * Cửa sổ cần render: các item giao với [scroll, scroll + viewport], cộng `extra` item mỗi phía.
 * Ở sát đầu list thì phần đệm phía trước không dùng được, nên dồn sang phía sau (và ngược lại),
 * để số item render luôn xấp xỉ nhau.
 */
export function computeWindow(offsets: readonly number[], scroll: number, viewport: number, extra: number): WindowRange {
  const count = offsets.length - 1;
  if (count <= 0) return { first: 0, last: -1 };
  const start = firstEndingAfter(offsets, Math.max(scroll, 0));
  const end = firstEndingAfter(offsets, Math.min(offsets[start] + viewport, offsets[count]) - 0.001);
  const after = extra + Math.max(0, extra - start);
  const before = extra + Math.max(0, end + extra - (count - 1));
  return { first: Math.max(start - before, 0), last: Math.min(end + after, count - 1) };
}

interface RowProps<T> {
  item: T;
  offset: number;
  height: number;
  zIndex: number;
  animate: boolean;
  renderItem: (item: T, rctKey: number) => ReactNode;
  rctKey: number;
}

function RowImpl<T extends FlatItem>({ item, offset, height, zIndex, animate, renderItem, rctKey }: RowProps<T>) {
  const prev = useRef<{ key: string; offset: number } | null>(null);
  // Chỉ trượt khi đúng item này đổi chỗ; key vừa được tái dùng cho item khác thì nhảy ngay.
  const slide = animate && prev.current?.key === item.itemKey && prev.current.offset !== offset;
  useLayoutEffect(() => {
    prev.current = { key: item.itemKey, offset };
  });
  return (
    <div
      className='wa-fl-item'
      role='listitem'
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        height,
        zIndex,
        transform: `translateY(${offset}px)`,
        transition: slide ? 'transform 200ms ease-in-out' : 'none',
      }}
    >
      {renderItem(item, rctKey)}
    </div>
  );
}

/** memo mặc định so nông MỌI prop, kể cả zIndex. */
const Row = memo(RowImpl) as typeof RowImpl;

export interface FlatListProps<T extends FlatItem> {
  items: readonly T[];
  renderItem: (item: T, rctKey: number) => ReactNode;
  /** chiều cao khung cuộn (px) */
  height: number;
  defaultItemHeight?: number;
  extraItems?: number;
  reorderAnimation?: boolean;
  /** tắt để so sánh: dùng itemKey làm key React (mount/unmount khi cuộn) */
  recycleKeys?: boolean;
  /** tắt để so sánh: giữ thứ tự theo list, React phải di chuyển node DOM */
  sortByKey?: boolean;
  onWindowChange?: (range: WindowRange) => void;
  className?: string;
  ariaLabel?: string;
}

export function FlatList<T extends FlatItem>({
  items,
  renderItem,
  height,
  defaultItemHeight = 72,
  extraItems = 5,
  reorderAnimation = true,
  recycleKeys = true,
  sortByKey = true,
  onWindowChange,
  className,
  ariaLabel,
}: FlatListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pool = useMemo(() => new KeyPool(), []);
  const [scroll, setScroll] = useState(0);
  const raf = useRef(0);
  const pointerOff = useRef(false);
  const enableTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const offsets = useMemo(() => computeOffsets(items, defaultItemHeight), [items, defaultItemHeight]);
  const range = computeWindow(offsets, scroll, height, extraItems);
  const slice = items.slice(range.first, range.last + 1);
  const rows = recycleKeys
    ? pool.assign(slice, range.first, sortByKey)
    : slice.map((item, i) => ({ rctKey: -1, item, index: range.first + i }));

  useEffect(() => {
    onWindowChange?.(range);
  }, [range.first, range.last]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    const body = bodyRef.current;
    if (!el || !body) return;
    // Tắt trên phần nội dung, không trên khung cuộn: khung cuộn vẫn phải nhận wheel/touch.
    if (!pointerOff.current) {
      pointerOff.current = true;
      body.style.pointerEvents = 'none';
    }
    clearTimeout(enableTimer.current);
    enableTimer.current = setTimeout(() => {
      pointerOff.current = false;
      body.style.pointerEvents = '';
    }, 150);
    // rAF đọc scrollTop mới nhất lúc vẽ, nên không cần cờ "hanging" như bản gốc.
    if (!raf.current)
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        setScroll(el.scrollTop);
      });
  }, []);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      clearTimeout(enableTimer.current);
    },
    [],
  );

  return (
    <div
      ref={scrollRef}
      className={className}
      onScroll={onScroll}
      style={{ height, overflowY: 'auto', position: 'relative' }}
    >
      <div ref={bodyRef} role='list' aria-label={ariaLabel} style={{ position: 'relative', height: offsets[items.length] }}>
        {rows.map(({ rctKey, item, index }) => (
          <Row
            key={recycleKeys ? rctKey : item.itemKey}
            rctKey={rctKey}
            item={item}
            offset={offsets[index]}
            height={offsets[index + 1] - offsets[index]}
            zIndex={items.length - index}
            animate={reorderAnimation}
            renderItem={renderItem}
          />
        ))}
      </div>
    </div>
  );
}
