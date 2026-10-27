/**
 * Lưới điều hướng bằng phím mũi tên 2D (ý tưởng từ FocusTable.react của Facebook)
 * và focus không làm cuộn trang (ý tưởng từ FocusManager.react).
 *
 * - Ô có colSpan: đi lên/xuống giữ đúng CỘT thật, không phải chỉ số trong hàng.
 * - RTL: ArrowLeft/ArrowRight đổi vai trò cho nhau.
 * - Home/End trong hàng, Ctrl+Home/End về đầu/cuối bảng, PageUp/PageDown nhảy 5 hàng.
 * - Hàng toàn ô disabled bị bỏ qua.
 * - Roving tabindex: chỉ một ô có tabIndex=0, Tab đi thẳng ra khỏi lưới.
 */

export interface GridCell {
  el: HTMLElement;
  /** số cột ô chiếm, mặc định 1 */
  colSpan?: number;
  disabled?: boolean;
  /** nhãn để tìm ô theo loại (vd 'action'), giống getCellByTag */
  tag?: string;
}

export interface GridPosition {
  row: number;
  /** chỉ số ô trong hàng (không phải cột) */
  index: number;
}

export interface GridOptions {
  rtl?: boolean;
  /** ArrowLeft ở ô đầu → ô cuối cùng hàng (và ngược lại) */
  wrapX?: boolean;
  /** ArrowUp ở hàng đầu → hàng cuối (và ngược lại) */
  wrapY?: boolean;
  /** ArrowRight ở ô cuối → ô đầu của hàng sau */
  wrapXToNextLine?: boolean;
  /** số hàng PageUp/PageDown nhảy, mặc định 5 như Facebook */
  pageJumpSize?: number;
}

export type GridKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End' | 'PageUp' | 'PageDown';

const enabled = (row: GridCell[]) => row.filter((cell) => !cell.disabled);

/** Hàng có ít nhất một ô dùng được. Facebook bỏ hẳn hàng toàn ô disabled khỏi việc điều hướng. */
function usableRows(grid: GridCell[][]) {
  return grid.map((row, i) => ({ row: enabled(row), original: i })).filter((r) => r.row.length > 0);
}

/** Cột bắt đầu của ô thứ `index`: cộng colSpan của các ô đứng trước. */
export function startColumn(row: GridCell[], index: number) {
  let col = 0;
  for (let i = 0; i < index; i++) col += row[i].colSpan ?? 1;
  return col;
}

/** Ô phủ cột `col`. Hàng ngắn hơn thì trả ô cuối (giống Facebook). */
export function cellIndexAtColumn(row: GridCell[], col: number, tag?: string) {
  let end = 0;
  for (let i = 0; i < row.length; i++) {
    end += row[i].colSpan ?? 1;
    if (end > col && (tag === undefined || row[i].tag === tag)) return i;
  }
  return tag === undefined && row.length > 0 ? row.length - 1 : -1;
}

/**
 * Tính ô kế tiếp cho một phím. Làm việc trên ô "dùng được" (đã lọc disabled),
 * trả về vị trí theo chỉ số GỐC trong `grid` để gọi focus.
 */
export function nextPosition(
  grid: GridCell[][],
  current: GridPosition,
  key: GridKey,
  { ctrl = false }: { ctrl?: boolean } = {},
  options: GridOptions = {},
): GridPosition | null {
  const { rtl = false, wrapX = false, wrapY = false, wrapXToNextLine = false, pageJumpSize = 5 } = options;
  const rows = usableRows(grid);
  const rowIdx = rows.findIndex((r) => r.original === current.row);
  if (rowIdx === -1) return null;
  const row = rows[rowIdx].row;
  const cellIdx = row.indexOf(grid[current.row][current.index]);
  if (cellIdx === -1) return null;
  const col = startColumn(row, cellIdx);

  // Trong giao diện phải-sang-trái, mũi tên trái đi tới ô "kế tiếp"
  let k: GridKey = key;
  if (rtl && key === 'ArrowLeft') k = 'ArrowRight';
  else if (rtl && key === 'ArrowRight') k = 'ArrowLeft';

  const at = (r: number, i: number): GridPosition => {
    const target = rows[r].row[i];
    return { row: rows[r].original, index: grid[rows[r].original].indexOf(target) };
  };
  const sameColumn = (r: number) => at(r, cellIndexAtColumn(rows[r].row, col));
  const last = rows.length - 1;

  switch (k) {
    case 'ArrowRight':
      if (cellIdx < row.length - 1) return at(rowIdx, cellIdx + 1);
      if (wrapX) return at(rowIdx, 0);
      if (wrapXToNextLine && rowIdx < last) return at(rowIdx + 1, 0);
      return null;
    case 'ArrowLeft':
      if (cellIdx > 0) return at(rowIdx, cellIdx - 1);
      if (wrapX) return at(rowIdx, row.length - 1);
      if (wrapXToNextLine && rowIdx > 0) return at(rowIdx - 1, rows[rowIdx - 1].row.length - 1);
      return null;
    case 'ArrowDown':
      if (ctrl) return rowIdx === last ? null : sameColumn(last);
      if (rowIdx < last) return sameColumn(rowIdx + 1);
      return wrapY ? sameColumn(0) : null;
    case 'ArrowUp':
      if (ctrl) return rowIdx === 0 ? null : sameColumn(0);
      if (rowIdx > 0) return sameColumn(rowIdx - 1);
      return wrapY ? sameColumn(last) : null;
    case 'PageDown':
      return rowIdx === last ? null : sameColumn(Math.min(last, rowIdx + pageJumpSize));
    case 'PageUp':
      return rowIdx === 0 ? null : sameColumn(Math.max(0, rowIdx - pageJumpSize));
    case 'Home':
      if (ctrl) return rowIdx === 0 && cellIdx === 0 ? null : at(0, 0);
      return cellIdx === 0 ? null : at(rowIdx, 0);
    case 'End':
      if (ctrl) {
        const lastRow = rows[last].row;
        return rowIdx === last && cellIdx === row.length - 1 ? null : at(last, lastRow.length - 1);
      }
      // Bản gốc so chỉ số với chính object ô (luôn khác) nên End luôn focus lại; ở đây so chỉ số.
      return cellIdx === row.length - 1 ? null : at(rowIdx, row.length - 1);
  }
}

/**
 * Tìm ô có `tag`, ưu tiên gần cột hiện tại: xoè dần sang trái/phải trong hàng hiện tại,
 * rồi các hàng phía sau (quay vòng). Giống getCellByTag của Facebook.
 */
export function findCellByTag(grid: GridCell[][], current: GridPosition, tag: string): GridPosition | null {
  const rows = usableRows(grid);
  const start = Math.max(0, rows.findIndex((r) => r.original === current.row));
  const cur = grid[current.row][current.index];
  const col = startColumn(enabled(grid[current.row]), enabled(grid[current.row]).indexOf(cur));
  for (let step = 0; step < rows.length; step++) {
    const { row, original } = rows[(start + step) % rows.length];
    // cột cần xét lần lượt: col, col-1, col+1, col-2, col+2…
    const width = startColumn(row, row.length);
    for (let d = 0; d <= width; d++) {
      for (const c of d === 0 ? [col] : [col - d, col + d]) {
        if (c < 0 || c >= width) continue;
        const i = cellIndexAtColumn(row, c, undefined);
        if (row[i]?.tag === tag) return { row: original, index: grid[original].indexOf(row[i]) };
      }
    }
  }
  return null;
}

/** Roving tabindex: chỉ ô đang active nhận Tab, các ô khác tabIndex = -1. */
export function applyRovingTabIndex(grid: GridCell[][], active: GridPosition) {
  grid.forEach((row, r) =>
    row.forEach((cell, i) => {
      cell.el.tabIndex = r === active.row && i === active.index && !cell.disabled ? 0 : -1;
    }),
  );
}

// ---- Focus không làm cuộn trang ----

let preventScrollSupported: boolean | null = null;

/**
 * Phát hiện `focus({ preventScroll })` bằng getter: trình duyệt nào hiểu option
 * thì phải ĐỌC thuộc tính, getter chạy và ta biết. Chạy lười, một lần.
 */
export function supportsPreventScroll() {
  if (preventScrollSupported !== null) return preventScrollSupported;
  preventScrollSupported = false;
  try {
    const probe = document.createElement('div');
    probe.focus(
      Object.defineProperty({}, 'preventScroll', {
        get() {
          preventScrollSupported = true;
          return true;
        },
      }) as FocusOptions,
    );
  } catch {
    // trình duyệt rất cũ ném lỗi khi nhận object lạ: coi như không hỗ trợ
  }
  return preventScrollSupported;
}

/** Ghi lại vị trí cuộn của mọi tổ tiên đang tràn + document, để trả lại sau khi focus. */
function snapshotScroll(el: HTMLElement) {
  const saved: Array<[Element, number, number]> = [];
  const root = document.scrollingElement ?? document.documentElement;
  for (let node = el.parentElement; node && node !== root; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) {
      saved.push([node, node.scrollTop, node.scrollLeft]);
    }
  }
  saved.push([root, root.scrollTop, root.scrollLeft]);
  return () => {
    for (const [node, top, left] of saved) {
      node.scrollTop = top;
      node.scrollLeft = left;
    }
  };
}

let programmaticFocus = false;

/** true khi focus hiện tại do code gọi (không phải người dùng bấm/Tab). */
export function isProgrammaticFocus() {
  return programmaticFocus;
}

export interface FocusOptionsEx {
  preventScroll?: boolean;
  /** 'auto': dùng preventScroll nếu được, không thì lưu/khôi phục; 'native-only'; 'fallback-only' (để demo) */
  strategy?: 'auto' | 'native-only' | 'fallback-only';
}

export function focusElement(el: HTMLElement, { preventScroll = false, strategy = 'auto' }: FocusOptionsEx = {}) {
  const prev = programmaticFocus;
  programmaticFocus = true;
  try {
    if (!preventScroll) el.focus();
    else if (strategy !== 'fallback-only' && supportsPreventScroll()) el.focus({ preventScroll: true });
    else if (strategy === 'native-only') el.focus();
    else {
      const restore = snapshotScroll(el);
      el.focus();
      restore();
    }
  } finally {
    programmaticFocus = prev;
  }
}
