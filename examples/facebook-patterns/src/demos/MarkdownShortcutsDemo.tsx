import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  backspaceAtStart,
  block,
  createEditor,
  editText,
  legacyPaste,
  markdownToBlocks,
  splitBlock,
  type Block,
  type Editor,
} from '../lib/mdShortcuts';
import { Log, useLog } from './shared';
import './MarkdownShortcutsDemo.css';

const SAMPLE = `# Kế hoạch dạo sáng
2019. Một năm tốt để bắt đầu
- Chuẩn bị
    - nước
    - áo khoác
Ghi chú thêm
    - mục này thụt sau đoạn văn
1. Tập trung
2. Xuất phát
[x] Đặt chỗ gửi xe`;

const TYPE_LABEL: Record<Block['type'], string> = {
  unstyled: 'văn bản',
  'header-one': 'H1',
  'header-two': 'H2',
  blockquote: 'trích dẫn',
  'code-block': 'code',
  'unordered-list-item': 'gạch đầu dòng',
  'ordered-list-item': 'danh sách số',
  'checkbox-list-item': 'checkbox',
};

/** số thứ tự cho mục danh sách số: đếm các mục liền nhau cùng mức */
function numbering(blocks: Block[]) {
  const nums = new Map<string, number>();
  const counters: number[] = [];
  for (const b of blocks) {
    if (b.type !== 'ordered-list-item') {
      if (!(b.type === 'unordered-list-item' && b.depth > 0)) counters.length = 0;
      continue;
    }
    counters.length = b.depth + 1;
    counters[b.depth] = (counters[b.depth] ?? 0) + 1;
    nums.set(b.key, counters[b.depth]);
  }
  return nums;
}

export default function MarkdownShortcutsDemo() {
  return (
    <div className='page md-demo'>
      <h1>Phím tắt Markdown trong editor</h1>
      <p className='hint'>
        Gõ ở đầu dòng: <code># </code> <code>## </code> <code>&gt; </code> <code>- </code>{' '}
        <code>1. </code> <code>[ ] </code> <code>```</code>. Block đổi kiểu ngay khi gõ dấu cách.
        Bấm <kbd>Backspace</kbd> ngay sau đó để lấy lại đúng chữ đã gõ; gõ thêm chữ rồi mới
        Backspace ở đầu dòng thì chỉ bỏ kiểu. Gõ <code>- </code> trong một mục gạch đầu dòng để thụt vào.
      </p>
      <BlockEditor />
      <PastePanel />
    </div>
  );
}

function BlockEditor() {
  const { lines, add } = useLog();
  const [ed, setEd] = useState<Editor>(() =>
    createEditor([block('Gõ thử ở dòng trống bên dưới'), block('')]),
  );
  const refs = useRef(new Map<string, HTMLInputElement>());

  // đặt lại caret sau mỗi lần state đổi (input được điều khiển hoàn toàn bởi state)
  useLayoutEffect(() => {
    const el = refs.current.get(ed.caret.key);
    if (!el) return;
    if (document.activeElement !== el) el.focus();
    el.setSelectionRange(ed.caret.offset, ed.caret.offset);
  }, [ed]);

  const update = (next: Editor, note?: string) => {
    if (note) add(note, next.last === 'markdown' ? 'ok' : undefined);
    setEd(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, b: Block, i: number) => {
    const el = e.currentTarget;
    const caret = { key: b.key, offset: el.selectionStart ?? 0 };
    const here = { ...ed, caret };
    if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0) {
      const next = backspaceAtStart(here);
      if (!next) return;
      e.preventDefault();
      const was = ed.last === 'markdown' && ed.undo?.before.key === b.key;
      update(next, was ? `Backspace: hoàn tác, trả lại "${next.blocks[i].text}"` : `Backspace ở đầu block (${TYPE_LABEL[b.type]})`);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      update(splitBlock(here));
    } else if (e.key === 'ArrowUp' && i > 0) {
      e.preventDefault();
      setEd({ ...ed, caret: { key: ed.blocks[i - 1].key, offset: ed.blocks[i - 1].text.length }, last: 'other' });
    } else if (e.key === 'ArrowDown' && i < ed.blocks.length - 1) {
      e.preventDefault();
      setEd({ ...ed, caret: { key: ed.blocks[i + 1].key, offset: 0 }, last: 'other' });
    }
  };

  const nums = numbering(ed.blocks);
  return (
    <div className='card md-editor'>
      <div className='md-blocks' data-testid='editor'>
        {ed.blocks.map((b, i) => (
          <div
            key={b.key}
            className={`md-block md-${b.type}`}
            style={{ paddingLeft: `${b.depth * 22 + (b.type === 'unstyled' ? 0 : 24)}px` }}
            data-type={b.type}
            data-depth={b.depth}
          >
            {b.type === 'unordered-list-item' && <span className='md-mark'>{['•', '◦', '▪'][b.depth % 3]}</span>}
            {b.type === 'ordered-list-item' && <span className='md-mark'>{nums.get(b.key)}.</span>}
            {b.type === 'blockquote' && <span className='md-mark md-bar' />}
            {b.type === 'code-block' && <span className='md-mark'>›</span>}
            {b.type === 'checkbox-list-item' && (
              <input
                type='checkbox'
                className='md-mark'
                checked={!!b.checked}
                aria-label='Hoàn thành'
                onChange={(e) =>
                  setEd({ ...ed, blocks: ed.blocks.map((x) => (x.key === b.key ? { ...x, checked: e.target.checked } : x)) })
                }
              />
            )}
            <input
              ref={(el) => {
                if (el) refs.current.set(b.key, el);
                else refs.current.delete(b.key);
              }}
              value={b.text}
              aria-label={`Dòng ${i + 1}, ${TYPE_LABEL[b.type]}`}
              placeholder={i === ed.blocks.length - 1 && b.text === '' ? 'Gõ "# " hoặc "- "…' : ''}
              onChange={(e) => {
                const inserted = (e.nativeEvent as InputEvent).inputType === 'insertText';
                const next = editText(ed, b.key, e.target.value, e.target.selectionStart ?? 0, inserted);
                const nb = next.blocks[i];
                const typed = e.target.value.slice(0, e.target.selectionStart ?? 0);
                const note = `"${typed}" → ${TYPE_LABEL[nb.type]}${nb.depth > b.depth ? `, thụt mức ${nb.depth}` : ''}`;
                update(next, next.last === 'markdown' ? note : undefined);
              }}
              onKeyDown={(e) => onKeyDown(e, b, i)}
              onFocus={(e) => {
                if (ed.caret.key !== b.key) setEd({ ...ed, caret: { key: b.key, offset: e.target.selectionStart ?? 0 } });
              }}
              data-testid={`line-${i}`}
            />
          </div>
        ))}
      </div>
      <Log lines={lines} />
    </div>
  );
}

function PastePanel() {
  const [text, setText] = useState(SAMPLE);
  const fixed = markdownToBlocks(text);
  const legacy = legacyPaste(text);
  return (
    <div className='card md-paste'>
      <h2>Dán Markdown nhiều dòng</h2>
      <p className='hint'>
        Bên trái: hành vi của bản gốc. Bên phải: bản viết lại. Chú ý dòng "2019." và dòng thụt vào
        sau đoạn văn.
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} data-testid='paste' />
      <div className='md-compare'>
        <Preview title='Bản gốc' blocks={legacy} id='legacy' />
        <Preview title='Bản viết lại' blocks={fixed} id='fixed' />
      </div>
    </div>
  );
}

function Preview({ title, blocks, id }: { title: string; blocks: Block[]; id: string }) {
  const nums = numbering(blocks);
  return (
    <div className='md-preview' data-testid={`preview-${id}`}>
      <b>{title}</b>
      {blocks.map((b) => (
        <div
          key={b.key}
          className={`md-row md-${b.type}`}
          style={{ paddingLeft: `${b.depth * 18}px` }}
          data-type={b.type}
        >
          <span className='badge'>{TYPE_LABEL[b.type]}</span>{' '}
          {b.type === 'ordered-list-item' && `${nums.get(b.key)}. `}
          {b.type === 'unordered-list-item' && '• '}
          {b.type === 'checkbox-list-item' && (b.checked ? '☑ ' : '☐ ')}
          {b.text}
        </div>
      ))}
    </div>
  );
}
