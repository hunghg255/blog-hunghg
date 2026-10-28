import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { escapeOverlap, initialPipRect, minWidth, moveRect, pipRatio, resizeFromHandle, type Handle, type Rect, type Size } from '../lib/waPip';
import { Log, Stat, useLog } from './shared';
import './WaPipDemo.css';

const VIDEOS: [string, Size][] = [
  ['16:9', { width: 16, height: 9 }],
  ['4:3', { width: 4, height: 3 }],
  ['1:1', { width: 1, height: 1 }],
  ['9:16 (điện thoại dọc)', { width: 9, height: 16 }],
  ['9:21 (quá dài)', { width: 9, height: 21 }],
  ['32:9 (quá dẹt)', { width: 32, height: 9 }],
];
const HANDLES: Handle[] = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];

type Drag = { kind: 'move' } | { kind: 'resize'; handle: Handle };

/**
 * Giữ khung trong vùng chứa khi vùng chứa đổi kích thước (thu nhỏ nếu cần, rồi đẩy vào trong).
 * Vùng chứa hẹp hơn cả bề rộng tối thiểu thì ưu tiên nằm trong vùng chứa.
 */
function fit(r: Rect, ratio: number, bounds: Size): Rect {
  const width = Math.min(bounds.width - 20, (bounds.height - 20) * ratio, Math.max(minWidth(ratio), r.width));
  return moveRect({ ...r, width, height: width / ratio }, 0, 0, bounds);
}

/** Kích thước video thật bên trong khung (kiểu object-fit: contain). */
function contain(r: Rect, v: Size) {
  const vr = v.width / v.height;
  return vr > r.width / r.height ? { width: r.width, height: r.width / vr } : { width: r.height * vr, height: r.height };
}

export default function WaPipDemo() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<Size>({ width: 0, height: 0 });
  const [video, setVideo] = useState(0);
  const { ratio, clamped } = pipRatio(VIDEOS[video][1]);
  const [rect, setRect] = useState<Rect | null>(null);
  const [menu, setMenu] = useState(false);
  const [animating, setAnimating] = useState(false);
  const drag = useRef<{ mode: Drag; x: number; y: number; start: Rect } | null>(null);
  const { lines, add } = useLog(8);

  useLayoutEffect(() => {
    const el = stageRef.current!;
    const ro = new ResizeObserver(() => setBounds({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // đổi video hoặc lần đầu có kích thước: đặt khung mặc định ở góc phải dưới
  useEffect(() => {
    if (bounds.width) setRect(fit(initialPipRect(ratio, bounds), ratio, bounds));
  }, [video, bounds.width > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (bounds.width) setRect((r) => r && fit(r, ratio, bounds));
  }, [bounds.width, bounds.height]); // eslint-disable-line react-hooks/exhaustive-deps

  // menu (vật cản) ở góc phải trên vùng chứa
  const obstacle: Rect = { left: Math.max(10, bounds.width - 230), top: 10, width: Math.min(220, bounds.width - 20), height: 170 };

  const avoid = (r: Rect) => {
    const res = escapeOverlap(r, obstacle, bounds);
    if (!res) return add('menu không đè lên video', 'muted');
    setAnimating(true);
    setRect(res.rect);
    add(`né sang ${res.side}, dịch ${Math.round(res.distance)} px`, 'ok');
    setTimeout(() => setAnimating(false), 200);
  };

  const onDown = (mode: Drag) => (e: RPointerEvent) => {
    if (!rect || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    // pointer capture: vẫn nhận pointermove khi con trỏ ra ngoài khung, chạy cả với cảm ứng và bút
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, start: rect };
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    setRect(d.mode.kind === 'move' ? moveRect(d.start, dx, dy, bounds) : resizeFromHandle(d.start, d.mode.handle, dx, dy, ratio, bounds));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && rect) add(`${d.mode.kind === 'move' ? 'kéo' : `resize ${d.mode.handle}`} → ${Math.round(rect.width)}×${Math.round(rect.height)}`);
    if (d && rect && menu) avoid(rect);
  };

  const toggleMenu = () => {
    const next = !menu;
    setMenu(next);
    if (next && rect) avoid(rect);
  };

  return (
    <div className='page wpp-page'>
      <h1>Cửa sổ video nổi: resize 8 hướng, khoá tỉ lệ, né vật cản</h1>
      <p className='hint'>
        Viết lại từ WhatsApp Web 2020 (module bjegcccgec, dffjiffehg). Kéo video để di chuyển, kéo cạnh/góc để đổi kích thước. Bật menu: video tự
        né theo hướng ngắn nhất (ưu tiên trái → dưới → phải → trên).
      </p>
      <div className='toolbar'>
        <label>
          Video{' '}
          <select value={video} onChange={(e) => setVideo(+e.target.value)}>
            {VIDEOS.map(([name], i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button className={menu ? 'primary' : ''} onClick={toggleMenu}>
          {menu ? 'Đóng menu' : 'Mở menu'}
        </button>
        <button onClick={() => rect && setRect(fit(initialPipRect(ratio, bounds), ratio, bounds))}>Về góc mặc định</button>
      </div>
      <div className='stats'>
        <Stat label='kích thước' value={rect ? `${Math.round(rect.width)}×${Math.round(rect.height)}` : '—'} />
        <Stat label='tỉ lệ khung' value={ratio.toFixed(2)} />
        <Stat label='bề rộng nhỏ nhất' value={Math.round(minWidth(ratio))} />
        <Stat label='tỉ lệ bị kẹp' value={clamped ? 'có → nền mờ' : 'không'} />
      </div>
      <div ref={stageRef} className='wpp-stage' onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className='wpp-chat'>
          {Array.from({ length: 6 }, (_, i) => (
            <p key={i} className={i % 2 ? 'me' : ''}>
              {i % 2 ? 'Ok, mình thấy rồi' : 'Bạn thấy video không?'}
            </p>
          ))}
        </div>
        {menu && (
          <div className='wpp-menu' style={{ left: obstacle.left, top: obstacle.top, width: obstacle.width, height: obstacle.height }}>
            <b>Menu</b>
            <span>Thông tin liên hệ</span>
            <span>Chọn tin nhắn</span>
            <span>Tắt thông báo</span>
          </div>
        )}
        {rect && (
          <div
            className={`wpp-pip${animating ? ' animating' : ''}`}
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
            onPointerDown={onDown({ kind: 'move' })}
          >
            {clamped && <div className='wpp-blur' />}
            <div className='wpp-video' style={contain(rect, VIDEOS[video][1])}>
              <span>{VIDEOS[video][0].split(' ')[0]}</span>
            </div>
            {HANDLES.map((h) => (
              <i key={h} className={`wpp-h wpp-${h}`} onPointerDown={onDown({ kind: 'resize', handle: h })} />
            ))}
          </div>
        )}
      </div>
      <Log lines={lines} />
    </div>
  );
}
