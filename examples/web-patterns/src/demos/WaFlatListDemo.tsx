import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, type FlatItem, type WindowRange } from '../lib/waFlatList';
import { Stat } from './shared';

interface Chat extends FlatItem {
  name: string;
  preview: string;
  hue: number;
}

const COUNT = 5000;
const NAMES = ['An', 'Bình', 'Cường', 'Dung', 'Giang', 'Hải', 'Khánh', 'Linh', 'Minh', 'Nga', 'Phúc', 'Quân', 'Sơn', 'Trang', 'Vy'];
const PREVIEWS = ['ok nhé', 'đã gửi một ảnh', 'mai họp lúc 9h', 'haha', 'cảm ơn bạn', 'đang gõ…', 'tin nhắn thoại 0:12'];

const makeChats = (): Chat[] =>
  Array.from({ length: COUNT }, (_, i) => ({
    itemKey: `chat-${i}`,
    name: `${NAMES[i % NAMES.length]} ${Math.floor(i / NAMES.length) + 1}`,
    preview: PREVIEWS[(i * 7) % PREVIEWS.length],
    hue: (i * 47) % 360,
  }));

type Mode = 'recycle' | 'nokey' | 'unsorted';

/** Đếm số lần nội dung một dòng được mount: mỗi lần là một cây DOM mới. */
const counters = { mounts: 0 };

function ChatRow({ chat, rctKey }: { chat: Chat; rctKey: number }) {
  useEffect(() => {
    counters.mounts++;
  }, []);
  return (
    <div className='wa-fl-row'>
      <span className='wa-fl-avatar' style={{ background: `hsl(${chat.hue} 55% 45%)` }}>
        {chat.name[0]}
      </span>
      <span className='wa-fl-text'>
        <b>{chat.name}</b>
        <span className='muted'>{chat.preview}</span>
      </span>
      <span className='badge' title='key React'>
        {rctKey >= 0 ? `key ${rctKey}` : 'key = itemKey'}
      </span>
    </div>
  );
}

export default function WaFlatListDemo() {
  const [chats, setChats] = useState(makeChats);
  const [mode, setMode] = useState<Mode>('recycle');
  const [range, setRange] = useState<WindowRange>({ first: 0, last: 0 });
  const [stats, setStats] = useState({ mounts: 0, moves: 0 });
  const wrap = useRef<HTMLDivElement>(null);
  const moves = useRef(0);

  useEffect(() => {
    counters.mounts = 0;
    moves.current = 0;
    const viewport = wrap.current?.querySelector('[role=list]');
    if (!viewport) return;
    // Node con bị gỡ ra rồi chèn lại (React di chuyển DOM) hiện thành một bản ghi childList.
    const mo = new MutationObserver((records) => {
      for (const r of records) moves.current += r.addedNodes.length;
    });
    mo.observe(viewport, { childList: true });
    const id = setInterval(() => setStats({ mounts: counters.mounts, moves: moves.current }), 250);
    return () => {
      mo.disconnect();
      clearInterval(id);
    };
  }, [mode]);

  const renderItem = useCallback((chat: Chat, rctKey: number) => <ChatRow chat={chat} rctKey={rctKey} />, []);

  function bump() {
    // Đẩy một chat đang thấy ở giữa màn hình lên đầu, như khi có tin nhắn mới.
    setChats((list) => {
      const i = Math.min(range.first + 6, list.length - 1);
      return [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
    });
  }

  return (
    <div className='page wa-fl'>
      <h1>FlatList tái dùng key React</h1>
      <p className='hint'>
        5000 chat, chỉ render ~20 dòng. Bản WhatsApp gán lại key React cho dòng vừa vào màn hình bằng key của dòng
        vừa rời đi, và giữ thứ tự con theo key: cuộn bao lâu cũng không mount thêm, không di chuyển node DOM.
      </p>
      <div className='toolbar'>
        <button className={mode === 'recycle' ? 'primary' : ''} onClick={() => setMode('recycle')}>
          Tái dùng key + sắp theo key
        </button>
        <button className={mode === 'nokey' ? 'primary' : ''} onClick={() => setMode('nokey')} data-testid='mode-nokey'>
          key = itemKey
        </button>
        <button className={mode === 'unsorted' ? 'primary' : ''} onClick={() => setMode('unsorted')} data-testid='mode-unsorted'>
          Tái dùng key, không sắp
        </button>
        <button onClick={bump} data-testid='bump'>
          Đẩy chat lên đầu
        </button>
      </div>
      <div className='stats'>
        <Stat label='cửa sổ' value={`#${range.first + 1} … #${range.last + 1}`} />
        <Stat label='dòng đang render' value={range.last - range.first + 1} />
        <Stat label='mount thêm khi cuộn' value={stats.mounts} />
        <Stat label='node DOM chèn/di chuyển' value={stats.moves} />
      </div>
      <div ref={wrap} key={mode} data-testid='list'>
        <FlatList
          items={chats}
          renderItem={renderItem}
          height={432}
          extraItems={5}
          recycleKeys={mode !== 'nokey'}
          sortByKey={mode === 'recycle'}
          onWindowChange={setRange}
          className='wa-fl-list'
          ariaLabel='Danh sách chat'
        />
      </div>
      <style>{`
        .wa-fl-list { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
        .wa-fl-item { background: var(--surface); }
        .wa-fl-row { display: flex; align-items: center; gap: 10px; height: 72px; padding: 0 12px; box-sizing: border-box; border-bottom: 1px solid var(--border); }
        .wa-fl-avatar { flex: 0 0 44px; height: 44px; border-radius: 50%; color: #fff; display: grid; place-items: center; font-weight: 700; }
        .wa-fl-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .wa-fl-text > * { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      `}</style>
    </div>
  );
}
