import { useState } from 'react';
import {
  countText,
  cpLength,
  cpSlice,
  emojiOnly,
  parseMentions,
  redditRanges,
  urlRanges,
  type TextRange,
} from '../lib/textOffsets';
import {
  legacyEmojiOnly,
  legacyParseMentions,
  legacyRedditRanges,
  legacyUrlRanges,
} from '../lib/textOffsetsLegacy';
import { Stat } from './shared';
import './CodepointOffsetDemo.css';

const SAMPLE =
  'Chúc mừng 🎉🎉 @[100:Anna 🌸 Lee] và @[7:Bob \\] Jr] đã vào r/vietnam và u/spez, xem a.com và docs.example.com 😀';

type Kind = 'mention' | 'reddit' | 'url';
interface Tagged {
  kind: Kind;
  range: TextRange;
}

function analyse(markup: string, legacy: boolean) {
  const { text, ranges } = legacy ? legacyParseMentions(markup) : parseMentions(markup);
  const reddit = legacy ? legacyRedditRanges(text) : redditRanges(text);
  const urls = legacy ? legacyUrlRanges(text) : urlRanges(text);
  const all: Tagged[] = [
    ...ranges.map((range) => ({ kind: 'mention' as const, range })),
    ...reddit.map((range) => ({ kind: 'reddit' as const, range })),
    ...urls.map((range) => ({ kind: 'url' as const, range })),
  ];
  return { text, all };
}

/** Tô màu theo code point: đúng cách mà Draft.js / server hiểu offset. */
function Highlighted({ text, all }: { text: string; all: Tagged[] }) {
  const cps = Array.from(text);
  const kinds: (Kind | undefined)[] = cps.map(() => undefined);
  for (const t of all)
    for (let i = t.range.offset; i < t.range.offset + t.range.length && i < cps.length; i++) kinds[i] = t.kind;
  const parts: { kind?: Kind; s: string }[] = [];
  cps.forEach((c, i) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kinds[i]) last.s += c;
    else parts.push({ kind: kinds[i], s: c });
  });
  return (
    <p className='co-text'>
      {parts.map((p, i) =>
        p.kind ? (
          <mark key={i} className={`co-${p.kind}`}>
            {p.s}
          </mark>
        ) : (
          <span key={i}>{p.s}</span>
        ),
      )}
    </p>
  );
}

function Column({ title, markup, legacy }: { title: string; markup: string; legacy: boolean }) {
  const { text, all } = analyse(markup, legacy);
  const len = cpLength(text);
  return (
    <div className='card co-col' data-testid={legacy ? 'legacy' : 'fixed'}>
      <b>{title}</b>
      <Highlighted text={text} all={all} />
      <table className='co-table'>
        <thead>
          <tr>
            <th>loại</th>
            <th>offset</th>
            <th>dài</th>
            <th>cắt theo code point</th>
          </tr>
        </thead>
        <tbody>
          {all.map((t, i) => {
            const ghost = t.range.offset >= len;
            return (
              <tr key={i} className={ghost ? 'err' : ''} data-testid='range'>
                <td>{t.kind}</td>
                <td>{t.range.offset}</td>
                <td>{t.range.length}</td>
                <td>{ghost ? 'ngoài chuỗi!' : JSON.stringify(cpSlice(text, t.range.offset, t.range.length))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const EMOJI_SAMPLES = [':) 😀', '😀 :)', '👨‍👩‍👧 🇻🇳 1️⃣', 'ok 👍'];

export default function CodepointOffsetDemo() {
  const [markup, setMarkup] = useState(SAMPLE);
  const [msg, setMsg] = useState('😀 :)');
  const parsed = parseMentions(markup).text;
  const c = countText(parsed);
  const fixedEmoji = emojiOnly(msg, 6);
  const legacyJumbo = legacyEmojiOnly(msg);

  return (
    <div className='page co-demo'>
      <h1>Offset theo code point hay UTF-16</h1>
      <p className='hint'>
        Markup <code>@[uid:Tên]</code> được đổi thành chữ thường kèm range; sau đó tìm link{' '}
        <code>r/…</code>, <code>u/…</code> và URL. Mọi range đếm theo code point. Thêm emoji vào trước
        các link để thấy bản gốc lệch dần, rồi sinh range "ma" nằm ngoài chuỗi.
      </p>
      <textarea
        className='co-input'
        value={markup}
        onChange={(e) => setMarkup(e.target.value)}
        rows={3}
        data-testid='input'
      />
      <div className='toolbar'>
        <button onClick={() => setMarkup('🔥🔥🔥🔥 ' + markup)} data-testid='add-emoji'>
          Thêm 🔥🔥🔥🔥 vào đầu
        </button>
        <button onClick={() => setMarkup(SAMPLE)}>Mẫu ban đầu</button>
      </div>
      <div className='stats'>
        <Stat label='.length (UTF-16)' value={<output data-testid='utf16'>{c.utf16}</output>} />
        <Stat label='code point' value={<output data-testid='cp'>{c.codePoints}</output>} />
        <Stat label='grapheme (mắt người thấy)' value={<output data-testid='gr'>{c.graphemes}</output>} />
      </div>
      <div className='co-cols'>
        <Column title='Bản gốc' markup={markup} legacy />
        <Column title='Bản viết lại' markup={markup} legacy={false} />
      </div>

      <div className='card co-emoji'>
        <h2>Tin chỉ có emoji thì hiện cỡ lớn</h2>
        <div className='toolbar'>
          {EMOJI_SAMPLES.map((s) => (
            <button key={s} onClick={() => setMsg(s)}>
              {s}
            </button>
          ))}
        </div>
        <input value={msg} onChange={(e) => setMsg(e.target.value)} className='co-msg' data-testid='msg' />
        <div className='co-bubbles'>
          <div>
            <small>Bản gốc</small>
            <div className={`co-bubble ${legacyJumbo ? 'jumbo' : ''}`} data-testid='legacy-jumbo'>
              {msg}
            </div>
          </div>
          <div>
            <small>Bản viết lại</small>
            <div className={`co-bubble ${fixedEmoji ? 'jumbo' : ''}`} data-testid='fixed-jumbo'>
              {fixedEmoji ? fixedEmoji.join(' ') : msg}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
