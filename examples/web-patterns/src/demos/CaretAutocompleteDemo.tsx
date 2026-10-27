import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  deleteGraphemeBeforeCaret,
  dropLastGrapheme,
  getWordAtCaret,
  getWordRect,
  insertTextAtCaret,
  replaceCaretWord,
  type CaretWord,
} from '../lib/caretAutocomplete';
import { Log, useLog } from './shared';
import './CaretAutocompleteDemo.css';

const USERS = ['an.nguyen', 'anh.tran', 'binh.le', 'chi.pham', 'dung.vo', 'giang.ho', 'hoa.do'];
const EMOJIS: Record<string, string> = {
  smile: '😄',
  smirk: '😏',
  sob: '😭',
  heart: '❤️',
  heart_eyes: '😍',
  fire: '🔥',
  family: '👨‍👩‍👧',
  flag_vn: '🇻🇳',
  thumbsup: '👍🏽',
  tada: '🎉',
};
const SAMPLE = 'Chúc mừng 🇻🇳👨‍👩‍👧';
const PANEL = ['😄', '❤️', '👍🏽', '👨‍👩‍👧', '🇻🇳', '🎉'];

interface Suggest {
  word: CaretWord;
  items: { label: string; value: string }[];
  top: number;
  left: number;
}

export default function CaretAutocompleteDemo() {
  const editorRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const [active, setActive] = useState(0);
  const [text, setText] = useState('');
  const [naive, setNaive] = useState(SAMPLE);
  const [smart, setSmart] = useState(SAMPLE);
  const { lines, add } = useLog(8);

  // Tính lại gợi ý sau mỗi thay đổi con trỏ (gõ, bấm chuột, phím mũi tên trái/phải…)
  const refresh = () => {
    const editor = editorRef.current;
    const box = boxRef.current;
    if (!editor || !box) return;
    setText(editor.textContent ?? '');
    const word = getWordAtCaret(editor);
    if (!word) return setSuggest(null);
    const q = word.query.toLowerCase();
    const items =
      word.trigger === '@'
        ? USERS.filter((u) => u.includes(q)).map((u) => ({ label: `@${u}`, value: `@${u}` }))
        : Object.entries(EMOJIS)
            .filter(([name]) => name.includes(q))
            .map(([name, e]) => ({ label: `${e}  :${name}:`, value: e }));
    const rect = getWordRect(word.range);
    if (!items.length || !rect) return setSuggest(null);
    // toạ độ viewport → toạ độ trong khung chứa (position: relative)
    const base = box.getBoundingClientRect();
    setSuggest({ word, items: items.slice(0, 6), top: rect.bottom - base.top + 4, left: rect.left - base.left });
    setActive(0);
  };

  useEffect(() => {
    // selectionchange bắt cả trường hợp bấm chuột di con trỏ, không chỉ gõ phím
    const onSelection = () => {
      if (document.activeElement === editorRef.current) refresh();
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  const choose = (value: string) => {
    const editor = editorRef.current;
    if (!editor || !suggest) return;
    replaceCaretWord(editor, suggest.word, value);
    add(`Thay "${suggest.word.trigger}${suggest.word.query}" bằng "${value}"`, 'ok');
    setSuggest(null);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!suggest) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + d + suggest.items.length) % suggest.items.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      // đang soạn bằng bộ gõ (IME) thì Enter là để chốt chữ, không phải chọn gợi ý
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      choose(suggest.items[active].value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSuggest(null);
    }
  };

  return (
    <div className='page caret-ac'>
      <h1>Autocomplete tại con trỏ</h1>
      <p className='hint'>
        Gõ <code>@an</code> hoặc <code>:he</code> ở <b>bất kỳ đâu</b> trong ô (kể cả giữa câu). Dùng ↑ ↓ Enter/Tab, Esc để
        đóng. Bảng emoji bên dưới chèn vào đúng vị trí con trỏ mà không làm mất nó.
      </p>

      <div className='caret-ac-box' ref={boxRef}>
        <div
          ref={editorRef}
          className='caret-ac-editor'
          contentEditable
          suppressContentEditableWarning
          role='textbox'
          aria-multiline='true'
          aria-label='Soạn tin'
          aria-autocomplete='list'
          aria-expanded={!!suggest}
          onInput={refresh}
          onKeyDown={onKeyDown}
          onBlur={() => setSuggest(null)}
        >
          Chào cả nhóm, nhờ  xem giúp bản thiết kế nhé.
        </div>

        {suggest && (
          <ul className='caret-ac-popup' role='listbox' style={{ top: suggest.top, left: suggest.left }}>
            {suggest.items.map((item, i) => (
              <li
                key={item.value + i}
                role='option'
                aria-selected={i === active}
                className={i === active ? 'active' : ''}
                // mousedown + preventDefault: bấm vào gợi ý KHÔNG lấy mất focus/selection của ô soạn thảo
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(item.value);
                }}
              >
                {item.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className='toolbar caret-ac-panel' aria-label='Bảng emoji'>
        {PANEL.map((e) => (
          <button
            key={e}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => {
              insertTextAtCaret(editorRef.current!, e);
              add(`Chèn ${e} tại con trỏ`);
            }}
          >
            {e}
          </button>
        ))}
        <button
          title='Xoá một ký tự'
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => {
            deleteGraphemeBeforeCaret(editorRef.current!);
            add('⌫ xoá đúng một grapheme trước con trỏ');
          }}
        >
          ⌫
        </button>
      </div>

      <div className='card'>
        <b>Xoá ký tự cuối: cắt chuỗi kiểu ngây thơ vs theo grapheme</b>
        <div className='caret-ac-compare'>
          <div>
            <span className='muted'>text.slice(0, -1)</span>
            <output data-testid='naive'>{naive}</output>
            <span className='muted'>{naive.length} code unit</span>
            <button onClick={() => setNaive((t) => t.slice(0, -1))}>⌫ ngây thơ</button>
          </div>
          <div>
            <span className='muted'>dropLastGrapheme(text)</span>
            <output data-testid='grapheme'>{smart}</output>
            <span className='muted'>{smart.length} code unit</span>
            <button onClick={() => setSmart((t) => dropLastGrapheme(t))}>⌫ theo grapheme</button>
          </div>
        </div>
        <div className='toolbar'>
          <button
            onClick={() => {
              setNaive(SAMPLE);
              setSmart(SAMPLE);
            }}
          >
            Đặt lại
          </button>
          <span className='muted'>
            "{SAMPLE}": {SAMPLE.length} code unit · {Array.from(SAMPLE).length} code point
          </span>
        </div>
      </div>

      <p className='muted caret-ac-text'>textContent: {JSON.stringify(text)}</p>
      <Log lines={lines} />
    </div>
  );
}
