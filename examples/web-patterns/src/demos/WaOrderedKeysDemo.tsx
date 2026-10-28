import { useState } from 'react';
import { MessageKind, chatBounds, encodeOrderedHex, kindBounds, messageKey, toKeyRange } from '../lib/waOrderedKeys';
import { Log, useLog } from './shared';

const DB_NAME = 'wa-ordered-keys-demo';
const CHATS = ['an@c.us', 'binh@c.us', 'cuong@g.us'];
const PER_CHAT = 300;

interface Row {
  key: string | [string, string, number];
  chat: string;
  kind: string;
  counter: number;
}

function req<T>(r: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function openDb() {
  await req(indexedDB.deleteDatabase(DB_NAME));
  const open = indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => {
    const db = open.result;
    db.createObjectStore('naive', { keyPath: 'key' });
    db.createObjectStore('ordered', { keyPath: 'key' });
    db.createObjectStore('array', { keyPath: 'key' });
  };
  return req(open);
}

function shuffled<T>(items: T[]) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Result {
  name: string;
  first: number[];
  count: number;
  from250: number;
  sorted: boolean;
}

export default function WaOrderedKeysDemo() {
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState('9, 10, 15, 16, 255, 256, 4096');
  const { lines, add } = useLog(20);

  async function run() {
    setBusy(true);
    try {
      const db = await openDb();
      const rows: { chat: string; counter: number }[] = [];
      for (const chat of CHATS) for (let c = 1; c <= PER_CHAT; c++) rows.push({ chat, counter: c });
      const tx = db.transaction(['naive', 'ordered', 'array'], 'readwrite');
      for (const { chat, counter } of shuffled(rows)) {
        const base = { chat, kind: MessageKind.incoming, counter };
        tx.objectStore('naive').put({ ...base, key: `${chat}_${MessageKind.incoming}_${counter}` } satisfies Row);
        tx.objectStore('ordered').put({ ...base, key: messageKey(chat, MessageKind.incoming, counter) } satisfies Row);
        tx.objectStore('array').put({ ...base, key: [chat, MessageKind.incoming, counter] } satisfies Row);
      }
      await done(tx);
      add(`Đã ghi ${rows.length} tin × 3 store theo thứ tự ngẫu nhiên`, 'muted');

      const chat = CHATS[0];
      const read = db.transaction(['naive', 'ordered', 'array']);
      const pick = async (
        name: string,
        store: string,
        all: IDBKeyRange,
        from: IDBKeyRange,
      ): Promise<Result> => {
        const list = await req(read.objectStore(store).getAll(all) as IDBRequest<Row[]>);
        const tail = await req(read.objectStore(store).count(from));
        const counters = list.map((r) => r.counter);
        return {
          name,
          first: counters.slice(0, 12),
          count: list.length,
          from250: tail,
          sorted: counters.every((v, i) => i === 0 || counters[i - 1] < v),
        };
      };
      const ordered = kindBounds(chat, MessageKind.incoming, 250);
      const next = await Promise.all([
        pick(
          'Chuỗi thập phân thường',
          'naive',
          IDBKeyRange.bound(`${chat}_1_`, `${chat}_1_~`),
          IDBKeyRange.bound(`${chat}_1_250`, `${chat}_1_~`),
        ),
        pick('Tiền tố độ dài hex (WhatsApp)', 'ordered', toKeyRange(chatBounds(chat)), toKeyRange(ordered)),
        pick(
          'Khoá mảng [chat, loại, counter]',
          'array',
          IDBKeyRange.bound([chat, '1', 0], [chat, '1', Infinity]),
          IDBKeyRange.bound([chat, '1', 250], [chat, '1', Infinity]),
        ),
      ]);
      db.close();
      setResults(next);
      add(`Đọc chat ${chat}: ${next.map((r) => `${r.name}: ${r.from250} tin từ #250`).join(' · ')}`);
    } catch (error) {
      add(`Lỗi IndexedDB: ${String(error)}`, 'err');
    } finally {
      setBusy(false);
    }
  }

  const probeRows = probe
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const n = Number(s);
      try {
        return { n: s, enc: encodeOrderedHex(n) };
      } catch (e) {
        return { n: s, enc: `lỗi: ${(e as Error).message}` };
      }
    });
  const sortedProbe = [...probeRows].filter((r) => !r.enc.startsWith('lỗi')).sort((a, b) => (a.enc < b.enc ? -1 : 1));

  return (
    <div className='page'>
      <h1>Khoá IndexedDB giữ đúng thứ tự số</h1>
      <p className='hint'>
        Ghi 3 chat × 300 tin vào IndexedDB thật (theo thứ tự ngẫu nhiên), rồi đọc lại chat đầu bằng một
        IDBKeyRange. Khoá chuỗi thập phân bị sắp theo kiểu từ điển (1, 10, 100…); thêm tiền tố độ dài hex thì
        đúng thứ tự số, và "từ tin #250 trở đi" chỉ là một range.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={run} disabled={busy} data-testid='run'>
          {busy ? 'Đang chạy…' : 'Ghi và đọc lại'}
        </button>
      </div>
      {results.length > 0 && (
        <table className='wa-keys-table' data-testid='results'>
          <thead>
            <tr>
              <th>Cách đặt khoá</th>
              <th>12 tin đầu (counter)</th>
              <th>Đúng thứ tự?</th>
              <th>Đếm "từ #250"</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className='mono'>{r.first.join(', ')}</td>
                <td className={r.sorted ? 'ok' : 'err'}>{r.sorted ? 'có' : 'không'}</td>
                <td className={r.from250 === PER_CHAT - 249 ? 'ok' : 'err'}>{r.from250}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Thử mã hoá</h2>
      <input
        value={probe}
        onChange={(e) => setProbe(e.target.value)}
        aria-label='Danh sách số'
        style={{ width: '100%' }}
      />
      <div className='split'>
        <div className='card'>
          <b>Mã hoá</b>
          {probeRows.map((r) => (
            <div key={r.n} className='mono'>
              {r.n} → {r.enc}
            </div>
          ))}
        </div>
        <div className='card'>
          <b>Sắp xếp theo chuỗi đã mã hoá</b>
          <div className='mono' data-testid='probe-sorted'>
            {sortedProbe.map((r) => r.n).join(' < ')}
          </div>
        </div>
      </div>
      <Log lines={lines} />
      <style>{`
        .wa-keys-table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 14px; }
        .wa-keys-table th, .wa-keys-table td { border-bottom: 1px solid var(--border); padding: 6px; text-align: left; vertical-align: top; }
        .wa-keys-table td.mono, .mono { font-family: ui-monospace, monospace; font-size: 13px; word-break: break-word; }
        @media (max-width: 560px) { .wa-keys-table th:nth-child(3), .wa-keys-table td:nth-child(3) { display: none; } }
      `}</style>
    </div>
  );
}
