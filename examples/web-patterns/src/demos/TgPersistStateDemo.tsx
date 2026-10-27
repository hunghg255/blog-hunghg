import { useEffect, useMemo, useRef, useState } from 'react';
import { createStatePersister, pick, withDefaults } from '../lib/tgPersistState';
import { Log, Stat, sleep, useLog } from './shared';
import './TgPersistStateDemo.css';

interface Message {
  id: number;
  text: string;
}
interface Chat {
  id: number;
  title: string;
}
interface AppState {
  chatIds: number[]; // thứ tự trong danh sách chat
  chats: Record<number, Chat>;
  messages: Record<number, Message[]>;
  viewport: Record<number, number[]>; // id tin đang hiện của từng chat
  currentChatId?: number;
  settings: { theme: 'dark' | 'light'; fontSize: number; compactList?: boolean };
}

const CHAT_LIMIT = 30;

const formatChars = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} triệu ký tự` : `${Math.round(n / 1000)}k ký tự`);
const STORAGE_KEY = 'tg-demo-global-state';

/** localStorage có thể ném lỗi (iframe sandbox, chế độ riêng tư): dùng bộ nhớ tạm thay thế. */
function getStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    localStorage.setItem('__probe', '1');
    localStorage.removeItem('__probe');
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
  }
}

const INITIAL: AppState = {
  chatIds: [],
  chats: {},
  messages: {},
  viewport: {},
  settings: { theme: 'dark', fontSize: 15, compactList: false },
};

/** State "đầy đủ" mà server trả về: 200 chat, mỗi chat 300 tin. */
function buildServerState(): AppState {
  const state: AppState = { ...INITIAL, chatIds: [], chats: {}, messages: {}, viewport: {} };
  let msgId = 1;
  for (let c = 1; c <= 200; c++) {
    state.chatIds.push(c);
    state.chats[c] = { id: c, title: `Nhóm ${c}` };
    const list: Message[] = [];
    for (let m = 0; m < 300; m++) list.push({ id: msgId++, text: `Tin ${m + 1} trong nhóm ${c}, nội dung dài vừa phải để có kích thước thật` });
    state.messages[c] = list;
    state.viewport[c] = list.slice(-30).map((x) => x.id);
  }
  state.currentChatId = 1;
  return state;
}

/** Cắt tỉa giống Telegram: 30 chat đầu + chat đang mở, mỗi chat chỉ giữ tin đang hiện. */
function reduceState(state: AppState): AppState {
  const ids = state.chatIds.slice(0, CHAT_LIMIT);
  if (state.currentChatId && !ids.includes(state.currentChatId)) ids.push(state.currentChatId);
  const messages: AppState['messages'] = {};
  for (const id of ids) {
    const visible = new Set(state.viewport[id] ?? []);
    messages[id] = (state.messages[id] ?? []).filter((m) => visible.has(m.id));
  }
  return {
    chatIds: ids,
    chats: pick(state.chats, ids) as AppState['chats'],
    messages,
    viewport: pick(state.viewport, ids) as AppState['viewport'],
    currentChatId: state.currentChatId,
    settings: state.settings,
  };
}

export default function TgPersistStateDemo() {
  const { lines, add, clear } = useLog(40);
  const storage = useMemo(getStorage, []);
  const [state, setState] = useState<AppState | null>(null);
  const stateRef = useRef<AppState | null>(null);
  stateRef.current = state;
  const [trim, setTrim] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const [version, setVersion] = useState(1);
  const [throttleMs, setThrottleMs] = useState(5000);
  const [streaming, setStreaming] = useState(false);
  const [changes, setChanges] = useState(0);
  const [writes, setWrites] = useState(0);
  const [lastWrite, setLastWrite] = useState<{ chars: number; ms: number } | null>(null);
  const [firstPaint, setFirstPaint] = useState<string>('—');
  const [loading, setLoading] = useState(false);

  const persister = useMemo(
    () =>
      createStatePersister<AppState, AppState>({
        key: STORAGE_KEY,
        version,
        storage,
        throttleMs,
        getState: () => stateRef.current ?? INITIAL,
        reduce: (s) => (trim ? reduceState(s) : s),
        restore: (cached, initial) => withDefaults(initial, cached, ['settings']),
        isBusy: () => busyRef.current,
        onWrite: ({ chars, ms, reason }) => {
          setWrites((n) => n + 1);
          setLastWrite({ chars, ms });
          add(`ghi cache (${reason}): ${formatChars(chars)}, ${ms.toFixed(1)}ms`, 'ok');
        },
        onError: (e, info) =>
          add(`không ghi được${info ? ` ${formatChars(info.chars)}` : ''}: ${(e as Error).name ?? String(e)}`, 'err'),
      }),
    [storage, version, throttleMs, trim, add],
  );
  useEffect(() => {
    // đổi tuỳ chọn = persister mới: hẹn ghi lại để không mất thay đổi đang chờ của persister cũ
    if (stateRef.current) persister.schedule();
    return () => persister.destroy();
  }, [persister]);

  // "mở app" lần đầu
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void openApp(), []);

  const update = (fn: (s: AppState) => AppState) => {
    setState((s) => (s ? fn(s) : s));
    setChanges((n) => n + 1);
    persister.schedule();
  };

  async function openApp() {
    setState(null);
    setLoading(true);
    const t0 = performance.now();
    const { state: cached, fromCache, savedAt } = persister.load(INITIAL);
    if (fromCache) {
      setState(cached);
      setFirstPaint(`${(performance.now() - t0).toFixed(1)}ms (từ cache)`);
      add(`mở app: hiện ngay từ cache lưu lúc ${new Date(savedAt!).toLocaleTimeString('vi-VN')}`, 'ok');
    } else {
      add('mở app: không có cache hợp lệ, chờ server…', 'warn');
    }
    await sleep(1500); // kết nối + tải từ server
    const fresh = buildServerState();
    setState((prev) => ({ ...fresh, settings: prev?.settings ?? fresh.settings }));
    if (!fromCache) setFirstPaint(`${Math.round(performance.now() - t0)}ms (chờ server)`);
    setLoading(false);
    persister.schedule();
  }

  // luồng tin mới: 10 tin/giây vào các nhóm ngẫu nhiên
  useEffect(() => {
    if (!streaming) return;
    let n = 0;
    const timer = setInterval(() => {
      const chatId = 1 + Math.floor(Math.random() * 200);
      const id = Date.now() * 10 + n++;
      update((s) => {
        const list = [...(s.messages[chatId] ?? []), { id, text: `Tin mới ${n}` }];
        return {
          ...s,
          chatIds: [chatId, ...s.chatIds.filter((x) => x !== chatId)],
          messages: { ...s.messages, [chatId]: list },
          viewport: { ...s.viewport, [chatId]: [...(s.viewport[chatId] ?? []).slice(-29), id] },
        };
      });
    }, 100);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, persister]);

  const chatsShown = state ? state.chatIds.slice(0, 8) : [];
  const current = state?.currentChatId;
  const currentMessages = state && current ? (state.messages[current] ?? []).slice(-5) : [];

  return (
    <div className={`page tg-persist ${state?.settings.theme === 'light' ? 'light-app' : ''}`}>
      <h1>Lưu global state lúc rảnh</h1>
      <p className='hint'>
        Bật luồng tin mới: state đổi 10 lần/giây nhưng cache chỉ được ghi tối đa một lần mỗi {throttleMs / 1000} giây, lúc
        trình duyệt rảnh. Bấm <b>Mở lại app</b> để thấy màn hình hiện ngay từ cache trong khi "server" mất 1,5 giây. Tắt cắt
        tỉa để so kích thước.
      </p>

      <div className='toolbar'>
        <button type='button' className={streaming ? 'primary' : ''} onClick={() => setStreaming((v) => !v)}>
          {streaming ? '⏸ Dừng luồng tin' : '▶ Luồng tin mới'}
        </button>
        <button type='button' onClick={() => void openApp()}>
          ↻ Mở lại app
        </button>
        <button type='button' onClick={() => persister.flush('ẩn tab (giả lập)')}>
          Ẩn tab (ghi ngay)
        </button>
        <button
          type='button'
          onClick={() => update((s) => ({ ...s, settings: { ...s.settings, theme: s.settings.theme === 'dark' ? 'light' : 'dark' } }))}
        >
          Đổi theme
        </button>
      </div>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={trim} onChange={(e) => setTrim(e.target.checked)} /> Cắt tỉa trước khi ghi
        </label>
        <label className='switch'>
          <input type='checkbox' checked={busy} onChange={(e) => setBusy(e.target.checked)} /> Đang có animation nặng
        </label>
        <label>
          Gom trong{' '}
          <select value={throttleMs} onChange={(e) => setThrottleMs(+e.target.value)}>
            <option value={1000}>1 giây</option>
            <option value={5000}>5 giây (Telegram)</option>
          </select>
        </label>
        <button type='button' onClick={() => setVersion((v) => v + 1)}>
          Deploy bản mới (version {version} → {version + 1})
        </button>
        <button
          type='button'
          onClick={() => {
            storage.removeItem(STORAGE_KEY);
            clear();
            add('đã xoá cache', 'warn');
          }}
        >
          Xoá cache
        </button>
      </div>

      <div className='stats'>
        <Stat label='lần state đổi' value={changes} />
        <Stat label='lần ghi thật' value={writes} />
        <Stat label='kích thước lần ghi cuối' value={lastWrite ? formatChars(lastWrite.chars) : '—'} />
        <Stat label='thời gian ghi' value={lastWrite ? `${lastWrite.ms.toFixed(1)}ms` : '—'} />
        <Stat label='màn hình đầu sau' value={firstPaint} />
      </div>

      <div className='split'>
        <div className='card tg-persist-app'>
          <h3>Danh sách chat {loading && <span className='spinner' aria-label='đang tải' />}</h3>
          {!state ? (
            <div className='tg-persist-skeleton'>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className='skeleton' />
              ))}
            </div>
          ) : (
            <ul>
              {chatsShown.map((id) => (
                <li key={id}>
                  <b>{state.chats[id]?.title}</b>
                  <span>{state.messages[id]?.[state.messages[id].length - 1]?.text ?? '…'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className='card tg-persist-app'>
          <h3>Nhóm {current ?? '—'}</h3>
          <ul>
            {currentMessages.map((m) => (
              <li key={m.id}>{m.text}</li>
            ))}
          </ul>
        </div>
      </div>
      <Log lines={lines} />
    </div>
  );
}
