import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPreviewScheduler, type Preview } from '../lib/waLinkPreview';
import {
  countCodePoints,
  countGraphemes,
  encodeMention,
  findMentionQuery,
  fromWire,
  insertMention,
  MENTION_RE,
  mentionLabel,
  remaining,
  renderStored,
  serializeNode,
  sliceCodePoints,
  toWire,
  ZW,
  type NameOf,
} from '../lib/waMentionInput';
import { Log, Stat, useLog } from './shared';
import './WaMentionInputDemo.css';

const CONTACTS: { jid: string; name: string }[] = [
  { jid: '84901234567@c.us', name: 'An Nguyễn' },
  { jid: '84912345678@c.us', name: 'Bình Trần' },
  { jid: '84987000111@c.us', name: 'Anh Thư 🌸' },
  { jid: '972501234567@c.us', name: 'سارة' },
  { jid: '819012345678@c.us', name: '佐藤 健' },
];
const NAMES = new Map(CONTACTS.map((c) => [c.jid, c.name]));
const nameOf: NameOf = (jid) => NAMES.get(jid);
const STRANGER = '84977555333@c.us';
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

interface Query {
  node: Text;
  at: number;
  caret: number;
  query: string;
}

/** Hiện token zero-width cho người đọc thấy. */
function Visible({ text }: { text: string }) {
  return (
    <code className='wa-mention-raw'>
      {text.split(ZW).map((part, i) => (
        <span key={i}>
          {i > 0 && <mark>ZW</mark>}
          {part}
        </span>
      ))}
    </code>
  );
}

export default function WaMentionInputDemo() {
  const editor = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState(80);
  const [stored, setStored] = useState('');
  const [query, setQuery] = useState<Query | null>(null);
  const [active, setActive] = useState(0);
  const [sent, setSent] = useState<{ body: string; mentionedJids: string[] } | null>(null);
  const [blocked, setBlocked] = useState(0);
  const { lines, add } = useLog(20);
  const maxRef = useRef(max);
  maxRef.current = max;
  const [preview, setPreview] = useState<{ p: Preview | null; state: 'idle' | 'loading' }>({ p: null, state: 'idle' });
  const fetches = useRef(0);
  const previews = useMemo(
    () =>
      createPreviewScheduler({
        fetchPreview: async (url) => {
          fetches.current++;
          await new Promise((r) => setTimeout(r, 400));
          const host = url.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
          return { url, title: host, description: `Trang giả lập cho ${url}` };
        },
        onChange: (p, state) => setPreview({ p, state }),
      }),
    [],
  );

  const matches = query
    ? CONTACTS.filter((c) => fold(c.name).includes(fold(query.query))).slice(0, 5)
    : [];

  const measure = useCallback(() => {
    const el = editor.current!;
    const sel = getSelection();
    const length = countCodePoints(serializeNode(el));
    const selection =
      sel && sel.rangeCount && el.contains(sel.anchorNode)
        ? countCodePoints(serializeNode(sel.getRangeAt(0).cloneContents()))
        : 0;
    return { length, selection, left: remaining(maxRef.current, length, selection) };
  }, []);

  const refresh = useCallback(() => {
    const el = editor.current!;
    const text = serializeNode(el);
    setStored(text);
    previews.onType(text);
    const sel = getSelection();
    const node = sel?.anchorNode;
    if (sel?.isCollapsed && node instanceof Text && el.contains(node)) {
      const hit = findMentionQuery(node.data.slice(0, sel.anchorOffset));
      if (hit) {
        setQuery({ node, at: hit.at, caret: sel.anchorOffset, query: hit.query });
        return;
      }
    }
    setQuery(null);
  }, [previews]);

  useEffect(() => {
    const el = editor.current!;
    const onBeforeInput = (e: InputEvent) => {
      const data = e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak' ? '\n' : e.data;
      if (!e.inputType.startsWith('insert') || !data || e.inputType === 'insertFromPaste') return;
      const { left } = measure();
      if (countCodePoints(data) > left) {
        e.preventDefault();
        setBlocked((b) => b + 1);
        add(`Chặn "${data}": cần ${countCodePoints(data)} code point, còn ${left}`, 'err');
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const { left } = measure();
      const fit = sliceCodePoints(text, left);
      if (fit) document.execCommand('insertText', false, fit);
      previews.onPaste(serializeNode(el));
      if (fit.length < text.length) add(`Dán ${countCodePoints(text)} code point, chỉ vừa ${countCodePoints(fit)}`, 'warn');
    };
    el.addEventListener('beforeinput', onBeforeInput);
    el.addEventListener('paste', onPaste);
    return () => {
      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('paste', onPaste);
    };
  }, [add, measure, previews]);

  function choose(jid: string) {
    if (!query) return;
    const cost = countCodePoints(encodeMention(jid)) + 1 - (query.caret - query.at);
    if (cost > measure().left) {
      add(`Không đủ chỗ cho mention (${cost} code point)`, 'err');
      return;
    }
    insertMention(query.node, query.at, query.caret, jid, nameOf);
    add(`Chèn mention ${nameOf(jid)} → lưu thành ZW${jid}ZW`, 'ok');
    setQuery(null);
    refresh();
  }

  function send() {
    const wire = toWire(serializeNode(editor.current!));
    if (!wire.body.trim()) return;
    setSent(wire);
    previews.cancel();
    renderStored(bubble.current!, fromWire(wire.body, wire.mentionedJids), nameOf);
    add(`Gửi: ${wire.mentionedJids.length} mention`, 'ok');
  }

  function loadDraft(withStranger: boolean) {
    const draft = withStranger
      ? `Hỏi ${encodeMention(STRANGER)} xem đã nhận chưa`
      : `Chào ${encodeMention(CONTACTS[0].jid)} và ${encodeMention(CONTACTS[3].jid)} nhé`;
    renderStored(editor.current!, draft, nameOf);
    refresh();
    add(withStranger ? 'Khôi phục bản nháp có số không trong danh bạ' : 'Khôi phục bản nháp', 'muted');
  }

  const length = countCodePoints(stored);
  const wa2020 = stored.replace(/\u200B(\d+@c\.us)\u200B/g, (all, jid: string) => (NAMES.has(jid) ? all : jid));

  return (
    <div className='page wa-mention'>
      <h1>Mention bằng token zero-width</h1>
      <p className='hint'>
        Gõ <code>@an</code>, <code>@s</code>… rồi chọn bằng ↑ ↓ Enter hoặc bấm chuột. Mention là một khối: Backspace xoá
        cả khối. Giới hạn tính bằng code point của <b>dạng lưu</b>, nên một mention tốn ~19 code point dù chỉ hiện vài chữ. Gõ hoặc dán một link để thấy xem trước sau 0,7 giây.
      </p>
      <div className='toolbar'>
        <label>
          Giới hạn{' '}
          <select value={max} onChange={(e) => setMax(Number(e.target.value))}>
            {[30, 80, 200].map((n) => (
              <option key={n} value={n}>
                {n} code point
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => loadDraft(false)}>Khôi phục bản nháp</button>
        <button onClick={() => loadDraft(true)}>Bản nháp có số lạ</button>
      </div>
      {(preview.p || preview.state === 'loading') && (
        <div className='wa-mention-preview' data-testid='preview'>
          {preview.p ? (
            <>
              <div>
                <b>{preview.p.title}</b>
                <span className='muted'>{preview.p.description}</span>
              </div>
              <button aria-label='Bỏ xem trước' onClick={() => previews.dismiss()}>
                ✕
              </button>
            </>
          ) : (
            <span className='muted'>Đang lấy xem trước…</span>
          )}
        </div>
      )}
      <div className='wa-mention-wrap'>
        <div
          ref={editor}
          className='wa-mention-editor'
          data-testid='editor'
          contentEditable
          suppressContentEditableWarning
          role='textbox'
          aria-multiline='true'
          onInput={refresh}
          onKeyUp={(e) => e.key.startsWith('Arrow') && !query && refresh()}
          onClick={refresh}
          onKeyDown={(e) => {
            if (query && matches.length) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                choose(matches[Math.min(active, matches.length - 1)].jid);
                return;
              }
              if (e.key === 'Escape') return setQuery(null);
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {query && matches.length > 0 && (
          <ul className='wa-mention-menu' role='listbox' data-testid='menu'>
            {matches.map((c, i) => (
              <li
                key={c.jid}
                role='option'
                aria-selected={i === active}
                className={i === active ? 'active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(c.jid);
                }}
              >
                <bdi>{c.name}</bdi> <span className='muted'>+{c.jid.split('@')[0]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className='stats'>
        <Stat label={`code point / ${max}`} value={<output data-testid='cp'>{length}</output>} />
        <Stat
          label='grapheme thấy được'
          value={countGraphemes(stored.replace(MENTION_RE, (_, jid: string) => '@' + mentionLabel(jid, nameOf)))}
        />
        <Stat label='UTF-16 (.length)' value={stored.length} />
        <Stat label='lần chặn vì quá giới hạn' value={blocked} />
        <Stat label='lần gọi xem trước link' value={fetches.current} />
      </div>
      <div className='wa-mention-grid'>
        <div className='card'>
          <b>Dạng lưu (bản nháp)</b>
          <Visible text={stored || ' '} />
          {wa2020 !== stored && (
            <>
              <b className='err'>Parser 2020 với số lạ trả lại</b>
              <Visible text={wa2020} />
              <span className='muted'>→ gửi đi mất mention: {JSON.stringify(toWire(wa2020).mentionedJids)}</span>
            </>
          )}
        </div>
        <div className='card'>
          <b>Gửi đi (Enter)</b>
          {sent ? (
            <>
              <code data-testid='wire'>{sent.body}</code>
              <span className='muted'>mentionedJids: {JSON.stringify(sent.mentionedJids)}</span>
              <b>Bên nhận hiển thị</b>
            </>
          ) : (
            <span className='muted'>Chưa gửi</span>
          )}
          <div ref={bubble} className='wa-mention-bubble' data-testid='bubble' hidden={!sent} />
        </div>
      </div>
      <Log lines={lines} />
    </div>
  );
}
