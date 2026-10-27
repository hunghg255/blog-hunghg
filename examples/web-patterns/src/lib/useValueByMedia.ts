import { useCallback, useSyncExternalStore } from 'react';

/**
 * Chọn một giá trị JS theo kích thước màn hình, viết theo kiểu mobile-first giống CSS
 * (ý tưởng từ useValueByMedia của toptal.com):
 *
 *   const columns = useValueByMedia({ default: 1, tablet: 2, desktop: 3 });
 *
 * - `default` dùng khi không query nào khớp (và khi render trên server).
 * - Các query được xét theo THỨ TỰ KHAI BÁO; query khớp cuối cùng thắng, giống CSS viết
 *   sau đè CSS viết trước. Nhờ vậy không cần viết `(min-width: 768px) and (max-width: 1023px)`.
 */

export const BREAKPOINTS = {
  tablet: '(min-width: 768px)',
  desktop: '(min-width: 1024px)',
  wide: '(min-width: 1440px)',
} as const;

type BreakpointName = keyof typeof BREAKPOINTS;

/** Khoá là tên breakpoint có sẵn hoặc một media query bất kỳ, vd '(orientation: portrait)'. */
export type ValuesByMedia<T> = { default: T } & Partial<Record<BreakpointName | (string & {}), T>>;

const toQuery = (key: string) => (Object.hasOwn(BREAKPOINTS, key) ? BREAKPOINTS[key as BreakpointName] : key);

// Dùng chung một MediaQueryList cho mỗi query: 50 component cùng hỏi '(min-width: 768px)'
// thì trình duyệt chỉ phải theo dõi 1 query.
const mediaCache = new Map<string, MediaQueryList>();
function getMedia(query: string) {
  let media = mediaCache.get(query);
  if (!media) {
    media = window.matchMedia(query);
    mediaCache.set(query, media);
  }
  return media;
}

const SERVER = '\0server'; // khoá giả cho lần render trên server / lúc hydrate

/** Trả về KHOÁ đang thắng ('default' nếu không query nào khớp). */
export function matchMediaKey(keys: readonly string[]): string {
  let winner = 'default';
  for (const key of keys) {
    if (getMedia(toQuery(key)).matches) winner = key;
  }
  return winner;
}

export function subscribeMedia(keys: readonly string[], onChange: () => void) {
  const lists = keys.map((key) => getMedia(toQuery(key)));
  lists.forEach((list) => list.addEventListener('change', onChange));
  return () => lists.forEach((list) => list.removeEventListener('change', onChange));
}

export function useValueByMedia<T>(values: ValuesByMedia<T>, serverValue: T = values.default): T {
  const keys = Object.keys(values).filter((key) => key !== 'default');
  // Chuỗi ổn định giữa các lần render dù `values` là object mới mỗi lần: dùng làm dependency
  const signature = keys.join('|');

  const subscribe = useCallback(
    (onChange: () => void) => subscribeMedia(signature ? signature.split('|') : [], onChange),
    [signature],
  );
  // Snapshot là TÊN khoá (chuỗi), không phải giá trị: giá trị có thể là object/JSX tạo mới
  // mỗi lần render, nếu trả thẳng thì useSyncExternalStore tưởng store đổi liên tục.
  const getSnapshot = () => matchMediaKey(keys);
  const key = useSyncExternalStore(subscribe, getSnapshot, () => SERVER);

  if (key === SERVER) return serverValue;
  return (values as Record<string, T>)[key];
}

/** Bản đơn giản cho một query. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useValueByMedia({ default: false, [query]: true }, serverValue);
}
