/**
 * Mô phỏng thứ tự các bước của ContextualLayerAutoFlip._adjustOrientation (KHÔNG phải mã
 * của Facebook) để so với bản viết lại. Điểm khác duy nhất: ở bước "tràn ít nhất", bản gốc
 * đo phần tràn với căn lề còn sót lại sau vòng lặp bước 1 (căn lề cuối danh sách).
 */
import {
  contains,
  horizontalOverlap,
  layerRect,
  overflow,
  type Alignment,
  type Placement,
  type PlacementInput,
  type Position,
} from '../lib/autoFlip';

const ALIGNMENTS: Alignment[] = ['left', 'center', 'right'];

export function choosePlacementFbStyle(input: PlacementInput): Placement {
  const { preferred, topInset = 43 } = input;
  const positions: Position[] = [preferred.position, preferred.position === 'above' ? 'below' : 'above'];
  const alignments = [preferred.alignment, ...ALIGNMENTS.filter((a) => a !== preferred.alignment)];

  for (const a of alignments) {
    for (const p of positions) {
      const r = layerRect(input, p, a);
      if (contains(input.viewport, r)) return { position: p, alignment: a, rect: r, overflow: 0, reason: 'fits' };
    }
  }

  // căn lề "còn sót": vòng lặp trên kết thúc ở phần tử cuối
  const leftover = alignments[alignments.length - 1];
  let bestIndex = -1;
  let bestScore = 99999;
  positions.forEach((p, i) => {
    const r = layerRect(input, p, leftover);
    const inDoc = r.left >= 0 && r.left + r.width <= input.document.width && r.top >= topInset && r.top + r.height <= input.document.height;
    if (!inDoc) return;
    const score = overflow(input.viewport, r);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  });
  const position = bestIndex >= 0 ? positions[bestIndex] : positions.includes('below') ? 'below' : positions[0];

  let alignment = alignments[0];
  let bestOverlap = 0;
  for (const a of alignments) {
    const o = horizontalOverlap(input.viewport, layerRect(input, position, a));
    if (o > bestOverlap) {
      bestOverlap = o;
      alignment = a;
    }
  }
  const rect = layerRect(input, position, alignment);
  return {
    position,
    alignment,
    rect,
    overflow: overflow(input.viewport, rect),
    reason: bestIndex >= 0 ? 'least-overflow' : 'fallback',
  };
}
