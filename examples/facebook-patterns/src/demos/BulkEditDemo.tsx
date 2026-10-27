import { useEffect, useMemo, useReducer, useState } from 'react';
import {
  aggregateDeep,
  changedPaths,
  deaggregateDeep,
  editLeaf,
  getByPath,
  match,
  setByPath,
  type BulkTree,
  type BulkValue,
  type Shape,
} from '../lib/bulkEdit';
import {
  createSeenStore,
  isCached,
  jsonBytes,
  mergeRefetch,
  SEEN_AND_READ,
  type FullRow,
  type SeenBits,
  type ServerRow,
} from '../lib/seenState';
import { Log, Stat, useLog } from './shared';
import './BulkEditDemo.css';

// ---------- phần 1: sửa hàng loạt ----------

interface Campaign {
  id: string;
  name: string;
  status: string;
  budget: number | null;
  targeting: { minAge: number; countries: string };
}

const INITIAL: Campaign[] = [
  { id: 'c1', name: 'Black Friday', status: 'ACTIVE', budget: 500, targeting: { minAge: 18, countries: 'VN' } },
  { id: 'c2', name: 'Tết 2027', status: 'ACTIVE', budget: 300, targeting: { minAge: 18, countries: 'VN, TH' } },
  { id: 'c3', name: 'Back to school', status: 'PAUSED', budget: 500, targeting: { minAge: 16, countries: 'VN' } },
  { id: 'c4', name: 'Retarget', status: 'ACTIVE', budget: null, targeting: { minAge: 25, countries: '' } },
];

const SHAPE: Shape = { status: true, budget: true, targeting: { minAge: true, countries: true } };
const FIELDS: Array<{ path: string[]; label: string; type: 'text' | 'number' }> = [
  { path: ['status'], label: 'Trạng thái', type: 'text' },
  { path: ['budget'], label: 'Ngân sách/ngày ($)', type: 'number' },
  { path: ['targeting', 'minAge'], label: 'Tuổi tối thiểu', type: 'number' },
  { path: ['targeting', 'countries'], label: 'Quốc gia', type: 'text' },
];

type Mode = 'bulk' | 'naive';

function leafAt(tree: BulkTree, path: string[]): BulkValue {
  return getByPath(tree, path) as BulkValue;
}

function BulkEditor({ log }: { log: (text: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void }) {
  const [rows, setRows] = useState<Campaign[]>(INITIAL);
  const [selected, setSelected] = useState<string[]>(['c1', 'c2', 'c3']);
  const [mode, setMode] = useState<Mode>('bulk');
  const picked = useMemo(() => rows.filter((r) => selected.includes(r.id)), [rows, selected]);
  const original = useMemo(() => aggregateDeep(picked, SHAPE), [picked]);
  const [tree, setTree] = useState<BulkTree>(original);
  // form kiểu ngây thơ: lấy giá trị của dòng đầu tiên làm giá trị cho cả form
  const [naive, setNaive] = useState<Record<string, unknown>>({});

  useEffect(() => {
    setTree(original);
    setNaive(picked[0] ? (structuredClone(picked[0]) as unknown as Record<string, unknown>) : {});
  }, [original, picked]);

  const changes = mode === 'bulk' ? changedPaths(original, tree) : ['(toàn bộ form)'];

  const onField = (path: string[], raw: string, type: 'text' | 'number') => {
    const value = type === 'number' ? (raw === '' ? null : Number(raw)) : raw;
    if (mode === 'bulk') setTree((t) => editLeaf(t, path, value));
    else
      setNaive((n) => {
        const copy = structuredClone(n);
        setByPath(copy, path, value);
        return copy;
      });
  };

  const save = () => {
    if (!picked.length) return;
    if (mode === 'bulk') {
      const patches = deaggregateDeep(tree, picked.length);
      setRows((all) =>
        all.map((row) => {
          const i = picked.findIndex((p) => p.id === row.id);
          if (i === -1) return row;
          const next = structuredClone(row) as unknown as Record<string, unknown>;
          // chỉ ghi các lá đã đổi; lá không đổi giữ nguyên giá trị riêng của dòng
          changes.forEach((key) => {
            const path = key.split('.');
            setByPath(next, path, getByPath(patches[i], path) ?? null);
          });
          return next as unknown as Campaign;
        }),
      );
      log(`Lưu kiểu bulk: ghi ${changes.length} field [${changes.join(', ') || 'không có'}] cho ${picked.length} dòng`, 'ok');
    } else {
      setRows((all) =>
        all.map((row) =>
          selected.includes(row.id) ? ({ ...(structuredClone(naive) as unknown as Campaign), id: row.id, name: row.name }) : row,
        ),
      );
      log(`Lưu kiểu ngây thơ: ghi đè cả form (giá trị của "${picked[0].name}") lên ${picked.length} dòng`, 'err');
    }
  };

  return (
    <section className='be-section'>
      <h2>1. Sửa hàng loạt N chiến dịch</h2>
      <div className='toolbar' role='group' aria-label='Cách dựng form'>
        <label className='switch'>
          <input type='radio' checked={mode === 'bulk'} onChange={() => setMode('bulk')} /> Empty/Uniform/Mixed
        </label>
        <label className='switch'>
          <input type='radio' checked={mode === 'naive'} onChange={() => setMode('naive')} /> Ngây thơ: lấy dòng đầu
        </label>
        <button onClick={() => setRows(INITIAL)}>↺ Dữ liệu ban đầu</button>
      </div>
      <div className='be-table-wrap'>
        <table className='be-table'>
          <thead>
            <tr>
              <th aria-label='Chọn' />
              <th>Tên</th>
              <th>Trạng thái</th>
              <th>Ngân sách</th>
              <th>Tuổi</th>
              <th>Quốc gia</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={selected.includes(r.id) ? 'be-picked' : ''}>
                <td>
                  <input
                    type='checkbox'
                    aria-label={`Chọn ${r.name}`}
                    checked={selected.includes(r.id)}
                    onChange={(e) =>
                      setSelected((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))
                    }
                  />
                </td>
                <td>{r.name}</td>
                <td>{r.status}</td>
                <td>{r.budget ?? <span className='muted'>—</span>}</td>
                <td>{r.targeting.minAge}</td>
                <td>{r.targeting.countries || <span className='muted'>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className='be-form'>
        {FIELDS.map((f) => {
          const key = f.path.join('.');
          if (mode === 'naive') {
            const v = getByPath(naive, f.path);
            return (
              <label key={key} className='be-field'>
                <span>{f.label}</span>
                <input
                  type='text'
                  inputMode={f.type === 'number' ? 'numeric' : undefined}
                  value={v == null ? '' : String(v)}
                  onChange={(e) => onField(f.path, e.target.value, f.type)}
                />
              </label>
            );
          }
          const leaf = picked.length ? leafAt(tree, f.path) : { kind: 'empty' as const };
          const edited = changes.includes(key);
          return (
            <label key={key} className={'be-field' + (edited ? ' be-edited' : '')}>
              <span>
                {f.label}{' '}
                <small className='badge'>
                  {match(leaf, { empty: () => 'empty', uniform: () => 'uniform', mixed: (vs) => `mixed ×${vs.length}` })}
                </small>
              </span>
              <input
                type='text'
                inputMode={f.type === 'number' ? 'numeric' : undefined}
                data-testid={`field-${key}`}
                value={leaf.kind === 'uniform' ? String(leaf.value ?? '') : ''}
                placeholder={leaf.kind === 'mixed' ? 'Nhiều giá trị' : 'Trống'}
                onChange={(e) => onField(f.path, e.target.value, f.type)}
              />
            </label>
          );
        })}
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={save} disabled={!picked.length}>
          Lưu cho {picked.length} dòng
        </button>
        <span className='muted' data-testid='changes'>
          Field sẽ ghi: {changes.length ? changes.join(', ') : 'không có'}
        </span>
      </div>
    </section>
  );
}

// ---------- phần 2: seen/read bằng 2 bit + thin client ----------

const TEXTS = [
  'An đã bình luận ảnh của bạn',
  'Bình đã nhắc tới bạn',
  'Nhóm React VN có bài mới',
  'Chi đã thích bài viết',
  'Sự kiện ngày mai',
  'Dũng đã gửi lời mời',
];

let nextNotif = 5;
const nextNotifId = () => `n${nextNotif++}`;

const initialRows = (): FullRow[] =>
  TEXTS.slice(0, 4).map((text, i) => ({ id: `n${i + 1}`, text, time: 1000 + i, state: 0 as SeenBits }));

function Notifications({ log }: { log: (text: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void }) {
  const store = useMemo(() => createSeenStore(), []);
  const [rows, setRows] = useState<FullRow[]>(initialRows);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [renders, setRenders] = useState({ badge: 0, list: 0 });
  const [respectEndpoint, setRespectEndpoint] = useState(true);
  const [dropUnknownCached, setDropUnknownCached] = useState(false);
  const [bytes, setBytes] = useState<{ full: number; thin: number } | null>(null);

  useEffect(() => {
    const offSeen = store.on('seen', (ids) => {
      setRenders((r) => ({ ...r, badge: r.badge + 1 }));
      log(`sự kiện seen: [${ids.join(', ')}] → badge vẽ lại`, 'muted');
      force();
    });
    const offRead = store.on('read', (ids) => {
      setRenders((r) => ({ ...r, list: r.list + 1 }));
      log(`sự kiện read: [${ids.join(', ')}] → danh sách vẽ lại`, 'muted');
      force();
    });
    // payload tải trang đầu tiên (StrictMode chạy effect 2 lần: lần sau id đã biết nên bị bỏ qua)
    store.receive(rows.map((r) => ({ id: r.id, state: r.state })), 'endpoint');
    return () => {
      offSeen();
      offRead();
    };
    // chỉ đăng ký một lần cho store này
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const push = () => {
    const id = nextNotifId();
    const n = Number(id.slice(1));
    const row: FullRow = { id, text: TEXTS[(n - 1) % TEXTS.length], time: 1000 + n, state: 0 };
    setRows((r) => [row, ...r]);
    store.receive([{ id: row.id, state: 0 }], 'push');
    log(`push: thông báo mới ${row.id}`, 'ok');
  };

  const staleReload = () => {
    // payload tải trang được tạo TRƯỚC khi người dùng đọc: mọi thứ vẫn là "chưa thấy"
    const stale = rows.map((r) => ({ id: r.id, state: 0 as SeenBits }));
    if (respectEndpoint) store.receive(stale, 'endpoint');
    else store.receive(stale, 'push');
    log(
      respectEndpoint
        ? 'payload endpoint cũ: id đã biết được giữ nguyên'
        : 'payload cũ bị coi như push: ghi đè, thông báo đã đọc thành chưa đọc lại',
      respectEndpoint ? 'ok' : 'err',
    );
  };

  const refetch = () => {
    // server: id client đã có → hàng rút gọn; id mới → hàng đầy đủ
    const known = new Set(rows.map((r) => r.id));
    const extraUnknownCached: ServerRow[] = [{ id: 'n99', cached: true, state: 0 }];
    const fresh: FullRow = { id: nextNotifId(), text: 'Lan đã chia sẻ bài viết của bạn', time: 2000, state: 0 };
    const server: ServerRow[] = [
      fresh,
      ...rows.map((r) =>
        known.has(r.id) ? ({ id: r.id, cached: true, state: store.get(r.id) ?? r.state } as ServerRow) : r,
      ),
      ...extraUnknownCached,
    ];
    const fullEquivalent = [fresh, ...rows, { id: 'n99', text: 'Thông báo cũ đã bị xoá ở client', time: 1, state: 0 }];
    setBytes({ thin: jsonBytes(server), full: jsonBytes(fullEquivalent) });
    const { rows: merged, missing } = mergeRefetch(rows, server);
    setRows(merged);
    store.receive([{ id: fresh.id, state: 0 }], 'push');
    const cachedCount = server.filter(isCached).length;
    if (missing.length && dropUnknownCached) {
      log(`refetch: ${cachedCount} hàng rút gọn; ${missing.join(', ')} không có trong cache → bị bỏ (như bản gốc)`, 'warn');
    } else if (missing.length) {
      log(`refetch: ${missing.join(', ')} không có trong cache → gọi lại server lấy bản đầy đủ`, 'ok');
      setRows((r) => [...r, { id: 'n99', text: 'Thông báo lấy bổ sung', time: 1, state: 0 }]);
      store.receive([{ id: 'n99', state: 0 }], 'push');
    }
  };

  return (
    <section className='be-section'>
      <h2>2. Đã thấy / đã đọc bằng 2 bit</h2>
      <div className='stats'>
        <Stat label='chưa thấy (badge)' value={<output data-testid='unseen'>{store.unseenCount()}</output>} />
        <Stat label='chưa đọc (chấm xanh)' value={<output data-testid='unread'>{store.unreadCount()}</output>} />
        <Stat label='lần vẽ lại badge' value={<output data-testid='badge-renders'>{renders.badge}</output>} />
        <Stat label='lần vẽ lại danh sách' value={<output data-testid='list-renders'>{renders.list}</output>} />
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={() => store.markSeen(rows.map((r) => r.id))}>
          🔔 Mở chuông (đánh dấu đã thấy)
        </button>
        <button onClick={push}>Push: thông báo mới</button>
        <button onClick={staleReload}>Nhận payload tải trang cũ</button>
        <button onClick={refetch}>Refetch đầu danh sách</button>
      </div>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={respectEndpoint} onChange={(e) => setRespectEndpoint(e.target.checked)} />
          Payload tải trang không ghi đè id đã biết
        </label>
        <label className='switch'>
          <input type='checkbox' checked={dropUnknownCached} onChange={(e) => setDropUnknownCached(e.target.checked)} />
          Bỏ hàng rút gọn không có trong cache (như bản gốc)
        </label>
      </div>
      {bytes && (
        <p className='hint' data-testid='bytes'>
          Payload refetch: {bytes.thin} byte (rút gọn) so với {bytes.full} byte nếu gửi đầy đủ.
        </p>
      )}
      <ul className='be-notifs'>
        {rows.map((r) => {
          const state = store.get(r.id) ?? 0;
          return (
            <li key={r.id} className={state === SEEN_AND_READ ? 'be-read' : ''}>
              <button
                className='be-notif'
                onClick={() => store.markRead([r.id], state !== SEEN_AND_READ)}
                aria-label={`${r.text}, ${state === SEEN_AND_READ ? 'đã đọc' : 'chưa đọc'}`}
              >
                <span className='be-dot' aria-hidden='true' />
                <span>{r.text}</span>
                <small className='muted'>
                  {r.id} · bits={state.toString(2).padStart(2, '0')}
                </small>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function BulkEditDemo() {
  const { lines, add, clear } = useLog(40);
  return (
    <div className='page be-demo'>
      <h1>Sửa hàng loạt và seen/read bằng 2 bit</h1>
      <p className='hint'>
        Chọn 3 chiến dịch, đổi mỗi "Ngân sách" rồi Lưu: field khác giữ nguyên giá trị riêng của từng dòng. Chuyển sang
        "ngây thơ" để thấy form lấy dòng đầu làm mẫu và ghi đè mọi thứ. Phần dưới: bấm chuông, bấm từng thông báo và
        xem log cho biết sự kiện nào được phát.
      </p>
      <BulkEditor log={add} />
      <Notifications log={add} />
      <div className='toolbar'>
        <button onClick={clear}>Xoá log</button>
      </div>
      <Log lines={lines} />
    </div>
  );
}
