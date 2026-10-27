import { useEffect, useMemo, useRef, useState } from 'react';
import {
  findCue,
  parseSpriteRef,
  parseThumbnailVtt,
  slideIntervals,
  slideIntervalsUdemy,
  spriteStyle,
  tooltipLeft,
  withSignature,
} from '../lib/udSpriteThumbs';
import './UdSpriteThumbsDemo.css';

const DURATION = 300;
const STEP = 5;
const COLS = 10;
const W = 160;
const H = 90;
const FRAMES = DURATION / STEP;

function fmt(t: number) {
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}
function vttTime(t: number) {
  return `00:${fmt(t)}.000`;
}

/** Vẽ sprite 60 ô (10 cột × 6 hàng) bằng canvas và sinh file VTT tương ứng. */
function buildSprite(): Promise<{ url: string; vtt: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = COLS * W;
  canvas.height = Math.ceil(FRAMES / COLS) * H;
  const ctx = canvas.getContext('2d')!;
  const lines = ['WEBVTT', ''];
  for (let i = 0; i < FRAMES; i++) {
    const x = (i % COLS) * W;
    const y = Math.floor(i / COLS) * H;
    ctx.fillStyle = `hsl(${(i * 37) % 360} 55% 40%)`;
    ctx.fillRect(x, y, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText(fmt(i * STEP), x + 12, y + 34);
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(`ô #${i}`, x + 12, y + 70);
    lines.push(`${vttTime(i * STEP)} --> ${vttTime((i + 1) * STEP)}`, `sprite.jpg#xywh=${x},${y},${W},${H}`, '');
  }
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve({ url: URL.createObjectURL(blob!), vtt: lines.join('\n') }), 'image/jpeg', 0.8),
  );
}

/** parseSpriteImageLink của Udemy (rút gọn) để thấy chỗ "pixel:" ra NaN. */
function udemyParse(text: string) {
  const data = text.slice(text.indexOf('#') + 1 + 5).split(',');
  return { x: +data[0], y: +data[1], w: +data[2], h: +data[3] };
}

const SLIDE_COUNT = 30;
const MASHUP_DURATION = 1000;
const SLIDE_TIMES = Array.from({ length: SLIDE_COUNT }, (_, i) => i * 34);

export default function UdSpriteThumbsDemo() {
  const [sprite, setSprite] = useState<{ url: string; vtt: string } | null>(null);
  const [hover, setHover] = useState<{ x: number; width: number } | null>(null);
  const [mashupHover, setMashupHover] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let url = '';
    void buildSprite().then((s) => {
      url = s.url;
      setSprite(s);
    });
    return () => URL.revokeObjectURL(url);
  }, []);

  const cues = useMemo(() => (sprite ? parseThumbnailVtt(sprite.vtt) : []), [sprite]);
  const hoverTime = hover ? (hover.x / hover.width) * DURATION : 0;
  const cue = hover ? findCue(cues, hoverTime) : undefined;
  const ref = cue ? parseSpriteRef(cue.text) : undefined;
  if (ref && sprite && ref.src === 'sprite.jpg') ref.src = sprite.url;

  const signed = withSignature('https://img-c.example.com/thumbs/sprite.jpg', 'https://img-c.example.com/thumbs/sprite.jpg?Expires=1767225600&Signature=abc~&Key-Pair-Id=K1');

  const udemyWidths = slideIntervalsUdemy(SLIDE_TIMES, MASHUP_DURATION);
  const ourWidths = slideIntervals(SLIDE_TIMES, MASHUP_DURATION);
  const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

  function slideAt(widths: number[], pct: number) {
    let acc = 0;
    for (let i = 0; i < widths.length; i++) {
      acc += widths[i];
      if (pct < acc) return i;
    }
    return widths.length - 1;
  }
  const truthAt = (pct: number) => {
    const t = (pct / 100) * MASHUP_DURATION;
    let idx = 0;
    SLIDE_TIMES.forEach((s, i) => {
      if (t >= s) idx = i;
    });
    return idx;
  };

  return (
    <div className='page ud-sprite'>
      <h1>Thumbnail sprite từ WebVTT</h1>
      <p className='hint'>
        Một ảnh sprite 1600×540 chứa 60 khung (mỗi khung 5 giây), vẽ bằng canvas ngay trong trang. File VTT chỉ ô nào ứng
        với khoảng thời gian nào. Rê chuột trên thanh tua.
      </p>

      <div className='card'>
        <div
          className='ud-sprite-bar'
          ref={barRef}
          data-testid='seekbar'
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setHover({ x: e.clientX - rect.left, width: rect.width });
          }}
          onMouseLeave={() => setHover(null)}
        >
          <div className='ud-sprite-fill' style={{ width: hover ? `${(hover.x / hover.width) * 100}%` : 0 }} />
          {hover && ref && (
            <div className='ud-sprite-tip' style={{ left: tooltipLeft(hover.x, ref.w, hover.width) }} data-testid='thumb'>
              <div style={spriteStyle(ref)} />
              <span>{fmt(hoverTime)}</span>
            </div>
          )}
        </div>
        <div className='toolbar ud-sprite-info'>
          <span>
            Thời điểm: <output data-testid='hover-time'>{hover ? fmt(hoverTime) : '--:--'}</output>
          </span>
          <span>
            Cue: <output data-testid='cue-text'>{cue ? cue.text : '–'}</output>
          </span>
          <span>{cues.length} cue, tìm bằng nhị phân</span>
        </div>
        <details>
          <summary>Xem file VTT (10 dòng đầu)</summary>
          <pre>{sprite?.vtt.split('\n').slice(0, 10).join('\n')}</pre>
        </details>
      </div>

      <div className='card'>
        <h2>Hai chi tiết nhỏ</h2>
        <pre data-testid='details'>{`Gắn chữ ký CDN của URL sprite vào đường dẫn trong VTT:
  ${signed}

"sprite.jpg#xywh=pixel:160,0,160,90"
  kiểu Udemy : ${JSON.stringify(udemyParse('sprite.jpg#xywh=pixel:160,0,160,90'))}
  viết lại   : ${JSON.stringify((({ x, y, w, h }) => ({ x, y, w, h }))(parseSpriteRef('sprite.jpg#xywh=pixel:160,0,160,90')))}`}</pre>
      </div>

      <div className='card'>
        <h2>Video mashup: 30 slide trên thanh tua</h2>
        <p className='hint'>
          Video 1000 giây, đổi slide mỗi 34 giây (đoạn cuối chỉ 14 giây). Vạch trắng là thời điểm đổi slide thật. Rê chuột để
          xem mỗi cách cho rằng đang ở slide nào.
        </p>
        {[
          ['Kiểu Udemy (làm tròn từng đoạn, đoạn cuối gánh dư)', udemyWidths, 'ud'],
          ['Viết lại (làm tròn vị trí cộng dồn)', ourWidths, 'new'],
        ].map(([label, widths, id]) => (
          <div key={id as string} className='ud-sprite-mashup'>
            <div className='muted small'>
              {label as string}: tổng {sum(widths as number[])}%, đoạn cuối {(widths as number[])[(widths as number[]).length - 1]}%
            </div>
            <div
              className='ud-sprite-intervals'
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setMashupHover(((e.clientX - rect.left) / rect.width) * 100);
              }}
              onMouseLeave={() => setMashupHover(null)}
              data-testid={`mashup-${id}`}
            >
              {(widths as number[]).map((w, i) => (
                <div
                  key={i}
                  style={{ width: `${w}%` }}
                  className={mashupHover !== null && slideAt(widths as number[], mashupHover) === i ? 'on' : ''}
                />
              ))}
              {SLIDE_TIMES.slice(1).map((t) => (
                <span key={t} style={{ left: `${(t / MASHUP_DURATION) * 100}%` }} />
              ))}
            </div>
          </div>
        ))}
        <div className='stats'>
          <div className='stat'>
            <b data-testid='truth'>{mashupHover === null ? '–' : `#${truthAt(mashupHover)}`}</b>
            <span>slide thật</span>
          </div>
          <div className='stat'>
            <b data-testid='ud-slide'>{mashupHover === null ? '–' : `#${slideAt(udemyWidths, mashupHover)}`}</b>
            <span>kiểu Udemy</span>
          </div>
          <div className='stat'>
            <b data-testid='new-slide'>{mashupHover === null ? '–' : `#${slideAt(ourWidths, mashupHover)}`}</b>
            <span>viết lại</span>
          </div>
        </div>
      </div>
    </div>
  );
}
