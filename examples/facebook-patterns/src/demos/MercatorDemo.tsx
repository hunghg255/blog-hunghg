import { useEffect, useMemo, useRef, useState } from 'react';
import {
  boundsShiftEllipse,
  circleEllipse,
  geodesicCircle,
  metersPerPixel,
  naiveCircle,
  project,
  unproject,
  worldSize,
  wrapLng,
  type Ellipse,
  type LatLng,
} from '../lib/mercator';
import { Stat } from './shared';
import './MercatorDemo.css';

const Z = 1; // thế giới 512×512 px
const SIZE = worldSize(Z);
const STAT_ZOOM = 4;

const PRESETS: Array<{ name: string; c: LatLng }> = [
  { name: 'Hà Nội 21°', c: { lat: 21.03, lng: 105.85 } },
  { name: 'Oslo 60°', c: { lat: 59.91, lng: 10.75 } },
  { name: 'Svalbard 78°', c: { lat: 78.22, lng: 15.65 } },
  { name: 'Fiji, sát kinh tuyến 180', c: { lat: -17.7, lng: 178.4 } },
  { name: 'Gần cực Bắc 87°', c: { lat: 87, lng: 0 } },
];

const CITIES: Array<[string, number, number]> = [
  ['Hà Nội', 21.03, 105.85],
  ['Oslo', 59.91, 10.75],
  ['Reykjavík', 64.15, -21.94],
  ['Nuuk', 64.18, -51.72],
  ['Singapore', 1.35, 103.82],
  ['Sydney', -33.87, 151.21],
  ['Lima', -12.05, -77.04],
  ['Cape Town', -33.92, 18.42],
  ['Anchorage', 61.22, -149.9],
];

function cssVar(el: Element, name: string) {
  return getComputedStyle(el).getPropertyValue(name).trim() || '#888';
}

export default function MercatorDemo() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [center, setCenter] = useState<LatLng>(PRESETS[1].c);
  const [km, setKm] = useState(800);
  const [show, setShow] = useState({ geo: true, fixed: true, fb: true, naive: true });
  const dragging = useRef(false);

  const meters = km * 1000;
  const shapes = useMemo(
    () => ({
      geo: geodesicCircle(center, meters, 180),
      fixed: circleEllipse(center, meters, Z),
      fb: boundsShiftEllipse(center, meters, Z),
      naive: naiveCircle(center, meters, Z),
    }),
    [center, meters],
  );

  const stats = useMemo(() => {
    const poly = geodesicCircle(center, meters, 720).map((p) => project(p, STAT_ZOOM));
    const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
    const truth = { rx: (Math.max(...xs) - Math.min(...xs)) / 2, ry: (Math.max(...ys) - Math.min(...ys)) / 2 };
    return {
      truth,
      fixed: circleEllipse(center, meters, STAT_ZOOM),
      fb: boundsShiftEllipse(center, meters, STAT_ZOOM),
      naive: naiveCircle(center, meters, STAT_ZOOM),
    };
  }, [center, meters]);

  useEffect(() => {
    const c = ref.current!;
    c.width = SIZE;
    c.height = SIZE;
    const ctx = c.getContext('2d')!;
    const col = {
      bg: cssVar(c, '--surface-2'),
      grid: cssVar(c, '--border'),
      text: cssVar(c, '--muted'),
      ok: cssVar(c, '--ok'),
      warn: cssVar(c, '--warn'),
      err: cssVar(c, '--err'),
      accent: cssVar(c, '--accent'),
    };
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = col.grid;
    ctx.lineWidth = 1;
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = col.text;
    for (let lng = -180; lng <= 180; lng += 30) {
      const x = project({ lat: 0, lng }, Z).x;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, SIZE);
      ctx.stroke();
    }
    for (const lat of [-80, -60, -30, 0, 30, 60, 80]) {
      const y = project({ lat, lng: 0 }, Z).y;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(SIZE, y + 0.5);
      ctx.stroke();
      ctx.fillText(`${lat}°`, 3, y - 3);
    }
    for (const [name, lat, lng] of CITIES) {
      const p = project({ lat, lng }, Z);
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      ctx.fillText(name, p.x + 4, p.y + 3);
    }
    // vẽ thêm bản sao ±1 thế giới để hình cắt kinh tuyến 180 hiện ở cả hai mép
    for (const shift of [-SIZE, 0, SIZE]) {
      if (show.geo) {
        ctx.beginPath();
        shapes.geo.forEach((q, i) => {
          const p = project({ lat: q.lat, lng: 0 }, Z);
          const x = ((q.lng + 180) / 360) * SIZE + shift;
          if (i) ctx.lineTo(x, p.y);
          else ctx.moveTo(x, p.y);
        });
        ctx.closePath();
        ctx.fillStyle = col.ok;
        ctx.globalAlpha = 0.22;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = col.ok;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      const ell = (e: Ellipse, color: string, dash: number[]) => {
        if (!Number.isFinite(e.rx) || !Number.isFinite(e.ry)) return;
        ctx.beginPath();
        ctx.setLineDash(dash);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.ellipse(e.cx + shift, e.cy, Math.max(0, e.rx), Math.max(0, e.ry), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      };
      if (show.fixed) ell(shapes.fixed, col.accent, [6, 4]);
      if (show.fb) ell(shapes.fb, col.warn, [2, 3]);
      if (show.naive) ell(shapes.naive, col.err, []);
    }
    const cp = project(center, Z);
    ctx.fillStyle = col.accent;
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }, [shapes, show, center]);

  const pick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const p = unproject({ x: ((e.clientX - r.left) / r.width) * SIZE, y: ((e.clientY - r.top) / r.height) * SIZE }, Z);
    setCenter({ lat: +p.lat.toFixed(2), lng: +wrapLng(p.lng).toFixed(2) });
  };

  const pct = (v: number, t: number) => (Number.isFinite(v) && t > 0 ? `${v >= t ? '+' : ''}${(((v - t) / t) * 100).toFixed(1)}%` : 'NaN');
  const row = (label: string, e: { rx: number; ry: number }, cls: string) => (
    <tr className={cls}>
      <td>{label}</td>
      <td>{Number.isFinite(e.rx) ? e.rx.toFixed(1) : 'NaN'}</td>
      <td>{Number.isFinite(e.ry) ? e.ry.toFixed(1) : 'NaN'}</td>
      <td>{pct(e.rx, stats.truth.rx)}</td>
      <td>{pct(e.ry, stats.truth.ry)}</td>
    </tr>
  );

  return (
    <div className='page merc-demo'>
      <h1>Vòng tròn theo mét trên bản đồ Mercator</h1>
      <p className='hint'>
        Bấm hoặc kéo trên bản đồ để đặt tâm. Xanh lá: vòng tròn thật trên mặt cầu (180 điểm đích). Cam đứt: ellipse của bản viết
        lại. Vàng chấm: cách của <code>LeafletUtils</code>. Đỏ: hình tròn ngây thơ theo tỉ lệ mét/pixel ở tâm.
      </p>
      <div className='toolbar'>
        {PRESETS.map((p) => (
          <button key={p.name} onClick={() => setCenter(p.c)}>
            {p.name}
          </button>
        ))}
      </div>
      <div className='toolbar'>
        <label>
          Bán kính {km} km
          <input type='range' min={50} max={3000} step={50} value={km} onChange={(e) => setKm(+e.target.value)} data-testid='radius' />
        </label>
        {(
          [
            ['geo', 'Thật'],
            ['fixed', 'Bản viết lại'],
            ['fb', 'Bản gốc'],
            ['naive', 'Ngây thơ'],
          ] as const
        ).map(([k, label]) => (
          <label key={k}>
            <input type='checkbox' checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /> {label}
          </label>
        ))}
      </div>
      <div className='merc-wrap'>
        <canvas
          ref={ref}
          className='merc-canvas'
          data-testid='map'
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            pick(e);
          }}
          onPointerMove={(e) => dragging.current && pick(e)}
          onPointerUp={() => (dragging.current = false)}
        />
        <div>
          <div className='stats'>
            <Stat label='tâm' value={<span data-testid='center'>{`${center.lat.toFixed(2)}°, ${center.lng.toFixed(2)}°`}</span>} />
            <Stat label='mét / pixel ở zoom 12' value={metersPerPixel(center.lat, 12).toFixed(1)} />
            <Stat label='10 km = ? px ở zoom 12' value={(10000 / metersPerPixel(center.lat, 12)).toFixed(0)} />
          </div>
          <table className='merc-table' data-testid='table'>
            <thead>
              <tr>
                <th>Bán kính (px, zoom {STAT_ZOOM})</th>
                <th>rx</th>
                <th>ry</th>
                <th>lệch rx</th>
                <th>lệch ry</th>
              </tr>
            </thead>
            <tbody>
              {row('Thật (đo đa giác)', stats.truth, 'ok')}
              {row('Bản viết lại', stats.fixed, '')}
              {row('Bản gốc', stats.fb, 'warn')}
              {row('Ngây thơ', stats.naive, 'err')}
            </tbody>
          </table>
          <p className='hint'>
            Tâm của hình tròn ngây thơ lệch {(stats.naive.cy - stats.fixed.cy).toFixed(1)} px (zoom {STAT_ZOOM}) so với tâm thật trên
            bản đồ: phía cực bị kéo giãn nhiều hơn phía xích đạo.
            {stats.fixed.coversPole && ' Vòng tròn đã chứa cực: trên Mercator nó không còn là hình kín, bản gốc ra NaN.'}
          </p>
        </div>
      </div>
    </div>
  );
}
