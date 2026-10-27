import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatScroller, type ChatScrollPosition } from '../lib/useChatScroller';
import { Log, sleep, Stat, useLog } from './shared';
import './ChatScrollerDemo.css';

interface Message {
  id: number;
  text: string;
  mine: boolean;
  image?: boolean;
  isNew?: boolean;
}

const PAGE = 15;
const MAX_OLDER_PAGES = 5;
const SAMPLE = ['Ok nhé', 'Tối nay đi ăn không?', 'Để mình xem lịch đã', 'Haha 😂', 'Gửi file rồi đó', 'Chuẩn luôn'];

function makeMessage(id: number, extra: Partial<Message> = {}): Message {
  return { id, text: `#${id} ${SAMPLE[id % SAMPLE.length]}`, mine: id % 3 === 0, ...extra };
}

const INITIAL = Array.from({ length: 20 }, (_, i) => makeMessage(1000 + i));

/** "Ảnh" có chiều cao chỉ được biết sau khi tải xong. Đổi thẳng trên DOM, React không hề biết. */
function LateImage() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const id = setTimeout(() => {
      if (ref.current) ref.current.style.height = '140px';
    }, 1200);
    return () => clearTimeout(id);
  }, []);
  return <span ref={ref} className='cs-img' aria-label='ảnh' />;
}

function Bubbles({ messages }: { messages: Message[] }) {
  return (
    <>
      {messages.map((m) => (
        <div key={m.id} className={`cs-msg${m.mine ? ' mine' : ''}${m.isNew ? ' new' : ''}`}>
          {m.text}
          {m.image && <LateImage />}
        </div>
      ))}
    </>
  );
}

interface ChatViewProps {
  messages: Message[];
  loadingOlder: boolean;
  observeResize: boolean;
  onReachTop: () => void;
  onReachBottom: () => void;
  onPositionChange: (kind: ChatScrollPosition['kind']) => void;
  jumpLabel: string | null;
}

/** Dùng useChatScroller. */
function SmartChat(props: ChatViewProps) {
  const { scrollerRef, contentRef, scrollToBottom } = useChatScroller({
    onReachTop: props.onReachTop,
    onReachBottom: props.onReachBottom,
    onPositionChange: (p) => props.onPositionChange(p.kind),
    observeResize: props.observeResize,
  });
  return (
    <div className='cs-wrap'>
      <div className='cs-chat' ref={scrollerRef} data-testid='chat'>
        <div className='cs-content' ref={contentRef}>
          {props.loadingOlder && <div className='cs-loading-older'>Đang tải tin cũ…</div>}
          <Bubbles messages={props.messages} />
        </div>
      </div>
      {props.jumpLabel && (
        <button className='cs-jump primary' onClick={scrollToBottom}>
          {props.jumpLabel}
        </button>
      )}
    </div>
  );
}

/** Cách "ngây thơ": cuộn xuống đáy lúc mount, chạm scrollTop = 0 thì tải tin cũ. Hết. */
function NaiveChat(props: ChatViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const wasTop = useRef(false);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, []);
  const onScroll = () => {
    const el = ref.current!;
    const top = el.scrollTop <= 20;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 20;
    props.onPositionChange(bottom ? 'bottom' : top ? 'top' : 'middle');
    if (top && !wasTop.current) props.onReachTop();
    wasTop.current = top;
  };
  return (
    <div className='cs-wrap'>
      <div className='cs-chat' data-naive='true' ref={ref} onScroll={onScroll} data-testid='chat'>
        <div className='cs-content'>
          {props.loadingOlder && <div className='cs-loading-older'>Đang tải tin cũ…</div>}
          <Bubbles messages={props.messages} />
        </div>
      </div>
      {props.jumpLabel && (
        <button
          className='cs-jump primary'
          onClick={() => ref.current && (ref.current.scrollTop = ref.current.scrollHeight)}
        >
          {props.jumpLabel}
        </button>
      )}
    </div>
  );
}

export default function ChatScrollerDemo() {
  const [naive, setNaive] = useState(false);
  const [autoIncoming, setAutoIncoming] = useState(true);
  const [lateImages, setLateImages] = useState(false);
  const [observeResize, setObserveResize] = useState(true);
  const [messages, setMessages] = useState<Message[]>(INITIAL);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderPages, setOlderPages] = useState(0);
  const [position, setPosition] = useState<ChatScrollPosition['kind']>('bottom');
  const [unread, setUnread] = useState(0);
  const { lines, add } = useLog();
  const loadingRef = useRef(false);
  const positionRef = useRef(position);
  positionRef.current = position;
  const nextIdRef = useRef(2000);

  const loadOlder = useCallback(async () => {
    if (loadingRef.current) return;
    if (olderPages >= MAX_OLDER_PAGES) {
      add('Đã tải hết tin cũ', 'muted');
      return;
    }
    loadingRef.current = true;
    setLoadingOlder(true);
    add('⬆️ chạm đỉnh -> tải tin cũ…');
    await sleep(800);
    setMessages((prev) => {
      const first = prev[0].id;
      const older = Array.from({ length: PAGE }, (_, i) => makeMessage(first - PAGE + i));
      return [...older, ...prev];
    });
    setOlderPages((n) => n + 1);
    setLoadingOlder(false);
    loadingRef.current = false;
    add(`+${PAGE} tin cũ đã chèn lên trên`, 'ok');
  }, [olderPages, add]);

  const onReachBottom = useCallback(() => {
    setUnread(0);
    add('⬇️ về đáy -> đánh dấu đã đọc', 'muted');
  }, [add]);

  // tin mới tự đến mỗi 2 giây
  useEffect(() => {
    if (!autoIncoming) return;
    const id = setInterval(() => {
      const msgId = nextIdRef.current++;
      setMessages((prev) => [
        ...prev.map((m) => (m.isNew ? { ...m, isNew: false } : m)),
        makeMessage(msgId, { isNew: true, image: lateImages, mine: false }),
      ]);
      if (positionRef.current !== 'bottom') setUnread((n) => n + 1);
    }, 2000);
    return () => clearInterval(id);
  }, [autoIncoming, lateImages]);

  const props: ChatViewProps = {
    messages,
    loadingOlder,
    observeResize,
    onReachTop: loadOlder,
    onReachBottom,
    onPositionChange: setPosition,
    jumpLabel: position !== 'bottom' ? (unread > 0 ? `↓ ${unread} tin mới` : '↓ Xuống cuối') : null,
  };

  return (
    <div className='page'>
      <h1>Khung chat không giật</h1>
      <p className='hint'>
        Kéo lên đỉnh để tải tin cũ, đứng ở đáy để thấy tin mới tự dính đáy. Bật "cách ngây thơ" để so
        sánh (khung đó tắt scroll anchoring để giống Safari).
      </p>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={naive} onChange={(e) => setNaive(e.target.checked)} />
          Cách ngây thơ
        </label>
        <label className='switch'>
          <input type='checkbox' checked={autoIncoming} onChange={(e) => setAutoIncoming(e.target.checked)} />
          Tin mới mỗi 2 giây
        </label>
        <label className='switch'>
          <input type='checkbox' checked={lateImages} onChange={(e) => setLateImages(e.target.checked)} />
          Tin mới có ảnh tải chậm
        </label>
        <label className='switch'>
          <input
            type='checkbox'
            checked={observeResize}
            disabled={naive}
            onChange={(e) => setObserveResize(e.target.checked)}
          />
          ResizeObserver
        </label>
      </div>
      <div className='stats'>
        <Stat label='vị trí' value={<span data-testid='position'>{position}</span>} />
        <Stat label='tin nhắn' value={messages.length} />
        <Stat label='trang tin cũ đã tải' value={`${olderPages}/${MAX_OLDER_PAGES}`} />
      </div>
      <div className='split'>
        {naive ? <NaiveChat key='naive' {...props} /> : <SmartChat key={`smart-${observeResize}`} {...props} />}
        <aside className='sticky'>
          <Log lines={lines} />
        </aside>
      </div>
    </div>
  );
}
