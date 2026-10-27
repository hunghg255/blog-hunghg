import { useEffect, useMemo, useRef, useState } from 'react';
import { createGlobalStore } from '../lib/tgStore';
import { renderByReappend, renderByRebuild, renderKeyedList, type DomOps } from '../lib/tgFastList';
import { Log, Stat, useLog } from './shared';
import './TgStoreDemo.css';

// ---------------- Phần 1: store gom theo frame ----------------

interface Chat {
  id: number;
  title: string;
  unread: number;
}
interface State {
  chats: Chat[];
  typing: boolean;
  nanMode: boolean;
  throwMode: boolean;
}

const initialState: State = {
  chats: ['Gia đình', 'Công việc', 'Bạn thân', 'Nhóm React', 'Mẹ'].map((title, i) => ({ id: i + 1, title, unread: 0 })),
  typing: false,
  nanMode: false,
  throwMode: false,
};

function useStoreDemo(onDebug: (text: string, tone: 'warn' | 'err') => void) {
  return useMemo(() => {
    const store = createGlobalStore<State>(initialState, {
      // onDebug có thể được gọi giữa lúc một component đang render: đẩy việc ghi log ra sau
      onDebug: (event) =>
        queueMicrotask(() => onDebug(`[${event.type}] ${event.message}`, event.type === 'error' ? 'err' : 'warn')),
    });
    const actions = {
      newMessage: store.action((state, chatId: number) => ({
        ...state,
        chats: state.chats.map((chat) => (chat.id === chatId ? { ...chat, unread: chat.unread + 1 } : chat)),
      })),
      readAll: store.action((state) => ({ ...state, chats: state.chats.map((chat) => ({ ...chat, unread: 0 })) })),
      toggleTyping: store.action((state) => ({ ...state, typing: !state.typing })),
      setMode: store.action((state, patch: Partial<State>) => ({ ...state, ...patch })),
    };
    return { store, actions };
    // onDebug ổn định trong suốt vòng đời demo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

type Demo = ReturnType<typeof useStoreDemo>;

function HeaderBadge({ demo }: { demo: Demo }) {
  // trả object mới mỗi lần nhưng giá trị là số => so sánh nông vẫn đúng
  const { total } = demo.store.useGlobal((s) => ({ total: s.chats.reduce((sum, c) => sum + c.unread, 0) }), 'HeaderBadge');
  return <span className='badge'>{total} chưa đọc</span>;
}

function ChatRow({ demo, chatId }: { demo: Demo; chatId: number }) {
  const { chat } = demo.store.useGlobal((s) => ({ chat: s.chats.find((c) => c.id === chatId)! }), `ChatRow#${chatId}`);
  return (
    <div className='tgs-row'>
      <span>{chat.title}</span>
      {chat.unread > 0 && <b>{chat.unread}</b>}
    </div>
  );
}

function Typing({ demo }: { demo: Demo }) {
  const { typing } = demo.store.useGlobal((s) => ({ typing: s.typing }), 'Typing');
  return <span className='muted'>{typing ? 'Mẹ đang soạn tin…' : 'không ai đang soạn'}</span>;
}

function NanProbe({ demo }: { demo: Demo }) {
  const props = demo.store.useGlobal((s) => {
    if (s.throwMode) throw new Error('mapState hỏng');
    // vd. chia cho 0 khi chưa có dữ liệu: 0 / 0 = NaN
    return { ratio: s.nanMode ? 0 / 0 : 1 };
  }, 'NanProbe');
  return <span className='muted'>ratio = {String(props.ratio)}</span>;
}

function StorePart() {
  const { lines, add } = useLog(30);
  const addRef = useRef(add);
  addRef.current = add;
  const demo = useStoreDemo((text, tone) => addRef.current(text, tone));
  const [stats, setStats] = useState(demo.store.getRenderStats());
  const [flushes, setFlushes] = useState(0);
  const [sync, setSync] = useState(false);
  const [modes, setModes] = useState({ nanMode: false, throwMode: false });

  useEffect(() => {
    // các container đăng ký trong useLayoutEffect của con, nên tới đây đã có đủ
    setStats(demo.store.getRenderStats());
    return demo.store.onFlush(() => {
      setStats(demo.store.getRenderStats());
      setFlushes(demo.store.getFlushCount());
    });
  }, [demo]);

  const burst = () => {
    const before = demo.store.getFlushCount();
    for (let i = 0; i < 10; i++) {
      const chatId = (i % 3) + 1;
      if (sync) {
        const s = demo.store.getGlobal();
        demo.store.setGlobal(
          { ...s, chats: s.chats.map((c) => (c.id === chatId ? { ...c, unread: c.unread + 1 } : c)) },
          { sync: true },
        );
      } else {
        demo.actions.newMessage(chatId);
      }
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const used = demo.store.getFlushCount() - before;
        add(`10 action → ${used} lần flush (${sync ? 'đồng bộ' : 'gom theo frame'})`, used === 1 ? 'ok' : 'warn');
      }),
    );
  };

  const setMode = (patch: Partial<typeof modes>) => {
    const next = { ...modes, ...patch };
    setModes(next);
    demo.actions.setMode(next);
  };

  return (
    <section className='card'>
      <h2>1. Store gom cập nhật theo frame</h2>
      <p className='hint'>
        Mỗi khối dưới đây là một component nối vào store bằng <code>useGlobal(mapState)</code>. Bấm "10 tin nhắn liền nhau":
        với chế độ gom theo frame chỉ có 1 lần flush, và chỉ những component có props đổi mới render lại.
      </p>
      <div className='tgs-app'>
        <div className='tgs-head'>
          <b>Chats</b> <HeaderBadge demo={demo} />
        </div>
        {initialState.chats.map((chat) => (
          <ChatRow key={chat.id} demo={demo} chatId={chat.id} />
        ))}
        <div className='tgs-foot'>
          <Typing demo={demo} /> · <NanProbe demo={demo} />
        </div>
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={burst}>
          10 tin nhắn liền nhau
        </button>
        <button onClick={() => demo.actions.toggleTyping()}>Đổi trạng thái "đang soạn"</button>
        <button onClick={() => demo.actions.readAll()}>Đọc hết</button>
      </div>
      <div className='toolbar'>
        <label>
          <input type='checkbox' checked={sync} onChange={(e) => setSync(e.target.checked)} /> Flush đồng bộ (sync)
        </label>
        <label>
          <input type='checkbox' checked={modes.nanMode} onChange={(e) => setMode({ nanMode: e.target.checked })} /> mapState
          trả NaN
        </label>
        <label>
          <input type='checkbox' checked={modes.throwMode} onChange={(e) => setMode({ throwMode: e.target.checked })} />{' '}
          mapState ném lỗi
        </label>
      </div>
      <div className='stats'>
        <Stat label='lần flush' value={flushes} />
      </div>
      <table className='tgs-table'>
        <thead>
          <tr>
            <th>Container</th>
            <th>Số lần store bắt render</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td>{row.updates}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Log lines={lines} />
    </section>
  );
}

// ---------------- Phần 2: danh sách có key ----------------

interface Row {
  id: number;
  text: string;
}

type Mode = 'fast' | 'reappend' | 'rebuild';
const MODE_LABEL: Record<Mode, string> = {
  fast: 'fastList (kiểu Telegram)',
  reappend: 'appendChild lại tất cả',
  rebuild: 'dựng lại toàn bộ',
};

let nextRowId = 1;
const makeRows = (n: number) => Array.from({ length: n }, () => ({ id: nextRowId, text: `Tin nhắn #${nextRowId++}` }));

function FastListPart() {
  const listRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<Row[]>(makeRows(300));
  const [mode, setMode] = useState<Mode>('fast');
  const [result, setResult] = useState<{ action: string; ops: DomOps; mutations: number; nodes: number; ms: number } | null>(
    null,
  );

  const options = useMemo(
    () => ({
      getKey: (row: Row) => String(row.id),
      getOrder: (_row: Row, index: number) => index,
      create: (row: Row) => {
        const div = document.createElement('div');
        div.className = 'tgs-item';
        div.textContent = row.text;
        return div;
      },
    }),
    [],
  );

  const render = (action: string, rows: Row[]) => {
    const list = listRef.current!;
    rowsRef.current = rows;
    let mutations = 0;
    let nodes = 0;
    const observer = new MutationObserver((records) => {
      mutations += records.length;
      records.forEach((r) => (nodes += r.addedNodes.length + r.removedNodes.length));
    });
    observer.observe(list, { childList: true });
    const start = performance.now();
    const fn = mode === 'fast' ? renderKeyedList : mode === 'reappend' ? renderByReappend : renderByRebuild;
    const ops = fn(list, rows, options);
    const ms = performance.now() - start;
    // đọc các bản ghi còn chờ ngay, không đợi microtask
    observer.takeRecords().forEach((r) => {
      mutations++;
      nodes += r.addedNodes.length + r.removedNodes.length;
    });
    observer.disconnect();
    setResult({ action, ops, mutations, nodes, ms });
  };

  useEffect(() => {
    // lần đầu: luôn dựng bằng fastList (chỉ một fragment)
    renderKeyedList(listRef.current!, rowsRef.current, options);
  }, [options]);

  const rows = () => rowsRef.current;
  const actions: { label: string; run: () => Row[] }[] = [
    { label: 'Tải thêm 50 tin cũ (lên đầu)', run: () => [...makeRows(50), ...rows()] },
    { label: 'Thêm 50 tin mới (xuống cuối)', run: () => [...rows(), ...makeRows(50)] },
    {
      label: 'Đưa dòng cuối lên đầu',
      run: () => {
        const r = rows();
        return [r[r.length - 1], ...r.slice(0, -1)];
      },
    },
    {
      label: 'Xoá 10 dòng ngẫu nhiên',
      run: () => {
        const r = [...rows()];
        for (let i = 0; i < 10 && r.length; i++) r.splice(Math.floor(Math.random() * r.length), 1);
        return r;
      },
    },
  ];

  return (
    <section className='card'>
      <h2>2. Cập nhật danh sách 300+ dòng</h2>
      <p className='hint'>
        Chọn cách cập nhật rồi bấm thao tác. MutationObserver đếm số node được thêm/xoá/di chuyển trong DOM (một lần di
        chuyển = 1 xoá + 1 thêm).
      </p>
      <div className='toolbar' role='radiogroup' aria-label='Cách cập nhật'>
        {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
          <button key={m} className={m === mode ? 'primary' : ''} aria-pressed={m === mode} onClick={() => setMode(m)}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <div className='toolbar'>
        {actions.map((a) => (
          <button key={a.label} onClick={() => render(a.label, a.run())}>
            {a.label}
          </button>
        ))}
      </div>
      {result && (
        <div className='stats' data-testid='fastlist-result'>
          <Stat label={`node bị đụng (${MODE_LABEL[mode]})`} value={result.nodes} />
          <Stat label='mutation record' value={result.mutations} />
          <Stat label='thêm / di chuyển / xoá' value={`${result.ops.inserted} / ${result.ops.moved} / ${result.ops.removed}`} />
          <Stat label='thời gian' value={`${result.ms.toFixed(1)}ms`} />
        </div>
      )}
      <div ref={listRef} className='tgs-list' />
    </section>
  );
}

export default function TgStoreDemo() {
  return (
    <div className='page tgs'>
      <h1>Store tự viết và danh sách có key</h1>
      <StorePart />
      <FastListPart />
    </div>
  );
}
