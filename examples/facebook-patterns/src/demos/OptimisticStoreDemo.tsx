import { useRef, useState, useSyncExternalStore } from 'react';
import {
  LayeredStore,
  PublishQueue,
  REMOVED,
  type Mutator,
  type OptimisticUpdate,
  type StoreRecord,
} from '../lib/optimisticStore';
import { Log, Stat, useLog } from './shared';
import './OptimisticStoreDemo.css';

interface ServerState {
  likes: number;
  likedByMe: boolean;
  comments: { id: string; text: string }[];
}

/** Cách ngây thơ: sửa thẳng state, chụp bản sao toàn bộ trước mỗi thao tác để rollback. */
interface NaiveState {
  likes: number;
  liked: boolean;
  comments: { id: string; text: string; pending?: boolean }[];
}

interface Pending {
  key: number;
  kind: 'like' | 'comment' | 'delete' | 'broken';
  label: string;
  update: OptimisticUpdate;
  naiveBackup: NaiveState;
  commentId?: string;
  text?: string;
}

const INITIAL: StoreRecord[] = [
  { id: 'post:1', likes: 10, liked: false, commentIds: ['c:1'] },
  { id: 'c:1', text: 'Ảnh đẹp quá' },
];

function useStoreVersion(store: LayeredStore) {
  return useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.version,
  );
}

function readPost(store: LayeredStore) {
  const src = store.source();
  const post = src.get('post:1')!;
  const ids = (post.commentIds as string[]) ?? [];
  return {
    likes: post.likes as number,
    liked: post.liked as boolean,
    comments: ids.map((id) => ({ id, text: (src.get(id)?.text as string) ?? '(thiếu record)' })),
  };
}

export default function OptimisticStoreDemo() {
  const storeRef = useRef<LayeredStore>(null);
  const queueRef = useRef<PublishQueue>(null);
  const { lines, add } = useLog(14);
  if (!storeRef.current) {
    storeRef.current = new LayeredStore(INITIAL);
    queueRef.current = new PublishQueue(storeRef.current);
    queueRef.current.onError = (label, e) =>
      add(`updater "${label}" ném lỗi: ${(e as Error).message}, bỏ qua`, 'err');
  }
  const store = storeRef.current;
  const queue = queueRef.current!;
  useStoreVersion(store);

  const server = useRef<ServerState>({
    likes: 10,
    likedByMe: false,
    comments: [{ id: 'c:1', text: 'Ảnh đẹp quá' }],
  });
  const [naive, setNaive] = useState<NaiveState>({
    likes: 10,
    liked: false,
    comments: [{ id: 'c:1', text: 'Ảnh đẹp quá' }],
  });
  const naiveRef = useRef(naive);
  const setNaiveBoth = (n: NaiveState) => {
    naiveRef.current = n;
    setNaive(n);
  };
  const [pending, setPending] = useState<Pending[]>([]);
  const [stats, setStats] = useState({ rebases: 0, reapplied: 0 });
  const seq = useRef(0);

  const runQueue = (why: string) => {
    const s = queue.run();
    setStats((o) => ({
      rebases: o.rebases + (s.rebased ? 1 : 0),
      reapplied: o.reapplied + s.reapplied,
    }));
    if (s.rebased)
      add(
        `${why}: bỏ lớp phủ, ghi ${s.committed} payload vào base, áp lại ${s.reapplied} update`,
        'ok',
      );
    else add(`${why}: áp ${s.applied} update mới lên lớp phủ`);
  };

  const view = readPost(store);

  // ---------- thao tác optimistic ----------
  const startLike = () => {
    const liked = view.liked;
    const update: OptimisticUpdate = {
      label: liked ? 'bỏ thích' : 'thích',
      apply: (m: Mutator) => {
        const cur = m.get('post:1', 'liked') as boolean;
        if (cur === !liked) return; // đã đúng trạng thái, không cộng hai lần
        m.set('post:1', 'liked', !liked);
        m.set('post:1', 'likes', (m.get('post:1', 'likes') as number) + (liked ? -1 : 1));
      },
    };
    queue.applyUpdate(update);
    const backup = naiveRef.current;
    setNaiveBoth({ ...backup, liked: !liked, likes: backup.likes + (liked ? -1 : 1) });
    setPending((p) => [
      ...p,
      { key: ++seq.current, kind: 'like', label: update.label, update, naiveBackup: backup },
    ]);
    runQueue(`Optimistic: ${update.label}`);
  };

  const startComment = () => {
    const n = ++seq.current;
    const tempId = `client:c:${n}`;
    const text = `Bình luận #${n}`;
    const update: OptimisticUpdate = {
      label: `thêm "${text}"`,
      apply: (m) => {
        m.create(tempId, { text: `${text} (đang gửi)` });
        m.set('post:1', 'commentIds', [...(m.get('post:1', 'commentIds') as string[]), tempId]);
      },
    };
    queue.applyUpdate(update);
    const backup = naiveRef.current;
    setNaiveBoth({
      ...backup,
      comments: [...backup.comments, { id: tempId, text: `${text} (đang gửi)`, pending: true }],
    });
    setPending((p) => [
      ...p,
      {
        key: n,
        kind: 'comment',
        label: update.label,
        update,
        naiveBackup: backup,
        commentId: tempId,
        text,
      },
    ]);
    runQueue('Optimistic: thêm bình luận');
  };

  const startDelete = () => {
    const first = view.comments[0];
    if (!first) return;
    const update: OptimisticUpdate = {
      label: `xoá ${first.id}`,
      apply: (m) => {
        m.remove(first.id);
        m.set(
          'post:1',
          'commentIds',
          (m.get('post:1', 'commentIds') as string[]).filter((id) => id !== first.id),
        );
      },
    };
    queue.applyUpdate(update);
    const backup = naiveRef.current;
    setNaiveBoth({ ...backup, comments: backup.comments.filter((c) => c.id !== first.id) });
    setPending((p) => [
      ...p,
      {
        key: ++seq.current,
        kind: 'delete',
        label: update.label,
        update,
        naiveBackup: backup,
        commentId: first.id,
      },
    ]);
    runQueue(`Optimistic: ${update.label}`);
  };

  const startBroken = () => {
    const update: OptimisticUpdate = {
      label: 'updater lỗi',
      apply: (m) => {
        m.set('post:1', 'likes', 9999);
        throw new Error('field không tồn tại');
      },
    };
    queue.applyUpdate(update);
    setPending((p) => [
      ...p,
      {
        key: ++seq.current,
        kind: 'broken',
        label: update.label,
        update,
        naiveBackup: naiveRef.current,
      },
    ]);
    runQueue('Optimistic: updater lỗi');
  };

  // ---------- server ----------
  const serverPayload = () => {
    const s = server.current;
    return (m: Mutator) => {
      m.set('post:1', 'likes', s.likes);
      m.set('post:1', 'liked', s.likedByMe);
      s.comments.forEach((c) => {
        if (!m.exists(c.id)) m.create(c.id, { text: c.text });
      });
      m.set(
        'post:1',
        'commentIds',
        s.comments.map((c) => c.id),
      );
    };
  };

  const pushFromOthers = () => {
    server.current.likes += 3;
    queue.commit(serverPayload());
    runQueue('Server push: 3 người khác vừa thích');
    // cách ngây thơ: ghi đè số like bằng số từ server
    setNaiveBoth({
      ...naiveRef.current,
      likes: server.current.likes + (naiveRef.current.liked && !server.current.likedByMe ? 1 : 0),
    });
  };

  const settle = (p: Pending, ok: boolean) => {
    setPending((list) => list.filter((x) => x.key !== p.key));
    queue.revertUpdate(p.update);
    if (ok && p.kind !== 'broken') {
      const s = server.current;
      if (p.kind === 'like') {
        s.likedByMe = !s.likedByMe;
        s.likes += s.likedByMe ? 1 : -1;
      } else if (p.kind === 'comment') {
        s.comments.push({ id: `c:${p.key}00`, text: p.text! });
      } else if (p.kind === 'delete') {
        s.comments = s.comments.filter((c) => c.id !== p.commentId);
      }
      queue.commit(serverPayload());
      runQueue(`Server xác nhận "${p.label}"`);
      setNaiveBoth({
        likes: s.likes,
        liked: s.likedByMe,
        comments: s.comments.map((c) => ({ ...c })),
      });
    } else {
      runQueue(`Server từ chối "${p.label}"`);
      // cách ngây thơ: quay về bản chụp trước thao tác, mất mọi thứ xảy ra sau đó
      setNaiveBoth(p.naiveBackup);
    }
  };

  const layer = store.overlay?.layer;
  const truth = server.current;

  return (
    <div className='page os-demo'>
      <h1>Store optimistic: copy-on-write, rollback rồi áp lại</h1>
      <p className='hint'>
        Mỗi thao tác hiện ngay (optimistic) rồi chờ bạn bấm "Server OK" hoặc "Server lỗi". Thử:
        thích → server push → server lỗi. Cột phải sửa thẳng state và rollback bằng bản chụp, nên
        mất dữ liệu push.
      </p>
      <div className='toolbar'>
        <button className='primary' data-testid='os-like' onClick={startLike}>
          {view.liked ? 'Bỏ thích' : 'Thích'}
        </button>
        <button data-testid='os-comment' onClick={startComment}>
          Thêm bình luận
        </button>
        <button data-testid='os-delete' onClick={startDelete} disabled={!view.comments.length}>
          Xoá bình luận đầu
        </button>
        <button data-testid='os-push' onClick={pushFromOthers}>
          Server push: +3 like từ người khác
        </button>
        <button data-testid='os-broken' onClick={startBroken}>
          Update có updater lỗi
        </button>
      </div>

      <div className='stats'>
        <Stat label='server thật: like' value={truth.likes} />
        <Stat label='update optimistic đang sống' value={queue.appliedUpdates.length} />
        <Stat label='số lần rebase' value={stats.rebases} />
        <Stat label='update được áp lại' value={stats.reapplied} />
      </div>

      <div className='os-cols'>
        <section className='card'>
          <h2>Kho theo lớp (kiểu Relay)</h2>
          <PostCard data={view} testid='os-layered' />
          <div className='os-layers'>
            <div>
              <h3>Lớp phủ {store.overlay ? '' : '(không có)'}</h3>
              <ul data-testid='os-overlay'>
                {layer &&
                  [...layer.entries()].map(([id, v]) => (
                    <li key={id}>
                      <code>{id}</code>{' '}
                      {v === REMOVED ? (
                        <span className='err'>⌫ sentinel xoá</span>
                      ) : (
                        <span className='muted'>{JSON.stringify(v).slice(0, 60)}</span>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
            <div>
              <h3>Base (dữ liệu server)</h3>
              <ul>
                {store.base.ids().map((id) => (
                  <li key={id}>
                    <code>{id}</code>{' '}
                    <span className='muted'>{JSON.stringify(store.base.get(id)).slice(0, 60)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
        <section className='card'>
          <h2>Sửa thẳng + rollback bằng bản chụp</h2>
          <PostCard data={naive} testid='os-naive' />
          {(() => {
            const sig = (d: NaiveState) =>
              `${d.likes} like, ${d.comments.map((c) => c.text).join(' | ')}`;
            const diff = sig(naive) !== sig(view);
            return (
              <p className={`hint ${diff ? 'err' : ''}`} data-testid='os-diff'>
                {diff
                  ? `Lệch với kho theo lớp: cột này "${sig(naive)}", kho theo lớp "${sig(view)}"`
                  : 'Hai cột đang khớp nhau.'}
              </p>
            );
          })()}
        </section>
      </div>

      <section className='card os-pending'>
        <h2>Request đang chờ server</h2>
        {pending.length === 0 && <p className='hint'>Không có request nào.</p>}
        {pending.map((p) => (
          <div key={p.key} className='os-req'>
            <span>{p.label}</span>
            <span className='os-req-actions'>
              <button data-testid={`os-ok-${p.kind}`} onClick={() => settle(p, true)}>
                Server OK
              </button>
              <button data-testid={`os-fail-${p.kind}`} onClick={() => settle(p, false)}>
                Server lỗi
              </button>
            </span>
          </div>
        ))}
      </section>
      <Log lines={lines} />
    </div>
  );
}

function PostCard({ data, testid }: { data: NaiveState; testid: string }) {
  return (
    <div className='os-post' data-testid={testid}>
      <div className='os-photo'>📷 Ảnh hoàng hôn</div>
      <div className='os-likes'>
        <span className={data.liked ? 'os-heart on' : 'os-heart'}>♥</span> <b>{data.likes}</b> lượt
        thích
      </div>
      <ul className='os-comments'>
        {data.comments.map((c) => (
          <li key={c.id} className={c.text.includes('đang gửi') ? 'muted' : undefined}>
            {c.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
