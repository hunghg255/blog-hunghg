import { useMemo, useState } from 'react';
import {
  countEmojiNaive,
  emojiImageKey,
  parseEmoji,
  parseEmojiIntl,
  renderEmoji,
  skinToneVariants,
} from '../lib/emojiSegment';
import { Stat } from './shared';
import './EmojiSegmentDemo.css';

const SAMPLES = [
  'Code xong rồi 👩🏽‍💻🎉 gửi team 🇻🇳',
  'Mã đơn #1 và 1️⃣ không giống nhau',
  'Cờ Scotland 🏴󠁧󠁢󠁳󠁣󠁴󠁿 và gia đình 👨‍👩‍👧‍👦',
  'Like 👍🏿 👍🏻, tim ❤️ và ❤︎ (dạng chữ)',
  'Không có emoji nào ở đây: © 2026',
];

export default function EmojiSegmentDemo() {
  const [text, setText] = useState(SAMPLES[0]);
  const fb = useMemo(() => parseEmoji(text), [text]);
  const intl = useMemo(() => parseEmojiIntl(text), [text]);
  const naive = useMemo(() => countEmojiNaive(text), [text]);
  const same =
    intl !== null &&
    intl.length === fb.length &&
    intl.every((m, i) => m.offset === fb[i].offset && m.length === fb[i].length);
  const rendered = useMemo(
    () =>
      renderEmoji(text, (m) => (
        <span className='es-chip' title={emojiImageKey(m)} key={m.offset}>
          {text.slice(m.offset, m.offset + m.length)}
        </span>
      )),
    [text],
  );

  return (
    <div className='page'>
      <h1>Tách cụm emoji bằng máy trạng thái</h1>
      <p className='hint'>
        Gõ hoặc chọn mẫu. Mỗi cụm được bọc khung (thay chỗ này bằng <code>&lt;img&gt;</code> là ra cách Facebook vẽ emoji
        đồng bộ trên mọi máy). Rê chuột lên cụm để xem khoá ảnh dạng hex.
      </p>
      <div className='toolbar'>
        {SAMPLES.map((s, i) => (
          <button key={i} onClick={() => setText(s)}>
            Mẫu {i + 1}
          </button>
        ))}
      </div>
      <textarea
        className='es-input'
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        aria-label='Văn bản'
      />
      <div className='stats'>
        <Stat label='máy trạng thái' value={<output data-testid='es-fb'>{fb.length}</output>} />
        <Stat label='Intl.Segmenter' value={<output data-testid='es-intl'>{intl ? intl.length : 'không có'}</output>} />
        <Stat label='đếm \p{Emoji} từng ký tự' value={<output data-testid='es-naive'>{naive}</output>} />
        <Stat label='hai cách khớp offset' value={<output data-testid='es-same'>{intl ? (same ? 'khớp' : 'lệch') : '—'}</output>} />
      </div>
      <div className='card es-render' data-testid='es-render'>
        {rendered}
      </div>
      <table className='es-table'>
        <thead>
          <tr>
            <th>Cụm</th>
            <th>offset/len</th>
            <th>Code point</th>
            <th>Màu da</th>
          </tr>
        </thead>
        <tbody>
          {fb.map((m) => (
            <tr key={m.offset}>
              <td className='es-big'>{text.slice(m.offset, m.offset + m.length)}</td>
              <td>
                {m.offset}/{m.length}
              </td>
              <td className='es-mono'>{emojiImageKey(m)}</td>
              <td>{skinToneVariants(m.parts[0]).join(' ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
