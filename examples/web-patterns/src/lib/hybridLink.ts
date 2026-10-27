import type { ArgValue, DocumentNode, FieldNode } from './hybridLinkGql';

/**
 * "Link" mạng cho phép component viết MỘT kiểu query GraphQL, còn link quyết định đi đường nào:
 * - field có directive @naptime -> gọi thẳng REST API cũ (Naptime) và tự dựng kết quả đúng hình query
 * - `variables.__disableBatch` -> POST /graphql riêng lẻ
 * - còn lại -> gom nhiều query vào một POST /graphqlBatch
 * Ý tưởng từ `modules/network/createHybridLink.js` + `naptime.js` của coursera.org. Bản này không
 * phụ thuộc Apollo: link là hàm trả Promise (Apollo Link trả Observable, xem bài viết).
 */

export interface Operation {
  query: DocumentNode;
  variables: Record<string, unknown>;
  /** dữ liệu phụ đi kèm (headers…), giống operation.getContext() của Apollo */
  context: { headers?: Record<string, string> };
}

export interface GraphQLResult {
  data?: Record<string, unknown> | null;
  errors?: { message: string }[];
}

export type Link = (operation: Operation) => Promise<GraphQLResult>;
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const hasDirective = (field: FieldNode, name: string) => field.directives.includes(name);

/** Xoá biến điều khiển (bắt đầu bằng __) trước khi gửi lên server. */
function publicVariables(variables: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(variables).filter(([key]) => !key.startsWith('__')));
}

async function readJson(response: Response) {
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.url}`);
  return response.json();
}

// ---------- 1. GraphQL thường ----------

export function createHttpLink({
  uri,
  fetch: doFetch = fetch,
}: {
  uri: string;
  fetch?: Fetcher;
}): Link {
  return async ({ query, variables, context }) => {
    const response = await doFetch(uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...context.headers },
      body: JSON.stringify({
        query: query.source,
        variables: publicVariables(variables),
        operationName: query.name,
      }),
    });
    return readJson(response);
  };
}

// ---------- 2. Gom nhiều operation vào một request ----------

export interface BatchOptions {
  uri: string;
  fetch?: Fetcher;
  /** chờ bao lâu để gom thêm operation (ms) */
  batchInterval?: number;
  batchMax?: number;
}

/**
 * Operation khác headers (khác người dùng, khác quyền…) không được gom chung một request:
 * khoá lô = uri + headers, giống batchKey của Coursera.
 */
const batchKey = (uri: string, op: Operation) => uri + JSON.stringify(op.context.headers ?? {});

export function createBatchLink({
  uri,
  fetch: doFetch = fetch,
  batchInterval = 10,
  batchMax = 10,
}: BatchOptions): Link {
  type Pending = {
    op: Operation;
    resolve: (r: GraphQLResult) => void;
    reject: (e: unknown) => void;
  };
  const queues = new Map<string, { items: Pending[]; timer: ReturnType<typeof setTimeout> }>();

  async function flush(key: string) {
    const queue = queues.get(key);
    if (!queue) return;
    queues.delete(key);
    clearTimeout(queue.timer);
    const { items } = queue;
    try {
      const response = await doFetch(uri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...items[0].op.context.headers },
        body: JSON.stringify(
          items.map(({ op }) => ({
            query: op.query.source,
            variables: publicVariables(op.variables),
            operationName: op.query.name,
          })),
        ),
      });
      const results = (await readJson(response)) as GraphQLResult[];
      // server trả mảng kết quả cùng thứ tự với mảng gửi lên
      items.forEach((item, index) =>
        item.resolve(results[index] ?? { errors: [{ message: 'thiếu kết quả' }] }),
      );
    } catch (error) {
      items.forEach((item) => item.reject(error));
    }
  }

  return (op) =>
    new Promise((resolve, reject) => {
      const key = batchKey(uri, op);
      let queue = queues.get(key);
      if (!queue) {
        queue = { items: [], timer: setTimeout(() => void flush(key), batchInterval) };
        queues.set(key, queue);
      }
      queue.items.push({ op, resolve, reject });
      if (queue.items.length >= batchMax) void flush(key);
    });
}

// ---------- 3. REST (Naptime) ----------

/** `CoursesV1` -> `courses.v1` (Coursera: parseNaptimeResourceName, nhận cả đuôi `Resource`) */
export function naptimeResourceName(field: string): string {
  const match = field.match(/^(.*)V(\d+)(?:Resource)?$/);
  if (!match) throw new Error(`không đọc được tên resource từ "${field}"`);
  return `${match[1].charAt(0).toLowerCase()}${match[1].slice(1)}.v${match[2]}`;
}

function resolveArgs(args: Record<string, ArgValue>, variables: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(args).map(([name, arg]) => {
      const value = arg.kind === 'variable' ? variables[arg.name] : arg.value;
      if (value === undefined) throw new Error(`thiếu biến cho tham số "${name}"`);
      return [name, value];
    }),
  );
}

/** Các trường cần lấy trong `elements { … }`: gửi kèm `fields=` để REST trả ít dữ liệu hơn. */
function requestedFields(handler: FieldNode) {
  const elements = handler.selections.find((f) => f.name === 'elements');
  return (elements?.selections ?? [])
    .map((f) => f.name)
    .filter((name) => name !== 'id' && name !== '__typename');
}

export interface RestRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  body?: string;
}

/**
 * Quy ước URL của Naptime:
 * get(id) -> GET /api/x.v1/<id> · multiGet(ids) -> GET ?ids= · getAll -> GET /api/x.v1
 * finder khác -> GET ?q=<tên finder>&<tham số> · create/update/delete/action như naptime.js của Coursera
 */
export function toRestRequest(
  baseUrl: string,
  resource: string,
  handler: FieldNode,
  args: Record<string, unknown>,
): RestRequest {
  const root = `${baseUrl}/${resource}`;
  const params = new URLSearchParams();
  const fields = requestedFields(handler);
  const body = 'body' in args ? JSON.stringify(args.body) : undefined;
  switch (handler.name) {
    case 'get':
      if (fields.length) params.set('fields', fields.join(','));
      return {
        method: 'GET',
        url: withQuery(`${root}/${encodeURIComponent(String(args.id))}`, params),
      };
    case 'create':
      return { method: 'POST', url: root, body: body ?? '{}' };
    case 'update':
      return { method: 'PUT', url: `${root}/${encodeURIComponent(String(args.id))}`, body };
    case 'delete':
      return { method: 'DELETE', url: `${root}/${encodeURIComponent(String(args.id))}` };
    case 'action':
      for (const [key, value] of Object.entries(args))
        if (key !== 'body') params.set(key, String(value));
      return { method: 'POST', url: withQuery(root, params), body: body ?? '{}' };
    case 'getAll':
      break;
    case 'multiGet':
      params.set('ids', ([] as unknown[]).concat(args.ids).join(','));
      break;
    default:
      params.set('q', handler.name);
      for (const [key, value] of Object.entries(args)) params.set(key, String(value));
  }
  if (fields.length) params.set('fields', fields.join(','));
  return { method: 'GET', url: withQuery(root, params) };
}

const withQuery = (url: string, params: URLSearchParams) =>
  params.toString() ? `${url}?${params}` : url;

/** Chỉ giữ đúng các trường query yêu cầu, như server GraphQL thật. */
export function shape(value: unknown, selections: FieldNode[]): unknown {
  if (selections.length === 0 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => shape(item, selections));
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    selections.map((field) => [
      field.alias ?? field.name,
      shape(source[field.name] ?? null, field.selections),
    ]),
  );
}

export function createNaptimeLink({
  baseUrl = '/api',
  fetch: doFetch = fetch,
}: { baseUrl?: string; fetch?: Fetcher } = {}): Link {
  return async ({ query, variables, context }) => {
    // mỗi field gốc (resource) và mỗi handler bên trong là một request REST, chạy song song
    const entries = await Promise.all(
      query.selections.map(async (resourceField) => {
        const resource = naptimeResourceName(resourceField.name);
        const handlers = await Promise.all(
          resourceField.selections.map(async (handler) => {
            const request = toRestRequest(
              baseUrl,
              resource,
              handler,
              resolveArgs(handler.args, variables),
            );
            const response = await doFetch(request.url, {
              method: request.method,
              body: request.body,
              credentials: 'include',
              headers: { 'Content-Type': 'application/json', ...context.headers },
            });
            if (!response.ok)
              throw new Error(`HTTP ${response.status} ${request.method} ${request.url}`);
            const json = response.status === 204 ? {} : await response.json();
            // REST trả { elements: [...], paging }; với create/update/action lấy elements[0] cho gọn
            // (giống transformMutationResponse của Coursera)
            const result = ['create', 'update', 'action'].includes(handler.name)
              ? (json.elements?.[0] ?? json)
              : json;
            return [handler.alias ?? handler.name, shape(result, handler.selections)] as const;
          }),
        );
        return [resourceField.alias ?? resourceField.name, Object.fromEntries(handlers)] as const;
      }),
    );
    return { data: Object.fromEntries(entries) };
  };
}

// ---------- 4. Hybrid: chọn đường cho từng operation ----------

export interface HybridLinkOptions {
  naptime: Link;
  single: Link;
  batch?: Link;
}

export function createHybridLink({ naptime, single, batch }: HybridLinkOptions): Link {
  return (operation) => {
    const marked = operation.query.selections.filter((field) => hasDirective(field, 'naptime'));
    if (marked.length > 0) {
      // Một operation chỉ đi một đường: trộn hai loại thì kết quả phải ghép từ hai nguồn, khó đúng
      // (lỗi, loading, cache từng phần). Tách thành hai query riêng.
      if (marked.length !== operation.query.selections.length) {
        return Promise.reject(
          new Error('Không trộn field @naptime với field GraphQL trong cùng operation'),
        );
      }
      return naptime(operation);
    }
    if (!batch || operation.variables.__disableBatch) return single(operation);
    return batch(operation);
  };
}

/** Middleware: gắn header, đo thời gian… Giống ApolloLink.from([a, b, terminating]). */
export type Middleware = (operation: Operation, forward: Link) => Promise<GraphQLResult>;

export function composeLinks(middlewares: Middleware[], terminating: Link): Link {
  return middlewares.reduceRight<Link>(
    (next, middleware) => (operation) => middleware(operation, next),
    terminating,
  );
}
