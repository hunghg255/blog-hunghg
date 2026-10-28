import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { arrowPlacement, choosePlacement, layerRect, overflow, type Placement, type PlacementInput, type Rect } from '../lib/autoFlip';
import { choosePlacementFbStyle } from './autoFlipFbStyle';
import './AutoFlipDemo.css';

const DOC = { width: 720, height: 900 };
const SIZE = { width: 220, height: 140 };
const GAP = 10;
const NAV = 43;
const ARROW = { length: 16, offset: 12 };

type Mode = 'naive' | 'fb' | 'rewrite';
const MODES: { id: Mode; label: string }[] = [
  { id: 'naive', label: 'Luôn ở dưới' },
  { id: 'fb', label: 'Kiểu Facebook' },
  { id: 'rewrite', label: 'Bản viết lại' },
];

const PRESETS = [
  { label: 'Giữa màn hình', anchor: { left: 300, top: 420 }, scroll: { left: 0, top: 260 } },
  { label: 'Sát đáy', anchor: { left: 300, top: 520 }, scroll: { left: 0, top: 260 } },
  { label: 'Sát mép phải', anchor: { left: 640, top: 420 }, scroll: { left: 400, top: 260 } },
  // anchor gần mép trái, viewport thấp: không phía nào vừa
  { label: 'Không chỗ nào vừa', anchor: { left: 20, top: 340 }, scroll: { left: 0, top: 200 } },
];

export default function AutoFlipDemo() {
  const boxRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('rewrite');
  const [anchorPos, setAnchorPos] = useState(PRESETS[3].anchor);
  const [small, setSmall] = useState(false);
  const [viewport, setViewport] = useState<Rect>({ left: 0, top: 0, width: 360, height: 300 });
  const [pendingScroll, setPendingScroll] = useState<{ left: number; top: number } | null>(PRESETS[3].scroll);

  const readViewport = () => {
    const el = boxRef.current;
    if (!el) return;
    setViewport({ left: el.scrollLeft, top: el.scrollTop, width: el.clientWidth, height: el.clientHeight });
  };

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || !pendingScroll) return;
    el.scrollLeft = pendingScroll.left;
    el.scrollTop = pendingScroll.top;
    setPendingScroll(null);
    readViewport();
  }, [pendingScroll]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(readViewport);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const anchor: Rect = { ...anchorPos, width: small ? 20 : 60, height: 30 };
  const input: PlacementInput = {
    anchor,
    size: SIZE,
    gap: GAP,
    viewport,
    document: DOC,
    preferred: { position: 'below', alignment: 'left' },
    topInset: NAV,
  };
  const naiveRect = layerRect(input, 'below', 'left');
  const results: Record<Mode, Placement> = {
    naive: { position: 'below', alignment: 'left', rect: naiveRect, overflow: overflow(viewport, naiveRect), reason: 'fallback' },
    fb: choosePlacementFbStyle(input),
    rewrite: choosePlacement(input),
  };
  const chosen = results[mode];
  const arrow = arrowPlacement({ position: chosen.position, alignment: chosen.alignment, anchorWidth: anchor.width, arrow: ARROW });

  const place = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const left = Math.round(Math.min(DOC.width - anchor.width, Math.max(0, e.clientX - r.left - anchor.width / 2)));
    const top = Math.round(Math.min(DOC.height - anchor.height, Math.max(NAV, e.clientY - r.top - anchor.height / 2)));
    setAnchorPos({ left, top });
  };

  return (
    <div className='page af'>
      <h1>Popover tự lật</h1>
      <p className='hint'>
        Khung dưới là “viewport” cuộn được (dải trên cùng là thanh điều hướng 43px). Bấm vào đâu để đặt nút ở đó, cuộn để
        đổi chỗ trống. Popover ưu tiên ở dưới, căn trái.
      </p>
      <div className='toolbar' role='group' aria-label='Cách chọn vị trí'>
        {MODES.map((m) => (
          <button key={m.id} className={mode === m.id ? 'primary' : ''} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <div className='toolbar'>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => {
              setAnchorPos(p.anchor);
              setPendingScroll(p.scroll);
            }}
          >
            {p.label}
          </button>
        ))}
        <label className='switch'>
          <input type='checkbox' checked={small} onChange={(e) => setSmall(e.target.checked)} /> nút hẹp 20px
        </label>
      </div>

      <div className='af-box' ref={boxRef} onScroll={readViewport} data-testid='viewport'>
        <div className='af-doc' style={{ width: DOC.width, height: DOC.height }} onClick={place}>
          <div className='af-nav'>thanh điều hướng (43px)</div>
          <div className='af-anchor' style={{ left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height }} />
          <div
            className={`af-layer ${chosen.overflow > 0 ? 'af-over' : ''}`}
            data-testid='layer'
            data-position={chosen.position}
            style={{
              left: chosen.rect.left + arrow.layerShift,
              top: chosen.rect.top,
              width: chosen.rect.width,
              height: chosen.rect.height,
            }}
          >
            <span
              className={`af-arrow af-arrow-${chosen.position}`}
              style={{ left: `calc(${arrow.percent}% + ${arrow.margin}px)`, width: ARROW.length }}
            />
            <b>{chosen.position === 'above' ? 'ở trên' : 'ở dưới'}</b>, căn {chosen.alignment}
            <br />
            tràn {Math.round(chosen.overflow)}px
          </div>
        </div>
      </div>

      <table className='af-table'>
        <thead>
          <tr>
            <th>Cách</th>
            <th>Vị trí</th>
            <th>Tràn</th>
            <th>Lý do</th>
          </tr>
        </thead>
        <tbody>
          {MODES.map((m) => (
            <tr key={m.id} className={m.id === mode ? 'af-current' : ''}>
              <td>{m.label}</td>
              <td data-testid={`pos-${m.id}`}>
                {results[m.id].position}/{results[m.id].alignment}
              </td>
              <td className={results[m.id].overflow > 0 ? 'err' : 'ok'}>{Math.round(results[m.id].overflow)}px</td>
              <td>{m.id === 'naive' ? '—' : results[m.id].reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className='muted af-note'>
        Mũi tên: {arrow.percent}% {arrow.margin >= 0 ? '+' : '−'} {Math.abs(arrow.margin)}px
        {arrow.layerShift ? `, dịch layer ${arrow.layerShift}px để mũi tên chỉ đúng tâm nút hẹp` : ''}.
      </p>
    </div>
  );
}
