/**
 * Chọn bố cục collage ảnh (ý tưởng từ ReactComposerCollageLayoutSelection + ReactComposerCollageLayoutModel
 * của Facebook).
 *
 * - Mỗi bố cục là DỮ LIỆU: danh sách ô trên lưới 6×6, ô thứ i dành cho ảnh thứ i.
 * - Mỗi bố cục được chấm điểm theo: ảnh bị cắt bao nhiêu, ảnh và ô có cùng hướng (ngang/dọc)
 *   không, và bố cục hiện được bao nhiêu ảnh.
 * - Chọn bố cục điểm cao nhất. Ảnh không có ô thì gom vào ô cuối dạng "+N".
 */

/** Ô trên lưới, theo thứ tự [top, right, bottom, left] giống Rect của Facebook. */
export type Cell = readonly [top: number, right: number, bottom: number, left: number];

export const ACTOR_USER = 1;
export const ACTOR_PAGE = 2;

export interface CollageLayout {
  /** bitmask: 1 = dùng cho người dùng, 2 = dùng cho Page, 3 = cả hai */
  validActors: number;
  cells: readonly Cell[];
}

/** Dữ liệu bố cục, chép đúng số liệu từ ReactComposerJSONCollageLayoutData (theo số ảnh). */
export const COLLAGE_LAYOUTS: readonly CollageLayout[] = [
  // 1 ảnh
  { validActors: 3, cells: [[0, 1, 1, 0]] },
  // 2 ảnh
  { validActors: 3, cells: [[0, 3, 3, 0], [0, 6, 3, 3]] }, // 2 ô vuông cạnh nhau
  { validActors: 3, cells: [[0, 6, 3, 0], [3, 6, 6, 0]] }, // 2 ô ngang chồng nhau
  { validActors: 3, cells: [[0, 3, 6, 0], [0, 6, 6, 3]] }, // 2 ô dọc cạnh nhau
  { validActors: 1, cells: [[0, 6, 2, 0], [2, 6, 4, 0]] }, // 2 dải ngang 3:1
  // 3 ảnh
  { validActors: 3, cells: [[0, 6, 3, 0], [3, 3, 6, 0], [3, 6, 6, 3]] }, // 1 to trên, 2 dưới
  { validActors: 3, cells: [[0, 3, 6, 0], [0, 6, 3, 3], [3, 6, 6, 3]] }, // 1 to trái, 2 phải
  { validActors: 2, cells: [[0, 2, 2, 0], [0, 4, 2, 2], [0, 6, 2, 4]] }, // 3 ô vuông một hàng
  { validActors: 1, cells: [[0, 6, 4, 0], [4, 3, 6, 0], [4, 6, 6, 3]] },
  { validActors: 1, cells: [[0, 4, 6, 0], [0, 6, 3, 4], [3, 6, 6, 4]] },
  { validActors: 1, cells: [[0, 6, 2, 0], [2, 6, 4, 0], [4, 6, 6, 0]] }, // 3 dải ngang
  { validActors: 1, cells: [[0, 2, 6, 0], [0, 4, 6, 2], [0, 6, 6, 4]] }, // 3 dải dọc
  // 4 ảnh
  { validActors: 3, cells: [[0, 3, 3, 0], [0, 6, 3, 3], [3, 3, 6, 0], [3, 6, 6, 3]] }, // lưới 2×2
  { validActors: 3, cells: [[0, 6, 4, 0], [4, 2, 6, 0], [4, 4, 6, 2], [4, 6, 6, 4]] }, // 1 to trên, 3 dưới
  { validActors: 3, cells: [[0, 4, 6, 0], [0, 6, 2, 4], [2, 6, 4, 4], [4, 6, 6, 4]] }, // 1 to trái, 3 phải
  // 5 ảnh
  { validActors: 1, cells: [[0, 3, 3, 0], [3, 3, 6, 0], [0, 6, 2, 3], [2, 6, 4, 3], [4, 6, 6, 3]] },
  { validActors: 1, cells: [[0, 3, 3, 0], [0, 6, 3, 3], [3, 2, 5, 0], [3, 4, 5, 2], [3, 6, 5, 4]] },
];

export const cellWidth = (c: Cell) => c[1] - c[3];
export const cellHeight = (c: Cell) => c[2] - c[0];

export type Orientation = 'landscape' | 'portrait' | 'square';

export function orientationOf(width: number, height: number): Orientation {
  return width > height ? 'landscape' : width < height ? 'portrait' : 'square';
}

/**
 * Tỉ lệ diện tích bị cắt khi ảnh (mw × mh) phủ kín ô (cw × ch) kiểu object-fit: cover.
 * Ví dụ ảnh 4:3 vào ô vuông: phóng ảnh cho cao bằng ô thì bề ngang dư 25% -> trả về 0.25.
 */
export function cropLoss(cw: number, ch: number, mw: number, mh: number): number {
  if (mw === 0 || mh === 0) return 0;
  // phóng ảnh cho rộng bằng ô: ảnh cao cw·mh/mw
  const scaledHeight = (cw * mh) / mw;
  if (scaledHeight >= ch) return (scaledHeight - ch) / scaledHeight; // dư chiều cao -> cắt trên/dưới
  // ngược lại phóng cho cao bằng ô: ảnh rộng ch·mw/mh
  const scaledWidth = (ch * mw) / mh;
  if (scaledWidth > cw) return (scaledWidth - cw) / scaledWidth; // dư chiều ngang -> cắt hai bên
  return 0;
}

export interface CellScore {
  loss: number;
  /** điểm của riêng ô này (âm) */
  points: number;
  reason: 'square-photo' | 'same-orientation' | 'different-orientation' | 'square-cell';
}

/**
 * Điểm cho một cặp (ô, ảnh), đúng công thức trong ReactComposerCollageLayoutModel.score:
 *   −100·k, sau đó
 *   ảnh vuông:                −5·k
 *   ô ngang/dọc, ảnh cùng hướng: +25·k
 *   ô ngang/dọc, ảnh khác hướng: −25·k
 *   ô vuông, ảnh không vuông:  −5·k
 * với k = tỉ lệ bị cắt. Để ý: mọi hạng tử đều nhân với k, nên ảnh không bị cắt thì hướng không
 * quan trọng; còn khi phải cắt, cắt "đúng hướng" (−75·k) đỡ phạt hơn cắt "ngược hướng" (−125·k).
 */
export function scoreCell(cell: Cell, media: readonly [width: number, height: number]): CellScore {
  const cw = cellWidth(cell);
  const ch = cellHeight(cell);
  const [mw, mh] = media;
  const k = cropLoss(cw, ch, mw, mh);
  let points = -k * 100;
  let reason: CellScore['reason'];
  if (mw === mh) {
    points -= k * 5;
    reason = 'square-photo';
  } else if (cw !== ch) {
    const sameOrientation = (cw > ch) === (mw > mh);
    points += sameOrientation ? k * 25 : -k * 25;
    reason = sameOrientation ? 'same-orientation' : 'different-orientation';
  } else {
    points -= k * 5;
    reason = 'square-cell';
  }
  return { loss: k, points, reason };
}

export interface LayoutScore {
  layout: CollageLayout;
  cells: CellScore[];
  /** +200 cho mỗi ô: bố cục chứa nhiều ảnh hơn luôn thắng (mức phạt cắt tối đa chỉ 125/ô) */
  countBonus: number;
  total: number;
}

export function scoreLayout(layout: CollageLayout, media: readonly (readonly [number, number])[]): LayoutScore {
  // ghép ô i với ảnh i; thừa bên nào thì bỏ bên đó (giống zip của Facebook)
  const n = Math.min(layout.cells.length, media.length);
  const cells = Array.from({ length: n }, (_, i) => scoreCell(layout.cells[i], media[i]));
  const countBonus = 200 * layout.cells.length;
  const total = cells.reduce((sum, c) => sum + c.points, 0) + countBonus;
  return { layout, cells, countBonus, total };
}

export interface PlacedCell {
  /** chỉ số ảnh trong danh sách gốc */
  mediaIndex: number;
  cell: Cell;
}

export interface CollageResult {
  placed: PlacedCell[];
  /** tất cả bố cục đã xét kèm điểm (để debug / demo) */
  candidates: LayoutScore[];
  winner: LayoutScore | null;
  /** số hiển thị trên ô cuối, 0 nếu hiện đủ */
  overflowCount: number;
}

/**
 * Người dùng: xét mọi bố cục cho USER có số ô ≤ số ảnh, lấy điểm cao nhất
 * (bằng điểm thì giữ bố cục đứng trước, vì so sánh dùng dấu > ).
 */
export function selectUserLayout(media: readonly (readonly [number, number])[]): CollageResult {
  const candidates = COLLAGE_LAYOUTS.filter(
    (l) => l.validActors & ACTOR_USER && l.cells.length <= media.length,
  ).map((l) => scoreLayout(l, media));
  let winner: LayoutScore | null = null;
  for (const c of candidates) if (winner === null || c.total > winner.total) winner = c;
  return finalize(media.length, candidates, winner);
}

/**
 * Page: không chấm điểm. Lấy bố cục đầu tiên có đúng số ô (tối đa số ô Page hỗ trợ) mà ô đầu
 * tiên cùng hướng với ảnh đầu tiên.
 */
export function selectPageLayout(media: readonly (readonly [number, number])[]): CollageResult {
  const pageLayouts = COLLAGE_LAYOUTS.filter((l) => l.validActors & ACTOR_PAGE);
  const maxCells = Math.max(...pageLayouts.map((l) => l.cells.length));
  const count = Math.min(maxCells, media.length);
  const first = media[0];
  const candidates = pageLayouts.filter((l) => l.cells.length === count).map((l) => scoreLayout(l, media));
  const winner =
    candidates.find(
      (c) =>
        first != null &&
        orientationOf(cellWidth(c.layout.cells[0]), cellHeight(c.layout.cells[0])) === orientationOf(first[0], first[1]),
    ) ?? null;
  return finalize(media.length, candidates, winner);
}

function finalize(total: number, candidates: LayoutScore[], winner: LayoutScore | null): CollageResult {
  const shown = winner ? Math.min(winner.layout.cells.length, total) : 0;
  const placed = winner
    ? winner.layout.cells.slice(0, shown).map((cell, mediaIndex) => ({ mediaIndex, cell }))
    : [];
  // Ô cuối bị che bởi lớp "+N", nên N tính cả chính ảnh ở ô cuối: 7 ảnh, hiện 5 ô -> "+3"
  // (giống CometAlbumGridLayout: totalNumItems − số ô + 1).
  const overflowCount = total === shown ? 0 : total - shown + 1;
  return { placed, candidates, winner, overflowCount };
}

/** Kích thước lưới thực tế của bố cục (bố cục 1 ảnh chỉ là lưới 1×1). */
export function gridSize(placed: readonly PlacedCell[]) {
  return {
    columns: placed.reduce((m, p) => Math.max(m, p.cell[1]), 0),
    rows: placed.reduce((m, p) => Math.max(m, p.cell[2]), 0),
  };
}
