import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  MessageIndex,
  RenderCursor,
  estimateHeight,
  gapBefore,
  type LoadOptions,
  type MsgLike,
  type MsgType,
} from '../lib/waRenderCursor';
import { estimateHeightWhatsApp2020, gapWhatsApp2020 } from './WaRenderCursorWhatsAppStyle';
import { Log, Stat, useLog } from './shared';

type Mode = 'rewrite' | 'whatsapp';

const TOTAL = 10_000;
/** bản gốc mặc định maxCount = Number.MAX_SAFE_INTEGER; demo chặn ở 600 cho trình duyệt khỏi đơ */
const MAX_COUNT = 600;
const WORDS = 'ok mai gặp nhé ảnh đẹp quá đang tới gửi file rồi cảm ơn bạn nhiều lắm haha chiều nay họp lúc mấy giờ'.split(' ');

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function makeMessages(): MsgLike[] {
  const rand = rng(7);
  const types: MsgType[] = ['chat', 'chat', 'chat', 'chat', 'chat', 'image', 'video', 'ptt', 'sticker', 'document', 'location'];
  return Array.from({ length: TOTAL }, (_, i) => {
    const type = i % 157 === 80 ? 'image' : types[Math.floor(rand() * types.length)];
    const words = 1 + Math.floor(rand() ** 3 * 60);
    const m: MsgLike = {
      id: `m${i}`,
      type,
      fromMe: rand() < 0.45,
      body: type === 'chat' ? Array.from({ length: words }, () => WORDS[Math.floor(rand() * WORDS.length)]).join(' ') : undefined,
      quoted: rand() < 0.08,
    };
    if (type === 'image') {
      // Cứ 157 tin lại có một ảnh trả lời (quote) mà chưa tải xong metadata: chưa có kích thước.
      if (i % 157 === 80) m.quoted = true;
      else {
        m.width = 800;
        m.height = 400 + Math.floor(rand() * 800);
      }
    }
    if (type === 'location') m.isLive = rand() < 0.3;
    return m;
  });
}

const label: Record<MsgType, string> = {
  chat: '',
  notification: 'thông báo',
  image: '🖼 ảnh',
  video: '🎬 video',
  gif: 'GIF',
  ptt: '🎤 tin thoại',
  location: '📍 vị trí',
  vcard: '👤 danh bạ',
  document: '📄 tài liệu',
  sticker: '🙂 sticker',
  unknown: '?',
};

export default function WaRenderCursorDemo() {
  const list = useMemo(() => new MessageIndex(makeMessages()), []);
  const [mode, setMode] = useState<Mode>('rewrite');
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const stickBottom = useRef(true);
  const { lines, add } = useLog(30);

  const opts = (viewport: number, m: Mode = mode): LoadOptions =>
    m === 'rewrite'
      ? { viewport, maxCount: MAX_COUNT, estimate: estimateHeight, gap: gapBefore }
      : { viewport, maxCount: MAX_COUNT, estimate: estimateHeightWhatsApp2020, gap: (p, c) => gapWhatsApp2020(p, c) };

  const viewport = () => scrollRef.current?.clientHeight ?? 420;
  const [cursor, setCursor] = useState(() => RenderCursor.create(list, { viewport: 420, maxCount: MAX_COUNT }));
  const [lastLoad, setLastLoad] = useState('—');

  const start = cursor.getStart(list);
  const end = cursor.getEnd(list);
  const items = list.items.slice(start, end);
  const estimate = mode === 'rewrite' ? estimateHeight : estimateHeightWhatsApp2020;
  const nanCount = items.filter((m) => Number.isNaN(estimate(m))).length;

  function switchMode(next: Mode) {
    setMode(next);
    stickBottom.current = true;
    setCursor(RenderCursor.create(list, opts(viewport(), next)));
    add(next === 'rewrite' ? 'Chuyển sang bản viết lại' : 'Chuyển sang cách ước lượng của WhatsApp 2020', 'muted');
  }

  /** Ghi lại vị trí của tin đầu đang thấy để giữ chỗ đọc sau khi chèn tin cũ lên trên. */
  function remember() {
    const box = scrollRef.current;
    if (!box) return;
    const first = [...box.querySelectorAll<HTMLElement>('[data-id]')].find((el) => el.offsetTop + el.offsetHeight > box.scrollTop);
    anchor.current = first ? { id: first.dataset.id!, top: first.offsetTop - box.scrollTop } : null;
  }

  function load(dir: 'before' | 'after') {
    const o = opts(viewport());
    const next = dir === 'before' ? cursor.loadBefore(list, o) : cursor.loadAfter(list, o);
    const added = dir === 'before' ? next.before - cursor.before : next.after - cursor.after;
    if (!added) return;
    if (dir === 'before') remember();
    const text = `${dir === 'before' ? 'loadBefore' : 'loadAfter'} +${added} tin`;
    setLastLoad(`+${added}`);
    add(added >= MAX_COUNT ? `${text}: chạm maxCount, tổng chiều cao ra NaN nên vòng lặp không dừng sớm` : text, added >= MAX_COUNT ? 'err' : 'ok');
    setCursor(next);
  }

  function onScroll() {
    const box = scrollRef.current!;
    // Chỉ "dính đáy" khi cửa sổ đã chứa tin mới nhất; đáy của một cửa sổ giữa chừng thì không.
    stickBottom.current = !cursor.hasAfter(list) && box.scrollHeight - box.scrollTop - box.clientHeight < 4;
    if (box.scrollTop < 300 && cursor.hasBefore(list)) load('before');
    else if (box.scrollHeight - box.scrollTop - box.clientHeight < 300 && cursor.hasAfter(list)) load('after');
  }

  function jumpTo(index: number) {
    const id = list.items[index].id;
    anchor.current = { id, top: 40 };
    stickBottom.current = false;
    setCursor(RenderCursor.create(list, { ...opts(viewport()), focusedId: id }));
    add(`Nhảy tới tin #${index + 1}: cửa sổ mới quanh tin đó`, 'muted');
  }

  function toBottom() {
    const o = opts(viewport());
    const reset = new RenderCursor({ before: cursor.before + cursor.after }).resetBefore(list, o);
    stickBottom.current = true;
    setCursor(reset);
    add(`Về đáy: resetBefore giữ ${reset.before + 1} tin`, 'muted');
  }

  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    if (anchor.current) {
      const el = box.querySelector<HTMLElement>(`[data-id="${anchor.current.id}"]`);
      if (el) box.scrollTop = el.offsetTop - anchor.current.top;
      anchor.current = null;
    } else if (stickBottom.current && !cursor.hasAfter(list)) {
      box.scrollTop = box.scrollHeight;
    }
  }, [cursor]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className='page wa-cursor'>
      <h1>Cửa sổ render theo chiều cao ước lượng</h1>
      <p className='hint'>
        10.000 tin, chỉ render một cửa sổ. Khi cuộn gần mép, cửa sổ nới thêm vừa đủ tin để lấp 2 màn hình theo
        chiều cao <b>đoán trước</b> từ loại tin, không đo DOM. Tin có viền đỏ là ảnh trả lời chưa có kích thước:
        với cách tính của WhatsApp 2020 nó ra NaN.
      </p>
      <div className='toolbar'>
        <button className={mode === 'rewrite' ? 'primary' : ''} onClick={() => switchMode('rewrite')}>
          Bản viết lại
        </button>
        <button className={mode === 'whatsapp' ? 'primary' : ''} onClick={() => switchMode('whatsapp')} data-testid='mode-wa'>
          Ước lượng kiểu WhatsApp 2020
        </button>
        <button onClick={() => jumpTo(2000)}>Nhảy tới tin #2001</button>
        <button onClick={toBottom}>Về đáy</button>
      </div>
      <div className='stats'>
        <Stat label='đang render' value={`${end - start} / ${TOTAL}`} />
        <Stat label='before / after' value={`${cursor.before} / ${cursor.after}`} />
        <Stat label='cửa sổ' value={`#${start + 1} … #${end}`} />
        <Stat label='lần nạp cuối' value={lastLoad} />
        <Stat label='tin ra NaN' value={nanCount} />
      </div>
      <div className='wa-cursor-box' ref={scrollRef} onScroll={onScroll} data-testid='box'>
        {cursor.hasBefore(list) && <div className='muted wa-cursor-more'>còn {start} tin cũ hơn…</div>}
        {items.map((m, k) => {
          const i = start + k;
          const prev = k > 0 ? items[k - 1] : undefined;
          const h = estimateHeight(m);
          return (
            <div
              key={m.id}
              data-id={m.id}
              className={`wa-cursor-msg ${m.fromMe ? 'me' : ''} ${Number.isNaN(estimate(m)) ? 'nan' : ''}`}
              style={{ marginTop: gapBefore(prev, m, false), minHeight: h }}
            >
              <span className='muted'>#{i + 1}</span> {m.quoted && <span className='badge'>trả lời</span>}{' '}
              {label[m.type]} {m.body}
              <small className='muted'> · ước lượng {String(estimate(m))}px</small>
            </div>
          );
        })}
        {cursor.hasAfter(list) && <div className='muted wa-cursor-more'>còn {TOTAL - end} tin mới hơn…</div>}
      </div>
      <Log lines={lines} />
      <style>{`
        .wa-cursor-box { position: relative; height: 420px; overflow-y: auto; border: 1px solid var(--border); border-radius: 10px; padding: 8px; background: var(--surface-2); overflow-anchor: none; }
        .wa-cursor-msg { box-sizing: border-box; max-width: 78%; padding: 6px 10px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); font-size: 14px; overflow-wrap: anywhere; }
        .wa-cursor-msg.me { margin-left: auto; background: color-mix(in srgb, #25d366 18%, var(--surface)); }
        .wa-cursor-msg.nan { outline: 2px solid var(--err); }
        .wa-cursor-more { text-align: center; padding: 6px; font-size: 13px; }
      `}</style>
    </div>
  );
}
