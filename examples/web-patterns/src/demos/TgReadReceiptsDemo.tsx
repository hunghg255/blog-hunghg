import { useCallback, useEffect, useRef, useState } from 'react';
import { Log, Stat, useLog } from './shared';
import { createReadTracker, type ReadTracker } from '../lib/tgReadReceipts';
import {
  createClickBuffer,
  createNotificationGate,
  createOriginalGate,
  findAppClients,
  type Decision,
  type IncomingNotification,
} from '../lib/tgPushDedupe';
import './TgReadReceiptsDemo.css';

// ---------------------------------------------------------------- 1. đã đọc

const TOTAL = 30;
const FIRST_UNREAD = 16;
const MENTIONS = new Set([20, 27]);

interface Msg {
  id: number;
  out: boolean;
  text: string;
  tall?: boolean;
}

const MESSAGES: Msg[] = Array.from({ length: TOTAL }, (_, i) => {
  const id = i + 1;
  return {
    id,
    out: id % 4 === 0,
    text: MENTIONS.has(id) ? `@ban xem giúp mình cái này nhé (tin #${id})` : `Tin nhắn #${id}`,
    tall: id === 24,
  };
});

function ReadSection() {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackerRef = useRef<ReadTracker | null>(null);
  const [readUpTo, setReadUpTo] = useState(FIRST_UNREAD - 1);
  const readUpToRef = useRef(readUpTo);
  const [unreadMentions, setUnreadMentions] = useState(() => new Set(MENTIONS));
  const [apiCalls, setApiCalls] = useState(0);
  const [originalMentionCalls, setOriginalMentionCalls] = useState(0);
  const [freezeOnBlur, setFreezeOnBlur] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [manualFreeze, setManualFreeze] = useState(false);
  // đổi epoch = tạo lại tracker (tracker nhớ mốc đã gửi và không bao giờ gửi lùi)
  const [epoch, setEpoch] = useState(0);
  const { lines, add } = useLog(30);

  useEffect(() => {
    readUpToRef.current = readUpTo;
  }, [readUpTo]);

  useEffect(() => {
    const root = rootRef.current!;
    const tracker = createReadTracker({
      root,
      freezeOnBlur,
      getFirstUnreadId: () => (readUpToRef.current < TOTAL ? readUpToRef.current + 1 : undefined),
      onReadUpTo: (maxId) => {
        setApiCalls((n) => n + 1);
        setReadUpTo((prev) => Math.max(prev, maxId));
        add(`API markMessageListRead({ maxId: ${maxId} })`, 'ok');
      },
      onMentionsSeen: (ids) => {
        setUnreadMentions((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
        add(`API markMessagesRead([${ids.join(', ')}]) — mention`, 'ok');
      },
    });
    trackerRef.current = tracker;
    const cleanups = Array.from(root.querySelectorAll<HTMLElement>('.tgr-marker')).map((m) => tracker.observe(m));

    // Mô phỏng điều kiện của bản gốc (`if (dataset.hasUnreadMention)`) để đếm số lần gọi thừa
    const originalObserver = new IntersectionObserver(
      (entries) => {
        // bản gốc gửi cả các tin có giá trị "false" (mention ĐÃ đọc): đếm số lần gửi thừa đó
        const redundant = entries.filter(
          (e) => e.isIntersecting && (e.target as HTMLElement).dataset.hasUnreadMention === 'false',
        );
        if (redundant.length) setOriginalMentionCalls((n) => n + 1);
      },
      { root },
    );
    root.querySelectorAll<HTMLElement>('.tgr-marker[data-has-unread-mention]').forEach((m) => originalObserver.observe(m));

    const poll = setInterval(() => setFrozen(tracker.isFrozen()), 200);
    return () => {
      clearInterval(poll);
      cleanups.forEach((fn) => fn());
      tracker.destroy();
      originalObserver.disconnect();
      trackerRef.current = null;
    };
  }, [freezeOnBlur, epoch, add]);

  const toggleManualFreeze = () => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    if (manualFreeze) {
      tracker.unfreeze();
      add('mở băng: xử lý các tin đã lướt qua trong lúc ẩn', 'muted');
    } else {
      tracker.freeze();
      add('đóng băng (như tab bị ẩn)', 'muted');
    }
    setManualFreeze(!manualFreeze);
  };

  const reset = () => {
    setReadUpTo(FIRST_UNREAD - 1);
    setUnreadMentions(new Set(MENTIONS));
    setApiCalls(0);
    setOriginalMentionCalls(0);
    setManualFreeze(false);
    readUpToRef.current = FIRST_UNREAD - 1;
    rootRef.current!.scrollTop = 0;
    setEpoch((e) => e + 1);
  };

  const unread = TOTAL - readUpTo;

  return (
    <section className='card tgr-section'>
      <h2>1. Đánh dấu đã đọc khi đáy tin nhắn lọt vào khung nhìn</h2>
      <p className='hint'>
        Cuộn xuống: số chưa đọc giảm theo tin cuối cùng bạn thấy. Bật "đóng băng" rồi cuộn: không gửi gì cho tới khi mở băng.
      </p>
      <div className='toolbar'>
        <button onClick={toggleManualFreeze}>{manualFreeze ? 'Mở băng' : 'Đóng băng (giả lập tab ẩn)'}</button>
        <label className='switch'>
          <input type='checkbox' checked={freezeOnBlur} onChange={(e) => setFreezeOnBlur(e.target.checked)} />
          Đóng băng cả khi cửa sổ mất focus (như Telegram)
        </label>
        <button onClick={reset}>Làm lại</button>
      </div>
      <div className='stats'>
        <Stat label='chưa đọc' value={unread} />
        <Stat label='đọc tới tin' value={`#${readUpTo}`} />
        <Stat label='lần gọi API đọc' value={apiCalls} />
        <Stat label='mention chưa đọc' value={unreadMentions.size} />
        <Stat label='trạng thái' value={frozen ? 'đóng băng' : 'đang theo dõi'} />
        <Stat label='bản gốc gọi mention thừa' value={originalMentionCalls} />
      </div>
      <div className='tgr-layout'>
        <div className='tgr-chat' ref={rootRef}>
          {MESSAGES.map((m) => {
            const isUnread = m.id > readUpTo && !m.out;
            const hasMention = MENTIONS.has(m.id);
            return (
              <div key={m.id} className={`tgr-msg ${m.out ? 'out' : ''} ${isUnread ? 'unread' : ''} ${m.tall ? 'tall' : ''}`}>
                {m.text}
                {m.tall && <div className='tgr-tall'>(tin rất dài: chỉ tính đã đọc khi thấy đáy)</div>}
                {m.id === FIRST_UNREAD && <div className='tgr-divider'>— tin chưa đọc —</div>}
                {/* Marker đáy: giống Telegram, attribute mention tồn tại cả khi đã đọc (giá trị "false") */}
                <div
                  className='tgr-marker'
                  data-message-id={m.id}
                  {...(hasMention ? { 'data-has-unread-mention': String(unreadMentions.has(m.id)) } : {})}
                />
              </div>
            );
          })}
        </div>
        <Log lines={lines} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 2. thông báo không trùng

type Shown = { id: number; text: string; via: 'tab' | 'push'; decision: Decision };

function PushSection() {
  const original = useRef(createOriginalGate());
  const fixed = useRef(createNotificationGate());
  const [shown, setShown] = useState<{ original: Shown[]; fixed: Shown[] }>({ original: [], fixed: [] });
  const nextId = useRef(100);
  const [sizes, setSizes] = useState({ original: 0, fixed: 0 });

  const deliver = useCallback((via: 'tab' | 'push', n: IncomingNotification) => {
    const o = via === 'tab' ? original.current.fromTab(n) : original.current.fromPush(n);
    const f = via === 'tab' ? fixed.current.fromTab(n) : fixed.current.fromPush(n);
    const text = `#${n.messageId} ${n.body}`;
    setShown((prev) => ({
      original: [{ id: Math.random(), text, via, decision: o }, ...prev.original].slice(0, 12),
      fixed: [{ id: Math.random(), text, via, decision: f }, ...prev.fixed].slice(0, 12),
    }));
    setSizes({ original: original.current.size(), fixed: fixed.current.size() });
  }, []);

  const msg = (body: string): IncomingNotification => ({ messageId: nextId.current++, chatId: 1, title: 'Mẹ', body });

  const scenarios = [
    {
      label: 'Tab báo trước, push tới sau',
      run: () => {
        const n = msg('Con ăn cơm chưa?');
        deliver('tab', n);
        setTimeout(() => deliver('push', n), 400);
      },
    },
    {
      label: 'Push tới trước, tab báo sau',
      run: () => {
        const n = msg('Nhớ mang áo mưa');
        deliver('push', n);
        setTimeout(() => deliver('tab', n), 400);
      },
    },
    {
      label: 'Tab báo, push không bao giờ tới (×3)',
      run: () => {
        for (let i = 0; i < 3; i++) deliver('tab', msg('Tin chỉ qua tab'));
      },
    },
    {
      label: 'SW vừa khởi động, push tồn đọng ập tới',
      run: () => {
        original.current = createOriginalGate();
        fixed.current = createNotificationGate();
        ['Tin cũ 1', 'Tin cũ 2', 'Tin cũ 3'].forEach((t) => deliver('push', msg(t)));
      },
    },
  ];

  const render = (items: Shown[]) =>
    items.length === 0 ? (
      <p className='muted'>Chưa có gì.</p>
    ) : (
      <ul className='tgr-notifs'>
        {items.map((s) => (
          <li key={s.id} className={s.decision.action === 'show' ? 'show' : 'drop'}>
            <span className='badge'>{s.via === 'tab' ? 'tab' : 'push'}</span> {s.text} →{' '}
            {s.decision.action === 'show' ? (
              <b className='ok'>HIỆN{s.decision.tag ? ` (tag ${s.decision.tag})` : ''}</b>
            ) : (
              <span className='muted'>bỏ: {s.decision.reason}</span>
            )}
          </li>
        ))}
      </ul>
    );

  return (
    <section className='card tgr-section'>
      <h2>2. Một tin, hai đường tới: không hiện thông báo hai lần</h2>
      <p className='hint'>Logic của service worker chạy ngay trong trang (không cần server push). So bản gần với Telegram và bản sửa.</p>
      <div className='toolbar'>
        {scenarios.map((s) => (
          <button key={s.label} onClick={s.run}>{s.label}</button>
        ))}
        <button onClick={() => setShown({ original: [], fixed: [] })}>Xoá</button>
      </div>
      <div className='split'>
        <div>
          <h3>Như Telegram <span className='muted'>(id đang nhớ: {sizes.original})</span></h3>
          {render(shown.original)}
        </div>
        <div>
          <h3>Bản sửa <span className='muted'>(id đang nhớ: {sizes.fixed})</span></h3>
          {render(shown.fixed)}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 3. bấm thông báo

const SCOPE = 'https://web.telegram.org/z/';
const CLIENT_URLS = ['https://web.telegram.org/z/', 'https://web.telegram.org/z/#-100123', 'https://web.telegram.org/z/?tgaddr=tg%3A%2F%2Fresolve', 'https://web.telegram.org/k/'];

function ClickSection() {
  const [buffer] = useState(() => createClickBuffer<{ chatId: number; messageId: number }>());
  const { lines, add } = useLog(12);
  const clients = CLIENT_URLS.map((url, i) => ({ id: `c${i}`, url }));
  const exact = clients.filter((c) => c.url === SCOPE);
  const prefix = findAppClients(clients, SCOPE);

  const clickWithoutTab = async () => {
    add('bấm thông báo, không có tab nào → openWindow()', 'muted');
    const newClientId = 'c-new';
    buffer.hold(newClientId, { chatId: 1, messageId: 104 });
    add(`giữ { chatId: 1, messageId: 104 } cho ${newClientId} (bộ đệm: ${buffer.size()})`, 'muted');
    await new Promise((r) => setTimeout(r, 900));
    add(`${newClientId} tải xong, gửi "clientReady"`, 'muted');
    const data = buffer.release(newClientId);
    add(`→ postMessage focusMessage ${JSON.stringify(data)} (bộ đệm: ${buffer.size()})`, 'ok');
  };

  return (
    <section className='card tgr-section'>
      <h2>3. Bấm vào thông báo</h2>
      <p className='hint'>Service worker tìm tab của app; không có thì mở tab mới và chờ nó báo sẵn sàng.</p>
      <table className='tgr-table'>
        <thead>
          <tr>
            <th>URL của tab</th>
            <th>So bằng (gốc)</th>
            <th>So tiền tố</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id}>
              <td><code>{c.url}</code></td>
              <td>{exact.includes(c) ? '✔' : '✘'}</td>
              <td>{prefix.includes(c) ? '✔' : '✘'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className='toolbar' style={{ marginTop: 8 }}>
        <button onClick={clickWithoutTab}>Bấm thông báo khi chưa mở tab nào</button>
      </div>
      <Log lines={lines} />
    </section>
  );
}

export default function TgReadReceiptsDemo() {
  return (
    <div className='page tgr'>
      <h1>Đã đọc bằng IntersectionObserver, thông báo không trùng</h1>
      <p className='hint'>Cách Telegram Web A đánh dấu tin đã đọc và tránh hiện hai thông báo cho cùng một tin.</p>
      <ReadSection />
      <PushSection />
      <ClickSection />
    </div>
  );
}
