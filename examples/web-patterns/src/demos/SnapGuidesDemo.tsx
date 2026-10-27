import { useEffect, useMemo, useRef, useState } from 'react';
import { Stat } from './shared';
import { computeSnap, computeSnapLastWins, createHistory, type Box, type Guide } from '../lib/snapGuides';
import './SnapGuidesDemo.css';

type Shape = Box & { color: string };

const W = 600;
const H = 360;
const FRAME: Box = { id: 'frame', x: 0, y: 0, w: W, h: H };
const INITIAL: Shape[] = [
  { id: 'A', x: 60, y: 60, w: 140, h: 90, color: '#3b82f6' },
  { id: 'B', x: 330, y: 70, w: 120, h: 120, color: '#a855f7' },
  { id: 'C', x: 110, y: 220, w: 180, h: 80, color: '#10b981' },
  { id: 'D', x: 410, y: 245, w: 90, h: 70, color: '#f59e0b' },
];

interface Drag {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  origin: Shape;
  moved: boolean;
}

export default function SnapGuidesDemo() {
  const svgRef = useRef<SVGSVGElement>(null);
  const history = useMemo(() => createHistory<Shape[]>(INITIAL, { limit: 100 }), []);
  const [shapes, setShapes] = useState<Shape[]>(INITIAL);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [snapOn, setSnapOn] = useState(true);
  const [lastWins, setLastWins] = useState(false);
  const [commitEveryMove, setCommitEveryMove] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [, force] = useState(0);
  const [lastSnap, setLastSnap] = useState('—');
  const drag = useRef<Drag | null>(null);
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;

  /** Toạ độ con trỏ trong hệ toạ độ của artboard (đã tính zoom và vị trí cuộn). */
  const toLocal = (clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const point = new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: point.x, y: point.y };
  };
  /** Tỉ lệ thật giữa 1 đơn vị artboard và 1 pixel màn hình (gồm cả zoom lẫn co theo bề ngang). */
  const screenScale = () => svgRef.current!.getBoundingClientRect().width / W;

  const onPointerDown = (event: React.PointerEvent, shape: Shape) => {
    event.preventDefault();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const p = toLocal(event.clientX, event.clientY);
    drag.current = { id: shape.id, pointerId: event.pointerId, startX: p.x, startY: p.y, origin: shape, moved: false };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    const p = toLocal(event.clientX, event.clientY);
    const raw: Box = { ...d.origin, x: d.origin.x + p.x - d.startX, y: d.origin.y + p.y - d.startY };
    const others = shapesRef.current.filter((s) => s.id !== d.id);
    let next = raw;
    let nextGuides: Guide[] = [];
    if (snapOn) {
      const result = lastWins
        ? computeSnapLastWins(raw, [...others, FRAME], { zoom: screenScale() })
        : computeSnap(raw, others, { zoom: screenScale(), frame: FRAME });
      next = { ...raw, x: raw.x + result.dx, y: raw.y + result.dy };
      nextGuides = result.guides;
      setLastSnap(result.dx || result.dy ? `dx ${result.dx.toFixed(1)}, dy ${result.dy.toFixed(1)}` : 'không hút');
    }
    d.moved = true;
    const updated = shapesRef.current.map((s) => (s.id === d.id ? { ...s, x: next.x, y: next.y } : s));
    setShapes(updated);
    setGuides(nextGuides);
    if (commitEveryMove) {
      history.commit(updated);
      force((n) => n + 1);
    }
  };

  const endDrag = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    drag.current = null;
    setGuides([]);
    // gom cả cú kéo thành MỘT bước lịch sử: chỉ commit lúc thả chuột (bản gốc: sự kiện "moved" của fabric)
    if (d.moved && !commitEveryMove) {
      history.commit(shapesRef.current);
      force((n) => n + 1);
    }
  };

  const undo = () => {
    setShapes(history.undo());
    force((n) => n + 1);
  };
  const redo = () => {
    setShapes(history.redo());
    force((n) => n + 1);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className='page snap-guides-demo'>
      <h1>Đường gióng hút cạnh và undo/redo</h1>
      <p className='hint'>
        Kéo các khối: lệch dưới 4px (màn hình) so với cạnh hoặc tâm của khối khác thì hút vào và hiện đường cam. Ctrl/⌘+Z để
        hoàn tác, Ctrl/⌘+Shift+Z hoặc Ctrl+Y để làm lại.
      </p>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} /> Bật hút
        </label>
        <label className='switch'>
          <input type='checkbox' checked={lastWins} onChange={(e) => setLastWins(e.target.checked)} /> Kiểu bản gốc (khớp cuối thắng)
        </label>
        <label className='switch'>
          <input type='checkbox' checked={commitEveryMove} onChange={(e) => setCommitEveryMove(e.target.checked)} /> Ghi lịch sử mỗi
          pointermove
        </label>
      </div>
      <div className='toolbar'>
        <button onClick={undo} disabled={!history.canUndo}>
          ↶ Hoàn tác
        </button>
        <button onClick={redo} disabled={!history.canRedo}>
          ↷ Làm lại
        </button>
        <label>
          Zoom{' '}
          <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
            <option value={0.5}>50%</option>
            <option value={1}>100%</option>
            <option value={1.5}>150%</option>
          </select>
        </label>
      </div>
      <div className='stats'>
        <Stat label='bước có thể hoàn tác' value={history.size.undo} />
        <Stat label='bước có thể làm lại' value={history.size.redo} />
        <Stat label='lần hút gần nhất' value={lastSnap} />
      </div>

      <div className='sg-viewport'>
        <svg
          ref={svgRef}
          className='sg-board'
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: `${zoom * 100}%`, minWidth: zoom * 300 }}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          role='img'
          aria-label='Artboard có 4 khối kéo được'
        >
          <rect x={0} y={0} width={W} height={H} className='sg-frame' />
          {shapes.map((shape) => (
            <g key={shape.id} className='sg-shape' onPointerDown={(e) => onPointerDown(e, shape)}>
              <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={8} fill={shape.color} />
              <text x={shape.x + shape.w / 2} y={shape.y + shape.h / 2} dominantBaseline='middle' textAnchor='middle'>
                {shape.id}
              </text>
            </g>
          ))}
          {guides.map((g, i) =>
            g.axis === 'x' ? (
              <line key={i} x1={g.pos} x2={g.pos} y1={g.from} y2={g.to} className='sg-guide' />
            ) : (
              <line key={i} y1={g.pos} y2={g.pos} x1={g.from} x2={g.to} className='sg-guide' />
            ),
          )}
        </svg>
      </div>
    </div>
  );
}
