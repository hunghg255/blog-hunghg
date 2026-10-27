import { useEffect, useRef, useState } from 'react';
import { useTruncatedText } from '../lib/textTruncateReact';
import { observeClamp, type ClampState } from '../lib/textTruncateObserver';
import { unorphan } from '../lib/textTruncateUnorphan';
import { Stat } from './shared';
import './TextTruncateDemo.css';

const SAMPLES = {
  meeting: 'Họp review thiết kế trang thanh toán với team mobile, chuẩn bị số liệu chuyển đổi quý 3 và danh sách lỗi còn mở',
  longWord: 'Deploy https://example.com/very/long/path/that/never/breaks/naturally lên staging trước 5 giờ chiều',
  emoji: 'Sinh nhật Lan 🎂🎉 nhớ mua bánh, đặt bàn 7 người ở quán quen và gom tiền quà 👩‍👩‍👧‍👦 trước thứ sáu',
};
type SampleKey = keyof typeof SAMPLES;

const INDENT = 44; // chỗ cho nhãn giờ "09:30" ở đầu dòng 1

function CanvasBox({ text, lines, indent }: { text: string; lines: number; indent: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const result = useTruncatedText(ref, text, { lines, firstLineIndent: indent ? INDENT : 0 });
  return (
    <div className='tt-box'>
      <div className='tt-label'>Canvas measureText (kiểu Pipedrive)</div>
      <div ref={ref} className='tt-surface tt-canvas' title={text}>
        {result.lines.map((line, i) => (
          <div key={i} className='tt-line'>
            {i === 0 && indent && <span className='tt-time'>09:30</span>}
            {line}
          </div>
        ))}
      </div>
      <div className='tt-meta'>
        <span className={result.truncated ? 'warn' : 'ok'}>{result.truncated ? 'đã cắt' : 'vừa đủ'}</span>
        <span className='muted'> · {result.measureCalls} lần measureText</span>
      </div>
    </div>
  );
}

function CssBox({ text, lines, indent }: { text: string; lines: number; indent: boolean }) {
  return (
    <div className='tt-box'>
      <div className='tt-label'>CSS -webkit-line-clamp</div>
      {/* padding đặt ở khung ngoài: đặt thẳng lên phần tử line-clamp thì dòng kế tiếp lộ ra trong vùng padding */}
      <div className='tt-surface'>
        <div className='tt-css' style={{ WebkitLineClamp: lines }}>
          {indent && <span className='tt-time'>09:30</span>}
          {text}
        </div>
      </div>
      <div className='tt-meta muted'>không biết có bị cắt không, không lấy được chuỗi đã cắt</div>
    </div>
  );
}

function BadgeBox({ text, lines, bleed }: { text: string; lines: number; bleed: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ClampState | null>(null);
  useEffect(() => (ref.current ? observeClamp(ref.current, setState) : undefined), []);
  return (
    <div className='tt-box'>
      <div className='tt-label'>Badge dính từ cuối (kiểu App Store)</div>
      <div className='tt-surface'>
      <div
        ref={ref}
        className={`tt-clamp${bleed ? ' tt-clamp--overflow' : ''}${state?.truncated ? ' tt-clamp--truncated' : ''}`}
        style={{ ['--tt-lines' as string]: lines }}
      >
        <span className='tt-clamp__text'>
          <a href='#/text-truncate' onClick={(e) => e.preventDefault()}>
            {text}
          </a>
        </span>
        {/* không được có khoảng trắng giữa 2 span, nếu không badge có thể rớt xuống dòng riêng */}
        <span className='tt-clamp__badge'>MỚI</span>
      </div>
      </div>
      <div className='tt-meta'>
        {state ? (
          <span>
            {state.lineCount} dòng · <span className={state.truncated ? 'warn' : 'ok'}>{state.truncated ? 'bị cắt' : 'đủ'}</span>
          </span>
        ) : (
          '…'
        )}
        <span className='muted'> · Tab vào link để xem viền focus</span>
      </div>
    </div>
  );
}

export default function TextTruncateDemo() {
  const [width, setWidth] = useState(260);
  const [lines, setLines] = useState(2);
  const [indent, setIndent] = useState(true);
  const [bleed, setBleed] = useState(true);
  const [sample, setSample] = useState<SampleKey>('meeting');
  const [useUnorphan, setUseUnorphan] = useState(true);
  const [pretty, setPretty] = useState(false);
  const text = SAMPLES[sample];
  const heading = 'Học cách đọc mã nguồn của các trang web lớn';

  return (
    <div className='page tt-demo'>
      <h1>Cắt chữ nhiều dòng chính xác</h1>
      <p className='hint'>
        Kéo thanh độ rộng để thấy ba cách cắt chữ phản ứng thế nào. Khối giữa tự đo từng từ bằng canvas, nên biết chính
        xác chuỗi sau khi cắt và có thể chừa chỗ cho nhãn giờ ở dòng đầu.
      </p>

      <div className='toolbar'>
        <label className='tt-range'>
          Độ rộng <b>{width}px</b>
          <input type='range' min={120} max={460} value={width} onChange={(e) => setWidth(+e.target.value)} aria-label='Độ rộng khung' />
        </label>
        <label>
          Số dòng{' '}
          <select value={lines} onChange={(e) => setLines(+e.target.value)}>
            {[1, 2, 3].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <select value={sample} onChange={(e) => setSample(e.target.value as SampleKey)} aria-label='Chọn đoạn chữ'>
          <option value='meeting'>Lịch họp dài</option>
          <option value='longWord'>Có URL dài</option>
          <option value='emoji'>Có emoji</option>
        </select>
        <label className='switch'>
          <input type='checkbox' checked={indent} onChange={(e) => setIndent(e.target.checked)} /> Nhãn giờ ở dòng đầu
        </label>
        <label className='switch'>
          <input type='checkbox' checked={bleed} onChange={(e) => setBleed(e.target.checked)} /> Cho viền focus tràn
        </label>
      </div>

      <div className='tt-boxes' style={{ ['--tt-width' as string]: `${width}px` }}>
        <CssBox text={text} lines={lines} indent={indent} />
        <CanvasBox text={text} lines={lines} indent={indent} />
        <BadgeBox text={text} lines={lines} bleed={bleed} />
      </div>

      <h2 className='tt-h2'>Từ mồ côi trong tiêu đề</h2>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={useUnorphan} onChange={(e) => setUseUnorphan(e.target.checked)} /> unorphan (nối 2 từ cuối bằng NBSP)
        </label>
        <label className='switch'>
          <input type='checkbox' checked={pretty} onChange={(e) => setPretty(e.target.checked)} /> CSS text-wrap: pretty
        </label>
      </div>
      <div className='stats'>
        <Stat label='độ rộng tiêu đề' value={`${Math.round(width * 1.15)}px`} />
      </div>
      <p className='tt-heading' style={{ width: Math.round(width * 1.15), textWrap: pretty ? 'pretty' : undefined }}>
        {useUnorphan ? unorphan(heading) : heading}
      </p>
    </div>
  );
}
