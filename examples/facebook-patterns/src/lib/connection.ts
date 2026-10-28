/**
 * Ghép trang cho danh sách phân trang kiểu GraphQL connection, ý tưởng từ ConnectionHandler của Relay
 * (viết lại, bất biến, không cần store):
 * - mỗi edge nhận được có ID riêng `client:<conn>:edges:<n>` với n tăng đơn điệu, không bao giờ dùng lại,
 * - trang `after` chỉ được ghép khi cursor khớp endCursor hiện tại; trang `before` khớp startCursor,
 * - ghép qua một Set node id: edge đến trước thắng, nên trang chồng lấn không sinh bản trùng.
 */

export interface NodeLike {
  id: string;
}
export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}
export interface Edge<N extends NodeLike> {
  /** ID phía client, ổn định suốt đời edge, dùng làm React key */
  id: string;
  cursor: string | null;
  node: N | null;
}
export interface Connection<N extends NodeLike> {
  id: string;
  edges: readonly Edge<N>[];
  pageInfo: PageInfo;
  nextEdgeIndex: number;
}
export interface ServerPage<N extends NodeLike> {
  edges: { cursor: string | null; node: N | null }[];
  pageInfo: Partial<PageInfo>;
}
export interface PageArgs {
  first?: number;
  after?: string | null;
  last?: number;
  before?: string | null;
}
export type MergeResult = 'init' | 'refetch' | 'append' | 'prepend' | 'rejected';

const EMPTY_PAGE_INFO: PageInfo = {
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null,
};

/** Gán ID client cho các edge server, trả về edge mới và chỉ số kế tiếp. */
function buildEdges<N extends NodeLike>(connId: string, start: number, page: ServerPage<N>) {
  let n = start;
  const edges = page.edges.map((e) => ({
    id: `client:${connId}:edges:${n++}`,
    cursor: e.cursor,
    node: e.node,
  }));
  return { edges, next: n };
}

/** Nối các danh sách theo thứ tự, bỏ edge có node id đã gặp (edge đến trước thắng). */
function mergeEdges<N extends NodeLike>(lists: readonly (readonly Edge<N>[])[]) {
  const seen = new Set<string>();
  const out: Edge<N>[] = [];
  let dropped = 0;
  for (const list of lists) {
    for (const edge of list) {
      const id = edge.node?.id;
      if (id != null) {
        if (seen.has(id)) {
          dropped++;
          continue;
        }
        seen.add(id);
      }
      out.push(edge); // edge không có node (null) vẫn được giữ, giống Relay
    }
  }
  return { edges: out, dropped };
}

export interface MergeOutcome<N extends NodeLike> {
  connection: Connection<N>;
  result: MergeResult;
  /** số edge bị bỏ vì trùng node */
  dropped: number;
  warning?: string;
}

export function mergePage<N extends NodeLike>(
  current: Connection<N> | null,
  connId: string,
  page: ServerPage<N>,
  args: PageArgs,
): MergeOutcome<N> {
  if (!current) {
    const { edges, next } = buildEdges(connId, 0, page);
    return {
      connection: {
        id: connId,
        edges,
        nextEdgeIndex: next,
        pageInfo: { ...EMPTY_PAGE_INFO, ...page.pageInfo },
      },
      result: 'init',
      dropped: 0,
    };
  }
  const { pageInfo } = current;
  if (args.after != null && args.after !== pageInfo.endCursor) {
    return {
      connection: current,
      result: 'rejected',
      dropped: 0,
      warning: `after "${args.after}" khác endCursor "${pageInfo.endCursor}": bỏ cả trang`,
    };
  }
  if (args.before != null && args.before !== pageInfo.startCursor) {
    return {
      connection: current,
      result: 'rejected',
      dropped: 0,
      warning: `before "${args.before}" khác startCursor "${pageInfo.startCursor}": bỏ cả trang`,
    };
  }

  const built = buildEdges(connId, current.nextEdgeIndex, page);
  const server = page.pageInfo;
  let result: MergeResult;
  let merged: { edges: Edge<N>[]; dropped: number };
  let nextInfo: PageInfo;

  if (args.after != null) {
    result = 'append';
    merged = mergeEdges([current.edges, built.edges]);
    nextInfo = {
      ...pageInfo,
      hasNextPage: !!server.hasNextPage,
      endCursor: typeof server.endCursor === 'string' ? server.endCursor : pageInfo.endCursor,
    };
  } else if (args.before != null) {
    result = 'prepend';
    merged = mergeEdges([built.edges, current.edges]);
    nextInfo = {
      ...pageInfo,
      hasPreviousPage: !!server.hasPreviousPage,
      startCursor:
        typeof server.startCursor === 'string' ? server.startCursor : pageInfo.startCursor,
    };
  } else {
    // không có after/before: tải lại từ đầu, thay toàn bộ
    result = 'refetch';
    merged = { edges: built.edges, dropped: 0 };
    nextInfo = { ...EMPTY_PAGE_INFO, ...server };
  }
  return {
    connection: { id: connId, edges: merged.edges, pageInfo: nextInfo, nextEdgeIndex: built.next },
    result,
    dropped: merged.dropped,
  };
}

/**
 * Tạo edge cho node mới (vd vừa đăng bài). ID theo node như Relay createEdge,
 * nên chèn cùng node hai lần sẽ ra hai edge cùng ID: dùng insertEdge với `dedupe`.
 */
export function createEdge<N extends NodeLike>(connId: string, node: N): Edge<N> {
  return { id: `client:${connId}:${node.id}`, cursor: null, node };
}

export interface InsertOptions {
  /** chèn sau/trước edge có cursor này; không tìm thấy thì chèn ở cuối/đầu */
  cursor?: string | null;
  /** bỏ qua nếu node đã có trong danh sách (Relay không làm bước này) */
  dedupe?: boolean;
}

function insertEdge<N extends NodeLike>(
  conn: Connection<N>,
  edge: Edge<N>,
  where: 'after' | 'before',
  { cursor = null, dedupe = true }: InsertOptions = {},
): Connection<N> {
  if (dedupe && edge.node && conn.edges.some((e) => e.node?.id === edge.node!.id)) return conn;
  const edges = [...conn.edges];
  const at = cursor == null ? -1 : edges.findIndex((e) => e.cursor === cursor);
  if (at === -1) {
    if (where === 'after') edges.push(edge);
    else edges.unshift(edge);
  } else {
    edges.splice(where === 'after' ? at + 1 : at, 0, edge);
  }
  return { ...conn, edges };
}

export const insertEdgeAfter = <N extends NodeLike>(
  c: Connection<N>,
  e: Edge<N>,
  o?: InsertOptions,
) => insertEdge(c, e, 'after', o);
export const insertEdgeBefore = <N extends NodeLike>(
  c: Connection<N>,
  e: Edge<N>,
  o?: InsertOptions,
) => insertEdge(c, e, 'before', o);

/** Xoá mọi edge trỏ tới node; chỉ sao chép mảng khi thật sự có edge cần xoá. */
export function deleteNode<N extends NodeLike>(conn: Connection<N>, nodeId: string): Connection<N> {
  let out: Edge<N>[] | undefined;
  conn.edges.forEach((edge, i) => {
    if (edge.node?.id === nodeId) {
      if (out === undefined) out = conn.edges.slice(0, i);
    } else if (out !== undefined) {
      out.push(edge);
    }
  });
  return out === undefined ? conn : { ...conn, edges: out };
}

/**
 * Biến thể cho feed vô tận (theo CometNewsFeedConnectionHandler): không kiểm cursor,
 * không có chiều ngược, còn trang tiếp khi trang vừa nhận không rỗng,
 * endCursor lấy của server, thiếu thì lấy cursor của edge cuối.
 */
export function mergeFeedPage<N extends NodeLike>(
  current: Connection<N> | null,
  connId: string,
  page: ServerPage<N>,
  args: PageArgs,
): MergeOutcome<N> {
  if (args.before != null) throw new Error('Feed không hỗ trợ phân trang ngược');
  const start = current?.nextEdgeIndex ?? 0;
  const built = buildEdges(connId, start, page);
  const keepOld = current && (args.after != null || built.edges.length === 0);
  const merged = mergeEdges(keepOld ? [current!.edges, built.edges] : [built.edges]);
  const last = merged.edges[merged.edges.length - 1];
  const pageInfo: PageInfo = {
    hasPreviousPage: false,
    hasNextPage: built.edges.length > 0 || page.pageInfo.hasNextPage === true,
    startCursor: null,
    endCursor: page.pageInfo.endCursor ?? last?.cursor ?? null,
  };
  return {
    connection: { id: connId, edges: merged.edges, pageInfo, nextEdgeIndex: built.next },
    result: current ? (args.after != null ? 'append' : 'refetch') : 'init',
    dropped: merged.dropped,
  };
}
