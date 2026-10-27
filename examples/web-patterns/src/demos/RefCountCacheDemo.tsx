import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRefCountCache, useRefCountedQuery, type RefCountCache } from '../lib/refCountCache';
import { sleep, Stat } from './shared';
import './RefCountCacheDemo.css';

type Mode = 'refcount' | 'immediate' | 'never';
const DELAY = 3000;

const DIRECTOR = { __typename: 'Person', id: 7, name: 'Trần Anh Hùng' };
const FILMS: Record<string, object> = {
  a: { __typename: 'Film', id: 'a', title: 'Mùi đu đủ xanh', year: 1993, director: DIRECTOR },
  b: { __typename: 'Film', id: 'b', title: 'Xích lô', year: 1995, director: DIRECTOR },
};

function makeCache(mode: Mode) {
  if (mode === 'never') return createRefCountCache({ setTimer: () => undefined, clearTimer: () => {} });
  return createRefCountCache({ delayMs: mode === 'immediate' ? 0 : DELAY });
}

export default function RefCountCacheDemo() {
  const [mode, setMode] = useState<Mode>('refcount');
  const cache = useMemo(() => makeCache(mode), [mode]);
  const [show, setShow] = useState({ a: true, b: false, list: false });
  const [requests, setRequests] = useState(0);
  const [flipping, setFlipping] = useState(false);
  const flipRef = useRef(false);

  const api = useMemo(
    () => ({
      film: (id: string) => async () => {
        setRequests((n) => n + 1);
        await sleep(400);
        return FILMS[id];
      },
      films: async () => {
        setRequests((n) => n + 1);
        await sleep(400);
        return Object.values(FILMS);
      },
    }),
    [],
  );

  const changeMode = (next: Mode) => {
    setMode(next);
    setRequests(0);
  };

  const flip = async () => {
    flipRef.current = true;
    setFlipping(true);
    for (let i = 0; i < 5 && flipRef.current; i++) {
      setShow((s) => ({ ...s, a: false }));
      await sleep(600);
      setShow((s) => ({ ...s, a: true }));
      await sleep(600);
    }
    flipRef.current = false;
    setFlipping(false);
  };
  useEffect(() => () => void (flipRef.current = false), []);

  return (
    <div className='page rcc'>
      <h1>Cache tự dọn bằng đếm tham chiếu</h1>
      <p className='hint'>
        Mỗi thẻ là một component chạy query. Mount thì giữ query, unmount thì nhả. Hết người giữ, cache chờ{' '}
        {DELAY / 1000}s (Outlook: 30s) rồi mới xoá field gốc và gc các entity không còn ai trỏ tới. Đạo diễn
        dùng chung giữa hai phim nên chỉ bị xoá khi cả hai phim đã bị dọn.
      </p>

      <div className='toolbar' role='radiogroup' aria-label='Cách dọn cache'>
        {(
          [
            ['refcount', `Đếm tham chiếu + chờ ${DELAY / 1000}s`],
            ['immediate', 'Dọn ngay khi unmount'],
            ['never', 'Không bao giờ dọn'],
          ] as const
        ).map(([value, label]) => (
          <button key={value} role='radio' aria-checked={mode === value} className={mode === value ? 'primary' : ''} onClick={() => changeMode(value)}>
            {label}
          </button>
        ))}
      </div>

      <div className='toolbar'>
        {(['a', 'b', 'list'] as const).map((key) => (
          <label key={key} className='rcc-toggle'>
            <input type='checkbox' checked={show[key]} disabled={flipping && key === 'a'} onChange={(e) => setShow((s) => ({ ...s, [key]: e.target.checked }))} />
            {key === 'list' ? 'Danh sách phim' : `Thẻ phim ${key.toUpperCase()}`}
          </label>
        ))}
        <button onClick={flip} disabled={flipping}>
          Đóng/mở thẻ A 5 lần
        </button>
      </div>

      <div className='stats'>
        <Stat label='request đã gửi' value={requests} />
        <Inspector cache={cache} />
      </div>

      <div className='rcc-cards'>
        {show.a && <FilmCard key={`a-${mode}`} cache={cache} id='a' fetcher={api.film('a')} />}
        {show.b && <FilmCard key={`b-${mode}`} cache={cache} id='b' fetcher={api.film('b')} />}
        {show.list && <FilmList key={`list-${mode}`} cache={cache} fetcher={api.films} />}
      </div>

      <CacheView cache={cache} />
    </div>
  );
}

interface Film {
  title: string;
  year: number;
  director?: { name: string };
}

function FilmCard({ cache, id, fetcher }: { cache: RefCountCache; id: string; fetcher: () => Promise<unknown> }) {
  const film = useRefCountedQuery<Film>(cache, `FilmQuery(${id})`, `film({"id":"${id}"})`, fetcher);
  return (
    <div className='card'>
      {film ? (
        <>
          <b>{film.title}</b> ({film.year})<br />
          <span className='muted'>Đạo diễn: {film.director?.name}</span>
        </>
      ) : (
        <span className='muted'>Đang tải phim {id.toUpperCase()}…</span>
      )}
    </div>
  );
}

function FilmList({ cache, fetcher }: { cache: RefCountCache; fetcher: () => Promise<unknown> }) {
  const films = useRefCountedQuery<Film[]>(cache, 'FilmsQuery', 'films', fetcher);
  return (
    <div className='card'>
      <b>Danh sách</b>
      {films ? (
        <ul>
          {films.map((f) => (
            <li key={f.title}>{f.title}</li>
          ))}
        </ul>
      ) : (
        <div className='muted'>Đang tải…</div>
      )}
    </div>
  );
}

function useInspect(cache: RefCountCache) {
  useSyncExternalStore(cache.subscribe, cache.getVersion);
  const snapshot = cache.inspect();
  // có query đang chờ dọn thì vẽ lại liên tục để đếm ngược
  const [, tick] = useState(0);
  const pending = snapshot.queries.some((q) => q.cleanupAt);
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [pending]);
  return snapshot;
}

function Inspector({ cache }: { cache: RefCountCache }) {
  const snap = useInspect(cache);
  return (
    <>
      <Stat label='field gốc trong cache' value={snap.roots.length} />
      <Stat label='entity trong cache' value={snap.entities.length} />
    </>
  );
}

function CacheView({ cache }: { cache: RefCountCache }) {
  const snap = useInspect(cache);
  return (
    <div className='rcc-view'>
      <div>
        <h2>Query đang theo dõi</h2>
        <ul>
          {snap.queries.map((q) => (
            <li key={q.key}>
              <code>{q.key}</code> · giữ: {q.refs}
              {q.cleanupAt != null && <span className='warn'> · dọn sau {Math.max(0, (q.cleanupAt - Date.now()) / 1000).toFixed(1)}s</span>}
            </li>
          ))}
          {snap.queries.length === 0 && <li className='muted'>(trống)</li>}
        </ul>
      </div>
      <div>
        <h2>Field gốc</h2>
        <ul>
          {snap.roots.map((r) => (
            <li key={r}>
              <code>{r}</code>
            </li>
          ))}
          {snap.roots.length === 0 && <li className='muted'>(trống)</li>}
        </ul>
        <h2>Entity</h2>
        <ul>
          {snap.entities.map((e) => (
            <li key={e}>
              <code>{e}</code>
            </li>
          ))}
          {snap.entities.length === 0 && <li className='muted'>(trống)</li>}
        </ul>
      </div>
      <div>
        <h2>Nhật ký</h2>
        <div className='log'>
          {snap.log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
