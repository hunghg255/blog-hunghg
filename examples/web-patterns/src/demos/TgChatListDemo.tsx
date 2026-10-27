import { useLayoutEffect, useRef, useState } from 'react';
import {
  animateRow,
  getAnimationTypes,
  getOrderDiff,
  type AnimationStrategy,
  type AnimationType,
} from '../lib/tgChatListFlip';
import { Stat } from './shared';
import './TgChatListDemo.css';

const ROW_HEIGHT = 56;
const NAMES = [
  'Mẹ', 'Bố', 'Nhóm React VN', 'Công việc', 'Lan', 'Minh', 'Hội ăn trưa', 'Tuấn', 'Kênh tin tức', 'Hà', 'Sếp', 'Đội bóng',
];
const COLORS = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774'];

interface ChatItem {
  id: string;
  name: string;
  preview: string;
  lastAt: number;
}

let clock = 1000;
let nextChat = NAMES.length;

const initial: ChatItem[] = NAMES.map((name, i) => ({ id: `c${i}`, name, preview: 'Tin nhắn cũ', lastAt: clock - i }));

const sortChats = (chats: ChatItem[]) => [...chats].sort((a, b) => b.lastAt - a.lastAt);

const STRATEGY_LABEL: Record<AnimationStrategy, string> = {
  telegram: 'Telegram: nhóm ít thì fade',
  'move-all': 'FLIP thường: tất cả trượt',
  none: 'Không animation',
};

export default function TgChatListDemo() {
  const [chats, setChats] = useState(initial);
  const [strategy, setStrategy] = useState<AnimationStrategy>('telegram');
  const [slow, setSlow] = useState(false);
  const [summary, setSummary] = useState({ move: 0, fade: 0, maxTravel: 0 });
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const prevIdsRef = useRef<string[] | undefined>(undefined);
  const cleanupsRef = useRef<(() => void)[]>([]);

  const ids = chats.map((c) => c.id);

  // Sau khi React đặt `top` mới cho mỗi dòng, trước khi trình duyệt vẽ: gán vị trí cũ rồi cho trượt về.
  useLayoutEffect(() => {
    const prev = prevIdsRef.current;
    prevIdsRef.current = ids;
    if (!prev || prev.join() === ids.join()) return;

    cleanupsRef.current.forEach((cleanup) => cleanup());
    const diff = getOrderDiff(prev, ids);
    const types = getAnimationTypes(diff, strategy);
    let move = 0;
    let fade = 0;
    let maxTravel = 0;
    cleanupsRef.current = ids.map((id) => {
      const type: AnimationType = types[id] ?? 'none';
      if (type === 'move') {
        move++;
        maxTravel = Math.max(maxTravel, Math.abs(diff[id]) * ROW_HEIGHT);
      }
      if (type === 'fade') fade++;
      const el = rowRefs.current.get(id);
      if (el) el.dataset.anim = type;
      return el ? animateRow(el, type, diff[id], { durationMs: slow ? 1200 : 250 }) : () => {};
    });
    setSummary({ move, fade, maxTravel });
    // ids đổi khi và chỉ khi thứ tự đổi; strategy/slow đọc giá trị mới nhất
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join()]);

  const receive = (chatIds: string[]) =>
    setChats((current) =>
      sortChats(
        current.map((chat) =>
          chatIds.includes(chat.id) ? { ...chat, preview: `Tin mới lúc ${++clock}`, lastAt: clock } : chat,
        ),
      ),
    );

  const position = (index: number) => chats[Math.min(index, chats.length - 1)].id;

  return (
    <div className='page tgcl'>
      <h1>Sắp xếp lại danh sách chat không đo DOM</h1>
      <p className='hint'>
        Mỗi dòng cao {ROW_HEIGHT}px, đặt bằng <code>top</code>. Khi có tin mới, chat nhảy lên đầu. Thử "Tin mới ở chat thứ 6"
        với hai kiểu animation, bật "chậm" để nhìn rõ.
      </p>
      <div className='toolbar' role='radiogroup' aria-label='Kiểu animation'>
        {(Object.keys(STRATEGY_LABEL) as AnimationStrategy[]).map((s) => (
          <button key={s} className={s === strategy ? 'primary' : ''} aria-pressed={s === strategy} onClick={() => setStrategy(s)}>
            {STRATEGY_LABEL[s]}
          </button>
        ))}
        <label className='tgcl-slow'>
          <input type='checkbox' checked={slow} onChange={(e) => setSlow(e.target.checked)} /> chậm (1,2s)
        </label>
      </div>
      <div className='toolbar'>
        <button onClick={() => receive([position(5)])}>Tin mới ở chat thứ 6</button>
        <button onClick={() => receive([position(11)])}>Tin mới ở chat cuối</button>
        <button onClick={() => receive([position(3), position(7), position(9)])}>3 chat nhận tin cùng lúc</button>
        <button
          onClick={() =>
            setChats((current) =>
              sortChats([
                ...current.slice(0, 11),
                { id: `c${nextChat}`, name: `Người lạ ${nextChat++}`, preview: 'Xin chào!', lastAt: ++clock },
              ]),
            )
          }
        >
          Chat mới xuất hiện
        </button>
      </div>
      <div className='stats'>
        <Stat label='dòng trượt' value={summary.move} />
        <Stat label='dòng fade' value={summary.fade} />
        <Stat label='quãng trượt xa nhất' value={`${summary.maxTravel}px`} />
      </div>
      <div className='tgcl-list' style={{ height: chats.length * ROW_HEIGHT }}>
        {chats.map((chat, index) => (
          <div
            key={chat.id}
            ref={(el) => {
              if (el) rowRefs.current.set(chat.id, el);
              else rowRefs.current.delete(chat.id);
            }}
            className='tgcl-row'
            data-id={chat.id}
            style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
          >
            <span className='tgcl-avatar' style={{ background: COLORS[Number(chat.id.slice(1)) % COLORS.length] }}>
              {chat.name[0]}
            </span>
            <span className='tgcl-text'>
              <b>{chat.name}</b>
              <small>{chat.preview}</small>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
