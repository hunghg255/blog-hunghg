import { memo, useEffect, useRef, useState } from 'react';
import { countShared, recycleNodesInto } from '../lib/recycleNodes';
import { Log, Stat, useLog } from './shared';
import './RecycleNodesDemo.css';

/**
 * Mô phỏng hành vi recycleNodesInto trong bundle (viết lại, không phải mã gốc):
 * chỉ duyệt khoá của next, so số khoá bằng độ dài, ghi đè thẳng vào next.
 */
function recycleBundleStyle(a: unknown, b: unknown): unknown {
  const skip = (v: unknown) => typeof v !== 'object' || !v || v instanceof Set || v instanceof Map;
  if (a === b || skip(a) || skip(b)) return b;
  const pa = a as Record<string, unknown>;
  const pb = b as Record<string, unknown>;
  let same = false;
  if (Array.isArray(a) && Array.isArray(b)) {
    same =
      b.reduce((acc: boolean, item, i) => {
        const r = recycleBundleStyle(a[i], item);
        if (r !== b[i]) b[i] = r;
        return acc && r === a[i];
      }, true) && a.length === b.length;
  } else if (!Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(pa);
    const kb = Object.keys(pb);
    same =
      kb.reduce((acc: boolean, k) => {
        const r = recycleBundleStyle(pa[k], pb[k]);
        if (r !== pb[k]) pb[k] = r;
        return acc && r === pa[k];
      }, true) && ka.length === kb.length;
  }
  return same ? a : b;
}

interface Comment {
  id: string;
  by: string;
  text: string;
}
interface Post {
  id: string;
  author: { name: string; avatar: string };
  text: string;
  likes: number;
  comments: Comment[];
  extra: Record<string, unknown>;
}

const NAMES = ['Lan', 'Minh', 'Hà', 'Tuấn', 'Vy', 'Quân'];
function initialServer(): Post[] {
  return NAMES.map((name, i) => ({
    id: `p${i + 1}`,
    author: { name, avatar: name[0] },
    text: `Bài viết số ${i + 1} của ${name}`,
    likes: 3 + i * 2,
    comments: i % 2 === 0 ? [{ id: `c${i}a`, by: 'Bình', text: 'Hay quá' }] : [],
    extra: i === 3 ? { label: 'Đã ghim' } : {},
  }));
}

/** "Server" trả về JSON mới: mọi object đều là tham chiếu mới, kể cả khi nội dung không đổi. */
const respond = (server: Post[]): Post[] => structuredClone(server);

type Col = 'naive' | 'recycled';
const renderCounts: Record<Col, Map<string, number>> = { naive: new Map(), recycled: new Map() };

const PostRow = memo(function PostRow({ post, col }: { post: Post; col: Col }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const m = renderCounts[col];
    m.set(post.id, (m.get(post.id) ?? 0) + 1);
    const el = ref.current;
    if (!el) return;
    el.classList.remove('rn-flash');
    void el.offsetWidth; // khởi động lại animation
    el.classList.add('rn-flash');
  });
  const label = typeof post.extra.label === 'string' ? post.extra.label : null;
  return (
    <div ref={ref} className='rn-post' data-testid={`${col}-${post.id}`}>
      <span className='rn-avatar'>{post.author.avatar}</span>
      <div className='rn-body'>
        <b>{post.author.name}</b> {label && <span className='badge'>{label}</span>}
        <div className='rn-text'>{post.text}</div>
        <div className='rn-meta'>
          ♥ {post.likes} · {post.comments.length} bình luận
        </div>
      </div>
    </div>
  );
});

function FeedSection() {
  const server = useRef<Post[]>(initialServer());
  const [naive, setNaive] = useState<Post[]>(() => respond(server.current));
  const [recycled, setRecycled] = useState<Post[]>(() => respond(server.current));
  const recycledRef = useRef(recycled);
  const [bundleMode, setBundleMode] = useState(false);
  const [result, setResult] = useState({ naive: 0, recycled: 0, shared: 0, fresh: 0, action: '' });
  const pending = useRef<string | null>(null);
  const { lines, add } = useLog(12);

  const apply = (action: string, mutateServer: (s: Post[]) => void) => {
    mutateServer(server.current);
    renderCounts.naive.clear();
    renderCounts.recycled.clear();
    pending.current = bundleMode ? `[kiểu bundle] ${action}` : action;
    const resp1 = respond(server.current);
    const resp2 = respond(server.current);
    const prev = recycledRef.current;
    const next = bundleMode
      ? (recycleBundleStyle(prev, resp2) as Post[])
      : recycleNodesInto(prev, resp2);
    recycledRef.current = next;
    const stats = countShared(prev, next);
    setResult((r) => ({ ...r, shared: stats.shared, fresh: stats.fresh }));
    setNaive(resp1);
    setRecycled(next);
  };

  useEffect(() => {
    if (pending.current === null) return;
    const sum = (m: Map<string, number>) => m.size;
    const n = sum(renderCounts.naive);
    const r = sum(renderCounts.recycled);
    setResult((old) => ({ ...old, naive: n, recycled: r, action: pending.current ?? '' }));
    const stale = bundleMode && JSON.stringify(naive) !== JSON.stringify(recycled);
    add(
      `${pending.current}: không recycle render ${n}/6 dòng, recycle render ${r}/6 dòng${stale ? ' — dữ liệu hai cột KHÁC nhau!' : ''}`,
      stale ? 'err' : r < n ? 'ok' : undefined,
    );
    pending.current = null;
  }, [naive, recycled, add, bundleMode]);

  return (
    <section className='card rn-section'>
      <h2>1. Feed nhận JSON mới mỗi lần refetch</h2>
      <p className='hint'>
        Mỗi dòng là <code>React.memo</code>. Dòng nào nháy là dòng vừa render lại. Cột trái dùng
        thẳng dữ liệu mới, cột phải chạy <code>recycleNodesInto(cũ, mới)</code> trước khi{' '}
        <code>setState</code>.
      </p>
      <div className='toolbar'>
        <button
          className='primary'
          data-testid='rn-refetch'
          onClick={() => apply('Refetch, dữ liệu y hệt', () => {})}
        >
          Refetch (không đổi gì)
        </button>
        <button
          data-testid='rn-like'
          onClick={() => apply('Bài 3 thêm 1 like', (s) => void (s[2].likes += 1))}
        >
          Bài 3 +1 like
        </button>
        <button
          data-testid='rn-comment'
          onClick={() =>
            apply('Bài 5 thêm bình luận', (s) =>
              s[4].comments.push({ id: `c${Date.now()}`, by: 'An', text: 'Đồng ý' }),
            )
          }
        >
          Bài 5 thêm bình luận
        </button>
        <button
          data-testid='rn-unpin'
          onClick={() =>
            apply('Bài 4 bỏ ghim (lệch khoá)', (s) => {
              s[3].extra = s[3].extra.label ? { note: undefined } : { label: 'Đã ghim' };
            })
          }
        >
          Bài 4 bỏ/ghim lại
        </button>
        <label className='switch'>
          <input
            type='checkbox'
            data-testid='rn-bundle'
            checked={bundleMode}
            onChange={(e) => setBundleMode(e.target.checked)}
          />
          Cột phải dùng bản kiểu bundle
        </label>
      </div>
      <div className='stats'>
        <Stat label='không recycle: dòng render lại' value={result.naive} />
        <Stat label='recycle: dòng render lại' value={result.recycled} />
        <Stat label='nút giữ tham chiếu cũ' value={result.shared} />
        <Stat label='nút mới' value={result.fresh} />
      </div>
      <div className='rn-cols'>
        <div>
          <h3>Không recycle</h3>
          {naive.map((p) => (
            <PostRow key={p.id} post={p} col='naive' />
          ))}
        </div>
        <div>
          <h3>{bundleMode ? 'recycle kiểu bundle' : 'recycleNodesInto (viết lại)'}</h3>
          {recycled.map((p) => (
            <PostRow key={p.id} post={p} col='recycled' />
          ))}
        </div>
      </div>
      <Log lines={lines} />
    </section>
  );
}

interface CaseRow {
  name: string;
  run: (fn: (a: unknown, b: unknown) => unknown) => string;
}

const CASES: CaseRow[] = [
  {
    name: 'Lệch khoá: {x:1} → {y:undefined}',
    run: (fn) =>
      JSON.stringify(fn({ x: 1 }, { y: undefined }), (_k, v) => (v === undefined ? '∅' : v)),
  },
  {
    name: 'Map đổi nội dung',
    run: (fn) => {
      const a = new Map([['k', 1]]);
      const b = new Map([['k', 2]]);
      const out = fn({ m: a }, { m: b }) as { m: Map<string, number> };
      return `m.get('k') = ${out.m.get('k')}`;
    },
  },
  {
    name: 'Date đổi giá trị',
    run: (fn) => {
      const out = fn({ d: new Date(0) }, { d: new Date(86400000) }) as { d: Date };
      return out.d.toISOString().slice(0, 10);
    },
  },
  {
    name: 'next bị Object.freeze',
    run: (fn) => {
      try {
        const next = Object.freeze({ a: Object.freeze({ n: 1 }), b: 2 });
        const out = fn({ a: { n: 1 }, b: 1 }, next) as { b: number };
        return `ok, b = ${out.b}`;
      } catch (e) {
        return `ném lỗi: ${(e as Error).message.slice(0, 40)}`;
      }
    },
  },
  {
    name: 'next có bị sửa không?',
    run: (fn) => {
      const prev = { a: { n: 1 }, b: { n: 2 } };
      const next = { a: { n: 1 }, b: { n: 3 } };
      fn(prev, next);
      return next.a === prev.a ? 'có: next.a === prev.a' : 'không';
    },
  },
];

function CasesSection() {
  const [rows] = useState(() =>
    CASES.map((c) => ({
      name: c.name,
      bundle: c.run(recycleBundleStyle),
      fixed: c.run((a, b) => recycleNodesInto(a, b)),
    })),
  );
  return (
    <section className='card rn-section'>
      <h2>2. Ca biên: bản trong bundle và bản viết lại</h2>
      <div className='rn-table-wrap'>
        <table className='rn-table' data-testid='rn-cases'>
          <thead>
            <tr>
              <th>Tình huống</th>
              <th>Kiểu bundle</th>
              <th>Viết lại</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className={r.bundle !== r.fixed ? 'err' : undefined}>{r.bundle}</td>
                <td className={r.bundle !== r.fixed ? 'ok' : undefined}>{r.fixed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className='hint'>
        Bản kiểu bundle mô phỏng bản có guard Map/Set. Bản cũ hơn trong <code>31.js</code> không có
        guard nên cả Map cũng bị "giữ lại" như Date.
      </p>
    </section>
  );
}

export default function RecycleNodesDemo() {
  return (
    <div className='page rn-demo'>
      <h1>Giữ nguyên tham chiếu nhánh dữ liệu không đổi</h1>
      <p className='hint'>
        Mô phỏng <code>recycleNodesInto</code> của Relay: so cây cũ với cây mới, nhánh nào bằng nhau
        thì dùng lại object cũ để <code>React.memo</code> và <code>===</code> bỏ qua render.
      </p>
      <FeedSection />
      <CasesSection />
    </div>
  );
}
