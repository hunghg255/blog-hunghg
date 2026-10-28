/**
 * Chọn vị trí cho popover/tooltip quanh một "anchor" (ý tưởng từ ContextualLayerAutoFlip
 * và AbstractContextualDialogArrowBehavior của Facebook):
 *  1. Thử (căn lề × phía) theo thứ tự ưu tiên; cái nào nằm gọn trong viewport thì lấy.
 *  2. Không cái nào vừa: chọn phía có tổng phần tràn ra ngoài viewport nhỏ nhất,
 *     nhưng chỉ xét các vị trí vẫn nằm trong document và không chui dưới thanh điều hướng.
 *  3. Cuối cùng chọn căn lề có phần giao theo chiều ngang với viewport lớn nhất.
 * Mũi tên được đặt bằng (phần trăm + margin), và nếu anchor nhỏ hơn mũi tên thì
 * dịch cả layer để mũi tên chỉ đúng tâm anchor.
 */

export type Position = 'above' | 'below';
export type Alignment = 'left' | 'center' | 'right';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const right = (r: Rect) => r.left + r.width;
const bottom = (r: Rect) => r.top + r.height;

export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.left >= outer.left && inner.top >= outer.top && right(inner) <= right(outer) && bottom(inner) <= bottom(outer)
  );
}

/** Tổng phần tràn (theo pixel) ở 4 cạnh; 0 nghĩa là nằm gọn. */
export function overflow(viewport: Rect, r: Rect): number {
  return (
    Math.max(0, viewport.left - r.left) +
    Math.max(0, right(r) - right(viewport)) +
    Math.max(0, viewport.top - r.top) +
    Math.max(0, bottom(r) - bottom(viewport))
  );
}

/** Độ dài phần giao theo chiều ngang. */
export function horizontalOverlap(viewport: Rect, r: Rect): number {
  return Math.max(0, Math.min(right(viewport), right(r)) - Math.max(viewport.left, r.left));
}

export interface LayerGeometry {
  anchor: Rect;
  size: { width: number; height: number };
  /** khoảng cách giữa anchor và layer (chỗ cho mũi tên) */
  gap: number;
}

export function layerRect({ anchor, size, gap }: LayerGeometry, position: Position, alignment: Alignment): Rect {
  const left =
    alignment === 'left'
      ? anchor.left
      : alignment === 'right'
        ? right(anchor) - size.width
        : anchor.left + anchor.width / 2 - size.width / 2;
  const top = position === 'above' ? anchor.top - gap - size.height : bottom(anchor) + gap;
  return { left, top, width: size.width, height: size.height };
}

export interface PlacementInput extends LayerGeometry {
  /** viewport tính theo toạ độ document */
  viewport: Rect;
  /** kích thước toàn document */
  document: { width: number; height: number };
  preferred: { position: Position; alignment: Alignment };
  /** vùng trên cùng bị thanh điều hướng che (Facebook: 43px) */
  topInset?: number;
}

export interface Placement {
  position: Position;
  alignment: Alignment;
  rect: Rect;
  overflow: number;
  reason: 'fits' | 'least-overflow' | 'fallback';
}

const opposite = (p: Position): Position => (p === 'above' ? 'below' : 'above');
const ALIGNMENTS: Alignment[] = ['left', 'center', 'right'];

function alignmentOrder(preferred: Alignment): Alignment[] {
  return [preferred, ...ALIGNMENTS.filter((a) => a !== preferred)];
}

function bestAlignment(input: PlacementInput, position: Position, order: Alignment[]): Alignment {
  let best = order[0];
  let bestOverlap = 0;
  for (const a of order) {
    const overlap = horizontalOverlap(input.viewport, layerRect(input, position, a));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = a;
    }
  }
  return best;
}

function finish(input: PlacementInput, position: Position, alignment: Alignment, reason: Placement['reason']): Placement {
  const rect = layerRect(input, position, alignment);
  return { position, alignment, rect, overflow: overflow(input.viewport, rect), reason };
}

/**
 * Bản viết lại. Khác bản gốc ở bước 2: phần tràn của mỗi phía được tính với căn lề
 * tốt nhất của chính phía đó, không phải với căn lề còn sót lại từ vòng lặp bước 1.
 */
export function choosePlacement(input: PlacementInput): Placement {
  const { preferred, topInset = 43 } = input;
  const positions: Position[] = [preferred.position, opposite(preferred.position)];
  const alignments = alignmentOrder(preferred.alignment);

  for (const a of alignments) {
    for (const p of positions) {
      if (contains(input.viewport, layerRect(input, p, a))) return finish(input, p, a, 'fits');
    }
  }

  let best: { p: Position; score: number } | null = null;
  for (const p of positions) {
    const a = bestAlignment(input, p, alignments);
    const r = layerRect(input, p, a);
    const insideDocument = r.left >= 0 && right(r) <= input.document.width && r.top >= topInset && bottom(r) <= input.document.height;
    if (!insideDocument) continue;
    const score = overflow(input.viewport, r);
    if (!best || score < best.score) best = { p, score };
  }
  if (best) return finish(input, best.p, bestAlignment(input, best.p, alignments), 'least-overflow');

  const fallback = positions.includes('below') ? 'below' : positions[0];
  return finish(input, fallback, bestAlignment(input, fallback, alignments), 'fallback');
}

// ---- Mũi tên ----

export interface ArrowInput {
  position: Position;
  alignment: Alignment;
  /** bề rộng anchor */
  anchorWidth: number;
  /** chiều dài cạnh mũi tên và khoảng cách tối thiểu tới góc layer */
  arrow: { length: number; offset: number };
  rtl?: boolean;
}

export interface ArrowPlacement {
  /** cạnh dùng để định vị mũi tên trong layer */
  side: 'left' | 'right';
  /** vị trí theo phần trăm bề rộng layer */
  percent: number;
  /** margin cộng thêm (px), có thể âm */
  margin: number;
  /**
   * Dịch layer theo chiều ngang (px). Anchor hẹp hơn mũi tên + 2×offset thì mũi tên ở góc
   * sẽ lệch khỏi anchor; dịch layer để đỉnh mũi tên rơi đúng tâm anchor.
   */
  layerShift: number;
}

export function arrowPlacement({ alignment, anchorWidth, arrow, rtl = false }: ArrowInput): ArrowPlacement {
  const percent = alignment === 'center' ? 50 : alignment === 'right' ? 100 : 0;
  let margin = (alignment === 'center' ? 0 : arrow.offset) + (arrow.length * percent) / 100;
  if (alignment !== 'left') margin = -margin;

  let layerShift = 0;
  if (alignment !== 'center' && anchorWidth < arrow.length + arrow.offset * 2) {
    const shift = arrow.length / 2 + arrow.offset - anchorWidth / 2;
    // căn trái: kéo layer sang trái; căn phải: đẩy sang phải
    layerShift = alignment === 'left' ? -shift : shift;
  }
  return { side: rtl ? 'right' : 'left', percent, margin, layerShift };
}
