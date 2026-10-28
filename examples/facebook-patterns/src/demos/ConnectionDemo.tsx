import { useRef, useState } from 'react';
import {
  createEdge,
  deleteNode,
  insertEdgeBefore,
  mergeFeedPage,
  mergePage,
  type Connection,
  type PageArgs,
  type ServerPage,
} from '../lib/connection';
import { Log, Stat, sleep, useLog } from './shared';
import './ConnectionDemo.css';

interface Post {
  id: string;
  title: string;
}

const PAGE = 4;

/** Server giả: danh sách mới nhất trước, cursor là id bài. */
class FakeServer {
  posts: Post[] = Array.from({ length: 24 }, (_, i) => ({
    id: `p${i + 1}`,
    title: `Bài ${i + 1}`,
  }));
  newCount = 0;
  repeatNext = false;

  page(args: PageArgs): ServerPage<Post> {
    const ps = this.posts;
    let slice: Post[];
    let hasNext = false;
    let hasPrev = false;
    if (args.before != null) {
      const at = ps.findIndex((p) => p.id === args.before);
      const from = Math.max(0, at - (args.last ?? PAGE));
      slice = ps.slice(from, at);
      hasPrev = from > 0;
    } else {
      const at = args.after != null ? ps.findIndex((p) => p.id === args.after) + 1 : 0;
      slice = ps.slice(at, at + (args.first ?? PAGE));
      hasNext = at + PAGE < ps.length;
      if (this.repeatNext && at >= 2) {
        // feed xếp hạng lại: trang sau lẫn 2 bài đã trả trước đó
        slice = [ps[at - 2], ps[at - 1], ...slice.slice(0, PAGE - 2)];
      }
    }
    return {
      edges: slice.map((p) => ({ cursor: p.id, node: { ...p } })),
      pageInfo: {
        hasNextPage: hasNext,
        hasPreviousPage: hasPrev,
        startCursor: slice[0]?.id ?? null,
        endCursor: slice[slice.length - 1]?.id ?? null,
      },
    };
  }
}

interface NaiveList {
  edges: { cursor: string | null; node: Post | null }[];
  endCursor: string | null;
  startCursor: string | null;
}

type Mode = 'relay' | 'feed';

export default function ConnectionDemo() {
  const server = useRef(new FakeServer());
  const [conn, setConn] = useState<Connection<Post> | null>(null);
  const connRef = useRef<Connection<Post> | null>(null);
  const [naive, setNaive] = useState<NaiveList>({ edges: [], endCursor: null, startCursor: null });
  const naiveRef = useRef(naive);
  const [mode, setMode] = useState<Mode>('relay');
  const [stats, setStats] = useState({ dropped: 0, rejected: 0, requests: 0 });
  const [busy, setBusy] = useState(0);
  const posted = useRef(0);
  const { lines, add } = useLog(14);

  const commit = (c: Connection<Post>) => {
    connRef.current = c;
    setConn(c);
  };
  const commitNaive = (n: NaiveList) => {
    naiveRef.current = n;
    setNaive(n);
  };

  /** Gửi request với args chụp TẠI LÚC BẤM, trả về sau `delay` ms. */
  const request = async (
    label: string,
    argsOf: () => { relay: PageArgs; naive: PageArgs },
    delay = 350,
  ) => {
    const { relay, naive: nArgs } = argsOf();
    setBusy((b) => b + 1);
    setStats((s) => ({ ...s, requests: s.requests + 1 }));
    await sleep(delay);
    const page = server.current.page(relay);
    const merge = mode === 'feed' ? mergeFeedPage : mergePage;
    const out = merge(connRef.current, 'feed', page, relay);
    commit(out.connection);
    setStats((s) => ({
      ...s,
      dropped: s.dropped + out.dropped,
      rejected: s.rejected + (out.result === 'rejected' ? 1 : 0),
    }));
    if (out.warning) add(`${label}: ${out.warning}`, 'warn');
    else
      add(
        `${label}: ${out.result}, nhận ${page.edges.length} edge, bỏ ${out.dropped} bản trùng`,
        out.dropped ? 'ok' : undefined,
      );

    // cách ngây thơ: nối thẳng, cập nhật cursor theo trang vừa nhận
    const np = server.current.page(nArgs);
    const cur = naiveRef.current;
    if (nArgs.before != null)
      commitNaive({
        ...cur,
        edges: [...np.edges, ...cur.edges],
        startCursor: np.pageInfo.startCursor ?? cur.startCursor,
      });
    else if (nArgs.after != null)
      commitNaive({
        ...cur,
        edges: [...cur.edges, ...np.edges],
        endCursor: np.pageInfo.endCursor ?? cur.endCursor,
      });
    else
      commitNaive({
        edges: np.edges,
        endCursor: np.pageInfo.endCursor ?? null,
        startCursor: np.pageInfo.startCursor ?? null,
      });
    server.current.repeatNext = false;
    setBusy((b) => b - 1);
  };

  const loadMore = (label = 'Tải tiếp') =>
    request(label, () => ({
      relay: { first: PAGE, after: connRef.current?.pageInfo.endCursor ?? null },
      naive: { first: PAGE, after: naiveRef.current.endCursor },
    }));

  const doubleClick = () => {
    // hai request cùng after, trả về lệch nhau
    void loadMore('Request 1');
    void (async () => {
      const relayAfter = connRef.current?.pageInfo.endCursor ?? null;
      const naiveAfter = naiveRef.current.endCursor;
      await sleep(10);
      await request(
        'Request 2 (cùng cursor)',
        () => ({
          relay: { first: PAGE, after: relayAfter },
          naive: { first: PAGE, after: naiveAfter },
        }),
        600,
      );
    })();
  };

  const newerPosts = () => {
    const s = server.current;
    const fresh = [1, 2].map(() => ({ id: `n${++s.newCount}`, title: `Bài mới ${s.newCount}` }));
    s.posts = [...fresh.reverse(), ...s.posts];
    add('Server: có 2 bài mới ở đầu feed', 'muted');
    void request('Tải bài mới hơn', () => ({
      relay: { last: PAGE, before: connRef.current?.pageInfo.startCursor ?? null },
      naive: { last: PAGE, before: naiveRef.current.startCursor },
    }));
  };

  const postOwn = () => {
    const id = `me${++posted.current}`;
    const node = { id, title: `Bài của tôi #${posted.current}` };
    lastPosted.current = node;
    if (connRef.current) commit(insertEdgeBefore(connRef.current, createEdge('feed', node)));
    commitNaive({
      ...naiveRef.current,
      edges: [{ cursor: null, node }, ...naiveRef.current.edges],
    });
    add(`Đăng ${id}: insertEdgeBefore`);
  };
  const lastPosted = useRef<Post | null>(null);
  const repostSame = () => {
    const node = lastPosted.current;
    if (!node) return;
    // subscription realtime báo lại đúng bài vừa đăng
    if (connRef.current) {
      const before = connRef.current;
      const after = insertEdgeBefore(before, createEdge('feed', node));
      commit(after);
      add(
        after === before
          ? `Realtime báo lại ${node.id}: đã có, bỏ qua (dedupe)`
          : `Chèn ${node.id} lần nữa`,
        'ok',
      );
    }
    commitNaive({
      ...naiveRef.current,
      edges: [{ cursor: null, node }, ...naiveRef.current.edges],
    });
  };

  const removeFirst = () => {
    const first = connRef.current?.edges.find((e) => e.node)?.node;
    if (!first || !connRef.current) return;
    commit(deleteNode(connRef.current, first.id));
    commitNaive({
      ...naiveRef.current,
      edges: naiveRef.current.edges.filter((e) => e.node?.id !== first.id),
    });
    add(`deleteNode(${first.id})`);
  };

  const reset = () => {
    server.current = new FakeServer();
    connRef.current = null;
    setConn(null);
    commitNaive({ edges: [], endCursor: null, startCursor: null });
    setStats({ dropped: 0, rejected: 0, requests: 0 });
    posted.current = 0;
    lastPosted.current = null;
  };

  const naiveIds = naive.edges.map((e) => e.node?.id);
  const dupCount = naiveIds.filter((id, i) => id && naiveIds.indexOf(id) !== i).length;

  return (
    <div className='page cn-demo'>
      <h1>Phân trang connection: cursor khớp đầu, edge không trùng</h1>
      <p className='hint'>
        Server giả trả trang {PAGE} bài, cursor là id bài. Cột trái nối thẳng mảng; cột phải ghép
        như ConnectionHandler của Relay. Mỗi request mất 350 ms (request thứ hai của "bấm 2 lần" mất
        600 ms).
      </p>
      <div className='toolbar'>
        <button className='primary' data-testid='cn-more' onClick={() => void loadMore()}>
          {conn ? 'Tải tiếp' : 'Tải trang đầu'}
        </button>
        <button data-testid='cn-double' onClick={doubleClick} disabled={!conn}>
          Bấm "Tải tiếp" 2 lần liền
        </button>
        <button
          data-testid='cn-repeat'
          disabled={!conn}
          onClick={() => {
            server.current.repeatNext = true;
            void loadMore('Tải tiếp (server lẫn 2 bài cũ)');
          }}
        >
          Trang sau lẫn bài cũ
        </button>
        <button data-testid='cn-newer' onClick={newerPosts} disabled={!conn || mode === 'feed'}>
          2 bài mới → tải bài mới hơn
        </button>
      </div>
      <div className='toolbar'>
        <button data-testid='cn-post' onClick={postOwn} disabled={!conn}>
          Đăng bài
        </button>
        <button data-testid='cn-repost' onClick={repostSame} disabled={!conn}>
          Realtime báo lại bài vừa đăng
        </button>
        <button data-testid='cn-delete' onClick={removeFirst} disabled={!conn}>
          Xoá bài đầu
        </button>
        <button
          data-testid='cn-refetch'
          disabled={!conn}
          onClick={() =>
            void request('Làm mới', () => ({ relay: { first: PAGE }, naive: { first: PAGE } }))
          }
        >
          Làm mới (refetch)
        </button>
        <button onClick={reset}>Làm lại</button>
        <label className='switch'>
          <input
            type='checkbox'
            data-testid='cn-feed'
            checked={mode === 'feed'}
            onChange={(e) => {
              reset();
              setMode(e.target.checked ? 'feed' : 'relay');
            }}
          />
          Cột phải dùng handler của News Feed
        </label>
      </div>
      <div className='stats'>
        <Stat label='request' value={stats.requests} />
        <Stat label='edge trùng bị bỏ' value={stats.dropped} />
        <Stat label='trang bị từ chối (cursor lệch)' value={stats.rejected} />
        <Stat
          label='cột trái: bản trùng'
          value={<strong className={dupCount ? 'err' : ''}>{dupCount}</strong>}
        />
        <Stat label='đang chờ' value={busy} />
      </div>
      <div className='cn-cols'>
        <section className='card'>
          <h2>Nối thẳng mảng</h2>
          <small className='muted'>
            start {naive.startCursor ?? '∅'} · end {naive.endCursor ?? '∅'}
          </small>
          <ol className='cn-list' data-testid='cn-naive'>
            {naive.edges.map((e, i) => {
              const dup = e.node && naiveIds.indexOf(e.node.id) !== i;
              return (
                <li key={i} className={dup ? 'dup' : undefined}>
                  {e.node?.title} {dup && <span className='badge err'>trùng</span>}
                </li>
              );
            })}
          </ol>
        </section>
        <section className='card'>
          <h2>{mode === 'feed' ? 'Handler News Feed' : 'ConnectionHandler'}</h2>
          <small className='muted' data-testid='cn-pageinfo'>
            start {conn?.pageInfo.startCursor ?? '∅'} · end {conn?.pageInfo.endCursor ?? '∅'} ·
            hasNext {String(conn?.pageInfo.hasNextPage ?? false)} · nextEdgeIndex{' '}
            {conn?.nextEdgeIndex ?? 0}
          </small>
          <ol className='cn-list' data-testid='cn-relay'>
            {conn?.edges.map((e) => (
              <li key={e.id}>
                {e.node?.title} <code>{e.id.replace('client:feed:', '')}</code>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <Log lines={lines} />
    </div>
  );
}
