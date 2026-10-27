import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useContextualLayer, useOutsideClick, type Align, type Position } from '../lib/contextualLayer';
import { Hovercard, Tooltip, TooltipGroup } from '../lib/tooltipGroup';
import './PopoverDemo.css';

function MenuButton({
  label,
  position = 'below',
  align = 'start',
}: {
  label: string;
  position?: Position;
  align?: Align;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const layer = useContextualLayer(anchorRef, layerRef, { position, align, enabled: open });
  useOutsideClick([anchorRef, layerRef], () => setOpen(false), open);

  const flipped = layer.position !== position;
  return (
    <>
      <button
        ref={anchorRef}
        aria-haspopup='menu'
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={open ? 'primary' : undefined}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div
            ref={layerRef}
            className='fbp-layer'
            data-position={layer.position}
            style={{ position: 'absolute', top: 0, left: 0 }}
          >
            <div className='fbp-menu' role='menu'>
              <div className='fbp-meta'>
                <span className={flipped ? 'warn' : 'ok'}>
                  {layer.position}
                  {flipped ? ' (đã lật)' : ''}
                </span>
                {layer.adjustment != null && <span className='warn'> · dịch {Math.round(layer.adjustment)}px</span>}
                {layer.hidden && <span className='err'> · anchor bị cắt → ẩn</span>}
              </div>
              {['Lưu bài viết', 'Ẩn bài viết', 'Báo cáo'].map((item) => (
                <button key={item} role='menuitem' onClick={() => setOpen(false)}>
                  {item}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

const ICONS = [
  ['👍', 'Thích'],
  ['💬', 'Bình luận'],
  ['↗️', 'Chia sẻ'],
  ['🔖', 'Lưu'],
  ['⋯', 'Thêm'],
] as const;

export default function PopoverDemo() {
  const [loads, setLoads] = useState(0);
  return (
    <div className='page'>
      <h1>Popover, tooltip group, hovercard</h1>
      <p className='hint'>
        1) Mở menu trong khung cuộn rồi cuộn khung: menu bám theo anchor, anchor bị cắt khỏi khung
        thì menu ẩn. Nút sát mép phải/dưới tự lật và tự dịch vào trong. 2) Rê chuột dọc thanh icon:
        chỉ icon đầu phải chờ 300ms. 3) Rê vào tên rồi kéo xuống card: card không đóng.
      </p>

      <h3 className='fbp-h'>1. Popover trong vùng cuộn</h3>
      <div className='fbp-scroll'>
        <div className='fbp-scroll-inner'>
          <MenuButton label='Menu (đầu khung)' />
          <div style={{ height: 160 }} />
          <div style={{ textAlign: 'right' }}>
            <MenuButton label='Sát mép phải' align='start' />
          </div>
          <div style={{ height: 160 }} />
          <MenuButton label='Menu (giữa khung)' align='middle' />
          <div style={{ height: 260 }} />
        </div>
      </div>
      <div className='toolbar' style={{ marginTop: 8 }}>
        <MenuButton label='Mở phía trên (above)' position='above' />
        <MenuButton label='Bên phải (end)' position='end' />
      </div>

      <h3 className='fbp-h'>2. Tooltip group "ấm"</h3>
      <div className='toolbar'>
        <TooltipGroup>
          {ICONS.map(([icon, label]) => (
            <Tooltip key={label} content={label}>
              <button className='fbp-icon' aria-label={label}>
                {icon}
              </button>
            </Tooltip>
          ))}
        </TooltipGroup>
        <span className='muted' style={{ fontSize: 13 }}>
          so với tooltip riêng lẻ (lần nào cũng chờ 300ms):
        </span>
        {ICONS.slice(0, 3).map(([icon, label]) => (
          <Tooltip key={label} content={label}>
            <button className='fbp-icon fbp-icon-cold' aria-label={`${label} (riêng lẻ)`}>
              {icon}
            </button>
          </Tooltip>
        ))}
      </div>

      <h3 className='fbp-h'>3. Hovercard</h3>
      <p>
        Bài viết của{' '}
        <Hovercard
          onLoad={() => setLoads((n) => n + 1)}
          card={
            <div className='fbp-card'>
              <div className='fbp-avatar' aria-hidden />
              <div>
                <b>Nguyễn Văn A</b>
                <div className='muted'>Sống tại Hà Nội · 1.234 bạn bè</div>
                <div className='toolbar' style={{ margin: '8px 0 0' }}>
                  <button className='primary'>Nhắn tin</button>
                  <button>Theo dõi</button>
                </div>
              </div>
            </div>
          }
        >
          <a href='#/popover' className='fbp-name' onClick={(e) => e.preventDefault()}>
            Nguyễn Văn A
          </a>
        </Hovercard>{' '}
        lúc 9:41. <span className='muted'>(onLoad đã gọi {loads} lần: bắt đầu tải dữ liệu ngay khi chuột vào)</span>
      </p>
      {/* chừa chỗ để cuộn nút "above" lên sát mép trên, xem nó tự lật xuống */}
      <div style={{ height: 700 }} />
    </div>
  );
}
