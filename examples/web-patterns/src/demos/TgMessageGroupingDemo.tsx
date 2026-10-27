import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  appearanceDelay,
  countEmojiOnly,
  groupMessages,
  growDuration,
  isAlbum,
  measureGrow,
  type ChatMessage,
  type GroupItem,
} from '../lib/tgMessageGrouping';
import { Stat } from './shared';
import './TgMessageGroupingDemo.css';

const USERS: Record<string, { name: string; color: string }> = {
  me: { name: 'Tôi', color: '#2aabee' },
  lan: { name: 'Lan', color: '#e17076' },
  minh: { name: 'Minh', color: '#7bc862' },
};

const MAX_HEIGHT = 160;
const DAY = 86400;

function seedMessages(): ChatMessage[] {
  const base = Math.floor(new Date(2026, 9, 25, 9, 0).getTime() / 1000);
  const rows: [string, number, string?, string?][] = [
    ['lan', 0, 'Chào cả nhà 👋'],
    ['lan', 30, 'Mai họp lúc mấy giờ nhỉ?'],
    ['minh', 90, '9h nhé'],
    ['minh', 100, '👍'],
    ['me', 200, 'Ok, mình sẽ gửi tài liệu trước'],
    ['me', 210, undefined, 'a1'],
    ['me', 211, undefined, 'a1'],
    ['me', 212, 'Ảnh whiteboard hôm qua', 'a1'],
    ['lan', 1500, 'Cảm ơn nha'], // cách > 600s: nhóm mới dù cùng người
    ['lan', 1520, '😂😂'],
    ['minh', DAY + 300, 'Sáng nay ai mang máy chiếu?'],
    ['minh', DAY + 320, '🎉'],
    ['me', DAY + 400, 'Mình mang'],
    ['me', DAY + 410, '🇻🇳❤️'],
  ];
  return rows.map(([senderId, offset, text, albumId], i) => ({
    id: i + 1,
    senderId,
    date: base + offset,
    text,
    albumId,
    isOutgoing: senderId === 'me',
  }));
}

export default function TgMessageGroupingDemo() {
  const [messages, setMessages] = useState(seedMessages);
  const [grouped, setGrouped] = useState(true);
  const [factor, setFactor] = useState(50);
  const [lastGrow, setLastGrow] = useState<{ from: number; to: number; ms: number }>();
  const inputRef = useRef<HTMLDivElement>(null);
  const cloneRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef(0);
  const [html, setHtml] = useState('');

  const groups = useMemo(() => groupMessages(messages), [messages]);
  const flatCount = messages.length;

  // Ô nhập: clone ẩn nhận cùng nội dung, đo trên clone rồi mới đổi chiều cao ô thật
  const updateHeight = (willSend = false) => {
    const input = inputRef.current!;
    const result = measureGrow(cloneRef.current!, heightRef.current, MAX_HEIGHT);
    if (!result) return;
    const ms = growDuration(result.height - heightRef.current, factor);
    const apply = () => {
      input.style.transitionDuration = `${ms}ms`;
      input.style.height = `${result.height}px`;
      input.classList.toggle('overflown', result.overflown);
    };
    setLastGrow({ from: heightRef.current, to: result.height, ms });
    heightRef.current = result.height;
    // khi gửi: chờ một frame để khớp với animation tin bay lên
    if (willSend) requestAnimationFrame(apply);
    else apply();
  };

  useLayoutEffect(() => {
    // ô rỗng không có dòng nào nên cao bằng 0: đo với một khoảng trắng không ngắt để giữ đủ một dòng
    cloneRef.current!.innerText = inputRef.current!.innerText || '\u00a0';
    if (heightRef.current === 0) {
      heightRef.current = cloneRef.current!.scrollHeight;
      inputRef.current!.style.height = `${heightRef.current}px`;
      return;
    }
    updateHeight(html === '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  const send = () => {
    const text = inputRef.current!.innerText.trim();
    if (!text) return;
    const last = messages[messages.length - 1];
    setMessages((prev) => [
      ...prev,
      { id: prev.length + 1, senderId: 'me', isOutgoing: true, date: last.date + 30, text },
    ]);
    inputRef.current!.innerText = '';
    setHtml('');
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
  };

  const fill = (text: string) => {
    inputRef.current!.innerText = text;
    setHtml(text);
  };

  const renderItem = (item: GroupItem, isLast: boolean, showName: boolean, delay: number) => {
    const first = isAlbum(item) ? item.main : item;
    const own = first.senderId === 'me';
    const user = USERS[first.senderId];
    const emojiCount = !isAlbum(item) && item.text ? countEmojiOnly(item.text) : false;
    const cls = [
      'tmg-msg',
      own ? 'own' : '',
      isLast ? 'last-in-group' : '',
      emojiCount ? `emoji-only emoji-only-${emojiCount}` : '',
    ].join(' ');
    return (
      <div key={isAlbum(item) ? item.albumId : item.id} className={cls} style={{ animationDelay: `${delay}ms` }}>
        {!own && (isLast || !grouped) && (
          <span className='tmg-avatar' style={{ background: user.color }} aria-hidden>
            {user.name[0]}
          </span>
        )}
        <div className='tmg-bubble'>
          {showName && !own && <div className='tmg-name' style={{ color: user.color }}>{user.name}</div>}
          {isAlbum(item) ? (
            <>
              <div className={`tmg-album n${item.messages.length}`}>
                {item.messages.map((m, i) => (
                  <div key={m.id} className='tmg-tile' style={{ background: `hsl(${200 + i * 40} 60% 60%)` }} />
                ))}
              </div>
              {item.main.text && <div className='tmg-text'>{item.main.text}</div>}
            </>
          ) : (
            <div className='tmg-text'>{item.text}</div>
          )}
          <time className='tmg-time'>{new Date(first.date * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</time>
        </div>
      </div>
    );
  };

  let index = 0;
  return (
    <div className='page tg-grouping'>
      <h1>Telegram #16: ô nhập tự giãn, emoji to, gom tin</h1>
      <p className='hint'>
        Tin cùng người gửi, cách nhau dưới 10 phút được gom thành một nhóm: chỉ tin cuối có avatar và đuôi bong bóng, tên
        chỉ hiện ở tin đầu. Tin chỉ có 1–3 emoji thì bỏ bong bóng và phóng to. Gõ nhiều dòng (Shift+Enter) để thấy ô nhập
        tự giãn với thời lượng tỉ lệ log.
      </p>
      <div className='toolbar'>
        <label>
          <input type='checkbox' checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> Gom tin
        </label>
        <label className='tmg-range'>
          Hệ số log: {factor}
          <input type='range' min={0} max={120} value={factor} onChange={(e) => setFactor(Number(e.target.value))} />
        </label>
      </div>
      <div className='stats'>
        <Stat label='tin' value={flatCount} />
        <Stat label='nhóm người gửi' value={grouped ? groups.reduce((n, g) => n + g.senderGroups.length, 0) : flatCount} />
        <Stat label='lần giãn gần nhất' value={lastGrow ? `${lastGrow.from}→${lastGrow.to}px, ${lastGrow.ms}ms` : '—'} />
      </div>

      <div className='card tmg-chat'>
        <div className='tmg-list' ref={listRef}>
          {groups.map((dg) => (
            <section key={dg.dayStart} className='tmg-day'>
              <div className='tmg-date'>
                {new Date(dg.dayStart).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' })}
              </div>
              {dg.senderGroups.map((sg, gi) => (
                <div key={gi} className={grouped ? 'tmg-group' : ''}>
                  {(grouped ? [sg.items] : sg.items.map((i) => [i])).map((items) =>
                    items.map((item, ii) =>
                      renderItem(item, !grouped || ii === items.length - 1, !grouped || ii === 0, appearanceDelay(index++, flatCount)),
                    ),
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className='tmg-composer'>
          <div className='tmg-input-wrap'>
            <div
              ref={inputRef}
              className='tmg-input'
              contentEditable
              suppressContentEditableWarning
              role='textbox'
              aria-multiline='true'
              aria-label='Soạn tin'
              data-placeholder='Tin nhắn'
              onInput={(e) => setHtml(e.currentTarget.innerHTML)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div ref={cloneRef} className='tmg-input tmg-clone' aria-hidden />
          </div>
          <button className='primary' onClick={send}>
            Gửi
          </button>
        </div>
        <div className='toolbar tmg-quick'>
          <button onClick={() => fill('🔥')}>🔥</button>
          <button onClick={() => fill('👍👍')}>👍👍</button>
          <button onClick={() => fill('🇻🇳❤️🎉')}>🇻🇳❤️🎉</button>
          <button onClick={() => fill('😀😀😀😀')}>4 emoji</button>
          <button onClick={() => fill('Dòng 1\nDòng 2\nDòng 3\nDòng 4\nDòng 5\nDòng 6\nDòng 7\nDòng 8\nDòng 9')}>9 dòng</button>
        </div>
      </div>
    </div>
  );
}
