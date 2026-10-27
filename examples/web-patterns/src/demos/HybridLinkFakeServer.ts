import { shape, naptimeResourceName } from '../lib/hybridLink';
import { parse } from '../lib/hybridLinkGql';
import { sleep } from './shared';

/**
 * Server giả chạy trong trình duyệt cho demo hybrid link:
 * - REST kiểu Naptime: /api/<resource>.v1[/id]?q=<finder>&fields=…
 * - Gateway GraphQL: /graphql và /graphqlBatch, phơi cùng các resource dưới tên `<Tên>V1Resource`
 */

type Row = Record<string, unknown> & { id: string };

const db: Record<string, Row[]> = {
  'courses.v1': [
    {
      id: 'c1',
      slug: 'machine-learning',
      name: 'Machine Learning',
      partnerId: 'p1',
      workload: '60 giờ',
    },
    {
      id: 'c2',
      slug: 'learning-how-to-learn',
      name: 'Learning How to Learn',
      partnerId: 'p2',
      workload: '15 giờ',
    },
  ],
  'partners.v1': [
    { id: 'p1', name: 'Stanford University' },
    { id: 'p2', name: 'Deep Teaching Solutions' },
  ],
  'userNotes.v1': [
    {
      id: 'n1',
      courseId: 'c1',
      userText: 'Gradient descent: nhớ chuẩn hoá feature',
      createdAt: 1793000000000,
    },
    {
      id: 'n2',
      courseId: 'c1',
      userText: 'Regularization để tránh overfitting',
      createdAt: 1793050000000,
    },
  ],
};

// finder theo tên: q=<tên> ở REST, hoặc field con ở GraphQL
const finders: Record<string, Record<string, (args: Record<string, string>) => Row[]>> = {
  'courses.v1': { slug: (a) => db['courses.v1'].filter((c) => c.slug === a.slug) },
  'userNotes.v1': { byCourse: (a) => db['userNotes.v1'].filter((n) => n.courseId === a.courseId) },
};

export interface RequestRecord {
  method: string;
  url: string;
  /** số operation trong request (batch) */
  operations: number;
  bytes: number;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function pickFields(rows: Row[], fields: string | null) {
  if (!fields) return rows;
  const keep = ['id', ...fields.split(',')];
  return rows.map((row) =>
    Object.fromEntries(keep.filter((k) => k in row).map((k) => [k, row[k]])),
  );
}

function runFinder(resource: string, handler: string, args: Record<string, string>): Row[] {
  const rows = db[resource];
  if (!rows) throw new Error(`không có resource ${resource}`);
  if (handler === 'get') return rows.filter((r) => r.id === args.id);
  if (handler === 'getAll') return rows;
  if (handler === 'multiGet') return rows.filter((r) => args.ids.split(',').includes(r.id));
  const finder = finders[resource]?.[handler];
  if (!finder) throw new Error(`${resource} không có finder "${handler}"`);
  return finder(args);
}

function handleRest(method: string, url: URL, body: string | undefined) {
  const [, , resource, id] = url.pathname.split('/'); // /api/<resource>/<id>
  const params = Object.fromEntries(url.searchParams);
  if (method === 'GET') {
    const handler = id ? 'get' : (params.q ?? (params.ids ? 'multiGet' : 'getAll'));
    const rows = runFinder(resource, handler, id ? { ...params, id } : params);
    return json({
      elements: pickFields(rows, params.fields ?? null),
      paging: { total: rows.length },
    });
  }
  if (method === 'POST' && resource === 'userNotes.v1') {
    const input = JSON.parse(body ?? '{}') as { courseId: string; userText: string };
    const note = { id: `n${Date.now().toString(36)}`, ...input, createdAt: Date.now() };
    db['userNotes.v1'].push(note);
    return json({ elements: [note] }, 201);
  }
  if (method === 'DELETE' && id) {
    db[resource] = db[resource].filter((r) => r.id !== id);
    return new Response(null, { status: 204 });
  }
  return json({ message: 'not found' }, 404);
}

function executeGraphQL({
  query,
  variables,
}: {
  query: string;
  variables?: Record<string, unknown>;
}) {
  try {
    const doc = parse(query);
    const data: Record<string, unknown> = {};
    for (const field of doc.selections) {
      const resource = naptimeResourceName(field.name);
      const out: Record<string, unknown> = {};
      for (const handler of field.selections) {
        const args = Object.fromEntries(
          Object.entries(handler.args).map(([k, v]) => [
            k,
            String(v.kind === 'variable' ? variables?.[v.name] : v.value),
          ]),
        );
        const rows = runFinder(resource, handler.name, args).map((row) =>
          // "join" phía server: gateway tự nối partner cho course, client không phải gọi thêm
          'partnerId' in row
            ? { ...row, partner: db['partners.v1'].find((p) => p.id === row.partnerId) }
            : row,
        );
        out[handler.alias ?? handler.name] = shape(
          { elements: rows, paging: { total: rows.length } },
          handler.selections,
        );
      }
      data[field.alias ?? field.name] = out;
    }
    return { data };
  } catch (error) {
    return {
      data: null,
      errors: [{ message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

export function createFakeServer(onRequest: (record: RequestRecord) => void, latency = 150) {
  return async function fakeFetch(input: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input, 'https://www.coursera.test');
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? init.body : undefined;
    await sleep(latency);
    let response: Response;
    let operations = 1;
    if (url.pathname === '/graphql') {
      response = json(executeGraphQL(JSON.parse(body ?? '{}')));
    } else if (url.pathname === '/graphqlBatch') {
      const list = JSON.parse(body ?? '[]') as {
        query: string;
        variables?: Record<string, unknown>;
      }[];
      operations = list.length;
      response = json(list.map(executeGraphQL));
    } else {
      response = handleRest(method, url, body);
    }
    const size = (await response.clone().text()).length;
    onRequest({ method, url: url.pathname + url.search, operations, bytes: size });
    return response;
  };
}
