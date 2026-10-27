import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { metaFont, metaSafeAreaVars, measureTextWidth } from '../lib/tgBubbleMeta';
import '../lib/tgBubbleMeta.css';
import './TgBubbleMetaDemo.css';

const SAMPLE =
  'Tối nay 8 giờ họp nhóm nhé, nhớ mang theo laptop và bản thiết kế mới. Ai đến muộn thì mua trà sữa cho cả nhóm 😄';

type Mode = 'overlap' | 'newline' | 'float' | 'spacer';

const MODES: { mode: Mode; title: string; note: string }[] = [
  { mode: 'overlap', title: 'Ngây thơ 1: meta absolute', note: 'không giữ chỗ → đè lên chữ' },
  { mode: 'newline', title: 'Ngây thơ 2: meta xuống dòng', note: 'luôn tốn thêm một dòng' },
  { mode: 'float', title: 'Telegram: float trong đoạn text', note: 'không cần JS' },
  { mode: 'spacer', title: 'Telegram: ::after giữ chỗ', note: 'meta absolute + CSS var' },
];

interface Measure {
  overlap: boolean;
  lines: number;
  height: number;
}

/** Meta có đè lên chữ không: so hình chữ nhật của từng dòng chữ với hình chữ nhật của meta. */
function measureBubble(bubble: HTMLElement): Measure {
  const text = bubble.querySelector('.tgb-text');
  const meta = bubble.querySelector<HTMLElement>('.tgb-meta');
  const textNode = text?.firstChild;
  if (!text || !meta || !textNode) return { overlap: false, lines: 0, height: 0 };
  const range = document.createRange();
  range.selectNodeContents(textNode);
  const rects = [...range.getClientRects()].filter((r) => r.width > 0);
  const m = meta.getBoundingClientRect();
  const overlap = rects.some((r) => r.left < m.right - 1 && r.right > m.left + 1 && r.top < m.bottom - 1 && r.bottom > m.top + 1);
  const lineTops = new Set(rects.map((r) => Math.round(r.top)));
  return { overlap, lines: lineTops.size, height: Math.round(bubble.getBoundingClientRect().height) };
}

export default function TgBubbleMetaDemo() {
  const [length, setLength] = useState(38);
  const [width, setWidth] = useState(300);
  const [own, setOwn] = useState(true);
  const [hasViews, setHasViews] = useState(false);
  const [wasEdited, setWasEdited] = useState(false);
  const [signature, setSignature] = useState('');
  const [measures, setMeasures] = useState<Record<Mode, Measure | undefined>>({} as never);
  const refs = useRef<Record<Mode, HTMLDivElement | null>>({} as never);
  const sigRef = useRef<HTMLSpanElement>(null);

  const text = SAMPLE.slice(0, length).trimEnd() || '…';
  const sigFont = sigRef.current ? metaFont(sigRef.current) : '400 12px system-ui, sans-serif';
  const authorWidth = signature ? measureTextWidth(signature, sigFont) + 6 : 0;
  const vars = metaSafeAreaVars({ own, hasViews, wasEdited, authorWidth });

  useLayoutEffect(() => {
    const next = {} as Record<Mode, Measure>;
    for (const { mode } of MODES) {
      const el = refs.current[mode];
      if (el) next[mode] = measureBubble(el);
    }
    setMeasures(next);
  }, [text, width, own, hasViews, wasEdited, signature]);

  const meta = (
    <span className='tgb-meta'>
      {signature && (
        <span className='tgb-signature' ref={sigRef}>
          {signature}
        </span>
      )}
      {hasViews && <span>👁 1,2K</span>}
      {wasEdited && <span>đã sửa</span>}
      <span>21:07</span>
      {own && <span className='tgbm-ticks'>✓✓</span>}
    </span>
  );

  return (
    <div className='page tgbm'>
      <h1>Giờ gửi nằm gọn trong bong bóng chat</h1>
      <p className='hint'>
        Kéo độ dài tin nhắn: dòng cuối còn chỗ thì giờ gửi đứng cùng dòng, hết chỗ thì tự xuống dòng mới. Bốn bong bóng
        dưới đây cùng nội dung, chỉ khác cách đặt meta.
      </p>

      <div className='tgbm-controls'>
        <label>
          Độ dài tin ({length} ký tự)
          <input type='range' min={1} max={SAMPLE.length} value={length} onChange={(e) => setLength(+e.target.value)} />
        </label>
        <label>
          Bề rộng bong bóng ({width}px)
          <input type='range' min={160} max={420} value={width} onChange={(e) => setWidth(+e.target.value)} />
        </label>
        <div className='toolbar'>
          <label>
            <input type='checkbox' checked={own} onChange={(e) => setOwn(e.target.checked)} /> Tin của mình (✓✓)
          </label>
          <label>
            <input type='checkbox' checked={hasViews} onChange={(e) => setHasViews(e.target.checked)} /> Lượt xem
          </label>
          <label>
            <input type='checkbox' checked={wasEdited} onChange={(e) => setWasEdited(e.target.checked)} /> Đã sửa
          </label>
          <label className='tgbm-sig'>
            Chữ ký
            <input value={signature} placeholder='vd: Admin <b>' onChange={(e) => setSignature(e.target.value)} />
          </label>
        </div>
      </div>

      <div className='tgbm-grid'>
        {MODES.map(({ mode, title, note }) => {
          const m = measures[mode];
          const style = { ...vars, maxWidth: width } as CSSProperties;
          return (
            <section key={mode} className='tgbm-case'>
              <h2>{title}</h2>
              <p className='muted'>{note}</p>
              <div
                ref={(el) => {
                  refs.current[mode] = el;
                }}
                data-mode={mode}
                className={`tgb-bubble ${own ? 'tgbm-own' : 'tgbm-other'} ${mode === 'spacer' ? 'tgb-bubble--spacer' : ''} tgbm-${mode}`}
                style={style}
              >
                {mode === 'float' ? (
                  <p className='tgb-text'>
                    {text}
                    {meta}
                  </p>
                ) : (
                  <>
                    <p className='tgb-text'>{text}</p>
                    {meta}
                  </>
                )}
              </div>
              {m && (
                <p className='tgbm-measure' data-testid={`measure-${mode}`}>
                  <span className={m.overlap ? 'err' : 'ok'}>{m.overlap ? 'đè lên chữ' : 'không đè'}</span>
                  {' · '}
                  {m.lines} dòng chữ · cao {m.height}px
                </p>
              )}
            </section>
          );
        })}
      </div>

      <SignatureCheck signature={signature} />
    </div>
  );
}

/**
 * So hai cách đo chữ ký. Cách của bản gốc (innerHTML) được chạy trong một document "trơ"
 * (createHTMLDocument): ở đó trình duyệt KHÔNG chạy script hay tải ảnh, nên an toàn để quan sát
 * xem chuỗi bị hiểu thành HTML như thế nào.
 */
function SignatureCheck({ signature }: { signature: string }) {
  const result = useMemo(() => {
    if (!signature) return undefined;
    const inert = document.implementation.createHTMLDocument('');
    const span = inert.createElement('span');
    span.innerHTML = signature;
    const elements = [...span.querySelectorAll('*')].map((el) => {
      const handlers = [...el.attributes].filter((a) => a.name.startsWith('on')).map((a) => a.name);
      return `<${el.tagName.toLowerCase()}${handlers.length ? ' ' + handlers.join(' ') : ''}>`;
    });
    return { elements, visibleText: span.textContent ?? '' };
  }, [signature]);

  return (
    <div className='card tgbm-xss'>
      <h2>Đo chữ ký: innerHTML hay measureText?</h2>
      {!result ? (
        <p className='muted'>
          Nhập chữ ký phía trên, thử <code>{'<img src=x onerror=alert(1)>'}</code> hoặc <code>{'Tom & <Jerry>'}</code>.
        </p>
      ) : (
        <ul>
          <li>
            <b>Bản gốc</b> (<code>span.innerHTML = signature</code>): chữ hiển thị để đo là{' '}
            <code>{JSON.stringify(result.visibleText)}</code>
            {result.elements.length > 0 ? (
              <>
                , và trình duyệt tạo thêm thẻ <code className='err'>{result.elements.join(' ')}</code>
                {result.elements.some((e) => e.includes(' on')) && ' — trong trang thật, đoạn JS trong thuộc tính on… sẽ chạy.'}
              </>
            ) : (
              ', không có thẻ HTML nào.'
            )}
          </li>
          <li>
            <b>measureText</b>: đo đúng chuỗi <code>{JSON.stringify(signature)}</code>, không parse HTML, không chạm DOM.
          </li>
        </ul>
      )}
    </div>
  );
}
