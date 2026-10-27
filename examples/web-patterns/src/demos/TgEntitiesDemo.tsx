import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FIXED_ITALIC_RE,
  ORIGINAL_ITALIC_RE,
  applyQuickMarkdown,
  createDraftStore,
  getToolbarAnchor,
  isSelectionInside,
  parseEditorHtml,
  renderFormattedHtml,
  type FormattedText,
} from '../lib/tgEntities';
import { Log, useLog } from './shared';
import './TgEntitiesDemo.css';

const CHATS = ['Mẹ', 'Nhóm dự án', 'Lan'];
const DEBOUNCE_MS = 1500;

type Format = 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'code';
const BUTTONS: { cmd: Format; label: string; title: string }[] = [
  { cmd: 'bold', label: 'B', title: 'Đậm (⌘B)' },
  { cmd: 'italic', label: 'I', title: 'Nghiêng (⌘I)' },
  { cmd: 'underline', label: 'U', title: 'Gạch chân (⌘U)' },
  { cmd: 'strikeThrough', label: 'S', title: 'Gạch ngang (⌘⇧X)' },
  { cmd: 'code', label: '</>', title: 'Monospace (⌘⇧M)' },
];

const EMPTY: FormattedText = { text: '', entities: [] };

export default function TgEntitiesDemo() {
  const inputRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [chat, setChat] = useState(CHATS[0]);
  const chatRef = useRef(chat);
  const [formatted, setFormatted] = useState<FormattedText>(EMPTY);
  const [anchor, setAnchor] = useState<{ x: number; y: number }>();
  const [guarded, setGuarded] = useState(true);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const log = useLog(20);

  const onSave = useCallback(
    (chatId: string, draft: FormattedText | undefined) => {
      setSaved((prev) => ({ ...prev, [chatId]: draft?.text ?? '' }));
      log.add(`lưu nháp "${chatId}": ${draft ? JSON.stringify(draft.text) : '(xoá)'}`, 'ok');
    },
    [log],
  );

  // Bản có kiểm tra chat (giống useDraft của Telegram)
  const store = useMemo(() => createDraftStore(onSave, DEBOUNCE_MS), [onSave]);
  // Bản ngây thơ: callback debounce đọc chat HIỆN TẠI lúc chạy, không phải chat lúc gõ
  const naiveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drafts = useRef(new Map<string, FormattedText>());

  useEffect(() => () => store.dispose(), [store]);
  useEffect(() => {
    store.setActiveChat(chat);
    chatRef.current = chat;
  }, [chat, store]);

  const readInput = useCallback(() => parseEditorHtml(inputRef.current!), []);

  const handleInput = () => {
    const el = inputRef.current!;
    // Markdown nhanh: chỉ áp khi người dùng vừa gõ xong cặp ký hiệu
    const plain = el.innerHTML;
    const converted = applyQuickMarkdown(plain);
    if (converted !== plain) {
      // thêm một zero-width space sau thẻ vừa tạo để con trỏ ra NGOÀI <b>, gõ tiếp không bị đậm
      el.innerHTML = `${converted}\u200b`;
      placeCaretAtEnd(el);
    }
    const next = readInput();
    setFormatted(next);
    drafts.current.set(chat, next);

    if (guarded) {
      store.change(chat, next);
    } else {
      clearTimeout(naiveTimer.current);
      if (next.text.length === 0) {
        onSave(chat, undefined);
        return;
      }
      naiveTimer.current = setTimeout(() => {
        // BUG cố ý: lưu vào chat đang mở lúc timer chạy
        onSave(chatRef.current, next);
      }, DEBOUNCE_MS);
    }
  };

  const switchChat = (next: string) => {
    if (next === chat) return;
    const current = readInput();
    if (guarded) store.flush(chat, current);
    setChat(next);
    const draft = drafts.current.get(next) ?? EMPTY;
    inputRef.current!.innerHTML = renderFormattedHtml(draft);
    setFormatted(draft);
    setAnchor(undefined);
    log.add(`chuyển sang "${next}"`, 'muted');
  };

  // ---- thanh định dạng nổi ----
  const updateToolbar = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setAnchor(undefined);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!isSelectionInside(range, inputRef.current!) || !sel.toString().trim()) {
      setAnchor(undefined);
      return;
    }
    setAnchor(getToolbarAnchor(range.getBoundingClientRect(), wrapRef.current!.getBoundingClientRect()));
  };

  const applyFormat = (cmd: Format) => {
    if (cmd === 'code') {
      const text = window.getSelection()?.toString() ?? '';
      // innerText → innerHTML: mẹo escape của bản gốc, ở đây dùng textContent cho rõ
      const tmp = document.createElement('div');
      tmp.textContent = text;
      document.execCommand('insertHTML', false, `<code>${tmp.innerHTML}</code>`);
    } else {
      document.execCommand(cmd);
    }
    handleInput();
    updateToolbar();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    const map: Record<string, Format> = { b: 'bold', i: 'italic', u: 'underline' };
    const cmd = e.shiftKey ? (key === 'x' ? 'strikeThrough' : key === 'm' ? 'code' : undefined) : map[key];
    if (cmd) {
      e.preventDefault();
      applyFormat(cmd);
    }
  };

  // ---- so sánh regex `__` ----
  const [sample, setSample] = useState('__a__ và __b__, rồi __x*y__');
  const escapedSample = escapeText(sample);
  const original = applyQuickMarkdown(escapedSample, ORIGINAL_ITALIC_RE);
  const fixed = applyQuickMarkdown(escapedSample, FIXED_ITALIC_RE);

  return (
    <div className='page tg-entities'>
      <h1>Telegram #15: rich text ⇄ entities</h1>
      <p className='hint'>
        Gõ vào ô bên dưới, bôi đen chữ để hiện thanh định dạng (hoặc ⌘B/⌘I/⌘U, ⌘⇧X, ⌘⇧M). Gõ <code>**đậm**</code>,{' '}
        <code>__nghiêng__</code>, <code>~~gạch~~</code>, <code>`code`</code> để thử markdown nhanh. Kết quả bên phải là thứ
        thật sự được gửi lên server: chữ thuần và danh sách entity.
      </p>

      <div className='toolbar' role='tablist' aria-label='Chat'>
        {CHATS.map((c) => (
          <button key={c} role='tab' aria-selected={c === chat} className={c === chat ? 'primary' : ''} onClick={() => switchChat(c)}>
            {c}
            {saved[c] ? ' ✎' : ''}
          </button>
        ))}
        <label className='tge-check'>
          <input type='checkbox' checked={guarded} onChange={(e) => setGuarded(e.target.checked)} /> Debounce có kiểm tra chat
        </label>
      </div>

      <div className='split'>
        <div className='card tge-editor-wrap' ref={wrapRef}>
          {anchor && (
            <div className='tge-bubble' style={{ left: anchor.x, top: anchor.y }} role='toolbar' aria-label='Định dạng'>
              {BUTTONS.map((b) => (
                <button key={b.cmd} title={b.title} onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormat(b.cmd)}>
                  {b.label}
                </button>
              ))}
            </div>
          )}
          <div
            ref={inputRef}
            className='tge-input'
            contentEditable
            suppressContentEditableWarning
            role='textbox'
            aria-multiline='true'
            aria-label='Soạn tin'
            data-placeholder={`Nhắn cho ${chat}…`}
            onInput={handleInput}
            onMouseUp={updateToolbar}
            onKeyUp={updateToolbar}
            onKeyDown={onKeyDown}
            onBlur={() => setTimeout(() => setAnchor(undefined), 150)}
          />
          <div className='tge-label'>Hiển thị lại từ entities</div>
          <div className='tge-preview' dangerouslySetInnerHTML={{ __html: renderFormattedHtml(formatted) || '<span class="muted">(trống)</span>' }} />
        </div>
        <div className='card'>
          <div className='tge-label'>Gửi lên server</div>
          <pre className='tge-json'>{JSON.stringify(formatted, null, 1)}</pre>
        </div>
      </div>

      <h2>Nháp theo chat</h2>
      <p className='hint'>
        Gõ vài chữ trong <b>Mẹ</b> rồi chuyển ngay sang <b>Nhóm dự án</b> (trong vòng {DEBOUNCE_MS / 1000}s). Bỏ chọn ô
        &quot;có kiểm tra chat&quot; để thấy nháp của Mẹ bị lưu nhầm sang nhóm.
      </p>
      <div className='stats'>
        {CHATS.map((c) => (
          <div className='stat' key={c}>
            <b>{saved[c] ? JSON.stringify(saved[c]) : '—'}</b>
            <span>nháp đã lưu: {c}</span>
          </div>
        ))}
      </div>
      <Log lines={log.lines} />

      <h2>Bug regex <code>__</code> của bản gốc</h2>
      <input className='tge-sample' value={sample} onChange={(e) => setSample(e.target.value)} aria-label='Chuỗi thử' />
      <div className='split'>
        <div className='card'>
          <div className='tge-label err'>Bản gốc: <code>[_]{'{2}'}([^*\n]+)[_]{'{2}'}</code></div>
          <div className='tge-preview' dangerouslySetInnerHTML={{ __html: original }} />
          <code className='tge-raw'>{original}</code>
        </div>
        <div className='card'>
          <div className='tge-label ok'>Đã sửa: <code>_{'{2}'}([^_\n]+)_{'{2}'}</code></div>
          <div className='tge-preview' dangerouslySetInnerHTML={{ __html: fixed }} />
          <code className='tge-raw'>{fixed}</code>
        </div>
      </div>
    </div>
  );
}

function escapeText(s: string) {
  const tmp = document.createElement('div');
  tmp.textContent = s;
  return tmp.innerHTML;
}

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}
