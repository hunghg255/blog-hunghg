/**
 * Hit-test cho hình vẽ trên canvas bằng cách "phát lại" lệnh path vào một bộ ghi
 * có cùng API với CanvasPath, làm phẳng đường cong thành đa giác, rồi hỏi
 * "chuột đang ở trên hình nào" mà không cần DOM cho từng hình.
 * Ý tưởng từ CandelaPathRegionBuilder / CandelaRegionManager và art/core/path (Facebook),
 * viết lại từ đầu, có thêm cung và Bézier.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Subpath {
  points: Pt[];
  closed: boolean;
}

/** Tập con của CanvasPath mà cả ctx thật lẫn bộ ghi đều có. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number, ccw?: boolean): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number, ccw?: boolean): void;
  rect(x: number, y: number, w: number, h: number): void;
  closePath(): void;
}

const TAU = Math.PI * 2;

/** Ghi lệnh path và làm phẳng thành các đường gấp khúc. */
export class PathRecorder implements PathSink {
  readonly subpaths: Subpath[] = [];
  private current: Subpath | null = null;
  private pen: Pt = { x: 0, y: 0 };

  /** tolerance: sai số tối đa (px) giữa đường cong thật và đoạn thẳng thay thế. */
  constructor(private readonly tolerance = 0.25) {}

  get segmentCount() {
    return this.subpaths.reduce((n, s) => n + Math.max(0, s.points.length - 1) + (s.closed ? 1 : 0), 0);
  }

  moveTo(x: number, y: number) {
    this.current = { points: [{ x, y }], closed: false };
    this.subpaths.push(this.current);
    this.pen = { x, y };
  }

  lineTo(x: number, y: number) {
    if (!this.current) {
      this.moveTo(x, y); // giống canvas: lineTo đầu tiên đóng vai moveTo
      return;
    }
    this.current.points.push({ x, y });
    this.pen = { x, y };
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    if (!this.current) this.moveTo(c1x, c1y);
    const p0 = this.pen;
    flattenCubic(p0, { x: c1x, y: c1y }, { x: c2x, y: c2y }, { x, y }, this.tolerance, this.current!.points, 0);
    this.pen = { x, y };
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    const p0 = this.pen;
    // nâng bậc: Q(P0, C, P1) = C(P0, (P0 + 2C)/3, (P1 + 2C)/3, P1)
    this.bezierCurveTo(
      (p0.x + 2 * cx) / 3, (p0.y + 2 * cy) / 3,
      (x + 2 * cx) / 3, (y + 2 * cy) / 3,
      x, y,
    );
  }

  arc(x: number, y: number, r: number, start: number, end: number, ccw = false) {
    this.ellipse(x, y, r, r, 0, start, end, ccw);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, rotation: number, start: number, end: number, ccw = false) {
    let sweep = end - start;
    // chuẩn hoá như canvas: quét tối đa một vòng, đúng chiều
    if (!ccw && sweep < 0) sweep = (sweep % TAU) + TAU;
    if (ccw && sweep > 0) sweep = (sweep % TAU) - TAU;
    if (Math.abs(sweep) > TAU) sweep = Math.sign(sweep) * TAU;
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const at = (t: number, dx = 0, dy = 0): Pt => {
      const ex = rx * Math.cos(t) + dx, ey = ry * Math.sin(t) + dy;
      return { x: cx + ex * cos - ey * sin, y: cy + ex * sin + ey * cos };
    };
    const first = at(start);
    // canvas nối đường thẳng từ bút hiện tại tới điểm đầu cung
    if (this.current) this.lineTo(first.x, first.y);
    else this.moveTo(first.x, first.y);
    // chia cung thành các đoạn ≤ 90°, mỗi đoạn là một cubic với k = 4/3·tan(θ/4)
    const parts = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const step = sweep / parts;
    const k = (4 / 3) * Math.tan(step / 4);
    let t = start;
    for (let i = 0; i < parts; i++) {
      const t2 = t + step;
      const c1 = at(t, -k * rx * Math.sin(t), k * ry * Math.cos(t));
      const c2 = at(t2, k * rx * Math.sin(t2), -k * ry * Math.cos(t2));
      const p = at(t2);
      this.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
      t = t2;
    }
  }

  rect(x: number, y: number, w: number, h: number) {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }

  closePath() {
    if (!this.current) return;
    this.current.closed = true;
    const start = this.current.points[0];
    // canvas: sau closePath bút về điểm đầu, lệnh tiếp theo mở subpath mới
    this.current = null;
    this.pen = { ...start };
  }
}

/** de Casteljau thích nghi: chia đôi tới khi hai control point đủ gần dây cung. */
function flattenCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol: number, out: Pt[], depth: number) {
  const flat = distToLine(p1, p0, p3) <= tol && distToLine(p2, p0, p3) <= tol;
  if (flat || depth > 16) {
    out.push(p3);
    return;
  }
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const a = mid(p0, p1), b = mid(p1, p2), c = mid(p2, p3);
  const d = mid(a, b), e = mid(b, c), m = mid(d, e);
  flattenCubic(p0, a, d, m, tol, out, depth + 1);
  flattenCubic(m, e, c, p3, tol, out, depth + 1);
}

function distToLine(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/** Khoảng cách từ p tới đoạn ab: chiếu vuông góc, kẹp t vào [0, 1]. */
export function distanceToSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export type FillRule = 'nonzero' | 'evenodd';

/** Điểm có nằm trong vùng tô không. Subpath chưa đóng vẫn được tô như canvas (tự nối về đầu). */
export function pointInSubpaths(p: Pt, subpaths: Subpath[], rule: FillRule = 'nonzero') {
  let winding = 0;
  for (const { points } of subpaths) {
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const a = points[i], b = points[(i + 1) % n];
      if (a.y <= p.y) {
        if (b.y > p.y && cross(a, b, p) > 0) winding++; // cạnh đi lên, p bên trái
      } else if (b.y <= p.y && cross(a, b, p) < 0) winding--; // cạnh đi xuống, p bên phải
    }
  }
  return rule === 'nonzero' ? winding !== 0 : (winding & 1) === 1;
}

const cross = (a: Pt, b: Pt, p: Pt) => (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionOptions {
  fill?: boolean;
  stroke?: boolean;
  /** khoảng cách (px) tới nét vẫn tính là "trúng" */
  hoverThreshold?: number;
  /** khoảng cách (px) tính là "ở gần", dùng cho tooltip, snap */
  proximityThreshold?: number;
  fillRule?: FillRule;
  data?: unknown;
}

export interface HitRegion extends Required<Omit<RegionOptions, 'data'>> {
  id: string;
  subpaths: Subpath[];
  /** hộp bao đã nới ra bằng ngưỡng lớn nhất, dùng để lọc nhanh */
  bounds: Rect;
  data?: unknown;
}

export function buildRegion(id: string, draw: (sink: PathSink) => void, opts: RegionOptions = {}, tolerance = 0.25): HitRegion {
  const rec = new PathRecorder(tolerance);
  draw(rec);
  const hoverThreshold = opts.hoverThreshold ?? 0;
  const proximityThreshold = opts.proximityThreshold ?? 0;
  const pad = Math.max(hoverThreshold, proximityThreshold);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of rec.subpaths)
    for (const p of s.points) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
  return {
    id,
    subpaths: rec.subpaths,
    fill: opts.fill ?? false,
    stroke: opts.stroke ?? !opts.fill,
    hoverThreshold,
    proximityThreshold,
    fillRule: opts.fillRule ?? 'nonzero',
    data: opts.data,
    // nới đủ cả ngưỡng: điểm cách nét đúng `pad` px vẫn lọt qua bước lọc nhanh
    bounds: { x: x0 - pad, y: y0 - pad, width: x1 - x0 + 2 * pad, height: y1 - y0 + 2 * pad },
  };
}

/** Khoảng cách nhỏ nhất từ p tới nét của vùng (cạnh đóng của subpath kín cũng tính). */
export function distanceToOutline(p: Pt, region: HitRegion) {
  let best = Infinity;
  for (const { points, closed } of region.subpaths) {
    if (points.length === 1) best = Math.min(best, Math.hypot(p.x - points[0].x, p.y - points[0].y));
    for (let i = 1; i < points.length; i++) best = Math.min(best, distanceToSegment(p, points[i - 1], points[i]));
    if (closed && points.length > 2) best = Math.min(best, distanceToSegment(p, points[points.length - 1], points[0]));
  }
  return best;
}

export function hoverTest(region: HitRegion, p: Pt) {
  if (region.fill && pointInSubpaths(p, region.subpaths, region.fillRule)) return true;
  return distanceToOutline(p, region) <= region.hoverThreshold;
}

export function proximityTest(region: HitRegion, p: Pt) {
  if (region.fill && pointInSubpaths(p, region.subpaths, region.fillRule)) return true;
  return distanceToOutline(p, region) <= region.proximityThreshold;
}

const inRect = (p: Pt, r: Rect) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/** Danh sách vùng theo thứ tự vẽ; query trả về vùng nằm trên cùng trước. */
export class RegionIndex {
  private regions = new Map<string, HitRegion>();

  set(region: HitRegion) {
    this.regions.delete(region.id); // thêm lại = đưa lên trên cùng
    this.regions.set(region.id, region);
  }

  delete(id: string) {
    return this.regions.delete(id);
  }

  clear() {
    this.regions.clear();
  }

  get size() {
    return this.regions.size;
  }

  query(p: Pt): { hover: HitRegion[]; proximity: HitRegion[]; candidates: number } {
    const candidates = [...this.regions.values()].filter((r) => inRect(p, r.bounds)).reverse();
    return {
      hover: candidates.filter((r) => hoverTest(r, p)),
      proximity: candidates.filter((r) => proximityTest(r, p)),
      candidates: candidates.length,
    };
  }
}

/**
 * Cắt một đường gấp khúc thành các gạch theo độ dài thật.
 * pattern = [gạch, khoảng, gạch, khoảng…]; pha được giữ qua các đỉnh.
 */
export function dashPolyline(points: Pt[], pattern: number[], offset = 0): Pt[][] {
  const pat = pattern.length % 2 ? [...pattern, ...pattern] : pattern; // như setLineDash
  const total = pat.reduce((a, b) => a + b, 0);
  if (points.length < 2 || total <= 0 || pat.some((v) => v < 0 || !Number.isFinite(v))) return [points];
  const dashes: Pt[][] = [];
  let idx = 0;
  let left = pat[0];
  let phase = ((offset % total) + total) % total;
  while (phase > 0) { // bỏ qua phần offset
    const take = Math.min(phase, left);
    phase -= take; left -= take;
    if (left === 0) { idx = (idx + 1) % pat.length; left = pat[idx]; }
  }
  let current: Pt[] | null = idx % 2 === 0 ? [points[0]] : null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let pos = 0;
    while (pos < len) {
      const take = Math.min(left, len - pos);
      pos += take; left -= take;
      const t = pos / len; // tham số hoá theo độ dài, không theo từng trục
      const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (current) current.push(q);
      if (left <= 1e-9) {
        if (current) { dashes.push(current); current = null; } else current = [q];
        idx = (idx + 1) % pat.length;
        left = pat[idx];
      }
    }
  }
  if (current && current.length > 1) dashes.push(current);
  return dashes;
}

/**
 * Cách của CandelaUtils.art.drawDashedPath (viết lại để so sánh): cộng `dash` vào x và y
 * độc lập, mỗi trục tự kẹp về đích. Có trần số vòng vì dash = 0 sẽ lặp vô hạn.
 */
export function axisDashedPath(from: Pt, to: Pt, pattern: number[], maxSteps = 10_000): { dashes: Pt[][]; steps: number; stuck: boolean } {
  const toward = (v: number, target: number, d: number) => (v < target ? Math.min(v + d, target) : Math.max(v - d, target));
  let x = from.x, y = from.y, i = 0, steps = 0;
  const next = () => pattern[i++ % pattern.length];
  const dashes: Pt[][] = [];
  while ((x !== to.x || y !== to.y) && steps < maxSteps) {
    steps++;
    const start = { x, y };
    let d = next();
    x = toward(x, to.x, d); y = toward(y, to.y, d);
    dashes.push([start, { x, y }]);
    d = next();
    x = toward(x, to.x, d); y = toward(y, to.y, d);
  }
  return { dashes, steps, stuck: steps >= maxSteps };
}

export function polylineLength(points: Pt[]) {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return n;
}
