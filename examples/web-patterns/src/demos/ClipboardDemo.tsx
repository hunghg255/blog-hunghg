import { useEffect, useMemo, useRef, useState } from 'react';
import {
  allowlistFromToolbar,
  copyText,
  cutMarker,
  decideSmartPaste,
  installObjectClipboard,
  normalizeSingleLine,
  pastePlainText,
  type ToolbarFeature,
} from '../lib/clipboardKit';
import { Log, useLog } from './shared';
import './ClipboardDemo.css';

// ---------- dữ liệu mẫu ----------

const SAMPLE_DOCS_HTML =
  '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">' +
  '<p dir="ltr" style="line-height:1.38"><span style="font-weight:700">Kế hoạch</span><span>\u00a0quý 4</span></p>' +
  '<ul><li><span>Ra mắt </span><a href="https://example.com/launch"><span>trang mới</span></a></li>' +
  '<li onclick="alert(1)"><span style="font-style:italic">Sửa lỗi</span> thanh toán</li></ul>' +
  '<img src="x" onerror="alert(1)"><a href="javascript:alert(1)">link độc</a><script>alert(1)</script></b>';
const SAMPLE_DOCS_TEXT = 'Kế hoạch\u00a0quý 4\nRa mắt trang mới\nSửa lỗi thanh toán';
const SAMPLE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

const FEATURES: { id: ToolbarFeature; label: string }[] = [
  { id: 'bold', label: 'B' },
  { id: 'italic', label: 'I' },
  { id: 'link', label: 'Link' },
  { id: 'list', label: 'List' },
  { id: 'image', label: 'Ảnh' },
];

interface Card {
  id: string;
  title: string;
}
type Columns = Record<'todo' | 'doing', Card[]>;

const cardUrl = (id: string) => `https://board.example/c/${id}`;
const CARD_URL_RE = /^https:\/\/board\.example\/c\/([\w-]+)$/;

// ---------- 1. copy chữ ----------

function CopyTextPanel() {
  const [text, setText] = useState('https://board.example/c/k3x9');
  const [result, setResult] = useState('');
  const copy = async (preferLegacy: boolean) => {
    const method = await copyText(text, { preferLegacy });
    setResult(method === 'failed' ? 'Không copy được' : `Đã copy bằng ${method === 'async-api' ? 'navigator.clipboard' : 'textarea + execCommand'}`);
  };
  return (
    <section className='card cb-panel'>
      <h2>1. Copy chữ: API mới, rơi về cách cũ</h2>
      <div className='toolbar'>
        <input value={text} onChange={(e) => setText(e.target.value)} aria-label='Chữ cần copy' className='cb-grow' />
        <button className='primary' onClick={() => copy(false)}>
          Copy
        </button>
        <button onClick={() => copy(true)}>Copy bằng cách cũ</button>
      </div>
      <p className='hint' data-testid='copy-result'>
        {result || 'Bấm copy rồi dán vào ô bên dưới để kiểm tra.'}
      </p>
      <textarea className='cb-paste-check' rows={2} placeholder='Dán vào đây để kiểm tra (Ctrl/Cmd+V)' aria-label='Ô kiểm tra dán' />
    </section>
  );
}

// ---------- 2. copy/cut thẻ (Trello) ----------

function ObjectClipboardPanel() {
  const [columns, setColumns] = useState<Columns>({
    todo: [
      { id: 'k3x9', title: 'Thiết kế trang giá' },
      { id: 'p7aa', title: 'Viết test thanh toán' },
    ],
    doing: [{ id: 'm2q4', title: 'Sửa lỗi đăng nhập' }],
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<keyof Columns>('doing');
  const [enabled, setEnabled] = useState(true);
  const { lines, add } = useLog(8);
  const stateRef = useRef({ columns, selected, target });
  stateRef.current = { columns, selected, target };

  useEffect(() => {
    if (!enabled) return;
    return installObjectClipboard({
      getValue: () => (stateRef.current.selected ? cardUrl(stateRef.current.selected) : null),
      onCopy: (value) => {
        cutMarker.clear();
        add(`Copy: ${value}`, 'ok');
      },
      onCut: (value) => {
        cutMarker.set(value);
        add(`Cut: ${value} (đã đánh dấu trong localStorage)`, 'warn');
      },
      onPasteImage: (file) => add(`Dán ảnh: ${file.type}, ${Math.round(file.size / 1024)} KB`, 'ok'),
    });
  }, [enabled, add]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain').trim() ?? '';
      const match = CARD_URL_RE.exec(text);
      if (!match) return;
      // đang gõ trong một ô nhập: để ô đó tự xử lý
      const active = document.activeElement as HTMLElement | null;
      if (active && active.dataset.objectClipboard === undefined && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      event.preventDefault();
      const id = match[1];
      const { columns: cols, target: to } = stateRef.current;
      const source = (Object.keys(cols) as (keyof Columns)[]).find((key) => cols[key].some((c) => c.id === id));
      if (!source) return add(`Không tìm thấy thẻ ${id}`, 'err');
      const card = cols[source].find((c) => c.id === id)!;
      const isCut = cutMarker.isCut(text);
      setColumns((prev) => {
        const next: Columns = { todo: [...prev.todo], doing: [...prev.doing] };
        if (isCut) next[source] = next[source].filter((c) => c.id !== id);
        const copy = isCut ? card : { id: `${id}-${Math.random().toString(36).slice(2, 5)}`, title: `${card.title} (bản sao)` };
        next[to] = [...next[to], copy];
        return next;
      });
      add(isCut ? `Chuyển "${card.title}" sang cột ${to === 'todo' ? 'Cần làm' : 'Đang làm'}` : `Nhân bản "${card.title}"`, 'ok');
      // Trello: dán xong 1 giây thì bỏ dấu cut
      setTimeout(() => cutMarker.clear(), 1000);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [add]);

  return (
    <section className='card cb-panel'>
      <h2>2. Copy/cut thẻ không cần bôi đen (Trello)</h2>
      <p className='hint'>
        Bấm chọn một thẻ, nhấn <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>C</kbd> hoặc +<kbd>X</kbd>. Bấm vào tiêu đề cột kia rồi +<kbd>V</kbd>: copy thì nhân bản, cut thì chuyển.
      </p>
      <label className='cb-check'>
        <input type='checkbox' checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Bật mẹo vùng ẩn (tắt đi thì Ctrl+C không copy được gì)
      </label>
      <div className='cb-board'>
        {(Object.keys(columns) as (keyof Columns)[]).map((key) => (
          <div key={key} className={`cb-column${target === key ? ' is-target' : ''}`} data-column={key}>
            <button className='cb-column-title' onClick={() => setTarget(key)} aria-pressed={target === key}>
              {key === 'todo' ? 'Cần làm' : 'Đang làm'} {target === key ? '· dán vào đây' : ''}
            </button>
            {columns[key].map((card) => (
              <button
                key={card.id}
                className={`cb-card${selected === card.id ? ' is-selected' : ''}`}
                onClick={() => setSelected(card.id)}
                aria-pressed={selected === card.id}
                data-card={card.id}
              >
                {card.title}
              </button>
            ))}
          </div>
        ))}
      </div>
      <Log lines={lines} />
    </section>
  );
}

// ---------- 3. dán chữ thuần (Pipedrive) ----------

function PlainPastePanel() {
  const naiveRef = useRef<HTMLDivElement>(null);
  const plainRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState({ naive: '', plain: '' });
  const refresh = () => setHtml({ naive: naiveRef.current?.innerHTML ?? '', plain: plainRef.current?.innerHTML ?? '' });

  const copySample = async () => {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([SAMPLE_DOCS_HTML], { type: 'text/html' }),
          'text/plain': new Blob([SAMPLE_DOCS_TEXT], { type: 'text/plain' }),
        }),
      ]);
    } catch {
      await copyText(SAMPLE_DOCS_TEXT);
    }
  };

  return (
    <section className='card cb-panel'>
      <h2>3. Dán vào ô một dòng: chỉ lấy chữ (Pipedrive)</h2>
      <div className='toolbar'>
        <button onClick={copySample}>Copy một đoạn HTML mẫu</button>
        <button
          onClick={() => {
            if (naiveRef.current) naiveRef.current.innerHTML = '';
            if (plainRef.current) plainRef.current.innerHTML = '';
            refresh();
          }}
        >
          Xoá
        </button>
      </div>
      <div className='split'>
        <div>
          <div className='cb-label'>Mặc định</div>
          <div ref={naiveRef} className='cb-inline' contentEditable suppressContentEditableWarning onInput={refresh} data-testid='naive-inline' />
          <code className='cb-html'>{html.naive || '(trống)'}</code>
        </div>
        <div>
          <div className='cb-label'>pastePlainText</div>
          <div
            ref={plainRef}
            className='cb-inline'
            contentEditable
            suppressContentEditableWarning
            onInput={refresh}
            onPaste={(e) => {
              pastePlainText(e.nativeEvent, normalizeSingleLine);
              refresh();
            }}
            data-testid='plain-inline'
          />
          <code className='cb-html'>{html.plain || '(trống)'}</code>
        </div>
      </div>
    </section>
  );
}

// ---------- 4. dán có kiểm soát (Tribe) ----------

function SmartPastePanel() {
  const editorRef = useRef<HTMLDivElement>(null);
  const [features, setFeatures] = useState<ToolbarFeature[]>(['bold', 'link', 'list']);
  const [output, setOutput] = useState('');
  const [embed, setEmbed] = useState<string | null>(null);
  const allow = useMemo(() => allowlistFromToolbar(features), [features]);

  const insertHtml = (htmlString: string) => {
    const editor = editorRef.current!;
    const selection = document.getSelection();
    let range: Range;
    if (selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
      range = selection.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.deleteContents();
    const fragment = range.createContextualFragment(htmlString);
    const last = fragment.lastChild;
    range.insertNode(fragment);
    if (last) {
      range.setStartAfter(last);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  };

  const handle = (data: { text: string; html: string }) => {
    const selection = document.getSelection();
    const selectedText = selection && editorRef.current?.contains(selection.anchorNode) ? selection.toString() : '';
    const result = decideSmartPaste(data, selectedText, allow);
    if (result.kind === 'link-on-selection') {
      const a = document.createElement('a');
      a.href = result.url;
      a.rel = 'noopener noreferrer';
      a.textContent = result.text;
      insertHtml(a.outerHTML);
      setOutput(`Biến chữ đang chọn thành link:\n${a.outerHTML}`);
    } else if (result.kind === 'embed') {
      setEmbed(result.url);
      setOutput(`URL trần: đề nghị nhúng (embed)\n${result.url}`);
    } else if (result.kind === 'html') {
      insertHtml(result.html);
      setOutput(result.html);
    } else {
      insertHtml(result.text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!));
      setOutput(result.text);
    }
  };

  return (
    <section className='card cb-panel'>
      <h2>4. Dán HTML: chỉ giữ thứ editor hiển thị được (Tribe)</h2>
      <div className='toolbar' role='group' aria-label='Nút trên thanh công cụ'>
        {FEATURES.map((f) => (
          <label key={f.id} className='cb-check'>
            <input
              type='checkbox'
              checked={features.includes(f.id)}
              onChange={(e) => setFeatures((prev) => (e.target.checked ? [...prev, f.id] : prev.filter((x) => x !== f.id)))}
            />{' '}
            {f.label}
          </label>
        ))}
      </div>
      <div className='toolbar'>
        <button onClick={() => handle({ text: SAMPLE_DOCS_TEXT, html: SAMPLE_DOCS_HTML })}>Dán mẫu: HTML từ Google Docs</button>
        <button onClick={() => handle({ text: SAMPLE_URL, html: '' })}>Dán mẫu: URL</button>
        <button
          onClick={() => {
            editorRef.current!.innerHTML = '';
            setOutput('');
            setEmbed(null);
          }}
        >
          Xoá
        </button>
      </div>
      <div
        ref={editorRef}
        className='cb-editor'
        contentEditable
        suppressContentEditableWarning
        data-testid='smart-editor'
        onPaste={(e) => {
          e.preventDefault();
          handle({ text: e.clipboardData.getData('text/plain'), html: e.clipboardData.getData('text/html') });
        }}
      />
      {embed && (
        <div className='cb-embed' data-testid='embed'>
          ▶ Nhúng video từ <b>{new URL(embed).hostname}</b>?{' '}
          <button onClick={() => setEmbed(null)}>Bỏ qua</button>
        </div>
      )}
      <div className='cb-label'>Allowlist: {[...allow.tags].join(', ')}</div>
      <pre className='cb-html' data-testid='smart-output'>
        {output || 'HTML sau khi lọc sẽ hiện ở đây.'}
      </pre>
    </section>
  );
}

export default function ClipboardDemo() {
  return (
    <div className='page clipboard-demo'>
      <h1>Clipboard: copy, cut, dán chữ thuần, dán thông minh</h1>
      <p className='hint'>Bốn mẹo từ Anchor, Trello, Pipedrive và Tribe. Demo dùng clipboard thật của bạn.</p>
      <CopyTextPanel />
      <ObjectClipboardPanel />
      <PlainPastePanel />
      <SmartPastePanel />
    </div>
  );
}
