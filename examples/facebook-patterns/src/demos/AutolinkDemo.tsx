import { useMemo, useState } from 'react';
import {
  checkLatex,
  endsWithHashTrigger,
  endsWithHashTriggerFbStyle,
  findUrls,
  findUrlsNaive,
  linkify,
  maxBraceDepth,
  safeCutoff,
  type UrlMatch,
} from '../lib/autolink';
import './AutolinkDemo.css';

const SAMPLE =
  'Đọc thêm (xem https://en.wikipedia.org/wiki/Mercury_(planet)), hoặc www.example.com/a?q=1. Ảnh: https://example.com/👋/photo.jpg! Cuối câu là https://example.com/path.';

const LATEX_PRESETS = [
  { label: 'Bình thường', tex: '\\frac{a}{b} + \\sqrt{x^{2}}' },
  { label: 'Lồng 25 bậc', tex: '{'.repeat(25) + 'x' + '}'.repeat(25) },
  { label: '} thừa ở đầu', tex: '}'.repeat(6) + '{'.repeat(24) + 'x' + '}'.repeat(24) },
  { label: '\\begin lồng', tex: '\\begin{matrix}\\begin{matrix}{{x}}\\end{matrix}\\end{matrix}' },
];

/** đếm độ sâu như bản gốc: } thừa kéo bộ đếm xuống âm */
function maxBraceDepthFbStyle(tex: string): number {
  let depth = 0;
  let max = 0;
  for (let i = 0; i < tex.length; i++) {
    const ch = tex[i];
    if (ch === '\\') {
      if (tex.startsWith('\\begin', i)) max = Math.max(max, (depth += 2));
      else if (tex.startsWith('\\end', i)) depth -= 2;
      else i++;
    } else if (ch === '{') max = Math.max(max, ++depth);
    else if (ch === '}') depth--;
  }
  return max;
}

function Linked({ text, matches }: { text: string; matches: UrlMatch[] }) {
  return (
    <p className='al-text'>
      {linkify(text, matches).map((s, i) =>
        s.kind === 'link' ? (
          <a key={i} href={s.href} target='_blank' rel='noopener noreferrer' className='al-link'>
            {s.text}
          </a>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}

export default function AutolinkDemo() {
  const [text, setText] = useState(SAMPLE);
  const [limit, setLimit] = useState(60);
  const [tex, setTex] = useState(LATEX_PRESETS[1].tex);
  const [tag, setTag] = useState('Hôm nay đi chơi ＃');

  const naive = useMemo(() => findUrlsNaive(text), [text]);
  const balanced = useMemo(() => findUrls(text), [text]);
  const cut = safeCutoff(text, limit);
  const latex = checkLatex(tex);
  const fbDepth = maxBraceDepthFbStyle(tex);

  return (
    <div className='page autolink'>
      <h1>Auto-link, cắt chữ an toàn, giới hạn LaTeX</h1>
      <p className='hint'>
        Sửa đoạn văn bên dưới. Cách “lấy tới khoảng trắng” nuốt cả <code>)</code>, <code>.</code>, <code>!</code> của câu văn;
        cách đếm ngoặc cân bằng giữ <code>(planet)</code> nhưng bỏ dấu câu cuối.
      </p>

      <textarea className='al-input' value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label='Đoạn văn' />

      <div className='al-cols'>
        <section className='card'>
          <h2>Tới khoảng trắng</h2>
          <Linked text={text} matches={naive} />
          <ul className='al-list' data-testid='naive-list'>
            {naive.map((m) => (
              <li key={m.start}>
                <code>{m.url}</code>
              </li>
            ))}
          </ul>
        </section>
        <section className='card'>
          <h2>Ngoặc cân bằng</h2>
          <Linked text={text} matches={balanced} />
          <ul className='al-list' data-testid='balanced-list'>
            {balanced.map((m) => (
              <li key={m.start}>
                <code>{m.url}</code>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <h2>“Xem thêm” ở ký tự thứ {limit}</h2>
      <input
        type='range'
        min={1}
        max={Math.max(1, text.length - 1)}
        value={Math.min(limit, text.length - 1)}
        onChange={(e) => setLimit(Number(e.target.value))}
        aria-label='Vị trí cắt'
        className='al-range'
      />
      <div className='al-cols'>
        <section className='card'>
          <h2>slice(0, {limit})</h2>
          <p className='al-text'>
            {text.slice(0, limit)}
            <span className='muted'>… Xem thêm</span>
          </p>
        </section>
        <section className='card'>
          <h2>safeCutoff → {cut}</h2>
          <Linked text={text.slice(0, cut)} matches={findUrls(text.slice(0, cut))} />
          <p className='muted'>{cut < limit ? `lùi ${limit - cut} ký tự để không chặt URL/emoji` : 'không cần lùi'}</p>
        </section>
      </div>

      <h2>LaTeX: độ dài ≤ 1000, lồng ≤ 20</h2>
      <div className='toolbar'>
        {LATEX_PRESETS.map((p) => (
          <button key={p.label} onClick={() => setTex(p.tex)} className={tex === p.tex ? 'primary' : ''}>
            {p.label}
          </button>
        ))}
      </div>
      <input type='text' value={tex} onChange={(e) => setTex(e.target.value)} aria-label='Công thức LaTeX' />
      <div className='stats al-stats'>
        <div className='stat'>
          <b>
            <bdi data-testid='depth'>{maxBraceDepth(tex)}</bdi>
          </b>
          <span>độ sâu (bản viết lại)</span>
        </div>
        <div className='stat'>
          <b>
            <bdi data-testid='depth-fb'>{fbDepth}</bdi>
          </b>
          <span>độ sâu (đếm như bản gốc)</span>
        </div>
        <div className='stat'>
          <b className={latex.ok ? 'ok' : 'err'}>
            <bdi data-testid='latex-verdict'>{latex.ok ? 'render' : 'chặn'}</bdi>
          </b>
          <span>{latex.reason ?? 'trong giới hạn'}</span>
        </div>
      </div>

      <h2>Gõ dấu # để mở gợi ý hashtag</h2>
      <input type='text' value={tag} onChange={(e) => setTag(e.target.value)} aria-label='Ô soạn bài' />
      <div className='toolbar al-hash'>
        <button onClick={() => setTag((t) => t + '#')}>thêm #</button>
        <button onClick={() => setTag((t) => t + '＃')}>thêm ＃ (U+FF03)</button>
        <span>
          <code>'\uFF03'</code>:{' '}
          <b className={endsWithHashTrigger(tag) ? 'ok' : 'muted'} data-testid='hash-fixed'>
            {endsWithHashTrigger(tag) ? 'mở gợi ý' : 'không'}
          </b>
        </span>
        <span>
          <code>'\\uFF03'</code> (bản gốc):{' '}
          <b className={endsWithHashTriggerFbStyle(tag) ? 'ok' : 'err'} data-testid='hash-fb'>
            {endsWithHashTriggerFbStyle(tag) ? 'mở gợi ý' : 'không'}
          </b>
        </span>
      </div>
    </div>
  );
}
