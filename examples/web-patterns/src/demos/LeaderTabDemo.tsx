import { useEffect, useMemo, useRef, useState } from 'react';
import { createNotificationSound, electLeader, setFaviconBadge, setTitleCount } from '../lib/leaderTab';
import { Log, useLog, type LogLine } from './shared';
import './LeaderTabDemo.css';

// Mỗi "tab" là một iframe cùng origin trỏ về chính demo này với ?frame=<id>.
// Các iframe dùng chung Web Locks và BroadcastChannel giống hệt các tab thật.
const LOCK = 'demo:notification-leader';
const CHANNEL = 'demo:leader-tab';

type Msg =
  | { type: 'push'; id: number; naive: boolean }
  | { type: 'read' }
  | { type: 'log'; tab: number; text: string; tone?: LogLine['tone'] }
  | { type: 'leader'; tab: number; leader: boolean };

const frameId = Number(new URLSearchParams(location.search).get('frame') ?? 0);

export default function LeaderTabDemo() {
  return frameId ? <TabFrame id={frameId} /> : <Host />;
}

// ---------------------------------------------------------------------------
// Trang chứa: mở/đóng "tab", giả lập server đẩy thông báo
// ---------------------------------------------------------------------------

function Host() {
  const { lines, add } = useLog(40);
  const [tabs, setTabs] = useState([1, 2, 3]);
  const [leader, setLeader] = useState<number | null>(null);
  const [naive, setNaive] = useState(false);
  const nextId = useRef(4);
  const pushId = useRef(1);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<Msg>) => {
      const msg = event.data;
      if (msg.type === 'log') add(`Tab ${msg.tab}: ${msg.text}`, msg.tone);
      if (msg.type === 'leader') {
        if (msg.leader) setLeader(msg.tab);
        else setLeader((current) => (current === msg.tab ? null : current));
      }
    };
    return () => channel.close();
  }, [add]);

  const push = () => {
    const id = pushId.current++;
    add(`📨 server đẩy thông báo #${id} tới mọi tab`, 'muted');
    channelRef.current?.postMessage({ type: 'push', id, naive } satisfies Msg);
  };

  const close = (tab: number) => {
    setTabs((list) => list.filter((t) => t !== tab));
    add(`✖ đóng tab ${tab}`, 'muted');
  };

  const theme = new URLSearchParams(location.search).get('theme') ?? '';
  const src = (tab: number) => `${location.pathname}?frame=${tab}&theme=${theme}#/leader-tab`;

  return (
    <div className='page'>
      <h1>Tab chủ cho thông báo</h1>
      <p className='hint'>
        Ba khung dưới đây là ba "tab" cùng mở app. Bấm "Server đẩy thông báo": mọi tab đều tăng số
        chưa đọc, nhưng chỉ tab chủ 👑 phát âm thanh. Đóng tab chủ để thấy tab khác lên thay. Bật "Cách
        ngây thơ" để mọi tab cùng kêu. Âm thanh chỉ phát được trong tab bạn đã click vào ít nhất một lần.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={push}>
          📨 Server đẩy thông báo
        </button>
        <button
          onClick={() => {
            const id = nextId.current++;
            setTabs((list) => [...list, id]);
            add(`＋ mở tab ${id}`, 'muted');
          }}
        >
          ＋ Mở tab mới
        </button>
        <label className='switch'>
          <input type='checkbox' checked={naive} onChange={(e) => setNaive(e.target.checked)} />
          Cách ngây thơ (tab nào cũng kêu)
        </label>
      </div>
      <div className='lt-tabs'>
        {tabs.map((tab) => (
          <div key={tab} className={`lt-tab ${leader === tab ? 'lt-leader' : ''}`}>
            <div className='lt-tab-bar'>
              <span>
                {leader === tab ? '👑 ' : ''}Tab {tab}
              </span>
              <button aria-label={`Đóng tab ${tab}`} onClick={() => close(tab)}>
                ✖
              </button>
            </div>
            <iframe title={`Tab ${tab}`} src={src(tab)} />
          </div>
        ))}
      </div>
      <Log lines={lines} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Một "tab" của app
// ---------------------------------------------------------------------------

function TabFrame({ id }: { id: number }) {
  const [leader, setLeader] = useState(false);
  const [unread, setUnread] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const [favicon, setFavicon] = useState<string | null>(null);
  const sound = useMemo(() => createNotificationSound(), []);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const leaderRef = useRef(false);

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL);
    channelRef.current = channel;
    const send = (msg: Msg) => channel.postMessage(msg);
    const log = (text: string, tone?: LogLine['tone']) => send({ type: 'log', tab: id, text, tone });

    const election = electLeader(LOCK, (isLeader) => {
      leaderRef.current = isLeader;
      setLeader(isLeader);
      send({ type: 'leader', tab: id, leader: isLeader });
      if (isLeader) {
        log('👑 trở thành tab chủ', 'ok');
        // giống HubSpot: thử "mở khoá" âm thanh ngay khi thành tab chủ
        void sound.unlock().then(setUnlocked);
      }
    });

    channel.onmessage = async (event: MessageEvent<Msg>) => {
      const msg = event.data;
      if (msg.type === 'read') setUnread(0);
      if (msg.type !== 'push') return;
      setUnread((n) => n + 1); // badge trong app: tab nào cũng cập nhật
      if (!leaderRef.current && !msg.naive) return;
      const ok = await sound.play();
      setUnlocked(ok);
      log(
        ok ? `🔔 phát âm thanh cho #${msg.id}` : `🔇 muốn kêu cho #${msg.id} nhưng bị chặn autoplay`,
        ok ? 'ok' : 'warn',
      );
      // tab đang ẩn thì tab chủ mới hiện thông báo hệ điều hành (ở đây chỉ ghi log)
      if (document.hidden) log(`🪟 new Notification("#${msg.id}")`, 'muted');
    };

    // giống NotificationManager của HubSpot: mỗi lần tab hiện lại thì thử mở khoá lần nữa
    const onVisible = () => {
      if (!sound.isUnlocked()) void sound.unlock().then(setUnlocked);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      election.destroy();
      channel.close();
      sound.close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [id, sound]);

  useEffect(() => {
    setFavicon(setFaviconBadge(unread));
    setTitleCount(unread);
  }, [unread]);

  return (
    <div
      className='lt-frame'
      onPointerDown={() => void sound.unlock().then(setUnlocked)}
    >
      <div className='lt-frame-row'>
        <span className={`badge ${leader ? 'ok' : ''}`}>{leader ? 'Tab chủ' : 'Tab phụ'}</span>
        <span className='lt-unread' title='Số chưa đọc'>
          {favicon && <img src={favicon} alt='' width={16} height={16} />} {unread} chưa đọc
        </span>
      </div>
      <div className='lt-frame-row'>
        <span className={unlocked ? 'ok' : 'muted'}>{unlocked ? '🔊 âm thanh: đã mở' : '🔇 âm thanh: chưa mở'}</span>
        <button
          onClick={() => {
            setUnread(0);
            channelRef.current?.postMessage({ type: 'read' } satisfies Msg);
          }}
        >
          Đã đọc
        </button>
      </div>
    </div>
  );
}
