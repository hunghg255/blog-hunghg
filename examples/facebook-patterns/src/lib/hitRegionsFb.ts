/**
 * Mô phỏng hành vi của CandelaPathRegionBuilder bản gốc để demo so sánh
 * (viết lại theo hành vi đọc được, không phải mã gốc):
 * - moveTo/lineTo tạo polygon, ellipse tạo vùng ellipse (bỏ rotation, tham số thứ 8 là tỉ lệ lỗ donut);
 * - rect() không tạo vùng nào (lớp Rect dựng polygon cục bộ rồi bỏ đi);
 * - arc/arcTo/bezierCurveTo/quadraticCurveTo ném "not implemented";
 * - hộp bao của ellipse chỉ nới nửa ngưỡng, nên vùng "gần" bị cắt;
 * - ellipse tô kín (tỉ lệ lỗ 0) có bán kính trong = 0 − ngưỡng < 0, bình phương lên thành lỗ bán kính = ngưỡng.
 */
import { distanceToSegment, type PathSink, type Pt, type Rect } from './hitRegions';

export interface FbRegion {
  id: string;
  bounds: Rect;
  hover(p: Pt): boolean;
  proximity(p: Pt): boolean;
}

interface Opts {
  fill?: boolean;
  hoverThreshold?: number;
  proximityThreshold?: number;
}

export class FbStyleBuilder implements PathSink {
  private shapes: Array<{ kind: 'poly'; pts: Pt[] } | { kind: 'ellipse'; c: Pt; rx: number; ry: number; inner: number; a0?: number; a1?: number }> = [];
  private poly: Pt[] | null = null;
  private pen: Pt = { x: 0, y: 0 };

  moveTo(x: number, y: number) {
    this.pen = { x, y }; // chỉ dời bút, polygon hiện tại vẫn mở
  }
  lineTo(x: number, y: number) {
    if (!this.poly) {
      this.poly = [this.pen];
      this.shapes.push({ kind: 'poly', pts: this.poly });
    }
    this.poly.push({ x, y });
    this.pen = { x, y };
  }
  closePath() {
    if (this.poly) {
      const a = this.poly[0], b = this.poly[this.poly.length - 1];
      if (a.x !== b.x || a.y !== b.y) this.poly.push(a);
    }
  }
  rect() {
    this.poly = null; // không push gì: rect không thành vùng
  }
  ellipse(x: number, y: number, rx: number, ry: number, _rotation: number, a0: number, a1: number, innerRatio?: boolean | number) {
    this.poly = null;
    this.shapes.push({ kind: 'ellipse', c: { x, y }, rx, ry, inner: Number(innerRatio) || 0, a0, a1 });
  }
  arc(): void {
    throw new Error('Path2D.arc not implemented!');
  }
  bezierCurveTo(): void {
    throw new Error('Path2D.bezierCurveTo not implemented!');
  }
  quadraticCurveTo(): void {
    throw new Error('Path2D.quadraticCurveTo not implemented!');
  }

  build(id: string, o: Opts): FbRegion[] {
    const ht = o.hoverThreshold ?? 0, pt = o.proximityThreshold ?? 0, pad = Math.max(ht, pt);
    return this.shapes.map((s) => {
      if (s.kind === 'poly') {
        const xs = s.pts.map((p) => p.x), ys = s.pts.map((p) => p.y);
        const bounds = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, width: Math.max(...xs) - Math.min(...xs) + 2 * pad, height: Math.max(...ys) - Math.min(...ys) + 2 * pad };
        const dist = (p: Pt) => s.pts.slice(1).reduce((m, b, i) => Math.min(m, distanceToSegment(p, s.pts[i], b)), Infinity);
        const inside = (p: Pt) => {
          let c = false;
          for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) {
            const a = s.pts[i], b = s.pts[j];
            if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
          }
          return c;
        };
        return { id, bounds, hover: (p: Pt) => (!!o.fill && inside(p)) || dist(p) <= ht, proximity: (p: Pt) => dist(p) <= pt };
      }
      const { c, rx, ry } = s;
      const inner = o.fill ? s.inner : 1;
      // bán kính trong = rx·tỉ lệ − ngưỡng có thể âm; bình phương lên lại dương, thành một cái lỗ
      const inEllipse = (p: Pt, ax: number, ay: number) => {
        const dx = p.x - c.x, dy = p.y - c.y;
        return (dx * dx) / (ax * ax) + (dy * dy) / (ay * ay) <= 1;
      };
      const ring = (p: Pt, t: number) => inEllipse(p, rx + t, ry + t) && !inEllipse(p, rx * inner - t, ry * inner - t);
      // hộp bao chỉ nới nửa ngưỡng mỗi bên
      const bounds = { x: c.x - rx - pad / 2, y: c.y - ry - pad / 2, width: 2 * rx + pad, height: 2 * ry + pad };
      return { id, bounds, hover: (p: Pt) => ring(p, ht), proximity: (p: Pt) => ring(p, pt) };
    });
  }
}

const inRect = (p: Pt, r: Rect) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

export function fbQuery(regions: FbRegion[], p: Pt) {
  const candidates = regions.filter((r) => inRect(p, r.bounds)).reverse();
  return { hover: candidates.filter((r) => r.hover(p)), proximity: candidates.filter((r) => r.proximity(p)) };
}
