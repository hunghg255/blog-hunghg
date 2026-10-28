import { useEffect, useRef, useState } from 'react';
import { createKeyedQueue, MediaLruStore, type CacheLike } from '../lib/waMediaLru';
import { Log, Stat, useLog } from './shared';
import './WaMediaLruDemo.css';

const MB = 1024 * 1024;
const QUOTA = 40 * MB;
const mb = (n: number) => `${(n / MB).toFixed(1)} MB`;

/** createEnqueue gốc (bihghijhgb), để so sánh: lỗi một lần là key kẹt mãi. */
function createEnqueueOriginal() {
  const e: Record<string, Promise<unknown> | undefined> = {};
  return <A extends unknown[], R>(t: (...a: A) => Promise<R>) =>
    function i(...r: A): Promise<R> {
      const s = String(r[0]);
      if (e[s]) {
        const n = e[s].then(() => (delete e[s], i(...r)));
        return (e[s] = n), n;
      }
      const o: Promise<R> = t(...r).then((x) => (e[s] === o && delete e[s], x));
      return (e[s] = o), o;
    };
}

function fakeMedia(n: number) {
  const out = new Uint8Array(n);
  for (let at = 0; at < n; at += 65536) crypto.getRandomValues(out.subarray(at, at + 65536));
  return out;
}

/** Cache API thật, bọc lại để giả lập QuotaExceededError ở lần ghi kế. */
async function openCache(failNext: { current: boolean }): Promise<CacheLike> {
  const real: CacheLike =
    'caches' in window
      ? await caches.open('wa-demo-media-lru')
      : (() => {
          const m = new Map<string, Response>();
          return {
            match: async (r: RequestInfo | URL) => m.get(String(r))?.clone(),
            put: async (r: RequestInfo | URL, res: Response) => void m.set(String(r), res),
            delete: async (r: RequestInfo | URL) => m.delete(String(r)),
            keys: async () => [...m.keys()].map((u) => new Request(u)),
          } as unknown as CacheLike;
        })();
  return {
    match: real.match.bind(real),
    delete: real.delete.bind(real),
    keys: real.keys.bind(real),
    put: async (req, res) => {
      if (failNext.current) {
        failNext.current = false;
        throw new DOMException('Giả lập: hết quota', 'QuotaExceededError');
      }
      return real.put(req, res);
    },
  } as CacheLike;
}

export default function WaMediaLruDemo() {
  const log = useLog(40);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const [other, setOther] = useState(20);
  const otherRef = useRef(other);
  const failNext = useRef(false);
  const waWrites = useRef(0);
  const serial = useRef(1);
  const [store, setStore] = useState<MediaLruStore>();
  const [queueResult, setQueueResult] = useState<{ wa: string[]; ours: string[] }>();

  useEffect(() => {
    const s: MediaLruStore = new MediaLruStore({
      openCache: () => openCache(failNext),
      initialMaxSize: 15 * MB,
      // Thu nhỏ 1:100 so với bản gốc (chừa 100–500 MB) để demo chạy với vài MB.
      targetFree: (q) => Math.min(5 * MB, Math.max(1 * MB, Math.floor(q * 0.01))),
      estimate: async (): Promise<{ quota: number; usage: number }> => ({ quota: QUOTA, usage: otherRef.current * MB + s.currentSize }),
      onEvict: (key, size, reason) => log.add(`đuổi ${key} (${mb(size)}): ${reason}`, 'warn'),
    });
    s.open().then(async () => {
      for (const [k] of s.entries()) await s.delete(k);
      await s.updateMaxSize();
      setStore(s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function receive() {
    if (!store) return;
    for (let i = 0; i < 4; i++) {
      const key = `media-${serial.current++}`;
      const size = Math.round((0.4 + Math.random() * 1.6) * MB);
      const ok = await store.put(key, fakeMedia(size));
      if (ok) waWrites.current += size;
      log.add(ok ? `lưu ${key} (${mb(size)})` : `không lưu ${key} (${mb(size)})`, ok ? undefined : 'err');
      rerender();
    }
  }

  async function open(key: string) {
    if (!store) return;
    const data = await store.get(key);
    // Bản gốc: doGet có kết quả là put lại cả file để cập nhật timestamp.
    if (data) waWrites.current += data.byteLength;
    log.add(data ? `mở ${key}: lấy từ cache, ${mb(data.byteLength)}` : `${key} không còn trong cache`, data ? 'ok' : 'err');
    rerender();
  }

  async function changeOther(v: number) {
    setOther(v);
    otherRef.current = v;
    if (!store) return;
    const before = store.maxSize;
    const after = await store.updateMaxSize();
    if (after !== before) log.add(`updateMaxSize: giới hạn ${mb(before)} → ${mb(after)}`);
    rerender();
  }

  async function compareQueue() {
    const run = async (enqueue: ReturnType<typeof createKeyedQueue>) => {
      let fail = true;
      const put = enqueue(async (key: string) => {
        if (fail) {
          fail = false;
          throw new Error('lỗi mạng');
        }
        return `ok ${key}`;
      });
      const out: string[] = [];
      for (let n = 0; n < 4; n++) out.push(await put('media-7').catch((e: Error) => `✘ ${e.message}`));
      return out;
    };
    setQueueResult({
      wa: await run(createEnqueueOriginal() as ReturnType<typeof createKeyedQueue>),
      ours: await run(createKeyedQueue()),
    });
  }

  const free = QUOTA - other * MB - (store?.currentSize ?? 0);
  const entries = store?.entries() ?? [];
  const biggest = Math.max(1, ...entries.map(([, m]) => m.size));

  return (
    <div className='page wa-lru'>
      <h1>WhatsApp #5: kho media LRU tự co theo quota</h1>
      <p className='hint'>
        Media lưu bằng Cache API thật của trình duyệt. Quota là giả lập ({mb(QUOTA)}) để thấy kho co lại khi trang khác
        chiếm chỗ. Ngưỡng chừa trống thu nhỏ 1:100 so với bản gốc.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={receive} disabled={!store} data-testid='receive'>
          Nhận 4 media
        </button>
        <button
          onClick={() => {
            failNext.current = true;
            log.add('lần ghi kế tiếp sẽ ném QuotaExceededError', 'warn');
          }}
          data-testid='quota'
        >
          Lần ghi sau hết quota
        </button>
        <label className='wa-lru-slider'>
          Dữ liệu khác: <bdi>{other} MB</bdi>
          <input type='range' min={0} max={38} value={other} onChange={(e) => changeOther(+e.target.value)} data-testid='other' />
        </label>
      </div>
      <div className='stats'>
        <Stat label='kho đang chiếm' value={mb(store?.currentSize ?? 0)} />
        <Stat label='giới hạn kho' value={mb(store?.maxSize ?? 0)} />
        <Stat label='quota còn trống' value={mb(free)} />
        <Stat label='byte ghi: viết lại' value={mb(store?.bytesWritten ?? 0)} />
        <Stat label='byte ghi: kiểu gốc' value={<bdi data-testid='wa-writes'>{mb(waWrites.current)}</bdi>} />
      </div>
      <div className='split'>
        <div>
          <ol className='wa-lru-list' aria-label='Media trong kho, cũ nhất trước'>
            {entries.map(([key, m]) => (
              <li key={key}>
                <button onClick={() => open(key)}>Mở</button>
                <span>{key}</span>
                <i style={{ width: `${(m.size / biggest) * 100}%` }} />
                <small>{mb(m.size)}</small>
              </li>
            ))}
            {!entries.length && <li className='muted'>Kho trống</li>}
          </ol>
          <div className='card'>
            <b>Hàng đợi theo key: ghi lỗi 1 lần rồi gọi lại cùng key</b>
            <div className='toolbar'>
              <button onClick={compareQueue} data-testid='queue'>
                Chạy 4 lần
              </button>
            </div>
            {queueResult && (
              <div className='wa-lru-queue'>
                <div>
                  <small className='muted'>createEnqueue gốc</small>
                  {queueResult.wa.map((r, i) => (
                    <div key={i} className={r.startsWith('✘') ? 'err' : 'ok'} data-testid='wa-q'>
                      {r}
                    </div>
                  ))}
                </div>
                <div>
                  <small className='muted'>createKeyedQueue</small>
                  {queueResult.ours.map((r, i) => (
                    <div key={i} className={r.startsWith('✘') ? 'err' : 'ok'}>
                      {r}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <Log lines={log.lines} />
      </div>
    </div>
  );
}
