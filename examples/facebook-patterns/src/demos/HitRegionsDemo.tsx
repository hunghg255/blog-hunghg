import { useEffect, useMemo, useRef, useState } from 'react';
import {
  axisDashedPath,
  buildRegion,
  dashPolyline,
  distanceToSegment,
  PathRecorder,
  polylineLength,
  RegionIndex,
  type PathSink,
  type Pt,
} from '../lib/hitRegions';
import { FbStyleBuilder, fbQuery, type FbRegion } from '../lib/hitRegionsFb';
import { Stat } from './shared';
import './HitRegionsDemo.css';

const W = 640;
const H = 340;
const TAU = Math.PI * 2;

interface Shape {
  id: string;
  label: string;
  fill: boolean;
  hoverThreshold: number;
  proximityThreshold: number;
  draw: (p: PathSink) => void;
}

const LINE: Pt[] = [
  { x: 40, y: 250 }, { x: 110, y: 205 }, { x: 180, y: 222 }, { x: 250, y: 150 }, { x: 320, y: 172 }, { x: 380, y: 110 },
];
const DOT = LINE[LINE.length - 1];

const SHAPES: Shape[] = [
  ...[0, 1, 2].map((i) => ({
    id: `bar-${i + 1}`,
    label: `Cột ${i + 1} · rect()`,
    fill: true,
    hoverThreshold: 0,
    proximityThreshold: 8,
    draw: (p: PathSink) => p.rect(70 + i * 110, 300 - [90, 150, 120][i], 60, [90, 150, 120][i]),
  })),
  {
    id: 'blob',
    label: 'Vùng cong · bezierCurveTo()',
    fill: true,
    hoverThreshold: 0,
    proximityThreshold: 10,
    draw: (p) => {
      p.moveTo(470, 60);
      p.bezierCurveTo(560, 20, 620, 110, 570, 150);
      p.quadraticCurveTo(520, 190, 470, 140);
      p.bezierCurveTo(430, 110, 420, 80, 470, 60);
      p.closePath();
    },
  },
  {
    id: 'donut',
    label: 'Lát donut · arc()',
    fill: true,
    hoverThreshold: 0,
    proximityThreshold: 10,
    draw: (p) => {
      p.arc(530, 255, 60, -0.3, 2.2);
      p.arc(530, 255, 32, 2.2, -0.3, true);
      p.closePath();
    },
  },
  {
    id: 'line',
    label: 'Đường dữ liệu · lineTo()',
    fill: false,
    hoverThreshold: 4,
    proximityThreshold: 16,
    draw: (p) => {
      p.moveTo(LINE[0].x, LINE[0].y);
      for (const q of LINE.slice(1)) p.lineTo(q.x, q.y);
    },
  },
  {
    id: 'dot',
    label: 'Điểm cuối · ellipse()',
    fill: true,
    hoverThreshold: 3,
    proximityThreshold: 22,
    draw: (p) => p.ellipse(DOT.x, DOT.y, 8, 8, 0, 0, TAU),
  },
];

type Engine = 'rewrite' | 'fb';

interface Hit {
  hover: string[];
  proximity: string[];
}

function cssVar(el: Element, name: string) {
  return getComputedStyle(el).getPropertyValue(name).trim() || '#888';
}

export default function HitRegionsDemo() {
  return (
    <div className='page hit-demo'>
      <h1>Hit-test trên canvas bằng phát lại path</h1>
      <HitSection />
      <DashSection />
    </div>
  );
}

function HitSection() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<Engine>('rewrite');
  const [tolerance, setTolerance] = useState(0.25);
  const [showPoly, setShowPoly] = useState(false);
  const [mouse, setMouse] = useState<Pt | null>(null);

  const rewrite = useMemo(() => {
    const index = new RegionIndex();
    let segments = 0;
    for (const s of SHAPES) {
      const r = buildRegion(s.id, s.draw, { fill: s.fill, hoverThreshold: s.hoverThreshold, proximityThreshold: s.proximityThreshold }, tolerance);
      segments += r.subpaths.reduce((n, sp) => n + sp.points.length, 0);
      index.set(r);
    }
    return { index, segments };
  }, [tolerance]);

  const fb = useMemo(() => {
    const regions: FbRegion[] = [];
    const errors: string[] = [];
    for (const s of SHAPES) {
      const b = new FbStyleBuilder();
      try {
        s.draw(b);
        const built = b.build(s.id, s);
        if (!built.length) errors.push(`${s.id}: rect() không tạo vùng nào`);
        regions.push(...built);
      } catch (e) {
        errors.push(`${s.id}: ${(e as Error).message}`);
      }
    }
    return { regions, errors };
  }, []);

  const hit: Hit = useMemo(() => {
    if (!mouse) return { hover: [], proximity: [] };
    if (engine === 'rewrite') {
      const q = rewrite.index.query(mouse);
      return { hover: q.hover.map((r) => r.id), proximity: q.proximity.map((r) => r.id) };
    }
    const q = fbQuery(fb.regions, mouse);
    return { hover: [...new Set(q.hover.map((r) => r.id))], proximity: [...new Set(q.proximity.map((r) => r.id))] };
  }, [mouse, engine, rewrite, fb]);

  // trình duyệt tự hit-test: isPointInPath cho vùng tô, isPointInStroke với nét dày 2×ngưỡng
  const native = useMemo(() => {
    const canvas = canvasRef.current;
    if (!mouse || !canvas) return null;
    const ctx = canvas.getContext('2d')!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let top: string | null = null;
    for (const s of SHAPES) {
      const path = new Path2D();
      s.draw(path);
      ctx.lineWidth = Math.max(1, s.hoverThreshold * 2);
      if ((s.fill && ctx.isPointInPath(path, mouse.x, mouse.y)) || (s.hoverThreshold > 0 && ctx.isPointInStroke(path, mouse.x, mouse.y))) top = s.id;
    }
    ctx.restore();
    return top;
  }, [mouse]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    canvas.width = W;
    canvas.height = H;
    const accent = cssVar(canvas, '--accent');
    const warn = cssVar(canvas, '--warn');
    const text = cssVar(canvas, '--text');
    const muted = cssVar(canvas, '--muted');
    const surface = cssVar(canvas, '--surface-2');
    const border = cssVar(canvas, '--border');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, 300.5);
    ctx.lineTo(410, 300.5);
    ctx.stroke();
    for (const s of SHAPES) {
      const isHover = hit.hover[0] === s.id;
      const isNear = !isHover && hit.proximity.includes(s.id);
      ctx.beginPath();
      s.draw(ctx);
      if (s.fill) {
        ctx.fillStyle = isHover ? accent : muted;
        ctx.globalAlpha = isHover ? 0.9 : 0.45;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = isHover ? accent : text;
        ctx.lineWidth = isHover ? 3 : 2;
        ctx.stroke();
      }
      if (isNear) {
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = warn;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (showPoly && engine === 'rewrite') {
      ctx.fillStyle = warn;
      for (const s of SHAPES) {
        const rec = new PathRecorder(tolerance);
        s.draw(rec);
        for (const sp of rec.subpaths) for (const p of sp.points) ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      }
    }
    if (engine === 'fb') {
      ctx.strokeStyle = warn;
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      for (const r of fb.regions) ctx.strokeRect(r.bounds.x, r.bounds.y, r.bounds.width, r.bounds.height);
      ctx.setLineDash([]);
    }
    if (mouse) {
      ctx.fillStyle = text;
      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, 2.5, 0, TAU);
      ctx.fill();
    }
  }, [hit, mouse, showPoly, tolerance, engine, fb]);

  const toCanvas = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const label = (id: string) => SHAPES.find((s) => s.id === id)?.label ?? id;

  return (
    <section>
      <p className='hint'>
        Phần 1: mỗi hình được vẽ bằng một hàm nhận "bút" kiểu CanvasPath. Cùng hàm đó chạy hai lần: một lần lên canvas thật, một
        lần vào bộ ghi để dựng vùng hit-test. Di chuột (hoặc chạm) lên canvas: hình được tô cam là "trúng", viền vàng đứt là "ở gần".
      </p>
      <div className='toolbar'>
        <label>
          <input type='radio' name='engine' checked={engine === 'rewrite'} onChange={() => setEngine('rewrite')} /> Bản viết lại
        </label>
        <label>
          <input type='radio' name='engine' checked={engine === 'fb'} onChange={() => setEngine('fb')} /> Mô phỏng builder gốc
        </label>
        {engine === 'rewrite' && (
          <>
            <label>
              Sai số làm phẳng {tolerance.toFixed(2)} px
              <input type='range' min={0.05} max={6} step={0.05} value={tolerance} onChange={(e) => setTolerance(+e.target.value)} />
            </label>
            <label>
              <input type='checkbox' checked={showPoly} onChange={(e) => setShowPoly(e.target.checked)} /> Hiện đỉnh đa giác
            </label>
          </>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className='hit-canvas'
        data-testid='hit-canvas'
        onPointerMove={(e) => setMouse(toCanvas(e))}
        onPointerDown={(e) => setMouse(toCanvas(e))}
        onPointerLeave={() => setMouse(null)}
        style={{ cursor: hit.hover.length ? 'pointer' : 'default' }}
      />
      <div className='stats'>
        <Stat label='trúng (trên cùng)' value={<span data-testid='hover'>{hit.hover[0] ?? '—'}</span>} />
        <Stat label='ở gần' value={<span data-testid='near'>{hit.proximity.join(', ') || '—'}</span>} />
        <Stat label='isPointInPath / Stroke' value={<span data-testid='native'>{native ?? '—'}</span>} />
        <Stat label='đỉnh sau khi làm phẳng' value={engine === 'rewrite' ? rewrite.segments : '—'} />
      </div>
      {engine === 'fb' ? (
        <div className='log' data-testid='fb-errors'>
          {fb.errors.map((e) => (
            <div key={e} className='err'>
              {e}
            </div>
          ))}
          <div className='muted'>
            Khung chấm vàng là hộp bao dùng để lọc nhanh. Điểm cuối (ellipse, ngưỡng trúng 3 px, ngưỡng gần 22 px): tâm có một lỗ
            bán kính 3 px không trỏ trúng được, và vùng "gần" không bao giờ được báo, vì hộp bao chỉ nới nửa ngưỡng.
          </div>
        </div>
      ) : (
        <p className='hint'>
          {hit.hover[0] ? `Đang trỏ: ${label(hit.hover[0])}.` : 'Chưa trúng hình nào.'} Cột dữ liệu vẽ trước nên nằm dưới đường;
          query đảo thứ tự để hình vẽ sau đứng đầu.
        </p>
      )}
    </section>
  );
}

function DashSection() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [angle, setAngle] = useState(14);
  const [dash, setDash] = useState(10);
  const DH = 230;
  const from = { x: 30, y: 30 };
  const len = 300;
  const rad = (angle * Math.PI) / 180;
  const to = { x: Math.round(from.x + len * Math.cos(rad)), y: Math.round(from.y + len * Math.sin(rad)) };
  const fbDash = axisDashedPath(from, to, [dash]);
  const fixed = dashPolyline([from, to], [dash]);
  const firstFb = fbDash.dashes[0] ? polylineLength(fbDash.dashes[0]) : 0;
  const maxDev = Math.max(0, ...fbDash.dashes.flat().map((p) => distanceToSegment(p, from, to)));
  const zig: Pt[] = [{ x: 360, y: 200 }, { x: 410, y: 120 }, { x: 450, y: 190 }, { x: 500, y: 110 }, { x: 540, y: 200 }, { x: 610, y: 130 }];

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    c.width = W;
    c.height = DH;
    ctx.fillStyle = cssVar(c, '--surface-2');
    ctx.fillRect(0, 0, W, DH);
    const draw = (dashes: Pt[][], color: string, dy: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.lineCap = 'butt';
      for (const d of dashes) {
        ctx.beginPath();
        ctx.moveTo(d[0].x, d[0].y + dy);
        for (const p of d.slice(1)) ctx.lineTo(p.x, p.y + dy);
        ctx.stroke();
      }
    };
    // đường chuẩn mảnh để so
    ctx.strokeStyle = cssVar(c, '--border');
    ctx.lineWidth = 1;
    for (const dy of [0, 26]) {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y + dy);
      ctx.lineTo(to.x, to.y + dy);
      ctx.stroke();
    }
    draw(fbDash.dashes, cssVar(c, '--err'), 0);
    draw(fixed, cssVar(c, '--ok'), 26);
    draw(dashPolyline(zig, [dash, dash * 0.6]), cssVar(c, '--accent'), 0);
  }, [fbDash, fixed, from, to, dash, zig]);

  return (
    <section>
      <p className='hint'>
        Phần 2: nét đứt. Đỏ là cách của <code>drawDashedPath</code> gốc (cộng dash vào x và y riêng rẽ), xanh là cắt theo độ dài thật
        (dịch xuống 26 px để dễ nhìn). Đường cam bên phải: một đường gấp khúc, pha nét đứt được giữ qua các đỉnh.
      </p>
      <div className='toolbar'>
        <label>
          Góc {angle}°
          <input type='range' min={0} max={60} value={angle} onChange={(e) => setAngle(+e.target.value)} data-testid='angle' />
        </label>
        <label>
          Dash {dash} px
          <input type='range' min={0} max={30} value={dash} onChange={(e) => setDash(+e.target.value)} data-testid='dash' />
        </label>
      </div>
      <canvas ref={ref} className='hit-canvas dash' />
      <div className='stats'>
        <Stat label='gạch đầu, bản gốc' value={<span data-testid='first-fb'>{firstFb.toFixed(2)} px</span>} />
        <Stat label='gạch đầu, bản sửa' value={fixed[0] ? `${polylineLength(fixed[0]).toFixed(2)} px` : '—'} />
        <Stat label='lệch khỏi đường thẳng' value={<span data-testid='dev'>{maxDev.toFixed(1)} px</span>} />
        <Stat label='vòng lặp bản gốc' value={<span data-testid='steps'>{fbDash.stuck ? `≥ ${fbDash.steps} (kẹt)` : fbDash.steps}</span>} />
      </div>
      {fbDash.stuck && <p className='hint err'>Dash = 0: bản gốc không bao giờ tới đích, vòng while chạy mãi (demo dừng ở 10.000 vòng).</p>}
    </section>
  );
}
