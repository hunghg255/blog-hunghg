import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  applySkinTone,
  buildBackwardTrie,
  EMOTICONS,
  EmojiSearchIndex,
  matchEmoticon,
  undoReplacement,
  type Replacement,
} from '../lib/waEmojiTrie';
import { CATEGORY_ORDER, EN_DICT, POPULAR, VI_DICT } from '../lib/waEmojiData';
import { Log, Stat, useLog } from './shared';
import './WaEmojiTrieDemo.css';

const TONES: [string, string | null][] = [
  ['Mặc định', null],
  ['👍🏻', '\u{1F3FB}'],
  ['👍🏽', '\u{1F3FD}'],
  ['👍🏿', '\u{1F3FF}'],
];

export default function WaEmojiTrieDemo() {
  const trie = useMemo(() => buildBackwardTrie(EMOTICONS), []);
  const index = useMemo(() => new EmojiSearchIndex([EN_DICT, VI_DICT]), []);
  const fullIndex = useMemo(() => new EmojiSearchIndex([EN_DICT, VI_DICT], Infinity), []);
  const box = useRef<HTMLTextAreaElement>(null);
  const last = useRef<Replacement | null>(null);
  const [strict, setStrict] = useState(true);
  const [tone, setTone] = useState<string | null>(null);
  const [query, setQuery] = useState('cuoi');
  const [recent, setRecent] = useState<string[]>([]);
  const [count, setCount] = useState({ replaced: 0, undone: 0 });
  const { lines, add } = useLog(20);

  const strictRef = useRef(strict);
  strictRef.current = strict;
  const toneRef = useRef(tone);
  toneRef.current = tone;

  // beforeinput gốc của trình duyệt (onBeforeInput của React dựa trên textInput/keypress, không có inputType).
  useEffect(() => {
    const el = box.current!;
    const handler = (ev: InputEvent) => onBeforeInput(el, ev);
    el.addEventListener('beforeinput', handler);
    return () => el.removeEventListener('beforeinput', handler);
  }, []); // handler chỉ đọc ref và setState dạng hàm nên không cần đăng ký lại

  function onBeforeInput(el: HTMLTextAreaElement, ev: InputEvent) {
    if (ev.inputType !== 'insertText' || !ev.data || ev.isComposing) return;
    if (el.selectionStart !== el.selectionEnd) return;
    const caret = el.selectionStart;
    const m = matchEmoticon(trie, el.value.slice(0, caret), ev.data, { requireBoundary: strictRef.current });
    if (!m) {
      last.current = null;
      return;
    }
    ev.preventDefault();
    const emoji = applySkinTone(m.emoji, toneRef.current);
    el.setRangeText(emoji, m.start, caret, 'end');
    last.current = { start: m.start, emoji, original: m.original };
    setCount((c) => ({ ...c, replaced: c.replaced + 1 }));
    add(`"${m.original}" → ${emoji} (vị trí ${m.start})`, 'ok');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    if (e.key !== 'Backspace') {
      if (e.key.length > 1 && e.key !== 'Shift') last.current = null;
      return;
    }
    if (el.selectionStart !== el.selectionEnd) return;
    const undo = undoReplacement(el.value, el.selectionStart, last.current);
    if (!undo) return;
    e.preventDefault();
    const rec = last.current!;
    el.setRangeText(rec.original, rec.start, rec.start + rec.emoji.length, 'end');
    last.current = null;
    setCount((c) => ({ ...c, undone: c.undone + 1 }));
    add(`Backspace sau ${rec.emoji} → trả lại "${rec.original}"`, 'warn');
  }

  function insert(emoji: string) {
    const el = box.current!;
    el.focus();
    el.setRangeText(emoji, el.selectionStart, el.selectionEnd, 'end');
    last.current = null;
    setRecent((r) => [emoji, ...r.filter((x) => x !== emoji)].slice(0, 8));
    add(`Chọn ${emoji} từ kết quả tìm kiếm → thêm vào "gần đây"`, 'muted');
  }

  const t0 = performance.now();
  const results = index.search(query, { recent, popular: POPULAR, categoryOrder: CATEGORY_ORDER });
  const ms = performance.now() - t0;
  const candidates = index.matches(query).length;

  return (
    <div className='page wa-emoji'>
      <h1>Emoticon → emoji và tìm emoji</h1>
      <p className='hint'>
        Gõ <code>:-)</code>, <code>(y)</code>, <code>&lt;3</code>… vào ô soạn tin: emoji thay ngay khi gõ ký tự cuối. Bấm
        Backspace ngay sau emoji để lấy lại chữ gốc. Trong khối <code>```</code> chưa đóng thì không thay.
      </p>
      <div className='toolbar'>
        <label>
          <input type='checkbox' checked={strict} onChange={(e) => setStrict(e.target.checked)} /> Cần khoảng trắng
          phía trước (tắt = như bản gốc)
        </label>
        <span className='muted'>Màu da cho 👍:</span>
        {TONES.map(([label, value]) => (
          <button key={label} className={tone === value ? 'primary' : ''} onClick={() => setTone(value)}>
            {label}
          </button>
        ))}
      </div>
      <div className='wa-emoji-chips' aria-label='Danh sách emoticon'>
        {Object.entries(EMOTICONS).map(([k, v]) => (
          <span key={k} className='wa-emoji-chip'>
            <code>{k}</code> {v}
          </span>
        ))}
      </div>
      <textarea
        ref={box}
        className='wa-emoji-box'
        data-testid='composer'
        rows={3}
        placeholder='Nhập tin nhắn…'
        onKeyDown={onKeyDown}
        onMouseDown={() => (last.current = null)}
      />
      <div className='stats'>
        <Stat label='lần thay emoticon' value={<output data-testid='replaced'>{count.replaced}</output>} />
        <Stat label='lần Backspace trả lại' value={count.undone} />
        <Stat label='nút trie emoticon' value={trie.size()} />
      </div>

      <h2>Tìm emoji (tiếng Anh + tiếng Việt)</h2>
      <div className='toolbar'>
        <input
          type='text'
          data-testid='search'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='vd: meo, tim, cười, cat'
        />
        {['cuoi', 'tim', 'cat', 'hoa', 'cười ra nước'].map((q) => (
          <button key={q} onClick={() => setQuery(q)}>
            {q}
          </button>
        ))}
      </div>
      <div className='wa-emoji-results' data-testid='results'>
        {results.length === 0 && <span className='muted'>Không có kết quả</span>}
        {results.map((e) => (
          <button key={e} className={recent.includes(e) ? 'wa-emoji-pick recent' : 'wa-emoji-pick'} onClick={() => insert(e)}>
            {e}
          </button>
        ))}
      </div>
      <div className='stats'>
        <Stat label='ứng viên từ trie' value={candidates} />
        <Stat label='nút trie (tiền tố 5 ký tự)' value={index.nodeCount} />
        <Stat label='nút trie (cả từ khoá)' value={fullIndex.nodeCount} />
        <Stat label='thời gian tìm' value={`${ms.toFixed(2)} ms`} />
      </div>
      <p className='hint'>
        Thứ tự: khớp đúng và hay dùng → khớp đúng → gần đây → phổ biến → còn lại theo nhóm. Chọn một emoji để đưa nó vào
        "gần đây" rồi tìm lại để thấy nó nhảy lên.
      </p>
      <Log lines={lines} />
    </div>
  );
}
