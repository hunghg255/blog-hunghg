/**
 * Lịch sử tin nhắn chia "đảo" (ý tưởng từ Telegram Web A: modules/actions/api/messages.ts,
 * modules/reducers/messages.ts).
 *
 * - Lịch sử được tải theo từng lát liền mạch. Đảo chính (`listed`) là đoạn tải đầu tiên và
 *   lớn dần khi cuộn. Nhảy tới một tin ở xa (reply, kết quả tìm kiếm) thì tải vào một đảo phụ
 *   (`outlying`) riêng, không trộn vào đảo chính vì giữa hai đoạn có khoảng trống.
 * - Hai đoạn liền mạch có khoảng id giao nhau thì hợp của chúng cũng liền mạch: lúc đó gộp đảo.
 * - Viewport là cửa sổ con của một đảo: còn đủ trong bộ nhớ thì hiện ngay, thiếu mới gọi API.
 * - Sau mỗi lần cuộn, tải trước lát kế tiếp ("budget preload") mà không đổi viewport.
 */

export type Direction = 'backwards' | 'forwards' | 'around';

export interface Island {
  /** id tăng dần, liền mạch theo lịch sử của server */
  ids: number[];
  /** đã chạm tin cũ nhất / mới nhất của cuộc trò chuyện */
  hasOldest: boolean;
  hasNewest: boolean;
}

export interface FetchResult {
  ids: number[];
  hasOldest: boolean;
  hasNewest: boolean;
}

export type FetchSlice = (args: { offsetId?: number; direction: Direction; limit: number }) => Promise<FetchResult>;

export interface HistoryState {
  listed?: Island;
  outlying?: Island;
  viewport: number[];
  /** viewport đang nằm trên đảo nào */
  viewportIsland: 'listed' | 'outlying';
}

/** Vị trí của offsetId trong mảng tăng dần, hoặc của id lớn nhất nhỏ hơn nó (Telegram: findClosestIndex). */
export function findClosestIndex(ids: number[], offsetId: number) {
  if (ids.length === 0) return -1;
  if (offsetId < ids[0]) return 0;
  if (offsetId > ids[ids.length - 1]) return ids.length - 1;
  let lo = 0;
  let hi = ids.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ids[mid] <= offsetId) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Cắt viewport từ một đảo. `isComplete` = cửa sổ đầy đủ từ bộ nhớ, không cần gọi API.
 * Cửa sổ dài tối đa 2 lát: một lát đã đọc + một lát theo hướng cuộn.
 */
export function getViewportSlice(island: Island, offsetId: number | undefined, direction: Direction, slice: number) {
  const { ids } = island;
  const index = offsetId === undefined ? ids.length - 1 : findClosestIndex(ids, offsetId);
  let from: number;
  let to: number; // không tính `to`
  if (direction === 'backwards') {
    from = index - slice;
    to = index + slice;
  } else if (direction === 'forwards') {
    from = index + 1 - slice;
    to = index + 1 + slice;
  } else if (offsetId === undefined) {
    // mở cuộc trò chuyện ở cuối: lát mới nhất
    from = ids.length - slice;
    to = ids.length;
  } else {
    from = index - Math.floor(slice / 2);
    to = index + Math.ceil(slice / 2);
  }
  const viewport = ids.slice(Math.max(0, from), Math.min(ids.length, to));
  const missingBefore = from < 0 && !island.hasOldest;
  const missingAfter = to > ids.length && !island.hasNewest;
  const isComplete =
    direction === 'backwards' ? !missingBefore : direction === 'forwards' ? !missingAfter : !missingBefore && !missingAfter;
  return { viewport, isComplete };
}

/** Hai đoạn liền mạch có khoảng id giao nhau. Telegram: areSortedArraysIntersecting. */
export function areRangesIntersecting(a: number[], b: number[]) {
  return a.length > 0 && b.length > 0 && a[0] <= b[b.length - 1] && a[a.length - 1] >= b[0];
}

/** Gộp hai mảng tăng dần, bỏ trùng, O(n + m). */
export function mergeSortedUnique(a: number[], b: number[]) {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const next = j >= b.length || (i < a.length && a[i] <= b[j]) ? a[i++] : b[j++];
    if (out[out.length - 1] !== next) out.push(next);
  }
  return out;
}

function mergeIsland(island: Island | undefined, result: FetchResult): Island {
  if (!island) return { ...result, ids: [...result.ids] };
  return {
    ids: mergeSortedUnique(island.ids, result.ids),
    hasOldest: island.hasOldest || result.hasOldest,
    hasNewest: island.hasNewest || result.hasNewest,
  };
}

export interface MessageHistoryOptions {
  fetchSlice: FetchSlice;
  slice?: number;
  onChange?: (state: HistoryState) => void;
  onFetch?: (info: { direction: Direction; offsetId?: number; isPreload: boolean }) => void;
}

export function createMessageHistory({ fetchSlice, slice = 40, onChange, onFetch }: MessageHistoryOptions) {
  let state: HistoryState = { viewport: [], viewportIsland: 'listed' };
  // mỗi lần nhảy tới tin mới tăng generation: kết quả tải của lần nhảy trước bị bỏ
  let generation = 0;
  const inFlight = new Set<string>();

  const set = (next: Partial<HistoryState>) => {
    state = { ...state, ...next };
    onChange?.(state);
  };

  const islandOf = (name: HistoryState['viewportIsland']) => (name === 'listed' ? state.listed : state.outlying);

  /** Đảo phụ chạm đảo chính thì gộp làm một, viewport chuyển sang đảo chính. */
  function tryMergeIslands() {
    const { listed, outlying } = state;
    if (!listed || !outlying || !areRangesIntersecting(listed.ids, outlying.ids)) return;
    set({
      listed: mergeIsland(listed, outlying),
      outlying: undefined,
      viewportIsland: 'listed',
    });
  }

  async function fetchInto(
    islandName: HistoryState['viewportIsland'],
    direction: Direction,
    offsetId: number | undefined,
    isPreload: boolean,
  ) {
    const key = `${islandName}:${direction}:${offsetId}`;
    if (inFlight.has(key)) return false; // cùng một lát đang được tải
    inFlight.add(key);
    const myGeneration = generation;
    onFetch?.({ direction, offsetId, isPreload });
    try {
      const result = await fetchSlice({ offsetId, direction, limit: slice });
      if (myGeneration !== generation) return false;
      if (islandName === 'listed') set({ listed: mergeIsland(state.listed, result) });
      else set({ outlying: mergeIsland(state.outlying, result) });
      tryMergeIslands();
      return true;
    } finally {
      inFlight.delete(key);
    }
  }

  function showSlice(direction: Direction, offsetId: number | undefined) {
    const island = islandOf(state.viewportIsland);
    if (!island) return { isComplete: false };
    const { viewport, isComplete } = getViewportSlice(island, offsetId, direction, slice);
    if (viewport.length) set({ viewport });
    return { isComplete };
  }

  /** Mở cuộc trò chuyện, hoặc nhảy tới một tin (reply, tìm kiếm). */
  async function jumpTo(messageId?: number) {
    if (messageId !== undefined && state.viewport.includes(messageId)) return;
    generation++;
    const inListed = messageId === undefined
      ? Boolean(state.listed?.hasNewest)
      : Boolean(state.listed && messageId >= state.listed.ids[0] && messageId <= state.listed.ids[state.listed.ids.length - 1]);
    // Telegram cũng xoá đảo phụ cũ trước mỗi lần nhảy: chỉ giữ tối đa một đảo phụ
    set({ outlying: undefined, viewportIsland: inListed || !state.listed ? 'listed' : 'outlying' });
    const { isComplete } = showSlice('around', messageId);
    if (!isComplete) {
      await fetchInto(state.viewportIsland, 'around', messageId, false);
      showSlice('around', messageId);
    }
  }

  /** Cuộn tới mép viewport. */
  async function scroll(direction: 'backwards' | 'forwards') {
    const edge = direction === 'backwards' ? state.viewport[0] : state.viewport[state.viewport.length - 1];
    if (edge === undefined) return;
    const islandName = state.viewportIsland;
    const { isComplete } = showSlice(direction, edge);
    if (!isComplete) {
      await fetchInto(islandName, direction, edge, false);
      showSlice(direction, edge);
    }
    // budget preload: tải trước lát kế tiếp theo cùng hướng, KHÔNG đổi viewport
    const island = islandOf(state.viewportIsland);
    if (!island) return;
    const nextEdge = direction === 'backwards' ? state.viewport[0] : state.viewport[state.viewport.length - 1];
    const ahead = getViewportSlice(island, nextEdge, direction, slice);
    if (!ahead.isComplete) {
      const islandEdge = direction === 'backwards' ? island.ids[0] : island.ids[island.ids.length - 1];
      void fetchInto(state.viewportIsland, direction, islandEdge, true);
    }
  }

  /** Tin mới tới qua realtime: chỉ nối vào đảo đã chạm tin mới nhất. */
  function receiveNew(id: number) {
    for (const name of ['listed', 'outlying'] as const) {
      const island = name === 'listed' ? state.listed : state.outlying;
      if (island?.hasNewest) {
        const updated = { ...island, ids: mergeSortedUnique(island.ids, [id]) };
        set(name === 'listed' ? { listed: updated } : { outlying: updated });
        const last = state.viewport[state.viewport.length - 1];
        if (state.viewportIsland === name && last !== undefined && island.ids[island.ids.length - 1] === last) {
          set({ viewport: [...state.viewport.slice(-(slice * 2 - 1)), id] });
        }
        return true;
      }
    }
    return false; // không đảo nào chạm tin mới nhất: chỉ tăng bộ đếm "tin mới"
  }

  return { jumpTo, scroll, receiveNew, getState: () => state };
}

export type MessageHistory = ReturnType<typeof createMessageHistory>;
