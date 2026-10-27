import { useMemo, useRef, useState } from 'react';
import {
  composeLinks,
  createBatchLink,
  createHttpLink,
  createHybridLink,
  createNaptimeLink,
  type Fetcher,
  type GraphQLResult,
  type Link,
  type Middleware,
} from '../lib/hybridLink';
import { parse } from '../lib/hybridLinkGql';
import { createFakeServer, type RequestRecord } from './HybridLinkFakeServer';
import { Stat } from './shared';

// Mỗi query có 2 phiên bản: còn đi REST (@naptime) hoặc đã chuyển sang gateway GraphQL.
// Alias giữ nguyên key trong `data` để component đọc dữ liệu KHÔNG phải sửa.
const QUERIES = {
  course: (migrated: boolean) => `query CourseHeader($slug: String!) {
  CoursesV1: ${migrated ? 'CoursesV1Resource' : 'CoursesV1 @naptime'} {
    slug(slug: $slug) { elements { id name workload } }
  }
}`,
  notes: (migrated: boolean) => `query NotesList($courseId: String!) {
  UserNotesV1: ${migrated ? 'UserNotesV1Resource' : 'UserNotesV1 @naptime'} {
    byCourse(courseId: $courseId) { elements { id userText } }
  }
}`,
  partner: (migrated: boolean) => `query PartnerBadge($id: String!) {
  PartnersV1: ${migrated ? 'PartnersV1Resource' : 'PartnersV1 @naptime'} {
    get(id: $id) { elements { id name } }
  }
}`,
};
type QueryName = keyof typeof QUERIES;

const CREATE_NOTE = parse(`mutation CreateNote($body: String!) {
  UserNotesV1 @naptime { create(body: $body) { id userText } }
}`);

type Elements<T> = { elements: T[] };

export default function HybridLinkDemo() {
  const [migrated, setMigrated] = useState<Record<QueryName, boolean>>({
    course: false,
    notes: false,
    partner: false,
  });
  const [disableBatch, setDisableBatch] = useState(false);
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [results, setResults] = useState<Partial<Record<QueryName, GraphQLResult>>>({});
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const counter = useRef(0);

  const link: Link = useMemo(() => {
    const fakeFetch = createFakeServer((record) =>
      setRequests((list) => [...list, record]),
    ) as Fetcher;
    // middleware giống operationNameMiddleware của Coursera: gắn header cho mọi request
    const withHeaders: Middleware = (op, forward) =>
      forward({
        ...op,
        context: { ...op.context, headers: { ...op.context.headers, 'X-App-Version': 'demo' } },
      });
    return composeLinks(
      [withHeaders],
      createHybridLink({
        naptime: createNaptimeLink({ baseUrl: '/api', fetch: fakeFetch }),
        single: createHttpLink({ uri: '/graphql', fetch: fakeFetch }),
        batch: createBatchLink({ uri: '/graphqlBatch', fetch: fakeFetch }),
      }),
    );
  }, []);

  const run = (name: QueryName, variables: Record<string, unknown>) =>
    link({
      query: parse(QUERIES[name](migrated[name])),
      // escape hatch giống Coursera: biến __disableBatch -> không gom batch
      variables:
        name === 'course' && disableBatch ? { ...variables, __disableBatch: true } : variables,
      context: {},
    });

  const loadPage = async () => {
    setRequests([]);
    setError('');
    const id = ++counter.current;
    const start = performance.now();
    try {
      // 3 component trên trang tự gọi query của mình, cùng lúc
      const [course, notes, partner] = await Promise.all([
        run('course', { slug: 'machine-learning' }),
        run('notes', { courseId: 'c1' }),
        run('partner', { id: 'p1' }),
      ]);
      if (id !== counter.current) return;
      setResults({ course, notes, partner });
      setElapsed(Math.round(performance.now() - start));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addNote = async () => {
    if (!draft.trim()) return;
    await link({
      query: CREATE_NOTE,
      variables: { body: { courseId: 'c1', userText: draft.trim() } },
      context: {},
    });
    setDraft('');
    const notes = await run('notes', { courseId: 'c1' });
    setResults((r) => ({ ...r, notes }));
  };

  // ---- "component" đọc dữ liệu: giống hệt nhau dù dữ liệu đi đường nào ----
  const course = (
    results.course?.data?.CoursesV1 as { slug: Elements<{ name: string; workload: string }> }
  )?.slug.elements[0];
  const notes = (
    results.notes?.data?.UserNotesV1 as { byCourse: Elements<{ id: string; userText: string }> }
  )?.byCourse.elements;
  const partner = (results.partner?.data?.PartnersV1 as { get: Elements<{ name: string }> })?.get
    .elements[0];

  return (
    <div className='page'>
      <h1>Hybrid link: REST cũ và GraphQL chung một cách gọi</h1>
      <p className='hint'>
        Ba component dùng query GraphQL. Query có <code>@naptime</code> đi thẳng REST; query đã
        chuyển sang gateway thì được gom chung một request <code>/graphqlBatch</code>. Chuyển từng
        query rồi bấm “Tải trang”.
      </p>
      <div className='toolbar'>
        {(Object.keys(QUERIES) as QueryName[]).map((name) => (
          <label key={name} className='switch'>
            <input
              type='checkbox'
              checked={migrated[name]}
              onChange={(e) => setMigrated((m) => ({ ...m, [name]: e.target.checked }))}
            />
            {name} → GraphQL
          </label>
        ))}
        <label className='switch'>
          <input
            type='checkbox'
            checked={disableBatch}
            onChange={(e) => setDisableBatch(e.target.checked)}
          />
          course: __disableBatch
        </label>
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={loadPage}>
          Tải trang
        </button>
        <button
          onClick={() => {
            setMigrated({ course: true, notes: true, partner: true });
            setDisableBatch(false);
          }}
        >
          Chuyển hết
        </button>
      </div>
      <details style={{ marginBottom: 12 }}>
        <summary>Xem query mà 3 component đang dùng</summary>
        <pre className='log' style={{ whiteSpace: 'pre-wrap' }}>
          {(Object.keys(QUERIES) as QueryName[])
            .map((name) => QUERIES[name](migrated[name]))
            .join('\n\n')}
        </pre>
      </details>
      {error && <p className='err'>{error}</p>}

      <div className='split'>
        <div>
          <div className='card' style={{ marginBottom: 12 }}>
            {course ? (
              <>
                <b style={{ fontSize: 18 }}>{course.name}</b>
                <div className='muted'>
                  {partner?.name ?? '…'} · {course.workload}
                </div>
              </>
            ) : (
              <span className='muted'>Chưa tải</span>
            )}
          </div>
          <div className='card'>
            <b>Ghi chú của bạn</b>
            <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
              {notes?.map((n) => (
                <li key={n.id}>{n.userText}</li>
              ))}
            </ul>
            <div className='toolbar' style={{ marginBottom: 0 }}>
              <input
                type='text'
                value={draft}
                placeholder='Ghi chú mới (mutation @naptime -> POST REST)'
                onChange={(e) => setDraft(e.target.value)}
                style={{ flex: 1, width: 'auto' }}
              />
              <button onClick={addNote} disabled={!notes}>
                Thêm
              </button>
            </div>
          </div>
        </div>
        <div className='sticky'>
          <div className='stats'>
            <Stat label='request HTTP' value={requests.length} />
            <Stat label='ms tải trang' value={elapsed ?? '–'} />
          </div>
          <div className='log' style={{ marginTop: 12 }}>
            {requests.map((r, i) => (
              <div key={i} className={r.url.startsWith('/api') ? 'warn' : 'ok'}>
                {r.method} {r.url}
                {r.operations > 1 ? ` (${r.operations} query)` : ''} · {r.bytes}B
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
