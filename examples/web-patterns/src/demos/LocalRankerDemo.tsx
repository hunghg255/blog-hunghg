import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  createLocalRanker,
  normalize,
  type Contact,
  type Features,
  type LocalRanker,
  type Ranked,
  type ShadowReport,
} from '../lib/localRanker';
import { Log, useLog } from './shared';
import './LocalRankerDemo.css';

const NAMES = [
  'Nguyễn Văn An', 'Nguyễn Thị Bình', 'Nguyễn Minh Đức', 'Nguyễn Hoàng Long', 'Nguyễn Thu Trang',
  'Trần Hoàng Nam', 'Trần Thị Hà', 'Trần Quốc Tuấn', 'Trần Minh Khoa', 'Lê Văn Đức', 'Lê Thị Mai',
  'Lê Hoàng Anh', 'Phạm Thị Ngọc', 'Phạm Minh Tâm', 'Hoàng Văn Hải', 'Huỳnh Thị Lan', 'Vũ Đức Thắng',
  'Võ Thị Hồng', 'Đặng Văn Hùng', 'Bùi Thị Thảo', 'Đỗ Minh Quân', 'Hồ Thị Nga', 'Ngô Văn Sơn',
  'Dương Thị Yến', 'Lý Hoàng Phúc', 'Nguyễn Đức Trung', 'Trần Ngọc Ánh', 'Lê Minh Nhật',
];

const slug = (name: string) => normalize(name).split(' ').reverse().join('.');

const CONTACTS: Contact[] = NAMES.map((name) => ({ name, key: `${slug(name)}@cty.vn` }));
/** Liên hệ chỉ server biết (chưa có trong cache của tab) */
const DIRECTORY_ONLY: Contact[] = [{ name: 'Nguyễn Thanh Ngân', key: 'ngan.thanh.nguyen@cty.vn' }];

const MODEL = {
  version: 'demo-linear-1',
  weights: { emails30d: 1, recency: 20, favorite: 15, sameTeam: 8 },
  staticFeatures: ['favorite', 'sameTeam'],
  charSwaps: [['d', 'đ'] as [string, string]],
};

/** Feature "thật" ở server sau `day` ngày: vài người liên lạc nhiều lên, vài người ít đi. */
function serverFeatures(contact: Contact, day: number): Features {
  const i = NAMES.indexOf(contact.name);
  const seed = i < 0 ? 7 : i;
  let emails = (seed * 37) % 29;
  if (contact.name === 'Trần Hoàng Nam') emails = 2 + day * 4; // dự án mới, mail qua lại liên tục
  if (contact.name === 'Nguyễn Văn An') emails = Math.max(0, 30 - day * 4); // chuyển phòng
  if (contact.name === 'Nguyễn Hoàng Long') emails = 4 + day * 3;
  if (contact.name === 'Nguyễn Thanh Ngân') emails = 1; // chỉ server có, ít liên lạc
  const recency = Math.min(1, emails / 30);
  return {
    emails30d: emails,
    recency: Math.round(recency * 100) / 100,
    favorite: seed % 9 === 0 ? 1 : 0,
    sameTeam: seed % 4 === 0 ? 1 : 0,
  };
}

function serverSearch(query: string, day: number) {
  const q = normalize(query.trim());
  const all = [...CONTACTS, ...DIRECTORY_ONLY];
  const score = (f: Features) => Object.entries(MODEL.weights).reduce((s, [k, w]) => s + w * (f[k] ?? 0), 0);
  return all
    .filter((c) => {
      const words = [c.key.split('@')[0], ...normalize(c.name).split(' '), normalize(c.name).replace(/ /g, '')];
      return words.some((w) => w.startsWith(q));
    })
    .map((c) => ({ contact: c, features: serverFeatures(c, day) }))
    .sort((a, b) => score(b.features) - score(a.features) || a.contact.name.localeCompare(b.contact.name))
    .slice(0, 5)
    .map((r) => ({ key: r.contact.key, name: r.contact.name, features: r.features, score: score(r.features) }));
}

function makeRanker(day: number) {
  const ranker = createLocalRanker(MODEL);
  ranker.load(CONTACTS.map((contact) => ({ contact, features: serverFeatures(contact, day) })));
  return ranker;
}

type ServerRow = ReturnType<typeof serverSearch>[number];

export default function LocalRankerDemo() {
  const { lines, add } = useLog(30);
  const [loadedDay, setLoadedDay] = useState(0);
  const [day, setDay] = useState(0);
  const [sync, setSync] = useState(true);
  const [query, setQuery] = useState('');
  const [client, setClient] = useState<Ranked[]>([]);
  const [clientMs, setClientMs] = useState(0);
  const [server, setServer] = useState<ServerRow[] | null>(null);
  const [report, setReport] = useState<ShadowReport | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [reloads, setReloads] = useState(0);
  const ranker = useRef<LocalRanker>(makeRanker(0));
  const syncRef = useRef(sync);
  syncRef.current = sync;

  useEffect(() => {
    if (!query.trim()) {
      setClient([]);
      setServer(null);
      setReport(null);
      return;
    }
    const t0 = performance.now();
    const local = ranker.current.search(query);
    setClientMs(performance.now() - t0);
    setClient(local);
    setServer(null);
    setReport(null);
    // "Server" trả lời sau 350ms
    const timer = setTimeout(() => {
      const remote = serverSearch(query, day);
      const r = ranker.current.compareWithServer(local, remote, { sync: syncRef.current });
      const hit = r.matchedPositions.reduce((a, b) => a + b, 0);
      const total = Math.min(5, Math.max(local.length, remote.length));
      setServer(remote);
      setReport(r);
      if (remote.length === 0) {
        add(`"${query}": server không có kết quả (client tìm được nhờ sửa lỗi gõ)`, 'muted');
        return;
      }
      setHistory((h) => [...h, hit / total].slice(-20));
      add(
        `"${query}": khớp ${hit}/${total} vị trí, lệch ${r.featureDiffs.length} feature` +
          (syncRef.current ? `, chép đè ${r.synced} giá trị` : ''),
        hit === total ? 'ok' : 'warn',
      );
    }, 350);
    return () => clearTimeout(timer);
  }, [query, day, reloads, add]);

  const reload = () => {
    ranker.current = makeRanker(day);
    setLoadedDay(day);
    setHistory([]);
    add(`Tải lại trang: feature trong tab = server ngày ${day}`, 'muted');
    setReloads((n) => n + 1); // chạy lại tìm kiếm với ranker mới
  };

  const avg = history.length ? Math.round((history.reduce((a, b) => a + b, 0) / history.length) * 100) : null;

  return (
    <div className='page local-ranker'>
      <h1>Xếp hạng gợi ý trên client, so ngầm với server</h1>
      <p className='hint'>
        Gõ vào ô "Tới": danh sách bên trái tính ngay trong trình duyệt (trie + model), bên phải là kết quả
        server về sau 350ms. Kéo "tab đã mở" lên vài ngày: feature ở server đổi, client lệch. Bật tự hiệu chỉnh
        để client chép feature mới của server sau mỗi lần so.
      </p>

      <div className='toolbar'>
        <label className='lr-day'>
          Tab đã mở <b>{day - loadedDay}</b> ngày
          <input type='range' min={loadedDay} max={loadedDay + 14} value={day} onChange={(e) => setDay(+e.target.value)} />
        </label>
        <label className='switch'>
          <input type='checkbox' checked={sync} onChange={(e) => setSync(e.target.checked)} /> Tự hiệu chỉnh feature (Outlook)
        </label>
        <button onClick={reload}>Tải lại trang</button>
      </div>

      <div className='toolbar'>
        <input
          type='text'
          aria-label='Tới'
          placeholder='Tới: gõ tên hoặc email…'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {['ng', 'nguyen', 'tran', 'nugyen', 'duc'].map((q) => (
          <button key={q} onClick={() => setQuery(q)}>
            {q}
          </button>
        ))}
      </div>

      <div className='stats'>
        <div className='stat'>
          <b>{query.trim() ? `${clientMs.toFixed(2)} ms` : '–'}</b>
          <span>client tính top-5</span>
        </div>
        <div className='stat'>
          <b>
            {report && server
              ? `${report.matchedPositions.reduce((a, b) => a + b, 0)}/${Math.min(5, Math.max(client.length, server.length))}`
              : '…'}
          </b>
          <span>vị trí trùng server</span>
        </div>
        <div className='stat'>
          <b>{avg === null ? '–' : `${avg}%`}</b>
          <span>trùng trung bình ({history.length} lần so)</span>
        </div>
      </div>

      <div className='lr-cols'>
        <Column title='Client (ngay lập tức)'>
          {client.map((r, i) => (
            <Row
              key={r.contact.key}
              index={i}
              name={r.contact.name}
              email={r.contact.key}
              score={r.score}
              match={report ? report.matchedPositions[i] === 1 : undefined}
              note={r.fuzzy ? 'sửa lỗi gõ' : undefined}
            />
          ))}
        </Column>
        <Column title='Server (350ms sau)'>
          {server === null && query.trim() ? <div className='muted'>Đang chờ server…</div> : null}
          {server?.map((r, i) => (
            <Row
              key={r.key}
              index={i}
              name={r.name}
              email={r.key}
              score={r.score}
              match={report ? report.matchedPositions[i] === 1 : undefined}
              note={report?.missingFromClient.includes(r.key) ? 'client không có' : undefined}
            />
          ))}
        </Column>
      </div>

      {report && report.featureDiffs.length > 0 && (
        <details className='lr-diffs'>
          <summary>{report.featureDiffs.length} feature lệch giữa client và server</summary>
          <ul>
            {report.featureDiffs.map((d) => (
              <li key={d.key + d.feature}>
                <code>{d.key}</code> {d.feature}: client {d.client} · server {d.server}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Log lines={lines} />
    </div>
  );
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className='lr-col'>
      <h2>{title}</h2>
      <ol>{children}</ol>
    </section>
  );
}

function Row(props: { index: number; name: string; email: string; score: number; match?: boolean; note?: string }) {
  const tone = props.match === undefined ? '' : props.match ? 'match' : 'miss';
  return (
    <li className={`lr-row ${tone}`}>
      <span className='lr-pos'>{props.index + 1}</span>
      <span className='lr-name'>
        {props.name}
        <small>{props.email}</small>
      </span>
      <span className='lr-score'>{props.score.toFixed(1)}</span>
      {props.note && <span className='lr-note'>{props.note}</span>}
    </li>
  );
}
